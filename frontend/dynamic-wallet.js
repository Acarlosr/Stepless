/**
 * dynamic-wallet.js
 * Login por email (OTP) via Dynamic — cria uma embedded wallet (WaaS) na
 * hora, sem precisar de MetaMask nem nenhuma extensão instalada. Mantém
 * MetaMask/window.ethereum como opção alternativa no mesmo modal.
 *
 * Usa os pacotes reais e atuais do Dynamic (@dynamic-labs-sdk/client +
 * @dynamic-labs-sdk/evm), carregados via esm.sh já que este projeto não tem
 * build step. A versão anterior deste arquivo tentava carregar um script
 * ("dynamic-embed.js") que não existe — por isso o connect nunca funcionava
 * sem MetaMask.
 *
 * IMPORTANTE — arquitetura do Stepless: a wallet do usuário NUNCA assina
 * transações on-chain neste app. registerLocation / verifyContribution /
 * payReward são todos feitos pelo relayer no backend (ver api/relay.js e
 * api/verify.js) — a wallet conectada só precisa fornecer um ENDEREÇO válido
 * para receber a recompensa em USDC. Por isso, quando a conexão vem do login
 * por email (embedded wallet), o "provider" retornado é um stub seguro: ele
 * nunca é chamado para assinar nada no fluxo normal de uso.
 *
 * Exporta: initDynamic, connectWallet, disconnectWallet, getWalletState,
 * onWalletChange, getProvider, tryRestoreSession — mesma API pública de
 * antes + tryRestoreSession (novo).
 *
 * SESSÃO PERSISTENTE: o Dynamic já guarda a sessão (JWT) sozinho no
 * storage do navegador — o problema não era "a sessão não persiste", era
 * que ninguém nunca checava se já existia uma sessão salva antes de abrir
 * o modal de login. `tryRestoreSession()` faz essa checagem (via
 * `isSignedIn()` + `getWalletAccounts()`) e, se achar uma sessão válida,
 * restaura o estado de conexão sem pedir email/código de novo.
 */

const DYNAMIC_ENV_ID = window.DYNAMIC_ENV_ID || '9b978edb-c7e1-425c-93eb-1c042b66dff1';

const ARC_TESTNET = {
  chainId: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: ['https://rpc.testnet.arc.network'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
};

// ─── Estado do módulo ────────────────────────────────────────────────────────
let _client = null;      // instância do Dynamic client
let _clientMod = null;   // módulo @dynamic-labs-sdk/client (funções soltas)
let _waasMod = null;     // módulo @dynamic-labs-sdk/client/waas (lazy)
let _address = null;
let _walletClient = null;
let _isConnected = false;
let _listeners = [];

function _notify() {
  const state = { isConnected: _isConnected, address: _address, walletClient: _walletClient };
  _listeners.forEach(fn => { try { fn(state); } catch (_) {} });
}

/** Registra um callback chamado sempre que o estado da wallet muda. */
export function onWalletChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── initDynamic ────────────────────────────────────────────────────────────
/** Inicializa o Dynamic client. Chamar 1x, antes de qualquer connectWallet(). */
export async function initDynamic() {
  if (_client) return;
  try {
    // IMPORTANTE: sem "?bundle" — com bundle, esm.sh gera cópias isoladas dos
    // módulos internos compartilhados e addEvmExtension() não encontra o
    // client criado por createDynamicClient() ("No Dynamic client has been
    // created yet"), mesmo tendo sido chamado corretamente na sequência certa.
    const [clientMod, evmMod] = await Promise.all([
      import('https://esm.sh/@dynamic-labs-sdk/client'),
      import('https://esm.sh/@dynamic-labs-sdk/evm'),
    ]);
    _clientMod = clientMod;
    _client = clientMod.createDynamicClient({
      environmentId: DYNAMIC_ENV_ID,
      metadata: { name: 'Stepless', url: location.origin },
    });
    // Extensões não recebem argumentos e devem ser registradas logo após
    // criar o client (antes da inicialização terminar).
    evmMod.addEvmExtension();

    // Espera o client terminar de carregar a sessão salva (JWT em
    // cookie/storage) antes de considerar "inicializado". Sem isso,
    // isSignedIn()/getWalletAccounts() podem responder antes da sessão
    // salva ter sido lida, dando falso negativo.
    if (typeof clientMod.waitForClientInitialized === 'function') {
      await clientMod.waitForClientInitialized();
    }

    console.log('[Dynamic] Client inicializado (login por email disponível)');
  } catch (err) {
    console.warn('[Dynamic] Falha ao inicializar SDK — só MetaMask vai funcionar:', err);
    _client = null;
    _clientMod = null;
  }
}

// ─── tryRestoreSession ──────────────────────────────────────────────────────
/**
 * Chamar depois de initDynamic(), antes de mostrar qualquer UI de login.
 * Se o usuário já tiver uma sessão válida (login por email anterior, JWT
 * ainda guardado pelo navegador), restaura o estado de conexão e retorna
 * { address, walletClient, provider } — sem abrir modal, sem pedir OTP de
 * novo. Retorna null se não houver sessão (usuário precisa conectar).
 */
export async function tryRestoreSession() {
  if (!_clientMod || !_client) return null;
  try {
    const signedIn = typeof _clientMod.isSignedIn === 'function'
      ? _clientMod.isSignedIn()
      : Boolean(_client.user);
    if (!signedIn) return null;

    // Após um reload, o Dynamic reporta isSignedIn() === true (JWT no
    // storage), mas a embedded wallet (WaaS) ainda NÃO foi recarregada na
    // memória do client — então getWalletAccounts() volta vazio e o usuário
    // era obrigado a logar de novo. Aqui a gente reidrata os accounts WaaS
    // (mesma lógica do connectWallet) antes de ler o endereço.
    let accounts = await _clientMod.getWalletAccounts();
    if (!accounts?.length) {
      try {
        const waas = await _loadWaas();
        const missingChains = waas.getChainsMissingWaasWalletAccounts?.();
        if (missingChains?.length) {
          await waas.createWaasWalletAccounts({ chains: missingChains });
        }
        accounts = await _clientMod.getWalletAccounts();
      } catch (waasErr) {
        console.warn('[Dynamic] Não deu pra reidratar WaaS na restauração:', waasErr);
      }
    }
    const address = accounts?.[0]?.address;
    if (!address) return null;

    _address = address;
    _walletClient = {
      request: async () => {
        throw new Error('Esta wallet (login por email) não assina transações — não é necessário neste app.');
      },
    };
    _isConnected = true;
    _notify();

    console.log('[Dynamic] Sessão restaurada — login automático:', address);
    return { address: _address, walletClient: _walletClient, provider: _walletClient };
  } catch (err) {
    console.warn('[Dynamic] Falha ao restaurar sessão salva:', err);
    return null;
  }
}

async function _loadWaas() {
  if (_waasMod) return _waasMod;
  _waasMod = await import('https://esm.sh/@dynamic-labs-sdk/client/waas');
  return _waasMod;
}

// ─── connectWallet ──────────────────────────────────────────────────────────
/**
 * Abre um modal próprio (o SDK do Dynamic é headless, sem UI pronta) com
 * duas opções: login por email (OTP) ou MetaMask. Resolve com
 * { address, walletClient, provider } quando o usuário conectar.
 */
export function connectWallet() {
  return new Promise((resolve, reject) => {
    _openModal({ resolve, reject });
  });
}

// ─── Modal DOM (injetado 1x, reaproveitado) ────────────────────────────────
let _modalEl = null;
function _buildModal() {
  if (_modalEl) return _modalEl;
  const el = document.createElement('div');
  el.id = 'stepless-wallet-modal';
  el.className = 'sw-modal-overlay hidden';
  el.innerHTML = `
    <div class="sw-modal-card" role="dialog" aria-modal="true" aria-label="Conectar wallet">
      <button type="button" class="sw-modal-close" aria-label="Fechar">✕</button>
      <h3>Conecte sua Wallet</h3>
      <p class="sw-modal-sub">Entre com seu email — a gente cria uma wallet pra você na hora, sem instalar nada.</p>

      <form id="sw-email-form" class="sw-step">
        <label for="sw-email-input">Email</label>
        <input type="email" id="sw-email-input" placeholder="seu@email.com" required autocomplete="email" />
        <button type="submit" class="btn btn-primary btn-block" style="margin-top:.75rem">Enviar código</button>
      </form>

      <form id="sw-otp-form" class="sw-step hidden">
        <p class="sw-modal-sub" id="sw-otp-hint"></p>
        <label for="sw-otp-input">Código</label>
        <input type="text" id="sw-otp-input" placeholder="000000" inputmode="numeric" maxlength="8" required />
        <button type="submit" class="btn btn-primary btn-block" style="margin-top:.75rem">Confirmar código</button>
        <button type="button" id="sw-otp-back" class="btn btn-ghost btn-block" style="margin-top:.5rem">Voltar</button>
      </form>

      <p id="sw-modal-error" class="sw-modal-error hidden"></p>

      <div class="sw-modal-divider"><span>ou</span></div>

      <button type="button" id="sw-metamask-btn" class="btn btn-secondary btn-block">🦊 Usar MetaMask</button>
    </div>
  `;
  document.body.appendChild(el);
  _modalEl = el;
  return el;
}

function _showError(el, msg) {
  const errEl = el.querySelector('#sw-modal-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}
function _clearError(el) {
  el.querySelector('#sw-modal-error').classList.add('hidden');
}

function _openModal({ resolve, reject }) {
  const el = _buildModal();
  el.classList.remove('hidden');
  _clearError(el);

  let pendingOtp = null; // resultado de sendEmailOTP, usado na verificação

  const emailForm = el.querySelector('#sw-email-form');
  const otpForm = el.querySelector('#sw-otp-form');

  const reset = () => {
    emailForm.reset();
    otpForm.reset();
    emailForm.classList.remove('hidden');
    otpForm.classList.add('hidden');
    _clearError(el);
  };

  const close = (err) => {
    el.classList.add('hidden');
    reset();
    if (err) reject(err);
  };

  el.querySelector('.sw-modal-close').onclick = () => close(new Error('Cancelado pelo usuário'));

  emailForm.onsubmit = async (ev) => {
    ev.preventDefault();
    _clearError(el);
    const email = el.querySelector('#sw-email-input').value.trim();
    if (!_clientMod) {
      _showError(el, 'Login por email indisponível agora — use MetaMask abaixo.');
      return;
    }
    const btn = emailForm.querySelector('button[type=submit]');
    const originalLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      // sendEmailOTP retorna { email, verificationUUID } diretamente — esse
      // objeto INTEIRO é o "otpVerification" esperado por verifyOTP (não um
      // campo aninhado .otpVerification, como a doc do Dynamic sugere).
      pendingOtp = await _clientMod.sendEmailOTP({ email });
      el.querySelector('#sw-otp-hint').textContent = `Digite o código enviado para ${email}`;
      emailForm.classList.add('hidden');
      otpForm.classList.remove('hidden');
      el.querySelector('#sw-otp-input').focus();
    } catch (err) {
      _showError(el, err?.message || 'Falha ao enviar código. Tente de novo.');
    } finally {
      btn.disabled = false; btn.textContent = originalLabel;
    }
  };

  el.querySelector('#sw-otp-back').onclick = () => {
    _clearError(el);
    otpForm.classList.add('hidden');
    emailForm.classList.remove('hidden');
  };

  otpForm.onsubmit = async (ev) => {
    ev.preventDefault();
    _clearError(el);
    const code = el.querySelector('#sw-otp-input').value.trim();
    const btn = otpForm.querySelector('button[type=submit]');
    const originalLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Confirmando...';
    try {
      // requestedScopes: Credentiallink — criar a embedded wallet conta como
      // "vincular uma nova credencial" pro Dynamic, e isso exige um token de
      // acesso elevado (step-up auth) a partir da API version 2026_04_01.
      // Sem isso, createWaasWalletAccounts() falha com "Elevated access
      // token required" mesmo com o código certo. Pedindo o scope aqui,
      // no mesmo verifyOTP, o SDK já guarda o token elevado automaticamente
      // e aplica nas chamadas seguintes — não precisa de uma 2ª verificação.
      await _clientMod.verifyOTP({
        otpVerification: pendingOtp,
        verificationToken: code,
        requestedScopes: [_clientMod.TokenScope.Credentiallink],
      });

      // A wallet embedded não é criada automaticamente — precisa chamar
      // createWaasWalletAccounts() explicitamente pras chains que faltarem.
      const waas = await _loadWaas();
      const missingChains = waas.getChainsMissingWaasWalletAccounts();
      if (missingChains?.length) {
        await waas.createWaasWalletAccounts({ chains: missingChains });
      }

      const accounts = await _clientMod.getWalletAccounts();
      const address = accounts?.[0]?.address;
      if (!address) throw new Error('Wallet criada, mas sem endereço retornado.');

      _address = address;
      // Stub seguro: essa wallet nunca precisa assinar nada neste app
      // (todas as transações passam pelo relayer no backend).
      _walletClient = {
        request: async () => {
          throw new Error('Esta wallet (login por email) não assina transações — não é necessário neste app.');
        },
      };
      _isConnected = true;
      _notify();

      close();
      resolve({ address: _address, walletClient: _walletClient, provider: _walletClient });
    } catch (err) {
      _showError(el, err?.message || 'Código inválido. Tente de novo.');
    } finally {
      btn.disabled = false; btn.textContent = originalLabel;
    }
  };

  el.querySelector('#sw-metamask-btn').onclick = async () => {
    _clearError(el);
    try {
      const result = await _connectViaEthereum();
      close();
      resolve(result);
    } catch (err) {
      _showError(el, err?.message || 'Falha ao conectar MetaMask.');
    }
  };
}

// ─── Fallback: conecta via window.ethereum (MetaMask etc.) ─────────────────
async function _connectViaEthereum() {
  if (!window.ethereum) {
    throw new Error('MetaMask não detectado. Use o login por email acima.');
  }

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  _address = accounts[0];

  const arcChainHex = '0x' + ARC_TESTNET.chainId.toString(16);
  const currentChain = await window.ethereum.request({ method: 'eth_chainId' });

  if (currentChain !== arcChainHex) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: arcChainHex }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: arcChainHex,
            chainName: ARC_TESTNET.name,
            nativeCurrency: ARC_TESTNET.nativeCurrency,
            rpcUrls: ARC_TESTNET.rpcUrls,
            blockExplorerUrls: ARC_TESTNET.blockExplorerUrls,
          }],
        });
      } else {
        throw switchErr;
      }
    }
  }

  _walletClient = window.ethereum;
  _isConnected = true;
  _notify();

  return { address: _address, walletClient: window.ethereum, provider: window.ethereum };
}

// ─── disconnectWallet ───────────────────────────────────────────────────────
export async function disconnectWallet() {
  try {
    if (_clientMod?.logout) await _clientMod.logout();
  } catch (_) {}
  _address = null;
  _walletClient = null;
  _isConnected = false;
  _notify();
}

// ─── getWalletState ─────────────────────────────────────────────────────────
export function getWalletState() {
  return { isConnected: _isConnected, address: _address, walletClient: _walletClient };
}

// ─── getProvider ─────────────────────────────────────────────────────────────
/**
 * Retorna um provider EIP-1193 compatível com viem's custom() transport.
 * Para MetaMask é o provider real; para a embedded wallet (email) é o stub
 * seguro (nunca chamado no fluxo normal do app).
 */
export function getProvider() {
  if (!_isConnected) return null;
  if (_walletClient && typeof _walletClient.request === 'function') return _walletClient;
  return window.ethereum || null;
}

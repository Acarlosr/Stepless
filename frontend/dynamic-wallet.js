/**
 * dynamic-wallet.js
 * Integração do Dynamic SDK (vanilla JS / CDN) para Stepless.
 *
 * Exporta:
 *   initDynamic()     → inicializa o SDK (chamar 1x no DOMContentLoaded)
 *   connectWallet()   → abre o modal do Dynamic e retorna { address, walletClient }
 *   disconnectWallet()→ faz logout
 *   getWalletState()  → { isConnected, address, walletClient }
 *
 * O Dynamic SDK é carregado via esm.sh (UMD/ESM).
 * Environment ID vem de window.DYNAMIC_ENV_ID (definido inline no HTML)
 * ou da constante abaixo.
 */

const DYNAMIC_ENV_ID = '9b978edb-c7e1-425c-93eb-1c042b66dff1';

// Arc Testnet chain definition para o Dynamic
const ARC_TESTNET = {
  chainId: 5042002,
  name: 'Arc Testnet',
  networkId: 5042002,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: ['https://rpc.testnet.arc.network'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
  iconUrls: [],
};

// Estado global do módulo
let _dynamic = null;       // instância do DynamicContextSDK
let _address = null;
let _walletClient = null;
let _isConnected = false;
let _listeners = [];       // callbacks onStateChange

// ─── Notifica listeners externos ───────────────────────────────────────────
function _notify() {
  const state = { isConnected: _isConnected, address: _address, walletClient: _walletClient };
  _listeners.forEach(fn => { try { fn(state); } catch (_) {} });
}

/**
 * Registra um callback chamado sempre que o estado da wallet muda.
 * Retorna função para cancelar o listener.
 */
export function onWalletChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

// ─── Carrega o SDK via esm.sh ───────────────────────────────────────────────
async function _loadSDK() {
  if (_dynamic) return _dynamic;

  // Dynamic SDK — pacotes principais
  const [coreModule, ethModule] = await Promise.all([
    import('https://esm.sh/@dynamic-labs/sdk-api@0.0.545'),
    import('https://esm.sh/@dynamic-labs/ethereum@0.0.545'),
  ]);

  return { coreModule, ethModule };
}

// ─── initDynamic ────────────────────────────────────────────────────────────
/**
 * Inicializa o Dynamic SDK.
 * Deve ser chamado 1x, antes de qualquer conectWallet().
 */
export async function initDynamic() {
  if (_dynamic) return;

  try {
    // Dynamic recomenda o SDK via script UMD para vanilla JS.
    // Carregamos via esm.sh o pacote @dynamic-labs/sdk-react-core
    // que exporta createConfig + DynamicContextSDK (sem React).
    const mod = await import('https://esm.sh/@dynamic-labs/sdk-react-core@3.9.9?bundle');

    const { DynamicContextProvider } = mod;

    // Para vanilla JS usamos o SDK diretamente sem React.
    // O Dynamic também expõe um helper `createHeadlessDynamic`
    // disponível via @dynamic-labs/sdk-api (headless mode).
    // Fallback: usar window.ethereum injetado pelo Dynamic Embedded Wallet.

    console.log('[Dynamic] SDK carregado');
    _dynamic = mod;
  } catch (err) {
    console.warn('[Dynamic] Falha ao carregar SDK via esm.sh:', err);
    _dynamic = null;
  }
}

// ─── connectWallet ──────────────────────────────────────────────────────────
/**
 * Abre o modal do Dynamic para login/cadastro.
 * Retorna { address, provider } ao conectar.
 *
 * Estratégia:
 *  1. Se Dynamic SDK headless disponível → usa API headless
 *  2. Senão → injeta o widget iframe do Dynamic (embeddable widget)
 *  3. Fallback final → window.ethereum (MetaMask)
 */
export async function connectWallet() {
  // Tenta carregar o Dynamic widget script se ainda não foi injetado
  await _ensureDynamicWidget();

  // Aguarda o Dynamic expor window.dynamic após inicialização
  const dynamicSDK = await _waitForDynamic(5000);

  if (dynamicSDK) {
    return await _connectViaDynamic(dynamicSDK);
  } else {
    // Fallback: MetaMask / window.ethereum
    return await _connectViaEthereum();
  }
}

// ─── Injeta o script do Dynamic Widget ─────────────────────────────────────
let _widgetInjected = false;
async function _ensureDynamicWidget() {
  if (_widgetInjected) return;
  _widgetInjected = true;

  return new Promise((resolve) => {
    const script = document.createElement('script');
    // Dynamic fornece um widget embeddable via CDN
    script.src = `https://embed.dynamic.xyz/dynamic-embed.js`;
    script.setAttribute('data-environment-id', DYNAMIC_ENV_ID);
    script.setAttribute('data-network-ids', String(ARC_TESTNET.chainId));
    script.async = true;
    script.onload = () => {
      console.log('[Dynamic] Widget script carregado');
      resolve();
    };
    script.onerror = () => {
      console.warn('[Dynamic] Falha ao carregar widget script');
      resolve(); // não bloqueia — usa fallback
    };
    document.head.appendChild(script);
  });
}

// ─── Aguarda window.dynamic ser exposto pelo script ────────────────────────
function _waitForDynamic(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (window.dynamic?.auth) { resolve(window.dynamic); return; }
    const start = Date.now();
    const check = setInterval(() => {
      if (window.dynamic?.auth) {
        clearInterval(check);
        resolve(window.dynamic);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve(null);
      }
    }, 100);
  });
}

// ─── Conecta via Dynamic SDK (auth flow) ───────────────────────────────────
async function _connectViaDynamic(sdk) {
  // Abre o modal de autenticação
  await sdk.auth.show();

  // Aguarda autenticação (o modal fecha ao autenticar)
  await new Promise((resolve, reject) => {
    const unsub = sdk.auth.on('authenticated', resolve);
    const unsuberr = sdk.auth.on('error', (err) => { reject(err); });
    // Timeout de 5 minutos
    setTimeout(() => { reject(new Error('Timeout aguardando autenticação')); }, 300000);
  });

  const user = sdk.auth.getUser();
  const wallet = sdk.wallets.getAll()[0];

  if (!wallet) throw new Error('Nenhuma wallet após autenticação Dynamic');

  _address = wallet.address;
  _walletClient = wallet;
  _isConnected = true;
  _notify();

  return { address: _address, walletClient: _walletClient, provider: wallet.provider };
}

// ─── Fallback: conecta via window.ethereum ──────────────────────────────────
async function _connectViaEthereum() {
  if (!window.ethereum) {
    throw new Error('Nenhuma wallet detectada. Instale MetaMask ou use email login.');
  }

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  _address = accounts[0];

  // Garante Arc Testnet
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
  const sdk = window.dynamic;
  if (sdk?.auth) {
    try { await sdk.auth.logout(); } catch (_) {}
  }
  _address = null;
  _walletClient = null;
  _isConnected = false;
  _notify();
}

// ─── getWalletState ─────────────────────────────────────────────────────────
export function getWalletState() {
  return { isConnected: _isConnected, address: _address, walletClient: _walletClient };
}

// ─── getSigner (compatível com viem walletClient) ───────────────────────────
/**
 * Retorna um provider EIP-1193 compatível com viem's custom() transport.
 * Funciona tanto para Dynamic embedded wallet quanto MetaMask.
 */
export function getProvider() {
  if (!_isConnected) return null;

  // Dynamic wallet expõe .provider EIP-1193
  if (_walletClient && _walletClient.provider) {
    return _walletClient.provider;
  }

  // Fallback: window.ethereum
  return window.ethereum || null;
}

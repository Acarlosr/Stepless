/**
 * Stepless Dashboard Logic
 * Viem client for Arc Testnet — read/write contracts, WebSocket events,
 * USDC balance, gas estimation in USDC, multilingual error handling.
 *
 * Loaded as ES module in dashboard.html.
 */

import { SteplessConfig } from './arc-config.js';
import { initDynamic, connectWallet as _dynamicConnect, disconnectWallet, onWalletChange, getProvider, tryRestoreSession as _dynamicRestore } from './dynamic-wallet.js';

// Inicializa Dynamic em background — guardamos a promise pra poder esperar
// ela terminar antes de checar sessão salva em tryAutoConnect().
const _dynamicInitPromise = initDynamic();
const WALLET_DISCONNECT_KEY = 'stepless-wallet-disconnected';

/* ═══════════════════════════════════════════════════════════════
 *  State
 * ═══════════════════════════════════════════════════════════════ */

const cfg = SteplessConfig;
let publicClient = null;
let walletClient = null;
let walletAddress = null;
let wsClient = null;
let activeUnwatch = [];
let isConnected = false;
let leafletMap = null;
let leafletMarkersLayer = null;
let regPickerMap = null;      // mapa interativo do formulário (marcar local)
let regPickerMarker = null;
// Cache: a varredura de eventos do mapa (dezenas de getLogs) roda UMA vez por
// sessão. Novos locais entram em tempo real pelo watcher de LocationRegistered,
// então não é preciso re-varrer a cada refreshAll (evita tempestade de 429).
let mapMarkersLoaded = false;

/* ═══════════════════════════════════════════════════════════════
 *  Viem loading (CDN esm.sh)
 * ═══════════════════════════════════════════════════════════════ */

async function loadViem() {
  if (window.viem) return window.viem;
  const viem = await import('https://esm.sh/viem@2.21.0');
  window.viem = viem;
  return viem;
}

/* ═══════════════════════════════════════════════════════════════
 *  Helpers
 * ═══════════════════════════════════════════════════════════════ */

function getStrings() {
  return window.SteplessI18n?.strings || {};
}

function getLang() {
  return window.SteplessI18n?.currentLang || 'pt';
}

function formatUsdc(wei) {
  if (!wei) return '0.00';
  const val = Number(wei) / 1e6;
  return val.toLocaleString(getLang() === 'pt' ? 'pt-BR' : getLang(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Deixa o endereço da wallet no header clicável — copia o endereço completo
// pra área de transferência (útil pra colar em faucets/exploradores).
function makeAddressCopyable(el, address) {
  if (!el || !address) return;
  el.style.cursor = 'pointer';
  el.title = `${address} — clique para copiar`;
  el.onclick = () => {
    navigator.clipboard?.writeText(address);
    const original = el.textContent;
    el.textContent = '✅ Copiado!';
    setTimeout(() => { el.textContent = original; }, 1200);
  };
}

function shortHash(hash) {
  if (!hash) return '—';
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function timeAgo(timestamp) {
  const now = Date.now();
  const ts = Number(timestamp) * 1000;
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function showAlert(containerId, type, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 8000);
}

function logEvent(type, data) {
  const log = document.getElementById('event-log');
  if (!log) return;
  const empty = log.querySelector('.event-entry.text-center');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'event-entry';
  const time = new Date().toLocaleTimeString(getLang() === 'pt' ? 'pt-BR' : getLang());
  entry.innerHTML = `<span class="event-time">${time}</span> <span class="event-type">${type}</span> ${data}`;
  log.insertBefore(entry, log.firstChild);

  // Keep max 50 entries
  while (log.children.length > 50) {
    log.removeChild(log.lastChild);
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Arc-specific error handling
 * ═══════════════════════════════════════════════════════════════ */

function handleArcError(err) {
  const s = getStrings();
  const msg = err?.message || String(err);

  // Arc blocklist — address flagged by anti-drain
  if (/blocklist|blocked|forbidden/i.test(msg)) {
    return s.err_blocklist || 'Address blocked by Arc anti-drain system.';
  }

  // Arc drain detection
  if (/drain|exceed|limit/i.test(msg)) {
    return s.err_drain || 'Drain attempt detected. Transaction blocked.';
  }

  // Decimal mismatch (USDC 6 decimals)
  if (/decimal|overflow|underflow/i.test(msg)) {
    return s.err_decimal || 'Decimal error: USDC uses 6 decimals on Arc.';
  }

  // Wrong chain
  if (/chain|network|5042002/i.test(msg)) {
    return s.err_wrong_chain || 'Wrong network. Connect to Arc Testnet.';
  }

  // User rejected
  if (/rejected|denied|cancelled/i.test(msg)) {
    return err?.shortMessage || msg;
  }

  return err?.shortMessage || msg || (s.err_tx_failed || 'Transaction failed');
}

/* ═══════════════════════════════════════════════════════════════
 *  Wallet connection
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Finaliza a conexão (Dynamic ou MetaMask): cria os clientes viem, atualiza
 * a UI e carrega os dados do dashboard. Compartilhado entre connect()
 * (clique manual) e tryAutoConnect() (reconexão silenciosa/sessão salva).
 */
async function _completeConnection(address, provider) {
  localStorage.removeItem(WALLET_DISCONNECT_KEY);
  walletAddress = address;

  const viem = await loadViem();

  // RPCs tentados em ordem (fallback) — se um falhar (429/timeout), tenta o
  // próximo. Só o nó oficial por ora (os proxies da doc devolvem 400).
  const ARC_RPC_URLS = (cfg.chain?.rpcUrls?.default?.http?.length
    ? cfg.chain.rpcUrls.default.http
    : ['https://rpc.testnet.arc.network']);

  publicClient = viem.createPublicClient({
    chain: cfg.chain,
    // pollingInterval alto: os "eventos em tempo real" usam watchContractEvent,
    // que faz POLLING no RPC (não é WebSocket real). O padrão de 4s × 3 watchers
    // martela o nó público e gera 429 em massa. 15s reduz isso em ~4x mantendo
    // a sensação de tempo real aceitável para a demo.
    pollingInterval: 15_000,
    // Resiliência: fallback entre vários RPCs + retry/backoff em cada endpoint.
    transport: viem.fallback(
      ARC_RPC_URLS.map((url) => viem.http(url, {
        retryCount: 2,
        retryDelay: 800,
        timeout: 12_000,
      })),
      { rank: false },
    ),
  });

  walletClient = viem.createWalletClient({
    account: walletAddress,
    chain: cfg.chain,
    transport: viem.custom(provider),
  });

  isConnected = true;

  document.getElementById('not-connected')?.classList.add('hidden');
  document.getElementById('dashboard-content')?.classList.remove('hidden');

  const btn = document.getElementById('connect-wallet-btn');
  if (btn) { btn.style.display = 'none'; btn.disabled = false; }
  const btnLarge = document.getElementById('connect-wallet-btn-large');
  if (btnLarge) btnLarge.disabled = false;
  const info = document.getElementById('wallet-info');
  if (info) info.classList.add('connected');
  const addrEl = document.getElementById('wallet-address');
  if (addrEl) { addrEl.textContent = shortAddr(walletAddress); makeAddressCopyable(addrEl, walletAddress); }

  await refreshAll();
  await checkRelayerSetup();
  await checkAdminPanel();
  startWebSocketSubscriptions(viem);

  return viem;
}

async function connect() {
  const s = getStrings();

  const btn = document.getElementById('connect-wallet-btn');
  const btnLarge = document.getElementById('connect-wallet-btn-large');
  const originalText = btn?.textContent;
  if (btn) { btn.textContent = s.loading || 'Loading...'; btn.disabled = true; }
  if (btnLarge) { btnLarge.textContent = s.loading || 'Loading...'; btnLarge.disabled = true; }

  try {
    // ── Dynamic SDK: abre modal de login/email/social ──────────────────
    const { address, provider } = await _dynamicConnect();

    // Reage a logout/troca de conta do Dynamic
    onWalletChange(({ isConnected: ic }) => {
      if (!ic && localStorage.getItem(WALLET_DISCONNECT_KEY) !== '1') location.reload();
    });

    await _completeConnection(address, provider);

  } catch (err) {
    console.error('Connection failed:', err);
    alert(handleArcError(err));
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
    if (btnLarge) { btnLarge.textContent = originalText; btnLarge.disabled = false; }
  }
}

async function disconnect() {
  const btn = document.getElementById('disconnect-wallet-btn');
  if (btn) btn.disabled = true;
  localStorage.setItem(WALLET_DISCONNECT_KEY, '1');

  activeUnwatch.forEach(unwatch => {
    try { unwatch?.(); } catch (_) {}
  });
  activeUnwatch = [];

  try {
    await disconnectWallet();
  } catch (err) {
    console.warn('Disconnect failed:', err);
  }

  isConnected = false;
  walletAddress = null;
  walletClient = null;
  publicClient = null;

  document.getElementById('dashboard-content')?.classList.add('hidden');
  document.getElementById('not-connected')?.classList.remove('hidden');

  const connectBtn = document.getElementById('connect-wallet-btn');
  if (connectBtn) {
    connectBtn.style.display = '';
    connectBtn.disabled = false;
    connectBtn.textContent = getStrings().connect_wallet || 'Conectar Wallet';
  }
  const connectBtnLarge = document.getElementById('connect-wallet-btn-large');
  if (connectBtnLarge) {
    connectBtnLarge.disabled = false;
    connectBtnLarge.textContent = getStrings().connect_wallet || 'Conectar Wallet';
  }
  const info = document.getElementById('wallet-info');
  if (info) info.classList.remove('connected');
  const addrEl = document.getElementById('wallet-address');
  if (addrEl) {
    addrEl.textContent = '—';
    addrEl.onclick = null;
    addrEl.removeAttribute('title');
  }
  const balanceEl = document.getElementById('wallet-balance');
  if (balanceEl) balanceEl.textContent = '—';
  if (btn) btn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════════
 *  Admin panel — autorizar relayer (só aparece para o admin)
 * ═══════════════════════════════════════════════════════════════ */

// Endereço do relayer: lido de arc-config.js (fonte única), não mais
// hardcoded aqui. Evita divergência silenciosa na próxima rotação de chave.
const RELAYER_ADDRESS = cfg.relayerAddress;

function requestAdminSecret() {
  const secret = window.prompt('Informe a credencial administrativa para confirmar esta operação:');
  return secret?.trim() || null;
}

/* ═══════════════════════════════════════════════════════════════
 *  Assinatura do verificador
 *
 *  Cada verificador assina a aprovação com a própria carteira. O
 *  backend recupera o endereço da assinatura e confere no contrato
 *  se ele é verificador — ninguém precisa saber segredo nenhum, e
 *  cada aprovação fica atribuída a uma pessoa.
 *
 *  A mensagem é legível de propósito: quem assina precisa entender
 *  o que está autorizando. Ela amarra ação + contribuição + horário
 *  + domínio, para a assinatura não servir em outro contexto.
 * ═══════════════════════════════════════════════════════════════ */

function buildVerifyMessage({ contributionId, approve, address, timestamp, domain }) {
  return [
    'Stepless — autorizar verificação',
    '',
    `Ação: ${approve ? 'APROVAR' : 'REJEITAR'}`,
    `Contribuição: ${String(contributionId).toLowerCase()}`,
    `Verificador: ${String(address).toLowerCase()}`,
    `Momento: ${new Date(timestamp).toISOString()}`,
    `Domínio: ${domain}`,
  ].join('\n');
}

/** Pede a assinatura à carteira conectada. Retorna null se não der. */
async function signVerification(contributionId, approve) {
  if (!walletAddress) return null;
  let provider;
  try { provider = await getProvider(); } catch (_) { return null; }
  if (!provider?.request) return null;

  const timestamp = Date.now();
  const domain = window.location.host;
  const message = buildVerifyMessage({ contributionId, approve, address: walletAddress, timestamp, domain });

  try {
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, walletAddress],
    });
    return { address: walletAddress, signature, timestamp };
  } catch (err) {
    // 4001 = usuário recusou no popup da carteira; não é erro de sistema.
    if (err?.code === 4001) throw new Error('Assinatura cancelada.');
    return null;
  }
}

// Verifica se relayer está autorizado e mostra banner de setup se não estiver
async function checkRelayerSetup() {
  const panel = document.getElementById('admin-setup-panel');
  if (!panel) return;
  try {
    const resp = await fetch('/api/setup');
    // FAIL-SAFE: se a verificação falhar (429/500/HTML sob RPC saturado), NÃO
    // mostra o aviso de "autorizar relayer". Clicar nele dispara escritas
    // on-chain e, sob RPC lento, trava — e o relayer já está autorizado. Só
    // mostramos o aviso quando conseguimos ler o status E algo está de fato
    // faltando.
    if (!resp.ok) { panel.style.display = 'none'; return; }
    let data;
    try { data = await resp.json(); } catch { panel.style.display = 'none'; return; }
    const allOk = data.checks && Object.values(data.checks).every(Boolean);
    panel.style.display = allOk ? 'none' : 'block';
  } catch (_) {
    panel.style.display = 'none'; // falha de rede → não assusta com aviso falso
  }
}

// Botão de autorizar relayer (chama /api/setup POST)
window.setupRelayer = async function() {
  const btn = document.getElementById('btn-setup-relay');
  const status = document.getElementById('setup-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Autorizando...';
  try {
    const adminSecret = requestAdminSecret();
    if (!adminSecret) {
      if (status) status.textContent = 'Operação cancelada.';
      if (btn) btn.disabled = false;
      return;
    }
    const resp = await fetch('/api/setup', { method: 'POST', headers: { 'X-Admin-Secret': adminSecret } });
    const data = await resp.json();
    if (data.success) {
      if (status) status.textContent = '✅ Autorizado! Pode registrar locais agora.';
      setTimeout(() => { document.getElementById('admin-setup-panel').style.display = 'none'; }, 3000);
    } else {
      if (status) status.textContent = `❌ ${data.error}`;
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    if (status) status.textContent = `❌ ${err.message}`;
    if (btn) btn.disabled = false;
  }
};

async function checkAdminPanel() {
  try {
    const admin = await publicClient.readContract({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'admin',
    });

    if (admin.toLowerCase() !== walletAddress.toLowerCase()) return;

    // Verifica se relayer já está autorizado
    const isAuth = await publicClient.readContract({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'authorizedCallers',
      args: [RELAYER_ADDRESS],
    });

    // Monta painel admin (não existindo ainda)
    let panel = document.getElementById('admin-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'admin-panel';
      panel.style.cssText = 'margin:1rem 0; padding:1rem; border:1px solid var(--warning,#b45309); border-radius:8px; background:var(--surface);';
      document.querySelector('#register')?.insertAdjacentElement('beforebegin', panel);
    }

    if (isAuth) {
      panel.innerHTML = '<p style="color:var(--success,#16a34a)">✅ <strong>Admin:</strong> Relayer autorizado no Oracle.</p>';
    } else {
      panel.innerHTML = `
        <p style="color:var(--warning,#b45309)"><strong>⚠️ Admin:</strong> Relayer ainda não autorizado no Oracle.</p>
        <button id="btn-authorize-relayer" class="btn btn-primary" style="margin-top:0.5rem">🔐 Autorizar Relayer Agora</button>
        <span id="auth-status" style="margin-left:1rem; font-size:0.85rem;"></span>
      `;
      document.getElementById('btn-authorize-relayer')?.addEventListener('click', authorizeRelayer);
    }
  } catch (err) {
    console.warn('Admin check error:', err);
  }
}

async function authorizeRelayer() {
  const btn = document.getElementById('btn-authorize-relayer');
  const status = document.getElementById('auth-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Enviando transação...';

  try {
    const viem = window.viem;
    const provider = window.ethereum;
    if (!provider) throw new Error('Wallet não detectada');

    const walletClient = viem.createWalletClient({
      account: walletAddress,
      chain: { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name:'USDC', symbol:'USDC', decimals:6 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
      transport: viem.custom(provider),
    });

    const txHash = await walletClient.writeContract({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'setAuthorizedCaller',
      args: [RELAYER_ADDRESS, true],
    });

    if (status) status.textContent = `✅ TX enviada: ${txHash.slice(0,12)}... Aguarde confirmação.`;
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    await checkAdminPanel(); // re-renderiza como autorizado
  } catch (err) {
    if (status) status.textContent = `❌ ${err.shortMessage || err.message}`;
    if (btn) btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Read contract data
 * ═══════════════════════════════════════════════════════════════ */

async function refreshAll() {
  await Promise.all([
    loadUsdcBalance(),
    loadContributorStats(),
    loadTreasuryBalance(),
    loadLocationCount(),
    checkVerifierStatus(),
    loadRewardHistory(),
    loadMapMarkers(),
  ]);
}

async function loadUsdcBalance() {
  try {
    const viem = window.viem;
    const balance = await publicClient.readContract({
      address: cfg.tokens.USDC.address,
      abi: cfg.abis.ERC20,
      functionName: 'balanceOf',
      args: [walletAddress],
    });
    const el = document.getElementById('stat-usdc-balance');
    if (el) el.textContent = formatUsdc(balance);
    const balEl = document.getElementById('wallet-balance');
    if (balEl) balEl.textContent = `${formatUsdc(balance)} USDC`;
  } catch (err) {
    console.error('USDC balance error:', err);
  }
}

async function loadContributorStats() {
  try {
    const result = await publicClient.readContract({
      address: cfg.contracts.RewardDistributor,
      abi: cfg.abis.RewardDistributor,
      functionName: 'getContributorStats',
      args: [walletAddress],
    });

    // getContributorStats retorna 3 valores (earned, contributions,
    // verifications) — não existe lastRewardAt no contrato. Desestruturar
    // um 4º valor não quebra em JS (fica undefined), mas é enganoso: nada
    // no contrato rastreia "última recompensa", então esse campo nunca
    // existiu de verdade.
    const [totalEarned, contributions, verifications] = result;

    const elEarned = document.getElementById('stat-total-earned');
    const elContrib = document.getElementById('stat-contributions');
    const elVerify = document.getElementById('stat-verifications');
    if (elEarned) elEarned.textContent = formatUsdc(totalEarned);
    if (elContrib) elContrib.textContent = String(contributions);
    if (elVerify) elVerify.textContent = String(verifications);
  } catch (err) {
    console.error('Contributor stats error:', err);
    // Show zeros if contract not deployed yet
    const elEarned = document.getElementById('stat-total-earned');
    const elContrib = document.getElementById('stat-contributions');
    const elVerify = document.getElementById('stat-verifications');
    if (elEarned) elEarned.textContent = '0.00';
    if (elContrib) elContrib.textContent = '0';
    if (elVerify) elVerify.textContent = '0';
  }
}

async function loadTreasuryBalance() {
  try {
    const balance = await publicClient.readContract({
      address: cfg.contracts.RewardDistributor,
      abi: cfg.abis.RewardDistributor,
      functionName: 'treasuryBalance',
    });
    const el = document.getElementById('stat-treasury');
    if (el) el.textContent = formatUsdc(balance);
  } catch (err) {
    console.error('Treasury balance error:', err);
    const el = document.getElementById('stat-treasury');
    if (el) el.textContent = '0.00';
  }
}

async function loadLocationCount() {
  try {
    const count = await publicClient.readContract({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'locationCount',
    });
    const el = document.getElementById('stat-locations');
    if (el) el.textContent = String(count);
  } catch (err) {
    console.error('Location count error:', err);
    const el = document.getElementById('stat-locations');
    if (el) el.textContent = '0';
  }
}

async function checkVerifierStatus() {
  try {
    // Quem verifica DE FATO on-chain é a conta derivada no backend
    // (verifierAccount em api/_stepless.js) — nunca a carteira do navegador.
    // Portanto checar só `verifiers[walletAddress]` trancava justamente o
    // admin, que é quem tem o segredo para aprovar. A proteção real é o
    // X-Admin-Secret exigido pelo /api/verify no servidor; esta checagem
    // aqui é só para não exibir o painel a um visitante qualquer.
    const [isVerifier, adminAddr] = await Promise.all([
      publicClient.readContract({
        address: cfg.contracts.RewardDistributor,
        abi: cfg.abis.RewardDistributor,
        functionName: 'verifiers',
        args: [walletAddress],
      }),
      publicClient.readContract({
        address: cfg.contracts.RewardDistributor,
        abi: cfg.abis.RewardDistributor,
        functionName: 'admin',
      }).catch(() => null),
    ]);

    const isAdmin = adminAddr && walletAddress &&
      String(adminAddr).toLowerCase() === String(walletAddress).toLowerCase();
    const canVerify = Boolean(isVerifier) || Boolean(isAdmin);

    const badge = document.getElementById('verifier-badge');
    const denied = document.getElementById('verify-access-denied');
    const content = document.getElementById('verify-content');

    denied?.classList.toggle('hidden', canVerify);
    content?.classList.toggle('hidden', !canVerify);
    badge?.classList.toggle('hidden', !canVerify);

    // Se não pode verificar, diz QUAL carteira precisa conectar — sem isso
    // a mensagem "você não é verificador" não ajuda em nada.
    if (!canVerify && adminAddr) {
      const hint = document.getElementById('verify-denied-hint');
      if (hint) {
        hint.textContent = `Conecte a carteira administradora: ${adminAddr}`;
        hint.hidden = false;
      }
    }

    if (canVerify) await loadPendingContributions();
  } catch (err) {
    console.error('Verifier check error:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Reward history — leitura direta do contrato (sem subgraph)
 * ═══════════════════════════════════════════════════════════════ */

async function loadRewardHistory() {
  const tbody = document.getElementById('rewards-table-body');
  if (!tbody) return;
  const strings = getStrings();
  tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Buscando na blockchain...</td></tr>`;
  try {
    const explorerBase = cfg.chain.blockExplorers.default.url;
    const count = Number(await publicClient.readContract({ address: cfg.contracts.SteplessOracle, abi: cfg.abis.SteplessOracle, functionName: 'locationCount' }));
    const total = Math.min(count, 50);
    const indices = Array.from({ length: total }, (_, n) => BigInt(count - 1 - n));
    const hashes = total ? await publicClient.multicall({ multicallAddress: cfg.contracts.Multicall3, allowFailure: false, contracts: indices.map(index => ({ address: cfg.contracts.SteplessOracle, abi: cfg.abis.SteplessOracle, functionName: 'allLocationHashes', args: [index] })) }) : [];
    const locations = hashes.length ? await publicClient.multicall({ multicallAddress: cfg.contracts.Multicall3, allowFailure: false, contracts: hashes.map(locationHash => ({ address: cfg.contracts.SteplessOracle, abi: cfg.abis.SteplessOracle, functionName: 'getLocation', args: [locationHash] })) }) : [];
    const rows = [];
    for (let i = 0; i < hashes.length; i++) {
      const locationHash = hashes[i];
      const [, firstContributor, registeredBlock, verificationCount] = locations[i];
      if (firstContributor?.toLowerCase() !== walletAddress.toLowerCase()) continue;
      const addrUrl = `${explorerBase}/address/${cfg.contracts.SteplessOracle}`;
      const verBadge = Number(verificationCount) > 0 ? `<span class="badge badge-success">${verificationCount} verif.</span>` : `<span class="badge badge-info">Aguardando</span>`;
      rows.push(`<tr><td><a href="${addrUrl}" target="_blank" rel="noopener">${shortHash(locationHash)}</a></td><td>Bloco #${registeredBlock}</td><td>${verBadge}</td><td>${shortHash(locationHash)}</td><td>On-chain</td></tr>`);
    }
    tbody.innerHTML = rows.length ? rows.join('') : `<tr><td colspan="5" class="table-empty">${strings.rewards_empty || 'Nenhuma contribuicao registrada ainda.'}</td></tr>`;
  } catch (err) {
    console.error('Reward history error:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${err?.shortMessage || err?.message}</td></tr>`;
  }
}

function unpackLat(latPacked) { return Number(latPacked) / 1e6 - 90; }
function unpackLng(lngPacked) { return Number(lngPacked) / 1e6 - 180; }

function initLeafletMap() {
  if (leafletMap || !window.L) return leafletMap;
  const el = document.getElementById('leaflet-map');
  if (!el) return null;

  leafletMap = window.L.map(el, { scrollWheelZoom: false }).setView([-14.2, -51.9], 4); // centro do Brasil
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(leafletMap);
  leafletMarkersLayer = window.L.layerGroup().addTo(leafletMap);

  return leafletMap;
}

/* ───────────────────────────────────────────────────────────────
 *  Mapa interativo do formulário: clicar ou arrastar o marcador
 *  define a coordenada exata do local (equivalente ao Google Map do
 *  app Android). Alimenta os campos ocultos reg-lat / reg-lng.
 * ─────────────────────────────────────────────────────────────── */
function initRegPickerMap() {
  if (regPickerMap) { setTimeout(() => regPickerMap.invalidateSize(), 0); return regPickerMap; }
  if (!window.L) return null;
  const el = document.getElementById('reg-map');
  if (!el) return null;

  regPickerMap = window.L.map(el, { scrollWheelZoom: true }).setView([-14.2, -51.9], 4);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(regPickerMap);

  // Clique no mapa → posiciona/move o marcador e grava a coordenada.
  regPickerMap.on('click', (e) => setRegLocationFromMap(e.latlng.lat, e.latlng.lng, true));

  // Corrige o render quando o container estava oculto/tab trocada.
  setTimeout(() => regPickerMap.invalidateSize(), 200);
  return regPickerMap;
}

// Coloca/atualiza o marcador arrastável e grava lat/lng. Se geocode=true,
// resolve o nome do endereço (Nominatim) de forma assíncrona.
function setRegLocationFromMap(lat, lng, geocode) {
  if (!initRegPickerMap()) return;
  if (!regPickerMarker) {
    regPickerMarker = window.L.marker([lat, lng], { draggable: true }).addTo(regPickerMap);
    regPickerMarker.on('dragend', () => {
      const p = regPickerMarker.getLatLng();
      setRegLocationFromMap(p.lat, p.lng, true);
    });
  } else {
    regPickerMarker.setLatLng([lat, lng]);
  }
  // Grava os campos ocultos direto (não chama setDetectedLocation p/ evitar loop).
  document.getElementById('reg-lat').value = lat;
  document.getElementById('reg-lng').value = lng;
  const status = document.getElementById('reg-location-status');
  if (status) status.innerHTML = `<span style="color:var(--success)">✅ ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`;
  if (typeof estimateRegisterGas === 'function') estimateRegisterGas();
  checkDuplicateLocation(lat, lng);

  if (geocode) {
    reverseGeocode(lat, lng).then((label) => {
      if (status && label) status.innerHTML = `<span style="color:var(--success)">✅ ${label}</span>`;
    }).catch(() => {});
  }
}

// Move o mapa/marcador quando a coordenada vem do GPS ou da busca de endereço.
function syncRegPickerMap(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (!initRegPickerMap()) return;
  regPickerMap.setView([lat, lng], 17);
  if (!regPickerMarker) {
    regPickerMarker = window.L.marker([lat, lng], { draggable: true }).addTo(regPickerMap);
    regPickerMarker.on('dragend', () => {
      const p = regPickerMarker.getLatLng();
      setRegLocationFromMap(p.lat, p.lng, true);
    });
  } else {
    regPickerMarker.setLatLng([lat, lng]);
  }
  setTimeout(() => regPickerMap.invalidateSize(), 0);
}

function categoryLabel(id) {
  return cfg.locationCategories.find(c => c.id === Number(id))?.label?.[getLang()] || null;
}

function addMapMarker({ lat, lng, name, categories, contributor, txHash }) {
  if (!leafletMap || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const explorerBase = cfg.chain.blockExplorers.default.url;
  const cat = Array.isArray(categories) && categories.length ? categoryLabel(categories[0]) : null;
  const title = name || 'Local acessível';
  const popup = `
    <strong>📍 ${title}</strong><br/>
    ${cat ? `${cat}<br/>` : ''}
    <span style="color:var(--text-muted)">por ${shortAddr(contributor)}</span><br/>
    ${txHash ? `<a href="${explorerBase}/tx/${txHash}" target="_blank" rel="noopener">ver no ArcScan</a>` : ''}
  `;
  window.L.marker([lat, lng]).addTo(leafletMarkersLayer).bindPopup(popup);
}

async function loadMapMarkers(force = false) {
  if (!initLeafletMap()) return;
  if (mapMarkersLoaded && !force) return;
  leafletMarkersLayer.clearLayers();
  try {
    const count = Number(await publicClient.readContract({ address: cfg.contracts.SteplessOracle, abi: cfg.abis.SteplessOracle, functionName: 'locationCount' }));
    const total = Math.min(count, 100);
    const hashes = total ? await publicClient.multicall({ multicallAddress: cfg.contracts.Multicall3, allowFailure: false, contracts: Array.from({ length: total }, (_, index) => ({ address: cfg.contracts.SteplessOracle, abi: cfg.abis.SteplessOracle, functionName: 'allLocationHashes', args: [BigInt(index)] })) }) : [];
    const locations = hashes.length ? await publicClient.multicall({ multicallAddress: cfg.contracts.Multicall3, allowFailure: false, contracts: hashes.map(locationHash => ({ address: cfg.contracts.SteplessOracle, abi: cfg.abis.SteplessOracle, functionName: 'getLocation', args: [locationHash] })) }) : [];
    mapMarkersLoaded = true;
    const hint = document.getElementById('map-empty-hint');
    if (!hashes.length) { if (hint) hint.style.display = 'block'; return; }
    let metaMap = {};
    try {
      const response = await fetch('/api/location-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes }) });
      const data = await response.json();
      metaMap = data.meta || {};
    } catch (_) {}
    const points = [];
    for (let i = 0; i < hashes.length; i++) {
      const meta = metaMap[hashes[i].toLowerCase()] || {};
      const lat = Number(meta.lat), lng = Number(meta.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const [, contributor] = locations[i];
      addMapMarker({ lat, lng, name: meta.name, categories: meta.categories, contributor, txHash: null });
      points.push([lat, lng]);
    }
    if (hint) hint.style.display = points.length ? 'none' : 'block';
    if (points.length === 1) leafletMap.setView(points[0], 13);
    else if (points.length > 1) leafletMap.fitBounds(points, { padding: [30, 30] });
  } catch (err) {
    console.warn('[map] Falha ao carregar locais:', err?.shortMessage || err?.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Local único — um mesmo lugar não pode ser registrado duas vezes
 *
 *  O contrato já reverte com LocationAlreadyRegistered, mas o hash
 *  on-chain é keccak256(lat, lng, nome): coordenada com precisão de
 *  ~11cm e nome idêntico caractere a caractere. Ou seja, o MESMO
 *  monumento marcado 2 metros ao lado, ou escrito com outra grafia,
 *  gera outro hash e passaria. Por isso a checagem real de duplicata
 *  é por PROXIMIDADE, feita aqui antes do envio.
 * ═══════════════════════════════════════════════════════════════ */

const DUPLICATE_RADIUS_M = 50;

// Distância em metros entre duas coordenadas (Haversine).
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // raio médio da Terra, em metros
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Cache dos locais já registrados (hash → nome/lat/lng). Recarregado após
// cada registro bem-sucedido para não deixar o cache velho liberar duplicata.
let registeredLocationsCache = null;

async function loadRegisteredLocations(force = false) {
  if (registeredLocationsCache && !force) return registeredLocationsCache;
  try {
    const count = Number(await publicClient.readContract({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'locationCount',
    }));
    const total = Math.min(count, 500);
    if (!total) { registeredLocationsCache = []; return registeredLocationsCache; }

    const hashes = await publicClient.multicall({
      multicallAddress: cfg.contracts.Multicall3,
      allowFailure: false,
      contracts: Array.from({ length: total }, (_, i) => ({
        address: cfg.contracts.SteplessOracle,
        abi: cfg.abis.SteplessOracle,
        functionName: 'allLocationHashes',
        args: [BigInt(i)],
      })),
    });

    let metaMap = {};
    try {
      const r = await fetch('/api/location-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes }),
      });
      metaMap = (await r.json()).meta || {};
    } catch (_) { /* sem metadado → sem coordenada → não dá pra comparar */ }

    registeredLocationsCache = hashes.map((h) => {
      const m = metaMap[h.toLowerCase()] || {};
      const lat = Number(m.lat), lng = Number(m.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { hash: h, name: m.name || null, lat, lng };
    }).filter(Boolean);

    return registeredLocationsCache;
  } catch (err) {
    console.warn('[dup] Falha ao carregar locais registrados:', err?.shortMessage || err?.message);
    return null; // null = desconhecido (≠ lista vazia)
  }
}

// Retorna o local registrado mais próximo dentro do raio, ou null.
function findNearbyRegistered(lat, lng, list) {
  if (!Array.isArray(list)) return null;
  let best = null;
  for (const loc of list) {
    const d = haversineMeters(lat, lng, loc.lat, loc.lng);
    if (d <= DUPLICATE_RADIUS_M && (!best || d < best.distance)) {
      best = { ...loc, distance: d };
    }
  }
  return best;
}

// Trava/destrava o formulário inteiro. Além do CSS (que só some com o
// ponteiro), desabilita cada campo — senão dá para chegar neles pelo Tab.
function setRegisterBlocked(match) {
  const form = document.getElementById('register-form');
  const panel = document.getElementById('reg-blocked');
  const detail = document.getElementById('reg-blocked-detail');
  if (!form || !panel) return;

  const blocked = !!match;
  form.classList.toggle('is-blocked', blocked);
  panel.hidden = !blocked;
  form.setAttribute('aria-hidden', String(blocked));

  form.querySelectorAll('input, select, textarea, button').forEach((el) => {
    el.disabled = blocked;
  });

  if (blocked && detail) {
    const s = getStrings();
    const nome = match.name ? `“${match.name}”` : (s.reg_blocked_unnamed || 'um local já cadastrado');
    const tpl = s.reg_blocked_detail || 'Já existe {name} registrado a {dist} metros deste ponto.';
    detail.textContent = tpl
      .replace('{name}', nome)
      .replace('{dist}', String(Math.round(match.distance)));
  }
}

// Chamado sempre que a coordenada muda (GPS, busca ou mapa).
async function checkDuplicateLocation(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const list = await loadRegisteredLocations();
  if (list === null) { setRegisterBlocked(null); return; } // falha de rede: não trava à toa
  setRegisterBlocked(findNearbyRegistered(lat, lng, list));
}

async function handleRegisterLocation(e) {
  e.preventDefault();
  const s = getStrings();
  const submitBtn = document.getElementById('register-submit');
  const gasEl = document.getElementById('register-gas-estimate');

  const lat = parseFloat(document.getElementById('reg-lat').value);
  const lng = parseFloat(document.getElementById('reg-lng').value);
  const name = document.getElementById('reg-name').value.trim();
  // Multi-select: um local pode ter várias features (rampa + banheiro + vaga, etc.)
  const categories = Array.from(
    document.querySelectorAll('#reg-category-group input[name="category"]:checked')
  ).map(el => parseInt(el.value, 10));
  const otherDesc = document.getElementById('reg-other-desc')?.value.trim() || '';
  // When "Outro" (id=7) is selected and user filled the description, append it
  const fullName = (categories.includes(7) && otherDesc) ? `${name} — ${otherDesc}` : name;
  const photoInput = document.getElementById('reg-photo');

  if (isNaN(lat) || isNaN(lng)) {
    showAlert('register-alert', 'danger', s.reg_gps_error || 'Use o GPS ou busque um endereço primeiro.');
    return;
  }

  // Última barreira antes de gastar gas: revalida a duplicata com dados
  // frescos. Cobre o caso de outra pessoa ter registrado o mesmo ponto
  // enquanto este formulário estava aberto.
  {
    const freshList = await loadRegisteredLocations(true);
    const dup = findNearbyRegistered(lat, lng, freshList);
    if (dup) {
      setRegisterBlocked(dup);
      showAlert('register-alert', 'danger',
        `✗ ${s.reg_blocked_title || 'Este local já está registrado'}`);
      return;
    }
  }
  if (!name) {
    showAlert('register-alert', 'danger', s.reg_missing_name || 'Preencha o nome do local.');
    return;
  }
  if (categories.length === 0) {
    showAlert('register-alert', 'danger', s.reg_missing_category || 'Marque pelo menos uma categoria.');
    return;
  }
  if (!photoInput.files || photoInput.files.length === 0) {
    showAlert('register-alert', 'danger', s.reg_photo_no_gps || 'Foto obrigatória para verificar localização.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = s.loading || 'Loading...';

  try {
    const viem = window.viem;
    const photoFile = photoInput.files[0];

    // ── Extrai EXIF GPS da foto ──────────────────────────────────────────
    let exifLat = null, exifLng = null, exifTimestamp = null;
    if (window.exifr) {
      try {
        const exif = await window.exifr.gps(photoFile);
        if (exif) { exifLat = exif.latitude; exifLng = exif.longitude; }
        const tags = await window.exifr.parse(photoFile, ['DateTimeOriginal', 'CreateDate']);
        if (tags?.DateTimeOriginal) exifTimestamp = tags.DateTimeOriginal.toISOString();
        else if (tags?.CreateDate) exifTimestamp = tags.CreateDate.toISOString();
      } catch (_) { /* EXIF parse falhou silenciosamente — relay vai rejeitar sem GPS */ }
    }

    // Hash da foto
    const photoBuffer = await photoFile.arrayBuffer();
    const dataHash = viem.keccak256(new Uint8Array(photoBuffer));

    // lat/lng com offset para uint256 (contrato não aceita negativos)
    // lat: -90..+90  → offset +90  → 0..180  * 1e6
    // lng: -180..+180 → offset +180 → 0..360 * 1e6
    const latPacked = Math.round((lat + 90) * 1e6);
    const lngPacked = Math.round((lng + 180) * 1e6);

    // locationHash = keccak256(latPacked, lngPacked, fullName)
    const locationHash = viem.keccak256(
      viem.encodePacked(
        ['int256', 'int256', 'string'],
        [BigInt(latPacked), BigInt(lngPacked), fullName]
      )
    );

    // Chama o relayer — ele valida EXIF server-side e paga o gas
    const resp = await fetch('/api/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registerLocation',
        userAddress: walletAddress,
        submissionData: {
          locationHash, latPacked, lngPacked, dataHash,
          exifLat, exifLng, exifTimestamp,
          // Na web a coordenada só pode vir do EXIF do arquivo escolhido — não
          // há como o navegador atestar que a câmera tirou a foto agora. O
          // backend usa isto para pesar o risco: EXIF real vale mais que
          // ausência de EXIF, e ausência não é mais silenciosa.
          gpsSource: (exifLat != null && exifLng != null) ? 'exif' : null,
          name: fullName, categories,
        },
      }),
    });

    // O servidor pode devolver uma página de erro HTML (timeout/crash do Vercel)
    // em vez de JSON quando o RPC está muito lento — sem isso, o JSON.parse
    // quebra com "Unexpected token" e some a mensagem real do problema.
    let result;
    try {
      result = await resp.json();
    } catch (_) {
      throw new Error(
        resp.status === 429
          ? 'Servidor sobrecarregado (muitas requisições). Aguarde ~30s e tente de novo.'
          : `O servidor demorou demais para responder (RPC da Arc lento agora). Aguarde e tente de novo. [HTTP ${resp.status}]`
      );
    }

    if (!result.success) {
      throw new Error(result.error || 'Relayer error');
    }

    const pendingNote = result.contributionId
      ? ` · Contribuição ${shortHash(result.contributionId)} aguardando verificação para pagar a recompensa.`
      : '';
    showAlert('register-alert', 'success', `✓ ${s.success_registered || 'Local registrado!'} TX: ${shortHash(result.txHash)}${pendingNote}`);
    document.getElementById('register-form')?.reset();
    registeredLocationsCache = null; // força recarregar: este ponto agora está ocupado
    logEvent('LocationRegistered', `by ${shortAddr(walletAddress)}`);
    await refreshAll();

  } catch (err) {
    console.error('Register location error:', err);
    showAlert('register-alert', 'danger', `✗ ${handleArcError(err)}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = s.reg_submit || 'Registrar Local';
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Write: Verify Contribution
 * ═══════════════════════════════════════════════════════════════ */

async function handleVerify(approved, idFromTable) {
  const s = getStrings();
  const idInput = document.getElementById('verify-id');
  const contributionId = (idFromTable || idInput?.value || '').trim();

  if (!contributionId || !contributionId.startsWith('0x') || contributionId.length !== 66) {
    alert(s.err_tx_failed || 'Invalid contribution ID');
    return;
  }

  try {
    // Caminho normal: assina com a carteira conectada. O backend confere
    // no contrato se esse endereço é verificador autorizado.
    const auth = await signVerification(contributionId, approved);

    // Sem carteira que assine (ex.: dono operando de outro dispositivo),
    // cai no segredo administrativo como alternativa.
    let adminSecret = null;
    if (!auth) {
      adminSecret = requestAdminSecret();
      if (!adminSecret) return;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (adminSecret) headers['X-Admin-Secret'] = adminSecret;

    // Verificação + pagamento acontecem no backend (/api/verify):
    // a chave verificadora aprova on-chain e o relayer paga o USDC
    // direto para a wallet do contribuidor real.
    const resp = await fetch('/api/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contributionId,
        approve: approved,
        reason: approved ? '' : 'Rejeitado pelo verificador',
        ...(auth ? { auth } : {}),
      }),
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || 'Verify API error');

    const action = approved ? 'approved' : 'rejected';
    const paid = result.payTx ? ` 💸 USDC pago para ${shortAddr(result.paidTo)}` : '';
    showAlert('register-alert', 'success', `✓ ${s.success_verified || 'Contribution verified!'} (${action})${paid}`);
    logEvent('ContributionVerified', `${shortHash(contributionId)} ${action}${paid}`);
    if (idInput) idInput.value = '';
    await loadPendingContributions();
    await refreshAll();
  } catch (err) {
    console.error('Verify error:', err);
    alert(handleArcError(err));
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Pending contributions (via /api/pending)
 * ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
 *  Evidência para o verificador
 *
 *  A foto NUNCA é armazenada — só o keccak256 dela vai para a chain.
 *  Então o verificador não tem imagem para olhar. O que ele pode
 *  julgar é a coerência dos dados: o local existe naquela coordenada?
 *  a categoria faz sentido? o GPS da foto bateu com o ponto declarado?
 *  Estas funções expõem exatamente isso.
 * ═══════════════════════════════════════════════════════════════ */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderCategoryChips(categories) {
  if (!Array.isArray(categories) || !categories.length) return '';
  const chips = categories.map((id) => {
    const label = categoryLabel(id) || `#${id}`;
    return `<span class="evid-chip">${escapeHtml(label)}</span>`;
  }).join('');
  return `<div class="evid-chips">${chips}</div>`;
}

// Verdicts do cross-check com o OpenStreetMap (api/_placecheck.js) traduzidos
// para algo que o verificador entenda em um segundo de leitura.
const PLACE_VERDICT_UI = {
  type_match:        { icon: '✓', tone: 'is-ok',   label: 'Confirmado no OpenStreetMap' },
  name_match:        { icon: '✓', tone: 'is-ok',   label: 'Nome bate com o OpenStreetMap' },
  commercial_nearby: { icon: '•', tone: 'is-warn', label: 'Há comércio por perto' },
  type_mismatch:     { icon: '!', tone: 'is-bad',  label: 'Tipo declarado não existe aqui' },
  residential_only:  { icon: '!', tone: 'is-bad',  label: 'Área só residencial' },
  unmapped:          { icon: '?', tone: 'is-warn', label: 'Área não mapeada' },
  unknown:           { icon: '?', tone: 'is-warn', label: 'Checagem indisponível' },
};

const RISK_UI = {
  low:    { icon: '✓', label: 'Risco baixo' },
  medium: { icon: '•', label: 'Risco médio' },
  high:   { icon: '!', label: 'Risco alto' },
};

function renderEvidence(p) {
  const s = getStrings();
  const parts = [];

  // Score primeiro: é a leitura de um segundo. O detalhe fica logo abaixo,
  // para quem quiser conferir de onde saiu o número antes de aprovar.
  if (p.risk && RISK_UI[p.risk.level]) {
    const r = RISK_UI[p.risk.level];
    parts.push(
      `<div class="evid-line"><span class="evid-risk is-${p.risk.level}">` +
      `${r.icon} ${r.label} (${p.risk.score})</span></div>`
    );
    if (Array.isArray(p.risk.reasons) && p.risk.reasons.length) {
      const items = p.risk.reasons
        .map((x) => `<li>${escapeHtml(x.text)}${x.points > 0 ? ` <strong>+${x.points}</strong>` : ''}</li>`)
        .join('');
      parts.push(`<details class="evid-why"><summary>por quê</summary><ul>${items}</ul></details>`);
    }
  }

  // Coordenada + link para o mapa, para o verificador conferir onde é
  if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    const coord = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    const osm = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`;
    parts.push(
      `<div class="evid-line"><span class="evid-key">${s.evid_coord || 'Coordenada'}:</span> ` +
      `<a href="${osm}" target="_blank" rel="noopener" style="font-family:monospace;font-size:.78rem;">${coord}</a></div>`
    );
  } else {
    parts.push(`<div class="evid-line evid-warn">${s.evid_no_coord || 'Sem coordenada registrada'}</div>`);
  }

  // Resultado da checagem de GPS da foto
  const e = p.exif;
  if (e && e.hasGps && Number.isFinite(e.distKm)) {
    const m = Math.round(e.distKm * 1000);
    const ok = e.ok !== false;
    parts.push(
      `<div class="evid-line"><span class="evid-badge ${ok ? 'is-ok' : 'is-bad'}">` +
      `${ok ? '✓' : '!'} ${s.evid_gps || 'GPS da foto'}</span> ` +
      `<span class="evid-dim">${m} m ${s.evid_from_point || 'do ponto'}</span></div>`
    );
  } else if (e && !e.hasGps) {
    parts.push(`<div class="evid-line evid-warn">${s.evid_no_gps || 'Foto sem GPS — não foi possível conferir'}</div>`);
  }

  // Origem da coordenada: EXIF da câmera é prova bem mais forte que o GPS
  // lido pelo app, e o verificador precisa saber qual das duas está vendo.
  if (e && e.hasGps && e.gpsSource) {
    const strong = e.gpsSource === 'exif';
    parts.push(
      `<div class="evid-line evid-dim">${strong ? 'EXIF da câmera' : 'GPS do aparelho'}` +
      `${Number.isFinite(e.gpsAccuracyM) ? ` (±${Math.round(e.gpsAccuracyM)}m)` : ''}</div>`
    );
  }

  // Cross-check com o OpenStreetMap — a resposta para "isso é mesmo uma
  // padaria?", que o GPS sozinho nunca conseguiu dar.
  const pl = p.place;
  if (pl && PLACE_VERDICT_UI[pl.verdict]) {
    const v = PLACE_VERDICT_UI[pl.verdict];
    parts.push(
      `<div class="evid-line"><span class="evid-badge ${v.tone}">${v.icon} ${v.label}</span></div>` +
      `<div class="evid-line evid-dim">${escapeHtml(pl.reason || '')}</div>`
    );
    if (Array.isArray(pl.pois) && pl.pois.length) {
      const chips = pl.pois.slice(0, 5).map((poi) =>
        `<span class="evid-chip">${escapeHtml(poi.name || poi.type)}${Number.isFinite(poi.distM) ? ` · ${poi.distM}m` : ''}</span>`
      ).join('');
      parts.push(`<div class="evid-chips">${chips}</div>`);
    }
  }

  // Histórico da carteira no momento da submissão.
  const rep = p.reputationAtSubmit;
  if (rep && (rep.approved || rep.rejected || rep.submitted)) {
    parts.push(
      `<div class="evid-line evid-dim">Carteira: ${rep.approved || 0} aprovadas · ` +
      `${rep.rejected || 0} rejeitadas · ${rep.submitted || 0} enviadas</div>`
    );
  }

  // Data da foto
  if (e && e.photoTs) {
    const d = new Date(e.photoTs);
    if (!isNaN(d)) {
      parts.push(`<div class="evid-line evid-dim">${s.evid_photo_date || 'Foto de'} ${d.toLocaleDateString()}</div>`);
    }
  }

  parts.push(`<div class="evid-line evid-dim">⏳ ${s.verify_pending || 'pendente'}</div>`);
  return parts.join('');
}

async function loadPendingContributions() {
  const tbody = document.getElementById('verify-table-body');
  if (!tbody) return;
  const s = getStrings();
  try {
    const resp = await fetch('/api/pending');
    const { pending = [] } = await resp.json();

    if (pending.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${s.verify_empty || 'Nenhuma contribuição pendente'}</td></tr>`;
      return;
    }

    tbody.innerHTML = pending.map(p => `
      <tr>
        <td style="font-family:monospace;font-size:0.8rem;" title="${p.contributionId}">
          ${shortHash(p.contributionId)}
          ${p.name ? `<br><strong style="font-family:inherit;font-size:0.9rem;">${escapeHtml(p.name)}</strong>` : ''}
          ${renderCategoryChips(p.categories)}
        </td>
        <td style="font-family:monospace;font-size:0.8rem;">${shortAddr(p.user)}</td>
        <td>${p.rewardType || 'NewLocation'}</td>
        <td>${renderEvidence(p)}</td>
        <td>
          <button class="btn btn-success btn-sm" data-verify="${p.contributionId}" data-approve="1">✓</button>
          <button class="btn btn-danger btn-sm" data-verify="${p.contributionId}" data-approve="0">✗</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('button[data-verify]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.disabled = true;
        handleVerify(btn.dataset.approve === '1', btn.dataset.verify).finally(() => { btn.disabled = false; });
      });
    });
  } catch (err) {
    console.warn('Pending list error:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  WebSocket event subscriptions
 * ═══════════════════════════════════════════════════════════════ */

function startWebSocketSubscriptions(viem) {
  // Update WS status indicator
  const dot = document.getElementById('ws-status-dot');
  if (dot) {
    dot.classList.remove('connecting', 'disconnected');
    dot.classList.add('connected');
  }

  try {
    // Subscribe to RewardPaid events
    // Nomes reais do evento (RewardDistributor.sol): `recipient` e
    // `rewardType` — não `contributor`/`tier`. Com a ABI antiga (errada)
    // isso lia undefined silenciosamente; com a ABI corrigida os nomes
    // batem com o que o contrato de fato emite.
    const unwatchReward = publicClient.watchContractEvent({
      address: cfg.contracts.RewardDistributor,
      abi: cfg.abis.RewardDistributor,
      eventName: 'RewardPaid',
      onLogs: (logs) => {
        logs.forEach(log => {
          const isMine = log.args.recipient?.toLowerCase() === walletAddress?.toLowerCase();
          const amount = formatUsdc(log.args.amount);
          const rewardType = log.args.rewardType;
          logEvent('RewardPaid', `${amount} USDC → ${shortAddr(log.args.recipient)} (T${rewardType})${isMine ? ' ← YOU' : ''}`);
          if (isMine) {
            refreshAll();
          }
        });
      },
    });
    activeUnwatch.push(unwatchReward);

    // Subscribe to LocationRegistered events
    // Nome real do campo (SteplessOracle.sol) é `locationHash`, não
    // `locationId` — a ABI antiga inventava esse nome e o valor lido aqui
    // sempre foi undefined (a busca de meta abaixo silenciosamente não
    // encontrava nada, e o mapa nunca recebia name/categories corretos).
    const unwatchLocation = publicClient.watchContractEvent({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      eventName: 'LocationRegistered',
      onLogs: (logs) => {
        logs.forEach(async (log) => {
          const isMine = log.args.contributor?.toLowerCase() === walletAddress?.toLowerCase();
          const locationHash = log.args.locationHash;

          // Busca nome salvo fora da chain pra esse local específico (best-effort)
          let name = null, categories = [];
          try {
            const r = await fetch('/api/location-meta', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hashes: [locationHash] }),
            });
            const meta = (await r.json()).meta?.[locationHash?.toLowerCase()];
            if (meta) { name = meta.name; categories = meta.categories; }
          } catch (_) {}

          logEvent('LocationRegistered', `"${name || 'Unknown'}" by ${shortAddr(log.args.contributor)}${isMine ? ' ← YOU' : ''}`);
          loadLocationCount();

          // Adiciona o marcador no mapa em tempo real, sem precisar recarregar a página
          if (leafletMap) {
            const hint = document.getElementById('map-empty-hint');
            if (hint) hint.style.display = 'none';
            addMapMarker({
              lat: unpackLat(log.args.latPacked),
              lng: unpackLng(log.args.lngPacked),
              name, categories,
              contributor: log.args.contributor,
              txHash: log.transactionHash,
            });
          }
        });
      },
    });
    activeUnwatch.push(unwatchLocation);

    // Subscribe to ContributionVerified events
    // ContributionVerified NÃO tem campo `approved` — o contrato só emite
    // esse evento no caminho de APROVAÇÃO; rejeição é um evento à parte
    // (ContributionRejected, com `reason`, sem booleano). O código antigo
    // lia log.args.approved (sempre undefined) e por isso classificava toda
    // aprovação como "rejected" no log ao vivo — nunca havia log correto de
    // aprovação, e rejeições de fato nunca apareciam (não existia watcher
    // para ContributionRejected).
    const unwatchVerified = publicClient.watchContractEvent({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      eventName: 'ContributionVerified',
      onLogs: (logs) => {
        logs.forEach(log => {
          logEvent('ContributionVerified', `${shortHash(log.args.contributionId)} approved by ${shortAddr(log.args.verifier)}`);
        });
      },
    });
    activeUnwatch.push(unwatchVerified);

    // Subscribe to ContributionRejected events (antes ausente — rejeições
    // nunca apareciam no log ao vivo do dashboard).
    const unwatchRejected = publicClient.watchContractEvent({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      eventName: 'ContributionRejected',
      onLogs: (logs) => {
        logs.forEach(log => {
          logEvent('ContributionRejected', `${shortHash(log.args.contributionId)} rejected by ${shortAddr(log.args.verifier)} — ${escapeHtml(log.args.reason || '')}`);
        });
      },
    });
    activeUnwatch.push(unwatchRejected);

    logEvent('WebSocket', 'Connected to Arc Testnet events');
  } catch (err) {
    console.error('WebSocket subscription error:', err);
    if (dot) {
      dot.classList.remove('connected', 'connecting');
      dot.classList.add('disconnected');
    }
    logEvent('WebSocket', 'Connection failed — using polling fallback');

    // Fallback: poll every 15 seconds
    setInterval(() => {
      if (isConnected) refreshAll();
    }, 15000);
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Gas estimation for register form
 * ═══════════════════════════════════════════════════════════════ */

async function estimateRegisterGas() {
  const lat = parseFloat(document.getElementById('reg-lat')?.value);
  const lng = parseFloat(document.getElementById('reg-lng')?.value);
  const name = document.getElementById('reg-name')?.value.trim();
  const categories = Array.from(
    document.querySelectorAll('#reg-category-group input[name="category"]:checked')
  ).map(el => parseInt(el.value, 10));
  const gasEl = document.getElementById('register-gas-estimate');

  if (isNaN(lat) || isNaN(lng) || !name || categories.length === 0 || !publicClient) return;

  try {
    const viem = window.viem;
    // registerLocation real: (locationHash, latPacked, lngPacked, dataHash,
    // contributor) — não (lat, lng, name, category, photoHash). O cálculo do
    // locationHash espelha handleRegisterLocation() para a estimativa usar o
    // mesmo hash que a transação real usaria (mesmo offset +90/+180 e mesmo
    // encodePacked), só com um dataHash fictício já que a foto pode ainda
    // não ter sido escolhida neste ponto do formulário.
    const latPacked = BigInt(Math.round((lat + 90) * 1e6));
    const lngPacked = BigInt(Math.round((lng + 180) * 1e6));
    const dummyHash = viem.keccak256('0x00');
    const locationHash = viem.keccak256(
      viem.encodePacked(['int256', 'int256', 'string'], [latPacked, lngPacked, name])
    );

    const gasEstimate = await publicClient.estimateContractGas({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'registerLocation',
      args: [locationHash, latPacked, lngPacked, dummyHash, walletAddress],
      account: walletAddress,
    });

    const gasPrice = await publicClient.getGasPrice();
    const gasCostUsdc = (gasEstimate * gasPrice) / 10n ** 6n;
    const s = getStrings();
    if (gasEl) gasEl.textContent = `${s.gas_estimate || 'Estimated gas: '}${formatUsdc(gasCostUsdc)} USDC`;
  } catch (err) {
    // Silent fail — gas estimate is optional
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Init
 * ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
 *  GPS + address search helpers
 * ═══════════════════════════════════════════════════════════════ */

function setDetectedLocation(lat, lng, label) {
  document.getElementById('reg-lat').value = lat;
  document.getElementById('reg-lng').value = lng;
  const status = document.getElementById('reg-location-status');
  const s = getStrings();
  if (status) status.innerHTML = `<span style="color:var(--success)">✅ ${label}</span>`;
  syncRegPickerMap(parseFloat(lat), parseFloat(lng)); // move o marcador no mapa interativo
  estimateRegisterGas();
  checkDuplicateLocation(parseFloat(lat), parseFloat(lng));
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&accept-language=pt`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Stepless-dApp/1.0' } });
    const data = await r.json();
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

async function geocodeAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=pt`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Stepless-dApp/1.0' } });
  const data = await r.json();
  if (!data.length) throw new Error('Endereço não encontrado');
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
}

function initEventListeners() {
  // Register form
  const regForm = document.getElementById('register-form');
  if (regForm) {
    regForm.addEventListener('submit', handleRegisterLocation);
    // Inicializa o mapa interativo de marcação (tenta de novo se o Leaflet
    // do CDN ainda não carregou).
    if (!initRegPickerMap()) {
      let tries = 0;
      const t = setInterval(() => {
        if (initRegPickerMap() || ++tries > 20) clearInterval(t);
      }, 300);
    }
  }

  // GPS button
  const btnGps = document.getElementById('btn-gps');
  if (btnGps) {
    btnGps.addEventListener('click', async () => {
      const status = document.getElementById('reg-location-status');
      const s = getStrings();
      if (status) status.textContent = s.reg_gps_detecting || 'Detectando localização...';
      btnGps.disabled = true;
      if (!navigator.geolocation) {
        if (status) status.textContent = s.reg_gps_error || 'GPS não disponível neste dispositivo.';
        btnGps.disabled = false;
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          const label = await reverseGeocode(lat, lng);
          setDetectedLocation(lat, lng, label);
          btnGps.disabled = false;
        },
        () => {
          if (status) status.textContent = s.reg_gps_error || 'Não foi possível obter localização.';
          btnGps.disabled = false;
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  }

  // Address search button + Enter key
  const btnSearch = document.getElementById('btn-address-search');
  const addrInput = document.getElementById('reg-address-search');
  async function doAddressSearch() {
    const query = addrInput?.value.trim();
    if (!query) return;
    const status = document.getElementById('reg-location-status');
    const s = getStrings();
    if (status) status.textContent = 'Buscando...';
    try {
      const { lat, lng, label } = await geocodeAddress(query);
      setDetectedLocation(lat, lng, label);
    } catch (err) {
      if (status) status.textContent = s.reg_gps_error || 'Endereço não encontrado.';
    }
  }
  if (btnSearch) btnSearch.addEventListener('click', doAddressSearch);
  if (addrInput) addrInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddressSearch(); } });

  // Gas estimate on name/category change
  const regNameEl = document.getElementById('reg-name');
  if (regNameEl) regNameEl.addEventListener('change', estimateRegisterGas);
  const regCatGroup = document.getElementById('reg-category-group');
  if (regCatGroup) regCatGroup.addEventListener('change', estimateRegisterGas);

  // EXIF GPS feedback ao selecionar foto
  const photoInput = document.getElementById('reg-photo');
  if (photoInput) {
    photoInput.addEventListener('change', async () => {
      const statusEl = document.getElementById('reg-photo-status');
      const file = photoInput.files?.[0];
      if (!file || !statusEl) return;

      const s = getStrings();
      statusEl.textContent = s.reg_photo_checking || '🔍 Verificando GPS da foto...';
      statusEl.style.color = 'var(--text-muted)';

      if (!window.exifr) {
        statusEl.textContent = '';
        return;
      }

      try {
        const gps = await window.exifr.gps(file);
        const tags = await window.exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);

        if (!gps) {
          statusEl.style.color = 'var(--warning, #b45309)';
          statusEl.textContent = s.reg_photo_no_gps || '⚠️ Foto sem GPS. Ative a localização na câmera.';
          return;
        }

        // Verifica idade
        const dateTag = tags?.DateTimeOriginal || tags?.CreateDate;
        if (dateTag) {
          const ageDays = (Date.now() - new Date(dateTag).getTime()) / 86400000;
          if (ageDays > 7) {
            statusEl.style.color = 'var(--danger, #dc2626)';
            statusEl.textContent = (s.reg_photo_old || '❌ Foto muito antiga ({days} dias).').replace('{days}', Math.round(ageDays));
            return;
          }
        }

        // Verifica distância
        const lat = parseFloat(document.getElementById('reg-lat').value);
        const lng = parseFloat(document.getElementById('reg-lng').value);
        if (!isNaN(lat) && !isNaN(lng)) {
          const R = 6371000;
          const dLat = (gps.latitude - lat) * Math.PI / 180;
          const dLng = (gps.longitude - lng) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180) * Math.cos(gps.latitude*Math.PI/180) * Math.sin(dLng/2)**2;
          const distM = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

          if (distM > 500) {
            statusEl.style.color = 'var(--danger, #dc2626)';
            statusEl.textContent = (s.reg_photo_far || '❌ Foto a {dist}km do local.').replace('{dist}', (distM/1000).toFixed(1));
          } else {
            statusEl.style.color = 'var(--success, #16a34a)';
            statusEl.textContent = (s.reg_photo_ok || '✅ GPS verificado — {dist}m do local.').replace('{dist}', Math.round(distM));
          }
        } else {
          statusEl.style.color = 'var(--success, #16a34a)';
          statusEl.textContent = `✅ GPS detectado: ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
        }
      } catch (_) {
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = '';
      }
    });
  }

  // Verify buttons
  const verifyApprove = document.getElementById('verify-approve');
  const verifyReject = document.getElementById('verify-reject');
  if (verifyApprove) verifyApprove.addEventListener('click', (e) => { e.preventDefault(); handleVerify(true); });
  if (verifyReject) verifyReject.addEventListener('click', (e) => { e.preventDefault(); handleVerify(false); });

  // Dynamic cuida de mudanças de conta via onWalletChange (registrado no connect())
}

/* ═══════════════════════════════════════════════════════════════
 *  Export to window
 * ═══════════════════════════════════════════════════════════════ */

window.SteplessDashboard = {
  connect,
  disconnect,
  refreshAll,
  loadUsdcBalance,
  loadContributorStats,
  loadTreasuryBalance,
  loadLocationCount,
  loadRewardHistory,
  handleRegisterLocation,
  handleVerify,
};

/* ═══════════════════════════════════════════════════════════════
 *  Auto-connect — reconecta silenciosamente se wallet já aprovada
 * ═══════════════════════════════════════════════════════════════ */

async function tryAutoConnect() {
  if (localStorage.getItem(WALLET_DISCONNECT_KEY) === '1') return;

  // 1) MetaMask/window.ethereum — reconecta silenciosamente se já aprovado.
  if (window.ethereum) {
    try {
      // eth_accounts não abre prompt — só retorna se já aprovado
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        const viem = await loadViem();
        const address = viem.getAddress(accounts[0]);
        await _completeConnection(address, window.ethereum);

        // Reage a logout/troca de conta
        window.ethereum.on?.('accountsChanged', accs => {
          if (!accs || accs.length === 0) location.reload();
          else if (accs[0].toLowerCase() !== walletAddress.toLowerCase()) location.reload();
        });

        console.log('[autoConnect] Reconectado via MetaMask:', walletAddress);
        return;
      }
    } catch (err) {
      console.log('[autoConnect] MetaMask:', err.message);
    }
  }

  // 2) Dynamic (login por email) — restaura sessão salva sem pedir OTP de
  // novo. Espera initDynamic() terminar de carregar a sessão do storage.
  try {
    await _dynamicInitPromise;
    const restored = await _dynamicRestore();
    if (!restored) return;

    onWalletChange(({ isConnected: ic }) => {
      if (!ic && localStorage.getItem(WALLET_DISCONNECT_KEY) !== '1') location.reload();
    });

    await _completeConnection(restored.address, restored.provider);
    console.log('[autoConnect] Sessão restaurada via Dynamic:', walletAddress);
  } catch (err) {
    // Falha silenciosa — usuário conecta manualmente
    console.log('[autoConnect]', err.message);
  }
}

// Initialize event listeners on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initEventListeners(); tryAutoConnect(); });
} else {
  initEventListeners();
  tryAutoConnect();
}

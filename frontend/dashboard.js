/**
 * Stepless Dashboard Logic
 * Viem client for Arc Testnet — read/write contracts, WebSocket events,
 * USDC balance, gas estimation in USDC, multilingual error handling.
 *
 * Loaded as ES module in dashboard.html.
 */

import { SteplessConfig } from './arc-config.js';
import { initDynamic, connectWallet as _dynamicConnect, disconnectWallet, onWalletChange, getProvider } from './dynamic-wallet.js';

// Inicializa Dynamic em background
initDynamic();

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
    walletAddress = address;

    // ── Cria clientes Viem usando o provider retornado pelo Dynamic ────
    const viem = await loadViem();

    publicClient = viem.createPublicClient({
      chain: cfg.chain,
      transport: viem.http(),
    });

    walletClient = viem.createWalletClient({
      account: walletAddress,
      chain: cfg.chain,
      transport: viem.custom(provider),
    });

    isConnected = true;

    // Reage a logout/troca de conta do Dynamic
    onWalletChange(({ isConnected: ic }) => {
      if (!ic) location.reload();
    });

    // ── Update UI ──────────────────────────────────────────────────────
    document.getElementById('not-connected')?.classList.add('hidden');
    document.getElementById('dashboard-content')?.classList.remove('hidden');

    if (btn) btn.style.display = 'none';
    const info = document.getElementById('wallet-info');
    if (info) info.classList.add('connected');
    document.getElementById('wallet-address').textContent = shortAddr(walletAddress);

    // Carrega dados e inicia subscriptions
    await refreshAll();
    startWebSocketSubscriptions(viem);

  } catch (err) {
    console.error('Connection failed:', err);
    alert(handleArcError(err));
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
    if (btnLarge) { btnLarge.textContent = originalText; btnLarge.disabled = false; }
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

    const [totalEarned, contributions, verifications, lastRewardAt] = result;

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
    const isVerifier = await publicClient.readContract({
      address: cfg.contracts.RewardDistributor,
      abi: cfg.abis.RewardDistributor,
      functionName: 'verifiers',
      args: [walletAddress],
    });

    const badge = document.getElementById('verifier-badge');
    const denied = document.getElementById('verify-access-denied');
    const content = document.getElementById('verify-content');

    if (isVerifier) {
      badge?.classList.remove('hidden');
      denied?.classList.add('hidden');
      content?.classList.remove('hidden');
    } else {
      badge?.classList.add('hidden');
      denied?.classList.remove('hidden');
      content?.classList.add('hidden');
    }
  } catch (err) {
    console.error('Verifier check error:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Reward history (Goldsky subgraph)
 * ═══════════════════════════════════════════════════════════════ */

async function loadRewardHistory() {
  const tbody = document.getElementById('rewards-table-body');
  if (!tbody) return;
  const s = getStrings();

  const query = `
    query RewardPaidEvents($contributor: Bytes!) {
      rewardPaidEvents(
        where: { contributor: $contributor }
        orderBy: blockTimestamp
        orderDirection: desc
        first: 20
      ) {
        id
        contributionId
        contributor
        amount
        tier
        blockTimestamp
        transactionHash
      }
    }
  `;

  // Subgraph ainda não deployado — mostra mensagem amigável
  if (!cfg.subgraphEndpoint || cfg.subgraphEndpoint.includes('YOUR_') || cfg.subgraphEndpoint.includes('stepless/v1.0')) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${s.rewards_empty || 'Subgraph em configuração. Histórico disponível em breve.'}</td></tr>`;
    return;
  }

  try {
    const resp = await fetch(cfg.subgraphEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { contributor: walletAddress },
      }),
    });

    if (!resp.ok) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${s.rewards_empty || 'Histórico indisponível no momento.'}</td></tr>`;
      return;
    }

    const json = await resp.json();

    if (json.errors) {
      throw new Error(json.errors[0]?.message || 'Subgraph error');
    }

    const events = json.data?.rewardPaidEvents || [];

    if (events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${s.rewards_empty || 'No rewards yet'}</td></tr>`;
      return;
    }

    tbody.innerHTML = events.map(e => {
      const tierLabel = cfg.rewardTiers.find(t => t.tier === Number(e.tier))?.label || `T${e.tier}`;
      const date = new Date(Number(e.blockTimestamp) * 1000).toLocaleString(
        getLang() === 'pt' ? 'pt-BR' : getLang()
      );
      const txUrl = `${cfg.chain.blockExplorers.default.url}/tx/${e.transactionHash}`;
      return `
        <tr>
          <td><a href="${txUrl}" target="_blank" rel="noopener">${shortHash(e.transactionHash)}</a></td>
          <td><span class="reward-amount">${formatUsdc(e.amount)}</span></td>
          <td><span class="badge badge-info">${tierLabel}</span></td>
          <td style="font-family:monospace; font-size:0.85rem;">${shortHash(e.contributionId)}</td>
          <td>${date}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Reward history error:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${s.rewards_empty || 'Unable to load rewards'}</td></tr>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Write: Register Location
 * ═══════════════════════════════════════════════════════════════ */

async function handleRegisterLocation(e) {
  e.preventDefault();
  const s = getStrings();
  const submitBtn = document.getElementById('register-submit');
  const gasEl = document.getElementById('register-gas-estimate');

  const lat = parseFloat(document.getElementById('reg-lat').value);
  const lng = parseFloat(document.getElementById('reg-lng').value);
  const name = document.getElementById('reg-name').value.trim();
  const category = parseInt(document.getElementById('reg-category').value, 10);
  const photoInput = document.getElementById('reg-photo');

  if (isNaN(lat) || isNaN(lng)) {
    showAlert('register-alert', 'danger', s.reg_gps_error || 'Use o GPS ou busque um endereço primeiro.');
    return;
  }
  if (!name || isNaN(category)) {
    showAlert('register-alert', 'danger', s.err_tx_failed || 'Preencha todos os campos.');
    return;
  }

  if (!photoInput.files || photoInput.files.length === 0) {
    showAlert('register-alert', 'danger', s.err_tx_failed || 'Please select a photo');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = s.loading || 'Loading...';

  try {
    const viem = window.viem;

    // Hash do arquivo de foto → bytes32
    const photoFile = photoInput.files[0];
    const photoBuffer = await photoFile.arrayBuffer();
    const dataHash = viem.keccak256(new Uint8Array(photoBuffer));

    // lat/lng em inteiros (multiplicar por 1e6)
    const latPacked = Math.round(lat * 1e6);
    const lngPacked = Math.round(lng * 1e6);

    // locationHash = keccak256(latPacked, lngPacked, name)
    const locationHash = viem.keccak256(
      viem.encodePacked(
        ['int256', 'int256', 'string'],
        [BigInt(latPacked), BigInt(lngPacked), name]
      )
    );

    // Chama o relayer — ele é authorized no Oracle e paga o gas
    const resp = await fetch('/api/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registerLocation',
        userAddress: walletAddress,
        submissionData: { locationHash, latPacked, lngPacked, dataHash },
      }),
    });

    const result = await resp.json();

    if (!result.success) {
      throw new Error(result.error || 'Relayer error');
    }

    showAlert('register-alert', 'success', `✓ ${s.success_registered || 'Local registrado!'} TX: ${shortHash(result.txHash)}`);
    document.getElementById('register-form')?.reset();
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

async function handleVerify(approved) {
  const s = getStrings();
  const idInput = document.getElementById('verify-id');
  const contributionId = idInput.value.trim();

  if (!contributionId || !contributionId.startsWith('0x') || contributionId.length !== 66) {
    alert(s.err_tx_failed || 'Invalid contribution ID');
    return;
  }

  try {
    const txHash = await walletClient.writeContract({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'verifyContribution',
      args: [contributionId, approved],
      account: walletAddress,
      chain: cfg.chain,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === 'success') {
      const action = approved ? 'approved' : 'rejected';
      showAlert('register-alert', 'success', `✓ ${s.success_verified || 'Contribution verified!'} (${action})`);
      logEvent('ContributionVerified', `${shortHash(contributionId)} ${action} by ${shortAddr(walletAddress)}`);
      idInput.value = '';
      await refreshAll();
    } else {
      throw new Error('Transaction reverted');
    }
  } catch (err) {
    console.error('Verify error:', err);
    alert(handleArcError(err));
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
    const unwatchReward = publicClient.watchContractEvent({
      address: cfg.contracts.RewardDistributor,
      abi: cfg.abis.RewardDistributor,
      eventName: 'RewardPaid',
      onLogs: (logs) => {
        logs.forEach(log => {
          const isMine = log.args.contributor?.toLowerCase() === walletAddress?.toLowerCase();
          const amount = formatUsdc(log.args.amount);
          const tier = log.args.tier;
          logEvent('RewardPaid', `${amount} USDC → ${shortAddr(log.args.contributor)} (T${tier})${isMine ? ' ← YOU' : ''}`);
          if (isMine) {
            refreshAll();
          }
        });
      },
    });
    activeUnwatch.push(unwatchReward);

    // Subscribe to LocationRegistered events
    const unwatchLocation = publicClient.watchContractEvent({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      eventName: 'LocationRegistered',
      onLogs: (logs) => {
        logs.forEach(log => {
          const name = log.args.name || 'Unknown';
          const isMine = log.args.contributor?.toLowerCase() === walletAddress?.toLowerCase();
          logEvent('LocationRegistered', `"${name}" by ${shortAddr(log.args.contributor)}${isMine ? ' ← YOU' : ''}`);
          loadLocationCount();
        });
      },
    });
    activeUnwatch.push(unwatchLocation);

    // Subscribe to ContributionVerified events
    const unwatchVerified = publicClient.watchContractEvent({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      eventName: 'ContributionVerified',
      onLogs: (logs) => {
        logs.forEach(log => {
          const status = log.args.approved ? 'approved' : 'rejected';
          logEvent('ContributionVerified', `${shortHash(log.args.contributionId)} ${status} by ${shortAddr(log.args.verifier)}`);
        });
      },
    });
    activeUnwatch.push(unwatchVerified);

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
  const category = parseInt(document.getElementById('reg-category')?.value, 10);
  const gasEl = document.getElementById('register-gas-estimate');

  if (isNaN(lat) || isNaN(lng) || !name || isNaN(category) || !publicClient) return;

  try {
    const viem = window.viem;
    const latInt = BigInt(Math.round(lat * 1e6));
    const lngInt = BigInt(Math.round(lng * 1e6));
    const dummyHash = viem.keccak256('0x00');

    const gasEstimate = await publicClient.estimateContractGas({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'registerLocation',
      args: [latInt, lngInt, name, category, dummyHash],
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
  estimateRegisterGas();
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
  ['reg-name', 'reg-category'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', estimateRegisterGas);
  });

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
  refreshAll,
  loadUsdcBalance,
  loadContributorStats,
  loadTreasuryBalance,
  loadLocationCount,
  loadRewardHistory,
  handleRegisterLocation,
  handleVerify,
};

// Initialize event listeners on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEventListeners);
} else {
  initEventListeners();
}
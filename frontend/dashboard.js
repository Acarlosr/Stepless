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
    await checkRelayerSetup();
    await checkAdminPanel();
    startWebSocketSubscriptions(viem);

  } catch (err) {
    console.error('Connection failed:', err);
    alert(handleArcError(err));
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
    if (btnLarge) { btnLarge.textContent = originalText; btnLarge.disabled = false; }
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  Admin panel — autorizar relayer (só aparece para o admin)
 * ═══════════════════════════════════════════════════════════════ */

const RELAYER_ADDRESS = '0xDEA4841D45F44deC58eB246Ac985693cc562aEc5';

// Verifica se relayer está autorizado e mostra banner de setup se não estiver
async function checkRelayerSetup() {
  const panel = document.getElementById('admin-setup-panel');
  if (!panel) return;
  try {
    const resp = await fetch('/api/setup');
    if (!resp.ok) { panel.style.display = 'block'; return; }
    const data = await resp.json();
    panel.style.display = data.isAuthorized ? 'none' : 'block';
  } catch (_) {
    panel.style.display = 'block'; // mostra se não conseguir verificar
  }
}

// Botão de autorizar relayer (chama /api/setup POST)
window.setupRelayer = async function() {
  const btn = document.getElementById('btn-setup-relay');
  const status = document.getElementById('setup-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Autorizando...';
  try {
    const resp = await fetch('/api/setup', { method: 'POST' });
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

    // A verificação on-chain agora é feita pela chave verificadora do backend
    // (/api/verify) — o painel fica visível para qualquer wallet conectada.
    // O badge continua indicando se a wallet conectada é verificadora on-chain.
    denied?.classList.add('hidden');
    content?.classList.remove('hidden');
    if (isVerifier) badge?.classList.remove('hidden');
    else badge?.classList.add('hidden');
    await loadPendingContributions();
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
  const s = getStrings();

  tbody.innerHTML = `<tr><td colspan="5" class="table-empty">⏳ Buscando na blockchain...</td></tr>`;

  try {
    const rows = [];
    const explorerBase = cfg.chain.blockExplorers.default.url;

    // ── 1. Tenta getLogs (últimos 2000 blocos — range pequeno, mais provável de funcionar) ──
    let usedLogs = false;
    try {
      const latestBlock = await publicClient.getBlockNumber();
      const fromBlock = latestBlock > 2000n ? latestBlock - 2000n : 0n;

      const [locationLogs, rewardLogs] = await Promise.all([
        publicClient.getContractEvents({
          address: cfg.contracts.SteplessOracle,
          abi: cfg.abis.SteplessOracle,
          eventName: 'LocationRegistered',
          fromBlock,
          toBlock: 'latest',
        }),
        publicClient.getContractEvents({
          address: cfg.contracts.RewardDistributor,
          abi: cfg.abis.RewardDistributor,
          eventName: 'RewardPaid',
          fromBlock,
          toBlock: 'latest',
        }),
      ]);

      const myLocations = locationLogs.filter(
        l => l.args.contributor?.toLowerCase() === walletAddress.toLowerCase()
      );
      const myRewards = rewardLogs.filter(
        l => l.args.contributor?.toLowerCase() === walletAddress.toLowerCase()
      );

      const allLogs = [
        ...myLocations.map(l => ({ type: 'location', blockNumber: l.blockNumber, txHash: l.transactionHash, ...l.args })),
        ...myRewards.map(l => ({ type: 'reward', blockNumber: l.blockNumber, txHash: l.transactionHash, ...l.args })),
      ].sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));

      for (const ev of allLogs) {
        const txUrl = `${explorerBase}/tx/${ev.txHash}`;
        if (ev.type === 'location') {
          // Evento on-chain não emite name/category (só existem no getLocation) — mostra local genérico.
          rows.push(`<tr>
            <td><a href="${txUrl}" target="_blank" rel="noopener">${shortHash(ev.txHash)}</a></td>
            <td style="color:var(--text-muted)">—</td>
            <td><span class="badge badge-info">📍 Local</span></td>
            <td style="font-family:monospace;font-size:.85rem">${shortHash(ev.locationId)}</td>
            <td>#${ev.blockNumber}</td>
          </tr>`);
        } else {
          const tier = cfg.rewardTiers.find(t => t.tier === Number(ev.tier))?.label || `T${ev.tier}`;
          rows.push(`<tr>
            <td><a href="${txUrl}" target="_blank" rel="noopener">${shortHash(ev.txHash)}</a></td>
            <td><span class="reward-amount">${formatUsdc(ev.amount)} USDC</span></td>
            <td><span class="badge badge-success">💰 ${tier}</span></td>
            <td style="font-family:monospace;font-size:.85rem">${shortHash(ev.contributionId)}</td>
            <td>#${ev.blockNumber}</td>
          </tr>`);
        }
      }
      usedLogs = true;
    } catch (logsErr) {
      console.warn('[history] getLogs não suportado, usando leitura de estado:', logsErr?.message);
    }

    // ── 2. Fallback: leitura direta via locationCount + allLocationHashes + getLocation ──
    //    Usa apenas eth_call — sempre funciona em qualquer RPC EVM
    if (!usedLogs) {
      const count = await publicClient.readContract({
        address: cfg.contracts.SteplessOracle,
        abi: cfg.abis.SteplessOracle,
        functionName: 'locationCount',
      });

      const total = Number(count);
      // Checa os últimos 50 (ou todos se < 50)
      const start = Math.max(0, total - 50);

      // ABI mínima para o array público e getLocation real do contrato deployado
      const ARRAY_ABI = [
        { type:'function', name:'allLocationHashes',
          inputs:[{name:'',type:'uint256'}], outputs:[{type:'bytes32'}], stateMutability:'view' },
        { type:'function', name:'getLocation',
          inputs:[{name:'locationHash',type:'bytes32'}],
          outputs:[
            {name:'locationHash',      type:'bytes32'},
            {name:'firstContributor',  type:'address'},
            {name:'registeredBlock',   type:'uint256'},
            {name:'verificationCount', type:'uint256'},
            {name:'exists',            type:'bool'},
          ], stateMutability:'view' },
      ];

      for (let i = total - 1; i >= start; i--) {
        // allLocationHashes(uint256) — array público do Oracle
        const locationHash = await publicClient.readContract({
          address: cfg.contracts.SteplessOracle,
          abi: ARRAY_ABI,
          functionName: 'allLocationHashes',
          args: [BigInt(i)],
        });

        // getLocation tem múltiplos outputs — viem retorna como ARRAY:
        // [locationHash, firstContributor, registeredBlock, verificationCount, exists]
        const loc = await publicClient.readContract({
          address: cfg.contracts.SteplessOracle,
          abi: ARRAY_ABI,
          functionName: 'getLocation',
          args: [locationHash],
        });
        const [, firstContributor, registeredBlock, verificationCount] = loc;

        const contributor = firstContributor;
        if (contributor?.toLowerCase() !== walletAddress.toLowerCase()) continue;

        const addrUrl = `${explorerBase}/address/${cfg.contracts.SteplessOracle}`;
        const verBadge = Number(verificationCount) > 0
          ? `<span class="badge badge-success">✅ ${verificationCount} verif.</span>`
          : `<span class="badge badge-info">⏳ Aguardando</span>`;

        rows.push(`<tr>
          <td><a href="${addrUrl}" target="_blank" rel="noopener">${shortHash(locationHash)}</a></td>
          <td style="color:var(--text-muted)">Bloco #${registeredBlock}</td>
          <td>${verBadge}</td>
          <td style="font-family:monospace;font-size:.85rem">${shortHash(locationHash)}</td>
          <td>✅ On-chain</td>
        </tr>`);
      }
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${s.rewards_empty || 'Nenhuma contribuição registrada ainda.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.join('');

  } catch (err) {
    console.error('Reward history error:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">❌ ${err?.shortMessage || err?.message}</td></tr>`;
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
        submissionData: { locationHash, latPacked, lngPacked, dataHash, exifLat, exifLng, exifTimestamp, name: fullName, categories },
      }),
    });

    const result = await resp.json();

    if (!result.success) {
      throw new Error(result.error || 'Relayer error');
    }

    const pendingNote = result.contributionId
      ? ` · Contribuição ${shortHash(result.contributionId)} aguardando verificação para pagar a recompensa.`
      : '';
    showAlert('register-alert', 'success', `✓ ${s.success_registered || 'Local registrado!'} TX: ${shortHash(result.txHash)}${pendingNote}`);
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

async function handleVerify(approved, idFromTable) {
  const s = getStrings();
  const idInput = document.getElementById('verify-id');
  const contributionId = (idFromTable || idInput?.value || '').trim();

  if (!contributionId || !contributionId.startsWith('0x') || contributionId.length !== 66) {
    alert(s.err_tx_failed || 'Invalid contribution ID');
    return;
  }

  try {
    // Verificação + pagamento acontecem no backend (/api/verify):
    // a chave verificadora aprova on-chain e o relayer paga o USDC
    // direto para a wallet do contribuidor real.
    const resp = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contributionId, approve: approved, reason: approved ? '' : 'Rejeitado pelo verificador' }),
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
        <td style="font-family:monospace;font-size:0.8rem;" title="${p.contributionId}">${shortHash(p.contributionId)}${p.name ? `<br><small>${p.name}</small>` : ''}</td>
        <td style="font-family:monospace;font-size:0.8rem;">${shortAddr(p.user)}</td>
        <td>${p.rewardType || 'NewLocation'}</td>
        <td>⏳ pendente</td>
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
  const categories = Array.from(
    document.querySelectorAll('#reg-category-group input[name="category"]:checked')
  ).map(el => parseInt(el.value, 10));
  const gasEl = document.getElementById('register-gas-estimate');

  if (isNaN(lat) || isNaN(lng) || !name || categories.length === 0 || !publicClient) return;

  try {
    const viem = window.viem;
    const latInt = BigInt(Math.round((lat + 90) * 1e6));
    const lngInt = BigInt(Math.round((lng + 180) * 1e6));
    const dummyHash = viem.keccak256('0x00');

    const gasEstimate = await publicClient.estimateContractGas({
      address: cfg.contracts.SteplessOracle,
      abi: cfg.abis.SteplessOracle,
      functionName: 'registerLocation',
      args: [latInt, lngInt, name, categories[0], dummyHash],
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
  if (!window.ethereum) return;
  try {
    // eth_accounts não abre prompt — só retorna se já aprovado
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) return;

    const viem = await loadViem();
    walletAddress = viem.getAddress(accounts[0]);

    publicClient = viem.createPublicClient({ chain: cfg.chain, transport: viem.http() });
    walletClient = viem.createWalletClient({
      account: walletAddress,
      chain: cfg.chain,
      transport: viem.custom(window.ethereum),
    });

    isConnected = true;

    // Reage a logout/troca de conta
    window.ethereum.on?.('accountsChanged', accs => {
      if (!accs || accs.length === 0) location.reload();
      else if (accs[0].toLowerCase() !== walletAddress.toLowerCase()) location.reload();
    });

    // Atualiza UI
    document.getElementById('not-connected')?.classList.add('hidden');
    document.getElementById('dashboard-content')?.classList.remove('hidden');
    const btn = document.getElementById('connect-wallet-btn');
    if (btn) btn.style.display = 'none';
    const info = document.getElementById('wallet-info');
    if (info) info.classList.add('connected');
    const addrEl = document.getElementById('wallet-address');
    if (addrEl) addrEl.textContent = shortAddr(walletAddress);

    await refreshAll();
    await checkRelayerSetup();
    await checkAdminPanel();
    startWebSocketSubscriptions(viem);

    console.log('[autoConnect] Reconectado:', walletAddress);
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
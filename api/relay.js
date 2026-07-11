/**
 * api/relay.js — Vercel Serverless Function
 * Relayer para Arc Testnet: recebe dados do usuário, valida GPS via EXIF
 * e submete a transação com o EOA admin (paga o gas em USDC).
 *
 * POST /api/relay
 * Body: {
 *   action: 'submitContribution' | 'registerLocation',
 *   userAddress: '0x...',
 *   submissionData: {
 *     locationHash, latPacked, lngPacked, dataHash,
 *     exifLat, exifLng, exifTimestamp,  ← validação anti-fraude
 *     name, categories                  ← salvos fora da chain (Upstash), opcionais
 *   }
 * }
 *
 * Variáveis de ambiente no Vercel:
 *   RELAYER_PRIVATE_KEY, ORACLE_ADDRESS, ARC_RPC_URL
 */

import { createWalletClient, createPublicClient, http, keccak256, encodePacked, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createHash } from 'crypto';
import { store, contribKey, PENDING_LIST_KEY, clientIp } from './_stepless.js';

// ─── Off-chain metadata storage (Upstash Redis REST API) ────────────────────
// O contrato só guarda locationHash (um hash unidirecional) — o nome e as
// categorias escolhidas pelo usuário nunca vão para a chain. Para exibir isso
// depois, guardamos locationHash → {name, categories} aqui, fora da chain.
// Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN (free tier em
// upstash.com) para habilitar; sem eles, o registro on-chain continua
// funcionando normalmente, só sem nome/categorias salvos.
async function saveLocationMeta(locationHash, meta) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !meta?.name) return;
  try {
    const key = `stepless:loc:${locationHash.toLowerCase()}`;
    const value = JSON.stringify({
      name: meta.name,
      categories: Array.isArray(meta.categories) ? meta.categories : [],
      // lat/lng reais calculados a partir do latPacked/lngPacked enviados no registro.
      // Salvar aqui evita depender de escanear eventos on-chain depois (janela de
      // blocos limitada e frágil) — a busca por endereço/GPS usa isso diretamente.
      lat: typeof meta.lat === 'number' ? meta.lat : null,
      lng: typeof meta.lng === 'number' ? meta.lng : null,
    });
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) console.warn('[relay] Upstash save failed:', res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.warn('[relay] Upstash save error (metadata not persisted):', err?.message);
  }
}

// ─── Arc Testnet chain config ───────────────────────────────────────────────
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
};

// ─── SteplessOracle ABI ─────────────────────────────────────────────────────
const ORACLE_ABI = [
  {
    name: 'registerLocation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'locationHash', type: 'bytes32' },
      { name: 'latPacked',    type: 'uint256' },
      { name: 'lngPacked',    type: 'uint256' },
      { name: 'dataHash',     type: 'bytes32' },
      { name: 'contributor',  type: 'address' }, // v2: contribuidor REAL
    ],
    outputs: [],
  },
  {
    name: 'submitContribution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'contributionId',   type: 'bytes32' },
      { name: 'locationHash',     type: 'bytes32' },
      { name: 'contributionType', type: 'uint8'   },
      { name: 'dataHash',         type: 'bytes32' },
      { name: 'contributor',      type: 'address' }, // v2: contribuidor REAL
    ],
    outputs: [],
  },
  // Custom errors do contrato — sem isso, viem só mostra a assinatura em hex
  // (ex: "0x06eaa269") em vez do nome legível ("LocationAlreadyRegistered").
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'LocationAlreadyRegistered', inputs: [{ name: 'locationHash', type: 'bytes32' }] },
  { type: 'error', name: 'LocationNotFound', inputs: [{ name: 'locationHash', type: 'bytes32' }] },
  { type: 'error', name: 'ContributionAlreadyExists', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'ContributionNotFound', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'AlreadyVerified', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'NotAVerifier', inputs: [{ name: 'addr', type: 'address' }] },
  { type: 'error', name: 'SelfVerificationForbidden', inputs: [] },
  { type: 'error', name: 'CooldownActive', inputs: [] },
];

// ─── ABI para auto-autorização do relayer ───────────────────────────────────
const AUTH_ABI = [
  {
    name: 'setAuthorizedCaller',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'caller',     type: 'address' },
      { name: 'authorized', type: 'bool'    },
    ],
    outputs: [],
  },
  {
    name: 'authorizedCallers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
];

// ─── Haversine distance (km) ─────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── EXIF anti-fraud validation ──────────────────────────────────────────────
// MAX_DISTANCE_KM: distância máxima aceita entre GPS do EXIF e local registrado
const MAX_DISTANCE_KM = 0.5; // 500 metros
// MAX_PHOTO_AGE_DAYS: foto não pode ter mais de 7 dias
const MAX_PHOTO_AGE_DAYS = 7;

function validateExif(exifLat, exifLng, exifTimestamp, latPacked, lngPacked) {
  // Se EXIF não veio, bloqueia — foto é obrigatória
  if (exifLat == null || exifLng == null) {
    return { ok: false, error: 'Foto sem dados de GPS. Ative a localização na câmera e tente novamente.' };
  }

  // Verifica timestamp (foto recente)
  if (exifTimestamp) {
    const photoDate = new Date(exifTimestamp);
    const ageMs = Date.now() - photoDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_PHOTO_AGE_DAYS) {
      return { ok: false, error: `Foto muito antiga (${Math.round(ageDays)} dias). Use uma foto tirada nos últimos ${MAX_PHOTO_AGE_DAYS} dias.` };
    }
  }

  // Verifica distância entre EXIF GPS e local registrado
  const claimedLat = latPacked / 1e6;
  const claimedLng = lngPacked / 1e6;
  const distKm = haversineKm(exifLat, exifLng, claimedLat, claimedLng);

  if (distKm > MAX_DISTANCE_KM) {
    return {
      ok: false,
      error: `GPS da foto (${distKm.toFixed(1)}km de distância) não corresponde ao local registrado. A foto deve ser tirada no local.`,
    };
  }

  return { ok: true, distKm };
}

// ─── Handler principal ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!process.env.RELAYER_PRIVATE_KEY) {
    return res.status(500).json({ success: false, error: 'Relayer not configured' });
  }
  if (!process.env.ORACLE_ADDRESS) {
    return res.status(500).json({ success: false, error: 'Oracle address not configured' });
  }

  // ── Rate limit: 6 escritas/min por IP (evita drenagem do gas do relayer) ──
  if (!(await store.rateLimit(`relay:${clientIp(req)}`, 6, 60))) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Aguarde um minuto e tente de novo.' });
  }

  const { action, userAddress, submissionData } = req.body || {};

  if (!action || !userAddress || !submissionData) {
    return res.status(400).json({ success: false, error: 'Missing: action, userAddress, submissionData' });
  }
  if (!['submitContribution', 'registerLocation'].includes(action)) {
    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
    return res.status(400).json({ success: false, error: 'Invalid userAddress' });
  }

  try {
    const pk = process.env.RELAYER_PRIVATE_KEY.startsWith('0x')
      ? process.env.RELAYER_PRIVATE_KEY
      : `0x${process.env.RELAYER_PRIVATE_KEY}`;

    const account = privateKeyToAccount(pk);
    const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
    const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
    const oracleAddress = getAddress(process.env.ORACLE_ADDRESS.toLowerCase());

    // ── Auto-autorização: verifica e autoriza o relayer se necessário ─────
    try {
      const isAuthorized = await publicClient.readContract({
        address: oracleAddress,
        abi: AUTH_ABI,
        functionName: 'authorizedCallers',
        args: [account.address],
      });
      if (!isAuthorized) {
        console.log('[relay] Not authorized — calling setAuthorizedCaller...');
        const authTx = await walletClient.writeContract({
          address: oracleAddress,
          abi: AUTH_ABI,
          functionName: 'setAuthorizedCaller',
          args: [account.address, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: authTx });
        console.log('[relay] Self-authorized successfully:', authTx);
      }
    } catch (authErr) {
      // Se falhar (relayer não é admin), loga e continua — o writeContract vai revelar o erro real
      console.warn('[relay] Auto-auth skipped:', authErr?.shortMessage || authErr?.message);
    }

    let txHash;
    let contributionId = null;

    // ── submitContribution ────────────────────────────────────────────────
    if (action === 'submitContribution') {
      const { locationHash, contributionType, dataHash } = submissionData;
      if (!locationHash || contributionType === undefined || !dataHash) {
        return res.status(400).json({
          success: false,
          error: 'submitContribution requires: locationHash, contributionType, dataHash',
        });
      }
      contributionId = `0x${createHash('sha256')
        .update(`${locationHash}${userAddress}${Date.now()}`)
        .digest('hex')}`;

      txHash = await walletClient.writeContract({
        address: oracleAddress,
        abi: ORACLE_ABI,
        functionName: 'submitContribution',
        args: [contributionId, locationHash, Number(contributionType), dataHash, userAddress],
      });
    }

    // ── registerLocation ──────────────────────────────────────────────────
    if (action === 'registerLocation') {
      const { locationHash, latPacked, lngPacked, dataHash, exifLat, exifLng, exifTimestamp } = submissionData;

      if (!locationHash || latPacked == null || lngPacked == null) {
        return res.status(400).json({
          success: false,
          error: 'registerLocation requires: locationHash, latPacked, lngPacked',
        });
      }

      // ── Anti-fraude: valida EXIF GPS ──────────────────────────────────
      // EXIF_REQUIRED=true  → bloqueia (produção)
      // EXIF_REQUIRED=false → loga mas não bloqueia (testnet/demo)
      const exifRequired = process.env.EXIF_REQUIRED !== 'false';
      const exifCheck = validateExif(exifLat, exifLng, exifTimestamp, Number(latPacked), Number(lngPacked));
      if (!exifCheck.ok) {
        if (exifRequired) {
          return res.status(422).json({ success: false, error: exifCheck.error });
        } else {
          // Testnet: log mas continua
          console.warn('[relay] EXIF warning (not enforced on testnet):', exifCheck.error);
        }
      }

      // dataHash inclui hash da foto + coords EXIF para prova imutável
      const finalDataHash = dataHash || keccak256(encodePacked(
        ['bytes32', 'int256', 'int256'],
        [locationHash, BigInt(latPacked), BigInt(lngPacked)]
      ));

      txHash = await walletClient.writeContract({
        address: oracleAddress,
        abi: ORACLE_ABI,
        functionName: 'registerLocation',
        args: [locationHash, BigInt(latPacked), BigInt(lngPacked), finalDataHash, userAddress],
      });
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // ── Cria a contribuição recompensável para o novo local ───────────────
    // registerLocation sozinho não gera nada "pagável" — o RewardDistributor
    // paga por contributionId verificado. Então criamos a contribuição
    // NewLocation aqui, na mesma chamada, e guardamos a atribuição ao
    // usuário REAL (on-chain o msg.sender é o relayer).
    let contributionTx = null;
    if (action === 'registerLocation') {
      const { locationHash, dataHash } = submissionData;
      contributionId = `0x${createHash('sha256')
        .update(`${locationHash}${userAddress}${Date.now()}`)
        .digest('hex')}`;
      try {
        contributionTx = await walletClient.writeContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: 'submitContribution',
          args: [contributionId, locationHash, 0 /* NewLocation */, dataHash || locationHash, userAddress],
        });
        await publicClient.waitForTransactionReceipt({ hash: contributionTx });
      } catch (cErr) {
        console.warn('[relay] submitContribution after register failed:', cErr?.shortMessage || cErr?.message);
        contributionId = null; // local registrado, mas sem contribuição pagável
      }
    }

    // ── Registra pendência p/ verificação + atribuição do usuário real ────
    if (contributionId) {
      await store.setJSON(contribKey(contributionId), {
        user: userAddress,
        locationHash: submissionData.locationHash,
        name: submissionData.name || null,
        categories: Array.isArray(submissionData.categories) ? submissionData.categories : [],
        rewardType: action === 'registerLocation' ? 'NewLocation' : 'LocationUpdate',
        status: 'pending',
        ts: Date.now(),
      });
      await store.listPush(PENDING_LIST_KEY, contributionId);
    }

    // Salva nome + categorias + lat/lng fora da chain (best-effort — não bloqueia a resposta em caso de falha)
    if (action === 'registerLocation' && submissionData.name) {
      // latPacked/lngPacked vêm empacotados (offset +90/+180, *1e6) — desempacota
      // para lat/lng reais antes de salvar, no mesmo formato usado no frontend.
      const packedLat = Number(submissionData.latPacked);
      const packedLng = Number(submissionData.lngPacked);
      await saveLocationMeta(submissionData.locationHash, {
        name: submissionData.name,
        categories: submissionData.categories,
        lat: Number.isFinite(packedLat) ? packedLat / 1e6 - 90 : null,
        lng: Number.isFinite(packedLng) ? packedLng / 1e6 - 180 : null,
      });
    }

    return res.status(200).json({
      success: true,
      txHash,
      contributionId,
      contributionTx,
      blockNumber: receipt.blockNumber?.toString(),
      status: receipt.status,
    });

  } catch (err) {
    console.error('[relay] Error:', err);
    const msg = err?.shortMessage || err?.message || String(err);
    if (/blocklist|blocked/i.test(msg)) {
      return res.status(403).json({ success: false, error: 'Endereço bloqueado pelo sistema anti-drenagem da Arc.' });
    }
    if (/insufficient|balance/i.test(msg)) {
      return res.status(402).json({ success: false, error: 'Relayer sem saldo USDC para gas.' });
    }
    // Custom errors do contrato — nomes legíveis (viem decodifica via ORACLE_ABI acima)
    if (/LocationAlreadyRegistered|06eaa269/i.test(msg)) {
      return res.status(409).json({ success: false, error: 'Esse local (mesma coordenada e nome) já foi registrado antes.' });
    }
    if (/AlreadyVerified/i.test(msg)) {
      return res.status(409).json({ success: false, error: 'Essa contribuição já foi verificada.' });
    }
    if (/NotAVerifier/i.test(msg)) {
      return res.status(403).json({ success: false, error: 'Esse endereço não é um verificador aprovado.' });
    }
    if (/SelfVerificationForbidden/i.test(msg)) {
      return res.status(403).json({ success: false, error: 'Não é permitido verificar sua própria contribuição.' });
    }
    if (/CooldownActive/i.test(msg)) {
      return res.status(429).json({ success: false, error: 'Aguarde o período de cooldown antes de tentar de novo.' });
    }
    if (/ContributionNotFound/i.test(msg)) {
      return res.status(404).json({ success: false, error: 'Contribuição ou local não encontrado.' });
    }
    if (/Unauthorized/i.test(msg)) {
      return res.status(403).json({ success: false, error: 'Relayer não autorizado para essa ação no contrato.' });
    }
    return res.status(500).json({ success: false, error: msg });
  }
}

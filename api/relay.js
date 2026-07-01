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
 *     exifLat, exifLng, exifTimestamp   ← validação anti-fraude
 *   }
 * }
 *
 * Variáveis de ambiente no Vercel:
 *   RELAYER_PRIVATE_KEY, ORACLE_ADDRESS, ARC_RPC_URL
 */

import { createWalletClient, createPublicClient, http, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createHash } from 'crypto';

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
      { name: 'latPacked',    type: 'int256'  },
      { name: 'lngPacked',    type: 'int256'  },
      { name: 'dataHash',     type: 'bytes32' },
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
    ],
    outputs: [],
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
    const oracleAddress = process.env.ORACLE_ADDRESS;
    let txHash;

    // ── submitContribution ────────────────────────────────────────────────
    if (action === 'submitContribution') {
      const { locationHash, contributionType, dataHash } = submissionData;
      if (!locationHash || contributionType === undefined || !dataHash) {
        return res.status(400).json({
          success: false,
          error: 'submitContribution requires: locationHash, contributionType, dataHash',
        });
      }
      const contributionId = `0x${createHash('sha256')
        .update(`${locationHash}${userAddress}${Date.now()}`)
        .digest('hex')}`;

      txHash = await walletClient.writeContract({
        address: oracleAddress,
        abi: ORACLE_ABI,
        functionName: 'submitContribution',
        args: [contributionId, locationHash, Number(contributionType), dataHash],
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
        args: [locationHash, BigInt(latPacked), BigInt(lngPacked), finalDataHash],
      });
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return res.status(200).json({
      success: true,
      txHash,
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
    return res.status(500).json({ success: false, error: msg });
  }
}

/**
 * api/_stepless.js — Código compartilhado entre as funções serverless.
 * (Prefixo "_" impede a Vercel de expor este arquivo como endpoint.)
 */

import { createWalletClient, createPublicClient, http, getAddress, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Chain ───────────────────────────────────────────────────────────────────
export const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, // native = 18 dec
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
};

export function publicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http() });
}

function normalizePk(pk) {
  return pk.startsWith('0x') ? pk : `0x${pk}`;
}

/** Conta do relayer (também é o admin dos contratos no deploy atual). */
export function relayerAccount() {
  return privateKeyToAccount(normalizePk(process.env.RELAYER_PRIVATE_KEY));
}

/**
 * Conta do verificador. Usa VERIFIER_PRIVATE_KEY se definida; caso contrário
 * deriva uma chave determinística da chave do relayer (precisa ser um endereço
 * DIFERENTE do relayer, porque o contrato proíbe auto-verificação — o
 * "contributor" on-chain é o próprio relayer).
 */
export function verifierAccount() {
  if (process.env.VERIFIER_PRIVATE_KEY) {
    return privateKeyToAccount(normalizePk(process.env.VERIFIER_PRIVATE_KEY));
  }
  const derived = keccak256(toBytes(normalizePk(process.env.RELAYER_PRIVATE_KEY) + '-stepless-verifier-v1'));
  return privateKeyToAccount(derived);
}

export function walletFor(account) {
  return createWalletClient({ account, chain: arcTestnet, transport: http() });
}

export function oracleAddress() {
  return getAddress(process.env.ORACLE_ADDRESS.toLowerCase());
}
export function distributorAddress() {
  return getAddress((process.env.DISTRIBUTOR_ADDRESS || '0x4959d0BB848Af5437F249E8516914e0e9353584b').toLowerCase());
}

// ─── ABIs mínimas ────────────────────────────────────────────────────────────
export const ORACLE_ABI = [
  { name: 'registerLocation', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'locationHash', type: 'bytes32' }, { name: 'latPacked', type: 'uint256' }, { name: 'lngPacked', type: 'uint256' }, { name: 'dataHash', type: 'bytes32' }, { name: 'contributor', type: 'address' }], outputs: [] },
  { name: 'submitContribution', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'contributionId', type: 'bytes32' }, { name: 'locationHash', type: 'bytes32' }, { name: 'contributionType', type: 'uint8' }, { name: 'dataHash', type: 'bytes32' }, { name: 'contributor', type: 'address' }], outputs: [] },
  { name: 'verifyContribution', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'contributionId', type: 'bytes32' }, { name: 'approve', type: 'bool' }, { name: 'reason', type: 'string' }], outputs: [] },
  { name: 'setAuthorizedCaller', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'caller', type: 'address' }, { name: 'authorized', type: 'bool' }], outputs: [] },
  { name: 'setRewardDistributor', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: '_distributor', type: 'address' }], outputs: [] },
  { name: 'transferAdmin', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdmin', type: 'address' }], outputs: [] },
  { name: 'authorizedCallers', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'rewardDistributor', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'admin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'getContribution', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'contributionId', type: 'bytes32' }],
    outputs: [{ name: 'verified', type: 'bool' }, { name: 'verifier', type: 'address' }, { name: 'timestamp', type: 'uint256' }] },
  // Custom errors (para mensagens legíveis no viem)
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

export const DISTRIBUTOR_ABI = [
  { name: 'payReward', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'contributionId', type: 'bytes32' }, { name: 'contributor', type: 'address' }, { name: 'rewardType', type: 'uint8' }], outputs: [] },
  { name: 'registerVerifier', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'verifier', type: 'address' }], outputs: [] },
  { name: 'setAuthorizedCaller', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'caller', type: 'address' }, { name: 'authorized', type: 'bool' }], outputs: [] },
  { name: 'transferAdmin', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdmin', type: 'address' }], outputs: [] },
  { name: 'authorizedCallers', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'verifiers', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'rewardClaimed', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { name: 'treasuryBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'admin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'ContributionNotVerified', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'RewardAlreadyClaimed', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'InsufficientTreasury', inputs: [{ name: 'needed', type: 'uint256' }, { name: 'available', type: 'uint256' }] },
  { type: 'error', name: 'DuplicateVerifier', inputs: [{ name: 'verifier', type: 'address' }, { name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'CooldownActive', inputs: [{ name: 'blockNumber', type: 'uint256' }, { name: 'unlockBlock', type: 'uint256' }] },
  { type: 'error', name: 'Paused', inputs: [] },
];

// RewardType enum do RewardDistributor
export const REWARD_TYPE = { NewLocation: 0, Verification: 1, QualityPhoto: 2, LocationUpdate: 3 };

// ─── Upstash Redis (REST) com fallback em memória ────────────────────────────
// Sem Upstash configurado, os dados vivem só na lambda quente (suficiente para
// demo; configure UPSTASH_* para persistência real).
const mem = globalThis.__steplessMem || (globalThis.__steplessMem = { kv: new Map(), list: [] });

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  return (await res.json()).result;
}

export const store = {
  async setJSON(key, obj) {
    try { const r = await redis(['SET', key, JSON.stringify(obj)]); if (r !== null) return; } catch (_) {}
    mem.kv.set(key, obj);
  },
  async getJSON(key) {
    try {
      const r = await redis(['GET', key]);
      if (r !== null && r !== undefined) return r ? JSON.parse(r) : null;
    } catch (_) {}
    return mem.kv.get(key) ?? null;
  },
  async listPush(key, value) {
    try { const r = await redis(['LPUSH', key, value]); if (r !== null) return; } catch (_) {}
    mem.list.unshift(value);
  },
  async listRemove(key, value) {
    try { const r = await redis(['LREM', key, '0', value]); if (r !== null) return; } catch (_) {}
    const i = mem.list.indexOf(value); if (i >= 0) mem.list.splice(i, 1);
  },
  async listAll(key, limit = 100) {
    try {
      const r = await redis(['LRANGE', key, '0', String(limit - 1)]);
      if (r !== null && r !== undefined) return r;
    } catch (_) {}
    return mem.list.slice(0, limit);
  },
  /** Rate limit: retorna true se DENTRO do limite. */
  async rateLimit(id, limit, windowSec) {
    const key = `stepless:rl:${id}:${Math.floor(Date.now() / (windowSec * 1000))}`;
    try {
      const n = await redis(['INCR', key]);
      if (n !== null && n !== undefined) {
        if (n === 1) await redis(['EXPIRE', key, String(windowSec)]).catch(() => {});
        return n <= limit;
      }
    } catch (_) {}
    const cur = (mem.kv.get(key) || 0) + 1;
    mem.kv.set(key, cur);
    setTimeout(() => mem.kv.delete(key), windowSec * 1000).unref?.();
    return cur <= limit;
  },
};

export const PENDING_LIST_KEY = 'stepless:pending';
export const contribKey = (id) => `stepless:contrib:${id.toLowerCase()}`;

// ─── HTTP helpers ────────────────────────────────────────────────────────────
export function cors(res, methods = 'POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Verify-Secret');
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

/** Traduz erros de contrato/RPC em mensagens amigáveis + status HTTP. */
export function translateError(err) {
  const msg = err?.shortMessage || err?.message || String(err);
  const map = [
    [/returned no data|no data \("0x"\)/i, 500, 'Não existe contrato nesse endereço na Arc Testnet. Confira DISTRIBUTOR_ADDRESS / ORACLE_ADDRESS.'],
    [/blocklist|blocked/i, 403, 'Endereço bloqueado pelo sistema anti-drenagem da Arc.'],
    [/InsufficientTreasury/i, 402, 'Tesouraria sem USDC suficiente. Fundeie o RewardDistributor.'],
    [/insufficient|balance/i, 402, 'Conta sem saldo USDC para gas.'],
    [/RewardAlreadyClaimed/i, 409, 'Recompensa já paga para essa contribuição.'],
    [/ContributionNotVerified/i, 409, 'Contribuição ainda não verificada.'],
    [/LocationAlreadyRegistered|06eaa269/i, 409, 'Esse local (mesma coordenada e nome) já foi registrado.'],
    [/AlreadyVerified/i, 409, 'Essa contribuição já foi verificada.'],
    [/DuplicateVerifier|SelfVerificationForbidden/i, 403, 'Verificador não pode validar a própria contribuição.'],
    [/NotAVerifier/i, 403, 'Endereço não é um verificador aprovado. Rode POST /api/setup.'],
    [/CooldownActive/i, 429, 'Aguarde alguns segundos (cooldown do verificador) e tente de novo.'],
    [/ContributionNotFound/i, 404, 'Contribuição ou local não encontrado.'],
    [/Unauthorized/i, 403, 'Chamador não autorizado no contrato. Rode POST /api/setup.'],
    [/Paused/i, 503, 'Contrato pausado pelo admin.'],
  ];
  for (const [re, status, friendly] of map) if (re.test(msg)) return { status, error: friendly, detail: msg };
  return { status: 500, error: msg };
}

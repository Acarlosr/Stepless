/**
 * api/_stepless.js — Código compartilhado entre as funções serverless.
 * (Prefixo "_" impede a Vercel de expor este arquivo como endpoint.)
 */

import { timingSafeEqual } from 'node:crypto';
import { createWalletClient, createPublicClient, http, fallback, getAddress, recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainConfig, rpcUrls, contractAddresses, NETWORK_NAME } from './_network.js';

// ─── Chain ───────────────────────────────────────────────────────────────────
// Tudo (chainId, RPCs, decimais do nativo, explorer) vem de
// config/networks.json via api/_network.js. Antes, cada arquivo declarava a
// sua própria cópia e elas divergiram na prática: relay.js dizia que o USDC
// nativo tinha 6 decimais e este arquivo dizia 18, para a MESMA rede. O viem
// usa esse número para formatar saldo e estimar gas.
export const chain = chainConfig();

/** @deprecated Mantido só para não quebrar imports antigos. Use `chain`. */
export const arcTestnet = chain;

// Transport resiliente: fallback entre vários RPCs + retry/backoff em cada um.
// Timeouts curtos de propósito — ver nota em api/relay.js sobre o limite de
// execução da função serverless da Vercel (evita "Unexpected token" no cliente
// quando a Vercel mata a função por timeout e devolve HTML em vez de JSON).
const arcTransport = () => fallback(
  rpcUrls().map((url) => http(url, { retryCount: 1, retryDelay: 400, timeout: 6_000 })),
  { rank: false }, // mantém a ordem da lista (não re-ranqueia por latência)
);

export function publicClient() {
  return createPublicClient({ chain, transport: arcTransport() });
}

function normalizePk(pk, envName) {
  if (!pk) throw new Error(`${envName} não configurada no ambiente.`);
  const normalized = pk.startsWith('0x') ? pk : `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${envName} não é uma chave privada válida (32 bytes em hex).`);
  }
  return normalized;
}

/**
 * Conta do relayer — escreve no Oracle em nome dos usuários.
 *
 * NÃO deve ser o admin dos contratos. Ela vive numa env var da Vercel, é usada
 * a cada requisição e já vazou uma vez no histórico do git. O que ela pode
 * fazer é o teto do estrago quando isso se repetir.
 */
export function relayerAccount() {
  return privateKeyToAccount(normalizePk(process.env.RELAYER_PRIVATE_KEY, 'RELAYER_PRIVATE_KEY'));
}

/**
 * Conta do verificador — assina verifyContribution().
 *
 * ⚠️ MUDANÇA DE SEGURANÇA (auditoria de mainnet, achado C1): esta função
 * DERIVAVA a chave do verificador da chave do relayer quando
 * VERIFIER_PRIVATE_KEY não estava setada:
 *
 *     keccak256(RELAYER_PRIVATE_KEY + '-stepless-verifier-v1')
 *
 * O contrato proíbe auto-verificação justamente para que registrar e aprovar
 * sejam atos de pessoas diferentes. Com as duas chaves saindo da mesma
 * semente, quem obtivesse uma tinha as duas — e fechava sozinho o ciclo
 * registrar → verificar → pagar, drenando a tesouraria com transações
 * indistinguíveis de uso normal no explorer.
 *
 * Agora a chave é obrigatória e independente. Sem ela, o endpoint de
 * verificação simplesmente não sobe — o que é preferível a subir com uma
 * separação que só parece existir.
 */
export function verifierAccount() {
  return privateKeyToAccount(normalizePk(process.env.VERIFIER_PRIVATE_KEY, 'VERIFIER_PRIVATE_KEY'));
}

export function walletFor(account) {
  return createWalletClient({ account, chain, transport: arcTransport() });
}

export function oracleAddress() {
  const addr = contractAddresses().SteplessOracle;
  if (!addr) throw new Error(`Endereço do SteplessOracle não definido para a rede ${NETWORK_NAME}.`);
  return getAddress(addr.toLowerCase());
}

export function distributorAddress() {
  // Sem fallback silencioso: o valor antigo que ficava aqui apontava para um
  // distributor órfão (admin inacessível após a migração v3). Se sumir, é
  // melhor falhar alto do que gravar em um contrato morto.
  const addr = contractAddresses().RewardDistributor;
  if (!addr) throw new Error(`Endereço do RewardDistributor não definido para a rede ${NETWORK_NAME}.`);
  return getAddress(addr.toLowerCase());
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
  // v5: transferAdmin virou duas fases — o sucessor precisa chamar acceptAdmin.
  { name: 'transferAdmin', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdmin', type: 'address' }], outputs: [] },
  { name: 'acceptAdmin', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'authorizedCallers', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'rewardDistributor', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'memo', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'admin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'pendingAdmin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'getContribution', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'contributionId', type: 'bytes32' }],
    outputs: [{ name: 'verified', type: 'bool' }, { name: 'verifier', type: 'address' }, { name: 'blockNumber', type: 'uint256' }] },
  // v5: usado pelo distributor para conferir que a recompensa vai para quem
  // de fato contribuiu.
  { name: 'getContributor', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'contributionId', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'locationCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
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
  { type: 'error', name: 'RejectReasonTooLong', inputs: [{ name: 'length', type: 'uint256' }, { name: 'max', type: 'uint256' }] },
  // CooldownActive é lançado pelo RewardDistributor (2 argumentos), não pelo
  // Oracle — mas o revert bubbla até aqui via verifyContribution(). Assinatura
  // errada (0 args) fazia o viem não decodificar e mostrar erro genérico.
  { type: 'error', name: 'CooldownActive', inputs: [{ name: 'blockNumber', type: 'uint256' }, { name: 'unlockBlock', type: 'uint256' }] },
  { type: 'error', name: 'RewardDistributorNotSet', inputs: [] },
  // Também bubbla do RewardDistributor via recordVerification().
  { type: 'error', name: 'DuplicateVerifier', inputs: [{ name: 'verifier', type: 'address' }, { name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'OnlyOracle', inputs: [{ name: 'caller', type: 'address' }] },
];

export const DISTRIBUTOR_ABI = [
  { name: 'payReward', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'contributionId', type: 'bytes32' }, { name: 'contributor', type: 'address' }, { name: 'rewardType', type: 'uint8' }], outputs: [] },
  // v5: registerVerifier/slashVerifier deram lugar a setVerifier(addr, bool).
  // Antes, a única forma de REMOVER alguém era slashVerifier, que também zera
  // o totalEarned — ou seja, não existia "desligar" sem punir.
  { name: 'setVerifier', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'verifier', type: 'address' }, { name: 'authorized', type: 'bool' }], outputs: [] },
  { name: 'slashVerifier', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'verifier', type: 'address' }, { name: 'reason', type: 'string' }], outputs: [] },
  { name: 'setAuthorizedCaller', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'caller', type: 'address' }, { name: 'authorized', type: 'bool' }], outputs: [] },
  { name: 'transferAdmin', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdmin', type: 'address' }], outputs: [] },
  { name: 'acceptAdmin', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  // v5: retryReward não aceita mais valor e destinatário livres — ambos vêm de
  // failedRewards[], e por isso a função é permissionless.
  { name: 'retryReward', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'contributionId', type: 'bytes32' }], outputs: [] },
  { name: 'getFailedReward', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'contributionId', type: 'bytes32' }],
    outputs: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }] },
  { name: 'authorizedCallers', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'verifiers', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'rewardClaimed', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { name: 'treasuryBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'availableBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalFailedPending', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'USDC', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'oracle', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'paused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'admin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'pendingAdmin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'ContributionNotVerified', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'RewardAlreadyClaimed', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'InsufficientTreasury', inputs: [{ name: 'needed', type: 'uint256' }, { name: 'available', type: 'uint256' }] },
  { type: 'error', name: 'DuplicateVerifier', inputs: [{ name: 'verifier', type: 'address' }, { name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'CooldownActive', inputs: [{ name: 'blockNumber', type: 'uint256' }, { name: 'unlockBlock', type: 'uint256' }] },
  { type: 'error', name: 'Paused', inputs: [] },
  { type: 'error', name: 'ContributorMismatch', inputs: [{ name: 'contributionId', type: 'bytes32' }, { name: 'expected', type: 'address' }, { name: 'provided', type: 'address' }] },
  { type: 'error', name: 'BatchTooLarge', inputs: [{ name: 'length', type: 'uint256' }, { name: 'max', type: 'uint256' }] },
  { type: 'error', name: 'NoFailedReward', inputs: [{ name: 'contributionId', type: 'bytes32' }] },
  { type: 'error', name: 'OnlyOracle', inputs: [{ name: 'caller', type: 'address' }] },
  { type: 'error', name: 'InvalidUsdc', inputs: [{ name: 'usdc', type: 'address' }] },
];

// RewardType enum do RewardDistributor
export const REWARD_TYPE = { NewLocation: 0, Verification: 1, QualityPhoto: 2, LocationUpdate: 3, TopContributorBonus: 4 };

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
  /**
   * @param {number} [ttlSeconds] expira a chave depois desse tempo.
   *        Usado pelos tokens de foto (api/upload.js): uma prova de captura não
   *        deve continuar válida indefinidamente.
   */
  async setJSON(key, obj, ttlSeconds) {
    const cmd = ttlSeconds
      ? ['SET', key, JSON.stringify(obj), 'EX', String(Math.ceil(ttlSeconds))]
      : ['SET', key, JSON.stringify(obj)];
    try { const r = await redis(cmd); if (r !== null) return; } catch (_) {}
    mem.kv.set(key, obj);
    if (ttlSeconds) setTimeout(() => mem.kv.delete(key), ttlSeconds * 1000).unref?.();
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
  async rateLimit(id, limit, windowSec, cost = 1) {
    if (!Number.isSafeInteger(cost) || cost < 1) return false;
    const key = `stepless:rl:${id}:${Math.floor(Date.now() / (windowSec * 1000))}`;
    try {
      const n = await redis(['INCRBY', key, String(cost)]);
      if (n !== null && n !== undefined) {
        if (n === 1) await redis(['EXPIRE', key, String(windowSec)]).catch(() => {});
        return n <= limit;
      }
    } catch (_) {}
    const cur = (mem.kv.get(key) || 0) + cost;
    mem.kv.set(key, cur);
    setTimeout(() => mem.kv.delete(key), windowSec * 1000).unref?.();
    return cur <= limit;
  },
};

export const PENDING_LIST_KEY = 'stepless:pending';
export const contribKey = (id) => `stepless:contrib:${id.toLowerCase()}`;

/**
 * Há armazenamento compartilhado de verdade, ou só o fallback em memória?
 *
 * ⚠️ ISTO VIROU LOAD-BEARING. O fallback em memória vive dentro de UMA instância
 * de lambda. Como o fluxo de foto tem duas requisições (POST /api/upload e
 * depois POST /api/relay), elas quase sempre caem em instâncias diferentes — o
 * token simplesmente não existe na segunda, e toda submissão falha.
 *
 * Pior ainda para o dedup: o registro de "esta foto já foi usada" só faz
 * sentido se for global e permanente. Em memória, ele desaparece quando a
 * lambda esfria, e a mesma imagem volta a valer.
 *
 * Por isso os endpoints que dependem disso recusam a subir sem Upstash, em vez
 * de funcionarem de forma intermitente e inexplicável.
 */
export function hasPersistentStore() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** Devolve 503 e `false` quando não há armazenamento persistente. */
export function requirePersistentStore(res) {
  if (hasPersistentStore()) return true;
  res.status(503).json({
    success: false,
    error: 'Serviço indisponível: armazenamento não configurado.',
    detail: 'UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN são obrigatórias. '
          + 'Sem elas, o token da foto criado no upload não existe na chamada seguinte '
          + '(instâncias serverless diferentes) e o registro de fotas já usadas não persiste.',
  });
  return false;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
/**
 * Origens autorizadas a chamar a API pelo navegador.
 *
 * Antes era `Access-Control-Allow-Origin: *` em TODOS os endpoints, inclusive
 * nos administrativos. Isso não vazava o segredo (ele vai em header, não em
 * cookie), mas transformava o proxy RPC e o relayer em recurso aberto: qualquer
 * site conseguia consumir a cota do nó dedicado e o gas do relayer a partir do
 * navegador dos visitantes dele.
 *
 * Configurável por ALLOWED_ORIGINS (lista separada por vírgula) para preview
 * deploys da Vercel.
 */
const DEFAULT_ORIGINS = [
  'https://www.stepless.lat',
  'https://stepless.lat',
  'https://stepless.vercel.app',
];

export function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}

export function cors(res, methods = 'POST, OPTIONS', req = null) {
  const origins = allowedOrigins();
  const origin = req?.headers?.origin;

  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Sem Origin (curl, app nativo, server-to-server) ou origem desconhecida:
    // devolve a origem canônica. Requisições sem Origin não são barradas pelo
    // navegador de qualquer forma — o CORS protege o USUÁRIO de um site
    // terceiro, não o servidor de um script.
    res.setHeader('Access-Control-Allow-Origin', origins[0]);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret, X-Verify-Secret');
}

function secretsEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/** Bloqueia mutações administrativas quando não há segredo server-side. */
export function requireAdminSecret(req, res, options = {}) {
  const envNames = options.envNames || ['ADMIN_API_SECRET', 'VERIFY_SECRET'];
  const headerNames = options.headerNames || ['x-admin-secret', 'x-verify-secret'];
  const expected = envNames.map((name) => process.env[name]).find(Boolean);
  if (!expected) {
    res.status(503).json({ success: false, error: `Endpoint administrativo desativado: configure ${envNames[0]} no servidor.` });
    return false;
  }
  const actual = headerNames.map((name) => req.headers?.[name]).find((value) => typeof value === 'string');
  if (!secretsEqual(actual, expected)) {
    res.status(401).json({ success: false, error: 'Credencial administrativa inválida.' });
    return false;
  }
  return true;
}

/* ─── Autenticação de verificador por assinatura ──────────────────────────────
 *
 * Antes, aprovar exigia um segredo compartilhado: quem tivesse o segredo
 * aprovava tudo, sem rastro de quem foi e sem como revogar uma pessoa só.
 * Agora cada verificador assina com a própria carteira e o backend confere
 * `verifiers[endereço]` no contrato. Vantagens: identidade real no log,
 * revogação individual on-chain, e nenhum segredo circulando entre pessoas.
 *
 * A mensagem é legível (a pessoa vê o que assina) e amarra ação + contribuição
 * + horário + domínio — assim uma assinatura não serve para outra contribuição,
 * nem para a ação oposta, nem em outro site, nem depois da validade.
 */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutos

export function buildVerifyMessage({ contributionId, approve, address, timestamp, domain }) {
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

/**
 * Valida a assinatura e confirma que o signatário é verificador on-chain.
 * Devolve { ok: true, address } ou { ok: false, status, error }.
 */
export async function verifySignedRequest({ auth, contributionId, approve, domain }) {
  if (!auth || typeof auth !== 'object') {
    return { ok: false, status: 401, error: 'Assinatura ausente.' };
  }
  const { address, signature, timestamp } = auth;

  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return { ok: false, status: 401, error: 'Assinatura mal formada.' };
  }
  let addr;
  try { addr = getAddress(String(address)); }
  catch { return { ok: false, status: 401, error: 'Endereço do verificador inválido.' }; }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, error: 'Horário da assinatura inválido.' };
  }
  const age = Date.now() - ts;
  // Tolera 60s de relógio adiantado; recusa assinatura velha (anti-replay).
  if (age > SIGNATURE_MAX_AGE_MS || age < -60_000) {
    return { ok: false, status: 401, error: 'Assinatura expirada. Tente aprovar novamente.' };
  }

  const message = buildVerifyMessage({ contributionId, approve, address: addr, timestamp: ts, domain });
  let recovered;
  try { recovered = await recoverMessageAddress({ message, signature }); }
  catch { return { ok: false, status: 401, error: 'Não foi possível validar a assinatura.' }; }

  if (getAddress(recovered) !== addr) {
    return { ok: false, status: 401, error: 'A assinatura não corresponde ao endereço informado.' };
  }

  // A autoridade vem do contrato, não de uma lista no servidor.
  let isVerifier = false;
  try {
    isVerifier = await publicClient().readContract({
      address: distributorAddress(), abi: DISTRIBUTOR_ABI, functionName: 'verifiers', args: [addr],
    });
  } catch (err) {
    return { ok: false, status: 503, error: 'Não foi possível consultar a lista de verificadores na Arc.' };
  }
  if (!isVerifier) {
    return { ok: false, status: 403, error: 'Este endereço não é um verificador autorizado.' };
  }

  return { ok: true, address: addr };
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

/**
 * Junta TODAS as partes de um erro do viem numa string única para casar regex.
 *
 * ⚠️ Por que isto existe: para custom errors do Solidity, o `shortMessage` do
 * viem é sempre genérico — 'The contract function "X" reverted.' — e o NOME do
 * erro (ContributionNotFound, CooldownActive, ...) só aparece em
 * `metaMessages` (ex.: 'Error: ContributionNotFound(bytes32 contributionId)').
 * Olhar só o shortMessage fazia todo revert de custom error cair no fallback
 * genérico, escondendo a causa real de quem estava operando o app.
 */
function collectErrorText(err) {
  const parts = [];
  let cur = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur.shortMessage) parts.push(cur.shortMessage);
    if (Array.isArray(cur.metaMessages)) parts.push(cur.metaMessages.join(' '));
    if (cur.name) parts.push(cur.name);
    if (cur.data?.errorName) parts.push(cur.data.errorName);
    if (cur.message) parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.length ? parts.join(' | ') : String(err);
}

/** Traduz erros de contrato/RPC em mensagens amigáveis + status HTTP. */
export function translateError(err) {
  const msg = collectErrorText(err);
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
    [/ContributionNotFound|LocationNotFound/i, 404,
      'Contribuição não existe no contrato atual. Se os contratos foram redeployados, '
      + 'as pendências antigas ficaram no contrato anterior e precisam ser registradas de novo.'],
    [/RewardDistributorNotSet/i, 503, 'Oracle sem RewardDistributor configurado. Rode: node scripts/setup-contracts.mjs'],
    [/ContributorMismatch/i, 409, 'O endereço informado não é o contribuidor registrado desta contribuição.'],
    [/BatchTooLarge/i, 400, 'Lote grande demais (máximo 50 por transação).'],
    [/NoFailedReward/i, 404, 'Não há recompensa falha registrada para essa contribuição.'],
    [/OnlyOracle/i, 403, 'Essa operação só pode ser feita pelo contrato Oracle.'],
    [/InvalidUsdc/i, 500, 'O RewardDistributor foi deployado com um endereço de USDC inválido para esta rede.'],
    [/ReentrancyDetected/i, 409, 'Chamada reentrante bloqueada pelo contrato.'],
    [/WithdrawalNotReady|NoPendingWithdrawal/i, 425, 'Saque ainda em período de espera (timelock de 48h).'],
    [/Unauthorized/i, 403, 'Chamador não autorizado no contrato. Rode: node scripts/setup-contracts.mjs'],
    [/Paused/i, 503, 'Contrato pausado pelo admin.'],
  ];
  for (const [re, status, friendly] of map) if (re.test(msg)) return { status, error: friendly, detail: msg };
  return { status: 500, error: msg };
}

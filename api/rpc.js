/**
 * Proxy JSON-RPC público com rate limit. Mantém ARC_RPC_URL somente no servidor
 * e evita publicar a credencial do provedor nos bundles web/mobile.
 */
import { store, clientIp, cors, allowedOrigins } from './_stepless.js';
import { publicRpcUrl } from './_network.js';

// Vem de config/networks.json. O valor que estava chumbado aqui
// (rpc.testnet.arc.network) é de um domínio que a documentação da Arc já não
// lista — a partir de 2026 os endpoints ficam em *.arc.io.
const PUBLIC_RPC_URL = publicRpcUrl();
const MAX_BATCH_SIZE = 20;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CALL_DATA_BYTES = 32 * 1024;
const MAX_RAW_TX_BYTES = 128 * 1024;
const MAX_LOG_BLOCK_RANGE = 5_000n;
const ALLOWED_METHODS = new Set([
  'eth_blockNumber', 'eth_call', 'eth_chainId', 'eth_estimateGas', 'eth_feeHistory',
  'eth_gasPrice', 'eth_getBalance', 'eth_getBlockByHash', 'eth_getBlockByNumber',
  'eth_getBlockTransactionCountByHash', 'eth_getBlockTransactionCountByNumber',
  'eth_getCode', 'eth_getLogs', 'eth_getStorageAt', 'eth_getTransactionByHash',
  'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_maxPriorityFeePerGas',
  'net_version', 'web3_clientVersion',
  // ── Filtros de evento ────────────────────────────────────────────────────
  // O watchContractEvent do viem NÃO começa por eth_getLogs: ele tenta primeiro
  // criar um filtro no nó (eth_newFilter) e depois consultá-lo em cada poll
  // (eth_getFilterChanges), caindo pro getLogs só se o filtro falhar. Como
  // esses três métodos estavam fora da allowlist, TODA rodada de polling dos 4
  // watchers do dashboard batia neste proxy e voltava 400 — era essa a origem
  // do tapete de "Failed to load resource: 400" no console, a cada 15s, sem
  // que nenhum evento em tempo real chegasse a funcionar.
  // São métodos só-leitura, sem custo de escrita on-chain.
  'eth_newFilter', 'eth_getFilterChanges', 'eth_getFilterLogs', 'eth_uninstallFilter',
  'eth_newBlockFilter',
]);

/**
 * eth_sendRawTransaction fica FORA da allowlist por padrão (auditoria de
 * mainnet, achado A5).
 *
 * O app não precisa dele: quem escreve on-chain é o relayer, pelo backend. Com
 * ele aberto, este endpoint vira um relay de transações de terceiros pago pela
 * cota do nó dedicado — em mainnet, custo direto e nenhum benefício.
 *
 * Se algum fluxo futuro precisar (ex.: verificador assinando do navegador),
 * ligue RPC_ALLOW_SEND_RAW_TX=true conscientemente.
 */
if (process.env.RPC_ALLOW_SEND_RAW_TX === 'true') {
  ALLOWED_METHODS.add('eth_sendRawTransaction');
}

function hexByteLength(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)
    ? Math.ceil((value.length - 2) / 2)
    : null;
}

const BLOCK_TAGS = new Set(['latest', 'earliest', 'pending', 'safe', 'finalized']);

function parseBlockNumber(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

function validateMethodParams(item) {
  const params = Array.isArray(item.params) ? item.params : [];
  if (item.method === 'eth_call' || item.method === 'eth_estimateGas') {
    const dataLength = hexByteLength(params[0]?.data || '0x');
    return params.length <= 2 && dataLength !== null && dataLength <= MAX_CALL_DATA_BYTES;
  }
  if (item.method === 'eth_sendRawTransaction') {
    const rawLength = hexByteLength(params[0]);
    return params.length === 1 && rawLength !== null && rawLength <= MAX_RAW_TX_BYTES;
  }
  // eth_newFilter recebe o mesmo objeto de filtro do getLogs, e o viem manda
  // fromBlock/toBlock como tag ("latest") aqui com frequência. Aplica a mesma
  // validação branda: só barra o que for claramente malformado.
  if (item.method === 'eth_newFilter') {
    const filter = params[0];
    return params.length === 1 && Boolean(filter) && typeof filter === 'object';
  }
  if (item.method === 'eth_getLogs') {
    const filter = params[0];
    if (params.length !== 1 || !filter || typeof filter !== 'object') return false;
    if (filter.blockHash) return /^0x[0-9a-fA-F]{64}$/.test(filter.blockHash);

    // fromBlock/toBlock chegam como tag ("latest", "earliest"...) OU como
    // número hex — o padrão JSON-RPC aceita os dois, mas o código original só
    // aceitava hex. viem's watchContractEvent (poll: true) manda "latest" como
    // toBlock com frequência (ex.: no primeiro poll após reconectar, ou quando
    // strict:false), e cada chamada real caía aqui como inválida — gerando o
    // "tapete" de 400 no console que nunca deixava os watchers de eventos
    // funcionarem de verdade.
    const rawFrom = filter.fromBlock ?? 'latest';
    const rawTo = filter.toBlock ?? 'latest';
    const fromIsTag = BLOCK_TAGS.has(rawFrom);
    const toIsTag = BLOCK_TAGS.has(rawTo);
    if (fromIsTag || toIsTag) return true; // sem número dos dois lados pra medir o range — deixa passar

    const from = parseBlockNumber(rawFrom);
    const to = parseBlockNumber(rawTo);
    return from !== null && to !== null && to >= from && to - from <= MAX_LOG_BLOCK_RANGE;
  }
  return true;
}

export function validateRpcPayload(payload) {
  const requests = Array.isArray(payload) ? payload : [payload];
  if (requests.length === 0 || requests.length > MAX_BATCH_SIZE) return false;
  return requests.every((item) => item && item.jsonrpc === '2.0'
    && ALLOWED_METHODS.has(item.method) && validateMethodParams(item));
}

export default async function handler(req, res) {
  cors(res, 'POST, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Barra o uso do proxy a partir de sites de terceiros. Não é defesa contra
  // scripts (que simplesmente não mandam Origin), mas impede o caso comum: um
  // site qualquer embutir este endpoint e queimar a cota do nó dedicado usando
  // o navegador dos visitantes dele.
  const origin = req.headers?.origin;
  if (origin && !allowedOrigins().includes(origin)) {
    return res.status(403).json({ error: 'Origem não autorizada para o proxy RPC.' });
  }

  const serializedBody = JSON.stringify(req.body ?? null);
  if (Buffer.byteLength(serializedBody) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Payload JSON-RPC excede o limite permitido.' });
  }
  if (!validateRpcPayload(req.body)) {
    return res.status(400).json({ error: 'Método JSON-RPC não permitido ou lote inválido.' });
  }
  const requestCost = Array.isArray(req.body) ? req.body.length : 1;
  if (!(await store.rateLimit(`rpc:${clientIp(req)}`, 120, 60, requestCost))) {
    return res.status(429).json({ error: 'Limite de RPC excedido. Aguarde um minuto.' });
  }

  try {
    const upstream = await fetch(process.env.ARC_RPC_URL || PUBLIC_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serializedBody,
      signal: AbortSignal.timeout(8_000),
    });
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(upstream.status).send(body);
  } catch (error) {
    return res.status(502).json({ error: 'RPC upstream indisponível.', detail: error?.message });
  }
}

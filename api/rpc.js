/**
 * Proxy JSON-RPC público com rate limit. Mantém ARC_RPC_URL somente no servidor
 * e evita publicar a credencial do provedor nos bundles web/mobile.
 */
import { store, clientIp, cors } from './_stepless.js';

const PUBLIC_RPC_URL = 'https://rpc.testnet.arc.network';
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
  'eth_sendRawTransaction', 'net_version', 'web3_clientVersion',
]);

function hexByteLength(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)
    ? Math.ceil((value.length - 2) / 2)
    : null;
}

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
  if (item.method === 'eth_getLogs') {
    const filter = params[0];
    if (params.length !== 1 || !filter || typeof filter !== 'object') return false;
    if (filter.blockHash) return /^0x[0-9a-fA-F]{64}$/.test(filter.blockHash);
    const from = parseBlockNumber(filter.fromBlock);
    const to = parseBlockNumber(filter.toBlock);
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
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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

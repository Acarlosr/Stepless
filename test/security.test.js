import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdminSecret } from '../api/_stepless.js';
import { validateRpcPayload } from '../api/rpc.js';

function responseDouble() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('admin mutations fail closed when no secret is configured', () => {
  const previousAdmin = process.env.ADMIN_API_SECRET;
  const previousVerify = process.env.VERIFY_SECRET;
  delete process.env.ADMIN_API_SECRET;
  delete process.env.VERIFY_SECRET;
  const res = responseDouble();
  assert.equal(requireAdminSecret({ headers: {} }, res), false);
  assert.equal(res.statusCode, 503);
  if (previousAdmin) process.env.ADMIN_API_SECRET = previousAdmin;
  if (previousVerify) process.env.VERIFY_SECRET = previousVerify;
});

test('admin mutations require an exact credential', () => {
  const previous = process.env.ADMIN_API_SECRET;
  process.env.ADMIN_API_SECRET = 'correct-secret';
  const denied = responseDouble();
  assert.equal(requireAdminSecret({ headers: { 'x-admin-secret': 'wrong-secret' } }, denied), false);
  assert.equal(denied.statusCode, 401);
  assert.equal(requireAdminSecret({ headers: { 'x-admin-secret': 'correct-secret' } }, responseDouble()), true);
  if (previous) process.env.ADMIN_API_SECRET = previous;
  else delete process.env.ADMIN_API_SECRET;
});

test('RPC proxy accepts read calls and rejects privileged/debug calls', () => {
  assert.equal(validateRpcPayload({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), true);
  assert.equal(validateRpcPayload({ jsonrpc: '2.0', id: 1, method: 'debug_traceTransaction', params: [] }), false);
  assert.equal(validateRpcPayload(Array.from({ length: 21 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'eth_chainId' }))), false);
  assert.equal(validateRpcPayload({
    jsonrpc: '2.0', id: 2, method: 'eth_getLogs',
    params: [{ fromBlock: '0x1', toBlock: '0x1389' }],
  }), true);
  assert.equal(validateRpcPayload({
    jsonrpc: '2.0', id: 3, method: 'eth_getLogs',
    params: [{ fromBlock: '0x1', toBlock: '0x138a' }],
  }), false);
  assert.equal(validateRpcPayload({
    jsonrpc: '2.0', id: 4, method: 'eth_call', params: [{ data: `0x${'00'.repeat(32 * 1024 + 1)}` }],
  }), false);
});

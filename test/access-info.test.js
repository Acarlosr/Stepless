/**
 * test/access-info.test.js — estado de acessibilidade e barreiras (api/relay.js).
 * Registrar "sem acessibilidade" é tão útil quanto registrar uma rampa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
const { accessInfo } = await import('../api/relay.js');

test('APK antigo (sem campo access, só recursos) continua "acessível"', () => {
  assert.deepEqual(accessInfo({ categories: [0, 2] }), { access: 'ok', stepHeight: null });
});

test('só barreiras vira "sem acessibilidade"', () => {
  assert.equal(accessInfo({ categories: [20] }).access, 'none');
});

test('recurso + barreira vira "parcial"', () => {
  assert.equal(accessInfo({ categories: [0, 22] }).access, 'partial');
});

test('"acessível" com barreira marcada é corrigido', () => {
  assert.equal(accessInfo({ access: 'ok', categories: [20] }).access, 'none');
});

test('altura do degrau só vale com a barreira "degrau" (20)', () => {
  assert.equal(accessInfo({ access: 'none', categories: [20], stepHeight: 'high' }).stepHeight, 'high');
  assert.equal(accessInfo({ access: 'none', categories: [21], stepHeight: 'high' }).stepHeight, null);
  assert.equal(accessInfo({ access: 'none', categories: [20], stepHeight: 'gigante' }).stepHeight, null);
});

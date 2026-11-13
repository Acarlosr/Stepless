import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPhotoAI, interpret, parseModelJson } from '../api/_ai.js';
import { scoreSubmission } from '../api/_risk.js';

const okFetch = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });

test('sem chave a IA fica desligada e não pesa', async () => {
  delete process.env.OPENROUTER_API_KEY;
  const r = await checkPhotoAI({ imageUrl: 'https://x/ipfs/a', categories: [0] });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.risk, 0);
});

test('modelo confirma o recurso: match sem risco e com texto alternativo', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  const r = await checkPhotoAI({
    imageUrl: 'https://x/ipfs/a', categories: [0],
    fetchImpl: okFetch('```json\n{"declared_visible":true,"is_place_photo":true,"confidence":0.9,"seen":["rampa"],"alt":"Rampa de concreto com corrimão na entrada de uma loja"}\n```'),
  });
  assert.equal(r.verdict, 'match');
  assert.equal(r.risk, 0);
  assert.match(r.alt, /Rampa/);
});

test('recurso ausente com confiança alta vira mismatch; confiança baixa não', () => {
  assert.equal(interpret({ declared_visible: false, is_place_photo: true, confidence: 0.8 }).verdict, 'mismatch');
  assert.equal(interpret({ declared_visible: false, is_place_photo: true, confidence: 0.3 }).verdict, 'unclear');
  assert.equal(interpret({ declared_visible: null, is_place_photo: false, confidence: 0.9 }).verdict, 'not_place');
});

test('erro HTTP, timeout e lixo viram unknown', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  const r1 = await checkPhotoAI({ imageUrl: 'https://x', fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(r1.verdict, 'unknown');
  const r2 = await checkPhotoAI({ imageUrl: 'https://x', fetchImpl: okFetch('não sei') });
  assert.equal(r2.verdict, 'unknown');
  const r3 = await checkPhotoAI({ imageUrl: null });
  assert.equal(r3.verdict, 'unknown');
  assert.equal(parseModelJson('{quebrado'), null);
});

test('o score soma o risco da IA só quando ela está confiante', () => {
  const base = { exif: { hasGps: true }, gpsSource: 'exif', reputation: { submitted: 1 } };
  const a = scoreSubmission({ ...base, ai: { verdict: 'mismatch', risk: 20, reason: 'x' } });
  const b = scoreSubmission({ ...base, ai: { verdict: 'unknown', risk: 0, reason: 'y' } });
  assert.equal(a.score - b.score, 20);
});

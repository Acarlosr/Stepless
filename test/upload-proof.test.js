/**
 * test/upload-proof.test.js — O caminho da prova da foto, com imagens reais.
 *
 * As fixtures em test/fixtures/ são JPEGs de verdade com EXIF injetado por
 * piexif. O EXIF injetado É o ponto: ele demonstra, dentro da própria suíte,
 * que metadado de imagem é gravável — e portanto que este endpoint eleva o
 * custo da fraude sem transformá-la em impossível.
 *
 * O teste `lê o GPS de uma foto que tem GPS` existe por um motivo específico:
 * a primeira versão deste código usava
 *
 *     exifr.parse(buffer, { gps: true, pick: ['latitude', 'longitude', ...] })
 *
 * e `latitude`/`longitude` NÃO são tags do arquivo — o exifr as calcula a
 * partir do bloco GPS. O `pick` filtrava as duas, então toda foto era lida como
 * "sem GPS". Com EXIF_REQUIRED=true (o padrão), isso rejeitaria 100% das
 * submissões legítimas, em silêncio, com uma mensagem que culpava o usuário.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => fs.readFileSync(path.join(HERE, 'fixtures', n));
const dataUrl = (n, mime = 'image/jpeg') => `data:${mime};base64,${fixture(n).toString('base64')}`;

// O guard de armazenamento exige as envs; a URL inalcançável faz o store cair
// no fallback em memória, que é o que queremos para testar isolado.
process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
process.env.REQUIRE_PHOTO_STORAGE = 'false'; // sem Pinata nos testes

const { default: upload, photoHashKey } = await import('../api/upload.js');
const { store } = await import('../api/_stepless.js');

function fakeRes() {
  const r = {
    code: null, body: null,
    setHeader() {}, end() { return r; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

let ipCounter = 0;
function post(image, user = `0x${'a'.repeat(40)}`) {
  const res = fakeRes();
  // IP único por chamada: o rate limit é global no módulo.
  const req = {
    method: 'POST',
    headers: { origin: 'https://www.stepless.lat', 'x-forwarded-for': `10.0.0.${++ipCounter % 250}` },
    body: { image, userAddress: user },
  };
  return upload(req, res).then(() => res);
}

// ════════════════════════════════════════════════════════════════════════════
//  Leitura do EXIF
// ════════════════════════════════════════════════════════════════════════════

test('lê o GPS de uma foto que tem GPS', async () => {
  const res = await post(dataUrl('com-gps.jpg'));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.exif.hasGps, true, 'regressão: o GPS voltou a ser filtrado pelo `pick` do exifr');
  assert.ok(res.body.dataHash.startsWith('0x'));
  assert.equal(res.body.dataHash.length, 66);
});

test('reporta ausência de GPS sem inventar coordenadas', async () => {
  const res = await post(dataUrl('sem-gps.jpg'));
  assert.equal(res.code, 200);
  assert.equal(res.body.exif.hasGps, false);
});

test('o dataHash é o keccak256 dos bytes enviados', async () => {
  const { keccak256 } = await import('viem');
  const res = await post(dataUrl('com-gps.jpg'));
  assert.equal(res.body.dataHash, keccak256(fixture('com-gps.jpg')));
});

// ════════════════════════════════════════════════════════════════════════════
//  Sinais forenses
// ════════════════════════════════════════════════════════════════════════════

test('marca GPS sem dados de câmera como sinal suspeito', async () => {
  // Uma câmera que grava GPS também grava marca, modelo e exposição. GPS
  // sozinho é o padrão de quem injetou coordenadas num arquivo qualquer.
  const res = await post(dataUrl('gps-sem-camera.jpg'));
  assert.equal(res.code, 200);
  assert.ok(
    res.body.exif.flags.includes('gps-sem-camera'),
    `esperava o sinal gps-sem-camera, veio ${JSON.stringify(res.body.exif.flags)}`,
  );
});

test('uma foto de câmera coerente não levanta sinais', async () => {
  const res = await post(dataUrl('com-gps.jpg'));
  assert.deepEqual(res.body.exif.flags, []);
});

// ════════════════════════════════════════════════════════════════════════════
//  Validação do arquivo
// ════════════════════════════════════════════════════════════════════════════

test('rejeita imagem pequena demais para ser evidência', async () => {
  const res = await post(dataUrl('miniatura.jpg'));
  assert.equal(res.code, 422);
  assert.match(res.body.error, /pequena demais/i);
});

test('rejeita arquivo cujo tipo declarado não bate com os bytes', async () => {
  // O MIME da data URL vem do cliente. Vale o que os bytes dizem.
  const res = await post(dataUrl('na-verdade.png', 'image/jpeg'));
  assert.equal(res.code, 400);
  assert.match(res.body.error, /bytes são de image\/png/i);
});

test('rejeita conteúdo que não é imagem', async () => {
  const res = await post(`data:image/jpeg;base64,${Buffer.from('isto nao e uma imagem, so texto').toString('base64')}`);
  assert.equal(res.code, 400);
});

test('rejeita userAddress inválido', async () => {
  const res = await post(dataUrl('com-gps.jpg'), 'nao-e-endereco');
  assert.equal(res.code, 400);
});

// ════════════════════════════════════════════════════════════════════════════
//  Reuso da mesma imagem
// ════════════════════════════════════════════════════════════════════════════

test('a mesma foto não serve para uma segunda contribuição', async () => {
  // Fixture própria: consumir o hash é irreversível dentro da suíte, então
  // usar com-gps.jpg aqui quebraria os testes seguintes.
  const first = await post(dataUrl('gps-sem-camera.jpg'));
  assert.equal(first.code, 200);

  // Simula o que o relay faz ao consumir o token.
  await store.setJSON(photoHashKey(first.body.dataHash), { ts: Date.now() });

  // Token de uso único não bastava: era só subir o arquivo de novo e receber
  // um token novo. Uma foto de rampa baixada da internet registraria dezenas
  // de locais.
  const second = await post(dataUrl('gps-sem-camera.jpg'), `0x${'b'.repeat(40)}`);
  assert.equal(second.code, 409);
  assert.match(second.body.error, /já foi usada/i);

  // E vale entre carteiras diferentes — sybil não contorna.
  const third = await post(dataUrl('gps-sem-camera.jpg'), `0x${'c'.repeat(40)}`);
  assert.equal(third.code, 409);
});

// ════════════════════════════════════════════════════════════════════════════
//  Limite reconhecido
// ════════════════════════════════════════════════════════════════════════════

test('DOCUMENTADO: EXIF bem forjado passa — não é prova de presença', async () => {
  // com-gps.jpg é um retângulo cinza gerado por script, com EXIF de iPhone
  // inteiramente inventado. Ele passa em tudo, e DEVE passar: nenhuma checagem
  // de metadado distingue isto de uma foto real.
  //
  // Este teste existe para que a limitação seja visível na suíte, e não só num
  // comentário. Se algum dia ele começar a falhar porque alguém adicionou uma
  // verificação mais forte (attestation de câmera, prova de localização
  // assinada pelo dispositivo), atualize-o — será uma boa notícia.
  const res = await post(dataUrl('com-gps.jpg'));
  assert.equal(res.code, 200);
  assert.equal(res.body.exif.hasGps, true);
  assert.deepEqual(res.body.exif.flags, [], 'a imagem forjada não é distinguível por metadados');
});

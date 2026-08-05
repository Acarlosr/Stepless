/**
 * test/antifraude.test.js — Cenários do anti-fraude de submissão de locais.
 *
 * O caso que originou tudo isto: alguém fotografa a porta da casa do vizinho e
 * declara que é uma padaria. O EXIF bate (a pessoa esteve mesmo lá), então a
 * checagem de GPS sozinha aprova. Os testes abaixo fixam o comportamento das
 * camadas que passaram a responder "isso é MESMO uma padaria?".
 *
 * O Overpass é sempre mockado: teste que depende de serviço público externo
 * quebra sozinho e treina a equipe a ignorar a suíte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlace, declaredType, _internals } from '../api/_placecheck.js';
import { scoreSubmission } from '../api/_risk.js';

const LAT = -23.550520;
const LNG = -46.633308;

/** Ponto a ~30m ao norte da coordenada declarada (dentro do raio de busca). */
const near = (offset = 0.00027) => ({ lat: LAT + offset, lon: LNG });

/** Substitui o fetch global pela resposta canônica do Overpass. */
function mockOverpass(elements) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ elements }) });
}

function mockOverpassDown() {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
}

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

/* ─── Cross-check com o OpenStreetMap ────────────────────────────────────── */

test('padaria que existe de verdade é confirmada pela tag do OSM', async () => {
  mockOverpass([
    { type: 'node', ...near(), tags: { shop: 'bakery', name: 'Padaria e Confeitaria Sao Jorge' } },
  ]);
  const r = await checkPlace({ lat: LAT, lng: LNG, name: 'Padaria São Jorge' });
  assert.equal(r.verdict, 'type_match');
  assert.equal(r.risk, 0);
});

test('padaria inventada em área bem mapeada cai em type_mismatch', async () => {
  // A área tem comércio mapeado — logo o OSM conhece este quarteirão — e
  // mesmo assim não há nenhuma padaria. É o sinal mais forte de invenção.
  mockOverpass([
    { type: 'node', ...near(), tags: { amenity: 'bank', name: 'Banco X' } },
    { type: 'node', ...near(0.0003), tags: { shop: 'clothes', name: 'Loja Y' } },
    { type: 'node', ...near(0.0004), tags: { amenity: 'restaurant', name: 'Rest Z' } },
  ]);
  const r = await checkPlace({ lat: LAT, lng: LNG, name: 'Padaria do Zé' });
  assert.equal(r.verdict, 'type_mismatch');
  assert.ok(r.risk >= 40);
});

test('porta de casa em rua residencial cai em residential_only', async () => {
  mockOverpass([
    { type: 'way', center: near(), tags: { building: 'house' } },
    { type: 'way', center: near(0.0003), tags: { landuse: 'residential' } },
  ]);
  const r = await checkPlace({ lat: LAT, lng: LNG, name: 'Farmácia Popular' });
  assert.equal(r.verdict, 'residential_only');
});

test('área sem nada mapeado é inconclusiva, não acusação', async () => {
  // Boa parte da periferia e da zona rural brasileira não está no OSM. Tratar
  // isso como fraude excluiria justamente quem mais precisa do app.
  mockOverpass([]);
  const r = await checkPlace({ lat: LAT, lng: LNG, name: 'Padaria do Zé' });
  assert.equal(r.verdict, 'unmapped');
  assert.ok(r.risk < 20, 'ausência de mapeamento não pode pesar como fraude');
});

test('Overpass fora do ar nunca pune o usuário', async () => {
  mockOverpassDown();
  const r = await checkPlace({ lat: LAT, lng: LNG, name: 'Padaria do Zé' });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.risk, 0, 'infraestrutura de terceiros não pode virar acusação');
});

test('mobiliário urbano não conta como comércio', async () => {
  // Sem o filtro, um banco de praça (amenity=bench) faria uma rua puramente
  // residencial parecer uma área comercial.
  mockOverpass([
    { type: 'node', ...near(), tags: { amenity: 'bench' } },
    { type: 'way', center: near(), tags: { building: 'house' } },
  ]);
  const r = await checkPlace({ lat: LAT, lng: LNG, name: 'Mercado Bom Preço' });
  assert.equal(r.verdict, 'residential_only');
});

test('padaria vizinha não serve de álibi para uma padaria de outro nome', async () => {
  // Regressão do bug real: "Padaria do Zé" e "Padaria da Maria" davam 0,67 de
  // similaridade só por compartilharem a palavra "padaria" — acima do limiar
  // de 0,6. Na prática, a padaria de verdade do outro lado da rua CONFIRMAVA
  // a padaria inventada na porta da casa do vizinho.
  mockOverpass([
    { type: 'node', ...near(), tags: { shop: 'bakery', name: 'Padaria da Maria' } },
  ]);
  const r = await checkPlace({ lat: LAT, lng: LNG, name: 'Padaria do Zé' });
  assert.ok(r.nameSimilarity < 0.6, 'nomes diferentes não podem se confirmar');
});

/* ─── Detecção do tipo declarado ─────────────────────────────────────────── */

test('sinônimos comuns em PT-BR são reconhecidos', () => {
  assert.equal(declaredType('Drogaria Silva')?.label, 'farmácia');
  assert.equal(declaredType('UBS Vila Nova')?.label, 'clínica');
  assert.equal(declaredType('Panificadora Central')?.label, 'padaria');
  assert.equal(declaredType('Casa do João'), null, 'nome sem tipo não deve inventar um');
});

/* ─── Similaridade de nomes ──────────────────────────────────────────────── */

test('similaridade compara identidade, não tipo de negócio', () => {
  const sim = _internals.nameSimilarity;
  assert.ok(sim('Padaria do Zé', 'Padaria da Maria') < 0.6);
  assert.ok(sim('Farmácia Popular', 'Drogaria São Paulo') < 0.6);
  assert.ok(sim('Mercado Bom Preço', 'Supermercado Bom Preço') >= 0.6);
  assert.ok(sim('Padaria São Jorge', 'Padaria e Confeitaria Sao Jorge') >= 0.6);
});

/* ─── Score de risco ─────────────────────────────────────────────────────── */

const nowIso = () => new Date().toISOString();

test('sem prova de captura em área residencial vira risco alto', () => {
  const s = scoreSubmission({
    exif: { hasGps: false },
    place: { verdict: 'residential_only', risk: 35, reason: 'só casas' },
    reputation: { approved: 0, rejected: 0, submitted: 0 },
    gpsSource: null,
    photoTs: nowIso(),
  });
  assert.equal(s.level, 'high');
  assert.ok(s.top.length > 0, 'o verificador precisa ver os motivos, não só o número');
});

test('EXIF real + confirmação no OSM + carteira limpa vira risco baixo', () => {
  const s = scoreSubmission({
    exif: { hasGps: true, distKm: 0.02 },
    place: { verdict: 'type_match', risk: 0, reason: 'confirmado' },
    reputation: { approved: 5, rejected: 0, submitted: 5 },
    gpsSource: 'exif',
    photoTs: nowIso(),
  });
  assert.equal(s.level, 'low');
});

test('Overpass indisponível não empurra a submissão para risco alto', () => {
  const s = scoreSubmission({
    exif: { hasGps: true, distKm: 0.02 },
    place: { verdict: 'unknown', risk: 0, reason: 'indisponível' },
    reputation: { approved: 0, rejected: 0, submitted: 1 },
    gpsSource: 'device',
    photoTs: nowIso(),
  });
  assert.equal(s.level, 'low');
});

test('APK antigo não tira nota melhor que app atualizado honesto', () => {
  // Regressão: as versões até a 1.1.0 mandavam a coordenada declarada como
  // prova dela mesma (distância sempre 0m) e não declaravam `gpsSource`. Sem
  // penalizar a origem desconhecida, o app velho pontuava MELHOR que o novo
  // que admite ter usado o GPS do aparelho — e valeria a pena não atualizar.
  const base = {
    exif: { hasGps: true, distKm: 0 },
    place: { verdict: 'commercial_nearby', risk: 10, reason: '' },
    reputation: { approved: 1, rejected: 0, submitted: 1 },
    photoTs: nowIso(),
  };
  const apkAntigo = scoreSubmission({ ...base, gpsSource: null });
  const appAtual = scoreSubmission({ ...base, gpsSource: 'device' });
  const appIdeal = scoreSubmission({ ...base, gpsSource: 'exif' });

  assert.ok(apkAntigo.score > appAtual.score, 'origem desconhecida tem que custar mais que GPS declarado');
  assert.ok(appAtual.score > appIdeal.score, 'EXIF continua sendo a prova mais forte');
});

test('histórico de rejeições encarece a próxima tentativa', () => {
  const base = {
    exif: { hasGps: true, distKm: 0.02 },
    place: { verdict: 'commercial_nearby', risk: 10, reason: '' },
    gpsSource: 'exif',
    photoTs: nowIso(),
  };
  const limpa = scoreSubmission({ ...base, reputation: { approved: 1, rejected: 0, submitted: 1 } });
  const suja = scoreSubmission({ ...base, reputation: { approved: 0, rejected: 3, submitted: 3 } });
  assert.ok(suja.score > limpa.score, 'rejeitar precisa ter custo, senão fraudar sai de graça');
});

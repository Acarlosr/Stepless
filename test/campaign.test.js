import test from 'node:test';
import assert from 'node:assert/strict';

const {
  canonicalMeta, metaRefOf, matchesRules, pickCampaign, distanceKm, attesterAccount,
} = await import('../api/_campaign.js');

const BASE = { title: 'Centro de Maceió', zone: { lat: -9.6658, lng: -35.7353, radiusKm: 2 }, categories: [2, 0] };

test('regras canônicas: ordem e arredondamento fixos geram o mesmo hash', () => {
  const a = canonicalMeta(BASE);
  const b = canonicalMeta({ categories: [0, 2, 2], zone: { radiusKm: '2', lng: -35.73530001, lat: -9.6658 }, title: '  Centro   de Maceió ' });
  assert.deepEqual(a, b);
  assert.deepEqual(a.categories, [0, 2]);
  assert.equal(metaRefOf(a), metaRefOf(b));
  assert.match(metaRefOf(a), /^0x[0-9a-f]{64}$/);
});

test('regras diferentes geram hash diferente', () => {
  assert.notEqual(metaRefOf(BASE), metaRefOf({ ...BASE, zone: { ...BASE.zone, radiusKm: 3 } }));
  assert.notEqual(metaRefOf(BASE), metaRefOf({ ...BASE, categories: [0] }));
});

test('regras inválidas são recusadas com mensagem', () => {
  assert.throws(() => canonicalMeta({ ...BASE, title: 'ab' }), /Título/);
  assert.throws(() => canonicalMeta({ ...BASE, zone: { ...BASE.zone, lat: 91 } }), /Latitude/);
  assert.throws(() => canonicalMeta({ ...BASE, zone: { ...BASE.zone, radiusKm: 500 } }), /Raio/);
  assert.throws(() => canonicalMeta({ ...BASE, categories: [99] }), /Categoria/);
  assert.throws(() => canonicalMeta({ ...BASE, title: '<>' }), /Título/);
  // HTML não passa: os sinais são removidos do título.
  assert.equal(canonicalMeta({ ...BASE, title: '<b>Centro</b>' }).title, 'b Centro /b');
});

test('distância: Maceió centro → Pajuçara fica em poucos km', () => {
  const d = distanceKm(-9.6658, -35.7353, -9.6672, -35.7120);
  assert.ok(d > 2 && d < 3, `distância ${d}`);
});

test('match: dentro da zona e com categoria da campanha', () => {
  const meta = canonicalMeta(BASE);
  assert.equal(matchesRules(meta, { lat: -9.6660, lng: -35.7350, categories: [2] }).ok, true);
});

test('match: fora da zona, categoria errada ou sem coordenadas não paga', () => {
  const meta = canonicalMeta(BASE);
  assert.equal(matchesRules(meta, { lat: -9.6672, lng: -35.7120, categories: [0] }).reason, 'fora da zona');
  assert.equal(matchesRules(meta, { lat: -9.6660, lng: -35.7350, categories: [5] }).reason, 'categoria fora da campanha');
  assert.equal(matchesRules(meta, { lat: null, lng: null, categories: [0] }).reason, 'contribuição sem coordenadas');
});

test('match: campanha sem categorias aceita qualquer categoria', () => {
  const meta = canonicalMeta({ ...BASE, categories: [] });
  assert.equal(matchesRules(meta, { lat: -9.6660, lng: -35.7350, categories: [7] }).ok, true);
});

test('escolha: usa primeiro a campanha que vence antes; empate pela mais antiga', () => {
  const c = (id, deadline) => ({ id: BigInt(id), deadline: BigInt(deadline) });
  assert.equal(pickCampaign([c(3, 500), c(1, 900), c(2, 300)]).id, 2n);
  assert.equal(pickCampaign([c(5, 300), c(4, 300)]).id, 4n);
  assert.equal(pickCampaign([]), null);
});

test('atestador não pode usar a mesma chave do relayer nem do verificador', () => {
  const k1 = '0x' + '11'.repeat(32);
  const k2 = '0x' + '22'.repeat(32);
  const k3 = '0x' + '33'.repeat(32);
  const save = { ...process.env };
  try {
    process.env.RELAYER_PRIVATE_KEY = k1;
    process.env.VERIFIER_PRIVATE_KEY = k2;

    process.env.ATTESTER_PRIVATE_KEY = k1;
    assert.throws(() => attesterAccount(), /RELAYER_PRIVATE_KEY/);
    process.env.ATTESTER_PRIVATE_KEY = k2.slice(2); // sem 0x também é pego
    assert.throws(() => attesterAccount(), /VERIFIER_PRIVATE_KEY/);

    process.env.ATTESTER_PRIVATE_KEY = k3;
    assert.match(attesterAccount().address, /^0x[0-9a-fA-F]{40}$/);

    delete process.env.ATTESTER_PRIVATE_KEY;
    assert.throws(() => attesterAccount(), /não configurada/);
  } finally {
    process.env = save;
  }
});

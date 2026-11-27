/**
 * test/campaign-proof.test.js — quando a campanha aceita a prova de presença.
 * Foto com GPS (forte) ou localização do celular no envio (mais apertada).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
const { locationProof, deviceEvidence } = await import('../api/_campaign.js');

const PONTO = { lat: -23.5423, lng: -46.4712 };

test('foto com GPS perto do ponto paga (via foto)', () => {
  const r = locationProof({ ...PONTO, photo: { hasGps: true, photoLat: -23.5425, photoLng: -46.4714 } });
  assert.deepEqual(r, { ok: true, via: 'photo' });
});

test('foto com GPS longe do ponto não paga', () => {
  const r = locationProof({ ...PONTO, photo: { hasGps: true, photoLat: -23.56, photoLng: -46.49 } });
  assert.equal(r.ok, false);
});

test('sem GPS na foto, celular preciso e perto paga (via celular)', () => {
  const device = deviceEvidence({ deviceLat: -23.5426, deviceLng: -46.4713, deviceAccuracyM: 12 }, PONTO.lat, PONTO.lng);
  assert.ok(device.distM < 150);
  assert.deepEqual(locationProof({ ...PONTO, photo: { hasGps: false, device } }), { ok: true, via: 'device' });
});

test('celular impreciso (±80 m) não paga', () => {
  const device = deviceEvidence({ deviceLat: PONTO.lat, deviceLng: PONTO.lng, deviceAccuracyM: 80 }, PONTO.lat, PONTO.lng);
  const r = locationProof({ ...PONTO, photo: { hasGps: false, device } });
  assert.equal(r.ok, false); assert.match(r.reason, /imprecisa/);
});

test('celular a mais de 150 m do ponto não paga', () => {
  const device = deviceEvidence({ deviceLat: -23.5450, deviceLng: -46.4712, deviceAccuracyM: 10 }, PONTO.lat, PONTO.lng);
  const r = locationProof({ ...PONTO, photo: { hasGps: false, device } });
  assert.equal(r.ok, false); assert.match(r.reason, /m do ponto/);
});

test('sem nenhuma prova não paga', () => {
  assert.equal(locationProof({ ...PONTO, photo: { hasGps: false } }).ok, false);
});

test('app v1.3 (gpsSource=device + precisão) usa o próprio ponto declarado', () => {
  const d = deviceEvidence({ gpsSource: 'device', gpsAccuracyM: 20 }, PONTO.lat, PONTO.lng);
  assert.equal(d.distM, 0); assert.equal(d.source, 'app');
  assert.equal(locationProof({ ...PONTO, photo: { hasGps: false, device: d } }).ok, true);
});

test('dados inválidos são ignorados', () => {
  assert.equal(deviceEvidence({ deviceLat: 'x', deviceLng: 1, deviceAccuracyM: 5 }, PONTO.lat, PONTO.lng), null);
  assert.equal(deviceEvidence({}, PONTO.lat, PONTO.lng), null);
});

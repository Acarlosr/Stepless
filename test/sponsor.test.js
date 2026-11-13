import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_API_SECRET = 'segredo-de-teste';
const { default: handler, brandRefFor } = await import('../api/sponsor.js');

function call(method, body, headers = {}) {
  return new Promise((resolve) => {
    const req = { method, body, headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers }, query: {}, socket: {} };
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    handler(req, res);
  });
}

test('lead fica pendente e não aparece no GET público', async () => {
  const r = await call('POST', { brand: 'Marca Exemplo', email: 'contato@exemplo.com', url: 'https://exemplo.com' });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'pending');
  assert.equal(r.body.brandRef, brandRefFor(r.body.id));
  const g = await call('GET');
  assert.ok(!g.body.sponsors.some((s) => s.id === r.body.id));
});

test('aprovação exige segredo e depois a marca aparece sem e-mail', async () => {
  const r = await call('POST', { brand: 'Outra Marca', email: 'a@b.com', url: 'http://inseguro.com', logoUrl: 'https://cdn.exemplo.com/l.png' });
  const denied = await call('POST', { action: 'approve', id: r.body.id });
  assert.notEqual(denied.status, 200);
  const ok = await call('POST', { action: 'approve', id: r.body.id }, { 'x-admin-secret': 'segredo-de-teste' });
  assert.equal(ok.status, 200);
  const g = await call('GET');
  const s = g.body.sponsors.find((x) => x.id === r.body.id);
  assert.ok(s);
  assert.equal(s.url, null, 'http não é aceito');
  assert.equal(s.logoUrl, 'https://cdn.exemplo.com/l.png');
  assert.equal(JSON.stringify(g.body).includes('a@b.com'), false, 'e-mail nunca é público');
});

test('rejeita e-mail inválido e remove HTML do texto', async () => {
  const bad = await call('POST', { brand: 'X Marca', email: 'sem-arroba' });
  assert.equal(bad.status, 400);
  const r = await call('POST', { brand: '<script>alert(1)</script>Loja', email: 'ok@ok.com' });
  assert.equal(r.status, 201);
});

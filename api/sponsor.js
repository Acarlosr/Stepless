/**
 * api/sponsor.js — Patrocínio com marca ("Apoiadores"). Sem dinheiro passando por aqui.
 *
 * GET  /api/sponsor                      → marcas APROVADAS (campos públicos)
 * POST /api/sponsor {brand,email,url,logoUrl,message}
 *                                        → registra interesse (status "pending") e
 *                                          devolve o `brandRef` para usar no contrato:
 *                                          distributor.sponsorTreasury(amount, brandRef)
 * POST /api/sponsor {action:'approve'|'reject', id}   (header x-admin-secret)
 *                                        → moderação
 *
 * Regras de segurança/privacidade:
 *  - o dinheiro vai direto ao contrato (sponsorTreasury); esta rota nunca move USDC;
 *  - o e-mail fica só no servidor e NUNCA é devolvido pelo GET;
 *  - nada aparece publicamente antes de aprovação manual (evita golpe/propaganda ilegal);
 *  - só https para link/logo; a página renderiza com textContent (sem HTML do usuário);
 *  - aprovar uma marca não é endosso da marca nem vice-versa: exibir logo de empresa
 *    só com autorização dela.
 */

import { keccak256, toHex } from 'viem';
import { randomUUID } from 'node:crypto';
import { store, cors, clientIp, requireAdminSecret } from './_stepless.js';

const LIST_KEY = 'stepless:sponsors:ids';
const key = (id) => `stepless:sponsor:${id}`;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanHttps(v) {
  if (!v) return null;
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString().slice(0, 300) : null;
  } catch { return null; }
}

export function brandRefFor(id) {
  return keccak256(toHex(`stepless-sponsor:${id}`));
}

function publicView(r) {
  return { id: r.id, brand: r.brand, url: r.url, logoUrl: r.logoUrl, message: r.message, brandRef: r.brandRef };
}

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const ids = await store.listAll(LIST_KEY, 200);
    const rows = (await Promise.all(ids.map((id) => store.getJSON(key(id))))).filter((r) => r && r.status === 'approved');
    return res.status(200).json({ success: true, sponsors: rows.map(publicView) });
  }

  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  // ── Moderação ────────────────────────────────────────────────────────────
  if (body.action === 'approve' || body.action === 'reject') {
    if (!requireAdminSecret(req, res)) return;
    const id = cleanText(body.id, 64);
    const row = id ? await store.getJSON(key(id)) : null;
    if (!row) return res.status(404).json({ success: false, error: 'Patrocinador não encontrado.' });
    row.status = body.action === 'approve' ? 'approved' : 'rejected';
    row.moderatedAt = new Date().toISOString();
    await store.setJSON(key(id), row);
    return res.status(200).json({ success: true, id, status: row.status });
  }

  // ── Novo interesse ───────────────────────────────────────────────────────
  const ip = clientIp(req);
  if (!(await store.rateLimit(`sponsor:${ip}`, 5, 3600))) {
    return res.status(429).json({ success: false, error: 'Muitas tentativas. Tente novamente em 1 hora.' });
  }

  const brand = cleanText(body.brand, 60);
  const email = cleanText(body.email, 200).toLowerCase();
  if (brand.length < 2) return res.status(400).json({ success: false, error: 'Informe o nome da marca.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'E-mail inválido.' });

  const id = randomUUID();
  const row = {
    id,
    brand,
    email, // privado: nunca sai em publicView
    url: cleanHttps(body.url),
    logoUrl: cleanHttps(body.logoUrl),
    message: cleanText(body.message, 140),
    brandRef: brandRefFor(id),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await store.setJSON(key(id), row);
  await store.listPush(LIST_KEY, id);

  return res.status(201).json({
    success: true,
    id,
    brandRef: row.brandRef,
    status: 'pending',
    next: 'Aprovação manual antes de aparecer no site. Para registrar o aporte, chame sponsorTreasury(amount, brandRef) no RewardDistributor.',
  });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

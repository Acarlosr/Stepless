/**
 * api/pending.js — Contribuições pendentes de verificação.
 *
 * GET  /api/pending              → lista PÚBLICA mínima (sem risco, IA, foto,
 *                                  coordenadas). Usada pelo app para mostrar
 *                                  "seus envios pendentes".
 * GET  /api/pending?user=0x…     → mesma lista, só daquela carteira.
 * POST /api/pending { auth }     → lista COMPLETA, só para verificador on-chain
 *                                  com assinatura de leitura válida (30 min).
 *
 * Por quê (relatório de segurança, M4): a lista completa trazia o score de
 * risco e os motivos — quem quer fraudar via exatamente o que derruba a nota e
 * ajustava a próxima tentativa. Também trazia as coordenadas lidas da foto.
 */

import {
  store, contribKey, PENDING_LIST_KEY, cors, clientIp, verifyQueueRequest,
} from './_stepless.js';
import { getReputation } from './_risk.js';

/** Campos que qualquer pessoa pode ver (o app v1.2.0 usa user, status, name, ts). */
function publicView(id, meta) {
  return {
    contributionId: id,
    user: meta.user ?? null,
    locationHash: meta.locationHash ?? null,
    name: meta.name ?? null,
    categories: Array.isArray(meta.categories) ? meta.categories : [],
    rewardType: meta.rewardType ?? null,
    status: meta.status,
    ts: meta.ts ?? null,
  };
}

async function loadPending() {
  const ids = await store.listAll(PENDING_LIST_KEY, 100);
  const out = [];
  for (const id of ids) {
    const meta = await store.getJSON(contribKey(id));
    if (meta && meta.status === 'pending') out.push({ id, meta });
  }
  return out;
}

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await store.rateLimit(`pending:${clientIp(req)}`, 30, 60))) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
  }

  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
      const domain = req.headers?.host || 'www.stepless.lat';
      const check = await verifyQueueRequest({ auth: body.auth, domain });
      if (!check.ok) return res.status(check.status).json({ error: check.error });
      const items = await loadPending();
      return res.status(200).json({
        full: true,
        pending: items.map(({ id, meta }) => ({ contributionId: id, ...meta })),
      });
    }

    const user = typeof req.query?.user === 'string' ? req.query.user.toLowerCase() : null;
    const items = await loadPending();
    const pending = items
      .filter(({ meta }) => !user || String(meta.user || '').toLowerCase() === user)
      .map(({ id, meta }) => publicView(id, meta));
    // Com ?user=, devolve também os totais da carteira (enviadas, aprovadas,
    // rejeitadas) — é o que o perfil do app mostra. Sem nova rota: o plano da
    // Vercel limita o número de funções.
    const stats = user && /^0x[0-9a-f]{40}$/.test(user)
      ? (({ submitted, approved, rejected }) => ({ submitted, approved, rejected }))(await getReputation(user))
      : undefined;
    return res.status(200).json({ full: false, pending, ...(stats ? { stats } : {}) });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

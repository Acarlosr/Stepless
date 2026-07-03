/**
 * api/pending.js — Lista contribuições pendentes de verificação.
 * GET /api/pending → { pending: [{ contributionId, user, locationHash, name, categories, rewardType, ts }] }
 */

import { store, contribKey, PENDING_LIST_KEY, cors } from './_stepless.js';

export default async function handler(req, res) {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const ids = await store.listAll(PENDING_LIST_KEY, 100);
    const pending = [];
    for (const id of ids) {
      const meta = await store.getJSON(contribKey(id));
      if (meta && meta.status === 'pending') pending.push({ contributionId: id, ...meta });
    }
    return res.status(200).json({ pending });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

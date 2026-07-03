/**
 * api/location-meta.js — Vercel Serverless Function
 * Busca nome + categorias de locais salvos fora da chain (Upstash Redis),
 * indexados por locationHash. O contrato SteplessOracle só guarda o hash —
 * nome e categorias são salvos aqui via api/relay.js no momento do
 * registerLocation.
 *
 * POST /api/location-meta
 * Body: { hashes: ['0x...', '0x...', ...] }
 * Resp: { meta: { '0xabc...': { name: 'Farol da Barra', categories: [0,3] }, ... } }
 *       ← hashes sem metadado salvo ficam de fora do objeto
 *
 * Variáveis de ambiente no Vercel:
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (free tier em upstash.com)
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Não configurado ainda — devolve vazio em vez de erro, frontend cai no fallback.
    return res.status(200).json({ meta: {}, configured: false });
  }

  const { hashes } = req.body || {};
  if (!Array.isArray(hashes) || hashes.length === 0) {
    return res.status(400).json({ success: false, error: 'Missing: hashes (array)' });
  }

  const cleanHashes = hashes.filter((h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h));
  if (cleanHashes.length === 0) {
    return res.status(200).json({ meta: {} });
  }

  try {
    // Upstash pipeline: uma requisição, N comandos GET
    const commands = cleanHashes.map((h) => ['GET', `stepless:loc:${h.toLowerCase()}`]);
    const pipeRes = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    if (!pipeRes.ok) {
      const errText = await pipeRes.text().catch(() => '');
      throw new Error(`Upstash pipeline error ${pipeRes.status}: ${errText}`);
    }

    const results = await pipeRes.json(); // [{ result: '{"name":...,"categories":[...]}' | null }, ...]
    const meta = {};
    cleanHashes.forEach((h, i) => {
      const raw = results[i]?.result;
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        meta[h.toLowerCase()] = {
          name: parsed.name || null,
          categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        };
      } catch {
        // Valor legado (string simples, só nome) — trata como nome sem categorias.
        meta[h.toLowerCase()] = { name: raw, categories: [] };
      }
    });

    return res.status(200).json({ meta, configured: true });
  } catch (err) {
    console.error('[location-meta] Error:', err);
    // Falha ao buscar metadados não deve quebrar a página de busca — devolve vazio.
    return res.status(200).json({ meta: {}, error: err?.message });
  }
}

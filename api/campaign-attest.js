/**
 * api/campaign-attest.js — Campanhas de parceiros (CampaignEscrow.sol).
 *
 * GET  /api/campaign-attest
 *      → campanhas ativas, com regras publicadas e progresso (para o site e o app)
 *
 * POST /api/campaign-attest { action: 'meta-ref', meta }
 *      → normaliza as regras e devolve o metaRef a usar em createCampaign().
 *        Não grava nada. O site chama isto ANTES de o parceiro assinar.
 *
 * POST /api/campaign-attest { action: 'publish-meta', campaignId, meta }
 *      → grava as regras de uma campanha já criada. Só aceita se o hash bater
 *        com o metaRef gravado on-chain — por isso não precisa de login:
 *        ninguém consegue publicar regras diferentes das que o parceiro assinou.
 *
 * POST /api/campaign-attest { action: 'attest', contributionId }
 *      → tenta pagar uma contribuição verificada por uma campanha compatível.
 *        Também não precisa de login: o atestador só paga quando a contribuição
 *        está verificada no Oracle e cumpre as regras publicadas, e o dinheiro
 *        vai sempre para o contribuidor registrado. Chamar isto à toa só gasta
 *        uma leitura. O /api/verify já chama automaticamente após aprovar.
 *
 * Variáveis: ATTESTER_PRIVATE_KEY (chave própria, diferente do relayer e do
 * verificador), CAMPAIGN_ESCROW_ADDRESS (ou config/networks.json), Upstash.
 */

import { publicClient, walletFor, store, cors, clientIp, translateError, requirePersistentStore } from './_stepless.js';
import {
  canonicalMeta, metaRefOf, campaignMetaKey, activeCampaigns, attestContribution,
  attesterAccount, escrowAddress, hasEscrow, CAMPAIGN_ABI,
} from './_campaign.js';

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function publicCampaign(c) {
  return {
    id: String(c.id),
    sponsor: c.sponsor,
    brandRef: c.brandRef,
    rewardPerItem: String(c.rewardPerItem),
    maxItems: String(c.maxItems),
    itemsPaid: String(c.itemsPaid),
    maxPerContributor: String(c.maxPerContributor),
    remaining: String(c.deposited - c.paidOut),
    deadline: Number(c.deadline),
    rules: c.rules,
    rulesVerified: c.rulesVerified,
  };
}

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!hasEscrow()) {
    return res.status(503).json({ success: false, error: 'Campanhas ainda não estão disponíveis nesta rede.' });
  }

  const pub = publicClient();

  if (req.method === 'GET') {
    try {
      const list = await activeCampaigns(pub);
      return res.status(200).json({ success: true, escrow: escrowAddress(), campaigns: list.map(publicCampaign) });
    } catch (err) {
      const t = translateError(err);
      return res.status(t.status).json({ success: false, error: t.error });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const action = body.action;

  if (!(await store.rateLimit(`campaign:${clientIp(req)}`, 20, 60))) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Aguarde um minuto.' });
  }

  // ── meta-ref: só calcula ─────────────────────────────────────────────────
  if (action === 'meta-ref') {
    try {
      const meta = canonicalMeta(body.meta);
      return res.status(200).json({ success: true, meta, metaRef: metaRefOf(meta) });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── publish-meta: grava regras que conferem com o on-chain ───────────────
  if (action === 'publish-meta') {
    if (!requirePersistentStore(res)) return;
    let id;
    try { id = BigInt(body.campaignId); } catch { id = 0n; }
    if (id < 1n) return res.status(400).json({ success: false, error: 'campaignId inválido.' });

    let meta;
    try { meta = canonicalMeta(body.meta); } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    try {
      const c = await pub.readContract({
        address: escrowAddress(), abi: CAMPAIGN_ABI, functionName: 'getCampaign', args: [id],
      });
      const ref = metaRefOf(meta);
      if (ref.toLowerCase() !== c.metaRef.toLowerCase()) {
        return res.status(409).json({
          success: false,
          error: 'Estas regras não são as que foram registradas na criação da campanha.',
          expected: c.metaRef, got: ref,
        });
      }
      await store.setJSON(campaignMetaKey(id), meta);
      return res.status(200).json({ success: true, campaignId: String(id), metaRef: ref });
    } catch (err) {
      const t = translateError(err);
      return res.status(t.status).json({ success: false, error: t.error });
    }
  }

  // ── attest: tenta pagar uma contribuição verificada ──────────────────────
  if (action === 'attest') {
    if (!requirePersistentStore(res)) return;
    const { contributionId } = body;
    if (!/^0x[0-9a-fA-F]{64}$/.test(contributionId || '')) {
      return res.status(400).json({ success: false, error: 'contributionId inválido (bytes32 esperado).' });
    }
    let wallet;
    try { wallet = walletFor(attesterAccount()); } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    try {
      const result = await attestContribution({ pub, wallet, contributionId });
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      console.error('[campaign-attest] Error:', err);
      const t = translateError(err);
      return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
    }
  }

  return res.status(400).json({ success: false, error: 'Ação desconhecida. Use meta-ref, publish-meta ou attest.' });
}

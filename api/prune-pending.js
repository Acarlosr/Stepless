/**
 * api/prune-pending.js — Remove da lista de pendências as contribuições que
 * NÃO existem mais no Oracle atual (órfãs de um redeploy de contratos).
 *
 * Contexto: a lista de pendências vive no Redis (Upstash), mas a contribuição
 * em si vive on-chain. Quando os contratos são redeployados, o Oracle novo
 * nasce vazio — as pendências antigas continuam aparecendo no painel, mas
 * qualquer tentativa de aprovar reverte com ContributionNotFound, porque o
 * contrato atual nunca ouviu falar daquele id. Este endpoint limpa esse
 * descompasso sem apagar nada que ainda seja válido.
 *
 * GET  /api/prune-pending  → diagnóstico: mostra quais estão órfãs (não apaga)
 * POST /api/prune-pending  → remove as órfãs da lista (exige X-Admin-Secret)
 *
 * O GET é aberto porque só lê o que /api/pending já expõe. O POST mexe na
 * lista, então é gated pela credencial administrativa.
 */

import {
  publicClient, oracleAddress,
  store, contribKey, PENDING_LIST_KEY, cors, translateError, requireAdminSecret,
} from './_stepless.js';

const ZERO = '0x0000000000000000000000000000000000000000';

// O mapping público `contributions` devolve a struct inteira. Não está na
// ORACLE_ABI compartilhada (que carrega só o mínimo usado pelos outros
// endpoints), então declaramos aqui.
//
// Por que não usar getContribution(): ela devolve (false, address(0), 0) tanto
// para "não existe" quanto para "existe e ainda não foi verificada" — os dois
// casos ficam indistinguíveis, e é exatamente essa distinção que precisamos.
const CONTRIBUTIONS_ABI = [
  {
    name: 'contributions', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'locationHash', type: 'bytes32' },
      { name: 'contributor', type: 'address' },
      { name: 'contributionType', type: 'uint8' },
      { name: 'dataHash', type: 'bytes32' },
      { name: 'verified', type: 'bool' },
      { name: 'verifier', type: 'address' },
      { name: 'verifiedBlock', type: 'uint256' },
      { name: 'rejected', type: 'bool' },
      { name: 'rejectReason', type: 'string' },
    ],
  },
];

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!process.env.ORACLE_ADDRESS) {
    return res.status(500).json({ success: false, error: 'ORACLE_ADDRESS não configurado.' });
  }
  if (req.method === 'POST' && !requireAdminSecret(req, res)) return;

  const pub = publicClient();
  const oracle = oracleAddress();

  try {
    const ids = await store.listAll(PENDING_LIST_KEY, 100);
    const orphans = [];
    const kept = [];

    for (const id of ids) {
      const meta = (await store.getJSON(contribKey(id))) || {};

      let contributor;
      try {
        const c = await pub.readContract({
          address: oracle, abi: CONTRIBUTIONS_ABI, functionName: 'contributions', args: [id],
        });
        contributor = String(c[1]);
      } catch (err) {
        // Falha de RPC NÃO pode virar "órfã" — apagaria pendência boa. Aborta
        // a operação inteira em vez de limpar com base em dado incerto.
        return res.status(503).json({
          success: false,
          error: 'Não foi possível consultar o Oracle na Arc. Tente de novo em alguns segundos.',
          detail: err?.shortMessage || err?.message,
        });
      }

      const entry = { contributionId: id, name: meta.name || null };
      (contributor.toLowerCase() === ZERO ? orphans : kept).push(entry);
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        oracle,
        total: ids.length,
        orphanCount: orphans.length,
        orphans,
        keptCount: kept.length,
        howTo: orphans.length
          ? 'POST neste mesmo endpoint (com X-Admin-Secret) para removê-las da lista.'
          : 'Nada a limpar.',
      });
    }

    for (const o of orphans) {
      await store.listRemove(PENDING_LIST_KEY, o.contributionId);
      const meta = (await store.getJSON(contribKey(o.contributionId))) || {};
      // Marca em vez de apagar: preserva o registro de que aquele envio
      // existiu, só tira da fila de aprovação.
      await store.setJSON(contribKey(o.contributionId), {
        ...meta, status: 'orphaned', orphanedAt: Date.now(), orphanedFromOracle: oracle,
      });
    }

    return res.status(200).json({
      success: true,
      removed: orphans.length,
      kept: kept.length,
      orphans,
    });
  } catch (err) {
    console.error('[prune-pending] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

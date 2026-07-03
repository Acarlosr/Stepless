/**
 * api/verify.js — Verifica uma contribuição on-chain e PAGA a recompensa.
 * Fecha o loop: verifyContribution (chave verificadora) → payReward (relayer)
 * com o USDC indo para a wallet REAL do contribuidor (não o relayer).
 *
 * POST /api/verify
 * Body: { contributionId: '0x...', approve: true|false, reason?: string, contributor?: '0x...' }
 * Header opcional: X-Verify-Secret (obrigatório se VERIFY_SECRET estiver setada)
 *
 * O endereço do contribuidor vem do storage (salvo pelo relay no registro);
 * `contributor` no body é usado como fallback se o storage não tiver o dado.
 */

import {
  publicClient, walletFor, relayerAccount, verifierAccount,
  oracleAddress, distributorAddress, ORACLE_ABI, DISTRIBUTOR_ABI,
  REWARD_TYPE, store, contribKey, PENDING_LIST_KEY, cors, clientIp, translateError,
} from './_stepless.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  if (!process.env.RELAYER_PRIVATE_KEY || !process.env.ORACLE_ADDRESS) {
    return res.status(500).json({ success: false, error: 'Relayer/Oracle não configurados no Vercel.' });
  }

  // Proteção opcional do endpoint
  if (process.env.VERIFY_SECRET && req.headers['x-verify-secret'] !== process.env.VERIFY_SECRET) {
    return res.status(401).json({ success: false, error: 'X-Verify-Secret inválido.' });
  }

  if (!(await store.rateLimit(`verify:${clientIp(req)}`, 10, 60))) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Aguarde um minuto.' });
  }

  const { contributionId, approve = true, reason = '', contributor: fallbackContributor } = req.body || {};
  if (!/^0x[0-9a-fA-F]{64}$/.test(contributionId || '')) {
    return res.status(400).json({ success: false, error: 'contributionId inválido (bytes32 esperado).' });
  }

  const pub = publicClient();
  const verifier = verifierAccount();
  const relayer = relayerAccount();

  try {
    // 1) Verificação on-chain com a chave do verificador
    const alreadyVerified = await pub.readContract({
      address: oracleAddress(), abi: ORACLE_ABI, functionName: 'getContribution', args: [contributionId],
    });

    let verifyTx = null;
    if (!alreadyVerified[0]) {
      verifyTx = await walletFor(verifier).writeContract({
        address: oracleAddress(),
        abi: ORACLE_ABI,
        functionName: 'verifyContribution',
        args: [contributionId, Boolean(approve), String(reason).slice(0, 200)],
      });
      await pub.waitForTransactionReceipt({ hash: verifyTx });
    }

    // Rejeição: registra e encerra (sem pagamento)
    const meta = (await store.getJSON(contribKey(contributionId))) || {};
    if (!approve) {
      await store.setJSON(contribKey(contributionId), { ...meta, status: 'rejected', reason, rejectedAt: Date.now() });
      await store.listRemove(PENDING_LIST_KEY, contributionId);
      return res.status(200).json({ success: true, approved: false, verifyTx });
    }

    // 2) Pagamento para a wallet REAL do usuário
    const recipient = meta.user || fallbackContributor;
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient || '')) {
      return res.status(422).json({
        success: false, verifyTx,
        error: 'Verificado on-chain, mas o endereço do contribuidor não foi encontrado. Reenvie com {contributor}.',
      });
    }

    const rewardType = REWARD_TYPE[meta.rewardType] ?? REWARD_TYPE.NewLocation;
    let payTx = null;
    const claimed = await pub.readContract({
      address: distributorAddress(), abi: DISTRIBUTOR_ABI, functionName: 'rewardClaimed', args: [contributionId],
    });
    if (!claimed) {
      payTx = await walletFor(relayer).writeContract({
        address: distributorAddress(),
        abi: DISTRIBUTOR_ABI,
        functionName: 'payReward',
        args: [contributionId, recipient, rewardType],
      });
      await pub.waitForTransactionReceipt({ hash: payTx });
    }

    await store.setJSON(contribKey(contributionId), {
      ...meta, status: 'paid', verifyTx, payTx, paidTo: recipient, paidAt: Date.now(),
    });
    await store.listRemove(PENDING_LIST_KEY, contributionId);

    return res.status(200).json({ success: true, approved: true, verifyTx, payTx, paidTo: recipient });
  } catch (err) {
    console.error('[verify] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

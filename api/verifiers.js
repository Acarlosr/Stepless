/**
 * api/verifiers.js — Consulta a lista de verificadores autorizados.
 *
 * GET /api/verifiers?addresses=0x..,0x..  → quem está autorizado
 *
 * ⚠️ O POST FOI REMOVIDO (auditoria de mainnet, achado C4).
 *
 * Conceder e revogar o poder de aprovar contribuições — e portanto de liberar
 * pagamentos — não deve acontecer por rota HTTP protegida por uma string em
 * env var. Com o admin sendo um multisig, isso vira uma transação assinada
 * pelos titulares:
 *
 *     distributor.setVerifier(<endereço>, true|false)
 *
 * Na v5 do contrato existe `setVerifier(addr, bool)`, uma remoção NEUTRA. Antes
 * a única forma de tirar alguém era `slashVerifier`, que além de revogar zerava
 * o `totalEarned` da pessoa — não havia como desligar sem punir, e quem sai da
 * equipe não é um fraudador. `slashVerifier` continua existindo, mas agora só
 * para o que o nome diz.
 *
 * O GET continua aberto de propósito: quem pode aprovar contribuições é
 * informação pública, e está na blockchain de qualquer forma.
 */

import { publicClient, distributorAddress, DISTRIBUTOR_ABI, cors, translateError } from './_stepless.js';
import { getAddress } from 'viem';

export default async function handler(req, res) {
  cors(res, 'GET, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Somente GET. Conceder ou revogar verificador saiu desta rota por segurança.',
      hint: 'Assine pelo multisig: distributor.setVerifier(<endereço>, true|false)',
    });
  }

  const raw = String(req.query?.addresses || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!raw.length) {
    return res.status(400).json({ success: false, error: 'Informe ?addresses=0x...,0x...' });
  }

  try {
    const pub = publicClient();
    const distributor = distributorAddress();
    const out = {};

    for (const a of raw.slice(0, 20)) {
      try {
        const addr = getAddress(a);
        out[addr] = await pub.readContract({
          address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'verifiers', args: [addr],
        });
      } catch (_) {
        out[a] = null; // endereço inválido
      }
    }
    return res.status(200).json({ success: true, distributor, verifiers: out });
  } catch (err) {
    console.error('[verifiers] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

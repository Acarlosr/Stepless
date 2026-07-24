/**
 * api/rotate-admin.js — Rotação segura da chave admin/relayer.
 *
 * A chave atual (RELAYER_PRIVATE_KEY) vazou no histórico do git e precisa
 * ser substituída SEM causar downtime e SEM que a chave privada nova passe
 * por este arquivo, pelo backend, ou pelo chat — só o ENDEREÇO público da
 * chave nova é necessário aqui. A chave privada nova só é usada uma vez,
 * localmente, na env var RELAYER_PRIVATE_KEY da Vercel (feito pelo usuário).
 *
 * Fluxo de 2 fases (nesta ordem, com deploy no meio):
 *
 *  FASE 1 — POST { action: 'promote', newAdmin: '0x...' }
 *    Usa a chave ATUAL (ainda admin) para:
 *      1. Autorizar newAdmin como caller no Oracle e no Distributor
 *         (assim ele já pode operar o relayer/verifier antes de virar admin)
 *      2. Transferir admin do Oracle e do Distributor para newAdmin
 *    Depois disso: atualize RELAYER_PRIVATE_KEY na Vercel para a chave nova
 *    e faça o redeploy. A chave antiga continua AUTORIZADA (não travamos
 *    nada ainda) — só não é mais admin.
 *
 *  FASE 2 — POST { action: 'revoke-old', oldAddress: '0x...' }
 *    Só rode isso DEPOIS de confirmar que o app já está operando com a
 *    chave nova (RELAYER_PRIVATE_KEY trocada + redeploy feito). Usa a chave
 *    ATUAL (agora a nova, já admin) para desautorizar a chave antiga nos
 *    dois contratos — a partir daqui, a chave vazada não tem mais NENHUM
 *    poder on-chain (nem admin, nem authorized caller).
 *
 *  GET → mostra o status atual (quem é admin / quem está autorizado) nos
 *        dois contratos, sem fazer nenhuma mudança.
 */

import {
  publicClient, walletFor, relayerAccount,
  oracleAddress, distributorAddress, ORACLE_ABI, DISTRIBUTOR_ABI,
  cors, translateError, requireAdminSecret,
} from './_stepless.js';

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.RELAYER_PRIVATE_KEY || !process.env.ORACLE_ADDRESS) {
    return res.status(500).json({ success: false, error: 'RELAYER_PRIVATE_KEY / ORACLE_ADDRESS não configurados.' });
  }
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (req.method === 'POST' && !requireAdminSecret(req, res, {
    envNames: ['ROTATE_ADMIN_SECRET', 'ADMIN_API_SECRET'],
    headerNames: ['x-rotate-secret', 'x-admin-secret'],
  })) return;

  const pub = publicClient();
  const signer = relayerAccount(); // sempre a chave ATUAL da env, seja a antiga (fase 1) ou a nova (fase 2)
  const oracle = oracleAddress();
  const distributor = distributorAddress();

  try {
    const [oracleAdmin, distAdmin] = await Promise.all([
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'admin' }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'admin' }),
    ]);

    if (req.method === 'GET') {
      return res.status(200).json({
        currentSigner: signer.address,
        oracleAdmin,
        distributorAdmin: distAdmin,
        signerIsOracleAdmin: oracleAdmin.toLowerCase() === signer.address.toLowerCase(),
        signerIsDistributorAdmin: distAdmin.toLowerCase() === signer.address.toLowerCase(),
      });
    }

    const { action, newAdmin, oldAddress } = req.body || {};
    const wallet = walletFor(signer);
    const steps = [];
    const send = async (label, address, abi, functionName, args) => {
      const hash = await wallet.writeContract({ address, abi, functionName, args });
      await pub.waitForTransactionReceipt({ hash });
      steps.push({ label, tx: hash });
    };

    if (action === 'promote') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(newAdmin || '')) {
        return res.status(400).json({ success: false, error: 'Informe { action: "promote", newAdmin: "0x..." } com um endereço válido.' });
      }
      if (newAdmin.toLowerCase() === signer.address.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'newAdmin precisa ser diferente da chave atual.' });
      }
      if (oracleAdmin.toLowerCase() !== signer.address.toLowerCase() || distAdmin.toLowerCase() !== signer.address.toLowerCase()) {
        return res.status(403).json({ success: false, error: 'A chave configurada agora (RELAYER_PRIVATE_KEY) não é admin de um dos contratos — rode GET pra checar antes.' });
      }

      // 1) Autoriza a chave nova como caller ANTES de tirar o admin da antiga
      //    (senão, entre os dois passos, ninguém conseguiria relayar).
      await send('oracle.setAuthorizedCaller(newAdmin, true)', oracle, ORACLE_ABI, 'setAuthorizedCaller', [newAdmin, true]);
      await send('distributor.setAuthorizedCaller(newAdmin, true)', distributor, DISTRIBUTOR_ABI, 'setAuthorizedCaller', [newAdmin, true]);

      // 2) Transfere admin nos dois contratos
      await send('oracle.transferAdmin(newAdmin)', oracle, ORACLE_ABI, 'transferAdmin', [newAdmin]);
      await send('distributor.transferAdmin(newAdmin)', distributor, DISTRIBUTOR_ABI, 'transferAdmin', [newAdmin]);

      return res.status(200).json({
        success: true,
        phase: 'promote',
        steps,
        nextSteps: [
          `1. Troque RELAYER_PRIVATE_KEY na Vercel pela chave privada de ${newAdmin} (só você, nunca cole isso aqui no chat).`,
          '2. Redeploy do projeto na Vercel.',
          '3. Confirme que registrar local / verificar ainda funciona com a chave nova.',
          `4. Só depois disso, rode POST /api/rotate-admin { "action": "revoke-old", "oldAddress": "${signer.address}" } pra travar a chave antiga de vez.`,
        ],
      });
    }

    if (action === 'revoke-old') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(oldAddress || '')) {
        return res.status(400).json({ success: false, error: 'Informe { action: "revoke-old", oldAddress: "0x..." }.' });
      }
      if (oldAddress.toLowerCase() === signer.address.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'oldAddress não pode ser a mesma chave que está assinando agora — troque RELAYER_PRIVATE_KEY pra nova chave primeiro.' });
      }

      await send('oracle.setAuthorizedCaller(oldAddress, false)', oracle, ORACLE_ABI, 'setAuthorizedCaller', [oldAddress, false]);
      await send('distributor.setAuthorizedCaller(oldAddress, false)', distributor, DISTRIBUTOR_ABI, 'setAuthorizedCaller', [oldAddress, false]);

      return res.status(200).json({
        success: true,
        phase: 'revoke-old',
        steps,
        message: `Chave antiga (${oldAddress}) desautorizada nos dois contratos. Ela não tem mais nenhum poder on-chain.`,
      });
    }

    return res.status(400).json({ success: false, error: 'Informe { action: "promote" | "revoke-old", ... }.' });
  } catch (err) {
    console.error('[rotate-admin] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

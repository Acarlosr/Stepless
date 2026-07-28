/**
 * api/verifiers.js — Gerencia a lista de verificadores autorizados.
 *
 * GET  /api/verifiers?addresses=0x..,0x..  → consulta quem está autorizado
 * POST /api/verifiers { address, authorized }  → registra ou revoga
 *
 * O POST exige a credencial administrativa (X-Admin-Secret) porque
 * `registerVerifier` no contrato é `onlyAdmin` — só o dono pode conceder
 * ou tirar esse poder. Revogar é tão importante quanto conceder: se um
 * verificador se comportar mal, dá para removê-lo sem trocar segredo de
 * mais ninguém.
 *
 * ⚠️ SOBRE REVOGAR: o contrato NÃO tem uma remoção neutra. A única forma de
 * tirar alguém da lista é `slashVerifier`, que além de revogar também ZERA o
 * `totalEarned` da pessoa — é uma punição por fraude, não um "desligar".
 * Por isso a revogação aqui exige `confirmSlash: true` e um motivo: quem
 * chamar precisa saber que está apagando o histórico de ganhos daquele
 * endereço. Uma remoção sem punição exigiria mudar o contrato.
 */

import {
  publicClient, walletFor, relayerAccount, distributorAddress,
  DISTRIBUTOR_ABI, cors, clientIp, store, translateError, requireAdminSecret,
} from './_stepless.js';
import { getAddress } from 'viem';

// Única via de remoção existente no contrato. Ver aviso no cabeçalho.
const SLASH_ABI = [
  { name: 'slashVerifier', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'verifier', type: 'address' }, { name: 'reason', type: 'string' }], outputs: [] },
];

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pub = publicClient();

  // ── Consulta: quem está autorizado? ────────────────────────────────────
  // Aberto de propósito: quem pode aprovar contribuições é informação
  // pública, e está na blockchain de qualquer forma.
  if (req.method === 'GET') {
    const raw = String(req.query?.addresses || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!raw.length) {
      return res.status(400).json({ success: false, error: 'Informe ?addresses=0x...,0x...' });
    }
    const out = {};
    for (const a of raw.slice(0, 20)) {
      try {
        const addr = getAddress(a);
        out[addr] = await pub.readContract({
          address: distributorAddress(), abi: DISTRIBUTOR_ABI, functionName: 'verifiers', args: [addr],
        });
      } catch (_) {
        out[a] = null; // endereço inválido
      }
    }
    return res.status(200).json({ success: true, verifiers: out });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!requireAdminSecret(req, res)) return;

  if (!(await store.rateLimit(`verifiers:${clientIp(req)}`, 10, 300))) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Aguarde.' });
  }

  const { address, authorized = true, confirmSlash = false, reason = '' } = req.body || {};
  let addr;
  try { addr = getAddress(String(address)); }
  catch { return res.status(400).json({ success: false, error: 'Endereço inválido.' }); }

  // Remover exige consentimento explícito, porque apaga o histórico de ganhos.
  if (!authorized && !confirmSlash) {
    return res.status(400).json({
      success: false,
      error: 'Revogar usa slashVerifier, que também ZERA o total ganho deste endereço. '
           + 'Se é isso mesmo, reenvie com { confirmSlash: true, reason: "..." }.',
    });
  }

  try {
    // registerVerifier/slashVerifier são onlyAdmin. Se a chave do servidor não
    // for a do admin, a transação reverteria com "Unauthorized" — mensagem
    // inútil para quem está operando. Melhor conferir antes e dizer o motivo.
    const relayerAddr = relayerAccount().address;
    const onchainAdmin = await pub.readContract({
      address: distributorAddress(), abi: DISTRIBUTOR_ABI, functionName: 'admin',
    });
    if (String(onchainAdmin).toLowerCase() !== String(relayerAddr).toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: 'A chave configurada no servidor não é a administradora do contrato, '
             + 'e só o admin pode registrar verificadores.',
        serverWallet: relayerAddr,
        contractAdmin: onchainAdmin,
        hint: 'Use a carteira administradora diretamente no ArcScan, ou transfira o admin para a chave do servidor.',
      });
    }

    const already = await pub.readContract({
      address: distributorAddress(), abi: DISTRIBUTOR_ABI, functionName: 'verifiers', args: [addr],
    });
    if (Boolean(already) === Boolean(authorized)) {
      return res.status(200).json({
        success: true, address: addr, authorized: Boolean(already), tx: null,
        message: 'Já estava nesse estado — nada a fazer.',
      });
    }

    // Quem assina é o relayer, que é quem representa o admin no servidor.
    const wallet = walletFor(relayerAccount());
    const tx = authorized
      ? await wallet.writeContract({
          address: distributorAddress(), abi: DISTRIBUTOR_ABI,
          functionName: 'registerVerifier', args: [addr],
        })
      : await wallet.writeContract({
          address: distributorAddress(), abi: SLASH_ABI,
          functionName: 'slashVerifier',
          args: [addr, String(reason || 'revogado pelo admin').slice(0, 200)],
        });

    await pub.waitForTransactionReceipt({ hash: tx });
    return res.status(200).json({
      success: true, address: addr, authorized: Boolean(authorized), tx,
      ...(authorized ? {} : { note: 'slashVerifier também zerou o totalEarned deste endereço.' }),
    });
  } catch (err) {
    console.error('[verifiers] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

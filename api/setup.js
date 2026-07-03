/**
 * api/setup.js — Wiring completo dos contratos (idempotente).
 *
 * GET  /api/setup → diagnóstico: mostra o status de cada item
 * POST /api/setup → corrige tudo que estiver faltando (relayer precisa ser admin)
 *
 * Checklist executado:
 *   1. Relayer autorizado no SteplessOracle
 *   2. Verificador autorizado no SteplessOracle
 *   3. Oracle.rewardDistributor configurado (two-phase deploy)
 *   4. Oracle autorizado no RewardDistributor (recordVerification)
 *   5. Relayer autorizado no RewardDistributor (payReward)
 *   6. Verificador registrado no RewardDistributor (registerVerifier)
 *   7. Verificador com gas (USDC nativo) — relayer envia se estiver zerado
 *   8. Saldo da tesouraria (informativo — fundeie transferindo USDC ERC-20
 *      direto para o endereço do RewardDistributor)
 */

import { parseEther } from 'viem';
import {
  publicClient, walletFor, relayerAccount, verifierAccount,
  oracleAddress, distributorAddress, ORACLE_ABI, DISTRIBUTOR_ABI, cors, translateError,
} from './_stepless.js';

const MIN_VERIFIER_GAS = parseEther('0.05'); // USDC nativo (18 dec) p/ gas
const VERIFIER_TOPUP   = parseEther('0.2');

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.RELAYER_PRIVATE_KEY || !process.env.ORACLE_ADDRESS) {
    return res.status(500).json({ success: false, error: 'Configure RELAYER_PRIVATE_KEY e ORACLE_ADDRESS no Vercel.' });
  }

  const pub = publicClient();
  const relayer = relayerAccount();
  const verifier = verifierAccount();
  const oracle = oracleAddress();
  const distributor = distributorAddress();

  try {
    const [
      oracleAdmin, relayerAuthOracle, verifierAuthOracle, oracleDistributor,
      distAdmin, oracleAuthDist, relayerAuthDist, isVerifier,
      verifierGas, treasury, relayerGas,
    ] = await Promise.all([
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'admin' }),
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'authorizedCallers', args: [relayer.address] }),
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'authorizedCallers', args: [verifier.address] }),
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'rewardDistributor' }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'admin' }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'authorizedCallers', args: [oracle] }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'authorizedCallers', args: [relayer.address] }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'verifiers', args: [verifier.address] }),
      pub.getBalance({ address: verifier.address }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'treasuryBalance' }),
      pub.getBalance({ address: relayer.address }),
    ]);

    const distributorSet = oracleDistributor.toLowerCase() === distributor.toLowerCase();
    const status = {
      relayer: relayer.address,
      verifier: verifier.address,
      oracle, distributor,
      oracleAdmin, distributorAdmin: distAdmin,
      isRelayerOracleAdmin: oracleAdmin.toLowerCase() === relayer.address.toLowerCase(),
      isRelayerDistAdmin: distAdmin.toLowerCase() === relayer.address.toLowerCase(),
      checks: {
        '1_relayerAuthorizedOnOracle': relayerAuthOracle,
        '2_verifierAuthorizedOnOracle': verifierAuthOracle,
        '3_oracleDistributorSet': distributorSet,
        '4_oracleAuthorizedOnDistributor': oracleAuthDist,
        '5_relayerAuthorizedOnDistributor': relayerAuthDist,
        '6_verifierRegistered': isVerifier,
        '7_verifierHasGas': verifierGas >= MIN_VERIFIER_GAS,
      },
      balances: {
        relayerGasNative: relayerGas.toString(),
        verifierGasNative: verifierGas.toString(),
        treasuryUSDC_6dec: treasury.toString(),
        treasuryUSDC: (Number(treasury) / 1e6).toFixed(2),
      },
      hint: treasury === 0n
        ? `⚠️ Tesouraria vazia: transfira USDC (ERC-20) para ${distributor} para habilitar pagamentos.`
        : null,
    };

    if (req.method === 'GET') return res.status(200).json(status);

    // ── POST: corrige o que faltar ─────────────────────────────────────────
    const wallet = walletFor(relayer);
    const fixes = [];
    const send = async (label, address, abi, functionName, args) => {
      const hash = await wallet.writeContract({ address, abi, functionName, args });
      await pub.waitForTransactionReceipt({ hash });
      fixes.push({ label, tx: hash });
    };

    if (!relayerAuthOracle) await send('oracle.setAuthorizedCaller(relayer)', oracle, ORACLE_ABI, 'setAuthorizedCaller', [relayer.address, true]);
    if (!verifierAuthOracle) await send('oracle.setAuthorizedCaller(verifier)', oracle, ORACLE_ABI, 'setAuthorizedCaller', [verifier.address, true]);
    if (!distributorSet) {
      try {
        await send('oracle.setRewardDistributor', oracle, ORACLE_ABI, 'setRewardDistributor', [distributor]);
      } catch (e) {
        fixes.push({ label: 'oracle.setRewardDistributor', error: e?.shortMessage || e?.message, note: 'Já setado para outro endereço? Confira DISTRIBUTOR_ADDRESS.' });
      }
    }
    if (!oracleAuthDist) await send('distributor.setAuthorizedCaller(oracle)', distributor, DISTRIBUTOR_ABI, 'setAuthorizedCaller', [oracle, true]);
    if (!relayerAuthDist) await send('distributor.setAuthorizedCaller(relayer)', distributor, DISTRIBUTOR_ABI, 'setAuthorizedCaller', [relayer.address, true]);
    if (!isVerifier) await send('distributor.registerVerifier(verifier)', distributor, DISTRIBUTOR_ABI, 'registerVerifier', [verifier.address]);

    if (verifierGas < MIN_VERIFIER_GAS) {
      const hash = await wallet.sendTransaction({ to: verifier.address, value: VERIFIER_TOPUP });
      await pub.waitForTransactionReceipt({ hash });
      fixes.push({ label: `fund verifier gas (0.2 USDC → ${verifier.address})`, tx: hash });
    }

    return res.status(200).json({
      success: true,
      message: fixes.length ? 'Wiring corrigido.' : 'Tudo já estava configurado.',
      fixes,
      treasuryHint: status.hint,
    });
  } catch (err) {
    console.error('[setup] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

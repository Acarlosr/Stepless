/**
 * api/setup.js — Diagnóstico do wiring dos contratos. SOMENTE LEITURA.
 *
 * GET /api/setup → mostra o status de cada item do checklist
 *
 * ⚠️ O POST FOI REMOVIDO (auditoria de mainnet, achado C4).
 *
 * Antes, um POST aqui com o header X-Admin-Secret correto reescrevia todas as
 * autorizações on-chain, registrava verificadores e enviava USDC. Ou seja: o
 * controle de acesso do protocolo inteiro se reduzia à entropia de uma string
 * guardada numa env var, alcançável pela internet pública.
 *
 * As mesmas correções agora vivem em `scripts/setup-contracts.mjs`, que roda no
 * terminal de quem tem a chave. A diferença não é de conveniência: uma chave em
 * env var da Vercel é lida a cada requisição e já vazou uma vez no histórico
 * deste repositório; uma chave usada localmente, idealmente por hardware
 * wallet ou pelo multisig, não tem essa superfície.
 *
 * Este GET continua útil e continua público — quem administra os contratos é
 * informação que já está na blockchain.
 */

import {
  publicClient, relayerAccount, verifierAccount,
  oracleAddress, distributorAddress, ORACLE_ABI, DISTRIBUTOR_ABI, cors, translateError,
} from './_stepless.js';
import { NETWORK_NAME, usdcAddress, memoAddress } from './_network.js';
import { parseEther } from 'viem';

const MIN_VERIFIER_GAS = parseEther('0.05'); // USDC nativo (18 dec) para gas

export default async function handler(req, res) {
  cors(res, 'GET, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Somente GET. As correções de wiring saíram desta rota por segurança.',
      hint: 'Rode localmente: node scripts/setup-contracts.mjs',
    });
  }

  const pub = publicClient();

  let relayer;
  let verifier;
  try {
    relayer = relayerAccount();
    verifier = verifierAccount();
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      hint: 'RELAYER_PRIVATE_KEY e VERIFIER_PRIVATE_KEY precisam ser chaves DIFERENTES e independentes. '
          + 'A derivação automática da chave do verificador a partir da do relayer foi removida: '
          + 'ela anulava a separação que o contrato exige entre quem registra e quem aprova.',
    });
  }

  const oracle = oracleAddress();
  const distributor = distributorAddress();

  try {
    const [oracleCode, distCode] = await Promise.all([
      pub.getCode({ address: oracle }),
      pub.getCode({ address: distributor }),
    ]);
    if (!oracleCode || oracleCode === '0x') {
      return res.status(500).json({
        success: false,
        error: `Não existe contrato no endereço do Oracle (${oracle}) na rede ${NETWORK_NAME}.`,
      });
    }
    if (!distCode || distCode === '0x') {
      return res.status(500).json({
        success: false,
        error: `Não existe contrato no endereço do RewardDistributor (${distributor}) na rede ${NETWORK_NAME}.`,
      });
    }

    const [
      oracleAdmin, oraclePending, relayerAuthOracle, oracleDistributor, oracleMemo,
      distAdmin, distPending, relayerAuthDist, isVerifier,
      distUsdc, distPaused, treasury, availableTreasury, failedPending,
      verifierGas, relayerGas,
    ] = await Promise.all([
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'admin' }),
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'pendingAdmin' }).catch(() => null),
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'authorizedCallers', args: [relayer.address] }),
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'rewardDistributor' }),
      pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'memo' }).catch(() => null),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'admin' }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'pendingAdmin' }).catch(() => null),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'authorizedCallers', args: [relayer.address] }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'verifiers', args: [verifier.address] }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'USDC' }).catch(() => null),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'paused' }).catch(() => null),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'treasuryBalance' }),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'availableBalance' }).catch(() => null),
      pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'totalFailedPending' }).catch(() => null),
      pub.getBalance({ address: verifier.address }),
      pub.getBalance({ address: relayer.address }),
    ]);

    const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    const expectedUsdc = usdcAddress();
    const expectedMemo = memoAddress();

    const checks = {
      '1_relayerAutorizadoNoOracle': relayerAuthOracle,
      '2_oracleApontaParaODistributor': eq(oracleDistributor, distributor),
      '3_relayerAutorizadoNoDistributor': relayerAuthDist,
      '4_verificadorRegistrado': isVerifier,
      '5_verificadorTemGas': verifierGas >= MIN_VERIFIER_GAS,
      '6_usdcCorretoParaARede': distUsdc ? eq(distUsdc, expectedUsdc) : null,
      '7_memoCorretoParaARede': oracleMemo && expectedMemo ? eq(oracleMemo, expectedMemo) : null,
      '8_naoPausado': distPaused === null ? null : distPaused === false,
    };

    // Os dois problemas que a auditoria de mainnet marcou como críticos e que
    // dá para detectar de fora, sem acesso às chaves.
    const alerts = [];
    if (eq(oracleAdmin, relayer.address) || eq(distAdmin, relayer.address)) {
      alerts.push({
        severity: 'critical',
        code: 'RELAYER_IS_ADMIN',
        message: 'A chave do relayer é admin dos contratos. Ela vive numa env var, é usada a cada '
               + 'requisição e já vazou uma vez neste repositório. Enquanto for admin, um vazamento '
               + 'esvazia a tesouraria numa transação. O admin deve ser um multisig.',
      });
    }
    if (eq(relayer.address, verifier.address)) {
      alerts.push({
        severity: 'critical',
        code: 'RELAYER_EQUALS_VERIFIER',
        message: 'Relayer e verificador são o mesmo endereço. Quem registra não pode ser quem aprova.',
      });
    }
    if (distUsdc && !eq(distUsdc, expectedUsdc)) {
      alerts.push({
        severity: 'critical',
        code: 'USDC_MISMATCH',
        message: `O RewardDistributor aponta para USDC ${distUsdc}, mas a rede ${NETWORK_NAME} usa `
               + `${expectedUsdc}. Pagamentos serão marcados como quitados sem mover valor.`,
      });
    }
    if (treasury === 0n) {
      alerts.push({
        severity: 'warning',
        code: 'EMPTY_TREASURY',
        message: `Tesouraria vazia. Fundeie o RewardDistributor (${distributor}) para habilitar pagamentos.`,
      });
    }
    if (failedPending && failedPending > 0n) {
      alerts.push({
        severity: 'warning',
        code: 'FAILED_REWARDS_PENDING',
        message: `${(Number(failedPending) / 1e6).toFixed(2)} USDC em recompensas que falharam e `
               + 'aguardam reenvio. Chame retryReward(contributionId) para cada uma.',
      });
    }

    return res.status(200).json({
      network: NETWORK_NAME,
      addresses: {
        oracle,
        distributor,
        relayer: relayer.address,
        verifier: verifier.address,
        usdcEsperado: expectedUsdc,
        usdcNoContrato: distUsdc,
        memoEsperado: expectedMemo,
        memoNoContrato: oracleMemo,
      },
      admin: {
        oracle: oracleAdmin,
        oraclePendente: oraclePending,
        distributor: distAdmin,
        distributorPendente: distPending,
      },
      checks,
      alerts,
      balances: {
        relayerGasNative: relayerGas.toString(),
        verifierGasNative: verifierGas.toString(),
        treasuryUSDC: (Number(treasury) / 1e6).toFixed(2),
        availableUSDC: availableTreasury === null ? null : (Number(availableTreasury) / 1e6).toFixed(2),
        failedPendingUSDC: failedPending === null ? null : (Number(failedPending) / 1e6).toFixed(2),
      },
      fix: Object.values(checks).some((v) => v === false)
        ? 'Rode localmente: node scripts/setup-contracts.mjs'
        : null,
    });
  } catch (err) {
    console.error('[setup] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

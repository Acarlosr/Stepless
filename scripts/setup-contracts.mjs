#!/usr/bin/env node
/**
 * scripts/setup-contracts.mjs — Wiring dos contratos (idempotente).
 *
 * Substitui o antigo POST /api/setup, que fazia isso pela internet pública
 * protegido apenas por um header com uma string em env var (auditoria de
 * mainnet, achado C4).
 *
 *   node scripts/setup-contracts.mjs           → mostra o que falta (dry-run)
 *   node scripts/setup-contracts.mjs --apply   → aplica as correções
 *
 * Variáveis de ambiente:
 *   ADMIN_PRIVATE_KEY     chave do admin (só necessária com --apply)
 *   RELAYER_PRIVATE_KEY   para descobrir o endereço do relayer
 *   VERIFIER_PRIVATE_KEY  para descobrir o endereço do verificador
 *   STEPLESS_NETWORK      arc-testnet | arc-mainnet
 *
 * ⚠️ EM MAINNET, NÃO USE --apply COM UMA CHAVE EM TEXTO PURO.
 *    O admin deve ser o multisig. Rode o dry-run, copie as chamadas listadas e
 *    submeta cada uma como transação no Safe. O script imprime os dados de
 *    calldata prontos justamente para isso.
 */

import { createPublicClient, createWalletClient, http, fallback, getAddress, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainConfig, rpcUrls, contractAddresses, usdcAddress, memoAddress, NETWORK_NAME } from '../api/_network.js';
import { ORACLE_ABI, DISTRIBUTOR_ABI } from '../api/_stepless.js';

const apply = process.argv.includes('--apply');

function accountFrom(envName) {
  const pk = process.env[envName];
  if (!pk) return null;
  const normalized = pk.startsWith('0x') ? pk : `0x${pk}`;
  return privateKeyToAccount(normalized);
}

const chain = chainConfig();
const transport = () => fallback(rpcUrls().map((u) => http(u, { timeout: 15_000 })));
const pub = createPublicClient({ chain, transport: transport() });

const { SteplessOracle, RewardDistributor } = contractAddresses();
if (!SteplessOracle || !RewardDistributor) {
  console.error(`Endereços dos contratos não definidos para a rede ${NETWORK_NAME}.`);
  process.exit(1);
}
const oracle = getAddress(SteplessOracle.toLowerCase());
const distributor = getAddress(RewardDistributor.toLowerCase());

const relayer = accountFrom('RELAYER_PRIVATE_KEY');
const verifier = accountFrom('VERIFIER_PRIVATE_KEY');

if (!relayer || !verifier) {
  console.error('RELAYER_PRIVATE_KEY e VERIFIER_PRIVATE_KEY são obrigatórias.');
  console.error('Elas precisam ser chaves DIFERENTES: quem registra não pode ser quem aprova.');
  process.exit(1);
}
if (relayer.address.toLowerCase() === verifier.address.toLowerCase()) {
  console.error('✗ RELAYER e VERIFIER são o mesmo endereço. Isso anula a separação de papéis.');
  process.exit(1);
}

const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

console.log(`Rede:        ${NETWORK_NAME} (chainId ${chain.id})`);
console.log(`Oracle:      ${oracle}`);
console.log(`Distributor: ${distributor}`);
console.log(`Relayer:     ${relayer.address}`);
console.log(`Verificador: ${verifier.address}`);
console.log('');

const [oracleAdmin, distAdmin, relayerAuthOracle, oracleDistributor, relayerAuthDist, isVerifier, distUsdc, oracleMemo] =
  await Promise.all([
    pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'admin' }),
    pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'admin' }),
    pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'authorizedCallers', args: [relayer.address] }),
    pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'rewardDistributor' }),
    pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'authorizedCallers', args: [relayer.address] }),
    pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'verifiers', args: [verifier.address] }),
    pub.readContract({ address: distributor, abi: DISTRIBUTOR_ABI, functionName: 'USDC' }).catch(() => null),
    pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: 'memo' }).catch(() => null),
  ]);

// ── Checagens que nenhum wiring conserta ────────────────────────────────────
const blockers = [];
if (distUsdc && !eq(distUsdc, usdcAddress())) {
  blockers.push(
    `O RewardDistributor aponta para USDC ${distUsdc}, mas ${NETWORK_NAME} usa ${usdcAddress()}.\n`
    + '  USDC é immutable — isto exige REDEPLOY. Não continue: pagamentos seriam marcados\n'
    + '  como quitados sem mover valor nenhum.',
  );
}
if (oracleMemo && memoAddress() && !eq(oracleMemo, memoAddress())) {
  console.warn(`⚠ Oracle.memo = ${oracleMemo}, esperado ${memoAddress()}. Memo é immutable (só redeploy).`);
}
if (eq(oracleAdmin, relayer.address) || eq(distAdmin, relayer.address)) {
  console.warn(
    '⚠ A chave do relayer é ADMIN dos contratos.\n'
    + '  Ela vive numa env var, é usada a cada requisição e já vazou uma vez neste\n'
    + '  repositório. Transfira o admin para um multisig antes do mainnet.\n',
  );
}
if (blockers.length) {
  console.error('\n✗ BLOQUEIOS:\n' + blockers.map((b) => '  ' + b).join('\n'));
  process.exit(1);
}

// ── Ações pendentes ─────────────────────────────────────────────────────────
const actions = [];
const need = (ok, label, address, abi, functionName, args) => {
  if (!ok) actions.push({ label, address, abi, functionName, args });
};

need(relayerAuthOracle, 'oracle.setAuthorizedCaller(relayer, true)', oracle, ORACLE_ABI, 'setAuthorizedCaller', [relayer.address, true]);
need(eq(oracleDistributor, distributor), 'oracle.setRewardDistributor(distributor)', oracle, ORACLE_ABI, 'setRewardDistributor', [distributor]);
need(relayerAuthDist, 'distributor.setAuthorizedCaller(relayer, true)', distributor, DISTRIBUTOR_ABI, 'setAuthorizedCaller', [relayer.address, true]);
need(isVerifier, 'distributor.setVerifier(verificador, true)', distributor, DISTRIBUTOR_ABI, 'setVerifier', [verifier.address, true]);

if (!actions.length) {
  console.log('✓ Tudo já está configurado.');
  process.exit(0);
}

console.log(`${actions.length} ação(ões) pendente(s):\n`);
for (const a of actions) {
  console.log(`  • ${a.label}`);
  console.log(`      para:     ${a.address}`);
  console.log(`      calldata: ${encodeFunctionData({ abi: a.abi, functionName: a.functionName, args: a.args })}`);
  console.log('');
}

if (!apply) {
  console.log('Dry-run. Para aplicar com uma chave local: --apply');
  console.log('Em mainnet, prefira submeter os calldata acima pelo multisig.');
  process.exit(0);
}

const admin = accountFrom('ADMIN_PRIVATE_KEY');
if (!admin) {
  console.error('ADMIN_PRIVATE_KEY é obrigatória com --apply.');
  process.exit(1);
}
if (!eq(admin.address, oracleAdmin) || !eq(admin.address, distAdmin)) {
  console.error(`✗ ${admin.address} não é admin dos dois contratos (oracle=${oracleAdmin}, dist=${distAdmin}).`);
  process.exit(1);
}

const wallet = createWalletClient({ account: admin, chain, transport: transport() });
for (const a of actions) {
  const hash = await wallet.writeContract({ address: a.address, abi: a.abi, functionName: a.functionName, args: a.args });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`✓ ${a.label} — ${hash}`);
}
console.log('\nPronto.');

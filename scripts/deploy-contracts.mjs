#!/usr/bin/env node
/**
 * scripts/deploy-contracts.mjs — Deploy do conjunto Stepless v5 sem Foundry.
 *
 *   SteplessOracle · RewardDistributor · X402API · CampaignEscrow
 *
 * POR QUE EXISTE (além de contracts/script/DeployStepless.s.sol):
 *   `forge script` simula tudo localmente antes de enviar, e a documentação da
 *   Arc recomenda o Arc Foundry porque o USDC da Arc (nativo 18 dec + ERC-20
 *   6 dec, blocklist, address(0) que reverte) não se comporta como um ERC-20
 *   comum numa EVM local. Este script compila a partir do código-fonte e manda
 *   cada transação direto para a rede — quem executa o construtor é o nó da
 *   Arc, não uma simulação. Roda no GitHub Actions (workflow "Deploy
 *   contratos"), então ninguém precisa instalar nada.
 *
 * Variáveis de ambiente:
 *   NETWORK              arc-testnet | arc-mainnet (config/networks.json)
 *   DEPLOYER_PRIVATE_KEY chave descartável que só paga o gás do deploy.
 *                        NÃO fica admin de nada no fim.
 *   ADMIN_ADDRESS        quem administra (multisig na mainnet). Recebe o admin
 *                        em duas fases: precisa chamar acceptAdmin() depois.
 *   RELAYER_ADDRESS      escreve no Oracle em nome dos usuários.
 *   VERIFIER_ADDRESS     (opcional) verificador inicial.
 *   ATTESTER_ADDRESS     (opcional) atestador das campanhas.
 *   CONFIRM_MAINNET      precisa ser "sim" para NETWORK=arc-mainnet.
 *   RPC_URL              (opcional) troca o RPC do networks.json.
 *   USDC_ADDRESS         (só com NETWORK=local, para testes) USDC de mentira.
 *
 * Saída: deployments/<rede>.json + resumo no GitHub Actions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  createPublicClient, createWalletClient, http, getAddress, isAddress, zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'contracts/src');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/networks.json'), 'utf8'));

const fail = (msg) => { console.error(`\n❌ ${msg}\n`); process.exit(1); };
const log = (...a) => console.log(...a);

// ─── Entrada ────────────────────────────────────────────────────────────────
const NETWORK = process.env.NETWORK || '';
const isLocal = NETWORK === 'local';
const net = isLocal ? null : CONFIG.networks[NETWORK];
if (!isLocal && !net) fail(`NETWORK inválida: "${NETWORK}". Use arc-testnet ou arc-mainnet.`);
if (NETWORK === 'arc-mainnet' && process.env.CONFIRM_MAINNET !== 'sim') {
  fail('Deploy em MAINNET exige CONFIRM_MAINNET=sim. Dinheiro real: confira ADMIN_ADDRESS (multisig) antes.');
}

function addr(name, { optional = false } = {}) {
  const v = (process.env[name] || '').trim();
  if (!v) { if (optional) return zeroAddress; fail(`${name} é obrigatório.`); }
  if (!isAddress(v)) fail(`${name} não é um endereço válido: ${v}`);
  return getAddress(v);
}

const pk = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
const pkHex = pk.startsWith('0x') ? pk : `0x${pk}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(pkHex)) fail('DEPLOYER_PRIVATE_KEY ausente ou inválida (32 bytes em hex).');
const deployer = privateKeyToAccount(pkHex);

const ADMIN = addr('ADMIN_ADDRESS');
const RELAYER = addr('RELAYER_ADDRESS');
const VERIFIER = addr('VERIFIER_ADDRESS', { optional: true });
const ATTESTER = addr('ATTESTER_ADDRESS', { optional: true });

// Mesmas regras do DeployStepless.s.sol.
if (RELAYER === ADMIN) fail('RELAYER_ADDRESS deve ser diferente de ADMIN_ADDRESS (auditoria C1).');
if (VERIFIER !== zeroAddress && VERIFIER === RELAYER) fail('VERIFIER_ADDRESS deve ser diferente do RELAYER.');
if (ATTESTER !== zeroAddress && ATTESTER === RELAYER) fail('ATTESTER_ADDRESS deve ser diferente do RELAYER.');
if (ATTESTER !== zeroAddress && ATTESTER === VERIFIER) fail('ATTESTER_ADDRESS deve ser diferente do VERIFIER.');
if (deployer.address === ADMIN) fail('A chave de deploy não pode ser o ADMIN: use uma chave descartável.');

const RPC = process.env.RPC_URL || (net && net.rpcUrls[0]);
if (!RPC) fail('Sem RPC: defina RPC_URL.');
const USDC = isLocal ? addr('USDC_ADDRESS') : getAddress(net.usdc.erc20Address);
const MEMO = isLocal ? zeroAddress : (net.predeploys?.memo ? getAddress(net.predeploys.memo) : zeroAddress);

// ─── Compilação a partir do código-fonte ────────────────────────────────────
function compile() {
  const solc = require('solc');
  const files = ['SteplessOracle.sol', 'RewardDistributor.sol', 'X402API.sol', 'CampaignEscrow.sol'];
  const sources = Object.fromEntries(files.map((f) => [f, { content: fs.readFileSync(path.join(SRC, f), 'utf8') }]));
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      // Igual ao foundry.toml (solc 0.8.24, otimizador 200). "osaka" não existe
      // no 0.8.24; o forge também cai para cancun com esta versão.
      optimizer: { enabled: true, runs: 200 },
      evmVersion: process.env.SOLC_EVM_VERSION || 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const findImports = (p) => {
    const full = path.join(SRC, p);
    return fs.existsSync(full) ? { contents: fs.readFileSync(full, 'utf8') } : { error: `não encontrado: ${p}` };
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) fail(`Compilação falhou:\n${errors.map((e) => e.formattedMessage).join('\n')}`);
  const pick = (file, name) => {
    const c = out.contracts[file][name];
    return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  };
  log(`✓ Compilado com solc ${solc.version()}`);
  return {
    Oracle: pick('SteplessOracle.sol', 'SteplessOracle'),
    Distributor: pick('RewardDistributor.sol', 'RewardDistributor'),
    X402: pick('X402API.sol', 'X402API'),
    Escrow: pick('CampaignEscrow.sol', 'CampaignEscrow'),
  };
}

// ─── Deploy ─────────────────────────────────────────────────────────────────
const GWEI = 10n ** 9n;
const ARC_MIN_FEE = 20n * GWEI; // piso de maxFeePerGas do mempool da Arc

async function main() {
  const pub = createPublicClient({ transport: http(RPC, { timeout: 30_000, retryCount: 3 }) });
  const chainId = await pub.getChainId();
  if (!isLocal && chainId !== net.chainId) fail(`RPC está na chain ${chainId}, esperado ${net.chainId} (${net.name}).`);
  const chain = {
    id: chainId,
    name: net?.name || 'local',
    nativeCurrency: net?.nativeCurrency || { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  };
  const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC, { timeout: 30_000 }) });

  const usdcCode = await pub.getCode({ address: USDC });
  if (!usdcCode || usdcCode === '0x') fail(`USDC ${USDC} não tem código nesta rede.`);

  const balance = await pub.getBalance({ address: deployer.address });
  log(`\nRede:      ${chain.name} (chainId ${chainId})`);
  log(`RPC:       ${RPC}`);
  log(`Deployer:  ${deployer.address}  saldo ${Number(balance) / 1e18} USDC (gás)`);
  log(`Admin:     ${ADMIN}  (recebe em 2 fases — precisa chamar acceptAdmin)`);
  log(`Relayer:   ${RELAYER}`);
  log(`Verifier:  ${VERIFIER === zeroAddress ? '(nenhum)' : VERIFIER}`);
  log(`Attester:  ${ATTESTER === zeroAddress ? '(nenhum)' : ATTESTER}`);
  log(`USDC:      ${USDC}`);
  log(`Memo:      ${MEMO}\n`);
  if (balance === 0n) fail('A chave de deploy está sem saldo para pagar o gás.');

  const C = compile();

  async function fees() {
    try {
      const f = await pub.estimateFeesPerGas();
      const maxFeePerGas = f.maxFeePerGas > ARC_MIN_FEE ? f.maxFeePerGas : ARC_MIN_FEE;
      const maxPriorityFeePerGas = f.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : f.maxPriorityFeePerGas;
      return { maxFeePerGas, maxPriorityFeePerGas };
    } catch {
      return {};
    }
  }

  async function wait(hash, what) {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (r.status !== 'success') fail(`${what} reverteu (tx ${hash}).`);
    return r;
  }

  async function deploy(name, art, args) {
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args, ...(await fees()) });
    const r = await wait(hash, `Deploy de ${name}`);
    // Normaliza para checksum: o recibo pode vir em minúsculas e as leituras
    // do contrato vêm em checksum — sem isto a conferência acusaria diferença.
    const address = getAddress(r.contractAddress);
    log(`✓ ${name.padEnd(18)} ${address}   (tx ${hash})`);
    return { address, tx: hash };
  }

  async function call(label, address, abi, functionName, args) {
    const hash = await wallet.writeContract({ address, abi, functionName, args, ...(await fees()) });
    await wait(hash, label);
    log(`  · ${label}`);
    return hash;
  }

  // Mesma ordem do DeployStepless.s.sol.
  const oracle = await deploy('SteplessOracle', C.Oracle, [zeroAddress, deployer.address, MEMO]);
  const distributor = await deploy('RewardDistributor', C.Distributor, [oracle.address, deployer.address, USDC]);
  const x402 = await deploy('X402API', C.X402, [oracle.address, deployer.address, USDC]);
  const escrow = await deploy('CampaignEscrow', C.Escrow, [oracle.address, deployer.address, USDC]);

  log('\nLigações:');
  await call('oracle.setRewardDistributor', oracle.address, C.Oracle.abi, 'setRewardDistributor', [distributor.address]);
  await call('oracle.setAuthorizedCaller(relayer)', oracle.address, C.Oracle.abi, 'setAuthorizedCaller', [RELAYER, true]);
  await call('distributor.setAuthorizedCaller(relayer)', distributor.address, C.Distributor.abi, 'setAuthorizedCaller', [RELAYER, true]);
  if (VERIFIER !== zeroAddress) {
    await call('distributor.setVerifier(verifier)', distributor.address, C.Distributor.abi, 'setVerifier', [VERIFIER, true]);
  }
  if (ATTESTER !== zeroAddress) {
    await call('escrow.setAttester(attester)', escrow.address, C.Escrow.abi, 'setAttester', [ATTESTER, true]);
  }
  await call('oracle: deployer desautorizado', oracle.address, C.Oracle.abi, 'setAuthorizedCaller', [deployer.address, false]);
  await call('distributor: deployer desautorizado', distributor.address, C.Distributor.abi, 'setAuthorizedCaller', [deployer.address, false]);

  log('\nAdmin (fase 1 de 2):');
  for (const [label, c, art] of [
    ['oracle', oracle, C.Oracle], ['distributor', distributor, C.Distributor],
    ['x402', x402, C.X402], ['escrow', escrow, C.Escrow],
  ]) {
    await call(`${label}.transferAdmin(admin)`, c.address, art.abi, 'transferAdmin', [ADMIN]);
  }

  // ── Conferência lendo da chain ────────────────────────────────────────────
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
  const same = (x, y) => typeof x === 'string' && typeof y === 'string' && x.toLowerCase() === y.toLowerCase();
  const checks = [
    ['oracle.rewardDistributor == distributor', same(await read(oracle.address, C.Oracle.abi, 'rewardDistributor'), distributor.address)],
    ['distributor.oracle == oracle', same(await read(distributor.address, C.Distributor.abi, 'oracle'), oracle.address)],
    ['distributor.USDC == USDC', same(await read(distributor.address, C.Distributor.abi, 'USDC'), USDC)],
    ['escrow.oracle == oracle', same(await read(escrow.address, C.Escrow.abi, 'oracle'), oracle.address)],
    ['escrow.USDC == USDC', same(await read(escrow.address, C.Escrow.abi, 'USDC'), USDC)],
    ['oracle autoriza o relayer', await read(oracle.address, C.Oracle.abi, 'authorizedCallers', [RELAYER])],
    ['oracle NÃO autoriza o deployer', !(await read(oracle.address, C.Oracle.abi, 'authorizedCallers', [deployer.address]))],
    ['rewardsEnabled começa desligado', !(await read(distributor.address, C.Distributor.abi, 'rewardsEnabled'))],
    ...(VERIFIER !== zeroAddress ? [['verifier registrado', await read(distributor.address, C.Distributor.abi, 'verifiers', [VERIFIER])]] : []),
    ...(ATTESTER !== zeroAddress ? [['attester registrado', await read(escrow.address, C.Escrow.abi, 'attesters', [ATTESTER])]] : []),
    ['admin pendente nos 4 contratos', (await Promise.all([
      read(oracle.address, C.Oracle.abi, 'pendingAdmin'), read(distributor.address, C.Distributor.abi, 'pendingAdmin'),
      read(x402.address, C.X402.abi, 'pendingAdmin'), read(escrow.address, C.Escrow.abi, 'pendingAdmin'),
    ])).every((a) => same(a, ADMIN))],
  ];
  log('\nConferência:');
  let allOk = true;
  for (const [label, ok] of checks) { log(`  ${ok ? '✓' : '✗'} ${label}`); allOk &&= ok; }
  if (!allOk) fail('Alguma conferência falhou. NÃO use estes endereços.');

  const result = {
    network: NETWORK, chainId, deployedAt: new Date().toISOString(),
    deployer: deployer.address, admin: ADMIN, relayer: RELAYER,
    verifier: VERIFIER === zeroAddress ? null : VERIFIER,
    attester: ATTESTER === zeroAddress ? null : ATTESTER,
    usdc: USDC, memo: MEMO,
    contracts: {
      SteplessOracle: oracle.address, RewardDistributor: distributor.address,
      X402API: x402.address, CampaignEscrow: escrow.address,
    },
    txs: { SteplessOracle: oracle.tx, RewardDistributor: distributor.tx, X402API: x402.tx, CampaignEscrow: escrow.tx },
  };
  const outDir = path.join(ROOT, 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NETWORK}.json`), `${JSON.stringify(result, null, 2)}\n`);

  const next = [
    `1. Da carteira ADMIN (${ADMIN}), chamar acceptAdmin() nos 4 contratos.`,
    '2. Atualizar config/networks.json → contracts, rodar `npm run gen:network` e commitar.',
    '3. Vercel: ORACLE_ADDRESS, DISTRIBUTOR_ADDRESS, CAMPAIGN_ESCROW_ADDRESS (+ ATTESTER_PRIVATE_KEY).',
    '4. A chave de deploy não serve para mais nada: pode ser descartada.',
  ];
  log('\n✅ Deploy concluído.\n');
  log(JSON.stringify(result.contracts, null, 2));
  log('\nPróximos passos:'); next.forEach((n) => log(`  ${n}`));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const explorer = net?.explorerUrl;
    const rows = Object.entries(result.contracts)
      .map(([k, v]) => `| ${k} | ${explorer ? `[\`${v}\`](${explorer}/address/${v})` : `\`${v}\``} |`).join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## ✅ Stepless v5 — ${chain.name}\n\n| Contrato | Endereço |\n|---|---|\n${rows}\n\n`
      + `Admin pendente: \`${ADMIN}\`\n\n### Próximos passos\n${next.map((n) => `- ${n}`).join('\n')}\n`);
  }
}

main().catch((err) => fail(err?.shortMessage || err?.message || String(err)));

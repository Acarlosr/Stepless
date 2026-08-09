#!/usr/bin/env node
/**
 * scripts/verify-arc-contracts.mjs
 *
 * Descobre com QUAL fonte e QUAIS flags cada contrato vivo na Arc foi
 * compilado, e imprime o comando `forge verify-contract` exato.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * Os três contratos do par v4 estão on-chain e funcionando, mas nenhum está
 * verificado no ArcScan. Um juiz que clique no endereço vê bytecode cru. Pior:
 * o `HEAD` do repositório NÃO compila para o bytecode que está no ar — o v4 foi
 * deployado em 31/07/2026 a partir de um construtor de 2 argumentos, e o código
 * atual (`ba28c0ea`, "contracts v5 mainnet hardening") tem 3. Verificar contra
 * o HEAD falha; é preciso a fonte histórica.
 *
 * Este script resolve isso por força bruta dirigida: para cada contrato, varre
 * os commits que tocaram o arquivo × versões de EVM × caminhos de source, e
 * compara o metadata hash (o CID IPFS que o solc embute no fim do runtime) com
 * o que está de fato on-chain. Bater o metadata hash é match exato de fonte E
 * de settings — não é heurística.
 *
 * ── RESULTADO JÁ CONHECIDO (SteplessOracle v4) ─────────────────────────────
 *
 * Conferido em 09/08/2026 comparando com a tx de criação
 * 0x9e26b5a48ec8ff3711a92ce80aad2aca5c9c3b6f7379f68cdf8dc6cbc597f6f0:
 *
 *     commit        d4756643  (31/07/2026 09:30, deploy às 13:15 do mesmo dia)
 *     solc          0.8.24
 *     optimizer     on, 200 runs
 *     evmVersion    shanghai   ← NÃO é o "osaka" do foundry.toml
 *     bytecodeHash  ipfs
 *     source path   SteplessOracle.sol  (achatado, sem diretório)
 *     ctor args     (0xdf8fa455f01965866ac99ebc553ad3c2b58a0368,
 *                    0xbc8ae412f4f6afa21adf4a18deffabbfb21304ae)
 *
 * O `evm_version = "osaka"` do foundry.toml é uma pegadinha: o solc 0.8.24 não
 * conhece "osaka" e cai no default (shanghai). Verificar declarando osaka falha.
 *
 * ── USO ────────────────────────────────────────────────────────────────────
 *
 *     node scripts/verify-arc-contracts.mjs           # só detecta e imprime
 *     node scripts/verify-arc-contracts.mjs --verify  # detecta e chama o forge
 *
 * Precisa de rede para a Arc (eth_getCode) e do `solc` via npm.
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config/networks.json'), 'utf8'));
const NET = CONFIG.networks['arc-testnet'];

const SOLC_VERSION = '0.8.24';
const EVM_CANDIDATES = ['shanghai', 'paris', 'cancun', 'london'];
const PATH_CANDIDATES = (name) => [
  `${name}.sol`,
  `src/${name}.sol`,
  `contracts/src/${name}.sol`,
];

const TARGETS = [
  { name: 'SteplessOracle', address: NET.contracts.SteplessOracle },
  { name: 'RewardDistributor', address: NET.contracts.RewardDistributor },
  { name: 'X402API', address: NET.contracts.X402API },
];

// ── Utilidades ──────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}

async function ethGetCode(address) {
  let lastErr;
  for (const url of NET.rpcUrls) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'],
        }),
      });
      const j = await r.json();
      if (j.result && j.result !== '0x') return j.result.replace(/^0x/, '');
      lastErr = new Error(`sem bytecode em ${url}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('nenhum RPC respondeu');
}

/**
 * Extrai o metadata hash (CID) que o solc embute no fim do runtime bytecode.
 * Formato: ...a2 64 "ipfs" 58 22 <32 bytes> 64 "solc" 43 <3 bytes> 00 33
 */
function metadataHash(runtimeHex) {
  const m = runtimeHex.match(/a264697066735822([0-9a-f]{64})64736f6c63/i);
  return m ? m[1].toLowerCase() : null;
}

function compile({ source, path, contractName, evmVersion }) {
  const solc = require('solc');
  const input = {
    language: 'Solidity',
    sources: { [path]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion,
      metadata: { bytecodeHash: 'ipfs' },
      outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  if (out.errors?.some((e) => e.severity === 'error')) return null;
  return out.contracts?.[path]?.[contractName]?.evm?.deployedBytecode?.object ?? null;
}

// ── Busca ───────────────────────────────────────────────────────────────────

async function findSettings(target) {
  const file = `contracts/src/${target.name}.sol`;
  const commits = git(`log --format=%H -- ${file}`).split('\n').filter(Boolean);

  const onchain = await ethGetCode(target.address);
  const wanted = metadataHash(onchain);
  if (!wanted) {
    return { ok: false, reason: 'runtime on-chain sem metadata hash reconhecível' };
  }

  for (const commit of commits) {
    let source;
    try { source = git(`show ${commit}:${file}`); } catch { continue; }
    for (const path of PATH_CANDIDATES(target.name)) {
      for (const evmVersion of EVM_CANDIDATES) {
        const bc = compile({ source, path, contractName: target.name, evmVersion });
        if (bc && metadataHash(bc) === wanted) {
          return {
            ok: true,
            commit,
            commitDate: git(`log -1 --format=%ad --date=short ${commit}`),
            path,
            evmVersion,
            solc: SOLC_VERSION,
          };
        }
      }
    }
  }
  return { ok: false, reason: 'nenhuma combinação commit × evmVersion × path bateu' };
}

// ── Main ────────────────────────────────────────────────────────────────────

const doVerify = process.argv.includes('--verify');
let failures = 0;

for (const target of TARGETS) {
  process.stdout.write(`\n${target.name}  ${target.address}\n`);
  let res;
  try {
    res = await findSettings(target);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failures++;
    continue;
  }

  if (!res.ok) {
    console.log(`  ✗ ${res.reason}`);
    console.log('     O deploy pode ter usado uma fonte que nunca entrou no git.');
    failures++;
    continue;
  }

  console.log(`  ✓ commit ${res.commit.slice(0, 8)} (${res.commitDate})`);
  console.log(`    solc ${res.solc} · optimizer 200 · evm ${res.evmVersion} · path ${res.path}`);
  console.log('');
  console.log('    git stash && git checkout ' + res.commit.slice(0, 8) + ' -- contracts/src/');
  console.log(`    forge verify-contract ${target.address} \\`);
  console.log(`      contracts/src/${target.name}.sol:${target.name} \\`);
  console.log(`      --chain-id ${NET.chainId} \\`);
  console.log('      --verifier blockscout \\');
  console.log(`      --verifier-url ${NET.explorerUrl}/api \\`);
  console.log(`      --compiler-version ${res.solc} \\`);
  console.log('      --num-of-optimizations 200 \\');
  console.log(`      --evm-version ${res.evmVersion}`);
  console.log('    # + --constructor-args $(cast abi-encode "constructor(...)" ...) se houver');

  if (doVerify) {
    console.log('\n    (--verify passado: rode os comandos acima manualmente —');
    console.log('     mexer no working tree por script é jeito fácil de perder trabalho)');
  }
}

process.exit(failures ? 1 : 0);

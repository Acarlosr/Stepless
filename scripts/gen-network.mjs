#!/usr/bin/env node
/**
 * scripts/gen-network.mjs — Gera a config de rede do frontend e do mobile a
 * partir de config/networks.json.
 *
 *   node scripts/gen-network.mjs            → escreve os arquivos
 *   node scripts/gen-network.mjs --check    → só verifica (usado no CI)
 *
 * POR QUE GERAR EM VEZ DE IMPORTAR: o frontend é HTML/JS puro, sem build step
 * — não dá para importar JSON de forma síncrona antes do primeiro render sem
 * introduzir um bundler. Gerar um .js versionado mantém "zero build" e ainda
 * assim garante que web, mobile e backend leiam os MESMOS valores. O modo
 * --check no CI é o que impede a divergência silenciosa que aconteceu entre
 * 31/07 e 05/08/2026 (web no v3, mobile no v4).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/networks.json'), 'utf8'));

const NETWORK = process.env.STEPLESS_NETWORK || CONFIG.default;
const net = CONFIG.networks[NETWORK];
if (!net) {
  console.error(`Rede desconhecida: ${NETWORK}. Opções: ${Object.keys(CONFIG.networks).join(', ')}`);
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');

const BANNER = `/**
 * GERADO AUTOMATICAMENTE — não edite à mão.
 *
 * Fonte: config/networks.json  ·  rede: ${NETWORK}
 * Regenerar: npm run gen:network
 *
 * Editar este arquivo direto faz o CI falhar (npm run check roda --check).
 */`;

// ── frontend/network.js ─────────────────────────────────────────────────────
const frontend = `${BANNER}
(function (global) {
  "use strict";

  var NETWORK = ${JSON.stringify({
    key: NETWORK,
    name: net.name,
    chainId: net.chainId,
    testnet: net.testnet,
    rpcUrls: net.rpcUrls,
    wsUrls: net.wsUrls,
    explorerName: net.explorerName,
    explorerUrl: net.explorerUrl,
    faucetUrl: net.faucetUrl,
    nativeCurrency: {
      name: net.nativeCurrency.name,
      symbol: net.nativeCurrency.symbol,
      decimals: net.nativeCurrency.decimals,
    },
    usdc: net.usdc,
    predeploys: net.predeploys,
    contracts: net.contracts,
  }, null, 2).split('\n').join('\n  ')};

  // O proxy próprio vem primeiro: mantém a credencial do provedor fora do
  // bundle e do APK. Os públicos ficam como fallback de resiliência.
  NETWORK.httpRpcUrls = (typeof global.location === "object" && global.location.origin
    ? [global.location.origin + "/api/rpc"]
    : []).concat(NETWORK.rpcUrls);

  // Definição de chain no formato do viem.
  NETWORK.chain = {
    id: NETWORK.chainId,
    name: NETWORK.name,
    nativeCurrency: NETWORK.nativeCurrency,
    rpcUrls: {
      default: { http: NETWORK.httpRpcUrls, webSocket: NETWORK.wsUrls },
      public: { http: NETWORK.httpRpcUrls, webSocket: NETWORK.wsUrls }
    },
    blockExplorers: NETWORK.explorerUrl
      ? { default: { name: NETWORK.explorerName, url: NETWORK.explorerUrl } }
      : undefined,
    testnet: NETWORK.testnet
  };

  NETWORK.explorerAddress = function (addr) {
    return NETWORK.explorerUrl ? NETWORK.explorerUrl + "/address/" + addr : "#";
  };
  NETWORK.explorerTx = function (hash) {
    return NETWORK.explorerUrl ? NETWORK.explorerUrl + "/tx/" + hash : "#";
  };

  global.STEPLESS_NETWORK = NETWORK;
})(typeof window !== "undefined" ? window : globalThis);
`;

// ── mobile/src/config/network.generated.ts ──────────────────────────────────
const mobile = `${BANNER}

export const STEPLESS_NETWORK = ${JSON.stringify({
  key: NETWORK,
  name: net.name,
  chainId: net.chainId,
  testnet: net.testnet,
  rpcUrls: net.rpcUrls,
  wsUrls: net.wsUrls,
  explorerName: net.explorerName,
  explorerUrl: net.explorerUrl,
  nativeCurrency: net.nativeCurrency,
  usdc: net.usdc,
  predeploys: net.predeploys,
  contracts: net.contracts,
}, null, 2)} as const;

export type SteplessNetwork = typeof STEPLESS_NETWORK;
`;

const OUTPUTS = [
  { file: 'frontend/network.js', content: frontend },
  { file: 'mobile/src/config/network.generated.ts', content: mobile },
];

let stale = false;
for (const { file, content } of OUTPUTS) {
  const full = path.join(ROOT, file);
  const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;

  if (current === content) {
    if (!checkOnly) console.log(`= ${file} (já atualizado)`);
    continue;
  }

  if (checkOnly) {
    console.error(`✗ ${file} está fora de sincronia com config/networks.json.`);
    console.error('  Rode: npm run gen:network');
    stale = true;
    continue;
  }

  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log(`✓ ${file}`);
}

if (stale) process.exit(1);

if (checkOnly) {
  console.log(`✓ config de rede em sincronia (${NETWORK})`);
} else {
  console.log(`\nRede aplicada: ${NETWORK} (chainId ${net.chainId ?? 'PENDENTE'})`);
  if (net.chainId === null) {
    console.log('⚠️  Esta rede ainda tem campos pendentes — o backend vai falhar ao subir, de propósito.');
  }
}

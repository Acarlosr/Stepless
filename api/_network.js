/**
 * api/_network.js — Carrega a configuração de rede a partir de config/networks.json.
 * (Prefixo "_" impede a Vercel de expor este arquivo como endpoint.)
 *
 * POR QUE ISTO EXISTE: chainId, RPC, explorer, USDC e Memo estavam duplicados
 * em api/relay.js, api/_stepless.js, api/rpc.js, api/fund.js, frontend/ e
 * mobile/. Divergiram na prática — relay.js declarava o USDC nativo com 6
 * decimais e _stepless.js com 18, para a mesma rede. O viem usa esse número
 * para formatar saldo e estimar gas.
 *
 * Escolha da rede: env STEPLESS_NETWORK ('arc-testnet' | 'arc-mainnet').
 * Sem ela, usa o "default" do JSON.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CONFIG = require('../config/networks.json');

export const NETWORK_NAME = process.env.STEPLESS_NETWORK || CONFIG.default;

const raw = CONFIG.networks[NETWORK_NAME];
if (!raw) {
  throw new Error(
    `STEPLESS_NETWORK="${NETWORK_NAME}" não existe em config/networks.json. `
    + `Opções: ${Object.keys(CONFIG.networks).join(', ')}.`,
  );
}

/**
 * Falha alto quando um campo obrigatório ainda está null.
 *
 * O caso concreto: arc-mainnet tem chainId/USDC/RPC em null porque a Circle
 * ainda não publicou esses valores. Se o app subisse assim, o USDC iria como
 * `null` → endereço zero → `.call` para endereço sem código retorna
 * success=true e o sistema "pagaria" recompensas no vazio, marcando cada uma
 * como quitada. Melhor não subir.
 */
function required(value, field) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    throw new Error(
      `config/networks.json: rede "${NETWORK_NAME}" está sem "${field}". `
      + (raw.$status ? `\nMotivo registrado: ${raw.$status}` : ''),
    );
  }
  return value;
}

/** RPCs em ordem de preferência: env dedicada primeiro, depois os públicos. */
export function rpcUrls() {
  const fromEnv = process.env.ARC_RPC_URL;
  const list = required(raw.rpcUrls, 'rpcUrls');
  return [fromEnv, ...list].filter(Boolean);
}

/** Definição de chain no formato do viem. */
export function chainConfig() {
  const urls = rpcUrls();
  return {
    id: required(raw.chainId, 'chainId'),
    name: raw.name,
    nativeCurrency: {
      name: raw.nativeCurrency.name,
      symbol: raw.nativeCurrency.symbol,
      // 18 — USDC nativo. NÃO confundir com os 6 da interface ERC-20.
      decimals: raw.nativeCurrency.decimals,
    },
    rpcUrls: { default: { http: urls } },
    blockExplorers: raw.explorerUrl
      ? { default: { name: raw.explorerName, url: raw.explorerUrl } }
      : undefined,
    testnet: raw.testnet,
  };
}

export function usdcAddress() {
  return required(raw.usdc.erc20Address, 'usdc.erc20Address');
}

export const USDC_DECIMALS = raw.usdc.erc20Decimals;

export function memoAddress() {
  return raw.predeploys.memo; // pode ser null: o Oracle aceita e desliga o memo
}

export function explorerUrl() {
  return raw.explorerUrl;
}

export function publicRpcUrl() {
  return rpcUrls()[0];
}

/**
 * Endereços dos contratos. As env vars têm precedência sobre o JSON — assim um
 * redeploy emergencial não exige commit, mas o valor versionado continua sendo
 * a referência.
 */
export function contractAddresses() {
  return {
    SteplessOracle: process.env.ORACLE_ADDRESS || raw.contracts.SteplessOracle,
    RewardDistributor: process.env.DISTRIBUTOR_ADDRESS || raw.contracts.RewardDistributor,
    X402API: process.env.X402_ADDRESS || raw.contracts.X402API,
  };
}

/** Endereços conhecidamente mortos — usados por scripts de verificação. */
export function deprecatedAddresses() {
  const out = [];
  const dep = raw.deprecatedContracts || {};
  for (const [version, entry] of Object.entries(dep)) {
    if (version.startsWith('$')) continue;
    for (const [contract, address] of Object.entries(entry)) {
      if (contract.startsWith('$') || typeof address !== 'string') continue;
      out.push({ version, contract, address: address.toLowerCase() });
    }
  }
  return out;
}

export const network = raw;

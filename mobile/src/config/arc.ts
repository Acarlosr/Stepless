/**
 * Stepless — configuração de rede do app mobile.
 *
 * ⚠️ Nada é chumbado aqui. Todos os valores vêm de `network.generated.ts`, que
 * scripts/gen-network.mjs produz a partir de config/networks.json — a mesma
 * fonte que o backend e a web leem.
 *
 * POR QUE: entre 31/07 e 05/08/2026 o redeploy para o v4 atualizou o mobile e
 * esqueceu a web, que ficou lendo o par v3. Cada plataforma tinha a sua cópia
 * dos endereços, e a divergência só apareceu dias depois. Regenerar de uma
 * fonte única é o que impede a repetição — o CI roda `--check` e falha se os
 * arquivos gerados saírem de sincronia.
 *
 * Extraído para arquivo próprio (sem depender de App.tsx) para evitar import
 * circular: App.tsx importa WalletProvider de services/wallet.tsx, que antes
 * importava esta config de volta de App.tsx. Metro/Hermes inicializa os módulos
 * em ordem e o valor chegava `undefined` no módulo carregado primeiro, causando
 * "Cannot read property 'chainId' of undefined".
 */

import { STEPLESS_NETWORK } from './network.generated';

export const ARC_CONFIG = {
  chainId: STEPLESS_NETWORK.chainId,
  name: STEPLESS_NETWORK.name,

  // O proxy de produção usa o nó dedicado sem expor a credencial no APK.
  // Os endpoints públicos ficam como fallback de resiliência.
  rpcUrl: process.env.EXPO_PUBLIC_ARC_RPC_URL || 'https://www.stepless.lat/api/rpc',
  rpcUrls: [
    process.env.EXPO_PUBLIC_ARC_RPC_URL || 'https://www.stepless.lat/api/rpc',
    ...STEPLESS_NETWORK.rpcUrls,
  ],

  blockExplorerUrl: STEPLESS_NETWORK.explorerUrl,

  // USDC na Arc é duplo: nativo (18 dec, gas) E ERC-20 (6 dec, transferências).
  // É o MESMO ativo. Misturar os dois faz saldos aparecerem 1e12 vezes maiores.
  usdcNativeDecimals: STEPLESS_NETWORK.nativeCurrency.decimals,
  usdcErc20Decimals: STEPLESS_NETWORK.usdc.erc20Decimals,
  usdcErc20Address: STEPLESS_NETWORK.usdc.erc20Address,

  memoContractAddress: STEPLESS_NETWORK.predeploys.memo,
  multicall3Address: STEPLESS_NETWORK.predeploys.multicall3,

  contracts: STEPLESS_NETWORK.contracts,

  // Gas Station patrocina o gas — transparente para o app.
  gasStationEnabled: true,
} as const;

/** @deprecated Use ARC_CONFIG. Mantido para não quebrar imports existentes. */
export const ARC_TESTNET_CONFIG = ARC_CONFIG;

export const isTestnet = STEPLESS_NETWORK.testnet;

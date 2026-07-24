/**
 * Stepless — Arc Testnet configuration
 *
 * Extraído para um arquivo próprio (sem depender de App.tsx) para evitar
 * import circular: App.tsx importa WalletProvider de services/wallet.tsx,
 * que antes importava esta config de volta de App.tsx. Metro/Hermes
 * inicializa os módulos em ordem e o valor chegava `undefined` no módulo
 * que era carregado primeiro, causando "Cannot read property 'chainId' of
 * undefined". Import direto e sem ciclo resolve.
 */

export const ARC_TESTNET_CONFIG = {
  chainId: 5042002,
  name: 'Arc Testnet',
  rpcUrl: process.env.EXPO_PUBLIC_ARC_RPC_URL || 'https://www.stepless.lat/api/rpc',
  // O proxy de produção usa o nó dedicado sem expor sua credencial no APK.
  // O oficial permanece como fallback para resiliência.
  rpcUrls: [
    process.env.EXPO_PUBLIC_ARC_RPC_URL || 'https://www.stepless.lat/api/rpc',
    'https://rpc.testnet.arc.network',
  ],
  blockExplorerUrl: 'https://testnet.arcscan.app',
  // USDC on Arc is dual: native (18 dec gas) AND ERC-20 (6 dec transfers)
  usdcNativeDecimals: 18,
  usdcErc20Decimals: 6,
  usdcErc20Address: '0x3600000000000000000000000000000000000000',
  memoContractAddress: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
  // Gas Station sponsors gas — transparent to the app
  gasStationEnabled: true,
};

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
  rpcUrl: 'https://rpc.testnet.arc.network',
  // RPCs tentados em ordem via viem `fallback`. Só o nó oficial por enquanto:
  // os proxies (blockdaemon/drpc) da doc devolvem 400 Bad Request para
  // requisição JSON-RPC anônima, então foram removidos. Se conseguir um
  // endpoint dedicado (Alchemy/QuickNode com key), coloque-o primeiro aqui.
  rpcUrls: [
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

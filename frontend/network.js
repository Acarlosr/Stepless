/**
 * GERADO AUTOMATICAMENTE — não edite à mão.
 *
 * Fonte: config/networks.json  ·  rede: arc-testnet
 * Regenerar: npm run gen:network
 *
 * Editar este arquivo direto faz o CI falhar (npm run check roda --check).
 */
(function (global) {
  "use strict";

  var NETWORK = {
    "key": "arc-testnet",
    "name": "Arc Testnet",
    "chainId": 5042002,
    "testnet": true,
    "rpcUrls": [
      "https://rpc.testnet.arc.io",
      "https://rpc.blockdaemon.testnet.arc.io",
      "https://rpc.drpc.testnet.arc.io"
    ],
    "wsUrls": [
      "wss://rpc.testnet.arc.io"
    ],
    "explorerName": "ArcScan",
    "explorerUrl": "https://testnet.arcscan.app",
    "faucetUrl": "https://faucet.circle.com",
    "nativeCurrency": {
      "name": "USDC",
      "symbol": "USDC",
      "decimals": 18
    },
    "usdc": {
      "erc20Address": "0x3600000000000000000000000000000000000000",
      "erc20Decimals": 6
    },
    "predeploys": {
      "memo": "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
      "multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
      "multicall3From": "0x522fAf9A91c41c443c66765030741e4AaCe147D0",
      "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      "create2Factory": "0x4e59b44847b379578588920cA78FbF26c0B4956C"
    },
    "contracts": {
      "$note": "Par v4, deploy de 31/07/2026. Substituir pelos endereços da v5 depois do redeploy.",
      "SteplessOracle": "0x69b3f9caca6514f76dd2f0dc4b54409e6d5da5cc",
      "RewardDistributor": "0xef5d148b126d8dcdc7d344dfa367c61acbb02ea0",
      "X402API": "0x0D318864C80eCe8d28800a750bdA06b6E52ffCc9"
    }
  };

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

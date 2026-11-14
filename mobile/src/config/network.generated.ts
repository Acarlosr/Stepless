/**
 * GERADO AUTOMATICAMENTE — não edite à mão.
 *
 * Fonte: config/networks.json  ·  rede: arc-testnet
 * Regenerar: npm run gen:network
 *
 * Editar este arquivo direto faz o CI falhar (npm run check roda --check).
 */

export const STEPLESS_NETWORK = {
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
  "nativeCurrency": {
    "name": "USDC",
    "symbol": "USDC",
    "decimals": 18,
    "$note": "USDC nativo (gas) usa 18 decimais; a interface ERC-20 usa 6. É o MESMO ativo. viem usa este valor para formatar saldo e estimar gas — 6 aqui faz o saldo aparecer 1e12 vezes maior."
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
    "$note": "Conjunto v5, deploy de 14/11/2026 pelo workflow 'Deploy contratos' (scripts/deploy-contracts.mjs). Admin: 0x828D6da9D777624C345cB51328B1F2a38af812b4 (precisa de acceptAdmin). Relayer 0xbc8a…04aE, verificador 0xd299…c53A, atestador 0x93b0…dEa0.",
    "SteplessOracle": "0x0B2E760683f010cbff1b88c528E9d410aDf0EF7e",
    "RewardDistributor": "0xF55d685283dFC0712960c5556099a5cDbDf00c14",
    "X402API": "0xcD432507a3eC68A0262c7e2BE5677d46976f0394",
    "CampaignEscrow": "0xfF05ef5e2D6dD0398C18688b7B3e90707424a8c8"
  }
} as const;

export type SteplessNetwork = typeof STEPLESS_NETWORK;

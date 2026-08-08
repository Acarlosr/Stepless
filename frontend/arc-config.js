/**
 * Stepless — configuração de chain e ABIs do frontend.
 *
 * Arc é a L1 stablecoin-native da Circle. O gas é pago em USDC, não em Gwei.
 *
 * ⚠️ Nada de rede é chumbado aqui. chainId, RPC, explorer, USDC e Memo vêm de
 * `window.STEPLESS_NETWORK`, gerado por scripts/gen-network.mjs a partir de
 * config/networks.json — a mesma fonte que o backend e o mobile leem.
 *
 * Carregue frontend/network.js ANTES deste arquivo.
 *
 * POR QUE: entre 31/07 e 05/08/2026 o redeploy para o v4 atualizou o mobile e
 * esqueceu a web, que ficou lendo o par v3 — que continua on-chain, com saldo e
 * 34 locais, e por isso era o mais fácil de confundir com o par vivo. Enquanto
 * os valores estiverem espalhados por 12 arquivos, a próxima divergência é
 * questão de tempo.
 *
 * Este arquivo é JS puro (sem build step). Tudo fica em `window.SteplessConfig`.
 */

if (!window.STEPLESS_NETWORK) {
  throw new Error(
    "frontend/network.js precisa ser carregado antes de arc-config.js. "
    + "Rode `npm run gen:network` se o arquivo não existir."
  );
}

/* ──────────────────────────────────────────────────────────────
 *  Chain configuration
 * ────────────────────────────────────────────────────────────── */

const NET = window.STEPLESS_NETWORK;

const ARC_CHAIN = {
  id: NET.chainId,
  name: NET.name,
  // 18 — decimais do USDC NATIVO (gas). A formatação de valores usa os 6
  // decimais da interface ERC-20, que ficam em TOKENS.USDC.decimals.
  // Os dois números coexistem porque na Arc é o MESMO ativo com duas
  // interfaces; misturá-los faz saldos aparecerem 1e12 vezes maiores.
  nativeCurrency: NET.nativeCurrency,
  rpcUrls: {
    // O nó dedicado fica atrás do proxy serverless; a credencial não é
    // publicada no JavaScript. Os públicos ficam como fallback.
    default: { http: NET.httpRpcUrls },
    public: { http: NET.httpRpcUrls },
  },
  wsUrls: {
    default: { webSocket: NET.wsUrls },
    public: { webSocket: NET.wsUrls },
  },
  blockExplorers: NET.explorerUrl
    ? { default: { name: NET.explorerName, url: NET.explorerUrl } }
    : undefined,
  faucets: NET.faucetUrl ? [NET.faucetUrl] : [],
  testnet: NET.testnet,
};

/** @deprecated Use ARC_CHAIN. Mantido para não quebrar referências antigas. */
const ARC_TESTNET = ARC_CHAIN;

/* ──────────────────────────────────────────────────────────────
 *  Token addresses
 * ────────────────────────────────────────────────────────────── */

const TOKENS = {
  USDC: {
    address: NET.usdc.erc20Address,
    decimals: NET.usdc.erc20Decimals, // 6 — interface ERC-20
    symbol: "USDC",
    name: "USD Coin",
  },
};

/* ──────────────────────────────────────────────────────────────
 *  Contract addresses
 * ────────────────────────────────────────────────────────────── */

/*
 *  Vêm de config/networks.json, a mesma fonte que o backend e o mobile leem —
 *  é o que impede a divergência de 31/07–05/08/2026 de acontecer de novo.
 *  Para conferir qual par está vivo: node scripts/check-live-contracts.mjs
 */
const CONTRACTS = {
  RewardDistributor: NET.contracts.RewardDistributor,
  SteplessOracle:    NET.contracts.SteplessOracle,
  X402API:           NET.contracts.X402API,
  Multicall3:        NET.predeploys.multicall3,
  Memo:              NET.predeploys.memo,
};

/**
 * Endereço do relayer atual — quem o backend (RELAYER_PRIVATE_KEY na Vercel)
 * representa on-chain. Centralizado aqui em vez de hardcoded em dashboard.js
 * para não divergir silenciosamente na próxima rotação de chave (já
 * aconteceu uma vez: ver docs/analise — memória do projeto).
 * Verificado no ArcScan em 2026-07-06: autorizado pelo admin
 * 0xbc8aE412f4F6aFA21aDf4A18DEfFabbFB21304aE.
 */
const RELAYER_ADDRESS = "0xd299358Db4e263d95Fdc0B72970373470921c53A";

/* ──────────────────────────────────────────────────────────────
 *  ABIs
 * ────────────────────────────────────────────────────────────── */

/**
 * RewardDistributor — distributes USDC rewards to accessibility contributors.
 * ABI reescrita a partir de contracts/src/RewardDistributor.sol (fonte da verdade).
 */
const REWARD_DISTRIBUTOR_ABI = [
  // ── Write ──
  {
    type: "function",
    name: "payReward",
    inputs: [
      { name: "contributionId", type: "bytes32", internalType: "bytes32" },
      { name: "contributor", type: "address", internalType: "address" },
      { name: "rewardType", type: "uint8", internalType: "enum RewardType" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "batchPayRewards",
    inputs: [
      { name: "contributionIds", type: "bytes32[]", internalType: "bytes32[]" },
      { name: "contributors", type: "address[]", internalType: "address[]" },
      { name: "rewardTypes", type: "uint8[]", internalType: "enum RewardType[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fundTreasury",
    inputs: [{ name: "amount", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    // v5: entrada E saída neutras do conjunto de verificadores.
    // Antes só existia slashVerifier(), que além de revogar zerava o
    // totalEarned da pessoa — não havia como desligar sem punir.
    type: "function",
    name: "setVerifier",
    inputs: [
      { name: "verifier", type: "address", internalType: "address" },
      { name: "authorized", type: "bool", internalType: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    // Punição explícita: revoga E zera os ganhos. Separado de setVerifier de
    // propósito — quem sai da equipe não é fraudador.
    type: "function",
    name: "slashVerifier",
    inputs: [
      { name: "verifier", type: "address", internalType: "address" },
      { name: "reason", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRewardAmount",
    inputs: [
      { name: "rewardType", type: "uint8", internalType: "enum RewardType" },
      { name: "newAmount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPaused",
    inputs: [{ name: "_paused", type: "bool", internalType: "bool" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAuthorizedCaller",
    inputs: [
      { name: "caller", type: "address", internalType: "address" },
      { name: "authorized", type: "bool", internalType: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    // v5: duas fases. Só transferir não muda nada; o sucessor precisa chamar
    // acceptAdmin(). A v1 do projeto foi perdida por uma transferência de uma
    // fase para um endereço que ninguém controlava.
    type: "function",
    name: "transferAdmin",
    inputs: [{ name: "newAdmin", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "acceptAdmin",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    // v5: saque em duas fases, com 48h de espera entre pedir e executar.
    // Um saque anômalo fica visível antes de ser irreversível.
    type: "function",
    name: "requestWithdrawal",
    inputs: [
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "to", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeWithdrawal",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelWithdrawal",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    // v5: sem valor e destinatário livres — ambos vêm de failedRewards[],
    // gravado no momento da falha. Como não há nada a escolher, é
    // permissionless: qualquer um pode destravar o pagamento de outra pessoa.
    type: "function",
    name: "retryReward",
    inputs: [{ name: "contributionId", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── Read ──
  {
    // Saldo livre = tesouraria menos o que está reservado para reenviar
    // recompensas que falharam.
    type: "function",
    name: "availableBalance",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getFailedReward",
    inputs: [{ name: "contributionId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "recipient", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingAdmin",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getContributorStats",
    inputs: [{ name: "contributor", type: "address", internalType: "address" }],
    outputs: [
      { name: "earned", type: "uint256", internalType: "uint256" },
      { name: "contributions", type: "uint256", internalType: "uint256" },
      { name: "verifications", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "treasuryBalance",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isRewardClaimed",
    inputs: [{ name: "contributionId", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "verifiers",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "canVerify",
    inputs: [{ name: "verifier", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    // Não existe owner() no contrato — o campo público chama admin().
    type: "function",
    name: "admin",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    // Não existe mapping público rewardAmounts(uint8) — os valores ficam em
    // variáveis de estado privadas por tipo, expostas via esta view function.
    type: "function",
    name: "getRewardAmount",
    inputs: [{ name: "rewardType", type: "uint8", internalType: "enum RewardType" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  // ── Events ──
  {
    type: "event",
    name: "RewardPaid",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "recipient", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "rewardType", type: "uint8", indexed: false, internalType: "enum RewardType" },
      { name: "blockNumber", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RewardFailed",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "recipient", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "reason", type: "bytes", indexed: false, internalType: "bytes" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TreasuryFunded",
    inputs: [
      { name: "funder", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "newBalance", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TreasuryWithdrawn",
    inputs: [
      { name: "admin", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "newBalance", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "VerifierRegistered",
    inputs: [
      { name: "verifier", type: "address", indexed: true, internalType: "address" },
      { name: "blockNumber", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    // Substitui o antigo "VerifierRemoved", que não existe no contrato.
    type: "event",
    name: "VerifierSlashed",
    inputs: [
      { name: "verifier", type: "address", indexed: true, internalType: "address" },
      { name: "slashedAmount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "reason", type: "string", indexed: false, internalType: "string" },
    ],
    anonymous: false,
  },
  // ── Errors ──
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "ContributionNotVerified", inputs: [{ name: "contributionId", type: "bytes32" }] },
  { type: "error", name: "RewardAlreadyClaimed", inputs: [{ name: "contributionId", type: "bytes32" }] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "InsufficientTreasury", inputs: [{ name: "needed", type: "uint256" }, { name: "available", type: "uint256" }] },
  { type: "error", name: "RewardTransferFailed", inputs: [{ name: "contributionId", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "reason", type: "bytes" }] },
  { type: "error", name: "InvalidRewardAmount", inputs: [] },
  { type: "error", name: "Paused", inputs: [] },
  { type: "error", name: "NotContributor", inputs: [{ name: "contributionId", type: "bytes32" }, { name: "caller", type: "address" }] },
  { type: "error", name: "DuplicateVerifier", inputs: [{ name: "verifier", type: "address" }, { name: "contributionId", type: "bytes32" }] },
  { type: "error", name: "CooldownActive", inputs: [{ name: "blockNumber", type: "uint256" }, { name: "unlockBlock", type: "uint256" }] },
  { type: "error", name: "ArrayLengthMismatch", inputs: [{ name: "contributionIdsLength", type: "uint256" }, { name: "contributorsLength", type: "uint256" }, { name: "rewardTypesLength", type: "uint256" }] },
];

/**
 * SteplessOracle — on-chain registry of accessible locations and contributions.
 * ABI reescrita a partir de contracts/src/SteplessOracle.sol (fonte da verdade).
 */
const STEPLESS_ORACLE_ABI = [
  // ── Write ──
  {
    type: "function",
    name: "registerLocation",
    inputs: [
      { name: "locationHash", type: "bytes32", internalType: "bytes32" },
      { name: "latPacked", type: "uint256", internalType: "uint256" },
      { name: "lngPacked", type: "uint256", internalType: "uint256" },
      { name: "dataHash", type: "bytes32", internalType: "bytes32" },
      { name: "contributor", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitContribution",
    inputs: [
      { name: "contributionId", type: "bytes32", internalType: "bytes32" },
      { name: "locationHash", type: "bytes32", internalType: "bytes32" },
      { name: "contributionType", type: "uint8", internalType: "enum SteplessOracle.ContributionType" },
      { name: "dataHash", type: "bytes32", internalType: "bytes32" },
      { name: "contributor", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "verifyContribution",
    inputs: [
      { name: "contributionId", type: "bytes32", internalType: "bytes32" },
      { name: "approve", type: "bool", internalType: "bool" },
      { name: "reason", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRewardDistributor",
    inputs: [{ name: "_distributor", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAuthorizedCaller",
    inputs: [
      { name: "caller",     type: "address", internalType: "address" },
      { name: "authorized", type: "bool",    internalType: "bool"    },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferAdmin",
    inputs: [{ name: "newAdmin", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── Read ──
  {
    type: "function",
    name: "getContribution",
    inputs: [{ name: "contributionId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "verified", type: "bool", internalType: "bool" },
      { name: "verifier", type: "address", internalType: "address" },
      { name: "timestamp", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getLocation",
    inputs: [{ name: "locationHash", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      {
        name: "", type: "tuple", internalType: "struct SteplessOracle.Location",
        components: [
          { name: "locationHash", type: "bytes32", internalType: "bytes32" },
          { name: "firstContributor", type: "address", internalType: "address" },
          { name: "registeredBlock", type: "uint256", internalType: "uint256" },
          { name: "verificationCount", type: "uint256", internalType: "uint256" },
          { name: "exists", type: "bool", internalType: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "admin",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rewardDistributor",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authorizedCallers",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "locationCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    // Nome real no contrato: array público allLocationHashes(uint256)
    name: "allLocationHashes",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  // ── Events ──
  {
    type: "event",
    name: "LocationRegistered",
    inputs: [
      { name: "locationHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "contributor", type: "address", indexed: true, internalType: "address" },
      { name: "latPacked", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "lngPacked", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "blockNumber", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ContributionSubmitted",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "locationHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "contributor", type: "address", indexed: true, internalType: "address" },
      { name: "contributionType", type: "uint8", indexed: false, internalType: "enum SteplessOracle.ContributionType" },
      { name: "dataHash", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "blockNumber", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ContributionVerified",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "verifier", type: "address", indexed: true, internalType: "address" },
      { name: "contributor", type: "address", indexed: true, internalType: "address" },
      { name: "blockNumber", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    // Antes ausente da ABI — sem isto o dashboard nunca conseguia distinguir
    // rejeição de aprovação (ContributionVerified só dispara em aprovação;
    // rejeição tem evento próprio, não é um campo booleano do mesmo evento).
    type: "event",
    name: "ContributionRejected",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "verifier", type: "address", indexed: true, internalType: "address" },
      { name: "reason", type: "string", indexed: false, internalType: "string" },
      { name: "blockNumber", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "MemoAttachFailed",
    inputs: [
      { name: "id", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "blockNumber", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  // ── Errors (para decodificação legível em vez de hex opaco) ──
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "LocationAlreadyRegistered", inputs: [{ name: "locationHash", type: "bytes32" }] },
  { type: "error", name: "LocationNotFound", inputs: [{ name: "locationHash", type: "bytes32" }] },
  { type: "error", name: "ContributionAlreadyExists", inputs: [{ name: "contributionId", type: "bytes32" }] },
  { type: "error", name: "ContributionNotFound", inputs: [{ name: "contributionId", type: "bytes32" }] },
  { type: "error", name: "AlreadyVerified", inputs: [{ name: "contributionId", type: "bytes32" }] },
  { type: "error", name: "NotAVerifier", inputs: [{ name: "addr", type: "address" }] },
  { type: "error", name: "SelfVerificationForbidden", inputs: [] },
  // CooldownActive é lançado pelo RewardDistributor (2 argumentos), não pelo
  // Oracle — mas o revert bubbla até aqui via verifyContribution(). Assinatura
  // errada (0 args) fazia o viem não decodificar e mostrar erro genérico.
  { type: "error", name: "CooldownActive", inputs: [{ name: "blockNumber", type: "uint256" }, { name: "unlockBlock", type: "uint256" }] },
  { type: "error", name: "RewardDistributorNotSet", inputs: [] },
];

/**
 * X402API — HTTP 402 payment-protocol integration for API access.
 */
const X402_API_ABI = [
  // ── Write ──
  {
    type: "function",
    name: "purchaseSubscription",
    inputs: [
      { name: "planId", type: "uint8", internalType: "uint8" },
      { name: "durationDays", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── Read ──
  {
    type: "function",
    name: "queryLocation",
    inputs: [{ name: "locationId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "lat", type: "int256", internalType: "int256" },
      { name: "lng", type: "int256", internalType: "int256" },
      { name: "name", type: "string", internalType: "string" },
      { name: "category", type: "uint8", internalType: "uint8" },
      { name: "verified", type: "bool", internalType: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "queryAreaSearch",
    inputs: [
      { name: "minLat", type: "int256", internalType: "int256" },
      { name: "maxLat", type: "int256", internalType: "int256" },
      { name: "minLng", type: "int256", internalType: "int256" },
      { name: "maxLng", type: "int256", internalType: "int256" },
      { name: "maxResults", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      { name: "locationIds", type: "bytes32[]", internalType: "bytes32[]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasActiveSubscription",
    inputs: [{ name: "subscriber", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    // v5: getter do mapping `subscriptions`. Substitui `subscriptionExpiry`,
    // que nunca existiu no contrato — a ABI descrevia uma função imaginária.
    // Também mudou de blocos para timestamp: a v4 assumia 5.400.000 blocos =
    // 30 dias a 0,48s/bloco, e duração de contrato comercial não deve depender
    // do tempo de bloco continuar o mesmo.
    type: "function",
    name: "subscriptions",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [
      { name: "planId", type: "uint256", internalType: "uint256" },
      { name: "endTime", type: "uint256", internalType: "uint256" },
      { name: "queriesUsed", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    // v5: getter do mapping `plans`. Substitui `planPrice`.
    // `queryLimit` agora é ENFORÇADO — na v4 era gravado e nunca lido, então o
    // "limite de 10 mil consultas" do plano de $100 não existia de fato.
    type: "function",
    name: "plans",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "monthlyFee", type: "uint256", internalType: "uint256" },
      { name: "queryLimit", type: "uint256", internalType: "uint256" },
      { name: "active", type: "bool", internalType: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "remainingQueries",
    inputs: [{ name: "consumer", type: "address", internalType: "address" }],
    outputs: [{ name: "remaining", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  // ── Events ──
  {
    type: "event",
    name: "SubscriptionPurchased",
    inputs: [
      { name: "subscriber", type: "address", indexed: true, internalType: "address" },
      { name: "planId", type: "uint8", indexed: false, internalType: "uint8" },
      { name: "expiry", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
];

/* ──────────────────────────────────────────────────────────────
 *  ERC-20 ABI (for USDC / EURC balance reads)
 * ────────────────────────────────────────────────────────────── */

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
];

/* ──────────────────────────────────────────────────────────────
 *  Multicall3 ABI (aggregate reads)
 * ────────────────────────────────────────────────────────────── */

const MULTICALL3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        internalType: "struct Multicall3.Call3[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        internalType: "struct Multicall3.Result[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
    stateMutability: "payable",
  },
];

/* ──────────────────────────────────────────────────────────────
 *  Reward tiers (USDC amounts in 6-decimal units)
 *  Espelha EXATAMENTE o enum RewardType e os valores default de
 *  contracts/src/RewardDistributor.sol. Antes esta tabela tinha
 *  tiers/nomes/valores inventados (Basic/Standard/Premium/Critical,
 *  0.5–5.0 USDC) sem nenhuma relação com o enum real do contrato
 *  (NewLocation/Verification/QualityPhoto/LocationUpdate/TopContributorBonus).
 *  Se o contrato mudar os valores via setRewardAmount(), esta tabela
 *  precisa ser atualizada manualmente — ela é só para exibição na UI,
 *  o valor pago de fato vem sempre do contrato (getRewardAmount).
 * ────────────────────────────────────────────────────────────── */

const REWARD_TIERS = [
  { tier: 0, label: "NewLocation",        amount: 0.10, raw: 100000   },
  { tier: 1, label: "Verification",       amount: 0.05, raw: 50000    },
  { tier: 2, label: "QualityPhoto",       amount: 0.02, raw: 20000    },
  { tier: 3, label: "LocationUpdate",     amount: 0.03, raw: 30000    },
  { tier: 4, label: "TopContributorBonus", amount: 5.00, raw: 5000000 },
];

/* ──────────────────────────────────────────────────────────────
 *  Location categories
 * ────────────────────────────────────────────────────────────── */

const LOCATION_CATEGORIES = [
  { id: 0, label: { pt: "Rampa",        en: "Ramp",        es: "Rampa" } },
  { id: 1, label: { pt: "Elevador",     en: "Elevator",    es: "Ascensor" } },
  { id: 2, label: { pt: "Banheiro Acessível", en: "Accessible Restroom", es: "Baño Accesible" } },
  { id: 3, label: { pt: "Vaga PCD",     en: "Accessible Parking", es: "Estacionamiento Accesible" } },
  { id: 4, label: { pt: "Sinalização",  en: "Signage",     es: "Señalización" } },
  { id: 5, label: { pt: "Áudio Descrição", en: "Audio Description", es: "Audiodescripción" } },
  { id: 6, label: { pt: "Braile",       en: "Braille",     es: "Braille" } },
  { id: 7, label: { pt: "Outro",        en: "Other",       es: "Otro" } },
];

/* ──────────────────────────────────────────────────────────────
 *  Contribution types
 *  Precisa bater com o enum ContributionType do SteplessOracle.sol:
 *  { NewLocation, Update, Photo, Verification } — 4 valores, nessa ordem.
 *  A versão anterior tinha 5 entradas com nomes e ordem diferentes
 *  (Mapear Local/Verificar Acesso/Reportar Problema/Adicionar Foto/
 *  Atualizar Info) — se algum formulário chegasse a enviar esse índice
 *  como contributionType em submitContribution(), o valor gravado on-chain
 *  seria semanticamente errado (ex.: índice 2 virava "Reportar Problema"
 *  na UI mas grava ContributionType.Photo no contrato).
 * ────────────────────────────────────────────────────────────── */

const CONTRIBUTION_TYPES = [
  { id: 0, label: { pt: "Novo Local",  en: "New Location",  es: "Nuevo Lugar" } },
  { id: 1, label: { pt: "Atualização", en: "Update",        es: "Actualización" } },
  { id: 2, label: { pt: "Foto",        en: "Photo",         es: "Foto" } },
  { id: 3, label: { pt: "Verificação", en: "Verification",  es: "Verificación" } },
];

/* ──────────────────────────────────────────────────────────────
 *  Goldsky subgraph endpoint
 * ────────────────────────────────────────────────────────────── */

const SUBGRAPH_ENDPOINT =
  "https://api.goldsky.com/api/public/project_clxstepless/subgraphs/stepless/v1.0/gn";

/* ──────────────────────────────────────────────────────────────
 *  Export
 * ────────────────────────────────────────────────────────────── */

const SteplessConfig = {
  chain: ARC_TESTNET,
  tokens: TOKENS,
  contracts: CONTRACTS,
  relayerAddress: RELAYER_ADDRESS,
  abis: {
    RewardDistributor: REWARD_DISTRIBUTOR_ABI,
    SteplessOracle: STEPLESS_ORACLE_ABI,
    X402API: X402_API_ABI,
    ERC20: ERC20_ABI,
    Multicall3: MULTICALL3_ABI,
  },
  rewardTiers: REWARD_TIERS,
  locationCategories: LOCATION_CATEGORIES,
  contributionTypes: CONTRIBUTION_TYPES,
  subgraphEndpoint: SUBGRAPH_ENDPOINT,
};

// Browser global
if (typeof window !== "undefined") {
  window.SteplessConfig = SteplessConfig;
}

// ESM export
export {
  ARC_TESTNET,
  TOKENS,
  CONTRACTS,
  RELAYER_ADDRESS,
  REWARD_DISTRIBUTOR_ABI,
  STEPLESS_ORACLE_ABI,
  X402_API_ABI,
  ERC20_ABI,
  MULTICALL3_ABI,
  REWARD_TIERS,
  LOCATION_CATEGORIES,
  CONTRIBUTION_TYPES,
  SUBGRAPH_ENDPOINT,
  SteplessConfig,
};
export default SteplessConfig;

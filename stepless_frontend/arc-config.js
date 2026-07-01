/**
 * Stepless — Arc Testnet Configuration
 * Arc is Circle's stablecoin-native L1. Gas is paid in USDC, not Gwei.
 * Chain ID: 5042002
 *
 * This file is vanilla JS (no build step). It attaches everything to
 * `window.SteplessConfig` so it can be consumed by index.html and dashboard.html
 * via <script type="module">.
 */

/* ──────────────────────────────────────────────────────────────
 *  Chain configuration
 * ────────────────────────────────────────────────────────────── */

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] },
  },
  wsUrls: {
    default: { webSocket: ["wss://rpc.testnet.arc.network"] },
    public: { webSocket: ["wss://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  faucets: ["https://faucet.circle.com"],
  testnet: true,
};

/* ──────────────────────────────────────────────────────────────
 *  Token addresses
 * ────────────────────────────────────────────────────────────── */

const TOKENS = {
  USDC: {
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
  },
  EURC: {
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    decimals: 6,
    symbol: "EURC",
    name: "Euro Coin",
  },
};

/* ──────────────────────────────────────────────────────────────
 *  Contract addresses
 * ────────────────────────────────────────────────────────────── */

const CONTRACTS = {
  RewardDistributor: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
  SteplessOracle: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
  X402API: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
  Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  Memo: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
};

/* ──────────────────────────────────────────────────────────────
 *  ABIs
 * ────────────────────────────────────────────────────────────── */

/**
 * RewardDistributor — distributes USDC rewards to accessibility contributors.
 */
const REWARD_DISTRIBUTOR_ABI = [
  // ── Write ──
  {
    type: "function",
    name: "payReward",
    inputs: [
      { name: "contributionId", type: "bytes32", internalType: "bytes32" },
      { name: "contributor", type: "address", internalType: "address" },
      { name: "rewardTier", type: "uint8", internalType: "uint8" },
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
      { name: "rewardTiers", type: "uint8[]", internalType: "uint8[]" },
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
    type: "function",
    name: "registerVerifier",
    inputs: [{ name: "verifier", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "removeVerifier",
    inputs: [{ name: "verifier", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawTreasury",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── Read ──
  {
    type: "function",
    name: "getContributorStats",
    inputs: [{ name: "contributor", type: "address", internalType: "address" }],
    outputs: [
      { name: "totalEarned", type: "uint256", internalType: "uint256" },
      { name: "contributions", type: "uint256", internalType: "uint256" },
      { name: "verifications", type: "uint256", internalType: "uint256" },
      { name: "lastRewardAt", type: "uint256", internalType: "uint256" },
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
    name: "isVerifier",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rewardAmounts",
    inputs: [{ name: "tier", type: "uint8", internalType: "uint8" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  // ── Events ──
  {
    type: "event",
    name: "RewardPaid",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "contributor", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "tier", type: "uint8", indexed: false, internalType: "uint8" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TreasuryFunded",
    inputs: [
      { name: "funder", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "VerifierRegistered",
    inputs: [
      { name: "verifier", type: "address", indexed: true, internalType: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "VerifierRemoved",
    inputs: [
      { name: "verifier", type: "address", indexed: true, internalType: "address" },
    ],
    anonymous: false,
  },
];

/**
 * SteplessOracle — on-chain registry of accessible locations and contributions.
 */
const STEPLESS_ORACLE_ABI = [
  // ── Write ──
  {
    type: "function",
    name: "registerLocation",
    inputs: [
      { name: "lat", type: "int256", internalType: "int256" },
      { name: "lng", type: "int256", internalType: "int256" },
      { name: "name", type: "string", internalType: "string" },
      { name: "category", type: "uint8", internalType: "uint8" },
      { name: "photoHash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [{ name: "locationId", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitContribution",
    inputs: [
      { name: "locationId", type: "bytes32", internalType: "bytes32" },
      { name: "contributionType", type: "uint8", internalType: "uint8" },
      { name: "dataHash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [{ name: "contributionId", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "verifyContribution",
    inputs: [
      { name: "contributionId", type: "bytes32", internalType: "bytes32" },
      { name: "approved", type: "bool", internalType: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── Read ──
  {
    type: "function",
    name: "getContribution",
    inputs: [{ name: "contributionId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "contributor", type: "address", internalType: "address" },
      { name: "locationId", type: "bytes32", internalType: "bytes32" },
      { name: "contributionType", type: "uint8", internalType: "uint8" },
      { name: "dataHash", type: "bytes32", internalType: "bytes32" },
      { name: "verified", type: "bool", internalType: "bool" },
      { name: "timestamp", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getLocation",
    inputs: [{ name: "locationId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "lat", type: "int256", internalType: "int256" },
      { name: "lng", type: "int256", internalType: "int256" },
      { name: "name", type: "string", internalType: "string" },
      { name: "category", type: "uint8", internalType: "uint8" },
      { name: "photoHash", type: "bytes32", internalType: "bytes32" },
      { name: "contributor", type: "address", internalType: "address" },
      { name: "timestamp", type: "uint256", internalType: "uint256" },
    ],
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
    name: "contributionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "locationIdByIndex",
    inputs: [{ name: "index", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  // ── Events ──
  {
    type: "event",
    name: "LocationRegistered",
    inputs: [
      { name: "locationId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "contributor", type: "address", indexed: true, internalType: "address" },
      { name: "lat", type: "int256", indexed: false, internalType: "int256" },
      { name: "lng", type: "int256", indexed: false, internalType: "int256" },
      { name: "name", type: "string", indexed: false, internalType: "string" },
      { name: "category", type: "uint8", indexed: false, internalType: "uint8" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ContributionSubmitted",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "contributor", type: "address", indexed: true, internalType: "address" },
      { name: "locationId", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "contributionType", type: "uint8", indexed: false, internalType: "uint8" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ContributionVerified",
    inputs: [
      { name: "contributionId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "verifier", type: "address", indexed: true, internalType: "address" },
      { name: "approved", type: "bool", indexed: false, internalType: "bool" },
    ],
    anonymous: false,
  },
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
    type: "function",
    name: "subscriptionExpiry",
    inputs: [{ name: "subscriber", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "planPrice",
    inputs: [{ name: "planId", type: "uint8", internalType: "uint8" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
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
 * ────────────────────────────────────────────────────────────── */

const REWARD_TIERS = [
  { tier: 0, label: "Basic",  amount: 0.5,  raw: 500000   },
  { tier: 1, label: "Standard", amount: 1.0,  raw: 1000000  },
  { tier: 2, label: "Premium", amount: 2.5,  raw: 2500000  },
  { tier: 3, label: "Critical", amount: 5.0,  raw: 5000000  },
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
 * ────────────────────────────────────────────────────────────── */

const CONTRIBUTION_TYPES = [
  { id: 0, label: { pt: "Mapear Local",     en: "Map Location",     es: "Mapear Lugar" } },
  { id: 1, label: { pt: "Verificar Acesso",  en: "Verify Access",    es: "Verificar Acceso" } },
  { id: 2, label: { pt: "Reportar Problema", en: "Report Issue",     es: "Reportar Problema" } },
  { id: 3, label: { pt: "Adicionar Foto",    en: "Add Photo",        es: "Añadir Foto" } },
  { id: 4, label: { pt: "Atualizar Info",    en: "Update Info",      es: "Actualizar Info" } },
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
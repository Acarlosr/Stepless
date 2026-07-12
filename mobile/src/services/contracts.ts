/**
 * Stepless — Contract Interaction Service
 *
 * Viem client for Arc Testnet (Chain ID 5042002)
 * Handles RewardDistributor, SteplessOracle, X402API contracts
 * USDC ERC-20 (6 decimals) at 0x3600000000000000000000000000000000000000
 * Memo contract at 0x5294E9927c3306DcBaDb03fe70b92e01cCede505
 *
 * Arc-specific: Gas estimated in USDC (not Gwei), Gas Station sponsorship
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Abi,
  type Chain,
  type TransactionReceipt,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  decodeFunctionResult,
  type Log,
} from 'viem';
import { ARC_TESTNET_CONFIG } from '../config/arc';

// ─── Arc Testnet Chain Definition ─────────────────────────────────────
export const arcTestnet: Chain = {
  id: ARC_TESTNET_CONFIG.chainId, // 5042002
  name: ARC_TESTNET_CONFIG.name,
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    // Arc: USDC is native at 18 decimals (for gas)
    decimals: ARC_TESTNET_CONFIG.usdcNativeDecimals,
  },
  rpcUrls: {
    default: { http: [ARC_TESTNET_CONFIG.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: ARC_TESTNET_CONFIG.blockExplorerUrl },
  },
  testnet: true,
};

// ─── Contract Addresses ───────────────────────────────────────────────
export const CONTRACT_ADDRESSES = {
  // USDC ERC-20 (6 decimals) — same asset as native, different representation
  USDC_ERC20: '0x3600000000000000000000000000000000000000' as Address,
  // Memo contract (Arc-native memo system)
  MEMO: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as Address,
  // Stepless protocol contracts — v3 LIVE on Arc Testnet (deployed 2026-07-06).
  // lowercase de propósito: o viem no ambiente RN/browser valida checksum EIP-55
  // estritamente; usar tudo minúsculo evita erro de checksum (o backend normaliza).
  STEPLESS_ORACLE: '0x53ba90e17bbe96e924979723c744475d55cccc16' as Address,
  REWARD_DISTRIBUTOR: '0xdf8fa455f01965866ac99ebc553ad3c2b58a0368' as Address,
  // X402API ainda não integrado (ver roadmap) — placeholder até o deploy.
  X402_API: '0x0000000000000000000000000000000000000000' as Address,
} as const;

// ─── RewardDistributor ABI ────────────────────────────────────────────
export const RewardDistributorABI = [
  {
    inputs: [
      { name: 'contributor', type: 'address' },
      { name: 'rewardType', type: 'uint8' },
    ],
    name: 'payReward',
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'contributor', type: 'address' }],
    name: 'getContributorStats',
    outputs: [
      { name: 'totalEarned', type: 'uint256' },
      { name: 'contributionCount', type: 'uint256' },
      { name: 'verificationCount', type: 'uint256' },
      { name: 'lastRewardAt', type: 'uint256' },
      { name: 'isTopContributor', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'treasuryBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'contributor', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'withdrawReward',
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'rewardType', type: 'uint8' }],
    name: 'rewardAmount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    // 0 = NewLocation, 1 = Verification, 2 = PhotoUpload, 3 = FirstOfMonth
    inputs: [{ name: '', type: 'uint8' }],
    name: 'rewardAmounts',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'contributor', type: 'address' }],
    name: 'pendingRewards',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'rewardType', type: 'uint8' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
    name: 'RewardPaid',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
    name: 'Withdrawal',
    type: 'event',
  },
] as const as unknown as Abi;

// ─── SteplessOracle ABI ───────────────────────────────────────────────
export const SteplessOracleABI = [
  {
    inputs: [
      { name: 'locationHash', type: 'bytes32' },
      { name: 'latPacked', type: 'int256' },
      { name: 'lngPacked', type: 'int256' },
      { name: 'dataHash', type: 'bytes32' },
    ],
    name: 'registerLocation',
    outputs: [{ name: 'locationId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'locationId', type: 'uint256' },
      { name: 'contributionType', type: 'uint8' },
      { name: 'dataHash', type: 'bytes32' },
    ],
    name: 'submitContribution',
    outputs: [{ name: 'contributionId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'contributionId', type: 'uint256' },
      { name: 'approved', type: 'bool' },
    ],
    name: 'verifyContribution',
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'locationId', type: 'uint256' }],
    name: 'getLocation',
    outputs: [
      { name: 'locationHash', type: 'bytes32' },
      { name: 'latPacked', type: 'int256' },
      { name: 'lngPacked', type: 'int256' },
      { name: 'dataHash', type: 'bytes32' },
      { name: 'verified', type: 'bool' },
      { name: 'contributor', type: 'address' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'latPacked', type: 'int256' },
      { name: 'lngPacked', type: 'int256' },
      { name: 'radiusMeters', type: 'uint256' },
    ],
    name: 'getNearbyLocations',
    outputs: [
      {
        name: 'locationIds',
        type: 'uint256[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'contributor', type: 'address' }],
    name: 'getContributorLocations',
    outputs: [{ name: 'locationIds', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'locationId', type: 'uint256' }],
    name: 'locationCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'locationId', type: 'uint256' },
      { indexed: false, name: 'latPacked', type: 'int256' },
      { indexed: false, name: 'lngPacked', type: 'int256' },
      { indexed: false, name: 'dataHash', type: 'bytes32' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
    name: 'LocationRegistered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'contributionId', type: 'uint256' },
      { indexed: false, name: 'locationId', type: 'uint256' },
      { indexed: false, name: 'contributionType', type: 'uint8' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
    name: 'ContributionSubmitted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'verifier', type: 'address' },
      { indexed: false, name: 'contributionId', type: 'uint256' },
      { indexed: false, name: 'approved', type: 'bool' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
    name: 'ContributionVerified',
    type: 'event',
  },
] as const as unknown as Abi;

// ─── X402API ABI ──────────────────────────────────────────────────────
export const X402APIABI = [
  {
    inputs: [
      { name: 'latPacked', type: 'int256' },
      { name: 'lngPacked', type: 'int256' },
      { name: 'radiusMeters', type: 'uint256' },
    ],
    name: 'queryLocation',
    outputs: [
      {
        name: 'results',
        type: 'bytes',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'subscriber', type: 'address' }],
    name: 'hasActiveSubscription',
    outputs: [{ name: 'active', type: 'bool' }, { name: 'expiresAt', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'durationDays', type: 'uint256' }],
    name: 'subscribe',
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'subscriptionPrice',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'latPacked', type: 'int256' }, { name: 'lngPacked', type: 'int256' }],
    name: 'getLocationDetails',
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'category', type: 'uint8' },
      { name: 'accessible', type: 'bool' },
      { name: 'verifiedCount', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const as unknown as Abi;

// ─── Reward Types Enum ────────────────────────────────────────────────
export enum RewardType {
  NewLocation = 0,
  Verification = 1,
  PhotoUpload = 2,
  FirstOfMonth = 3,
}

// ─── Reward Amounts (in USDC, 6 decimals) ─────────────────────────────
export const REWARD_AMOUNTS: Record<RewardType, { label: string; amount: string }> = {
  [RewardType.NewLocation]: { label: 'New Location', amount: '0.10' },
  [RewardType.Verification]: { label: 'Verification', amount: '0.05' },
  [RewardType.PhotoUpload]: { label: 'Photo Upload', amount: '0.03' },
  [RewardType.FirstOfMonth]: { label: 'First of Month Bonus', amount: '0.50' },
};

// ─── Location Categories ──────────────────────────────────────────────
export enum LocationCategory {
  Ramp = 0,
  Restroom = 1,
  Parking = 2,
  Entrance = 3,
}

// ─── Public Client (read-only) ────────────────────────────────────────
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_CONFIG.rpcUrl),
});

// ─── Arc-Specific Error Handling ──────────────────────────────────────
/**
 * Arc Testnet has specific revert reasons that need user-friendly handling:
 * - Blocklist: address is blocked from receiving rewards
 * - ZeroAddress: invalid address parameter
 * - Drain: attempted to drain treasury beyond balance
 */
export class ArcContractError extends Error {
  code: string;
  contractName: string;
  functionName: string;

  constructor(
    message: string,
    code: string,
    contractName: string,
    functionName: string
  ) {
    super(message);
    this.name = 'ArcContractError';
    this.code = code;
    this.contractName = contractName;
    this.functionName = functionName;
  }
}

/**
 * Parses Arc-specific revert reasons into user-friendly errors
 */
export function parseArcRevertError(
  error: any,
  contractName: string,
  functionName: string
): ArcContractError {
  const errorMsg = error?.message || error?.shortMessage || String(error);

  // Arc-specific revert patterns
  if (errorMsg.includes('Blocklisted') || errorMsg.includes('BLOCKLISTED') || errorMsg.includes('0x01')) {
    return new ArcContractError(
      'This address is blocklisted on Arc and cannot receive rewards.',
      'BLOCKLISTED',
      contractName,
      functionName
    );
  }

  if (errorMsg.includes('ZeroAddress') || errorMsg.includes('ZERO_ADDRESS') || errorMsg.includes('0x02')) {
    return new ArcContractError(
      'Invalid address: zero address is not allowed.',
      'ZERO_ADDRESS',
      contractName,
      functionName
    );
  }

  if (errorMsg.includes('Drain') || errorMsg.includes('DRAIN') || errorMsg.includes('InsufficientTreasury') || errorMsg.includes('0x03')) {
    return new ArcContractError(
      'Treasury has insufficient funds to pay this reward. Please try again later.',
      'INSUFFICIENT_TREASURY',
      contractName,
      functionName
    );
  }

  if (errorMsg.includes('AlreadyRegistered') || errorMsg.includes('0x04')) {
    return new ArcContractError(
      'This location has already been registered.',
      'ALREADY_REGISTERED',
      contractName,
      functionName
    );
  }

  if (errorMsg.includes('NotAuthorized') || errorMsg.includes('0x05')) {
    return new ArcContractError(
      'You are not authorized to perform this action.',
      'NOT_AUTHORIZED',
      contractName,
      functionName
    );
  }

  if (errorMsg.includes('AlreadyVerified') || errorMsg.includes('0x06')) {
    return new ArcContractError(
      'This contribution has already been verified.',
      'ALREADY_VERIFIED',
      contractName,
      functionName
    );
  }

  // Generic fallback
  return new ArcContractError(
    `Transaction failed: ${errorMsg}`,
    'UNKNOWN',
    contractName,
    functionName
  );
}

// ─── Coordinate Packing Helpers ───────────────────────────────────────
/**
 * Packs latitude/longitude into int256 for on-chain storage.
 * Multiplies by 1e6 to preserve 6 decimal places of precision.
 */
export function packCoordinate(lat: number, lng: number): { latPacked: bigint; lngPacked: bigint } {
  const latPacked = BigInt(Math.round(lat * 1_000_000));
  const lngPacked = BigInt(Math.round(lng * 1_000_000));
  return { latPacked, lngPacked };
}

export function unpackCoordinate(latPacked: bigint, lngPacked: bigint): { lat: number; lng: number } {
  return {
    lat: Number(latPacked) / 1_000_000,
    lng: Number(lngPacked) / 1_000_000,
  };
}

// ─── Gas Estimation in USDC (Arc-specific) ────────────────────────────
/**
 * On Arc, gas is paid in USDC (not Gwei/ETH).
 * Gas Station sponsors gas for SCA wallets — this is transparent to the app.
 * This function estimates gas cost in USDC for display purposes.
 */
export async function estimateGasInUSDC(
  to: Address,
  data: string,
  from?: Address,
  value?: bigint
): Promise<{ gasLimit: bigint; estimatedCostUSDC: string }> {
  try {
    const gasLimit = await publicClient.estimateGas({
      to,
      data: data as `0x${string}`,
      account: from,
      value,
    });

    // On Arc, gasPrice is in USDC (18 decimals native)
    const gasPrice = await publicClient.getGasPrice();

    // Total cost in native USDC (18 decimals)
    const totalCost = gasLimit * gasPrice;

    // Convert to 6-decimal USDC for display
    // 18 dec → 6 dec: divide by 10^12
    const costInUSDC6 = totalCost / (10n ** 12n);
    const estimatedCostUSDC = formatUnits(costInUSDC6, ARC_TESTNET_CONFIG.usdcErc20Decimals);

    return { gasLimit, estimatedCostUSDC };
  } catch (error) {
    console.error('Gas estimation error:', error);
    return { gasLimit: 0n, estimatedCostUSDC: '0' };
  }
}

// ─── RewardDistributor Service ────────────────────────────────────────
export const RewardDistributor = {
  address: CONTRACT_ADDRESSES.REWARD_DISTRIBUTOR,
  abi: RewardDistributorABI,

  /**
   * Pay a reward to a contributor
   * Called by the oracle or authorized verifier
   */
  async payReward(contributor: Address, rewardType: RewardType): Promise<string> {
    try {
      const data = encodeFunctionData({
        abi: RewardDistributorABI,
        functionName: 'payReward',
        args: [contributor, rewardType],
      });

      // Gas Station sponsors gas — no cost to user
      const { estimatedCostUSDC } = await estimateGasInUSDC(
        CONTRACT_ADDRESSES.REWARD_DISTRIBUTOR,
        data
      );
      console.log(`Estimated gas (sponsored by Gas Station): ~${estimatedCostUSDC} USDC`);

      // Transaction would be sent via wallet service
      // const txHash = await walletClient.writeContract({...})
      return data;
    } catch (error) {
      throw parseArcRevertError(error, 'RewardDistributor', 'payReward');
    }
  },

  /**
   * Get contributor statistics
   */
  async getContributorStats(contributor: Address): Promise<{
    totalEarned: string;
    contributionCount: number;
    verificationCount: number;
    lastRewardAt: Date | null;
    isTopContributor: boolean;
  }> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.REWARD_DISTRIBUTOR,
        abi: RewardDistributorABI,
        functionName: 'getContributorStats',
        args: [contributor],
      }) as [bigint, bigint, bigint, bigint, boolean];

      return {
        totalEarned: formatUnits(result[0], ARC_TESTNET_CONFIG.usdcErc20Decimals),
        contributionCount: Number(result[1]),
        verificationCount: Number(result[2]),
        lastRewardAt: result[3] > 0n ? new Date(Number(result[3]) * 1000) : null,
        isTopContributor: result[4],
      };
    } catch (error) {
      throw parseArcRevertError(error, 'RewardDistributor', 'getContributorStats');
    }
  },

  /**
   * Get treasury balance
   */
  async treasuryBalance(): Promise<string> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.REWARD_DISTRIBUTOR,
        abi: RewardDistributorABI,
        functionName: 'treasuryBalance',
        args: [],
      }) as bigint;

      return formatUnits(result, ARC_TESTNET_CONFIG.usdcErc20Decimals);
    } catch (error) {
      throw parseArcRevertError(error, 'RewardDistributor', 'treasuryBalance');
    }
  },

  /**
   * Get pending rewards for a contributor
   */
  async pendingRewards(contributor: Address): Promise<string> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.REWARD_DISTRIBUTOR,
        abi: RewardDistributorABI,
        functionName: 'pendingRewards',
        args: [contributor],
      }) as bigint;

      return formatUnits(result, ARC_TESTNET_CONFIG.usdcErc20Decimals);
    } catch (error) {
      throw parseArcRevertError(error, 'RewardDistributor', 'pendingRewards');
    }
  },

  /**
   * Get reward amount for a specific reward type
   */
  async rewardAmount(rewardType: RewardType): Promise<string> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.REWARD_DISTRIBUTOR,
        abi: RewardDistributorABI,
        functionName: 'rewardAmount',
        args: [rewardType],
      }) as bigint;

      return formatUnits(result, ARC_TESTNET_CONFIG.usdcErc20Decimals);
    } catch (error) {
      throw parseArcRevertError(error, 'RewardDistributor', 'rewardAmount');
    }
  },

  /**
   * Withdraw accumulated rewards
   */
  async withdrawReward(contributor: Address, amount: string): Promise<string> {
    try {
      const amountWei = parseUnits(amount, ARC_TESTNET_CONFIG.usdcErc20Decimals);
      const data = encodeFunctionData({
        abi: RewardDistributorABI,
        functionName: 'withdrawReward',
        args: [contributor, amountWei],
      });

      return data;
    } catch (error) {
      throw parseArcRevertError(error, 'RewardDistributor', 'withdrawReward');
    }
  },

  /**
   * Fetch RewardPaid events for a contributor
   */
  async getRewardHistory(
    contributor: Address,
    fromBlock: bigint = 0n,
    toBlock: 'latest' = 'latest'
  ): Promise<Array<{
    contributor: Address;
    rewardType: number;
    amount: string;
    timestamp: Date;
    txHash: string;
  }>> {
    try {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESSES.REWARD_DISTRIBUTOR,
        event: {
          type: 'event',
          name: 'RewardPaid',
          inputs: [
            { indexed: true, name: 'contributor', type: 'address' },
            { indexed: false, name: 'rewardType', type: 'uint8' },
            { indexed: false, name: 'amount', type: 'uint256' },
            { indexed: false, name: 'timestamp', type: 'uint256' },
          ],
        } as any,
        args: { contributor },
        fromBlock,
        toBlock,
      });

      return logs.map((log: any) => ({
        contributor: log.args.contributor,
        rewardType: Number(log.args.rewardType),
        amount: formatUnits(log.args.amount, ARC_TESTNET_CONFIG.usdcErc20Decimals),
        timestamp: new Date(Number(log.args.timestamp) * 1000),
        txHash: log.transactionHash,
      }));
    } catch (error) {
      console.error('Failed to fetch reward history:', error);
      // Fallback: query Goldsky subgraph
      return [];
    }
  },
};

// ─── SteplessOracle Service ───────────────────────────────────────────
export const SteplessOracle = {
  address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
  abi: SteplessOracleABI,

  /**
   * Register a new accessible location on-chain
   * @param locationHash - Hash of location name + coordinates
   * @param lat - Latitude (will be packed to int256)
   * @param lng - Longitude (will be packed to int256)
   * @param dataHash - IPFS hash of location metadata + photo
   */
  async registerLocation(
    locationHash: `0x${string}`,
    lat: number,
    lng: number,
    dataHash: `0x${string}`
  ): Promise<{ data: string; gasEstimate: string }> {
    try {
      const { latPacked, lngPacked } = packCoordinate(lat, lng);

      const data = encodeFunctionData({
        abi: SteplessOracleABI,
        functionName: 'registerLocation',
        args: [locationHash, latPacked, lngPacked, dataHash],
      });

      const { estimatedCostUSDC } = await estimateGasInUSDC(
        CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        data
      );

      return { data, gasEstimate: estimatedCostUSDC };
    } catch (error) {
      throw parseArcRevertError(error, 'SteplessOracle', 'registerLocation');
    }
  },

  /**
   * Submit a contribution (verification, photo update, etc.)
   */
  async submitContribution(
    locationId: bigint,
    contributionType: number,
    dataHash: `0x${string}`
  ): Promise<{ data: string; gasEstimate: string }> {
    try {
      const data = encodeFunctionData({
        abi: SteplessOracleABI,
        functionName: 'submitContribution',
        args: [locationId, contributionType, dataHash],
      });

      const { estimatedCostUSDC } = await estimateGasInUSDC(
        CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        data
      );

      return { data, gasEstimate: estimatedCostUSDC };
    } catch (error) {
      throw parseArcRevertError(error, 'SteplessOracle', 'submitContribution');
    }
  },

  /**
   * Verify a contribution (by authorized verifier)
   */
  async verifyContribution(
    contributionId: bigint,
    approved: boolean
  ): Promise<{ data: string; gasEstimate: string }> {
    try {
      const data = encodeFunctionData({
        abi: SteplessOracleABI,
        functionName: 'verifyContribution',
        args: [contributionId, approved],
      });

      const { estimatedCostUSDC } = await estimateGasInUSDC(
        CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        data
      );

      return { data, gasEstimate: estimatedCostUSDC };
    } catch (error) {
      throw parseArcRevertError(error, 'SteplessOracle', 'verifyContribution');
    }
  },

  /**
   * Get location details by ID
   */
  async getLocation(locationId: bigint): Promise<{
    locationHash: string;
    lat: number;
    lng: number;
    dataHash: string;
    verified: boolean;
    contributor: Address;
  }> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        abi: SteplessOracleABI,
        functionName: 'getLocation',
        args: [locationId],
      }) as [string, bigint, bigint, string, boolean, Address];

      const { lat, lng } = unpackCoordinate(result[1], result[2]);

      return {
        locationHash: result[0],
        lat,
        lng,
        dataHash: result[3],
        verified: result[4],
        contributor: result[5],
      };
    } catch (error) {
      throw parseArcRevertError(error, 'SteplessOracle', 'getLocation');
    }
  },

  /**
   * Get nearby locations within a radius
   */
  async getNearbyLocations(
    lat: number,
    lng: number,
    radiusMeters: bigint
  ): Promise<bigint[]> {
    try {
      const { latPacked, lngPacked } = packCoordinate(lat, lng);

      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        abi: SteplessOracleABI,
        functionName: 'getNearbyLocations',
        args: [latPacked, lngPacked, radiusMeters],
      }) as bigint[];

      return result;
    } catch (error) {
      throw parseArcRevertError(error, 'SteplessOracle', 'getNearbyLocations');
    }
  },

  /**
   * Get all locations registered by a contributor
   */
  async getContributorLocations(contributor: Address): Promise<bigint[]> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        abi: SteplessOracleABI,
        functionName: 'getContributorLocations',
        args: [contributor],
      }) as bigint[];

      return result;
    } catch (error) {
      throw parseArcRevertError(error, 'SteplessOracle', 'getContributorLocations');
    }
  },

  /**
   * Get total location count
   */
  async locationCount(): Promise<number> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        abi: SteplessOracleABI,
        functionName: 'locationCount',
        args: [],
      }) as bigint;

      return Number(result);
    } catch (error) {
      throw parseArcRevertError(error, 'SteplessOracle', 'locationCount');
    }
  },
};

// ─── Oracle v3 — leitura global (mesmo caminho do dApp web/buscar.html) ──
// O contrato v3 indexa locais por hash (locationCount + allLocationHashes +
// getLocation(bytes32)). Nome/categoria/lat/lng vêm do backend via
// /api/location-meta — a chain guarda só o hash.
const SteplessOracleV3ReadABI = [
  {
    type: 'function', name: 'locationCount',
    inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view',
  },
  {
    type: 'function', name: 'allLocationHashes',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }], stateMutability: 'view',
  },
  {
    type: 'function', name: 'getLocation',
    inputs: [{ name: 'locationHash', type: 'bytes32' }],
    outputs: [
      { name: 'locationHash', type: 'bytes32' },
      { name: 'firstContributor', type: 'address' },
      { name: 'registeredBlock', type: 'uint256' },
      { name: 'verificationCount', type: 'uint256' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

export interface OnchainLocationV3 {
  locationHash: string;
  contributor: Address;
  verifications: number;
}

/**
 * Lê TODOS os locais registrados na chain (cap `max`, igual ao dApp web).
 */
export async function fetchAllOnchainLocations(max = 100): Promise<OnchainLocationV3[]> {
  const count = Number(
    await publicClient.readContract({
      address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
      abi: SteplessOracleV3ReadABI,
      functionName: 'locationCount',
    }) as bigint
  );
  if (count === 0) return [];

  const locations: OnchainLocationV3[] = [];
  for (let i = 0; i < Math.min(count, max); i++) {
    try {
      const hash = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        abi: SteplessOracleV3ReadABI,
        functionName: 'allLocationHashes',
        args: [BigInt(i)],
      }) as string;

      const loc = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.STEPLESS_ORACLE,
        abi: SteplessOracleV3ReadABI,
        functionName: 'getLocation',
        args: [hash as `0x${string}`],
      }) as readonly [string, Address, bigint, bigint, boolean];

      locations.push({
        locationHash: hash,
        contributor: loc[1],
        verifications: Number(loc[3]),
      });
    } catch {
      // pula índice com falha de leitura
    }
  }
  return locations;
}

// ─── X402API Service ──────────────────────────────────────────────────
export const X402API = {
  address: CONTRACT_ADDRESSES.X402_API,
  abi: X402APIABI,

  /**
   * Query locations in an area (requires active subscription for premium queries)
   */
  async queryLocation(
    lat: number,
    lng: number,
    radiusMeters: bigint
  ): Promise<string> {
    try {
      const { latPacked, lngPacked } = packCoordinate(lat, lng);

      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.X402_API,
        abi: X402APIABI,
        functionName: 'queryLocation',
        args: [latPacked, lngPacked, radiusMeters],
      }) as string;

      return result;
    } catch (error) {
      throw parseArcRevertError(error, 'X402API', 'queryLocation');
    }
  },

  /**
   * Check if an address has an active subscription
   */
  async hasActiveSubscription(subscriber: Address): Promise<{
    active: boolean;
    expiresAt: Date | null;
  }> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.X402_API,
        abi: X402APIABI,
        functionName: 'hasActiveSubscription',
        args: [subscriber],
      }) as [boolean, bigint];

      return {
        active: result[0],
        expiresAt: result[1] > 0n ? new Date(Number(result[1]) * 1000) : null,
      };
    } catch (error) {
      throw parseArcRevertError(error, 'X402API', 'hasActiveSubscription');
    }
  },

  /**
   * Get subscription price
   */
  async subscriptionPrice(): Promise<string> {
    try {
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.X402_API,
        abi: X402APIABI,
        functionName: 'subscriptionPrice',
        args: [],
      }) as bigint;

      return formatUnits(result, ARC_TESTNET_CONFIG.usdcErc20Decimals);
    } catch (error) {
      throw parseArcRevertError(error, 'X402API', 'subscriptionPrice');
    }
  },

  /**
   * Get location details (name, category, accessibility, verification count)
   */
  async getLocationDetails(
    lat: number,
    lng: number
  ): Promise<{
    name: string;
    category: LocationCategory;
    accessible: boolean;
    verifiedCount: number;
  }> {
    try {
      const { latPacked, lngPacked } = packCoordinate(lat, lng);

      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.X402_API,
        abi: X402APIABI,
        functionName: 'getLocationDetails',
        args: [latPacked, lngPacked],
      }) as [string, number, boolean, bigint];

      return {
        name: result[0],
        category: result[1] as LocationCategory,
        accessible: result[2],
        verifiedCount: Number(result[3]),
      };
    } catch (error) {
      throw parseArcRevertError(error, 'X402API', 'getLocationDetails');
    }
  },
};

// ─── Goldsky Subgraph (fallback for event history) ────────────────────
export const GOLDSKY_SUBGRAPH_URL =
  'https://api.goldsky.com/api/public/project/stepless/subgraphs/stepless-testnet/v1.0/gn';

/**
 * Query reward history from Goldsky subgraph (more efficient than log scanning)
 */
export async function queryRewardHistoryFromSubgraph(contributor: Address): Promise<any[]> {
  const query = `
    query GetContributorRewards($contributor: String!) {
      rewards(
        where: { contributor: $contributor }
        orderBy: timestamp
        orderDirection: desc
        first: 100
      ) {
        id
        contributor
        rewardType
        amount
        timestamp
        txHash
      }
    }
  `;

  try {
    const response = await fetch(GOLDSKY_SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { contributor: contributor.toLowerCase() },
      }),
    });

    const data = await response.json();
    return data.data?.rewards || [];
  } catch (error) {
    console.error('Subgraph query failed:', error);
    return [];
  }
}

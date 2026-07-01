/**
 * Stepless — Wallet Service
 *
 * Crossmint integration for social login (Google, Apple, Email)
 * Creates Smart Contract Account (SCA) wallet on Arc Testnet
 * Gas Station eligible — gas sponsored transparently
 *
 * Arc Testnet specifics:
 *   - USDC is native (18 decimals) for gas payments
 *   - USDC is also ERC-20 (6 decimals) for transfers
 *   - Same underlying asset, dual representation
 *   - Gas Station sponsors gas — transparent to the app
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { createPublicClient, http, formatUnits, parseUnits, type Address } from 'viem';
import { ARC_TESTNET_CONFIG } from '../../App';

// ─── Crossmint Types ──────────────────────────────────────────────────
// Crossmint client SDK provides embedded wallet via social login
// The SDK handles SCA (Smart Contract Account) creation on Arc Testnet

interface CrossmintClient {
  wallet: {
    address: Address;
    signMessage: (message: string) => Promise<string>;
    sendTransaction: (tx: CrossmintTransaction) Promise<CrossmintTxResponse>;
  };
  login: (provider: SocialProvider) => Promise<CrossmintAuthResult>;
  logout: () => Promise<void>;
  getUser: () => CrossmintUser | null;
}

interface CrossmintTransaction {
  to: Address;
  value?: bigint;
  data?: string;
  gasLimit?: bigint;
}

interface CrossmintTxResponse {
  hash: string;
  wait: () => Promise<{ status: 'success' | 'reverted'; blockNumber: bigint }>;
}

interface CrossmintAuthResult {
  user: CrossmintUser;
  wallet: { address: Address };
}

interface CrossmintUser {
  id: string;
  email?: string;
  name?: string;
  provider: SocialProvider;
}

type SocialProvider = 'google' | 'apple' | 'email';

// ─── Wallet State ─────────────────────────────────────────────────────
interface WalletState {
  isWalletConnected: boolean;
  isLoading: boolean;
  isConnecting: boolean;
  walletAddress: Address | null;
  usdcBalance: string;        // Human-readable (6 decimals)
  usdcNativeBalance: string;  // Human-readable (18 decimals, for gas)
  user: CrossmintUser | null;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connectWallet: (provider?: SocialProvider) => Promise<void>;
  disconnectWallet: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  sendTransaction: (tx: CrossmintTransaction) => Promise<string>;
  getBalance: () => Promise<{ erc20: string; native: string }>;
}

// ─── Arc Testnet Viem Client ──────────────────────────────────────────
const arcPublicClient = createPublicClient({
  chain: {
    id: ARC_TESTNET_CONFIG.chainId,
    name: ARC_TESTNET_CONFIG.name,
    nativeCurrency: {
      name: 'USDC',
      symbol: 'USDC',
      decimals: ARC_TESTNET_CONFIG.usdcNativeDecimals,
    },
    rpcUrls: {
      default: { http: [ARC_TESTNET_CONFIG.rpcUrl] },
    },
    blockExplorers: {
      default: { url: ARC_TESTNET_CONFIG.blockExplorerUrl },
    },
  },
  transport: http(ARC_TESTNET_CONFIG.rpcUrl),
});

// ─── USDC ERC-20 ABI (minimal for balance) ────────────────────────────
const USDC_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ─── Storage Keys ─────────────────────────────────────────────────────
const STORAGE_KEYS = {
  WALLET_ADDRESS: 'stepless_wallet_address',
  AUTH_TOKEN: 'stepless_auth_token',
  USER_INFO: 'stepless_user_info',
};

// ─── Crossmint API Key (should be in env/secrets) ─────────────────────
const CROSSMINT_API_KEY = process.env.EXPO_PUBLIC_CROSSMINT_API_KEY || '';
const CROSSMINT_BASE_URL = 'https://www.crossmint.com/api';

// ─── Wallet Provider Component ────────────────────────────────────────
const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    isWalletConnected: false,
    isLoading: true,
    isConnecting: false,
    walletAddress: null,
    usdcBalance: '0',
    usdcNativeBalance: '0',
    user: null,
    error: null,
  });

  // ─── Initialize Crossmint client ──────────────────────────────────
  const crossmintClient: CrossmintClient | null = null; // Initialized on login

  // ─── Restore session on mount ─────────────────────────────────────
  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      const savedAddress = await SecureStore.getItemAsync(STORAGE_KEYS.WALLET_ADDRESS);
      const savedUser = await SecureStore.getItemAsync(STORAGE_KEYS.USER_INFO);

      if (savedAddress && savedUser) {
        const user = JSON.parse(savedUser) as CrossmintUser;
        setState((prev) => ({
          ...prev,
          isWalletConnected: true,
          walletAddress: savedAddress as Address,
          user,
          isLoading: false,
        }));
        // Fetch balance in background
        fetchBalances(savedAddress as Address);
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (e) {
      console.error('Session restore error:', e);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  // ─── Fetch USDC balances (both ERC-20 6 dec and native 18 dec) ────
  const fetchBalances = useCallback(async (address: Address) => {
    try {
      // ERC-20 USDC balance (6 decimals) — used for transfers/rewards
      const erc20Balance = await arcPublicClient.readContract({
        address: ARC_TESTNET_CONFIG.usdcErc20Address as Address,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [address],
      }) as bigint;

      const erc20Formatted = formatUnits(erc20Balance, ARC_TESTNET_CONFIG.usdcErc20Decimals);

      // Native USDC balance (18 decimals) — used for gas on Arc
      // On Arc, native balance IS USDC (not ETH)
      const nativeBalance = await arcPublicClient.getBalance({ address });
      const nativeFormatted = formatUnits(nativeBalance, ARC_TESTNET_CONFIG.usdcNativeDecimals);

      setState((prev) => ({
        ...prev,
        usdcBalance: erc20Formatted,
        usdcNativeBalance: nativeFormatted,
      }));
    } catch (e) {
      console.error('Balance fetch error:', e);
      // Don't fail the whole app if balance fetch fails
    }
  }, []);

  // ─── Connect wallet via Crossmint social login ────────────────────
  const connectWallet = useCallback(async (provider: SocialProvider = 'google') => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // ─── Crossmint Social Login Flow ─────────────────────────────
      // 1. User authenticates via Google/Apple/Email through Crossmint
      // 2. Crossmint creates an SCA (Smart Contract Account) on Arc Testnet
      // 3. SCA is Gas Station eligible — gas sponsored by Arc
      // 4. App receives wallet address + auth token

      // In production, this uses @crossmint/client-sdk:
      //
      // const client = new CrossmintClient({
      //   apiKey: CROSSMINT_API_KEY,
      //   chain: { chainId: 5042002, rpcUrl: ARC_TESTNET_CONFIG.rpcUrl },
      //   gasStation: true, // Arc Gas Station sponsorship
      // });
      // const result = await client.login(provider);
      // const walletAddress = result.wallet.address;

      // ─── Simulated flow (replace with actual SDK calls) ──────────
      const authResult = await crossmintSocialLogin(provider);

      const walletAddress = authResult.wallet.address;
      const user = authResult.user;

      // Persist session
      await SecureStore.setItemAsync(STORAGE_KEYS.WALLET_ADDRESS, walletAddress);
      await SecureStore.setItemAsync(STORAGE_KEYS.USER_INFO, JSON.stringify(user));
      await SecureStore.setItemAsync(STORAGE_KEYS.AUTH_TOKEN, authResult.token || '');

      setState((prev) => ({
        ...prev,
        isWalletConnected: true,
        isConnecting: false,
        walletAddress,
        user,
      }));

      // Fetch initial balances
      fetchBalances(walletAddress);
    } catch (e: any) {
      console.error('Wallet connect error:', e);
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: e?.message || 'Failed to connect wallet',
      }));
    }
  }, [fetchBalances]);

  // ─── Disconnect wallet ────────────────────────────────────────────
  const disconnectWallet = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.WALLET_ADDRESS);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_INFO);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);

      setState({
        isWalletConnected: false,
        isLoading: false,
        isConnecting: false,
        walletAddress: null,
        usdcBalance: '0',
        usdcNativeBalance: '0',
        user: null,
        error: null,
      });
    } catch (e) {
      console.error('Disconnect error:', e);
    }
  }, []);

  // ─── Refresh balance ──────────────────────────────────────────────
  const refreshBalance = useCallback(async () => {
    if (state.walletAddress) {
      await fetchBalances(state.walletAddress);
    }
  }, [state.walletAddress, fetchBalances]);

  // ─── Sign message via embedded wallet ─────────────────────────────
  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!state.walletAddress) throw new Error('Wallet not connected');
    // Crossmint embedded wallet signs the message
    // const signature = await crossmintClient.wallet.signMessage(message);
    // return signature;
    throw new Error('Sign message: Crossmint client not initialized — implement with SDK');
  }, [state.walletAddress]);

  // ─── Send transaction via embedded wallet ─────────────────────────
  const sendTransaction = useCallback(async (tx: CrossmintTransaction): Promise<string> => {
    if (!state.walletAddress) throw new Error('Wallet not connected');

    // Crossmint embedded wallet sends the transaction
    // Gas Station sponsors gas — user doesn't need native USDC for gas
    //
    // const response = await crossmintClient.wallet.sendTransaction({
    //   to: tx.to,
    //   value: tx.value || 0n,
    //   data: tx.data || '0x',
    //   // Gas Station handles gasLimit & gasPrice automatically
    // });
    // const receipt = await response.wait();
    // if (receipt.status === 'reverted') throw new Error('Transaction reverted');
    // return response.hash;

    throw new Error('Send transaction: Crossmint client not initialized — implement with SDK');
  }, [state.walletAddress]);

  // ─── Get balance (both representations) ───────────────────────────
  const getBalance = useCallback(async () => {
    if (!state.walletAddress) return { erc20: '0', native: '0' };
    await fetchBalances(state.walletAddress);
    return {
      erc20: state.usdcBalance,
      native: state.usdcNativeBalance,
    };
  }, [state.walletAddress, fetchBalances, state.usdcBalance, state.usdcNativeBalance]);

  const value: WalletContextValue = {
    ...state,
    connectWallet,
    disconnectWallet,
    refreshBalance,
    signMessage,
    sendTransaction,
    getBalance,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// ─── useWallet hook ───────────────────────────────────────────────────
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

// ─── Crossmint Social Login Implementation ────────────────────────────
/**
 * Performs social login via Crossmint API.
 * Creates an SCA wallet on Arc Testnet (Gas Station eligible).
 *
 * In production, this is handled by @crossmint/client-sdk.
 * The SDK opens a secure webview for OAuth (Google/Apple) or
 * email OTP, then returns the wallet credentials.
 */
async function crossmintSocialLogin(
  provider: SocialProvider
): Promise<CrossmintAuthResult & { token?: string }> {
  // ─── Production implementation with @crossmint/client-sdk ─────────
  //
  // import { CrossmintClient } from '@crossmint/client-sdk';
  //
  // const client = new CrossmintClient({
  //   apiKey: CROSSMINT_API_KEY,
  //   chain: {
  //     chainId: 5042002,
  //     rpcUrl: ARC_TESTNET_CONFIG.rpcUrl,
  //     name: 'Arc Testnet',
  //   },
  //   // Arc Gas Station sponsors gas for SCA wallets
  //   gasStation: true,
  //   // Smart Contract Account (SCA) — supports gas sponsorship
  //   walletType: 'sca',
  // });
  //
  // const result = await client.login(provider);
  // return {
  //   user: result.user,
  //   wallet: { address: result.wallet.address },
  //   token: result.token,
  // };

  // ─── Placeholder for development ──────────────────────────────────
  throw new Error(
    `Crossmint social login (${provider}) not configured. ` +
    'Set EXPO_PUBLIC_CROSSMINT_API_KEY and implement with @crossmint/client-sdk.'
  );
}

// ─── Arc-Specific: USDC Dual Representation Helper ────────────────────
/**
 * On Arc Testnet, USDC exists in two forms:
 * 1. Native USDC (18 decimals) — used for gas payments
 * 2. ERC-20 USDC (6 decimals) — used for transfers & contract interactions
 *
 * Both represent the same underlying asset. The Gas Station sponsors
 * gas so users don't need native USDC to transact.
 */
export function parseUSDC(amount: string): bigint {
  // Parse to 6 decimals (ERC-20 standard for transfers/rewards)
  return parseUnits(amount, ARC_TESTNET_CONFIG.usdcErc20Decimals);
}

export function formatUSDC(amount: bigint): string {
  // Format from 6-decimal bigint to human-readable string
  return formatUnits(amount, ARC_TESTNET_CONFIG.usdcErc20Decimals);
}

export function parseUSDCNative(amount: string): bigint {
  // Parse to 18 decimals (native gas token)
  return parseUnits(amount, ARC_TESTNET_CONFIG.usdcNativeDecimals);
}

export function formatUSDCNative(amount: bigint): string {
  return formatUnits(amount, ARC_TESTNET_CONFIG.usdcNativeDecimals);
}

// ─── Export Arc client for use by contracts service ───────────────────
export { arcPublicClient };
export type { SocialProvider, CrossmintTransaction, CrossmintUser };

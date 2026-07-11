/**
 * Stepless — Wallet Service (embedded local wallet)
 *
 * Modelo REAL do Stepless: o usuário NUNCA assina transações on-chain — quem
 * registra locais e paga a recompensa é o relayer no backend (ver services/api.ts).
 * A carteira do usuário só precisa fornecer um ENDEREÇO válido para receber USDC.
 *
 * Por isso, em vez de depender de um SDK de login social pesado (que ainda não
 * estava implementado), criamos uma carteira embarcada: no primeiro acesso é
 * gerada uma chave privada, guardada com segurança no dispositivo (expo-secure-store),
 * e o endereço derivado é usado para receber as recompensas. Simples, funciona
 * offline e não trava o app numa integração externa.
 *
 * Arc Testnet: USDC é o ativo nativo (18 casas p/ gas) e também ERC-20 (6 casas
 * p/ transferências). O saldo é lido via viem.
 */

import 'react-native-get-random-values'; // polyfill p/ crypto.getRandomValues (viem)
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { ARC_TESTNET_CONFIG } from '../config/arc';

// ─── Wallet State ─────────────────────────────────────────────────────
interface EmbeddedUser {
  id: string;
  provider: 'embedded';
}

interface WalletState {
  isWalletConnected: boolean;
  isLoading: boolean;
  isConnecting: boolean;
  walletAddress: Address | null;
  usdcBalance: string;        // ERC-20 (6 casas), legível
  usdcNativeBalance: string;  // nativo (18 casas), legível — gas
  user: EmbeddedUser | null;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  exportPrivateKey: () => Promise<string | null>;
  getBalance: () => Promise<{ erc20: string; native: string }>;
}

// ─── Arc Testnet chain (viem) ─────────────────────────────────────────
const arcChain = {
  id: ARC_TESTNET_CONFIG.chainId,
  name: ARC_TESTNET_CONFIG.name,
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: ARC_TESTNET_CONFIG.usdcNativeDecimals,
  },
  rpcUrls: { default: { http: [ARC_TESTNET_CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: 'ArcScan', url: ARC_TESTNET_CONFIG.blockExplorerUrl } },
} as const;

const arcPublicClient = createPublicClient({
  chain: arcChain as any,
  transport: http(ARC_TESTNET_CONFIG.rpcUrl),
});

// ─── USDC ERC-20 ABI (mínimo p/ saldo) ────────────────────────────────
const USDC_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ─── Storage Keys ─────────────────────────────────────────────────────
const STORAGE_KEYS = {
  PRIVATE_KEY: 'stepless_wallet_pk',
  ADDRESS: 'stepless_wallet_address',
};

// ─── Provider ─────────────────────────────────────────────────────────
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

  // ─── Saldos USDC (ERC-20 6 casas + nativo 18 casas) ─────────────────
  const fetchBalances = useCallback(async (address: Address) => {
    try {
      let erc20Formatted = '0';
      try {
        const erc20Balance = (await arcPublicClient.readContract({
          address: ARC_TESTNET_CONFIG.usdcErc20Address as Address,
          abi: USDC_ABI,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;
        erc20Formatted = formatUnits(erc20Balance, ARC_TESTNET_CONFIG.usdcErc20Decimals);
      } catch { /* sem token ERC-20 legível — mantém 0 */ }

      let nativeFormatted = '0';
      try {
        const nativeBalance = await arcPublicClient.getBalance({ address });
        nativeFormatted = formatUnits(nativeBalance, ARC_TESTNET_CONFIG.usdcNativeDecimals);
      } catch { /* ignora */ }

      setState((prev) => ({
        ...prev,
        usdcBalance: erc20Formatted,
        usdcNativeBalance: nativeFormatted,
      }));
    } catch (e) {
      console.warn('Balance fetch error:', e);
    }
  }, []);

  // ─── Restaura carteira salva no mount ───────────────────────────────
  const restoreSession = useCallback(async () => {
    try {
      const pk = await SecureStore.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
      if (pk) {
        const account = privateKeyToAccount(pk as Hex);
        setState((prev) => ({
          ...prev,
          isWalletConnected: true,
          walletAddress: account.address,
          user: { id: account.address, provider: 'embedded' },
          isLoading: false,
        }));
        fetchBalances(account.address);
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (e) {
      console.error('Session restore error:', e);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [fetchBalances]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // ─── Conecta: gera (ou reusa) a carteira embarcada ──────────────────
  const connectWallet = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));
    try {
      let pk = await SecureStore.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
      if (!pk) {
        pk = generatePrivateKey();
        await SecureStore.setItemAsync(STORAGE_KEYS.PRIVATE_KEY, pk);
      }
      const account = privateKeyToAccount(pk as Hex);
      await SecureStore.setItemAsync(STORAGE_KEYS.ADDRESS, account.address);

      setState((prev) => ({
        ...prev,
        isWalletConnected: true,
        isConnecting: false,
        walletAddress: account.address,
        user: { id: account.address, provider: 'embedded' },
      }));
      fetchBalances(account.address);
    } catch (e: any) {
      console.error('Wallet connect error:', e);
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: e?.message || 'Falha ao criar carteira',
      }));
    }
  }, [fetchBalances]);

  // ─── Desconecta e apaga a chave do dispositivo ──────────────────────
  const disconnectWallet = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.PRIVATE_KEY);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.ADDRESS);
    } catch (e) {
      console.error('Disconnect error:', e);
    }
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
  }, []);

  const refreshBalance = useCallback(async () => {
    if (state.walletAddress) await fetchBalances(state.walletAddress);
  }, [state.walletAddress, fetchBalances]);

  // ─── Assina mensagem (offline, com a chave local) ───────────────────
  const signMessage = useCallback(async (message: string): Promise<string> => {
    const pk = await SecureStore.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
    if (!pk) throw new Error('Carteira não conectada');
    const account = privateKeyToAccount(pk as Hex);
    return account.signMessage({ message });
  }, []);

  // ─── Exporta a chave privada (backup — mostrar com aviso) ───────────
  const exportPrivateKey = useCallback(async (): Promise<string | null> => {
    return SecureStore.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
  }, []);

  const getBalance = useCallback(async () => {
    if (!state.walletAddress) return { erc20: '0', native: '0' };
    await fetchBalances(state.walletAddress);
    return { erc20: state.usdcBalance, native: state.usdcNativeBalance };
  }, [state.walletAddress, fetchBalances, state.usdcBalance, state.usdcNativeBalance]);

  const value: WalletContextValue = {
    ...state,
    connectWallet,
    disconnectWallet,
    refreshBalance,
    signMessage,
    exportPrivateKey,
    getBalance,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

// ─── Helpers USDC (dupla representação da Arc) ─────────────────────────
export function parseUSDC(amount: string): bigint {
  return parseUnits(amount, ARC_TESTNET_CONFIG.usdcErc20Decimals);
}
export function formatUSDC(amount: bigint): string {
  return formatUnits(amount, ARC_TESTNET_CONFIG.usdcErc20Decimals);
}
export function parseUSDCNative(amount: string): bigint {
  return parseUnits(amount, ARC_TESTNET_CONFIG.usdcNativeDecimals);
}
export function formatUSDCNative(amount: bigint): string {
  return formatUnits(amount, ARC_TESTNET_CONFIG.usdcNativeDecimals);
}

export { arcPublicClient };
export type { EmbeddedUser };

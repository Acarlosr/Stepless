/**
 * api/relay.js — Vercel Serverless Function
 * Relayer para Arc Testnet: recebe dados do usuário e submete
 * a transação com o EOA admin (paga o gas em USDC).
 *
 * POST /api/relay
 * Body: {
 *   action: 'submitContribution' | 'registerLocation',
 *   userAddress: '0x...',
 *   submissionData: { locationHash, contributionType, dataHash, ... }
 * }
 *
 * Resposta: { success: true, txHash: '0x...' }
 *           { success: false, error: '...' }
 *
 * Variáveis de ambiente necessárias no Vercel:
 *   RELAYER_PRIVATE_KEY    — chave privada do EOA admin (testnet only)
 *   ORACLE_ADDRESS         — endereço do SteplessOracle deployado
 *   ARC_RPC_URL            — https://rpc.testnet.arc.network
 */

import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Arc Testnet chain config ───────────────────────────────────────────────
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
};

// ─── SteplessOracle ABI (funções de escrita) ────────────────────────────────
// ABI real do SteplessOracle (onlyAuthorized — relayer chama em nome do usuário)
const ORACLE_ABI = [
  {
    name: 'registerLocation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'locationHash', type: 'bytes32' },
      { name: 'latPacked',    type: 'uint256' },
      { name: 'lngPacked',    type: 'uint256' },
      { name: 'dataHash',     type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'submitContribution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'contributionId',   type: 'bytes32' },
      { name: 'locationHash',     type: 'bytes32' },
      { name: 'contributionType', type: 'uint8'   },
      { name: 'dataHash',         type: 'bytes32' },
    ],
    outputs: [],
  },
];

// ─── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Validação de env vars
  if (!process.env.RELAYER_PRIVATE_KEY) {
    return res.status(500).json({ success: false, error: 'Relayer not configured' });
  }
  if (!process.env.ORACLE_ADDRESS) {
    return res.status(500).json({ success: false, error: 'Oracle address not configured' });
  }

  const { action, userAddress, submissionData } = req.body || {};

  if (!action || !userAddress || !submissionData) {
    return res.status(400).json({ success: false, error: 'Missing required fields: action, userAddress, submissionData' });
  }

  if (!['submitContribution', 'registerLocation'].includes(action)) {
    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }

  // Valida endereço do usuário (básico)
  if (!/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
    return res.status(400).json({ success: false, error: 'Invalid userAddress' });
  }

  try {
    // Configura EOA admin como signer
    const pk = process.env.RELAYER_PRIVATE_KEY.startsWith('0x')
      ? process.env.RELAYER_PRIVATE_KEY
      : `0x${process.env.RELAYER_PRIVATE_KEY}`;

    const account = privateKeyToAccount(pk);

    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(),
    });

    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(),
    });

    const oracleAddress = process.env.ORACLE_ADDRESS;

    let txHash;

    // ── submitContribution ────────────────────────────────────────────
    if (action === 'submitContribution') {
      const { locationHash, contributionType, dataHash } = submissionData;

      if (!locationHash || contributionType === undefined || !dataHash) {
        return res.status(400).json({
          success: false,
          error: 'submitContribution requires: locationHash, contributionType, dataHash',
        });
      }

      // contributionId = keccak256(locationHash + userAddress + blockNumber)
      const contributionId = `0x${Buffer.from(
        require('crypto').createHash('sha256')
          .update(`${locationHash}${userAddress}${Date.now()}`)
          .digest()
      ).toString('hex')}`;

      txHash = await walletClient.writeContract({
        address: oracleAddress,
        abi: ORACLE_ABI,
        functionName: 'submitContribution',
        args: [
          contributionId,
          locationHash,
          Number(contributionType),
          dataHash,
        ],
      });
    }

    // ── registerLocation ──────────────────────────────────────────────
    if (action === 'registerLocation') {
      const { locationHash, latPacked, lngPacked, dataHash } = submissionData;

      if (!locationHash || !latPacked || !lngPacked || !dataHash) {
        return res.status(400).json({
          success: false,
          error: 'registerLocation requires: locationHash, latPacked, lngPacked, dataHash',
        });
      }

      txHash = await walletClient.writeContract({
        address: oracleAddress,
        abi: ORACLE_ABI,
        functionName: 'registerLocation',
        args: [
          locationHash,
          BigInt(latPacked),
          BigInt(lngPacked),
          dataHash,
        ],
      });
    }

    // Aguarda confirmação (1 bloco)
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return res.status(200).json({
      success: true,
      txHash,
      blockNumber: receipt.blockNumber?.toString(),
      status: receipt.status,
    });

  } catch (err) {
    console.error('[relay] Error:', err);

    // Arc-specific error messages
    const msg = err?.shortMessage || err?.message || String(err);

    if (/blocklist|blocked/i.test(msg)) {
      return res.status(403).json({ success: false, error: 'Address blocked by Arc anti-drain system' });
    }
    if (/insufficient|balance/i.test(msg)) {
      return res.status(402).json({ success: false, error: 'Relayer has insufficient USDC for gas' });
    }

    return res.status(500).json({ success: false, error: msg });
  }
}

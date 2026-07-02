/**
 * api/setup.js — One-time setup: autoriza o relayer no SteplessOracle.
 * Pode ser chamado quantas vezes quiser (idempotente).
 * GET /api/setup → retorna status
 * POST /api/setup → executa setAuthorizedCaller se necessário
 */

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] } },
};

const ORACLE_ABI = [
  {
    name: 'setAuthorizedCaller',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'caller',     type: 'address' },
      { name: 'authorized', type: 'bool'    },
    ],
    outputs: [],
  },
  {
    name: 'authorizedCallers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'caller', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'admin',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.RELAYER_PRIVATE_KEY || !process.env.ORACLE_ADDRESS) {
    return res.status(500).json({ error: 'Env vars not configured' });
  }

  const pk = process.env.RELAYER_PRIVATE_KEY.startsWith('0x')
    ? process.env.RELAYER_PRIVATE_KEY
    : `0x${process.env.RELAYER_PRIVATE_KEY}`;

  const account = privateKeyToAccount(pk);
  const oracleAddress = process.env.ORACLE_ADDRESS;

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

  // Lê estado atual do contrato
  let isAuthorized, adminAddr;
  try {
    [isAuthorized, adminAddr] = await Promise.all([
      publicClient.readContract({ address: oracleAddress, abi: ORACLE_ABI, functionName: 'authorizedCallers', args: [account.address] }),
      publicClient.readContract({ address: oracleAddress, abi: ORACLE_ABI, functionName: 'admin' }),
    ]);
  } catch (readErr) {
    return res.status(500).json({ success: false, error: `Erro ao ler contrato: ${readErr?.shortMessage || readErr?.message}` });
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      relayer: account.address,
      admin: adminAddr,
      isRelayerAdmin: adminAddr.toLowerCase() === account.address.toLowerCase(),
      isAuthorized,
    });
  }

  // POST → autoriza se necessário
  if (isAuthorized) {
    return res.status(200).json({ success: true, message: 'Relayer já está autorizado.', relayer: account.address });
  }

  if (adminAddr.toLowerCase() !== account.address.toLowerCase()) {
    return res.status(403).json({
      success: false,
      error: `Relayer não é o admin. Admin é ${adminAddr}. Conecte a wallet admin e chame setAuthorizedCaller manualmente.`,
      relayer: account.address,
    });
  }

  try {
    const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
    const txHash = await walletClient.writeContract({
      address: oracleAddress,
      abi: ORACLE_ABI,
      functionName: 'setAuthorizedCaller',
      args: [account.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return res.status(200).json({ success: true, message: 'Relayer autorizado com sucesso!', txHash, relayer: account.address });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.shortMessage || err?.message });
  }
}

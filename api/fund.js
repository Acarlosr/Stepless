/**
 * api/fund.js — Funda a tesouraria do RewardDistributor com USDC do relayer,
 * usando a interface ERC-20 (o contrato rejeita USDC nativo de propósito).
 *
 * GET  /api/fund            → mostra saldos (relayer e tesouraria)
 * POST /api/fund {amount}   → transfere `amount` USDC (ex.: 5 = 5 USDC) do
 *                             relayer para o RewardDistributor
 */

import { publicClient, walletFor, relayerAccount, distributorAddress, cors, translateError } from './_stepless.js';

const USDC_ERC20 = '0x3600000000000000000000000000000000000000';
const ERC20_ABI = [
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.RELAYER_PRIVATE_KEY) {
    return res.status(500).json({ success: false, error: 'Relayer não configurado.' });
  }
  if (process.env.VERIFY_SECRET && req.method === 'POST' && req.headers['x-verify-secret'] !== process.env.VERIFY_SECRET) {
    return res.status(401).json({ success: false, error: 'X-Verify-Secret inválido.' });
  }

  const pub = publicClient();
  const relayer = relayerAccount();
  const distributor = distributorAddress();

  try {
    const [relayerBal, treasuryBal] = await Promise.all([
      pub.readContract({ address: USDC_ERC20, abi: ERC20_ABI, functionName: 'balanceOf', args: [relayer.address] }),
      pub.readContract({ address: USDC_ERC20, abi: ERC20_ABI, functionName: 'balanceOf', args: [distributor] }),
    ]);

    if (req.method === 'GET') {
      return res.status(200).json({
        relayer: relayer.address,
        distributor,
        relayerUSDC: (Number(relayerBal) / 1e6).toFixed(2),
        treasuryUSDC: (Number(treasuryBal) / 1e6).toFixed(2),
        howTo: 'POST {"amount": 5} para transferir 5 USDC do relayer para a tesouraria.',
      });
    }

    const amount = Number((req.body || {}).amount);
    if (!amount || amount <= 0 || amount > 1000) {
      return res.status(400).json({ success: false, error: 'Informe {"amount": N} entre 0 e 1000 USDC.' });
    }
    const units = BigInt(Math.round(amount * 1e6)); // 6 decimais

    if (relayerBal < units) {
      return res.status(402).json({
        success: false,
        error: `Relayer só tem ${(Number(relayerBal) / 1e6).toFixed(2)} USDC. Envie USDC do faucet para ${relayer.address} primeiro.`,
      });
    }

    const hash = await walletFor(relayer).writeContract({
      address: USDC_ERC20, abi: ERC20_ABI, functionName: 'transfer', args: [distributor, units],
    });
    await pub.waitForTransactionReceipt({ hash });

    const newBal = await pub.readContract({ address: USDC_ERC20, abi: ERC20_ABI, functionName: 'balanceOf', args: [distributor] });
    return res.status(200).json({
      success: true,
      txHash: hash,
      treasuryUSDC: (Number(newBal) / 1e6).toFixed(2),
    });
  } catch (err) {
    console.error('[fund] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

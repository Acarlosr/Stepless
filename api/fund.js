/**
 * api/fund.js — Saldos do relayer e da tesouraria. SOMENTE LEITURA.
 *
 * GET /api/fund → mostra os saldos
 *
 * ⚠️ O POST FOI REMOVIDO (auditoria de mainnet, achado C4).
 *
 * Antes, um POST aqui com o header administrativo movia até 1000 USDC do
 * relayer para a tesouraria. Mover dinheiro por rota HTTP protegida só por uma
 * string em env var é a definição de superfície desnecessária: fundear a
 * tesouraria acontece algumas vezes por mês, não a cada requisição.
 *
 * Agora: `node scripts/fund-treasury.mjs <valor>`, no terminal de quem tem a
 * chave — ou, melhor ainda, um `approve` + `fundTreasury` assinado direto pelo
 * multisig.
 */

import { publicClient, relayerAccount, distributorAddress, cors, translateError } from './_stepless.js';
import { usdcAddress, NETWORK_NAME } from './_network.js';

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

export default async function handler(req, res) {
  cors(res, 'GET, OPTIONS', req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Somente GET. Fundear a tesouraria saiu desta rota por segurança.',
      hint: 'Rode localmente: node scripts/fund-treasury.mjs <valor em USDC>',
    });
  }

  const pub = publicClient();
  const distributor = distributorAddress();
  const usdc = usdcAddress();

  try {
    const relayer = relayerAccount();
    const [relayerBal, treasuryBal] = await Promise.all([
      pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [relayer.address] }),
      pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [distributor] }),
    ]);

    return res.status(200).json({
      network: NETWORK_NAME,
      relayer: relayer.address,
      distributor,
      usdc,
      relayerUSDC: (Number(relayerBal) / 1e6).toFixed(2),
      treasuryUSDC: (Number(treasuryBal) / 1e6).toFixed(2),
      howTo: 'node scripts/fund-treasury.mjs 5   (ou approve + fundTreasury pelo multisig)',
    });
  } catch (err) {
    console.error('[fund] Error:', err);
    const t = translateError(err);
    return res.status(t.status).json({ success: false, error: t.error, detail: t.detail });
  }
}

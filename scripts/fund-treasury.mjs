#!/usr/bin/env node
/**
 * scripts/fund-treasury.mjs — Fundeia a tesouraria do RewardDistributor.
 *
 * Substitui o antigo POST /api/fund, que movia até 1000 USDC por rota HTTP
 * protegida só por um header (auditoria de mainnet, achado C4).
 *
 *   node scripts/fund-treasury.mjs            → mostra os saldos
 *   node scripts/fund-treasury.mjs 25         → transfere 25 USDC
 *
 * Variáveis: FUNDER_PRIVATE_KEY (ou RELAYER_PRIVATE_KEY), STEPLESS_NETWORK.
 *
 * Em mainnet, prefira `approve` + `fundTreasury` assinados pelo multisig — o
 * contrato aceita qualquer origem, e assim nenhuma chave em texto puro toca no
 * dinheiro.
 */

import { createPublicClient, createWalletClient, http, fallback, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainConfig, rpcUrls, contractAddresses, usdcAddress, NETWORK_NAME } from '../api/_network.js';

const ERC20_ABI = [
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const chain = chainConfig();
const transport = () => fallback(rpcUrls().map((u) => http(u, { timeout: 15_000 })));
const pub = createPublicClient({ chain, transport: transport() });

const distributor = getAddress(contractAddresses().RewardDistributor.toLowerCase());
const usdc = usdcAddress();

const pk = process.env.FUNDER_PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY;
if (!pk) {
  console.error('Defina FUNDER_PRIVATE_KEY (ou RELAYER_PRIVATE_KEY).');
  process.exit(1);
}
const funder = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

const [funderBal, treasuryBal] = await Promise.all([
  pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [funder.address] }),
  pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [distributor] }),
]);

console.log(`Rede:        ${NETWORK_NAME}`);
console.log(`USDC:        ${usdc}`);
console.log(`Fundeador:   ${funder.address}  (${(Number(funderBal) / 1e6).toFixed(2)} USDC)`);
console.log(`Tesouraria:  ${distributor}  (${(Number(treasuryBal) / 1e6).toFixed(2)} USDC)`);

const arg = process.argv[2];
if (!arg) {
  console.log('\nPara transferir: node scripts/fund-treasury.mjs <valor em USDC>');
  process.exit(0);
}

const amount = Number(arg);
if (!Number.isFinite(amount) || amount <= 0) {
  console.error('Valor inválido.');
  process.exit(1);
}
const units = BigInt(Math.round(amount * 1e6));
if (funderBal < units) {
  console.error(`Saldo insuficiente: tem ${(Number(funderBal) / 1e6).toFixed(2)} USDC.`);
  process.exit(1);
}

// Transferência direta é suficiente: o contrato lê o próprio balanceOf para
// saber quanto tem. fundTreasury() existe para registrar o evento
// TreasuryFunded, mas exige approve antes — do multisig, use aquele caminho.
const wallet = createWalletClient({ account: funder, chain, transport: transport() });
const hash = await wallet.writeContract({
  address: usdc, abi: ERC20_ABI, functionName: 'transfer', args: [distributor, units],
});
console.log(`\nEnviando ${amount} USDC... ${hash}`);
await pub.waitForTransactionReceipt({ hash });

const novo = await pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [distributor] });
console.log(`✓ Tesouraria agora: ${(Number(novo) / 1e6).toFixed(2)} USDC`);

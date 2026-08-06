/**
 * scripts/check-live-contracts.mjs — Qual par de contratos está vivo na Arc?
 *
 * CONTEXTO
 * --------
 * Em 31/07/2026 os contratos foram redeployados (commit d9805499), mas só
 * `mobile/src/services/contracts.ts` foi atualizado. O `frontend/arc-config.js`
 * e o README continuaram apontando para o par anterior. Hoje o app e o site
 * leem de endereços DIFERENTES, e um dos dois está falando com um contrato
 * morto.
 *
 * Este script não adivinha: pergunta para a própria Arc.
 *
 * COMO RODAR
 *   node scripts/check-live-contracts.mjs
 *
 * Opcionalmente, para conferir também o que a produção está usando:
 *   ORACLE_ADDRESS=0x... DISTRIBUTOR_ADDRESS=0x... node scripts/check-live-contracts.mjs
 *
 * Só faz leitura. Não envia transação, não precisa de chave privada.
 */

import { createPublicClient, http, fallback, formatUnits } from 'viem';

const RPC_URLS = [
  process.env.ARC_RPC_URL,
  'https://rpc.testnet.arc.network',
].filter(Boolean);

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
};

const CANDIDATOS = [
  {
    versao: 'v4  (usado pelo MOBILE)',
    oracle: '0x69b3f9caca6514f76dd2f0dc4b54409e6d5da5cc',
    distributor: '0xef5d148b126d8dcdc7d344dfa367c61acbb02ea0',
    ondeEstá: 'mobile/src/services/contracts.ts',
  },
  {
    versao: 'v3  (usado pela WEB e pelo README)',
    oracle: '0x53ba90e17bbe96e924979723c744475d55cccc16',
    distributor: '0xdf8fa455f01965866ac99ebc553ad3c2b58a0368',
    ondeEstá: 'frontend/arc-config.js + README.md',
  },
];

/**
 * Endereço do relayer (o EOA que o /api/relay usa para escrever).
 * Está documentado em frontend/arc-config.js. Sobrescrevível se mudar.
 *
 * ⚠️ ATENÇÃO: este sinal NÃO desempata sozinho, e é fácil se enganar com ele.
 * O `api/relay.js` se AUTO-AUTORIZA: quando ele encontra um oracle em que não
 * é autorizado, chama `setAuthorizedCaller` nele mesmo antes de escrever.
 * Resultado: todo oracle para o qual o backend já apontou alguma vez fica com o
 * relayer autorizado para sempre — inclusive os abandonados. Autorização aqui
 * é histórico, não estado atual.
 *
 * Serve para o caso NEGATIVO: um contrato onde o relayer NÃO está autorizado
 * nunca recebeu escrita do backend, e pode ser descartado com segurança.
 *
 * Para saber qual está em uso AGORA, só há duas fontes confiáveis:
 *   1. a variável ORACLE_ADDRESS no Vercel (é ela que o relayer lê);
 *   2. a data da última transação de cada oracle no ArcScan.
 */
const RELAYER = (process.env.RELAYER_ADDRESS || '0xd299358Db4e263d95Fdc0B72970373470921c53A');

const ORACLE_ABI = [
  { name: 'locationCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'admin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'rewardDistributor', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'authorizedCallers', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
];

const DISTRIBUTOR_ABI = [
  { name: 'treasuryBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'admin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'authorizedCallers', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
];

const client = createPublicClient({
  chain: arcTestnet,
  transport: fallback(RPC_URLS.map((u) => http(u, { retryCount: 2, retryDelay: 600, timeout: 15_000 }))),
});

// Guarda o primeiro erro de RPC para o diagnóstico final. Sem isto, uma rede
// bloqueada e um contrato inexistente ficam indistinguíveis na saída — e a
// conclusão errada aqui leva a apontar o projeto inteiro para o endereço errado.
let primeiroErroRpc = null;

/** Existe bytecode nesse endereço? Endereço sem código = contrato inexistente. */
async function temCodigo(address) {
  try {
    const code = await client.getBytecode({ address });
    return Boolean(code && code !== '0x');
  } catch (err) {
    if (!primeiroErroRpc) primeiroErroRpc = err?.shortMessage || err?.message || String(err);
    return null; // erro de RPC, não conclusão
  }
}

async function ler(address, abi, functionName, args = []) {
  try {
    return { ok: true, valor: await client.readContract({ address, abi, functionName, args }) };
  } catch (err) {
    return { ok: false, erro: err?.shortMessage || err?.message || String(err) };
  }
}

async function inspecionar(c) {
  console.log(`\n${'─'.repeat(66)}`);
  console.log(`${c.versao}`);
  console.log(`declarado em: ${c.ondeEstá}`);
  console.log('─'.repeat(66));

  const oracleTemCodigo = await temCodigo(c.oracle);
  console.log(`\n  Oracle       ${c.oracle}`);
  console.log(`    bytecode:  ${oracleTemCodigo === null ? '? (RPC falhou)' : oracleTemCodigo ? 'SIM' : 'NÃO — endereço vazio'}`);

  let locationCount = null;
  let relayerAutorizado = null;
  if (oracleTemCodigo) {
    const lc = await ler(c.oracle, ORACLE_ABI, 'locationCount');
    const adm = await ler(c.oracle, ORACLE_ABI, 'admin');
    const rd = await ler(c.oracle, ORACLE_ABI, 'rewardDistributor');
    const auth = await ler(c.oracle, ORACLE_ABI, 'authorizedCallers', [RELAYER]);
    locationCount = lc.ok ? Number(lc.valor) : null;
    relayerAutorizado = auth.ok ? Boolean(auth.valor) : null;
    console.log(`    locais:    ${lc.ok ? locationCount : `erro (${lc.erro})`}`);
    console.log(`    admin:     ${adm.ok ? adm.valor : `erro (${adm.erro})`}`);
    console.log(`    distrib.:  ${rd.ok ? rd.valor : `erro (${rd.erro})`}`);
    console.log(`    relayer:   ${auth.ok ? (auth.valor ? 'AUTORIZADO a escrever' : 'não autorizado') : `erro (${auth.erro})`}`);
    if (rd.ok && rd.valor?.toLowerCase() !== c.distributor.toLowerCase()) {
      console.log(`    ⚠ o Oracle aponta para um Distributor DIFERENTE do declarado neste par`);
    }
  }

  const distTemCodigo = await temCodigo(c.distributor);
  console.log(`\n  Distributor  ${c.distributor}`);
  console.log(`    bytecode:  ${distTemCodigo === null ? '? (RPC falhou)' : distTemCodigo ? 'SIM' : 'NÃO — endereço vazio'}`);

  let tesouraria = null;
  if (distTemCodigo) {
    const tb = await ler(c.distributor, DISTRIBUTOR_ABI, 'treasuryBalance');
    const adm = await ler(c.distributor, DISTRIBUTOR_ABI, 'admin');
    tesouraria = tb.ok ? tb.valor : null;
    console.log(`    tesouraria:${tb.ok ? ` ${formatUnits(tb.valor, 6)} USDC` : ` erro (${tb.erro})`}`);
    console.log(`    admin:     ${adm.ok ? adm.valor : `erro (${adm.erro})`}`);
  }

  return { ...c, oracleTemCodigo, distTemCodigo, locationCount, tesouraria, relayerAutorizado };
}

console.log('Consultando a Arc Testnet…');
console.log(`RPC: ${RPC_URLS.join(', ')}`);

const resultados = [];
for (const c of CANDIDATOS) resultados.push(await inspecionar(c));

// O par de produção é o que está nas env vars do Vercel — se forem passadas.
if (process.env.ORACLE_ADDRESS || process.env.DISTRIBUTOR_ADDRESS) {
  console.log(`\n${'─'.repeat(66)}`);
  console.log('PRODUÇÃO (variáveis de ambiente do relayer)');
  console.log('─'.repeat(66));
  console.log(`  ORACLE_ADDRESS:      ${process.env.ORACLE_ADDRESS || '(não definida)'}`);
  console.log(`  DISTRIBUTOR_ADDRESS: ${process.env.DISTRIBUTOR_ADDRESS || '(não definida)'}`);
  console.log('\n  Este é o par que MANDA: é com ele que o /api/relay escreve.');
}

console.log(`\n${'═'.repeat(66)}`);
console.log('LEITURA DO RESULTADO');
console.log('═'.repeat(66));
console.log(`
  O par vivo é aquele em que os DOIS endereços têm bytecode e a tesouraria
  tem saldo. "locais" alto indica onde as contribuições reais foram parar.

  Um par sem bytecode em qualquer um dos dois endereços está morto — o lado
  do projeto que aponta para ele precisa ser corrigido.

  Se os dois pares responderem, decide pelo maior "locais" e pela tesouraria
  com saldo: é onde as recompensas estão sendo pagas de fato.
`);

const vivos = resultados.filter((r) => r.oracleTemCodigo && r.distTemCodigo);
if (vivos.length === 1) {
  console.log(`  → Só um par respondeu: ${vivos[0].versao.trim()}`);
  console.log(`    Corrigir o outro lado do projeto para estes endereços.\n`);
} else if (vivos.length === 0) {
  if (primeiroErroRpc) {
    // Distinção que importa: nenhuma resposta porque a REDE falhou é um
    // resultado vazio, não a prova de que os contratos sumiram.
    console.log('  → INCONCLUSIVO: o RPC não respondeu, então nada foi verificado.');
    console.log(`    Erro: ${primeiroErroRpc}`);
    console.log('\n    Não conclua nada daqui. Tente de novo, ou aponte para outro nó:');
    console.log('      ARC_RPC_URL=https://seu-no node scripts/check-live-contracts.mjs');
    console.log('\n    Alternativa sem script: abrir os quatro endereços no ArcScan');
    console.log('    (https://testnet.arcscan.app/address/<endereço>) e ver qual tem');
    console.log('    código e transações recentes.\n');
  } else {
    console.log('  → Nenhum dos dois pares existe on-chain. O deploy vivo é um terceiro par.\n');
  }
} else {
  console.log('  → Os dois pares existem on-chain. Desempate pelo relayer:\n');
  const autorizados = vivos.filter((r) => r.relayerAutorizado === true);
  if (autorizados.length === 1) {
    const v = autorizados[0];
    console.log(`     ${v.versao.trim()}`);
    console.log(`     É o único onde o relayer pode escrever — logo, é onde as`);
    console.log(`     contribuições novas entram. Alinhar o resto do projeto nele.\n`);
  } else if (autorizados.length === 0) {
    console.log('     O relayer não está autorizado em NENHUM dos dois.');
    console.log('     Ou o endereço do relayer mudou (passe RELAYER_ADDRESS=0x...),');
    console.log('     ou falta rodar POST /api/setup no par correto.\n');
  } else {
    // Esperado, e não é falha: o relay.js se auto-autoriza em todo oracle para
    // o qual já apontou. A autorização é histórico acumulado, não estado atual.
    console.log('     O relayer está autorizado nos DOIS — resultado esperado,');
    console.log('     porque o api/relay.js se auto-autoriza em todo oracle para');
    console.log('     o qual já apontou. Isso é histórico, não estado atual.\n');
    console.log('     Para decidir, use uma destas duas fontes:');
    console.log('       1. Vercel → Settings → Environment Variables → ORACLE_ADDRESS');
    console.log('          (é literalmente o valor que o relayer lê ao escrever)');
    console.log('       2. ArcScan: abra os dois oracles e compare a DATA da última');
    console.log('          transação. O que tem movimento recente é o que está em uso.');
    vivos.forEach((v) => {
      console.log(`          ${v.versao.trim().split(' ')[0]}: https://testnet.arcscan.app/address/${v.oracle}`);
    });
    console.log('');
  }
  console.log(`     Relayer conferido: ${RELAYER}`);
  console.log('     (se não for esse, rode de novo com RELAYER_ADDRESS=0x...)\n');
}

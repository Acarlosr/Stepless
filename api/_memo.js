/**
 * api/_memo.js — Escrita on-chain com Memo nativo da Arc.
 * (Prefixo "_" impede a Vercel de expor este arquivo como endpoint.)
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * O SteplessOracle tenta anexar o memo por dentro, chamando o predeploy a
 * partir do próprio contrato (`_attachMemo`). Isso NUNCA funcionou. Todas as
 * transações de registerLocation/submitContribution desde o deploy do v4
 * (31/07/2026) carregam uma internal transaction revertida — engolida pelo
 * try/catch do oracle, que emite `MemoAttachFailed` e segue. A tx fica com
 * status ok e o dado on-chain é gravado, então a falha passou despercebida.
 *
 * Duas causas independentes, ambas conferidas contra o código-fonte verificado
 * do Memo em 0x5294E9927c3306DcBaDb03fe70b92e01cCede505 (ArcScan):
 *
 *   1. Assinatura errada. O IMemo do repositório declara
 *      `attachMemo(bytes32,bytes)` → selector 0xc16b4795. O Memo real expõe
 *      `memo(address,bytes,bytes32,bytes)` → selector 0xc3b2c4f8. A função
 *      chamada não existe: cai no fallback e reverte.
 *
 *   2. Mesmo com o selector certo, a chamada é impossível. O Memo é EOA-only
 *      por construção — ele repassa a subchamada pelo precompile `callFrom`
 *      (0x1800…0003), que exige que o `sender` informado seja o próprio caller
 *      ou o tx.origin. Um CONTRATO chamando o Memo não é nem um nem outro, e a
 *      chamada reverte antes de qualquer coisa. O NatSpec do IMemo da Circle
 *      diz isso literalmente.
 *
 * ── O PADRÃO CORRETO ───────────────────────────────────────────────────────
 *
 * A relação se inverte: em vez do oracle chamar o Memo, o relayer (que é um
 * EOA) chama o Memo, e o Memo chama o oracle em nome dele:
 *
 *     relayer EOA
 *        └─> Memo.memo(target=SteplessOracle, data=registerLocation(...),
 *                      memoId, memoData)
 *              └─> callFrom(sender=relayer, target=oracle, data)
 *                    └─> SteplessOracle.registerLocation(...)
 *                        // msg.sender == relayer EOA
 *
 * O `callFrom` preserva o caller, então o oracle continua vendo o relayer
 * autorizado como msg.sender e o `onlyAuthorized` passa normalmente. A
 * diferença é que agora sai um evento `Memo(sender, target, callDataHash,
 * memoId, memo, memoIndex)` de verdade, com índice sequencial — indexável pelo
 * subgraph, que é o ponto inteiro de usar o Memo.
 *
 * ── DEGRADAÇÃO ─────────────────────────────────────────────────────────────
 *
 * O caminho do Memo é simulado antes de gastar gas. Se a simulação falhar por
 * qualquer motivo (predeploy ausente na rede, precompile desabilitado, mudança
 * de ABI), caímos para a escrita direta no oracle — exatamente o que o sistema
 * fazia antes. O registro continua acontecendo; só se perde a indexação
 * auxiliar. Uma falha de indexação não pode derrubar uma contribuição.
 *
 * Desligar de propósito: STEPLESS_MEMO=false.
 */

import { encodeFunctionData } from 'viem';
import { memoAddress } from './_network.js';

/** ABI mínima do predeploy Memo da Arc (só o que usamos). */
export const MEMO_ABI = [
  {
    type: 'function',
    name: 'memo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'memoId', type: 'bytes32' },
      { name: 'memoData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'memoIndex',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Memo',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'target', type: 'address', indexed: true },
      { name: 'callDataHash', type: 'bytes32', indexed: false },
      { name: 'memoId', type: 'bytes32', indexed: true },
      { name: 'memo', type: 'bytes', indexed: false },
      { name: 'memoIndex', type: 'uint256', indexed: false },
    ],
  },
];

/** O Memo está disponível e ligado nesta rede? */
export function memoEnabled() {
  if (process.env.STEPLESS_MEMO === 'false') return false;
  const addr = memoAddress();
  return Boolean(addr) && addr !== '0x0000000000000000000000000000000000000000';
}

/**
 * Escreve no oracle anexando um memo nativo da Arc.
 *
 * Assinatura compatível com walletClient.writeContract() para que a troca no
 * relay.js seja um rename, mais `memoId`/`memoData`.
 *
 * @param {object}   p
 * @param {object}   p.walletClient  cliente viem do relayer (EOA)
 * @param {object}   p.publicClient  cliente viem para simulação
 * @param {`0x${string}`} p.address  endereço do SteplessOracle
 * @param {Array}    p.abi           ORACLE_ABI
 * @param {string}   p.functionName  'registerLocation' | 'submitContribution'
 * @param {Array}    p.args          argumentos da função do oracle
 * @param {`0x${string}`} p.memoId   identificador do memo (locationHash/contributionId)
 * @param {`0x${string}`} p.memoData bytes de metadado a anexar
 * @returns {Promise<{txHash: `0x${string}`, viaMemo: boolean, memoError: string|null}>}
 */
export async function writeWithMemo({
  walletClient,
  publicClient,
  address,
  abi,
  functionName,
  args,
  memoId,
  memoData,
}) {
  const innerData = encodeFunctionData({ abi, functionName, args });

  // Caminho direto: o que o sistema sempre fez. Usado como fallback.
  const direct = () =>
    walletClient.writeContract({ address, abi, functionName, args });

  if (!memoEnabled()) {
    return { txHash: await direct(), viaMemo: false, memoError: null };
  }

  const memo = memoAddress();

  try {
    // Simular ANTES de gastar gas. Se o predeploy não responder como
    // esperado nesta rede, descobrimos aqui e não numa tx revertida.
    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: memo,
      abi: MEMO_ABI,
      functionName: 'memo',
      args: [address, innerData, memoId, memoData],
    });

    const txHash = await walletClient.writeContract(request);
    return { txHash, viaMemo: true, memoError: null };
  } catch (err) {
    // Indexação auxiliar não derruba contribuição de usuário.
    const reason = err?.shortMessage || err?.message || String(err);
    console.warn(
      `[memo] caminho do Memo indisponível, caindo para escrita direta: ${reason}`,
    );
    return { txHash: await direct(), viaMemo: false, memoError: reason };
  }
}

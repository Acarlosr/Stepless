/**
 * test/mainnet-hardening.test.js
 *
 * Trava as correções da auditoria de mainnet (docs/analise/auditoria-mainnet-2026-08-06.md).
 * Cada teste existe para que uma regressão QUEBRE o CI, não para que alguém
 * relembre a decisão lendo um comentário.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/**
 * Lê o arquivo SEM comentários.
 *
 * Necessário porque as correções desta auditoria são fortemente comentadas —
 * os comentários citam o código antigo para explicar POR QUE ele saiu. Uma
 * busca ingênua por `exifLat` acharia a explicação e acusaria regressão onde
 * não há. Aqui interessa o que executa, não o que documenta.
 */
function code(p) {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')      // /* ... */
    .replace(/^\s*\/\/.*$/gm, '')          // // linha inteira
    .replace(/^\s*\*.*$/gm, '')            // continuação de bloco
    .replace(/<!--[\s\S]*?-->/g, '');      // <!-- ... -->
}

// ════════════════════════════════════════════════════════════════════════════
//  C1 — separação de chaves
// ════════════════════════════════════════════════════════════════════════════

test('[C1] a chave do verificador não é derivada da chave do relayer', () => {
  const src = code('api/_stepless.js');

  // A derivação era: keccak256(RELAYER_PRIVATE_KEY + '-stepless-verifier-v1').
  // Com ela, quem obtivesse a chave do relayer tinha também a do verificador e
  // fechava sozinho o ciclo registrar → verificar → pagar.
  assert.ok(
    !/-stepless-verifier-v1/.test(src),
    'a derivação determinística do verificador voltou ao código',
  );

  // A função precisa exigir a env explicitamente.
  const fn = src.slice(src.indexOf('export function verifierAccount'));
  assert.ok(
    /VERIFIER_PRIVATE_KEY/.test(fn.slice(0, 400)),
    'verifierAccount() deve usar VERIFIER_PRIVATE_KEY',
  );
  assert.ok(
    !/process\.env\.RELAYER_PRIVATE_KEY/.test(fn.slice(0, 400)),
    'verifierAccount() não pode tocar em RELAYER_PRIVATE_KEY',
  );
});

test('[C1] verifierAccount falha alto quando a env não está setada', async () => {
  const saved = process.env.VERIFIER_PRIVATE_KEY;
  delete process.env.VERIFIER_PRIVATE_KEY;
  const { verifierAccount } = await import('../api/_stepless.js');
  assert.throws(() => verifierAccount(), /VERIFIER_PRIVATE_KEY/);
  if (saved) process.env.VERIFIER_PRIVATE_KEY = saved;
});

// ════════════════════════════════════════════════════════════════════════════
//  C2 — prova de foto no servidor
// ════════════════════════════════════════════════════════════════════════════

test('[C2] o relay não aceita mais EXIF nem dataHash vindos do cliente', () => {
  const src = code('api/relay.js');

  // Antes, estes campos eram desestruturados de submissionData (ou seja, do
  // corpo do POST) e comparados entre si — o servidor conferia dois números
  // que vinham do mesmo lugar.
  for (const field of ['exifLat', 'exifLng', 'exifTimestamp']) {
    assert.ok(
      !new RegExp(`submissionData[^;]*${field}`, 's').test(src),
      `${field} voltou a ser lido de submissionData`,
    );
  }

  // A prova tem que vir do token emitido por /api/upload.
  assert.ok(/photoToken/.test(src), 'o relay deve exigir photoToken');
  assert.ok(/photo\.dataHash/.test(src), 'o dataHash deve vir do registro da foto');
  assert.ok(
    !/dataHash\s*\}\s*=\s*submissionData/.test(src),
    'dataHash não pode vir do cliente',
  );
});

test('[C2] o endpoint de upload extrai o EXIF dos bytes e hasheia a imagem', () => {
  assert.ok(exists('api/upload.js'), 'api/upload.js precisa existir');
  const src = code('api/upload.js');
  assert.ok(/exifr\.parse\(buffer/.test(src), 'o EXIF deve ser lido do buffer da imagem');
  assert.ok(/keccak256\(buffer\)/.test(src), 'o dataHash deve ser o hash dos bytes');
  assert.ok(/pinToIpfs/.test(src), 'a foto precisa ser armazenada para o hash provar algo');
});

test('[C2] o frontend envia a foto em vez de declarar coordenadas', () => {
  const src = code('frontend/dashboard.js');
  assert.ok(/\/api\/upload/.test(src), 'o dashboard deve enviar a foto para /api/upload');
  assert.ok(/photoToken/.test(src), 'o dashboard deve repassar o photoToken');

  // O cliente PODE ler o EXIF para avisar a pessoa na hora ("esta foto não tem
  // GPS") — isso é UX boa. O que ele não pode é MANDAR esses valores como se
  // fossem prova. Então a asserção é sobre o corpo do POST, não sobre o uso da
  // biblioteca.
  const body = src.slice(src.indexOf("fetch('/api/relay'"), src.indexOf("fetch('/api/relay'") + 900);
  for (const field of ['exifLat', 'exifLng', 'exifTimestamp', 'dataHash']) {
    assert.ok(!body.includes(field), `o dashboard ainda envia ${field} para /api/relay`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  C3 — endereços de rede não podem ser chumbados
// ════════════════════════════════════════════════════════════════════════════

test('[C3] USDC e Memo são immutable nos contratos, não constant', () => {
  const rd = code('contracts/src/RewardDistributor.sol');
  const oracle = code('contracts/src/SteplessOracle.sol');
  const x402 = code('contracts/src/X402API.sol');

  assert.ok(/IERC20 public immutable USDC;/.test(rd), 'RewardDistributor.USDC deve ser immutable');
  assert.ok(/IERC20 public immutable USDC;/.test(x402), 'X402API.USDC deve ser immutable');
  assert.ok(/IMemo public immutable memo;/.test(oracle), 'SteplessOracle.memo deve ser immutable');

  // O endereço de testnet não pode reaparecer chumbado em nenhum deles.
  for (const [name, src] of [['RewardDistributor', rd], ['X402API', x402], ['SteplessOracle', oracle]]) {
    assert.ok(
      !/(constant\s+\w+\s*=\s*)?I?ERC20?\(0x3600000000000000000000000000000000000000\)/.test(src),
      `${name} voltou a chumbar o USDC de testnet`,
    );
  }
});

test('[C3] o construtor valida que o USDC tem código e 6 decimais', () => {
  const src = code('contracts/src/RewardDistributor.sol');
  assert.ok(/_usdc\.code\.length == 0/.test(src), 'faltou checar code.length');
  assert.ok(/decimals\(\) returns \(uint8 d\)/.test(src), 'faltou checar decimals()');
});

test('[C3] a rede mainnet falha alto enquanto os endereços não saírem', async () => {
  const cfg = JSON.parse(read('config/networks.json'));
  const mainnet = cfg.networks['arc-mainnet'];
  assert.ok(mainnet, 'arc-mainnet deve existir em config/networks.json');

  // Deixar valores "plausíveis" aqui seria pior que deixar null: o sistema
  // subiria e marcaria recompensas como pagas sem mover nada.
  if (mainnet.chainId === null) {
    assert.equal(mainnet.usdc.erc20Address, null, 'USDC não deve ser chutado antes da Circle publicar');
    assert.equal(mainnet.rpcUrls.length, 0);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  C4 — superfície administrativa
// ════════════════════════════════════════════════════════════════════════════

test('[C4] não existem endpoints HTTP que deployam contratos ou trocam admin', () => {
  for (const f of ['api/deploy-oracle.js', 'api/deploy-distributor.js', 'api/rotate-admin.js']) {
    assert.ok(!exists(f), `${f} deve ter sido removido — deploy não é rota HTTP`);
  }
});

test('[C4] setup, fund e verifiers são somente leitura', () => {
  for (const f of ['api/setup.js', 'api/fund.js', 'api/verifiers.js']) {
    const src = code(f);
    assert.ok(
      !/req\.method === 'POST'\s*&&\s*!?requireAdminSecret/.test(src),
      `${f} ainda tem caminho de mutação por segredo administrativo`,
    );
    assert.ok(
      !/writeContract|sendTransaction/.test(src),
      `${f} não pode escrever on-chain`,
    );
  }
});

test('[C4] o relayer não se auto-autoriza mais', () => {
  const src = code('api/relay.js');
  assert.ok(
    !/functionName: 'setAuthorizedCaller'/.test(src),
    'a auto-autorização voltou — ela só funciona se o relayer for admin',
  );
});

// ════════════════════════════════════════════════════════════════════════════
//  A5 / A6 — proxy RPC e decimais
// ════════════════════════════════════════════════════════════════════════════

test('[A5] o proxy RPC não retransmite transações por padrão', async () => {
  const { validateRpcPayload } = await import('../api/rpc.js');
  assert.equal(
    validateRpcPayload({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0xdead'] }),
    false,
    'eth_sendRawTransaction deve estar fora da allowlist por padrão',
  );
  // Leituras continuam funcionando.
  assert.equal(validateRpcPayload({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ data: '0x' }] }), true);
});

test('[A6] os decimais do USDC nativo são consistentes em todo o projeto', async () => {
  const { chainConfig } = await import('../api/_network.js');
  const cfg = JSON.parse(read('config/networks.json'));

  // Na Arc, o USDC nativo (gas) tem 18 decimais e a interface ERC-20 tem 6.
  // relay.js dizia 6 e _stepless.js dizia 18 para a MESMA rede; o viem usa esse
  // número para formatar saldo e estimar gas.
  assert.equal(chainConfig().nativeCurrency.decimals, 18);
  assert.equal(cfg.networks['arc-testnet'].usdc.erc20Decimals, 6);

  const frontend = read('frontend/network.js');
  assert.ok(/"decimals": 18/.test(frontend), 'frontend/network.js deve usar 18 para o nativo');
});

test('[A6] nenhum arquivo declara sua própria chain com decimals: 6 no nativo', () => {
  const files = [
    'api/relay.js', 'api/_stepless.js',
    'frontend/dashboard.js', 'frontend/dynamic-wallet.js', 'frontend/arc-config.js',
  ];
  for (const f of files) {
    const src = code(f);
    assert.ok(
      !/symbol:\s*['"]USDC['"],\s*decimals:\s*6/.test(src)
      && !/symbol:\s*['"]USDC['"]\s*,\s*decimals:\s*6/.test(src),
      `${f} declara o USDC nativo com 6 decimais`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  A7 — contratos mortos não podem reaparecer
// ════════════════════════════════════════════════════════════════════════════

test('[A7] nenhum endereço de contrato morto aparece no frontend ou no mobile', () => {
  const cfg = JSON.parse(read('config/networks.json'));
  const dead = [];
  const dep = cfg.networks['arc-testnet'].deprecatedContracts || {};
  for (const [version, entry] of Object.entries(dep)) {
    if (version.startsWith('$')) continue;
    for (const [name, addr] of Object.entries(entry)) {
      if (!name.startsWith('$') && typeof addr === 'string') dead.push({ version, name, addr: addr.toLowerCase() });
    }
  }
  assert.ok(dead.length > 0, 'a lista de contratos mortos não deveria estar vazia');

  const targets = [
    'frontend/index.html', 'frontend/buscar.html', 'frontend/dashboard.html',
    'frontend/arc-config.js', 'frontend/dashboard.js',
    'mobile/src/services/contracts.ts', 'mobile/src/config/arc.ts',
  ].filter(exists);

  for (const f of targets) {
    // Ignora linhas de comentário: o index.html cita o v3 ao explicar o
    // incidente, e isso é documentação, não configuração.
    const code = read(f)
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|<!--|\/\*)/.test(l))
      .join('\n')
      .toLowerCase();

    for (const d of dead) {
      assert.ok(
        !code.includes(d.addr),
        `${f} referencia o contrato morto ${d.version}.${d.name} (${d.addr})`,
      );
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  CORS
// ════════════════════════════════════════════════════════════════════════════

test('CORS não usa curinga', async () => {
  const { cors, allowedOrigins } = await import('../api/_stepless.js');
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };

  cors(res, 'POST, OPTIONS', { headers: { origin: 'https://evil.example' } });
  assert.notEqual(headers['Access-Control-Allow-Origin'], '*');
  assert.ok(!allowedOrigins().includes('https://evil.example'));

  cors(res, 'POST, OPTIONS', { headers: { origin: allowedOrigins()[0] } });
  assert.equal(headers['Access-Control-Allow-Origin'], allowedOrigins()[0]);
  assert.equal(headers.Vary, 'Origin');
});

// ════════════════════════════════════════════════════════════════════════════
//  Config de rede
// ════════════════════════════════════════════════════════════════════════════

test('os arquivos de rede gerados estão em sincronia com o JSON', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/gen-network.mjs', '--check'], { cwd: ROOT });
});

test('os endpoints de RPC usam o domínio arc.io atual', () => {
  const cfg = JSON.parse(read('config/networks.json'));
  const urls = cfg.networks['arc-testnet'].rpcUrls;
  assert.ok(urls.length > 0);
  // A documentação da Arc (docs.arc.io/arc/references/connect-to-arc) lista os
  // endpoints em *.arc.io. O código apontava para rpc.testnet.arc.network.
  for (const u of urls) {
    assert.ok(/\.arc\.io/.test(u), `${u} não usa o domínio arc.io`);
  }

  for (const f of ['api/rpc.js', 'api/relay.js', 'api/_stepless.js', 'frontend/dashboard.js']) {
    assert.ok(!/arc\.network/.test(code(f)), `${f} ainda referencia arc.network`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Deriva de ABI
// ════════════════════════════════════════════════════════════════════════════

test('as ABIs do frontend não citam funções que não existem nos contratos', () => {
  // Esta classe de bug é silenciosa: o viem só descobre que a função não existe
  // na hora da transação, em produção. Foi o que aconteceu com a v5 — o
  // frontend continuou listando registerVerifier, autoPromoteVerifier,
  // recoverNativeUSDC e withdrawTreasury depois de elas saírem do contrato.
  // Só as ABIs dos contratos DO PROJETO. ERC20_ABI e MULTICALL3_ABI descrevem
  // contratos de terceiros, cujo código não está neste repositório.
  const full = read('frontend/arc-config.js');
  const start = full.indexOf('const REWARD_DISTRIBUTOR_ABI');
  const end = full.indexOf('const ERC20_ABI');
  assert.ok(start > 0 && end > start, 'não achei o bloco de ABIs do projeto em arc-config.js');
  const abiSrc = full.slice(start, end);

  const solidity = [
    'contracts/src/RewardDistributor.sol',
    'contracts/src/SteplessOracle.sol',
    'contracts/src/X402API.sol',
    'contracts/src/lib/Admin2Step.sol',
  ].map(code).join('\n');

  // Funções públicas/externas declaradas no Solidity...
  const declared = new Set(
    [...solidity.matchAll(/function\s+(\w+)\s*\(/g)].map((m) => m[1]),
  );
  // ...mais os getters automáticos de variáveis e mappings públicos.
  for (const m of solidity.matchAll(/^\s*(?:[\w\[\]().]+\s+)*public\s+(?:constant\s+|immutable\s+)?(\w+)\s*[;=]/gm)) {
    declared.add(m[1]);
  }
  for (const m of solidity.matchAll(/mapping\([^)]*\)\s+public\s+(\w+)/g)) declared.add(m[1]);
  for (const m of solidity.matchAll(/mapping\([^;]*?\)\s+public\s+(\w+)\s*;/gs)) declared.add(m[1]);

  // Nomes usados nos blocos `type: "function"` das ABIs.
  const used = new Set();
  for (const m of abiSrc.matchAll(/type:\s*"function",\s*\n\s*name:\s*"(\w+)"/g)) used.add(m[1]);

  const missing = [...used].filter((n) => !declared.has(n));
  assert.deepEqual(
    missing, [],
    `a ABI do frontend cita funções inexistentes nos contratos: ${missing.join(', ')}`,
  );
});

# Auditoria de prontidão para mainnet — Stepless

**Data:** 2026-08-06
**Alvo:** Arc mainnet público, **16 de setembro de 2026** (41 dias)
**Escopo:** `contracts/src/*.sol`, `api/*.js`, `frontend/*`, `mobile/src/*`, CI, deploy
**Commit analisado:** `b01d1b5e` — *fix: align all contract references to the live v4 pair*

---

## Veredito

**O dApp NÃO está pronto para mainnet e não deve ser deployado com dinheiro real no estado atual.**

Não por falta de qualidade — o código é cuidadoso, os comentários explicam decisões
de verdade, e a camada anti-fraude mostra que alguém pensou no problema. O bloqueio é
outro: **o modelo de confiança do sistema inteiro depende de uma única variável de
ambiente na Vercel**, e a camada anti-fraude valida dados que o próprio atacante envia.

Em testnet isso custa USDC de faucet. Em mainnet custa a tesouraria e a reputação do
projeto perante a Circle.

A boa notícia: nenhuma das 4 falhas críticas é estrutural. Todas cabem em 41 dias com
folga, desde que a decisão de arquitetura (multisig) seja tomada agora e não em setembro.

### Placar

| Área | Estado | Bloqueia mainnet? |
|---|---|---|
| Contratos — lógica de negócio | Sólida | Não |
| Contratos — controle de acesso | **Chave única com poder total** | **Sim** |
| Contratos — portabilidade mainnet | USDC/Memo chumbados em testnet | **Sim** |
| API — anti-fraude | **Validação de dado auto-declarado** | **Sim** |
| API — superfície administrativa | Deploy remoto por HTTP | **Sim** |
| Frontend / mobile | Endereços divergentes, tudo em testnet | Sim (menor) |
| CI / testes | `npm run check` quebrado hoje | Sim (menor) |

---

## Parte 1 — Falhas críticas

### C1 — Uma única chave privada controla a tesouraria inteira

**Onde:** `api/_stepless.js:56-62`, `api/setup.js`, `contracts/src/RewardDistributor.sol:233`

Hoje `RELAYER_PRIVATE_KEY` é, simultaneamente:

- **authorizedCaller** do `SteplessOracle` e do `RewardDistributor` — pode
  `registerLocation`, `submitContribution`, `payReward` e `batchPayRewards`;
- **semente do verificador** — quando `VERIFIER_PRIVATE_KEY` não está setada,
  `verifierAccount()` deriva a chave do verificador por
  `keccak256(RELAYER_PRIVATE_KEY + '-stepless-verifier-v1')`;
- provavelmente **admin** também: `api/setup.js` (POST), `api/verifiers.js` e
  `api/rotate-admin.js` só funcionam se `relayer == admin`, e `relay.js` se
  auto-autoriza chamando `setAuthorizedCaller` — o que exige admin.
  *Não consegui confirmar on-chain nesta sessão (sem acesso ao RPC da Arc a partir
  do sandbox). Rodar `node scripts/check-live-contracts.mjs` para confirmar.*

A segunda linha é a mais grave e independe da terceira. A separação
relayer/verificador existe justamente porque o contrato proíbe auto-verificação —
mas se as duas chaves saem da mesma semente, **quem tem uma tem as duas**. A
separação vira decorativa.

**Consequência — mesmo se o relayer NÃO for admin**, quem obtiver essa env var
executa o ciclo completo sozinho: registrar local falso → `submitContribution` →
verificar com a chave derivada → `payReward` para a própria carteira, em loop, até
esvaziar a tesouraria. E o pior: no explorer isso é **indistinguível de uso normal**.
Não há alerta possível baseado em padrão de transação.

**Se o relayer também for admin** (o que os endpoints acima pressupõem), o ataque
nem precisa de loop:

1. `withdrawTreasury(saldo, própriaCarteira)` — saque direto, instantâneo; ou
2. `recoverNativeUSDC(própriaCarteira)` — que apesar do nome transfere o **saldo ERC-20
   inteiro** (`RewardDistributor.sol:641-657`), não apenas "poeira nativa"; ou
3. `retryReward(id, própriaCarteira, qualquerValor)` em loop — não há registro de
   quais recompensas de fato falharam, então o admin pode reenviar valor arbitrário
   quantas vezes quiser (`RewardDistributor.sol:659-682`).

**Agravante histórico:** o cabeçalho de `api/rotate-admin.js` documenta que a chave
atual "vazou no histórico do git", e o README registra que os contratos v1 ficaram
órfãos por um incidente de rotação de chave. Isso já aconteceu duas vezes neste projeto.

**Correção (decidida: multisig):**

- Admin dos 3 contratos = **Safe multisig 2-de-3** em endereço novo, gerado offline.
- Relayer = EOA separado, **apenas** `authorizedCaller` — sem `admin`, sem poder de saque.
- Verificador = EOA separado com chave própria. Tornar `VERIFIER_PRIVATE_KEY`
  **obrigatória**; remover a derivação determinística de `_stepless.js` (não é um
  fallback conveniente, é um bypass).
- Remover `withdrawTreasury` e `recoverNativeUSDC` do caminho quente: mover para
  trás de um **timelock de 48h** (ver C4).
- Substituir `retryReward` por uma versão que só paga o valor exato registrado num
  mapping `failedRewards[contributionId]`, preenchido pelo `_safeTransfer` quando
  a transferência falha, e zerado ao ter sucesso.

---

### C2 — O anti-fraude valida dados fornecidos pelo próprio atacante

**Onde:** `api/relay.js:341-372`, `frontend/dashboard.js:996-1040`

O fluxo real é:

```
navegador  →  lê EXIF da foto localmente (exifr)
           →  POST /api/relay { exifLat, exifLng, exifTimestamp, latPacked, ... }
servidor   →  compara exifLat/exifLng com latPacked/lngPacked
```

**A foto nunca chega ao servidor.** O servidor compara dois números que vieram do
mesmo POST. Um `curl` com `exifLat` igual ao `latPacked` passa em 100% das checagens
de EXIF — sem foto nenhuma, sem GPS nenhum, sem estar no local.

Toda a lógica de `validateExif()`, incluindo a distinção cuidadosa entre severidades
`missing` / `stale` / `mismatch`, é sofisticada e **inofensiva para quem envia JSON
direto**. A severidade `mismatch` — a única que bloqueia incondicionalmente — nunca
dispara para um atacante, porque ele simplesmente não cria um mismatch.

Sintoma relacionado: `frontend/ipfs-upload.js` existe mas **não é importado em lugar
nenhum**. Nenhuma foto é armazenada. O `dataHash` gravado on-chain é calculado pelo
cliente e não corresponde a nenhum arquivo recuperável. A afirmação do site sobre
"foto com hash imutável on-chain" não se sustenta hoje.

**Correção:** a prova precisa sair do controle do cliente.

1. A foto passa a ser **enviada ao servidor** (multipart ou URL pré-assinada).
2. O servidor extrai o EXIF **server-side** (`exifr` roda igual em Node) — o cliente
   nunca declara coordenadas.
3. O servidor calcula `dataHash = keccak256(bytes da foto)` e **guarda a foto**
   (Pinata/IPFS ou S3 + hash). Sem isso o hash on-chain não prova nada.
4. Manter a checagem de distância, agora sobre dados que o servidor mediu.

**Se não houver tempo até 16/09:** lançar com o loop de recompensa **desligado**
(tesouraria em zero, `paused = true`) e ligar só quando a prova for server-side.
Um mapa sem recompensa é honesto; uma recompensa sem prova é uma torneira aberta.

---

### C3 — Endereços de testnet chumbados como `constant` nos contratos

**Onde:** `RewardDistributor.sol:128-129`, `X402API.sol:61`, `SteplessOracle.sol:110`

```solidity
IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);
IMemo  public constant memo = IMemo(0x5294E9927c3306DcBaDb03fe70b92e01cCede505);
```

Esses são endereços da **Arc Testnet**. A Circle ainda não publicou os endereços
definitivos de mainnet — o anúncio de 05/08 confirma a data mas diz explicitamente que
"final contract addresses will be confirmed at mainnet".

Sendo `constant`, não há como corrigir depois do deploy: se o endereço de mainnet for
diferente, `payReward` chama um endereço sem código. `_safeTransfer` usa `.call`
de baixo nível, que **retorna `success = true` ao chamar um endereço vazio**. O
contrato marcaria a recompensa como paga e emitiria `RewardPaid` sem nunca mover um
centavo. A checagem de saldo posterior pegaria isso e emitiria `RewardFailed` — mas
o `rewardClaimed` já estaria gravado, tornando o pagamento irrecuperável pelo caminho
normal.

**Correção:**

- Trocar `constant` por `immutable` recebido no construtor, nos três contratos.
- Adicionar no construtor: `require(address(_usdc).code.length > 0)` e conferir
  `_usdc.decimals() == 6`.
- Para o Memo: se o predeploy não existir em mainnet, o `try/catch` já degrada
  corretamente (emite `MemoAttachFailed`) — mas isso precisa ser **confirmado**, não
  assumido, antes de anunciar indexação por Goldsky.
- Bloquear o deploy atrás de um script que lê os endereços de um arquivo de rede
  (`deploy/arc-mainnet.json`) e falha se estiver vazio.

---

### C4 — Endpoints HTTP que deployam contratos e transferem admin

**Onde:** `api/deploy-oracle.js`, `api/deploy-distributor.js`, `api/rotate-admin.js`,
`api/setup.js`, `api/fund.js`

Em produção existem hoje endpoints públicos que, com um único header
`X-Admin-Secret` correto:

- deployam contratos novos na rede (`POST /api/deploy-oracle`);
- transferem o admin dos dois contratos para um endereço arbitrário
  (`POST /api/rotate-admin { action: 'promote', newAdmin }`);
- movem até 1000 USDC do relayer (`POST /api/fund`);
- reescrevem todo o wiring de autorização (`POST /api/setup`).

Isso reduz a segurança do protocolo à **entropia de uma string** guardada numa env var,
com CORS `Access-Control-Allow-Origin: *` (`_stepless.js:218`) e sem rate limit em
`setup`, `fund` e `rotate-admin`. O `requireAdminSecret` usa `timingSafeEqual`
corretamente — mas comparar em tempo constante um segredo que dá poder de deploy não
muda o fato de que ele não deveria existir.

Além disso, `relay.js:285-302` faz **auto-autorização**: se o relayer não está
autorizado, ele chama `setAuthorizedCaller` em si mesmo. Isso só funciona porque o
relayer é admin — exatamente o acoplamento que C1 precisa quebrar.

**Correção:**

- **Deletar** `deploy-oracle.js` e `deploy-distributor.js` do repositório. Deploy é
  operação de terminal com Foundry, assinada por hardware wallet, não rota HTTP.
- **Deletar** `rotate-admin.js`. Com multisig, rotação é proposta no Safe.
- `setup.js` e `fund.js`: reduzir a **somente leitura** (`GET`). O `POST` vira script
  local em `scripts/`, rodado por quem tem a chave.
- Remover o bloco de auto-autorização de `relay.js`. Se o relayer não está autorizado,
  falhar alto — é sinal de configuração errada, não algo a corrigir sozinho em produção.
- CORS: trocar `*` por allowlist explícita (`https://www.stepless.lat`).

---

## Parte 2 — Falhas altas

### A1 — `recoverNativeUSDC` drena a tesouraria inteira
`RewardDistributor.sol:641-657`. O nome e o comentário prometem recuperar poeira nativa;
o código faz `USDC.balanceOf(address(this))` e transfere **tudo**. É funcionalmente um
`withdrawTreasury` sem limite e sem evento próprio (não emite `TreasuryWithdrawn`,
então o saque **não aparece** para quem monitora eventos). Corrigir para receber
`amount` explícito e emitir evento.

### A2 — `retryReward` sem registro de falha
`RewardDistributor.sol:659-682`. Aceita `amount` arbitrário e não verifica se houve
falha real. A checagem `if (!rewardClaimed[id]) revert RewardAlreadyClaimed(id)` ainda
usa um erro de nome invertido em relação ao que testa. Precisa do mapping
`failedRewards` descrito em C1.

### A3 — `_safeTransfer` marca como pago o que não foi pago
`RewardDistributor.sol:549-587`. Quando a transferência falha, o `rewardClaimed` já
está `true` e a função **retorna sem reverter**. O contribuidor perde a recompensa e
só recupera por intervenção manual do admin. Em testnet é um incômodo; em mainnet é
uma reclamação de usuário sem caminho automático de resolução. Registrar em
`failedRewards` e expor um `claimFailed()` que o próprio contribuidor possa chamar.

### A4 — `verifyContribution` não checa quem verifica de verdade
`SteplessOracle.sol:244`. O modificador é `onlyAuthorized` (lista do Oracle), e a
checagem real de verificador acontece indiretamente, dentro de
`recordVerification(id, msg.sender, contributor)` no distributor. Como o relayer também
é `authorizedCaller` no distributor, ele pode chamar `recordVerification` **direto**,
pulando o Oracle. Adicionar `onlyVerifier` explícito e restringir
`recordVerification` a `msg.sender == address(oracle)`.

### A5 — Proxy RPC aberto ao mundo
`api/rpc.js`. Allowlist de métodos e limites de tamanho estão bem feitos, mas o
endpoint aceita `eth_sendRawTransaction` de qualquer origem com 120 req/min por IP.
Vira um relay de transações de terceiros pago pela cota do provedor. Em mainnet, com
um nó dedicado pago, isso é custo direto. Restringir por `Origin` e considerar remover
`eth_sendRawTransaction` (o app não precisa dele — quem escreve é o relayer).

### A6 — `nativeCurrency.decimals` inconsistente entre módulos
`api/relay.js:69` (bloco `arcTestnet`) diz `decimals: 6`; `api/_stepless.js:22` diz `18`;
`frontend/dashboard.js:473` diz `6`. Em Arc o USDC nativo tem **18** decimais. O viem
usa esse valor para formatar saldo e estimar gas — os três precisam dizer 18, ou saldos
de gas aparecem 10¹² vezes maiores.

### A7 — Site público exibe contratos mortos
`frontend/index.html:509,513` mostra `0x53ba90e1…` e `0xdf8fa455…` — o par **v3**, que
o próprio README marca como "do not use". `frontend/arc-config.js` já aponta para o v4.
O commit `b01d1b5e` alinhou as referências mas passou por essa seção. Qualquer avaliador
da Circle que abrir o site e clicar no endereço vê um contrato sem atividade recente.

---

## Parte 3 — Falhas médias

| # | Item | Onde |
|---|---|---|
| M1 | `autoPromoteVerifier` é público; 20 contribuições pagas promovem qualquer endereço a verificador. Com C2 aberto, é sybil barato. | `RewardDistributor.sol:426` |
| M2 | `slashVerifier` é a **única** forma de remover verificador, e zera `totalEarned`. Não existe desligamento neutro. Adicionar `setVerifier(addr,false)`. | `RewardDistributor.sol:437` |
| M3 | `transferAdmin` em uma fase nos 3 contratos. Um endereço digitado errado perde o contrato para sempre — foi exatamente o que aconteceu com o v1. Usar `pendingAdmin` + `acceptAdmin`. | os 3 contratos |
| M4 | `payReward` não confere se `contributor` bate com o contribuidor gravado no Oracle. Chamador autorizado pode pagar qualquer endereço. | `RewardDistributor.sol:295` |
| M5 | `batchPayRewards` sem limite de tamanho do array — risco de exceder o gas do bloco e reverter o lote inteiro. Limitar a ~50. | `RewardDistributor.sol:347` |
| M6 | X402API: `plan.queryLimit` é armazenado e **nunca verificado**; `feeVerificationStatus` nunca é cobrado; assinantes ainda pagam por consulta. Funcionalidade morta que o pitch descreve como viva. | `X402API.sol:83,199` |
| M7 | `npm run check` **falha hoje** (`Embedded RewardDistributor bytecode is stale`). O CI está vermelho no `main`. | `scripts/sync-distributor-bytecode.mjs` |
| M8 | Nenhum teste Foundry cobre `withdrawTreasury`, `recoverNativeUSDC`, `retryReward`, `fundTreasury` nem `X402API`. Zero testes de invariante. | `contracts/test/` |
| M9 | Sem `nonReentrant` em nenhuma função. Hoje o padrão checks-effects-interactions salva, mas com USDC ERC-20 na Arc (comportamento não padrão documentado no próprio contrato) é margem fina demais para mainnet. | todos |
| M10 | Subgraph Goldsky nunca foi deployado; o dashboard depende de varredura de eventos por RPC, frágil e limitada em janela de blocos. | `subgraph/` |
| M11 | Fallback em memória do `store` (`_stepless.js:153`) — sem Upstash configurado, pendências somem quando a lambda esfria. Contribuição registrada on-chain fica sem metadados para o verificador. Tornar Upstash obrigatório em produção. | `api/_stepless.js` |
| M12 | Sem monitoramento: nenhum alerta para `RewardFailed`, saldo da tesouraria baixo, ou saque. | — |

---

## Parte 4 — Migração testnet → mainnet

Inventário do que está chumbado. **Nada disso pode ser um "find & replace" às pressas
no dia 15.**

| Item | Valor atual (testnet) | Arquivos |
|---|---|---|
| Chain ID | `5042002` | `api/relay.js`, `api/_stepless.js`, `frontend/arc-config.js`, `frontend/buscar.html`, `frontend/dashboard.js`, `frontend/dynamic-wallet.js`, `frontend/index.html` (×3 i18n), `mobile/src/config/arc.ts` |
| RPC | `rpc.testnet.arc.network` | mesmos + `api/rpc.js` |
| Explorer | `testnet.arcscan.app` | mesmos + `frontend/como-sacar-recompensas.html` |
| USDC ERC-20 | `0x3600…0000` | `RewardDistributor.sol`, `X402API.sol`, `api/fund.js`, `frontend/arc-config.js`, `mobile/` |
| Memo | `0x5294E992…` | `SteplessOracle.sol`, `frontend/arc-config.js`, `mobile/` |
| Endereços dos contratos | v4 testnet | `frontend/arc-config.js`, `frontend/index.html` (v3 desatualizado!), `mobile/src/services/contracts.ts`, envs Vercel |
| `evm_version` | `osaka` | `foundry.toml` (×2) — confirmar que mainnet usa o mesmo baseline |
| Textos de UI | "Arc Testnet" em pt/en/es | `frontend/index.html`, `frontend/dashboard.html` |

**Recomendação:** centralizar tudo num único `config/networks.json` lido por build,
com `NETWORK=arc-mainnet|arc-testnet`. Enquanto os valores estiverem espalhados por 12
arquivos, a próxima divergência é questão de tempo — e já aconteceu (v3/v4, entre
31/07 e 05/08).

---

## Parte 5 — Plano até 16 de setembro

41 dias. O caminho crítico é **auditoria externa**, que precisa de contrato congelado.

### Semana 1 — 6 a 13 de agosto · Decisões e destravamento

- [ ] Criar o **Safe multisig 2-de-3** em endereço novo, chaves geradas offline. Nada
      depende de código; é o item que trava tudo o mais, então é o primeiro.
- [ ] Gerar 3 chaves separadas: admin (→ Safe), relayer, verificador. Nenhuma derivada
      de outra.
- [ ] Rodar `gitleaks`/`trufflehog` no histórico completo. Se qualquer chave real
      aparecer, considerá-la queimada permanentemente.
- [ ] Consertar o CI (`npm run sync:bytecode`) — sem CI verde não há como validar o resto.
- [ ] Corrigir `frontend/index.html` para o par v4 (A7) e `nativeCurrency.decimals` (A6).
      São 20 minutos e removem duas contradições visíveis.
- [ ] Confirmar com a Circle/docs os endereços de USDC e Memo em mainnet.

### Semana 2 — 14 a 21 de agosto · Contratos v5

- [ ] `SteplessOracle`: Memo `immutable`; `onlyVerifier` em `verifyContribution`;
      admin em duas fases.
- [ ] `RewardDistributor`: USDC `immutable` + validação no construtor; mapping
      `failedRewards`; `retryReward` sem valor arbitrário; `claimFailed()` público;
      `recoverNativeUSDC` com valor explícito e evento; `setVerifier(addr,bool)`;
      limite em `batchPayRewards`; `payReward` conferindo o contribuidor do Oracle;
      `nonReentrant`; admin em duas fases.
- [ ] `X402API`: USDC `immutable`; enforcement real de `queryLimit` **ou** remoção do
      recurso do contrato e do pitch.
- [ ] Timelock de 48h para `withdrawTreasury`, `recoverNativeUSDC` e `setRewardAmount`.
- [ ] Cobertura Foundry ≥ 90% nas funções que movem dinheiro + invariante:
      *soma de `totalEarned` ≤ total já fundeado*.

### Semana 3 — 22 a 29 de agosto · Backend e prova real

- [ ] Upload de foto server-side; EXIF extraído no servidor; `dataHash` = hash dos bytes.
- [ ] Armazenamento real das fotos (Pinata) — ligar `ipfs-upload.js` ou substituí-lo.
- [ ] Remover `deploy-oracle.js`, `deploy-distributor.js`, `rotate-admin.js`.
- [ ] `setup.js` e `fund.js` → somente `GET`; `POST` migra para `scripts/`.
- [ ] Remover auto-autorização de `relay.js`; remover derivação do verificador.
- [ ] CORS por allowlist; `Origin` obrigatório no proxy RPC.
- [ ] Upstash obrigatório (falhar no boot se ausente).
- [ ] **Congelar os contratos** e enviar para auditoria externa. *Esta é a data-limite
      real do projeto.*

### Semana 4 — 30 de agosto a 6 de setembro · Ensaio geral

- [ ] Deploy v5 na testnet com a **topologia exata** de mainnet (Safe como admin,
      3 chaves separadas, timelock ativo).
- [ ] Deploy do subgraph Goldsky.
- [ ] Migrar frontend e mobile para `config/networks.json`.
- [ ] Alertas: `RewardFailed`, tesouraria < limiar, qualquer chamada de saque.
- [ ] Ensaio de incidente: pausar, sacar via Safe, despausar. Cronometrado.
- [ ] Corrigir o que a auditoria apontar.

### Semana 5 — 7 a 15 de setembro · Congelamento

- [ ] Freeze de código em **11/09**. Só correção de bug crítico depois disso.
- [ ] Deploy em mainnet com **tesouraria em zero** e `paused = true`.
- [ ] Verificar os 3 contratos no explorer de mainnet.
- [ ] Fundear com valor pequeno (ex.: 50 USDC). Rodar o loop completo com contas reais.
- [ ] Despausar. Aumentar a tesouraria de forma gradual.
- [ ] Atualizar README, site e pitch para mainnet — e remover as afirmações que o
      código ainda não sustenta.

### 16 de setembro — Lançamento

Fundear em degraus (50 → 200 → 1000 USDC), com um dia de observação entre cada um.

---

## O que faria eu recuar da data

Três condições. Se qualquer uma valer em 11/09, **adie o lançamento com dinheiro real**
e lance no dia 16 em modo somente-leitura (mapa público, recompensas desligadas):

1. A auditoria externa não terminou, ou apontou algo crítico ainda aberto.
2. A prova de foto ainda depende de dados enviados pelo cliente (C2).
3. O admin ainda é um EOA, ou alguma chave ainda deriva de outra (C1).

Um mapa de acessibilidade útil e honesto no dia 16 é um lançamento bom. Uma tesouraria
drenada na primeira semana de mainnet, numa rede em que a Circle está observando quem
constrói, é um custo que não se recupera com um patch.

---

## Adendo — Estado das correções (2026-08-06, mesma data)

As correções abaixo foram implementadas depois da auditoria, na mesma sessão.
**Nada disto substitui a auditoria externa** — o objetivo era chegar em 29/08
com um código congelável, não declarar o problema resolvido.

### Feito

| # | Correção | Onde |
|---|---|---|
| C1 | Derivação da chave do verificador a partir da do relayer **removida**; `VERIFIER_PRIVATE_KEY` agora é obrigatória | `api/_stepless.js` |
| C1 | `verifyContribution` exige estar no conjunto `verifiers`, não só ser authorizedCaller — o relayer sozinho não fecha mais o ciclo | `SteplessOracle.sol` |
| C1 | Deploy script recusa `RELAYER_ADDRESS == ADMIN_ADDRESS` e entrega o admin ao multisig | `DeployStepless.s.sol` |
| C2 | Foto enviada ao servidor; EXIF extraído dos bytes; `dataHash = keccak256(foto)`; imagem armazenada no IPFS; token de uso único | `api/upload.js`, `api/relay.js` |
| C3 | USDC e Memo viraram `immutable`, com validação de código e de `decimals() == 6` no construtor | os 3 contratos |
| C3 | `arc-mainnet` com campos `null` e falha alta ao subir | `config/networks.json`, `api/_network.js` |
| C4 | `deploy-oracle`, `deploy-distributor` e `rotate-admin` **deletados**; `setup`, `fund` e `verifiers` viraram somente-leitura | `api/` |
| C4 | Auto-autorização do relayer removida | `api/relay.js` |
| A1 | `recoverNativeUSDC` **removida** (era um segundo caminho de saque total, sem evento) | `RewardDistributor.sol` |
| A1 | Saque agora tem timelock de 48h (`requestWithdrawal` → `executeWithdrawal`) | `RewardDistributor.sol` |
| A2 | `retryReward(id)` sem valor nem destinatário livres; lê de `failedRewards[]` e é permissionless | `RewardDistributor.sol` |
| A3 | Falha de transferência registrada em `failedRewards[]` em vez de evaporar | `RewardDistributor.sol` |
| A4 | `recordVerification` só aceita chamada do Oracle | `RewardDistributor.sol` |
| A5 | `eth_sendRawTransaction` fora da allowlist; proxy RPC exige Origin conhecida | `api/rpc.js` |
| A6 | Decimais do nativo unificados em 18, vindos de uma fonte só | `config/networks.json` |
| A7 | Endereços v3 removidos do site — inclusive de `buscar.html`, que **lia do Oracle morto** | `frontend/` |
| M1 | `autoPromoteVerifier` removida | `RewardDistributor.sol` |
| M2 | `setVerifier(addr, bool)` — remoção neutra, sem zerar ganhos | `RewardDistributor.sol` |
| M3 | Admin em duas fases nos 3 contratos | `lib/Admin2Step.sol` |
| M4 | `payReward` confere o contribuidor registrado no Oracle | `RewardDistributor.sol` |
| M5 | `MAX_BATCH_SIZE = 50` | `RewardDistributor.sol` |
| M6 | `queryLimit` enforçado; `queryVerificationStatus()` criada; assinatura em segundos | `X402API.sol` |
| M7 | CI consertado e ampliado (gitleaks, coverage, warnings como erro) | `.github/workflows/ci.yml` |
| M8 | 36 testes JS + suíte Foundry com `MockUSDC` que reproduz blocklist e falha silenciosa | `test/`, `contracts/test/` |
| M9 | `nonReentrant` nas funções que movem dinheiro | `lib/ReentrancyGuard.sol` |

### Achado novo, encontrado durante a correção

**A8 — `frontend/buscar.html` lia do Oracle v3 (morto).** A página pública de
busca tinha `ORACLE_ADDRESS = '0x53ba90e1…'` chumbado. Ela *parecia* funcionar,
porque o v3 ainda tem 34 locais on-chain — mas nenhum local registrado desde
31/07/2026 jamais apareceu na busca. É o modo de falha mais caro que existe:
silencioso e com aparência de sucesso.

**A9 — ABI do frontend descrevia funções inexistentes.** `arc-config.js` listava
`registerVerifier`, `autoPromoteVerifier`, `recoverNativeUSDC` e
`withdrawTreasury` com assinaturas que não batiam com o contrato, além de
`subscriptionExpiry` e `planPrice`, que nunca existiram. O viem só descobre isso
na hora da transação. Agora um teste do CI compara as ABIs com o Solidity.

**A10 — o domínio de RPC mudou.** Todo o código apontava para
`rpc.testnet.arc.network`; a documentação da Arc lista os endpoints em
`*.arc.io`. Atualizado em `config/networks.json`.

### Revisão da correção de C2 — o que ela de fato garante

Depois de implementar, testei o ataque contra o código novo. **C2 foi mitigado, não
eliminado.** A distinção importa e não deve ser suavizada em nenhum material do
projeto.

**O que mudou de verdade:**

| Ataque | Antes | Agora |
|---|---|---|
| `curl` com números inventados no JSON | passa | **bloqueado** (exige arquivo de imagem) |
| PNG/lixo disfarçado de JPEG | passa | **bloqueado** (magic bytes) |
| Imagem 64×64 só para carregar EXIF | passa | **bloqueado** (mínimo 320px) |
| Mesma foto em N locais diferentes | passa | **bloqueado** (hash registrado para sempre) |
| Mesma foto por carteiras diferentes | passa | **bloqueado** |
| Foto real + EXIF reescrito com `exiftool` | passa | **passa** |

**O último caso é irredutível com metadado.** EXIF é um campo gravável: um comando
de `exiftool` escreve qualquer coordenada em qualquer arquivo. A suíte de testes
contém uma prova disso — `test/fixtures/com-gps.jpg` é um retângulo cinza gerado
por script, com EXIF de iPhone inteiramente inventado, e o teste
`DOCUMENTADO: EXIF bem forjado passa` afirma que ele é aceito. Se um dia esse teste
falhar, é porque alguém adicionou uma verificação mais forte — e aí é boa notícia.

O que sobra contra esse caso é o que já existia: o cross-check com o OpenStreetMap,
a reputação por carteira, a quota diária e **o verificador humano**, que agora
consegue abrir a foto (antes só via um hash sem arquivo).

**Consequência prática para o texto do produto:** o site não deve dizer que a foto
"prova" que a pessoa esteve no local. O que o sistema garante é mais modesto e
ainda assim útil: existe um arquivo, ele está armazenado, o hash dele está on-chain,
ele não foi usado antes, e um humano olhou. Prometer mais do que isso é o mesmo tipo
de inflação que a auditoria de julho já apontou.

**Se quiser prova real de presença**, as opções são: attestation de integridade do
dispositivo (Play Integrity / App Attest) no app nativo, ou captura dentro do próprio
app com a localização lida do SO no momento do disparo — nenhuma das duas cabe até
16/09, e nenhuma delas funciona na web.

#### O que seria essa attestation, em detalhe

EXIF é metadado que o próprio arquivo carrega — qualquer editor reescreve. Play
Integrity (Android) e App Attest (iOS) fazem o oposto: em vez de confiar em algo
que o arquivo diz sobre si mesmo, pedem para o sistema operacional atestar, na
hora, algo que o app não consegue forjar sozinho.

Fluxo: o app nativo (não o navegador) pede ao SO um "attestation" — um pacote
assinado criptograficamente pela Apple/Google — provando que aquela chamada
específica veio de um app genuíno, instalado pela loja oficial, rodando num
dispositivo real (sem root/emulador), naquele exato momento. A chave de
assinatura é da Apple/Google; não é algo que dá para fabricar em script, ao
contrário do EXIF (que forjei em Python com `piexif` para os testes desta
auditoria).

Combinado com "tirar a foto dentro do próprio app" (em vez de escolher da
galeria), dá para amarrar GPS do sistema + timestamp do SO + hash da imagem
num pacote assinado pelo dispositivo no instante da captura. Isso substitui
"o arquivo diz que tem GPS" por "o sistema operacional confirma que este
dispositivo, com este app, tirou esta foto agora, nesta coordenada."

Por que não cabe até 16/09: exige integração própria em cada plataforma
(Play Integrity API no Android, DeviceCheck/App Attest no iOS), um endpoint
de verificação no backend que valida a assinatura com Google/Apple, e troca
de "upload de arquivo" por "captura de câmera nativa dentro do app" — é
reescrever a feature do zero em duas plataformas, sem contar QA. Semanas,
não dias — e o app mobile já tem outra pendência maior aberta (ABI
desatualizada, ver abaixo).

Por que não existe versão web: essas APIs são amarradas ao app nativo
instalado pela loja — não há "attestation de site" com a mesma garantia. Um
usuário acessando pelo navegador (celular ou desktop) ficaria sem essa
proteção de qualquer forma, então isso resolveria só a fatia mobile-nativa
do tráfego, nunca o site inteiro.

### Bugs encontrados na própria correção

**B1 — o EXIF nunca era lido (grave, achado em teste).** A primeira versão de
`extractExif` usava `exifr.parse(buffer, { gps: true, pick: ['latitude', ...] })`.
`latitude`/`longitude` **não são tags do arquivo** — o exifr as calcula a partir do
bloco GPS. O `pick` filtrava as duas, então *toda* foto era lida como "sem GPS". Com
`EXIF_REQUIRED=true` (o padrão), isso rejeitaria **100% das submissões legítimas**,
em silêncio, com uma mensagem culpando o usuário. Corrigido com `exifr.gps()` em
chamada separada, e travado por teste de regressão.

**B2 — o fluxo quebraria sem Upstash.** O token é criado em `/api/upload` e lido em
`/api/relay` — duas requisições, quase sempre em instâncias serverless diferentes. O
fallback em memória vive dentro de uma instância só. Sem Upstash, nenhuma submissão
completaria. Os dois endpoints agora recusam a subir sem armazenamento persistente,
em vez de falharem de forma intermitente.

### O que continua aberto

- **Auditoria externa** — não começou. É o caminho crítico.
- **Multisig** — os contratos suportam, mas o Safe ainda não foi criado.
- **Endereços de mainnet** — dependem da Circle publicar.
- **`forge test` não foi executado.** Os contratos, os testes e o script de
  deploy compilam com solc 0.8.24 sem erros nem warnings, mas o ambiente desta
  sessão não tinha Foundry. **Rodar `forge test` e `forge coverage` localmente
  antes de qualquer deploy.**
- **ABIs do app mobile** — `mobile/src/services/contracts.ts` descreve uma
  interface antiga (IDs `uint256` em vez de `bytes32`, `registerLocation` sem o
  parâmetro `contributor`). Os endereços foram centralizados, mas as ABIs
  precisam ser regeradas a partir dos contratos v5.
- **Subgraph Goldsky** — segue sem deploy.
- **Monitoramento** — sem alertas para `RewardFailed`, tesouraria baixa ou saque.

---

## Anexo — Referências

- Circle, *Arc mainnet — 16 de setembro*: <https://www.circle.com/pressroom/circle-announces-founding-validator-cohort-and-major-integrations-for-arc-ahead-of-september-16-mainnet-launch>
- Auditoria de produto/UX anterior: `docs/analise/auditoria-360-stepless.md` (2026-07-24)
- Checklist de segurança existente: `docs/security_audit_checklist.md`

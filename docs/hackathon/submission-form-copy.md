# Texto pronto para o formulário — Checkpoint 3

Tudo em inglês (o formulário e os juízes são). Copie e cole campo a campo.

---

## 1. Project Description

O texto atual está bom mas fecha com "Track: DeFi", vende só metade do
projeto e não menciona nada que seja específico da Arc além de gas em USDC.
Substituição sugerida (cabe no campo):

```
Stepless turns accessibility mapping into paid work. Contributors — many of
them disabled themselves — photograph ramps, elevators and accessible
restrooms; verifiers confirm them on-chain; USDC lands in the contributor's
wallet in seconds. The resulting dataset becomes an accessibility oracle that
routing apps, municipalities and delivery platforms query and pay for per call
via x402.

Built on Arc because the economics only close here: a 0.05 USDC reward is
coherent only when gas is also USDC, and the payment has to settle while the
contributor is still standing in front of the ramp. Registrations are submitted
through Arc's Memo predeploy via the callFrom precompile, attaching structured
metadata (packed lat/lng + photo hash) natively to the transaction with a
sequential index.

Live on Arc Testnet: SteplessOracle, RewardDistributor and X402API, a funded
USDC treasury paying out, a web app and an Android build.
```

---

## 2. Submission Details (Required)

```
WHAT WE BUILT

Stepless is accessibility infrastructure on Arc. People with disabilities map
ramps, elevators and accessible locations and earn micro-USDC for it; the
dataset becomes an oracle that third parties pay to query. Both halves are
live on Arc Testnet.

The contributor loop: a contributor photographs a location in the web app or
Android build. The server extracts EXIF GPS from the image BYTES — the client
never declares coordinates or hashes, so the anti-fraud is not decorative for
anyone using curl. A serverless relayer validates the photo's GPS against the
declared location, runs a place-existence check against OpenStreetMap and a
contributor reputation score, then submits the registration on-chain, paying
gas in USDC. A verifier confirms the contribution on-chain, and
RewardDistributor releases USDC from treasury to the contributor.

The demand loop: X402API meters third-party reads of the oracle over HTTP 402,
settled in USDC per query. This is the part that makes contributor rewards
funded revenue instead of a subsidy with an end date.

WHAT IS DEPLOYED (Arc Testnet, chain 5042002)

  SteplessOracle      0x69b3F9cAcA6514F76Dd2F0DC4B54409E6d5Da5cC
  RewardDistributor   0xef5D148B126d8dcdc7d344DfA367C61aCBb02ea0
  X402API             0x0D318864C80eCe8d28800a750bdA06b6E52ffCc9

The RewardDistributor holds a funded USDC treasury and has been paying out.

HOW WE USE THE ARC STACK

- USDC-denominated gas. The relayer pays gas in USDC and there is no second
  token anywhere in the system. A contributor never has to acquire anything in
  order to get paid — which, for this user base specifically, is the difference
  between a product and a demo.

- Sub-second settlement. The full loop from photo to USDC received runs in
  about 30 seconds, most of which is the human verifier. On a chain with slower
  finality this is a promise of payment; here it is the payment.

- Memo predeploy (0x5294E9927c3306DcBaDb03fe70b92e01cCede505). The relayer, an
  EOA, calls Memo with the oracle as target; the callFrom precompile preserves
  msg.sender so the oracle's authorization still holds, and a Memo event with a
  sequential index is emitted carrying packed lat/lng plus the photo hash.
  Metadata is attached to the transaction natively rather than reconstructed by
  an off-chain indexer we would have to trust.

- x402 for metered, per-query USDC settlement of oracle reads.

ONE THING WE FIXED DURING THIS CHECKPOINT, WORTH REPORTING

Our original design had the oracle contract call Memo internally. Every
registerLocation and submitContribution since 31 July carried a reverted
internal transaction — swallowed by a try/catch, so transactions still
succeeded and nothing looked wrong. Two independent causes: our IMemo declared
attachMemo(bytes32,bytes), a function that does not exist on Memo; and Memo is
EOA-only by construction, because callFrom requires the sender to be the caller
or tx.origin, so a contract calling Memo reverts regardless of signature. We
inverted the call direction into the relayer. No redeploy was needed. We are
reporting this rather than quietly fixing it because the EOA-only constraint is
easy to miss and other teams will hit it.

WHAT IS NOT DONE, STATED PLAINLY

Mainnet. Arc mainnet launches 16 September and Circle has not published mainnet
USDC and Memo addresses yet. The arc-mainnet entry in config/networks.json
carries null fields on purpose and the backend refuses to boot against it. On
Arc, a call to an address with no code returns success — a guessed address
would have the contract mark rewards as paid without moving a cent. We would
rather not ship than ship that.

WHY THIS MATTERS

1.3 billion people live with a significant disability. The accessibility data
they need does not exist, and it does not exist because collecting it has
always been unpaid labour asked of people who already have less time and less
money than average. Accessibility shouldn't depend on goodwill. It should pay
the people who build it.
```

---

## 3. Link to Code (Required)

```
https://github.com/Acarlosr/Stepless
```

⚠️ **Confirme o nome exato do repositório e que ele está público.** Um repo
privado aqui invalida a submissão — é item obrigatório do edital.

---

## 4. Link to Demo Video (Required)

Suba no YouTube como **"Unlisted"** (não "Private" — juiz não consegue abrir
private). Roteiro em `video-script.md`.

---

## 5. Link to Presentation (Required)

O campo pede **link**, não arquivo. Duas opções rápidas:

- **Google Slides:** Drive → Novo → Upload do `.pptx` → abrir com Google Slides
  → Compartilhar → "Qualquer pessoa com o link" → Leitor.
- **PDF no Drive:** upload de `Stepless-Build-on-Arc.pdf`, mesma configuração de
  compartilhamento. Mais fiel ao design original — o Slides reflui algumas
  caixas de texto.

Recomendo o PDF, pelo motivo acima. Depois de configurar, **abra o link numa
janela anônima** para confirmar que abre sem login.

---

## 6. Live Demo Link (Required)

```
https://stepless.vercel.app
```

---

## 7. Tell us about your team (não obrigatório, mas conta para o acelerador)

Não está marcado como Required, mas é a única pergunta do formulário que é
explicitamente sobre a vaga no acelerador. Um vídeo de 60–90 segundos, celular,
sem edição. Três coisas, nessa ordem:

1. Quem você é e o que você construiu antes (30s).
2. Por que acessibilidade e não outro problema — o motivo pessoal, se houver.
   Isso é o que faz um comitê lembrar de você (30s).
3. O que você quer do acelerador. Seja específico: *acesso ao lado da demanda —
   uma plataforma de mobilidade ou uma prefeitura disposta a ser o primeiro
   cliente pagante do oráculo.* Pedir "mentoria" é o que todo mundo escreve e
   não diz nada (30s).

---

## 8. Which track(s) — leia antes de marcar

**Recomendação: marque apenas DeFi Track.**

O encaixe em DeFi é direto e forte: tesouro em USDC com liberação condicional
on-chain, liquidação multi-etapa (register → verify → distribute), receita
medida via x402, gestão de tesouraria do relayer com recuperação de falhas.

O encaixe em Agentic Economy é mais fraco do que eu sugeri no deck, e eu errei
ao empurrar as duas trilhas lá. O edital dessa trilha pede **agentes de IA
autônomos** com lógica de decisão, e cita o **Agent Stack** como produto
central. O relayer do Stepless é uma função serverless com regras — validação
de EXIF, checagem de lugar, score de reputação. É automação sólida, mas não é
um agente de IA, e o projeto não usa o Agent Stack. O consumidor "agente" do
oráculo via x402 é hoje um caso de uso descrito, não algo implementado e
demonstrável.

Marcar as duas trilhas com esse material tem um custo real: um juiz da Circle
conhece o Agent Stack e vai perceber que ele não está lá. Isso contamina a
credibilidade da submissão inteira — inclusive da parte de DeFi, que é boa.
Uma submissão focada e honesta ganha de uma que parece estar inflando escopo.

**Se você quiser mesmo as duas trilhas**, o caminho legítimo nas horas que
restam é implementar um consumidor agente de verdade: um script que consulta o
oráculo, recebe o 402, paga em USDC autonomamente e usa o dado para tomar uma
decisão de rota. É viável — mas só faz sentido se sobrar tempo depois do vídeo,
que vale muito mais.

Nesse caso, o parágrafo a acrescentar no Submission Details seria:

```
AGENTIC ECONOMY: we ship an autonomous consumer agent that queries the
accessibility oracle, receives HTTP 402, settles the fee in USDC from its own
wallet without human approval, and uses the returned data to select a
wheelchair-accessible route. Agent-to-agent payment for a data service, priced
per call, with the payer holding its own funds.
```

Só cole isso se o agente existir e aparecer no vídeo.

---

## Ordem para as próximas horas

1. Deploy do fix do Memo + um registro de teste (confirme `"memo": {"attached": true}`)
2. Gravar e subir o vídeo de demo — **é a peça de maior peso e a que falta**
3. Subir o deck no Drive e testar o link em janela anônima
4. Confirmar que o repositório está público
5. Preencher e submeter, com folga
6. Se sobrar tempo: verificar os contratos no ArcScan e gravar o vídeo do time

# Stepless — Tesouraria sem depender de patrocinador

Data: 2026-10-24 · Escopo: contratos v5, docs/analise, README, docs.arc.io, programa de grants da Circle.

## 1. Diagnóstico (o que li no projeto)

- O Stepless já está tecnicamente pronto para a mainnet em quase tudo: v5 com USDC `immutable`, admin em duas fases, timelock de 48h no saque, `retryReward` permissionless, prova de foto no servidor, anti-fraude em camadas, quota de 10 envios/dia por carteira.
- O que trava o deploy **não é código, é a premissa de que a tesouraria precisa nascer grande e patrocinada**. Essa premissa não aparece em nenhum contrato — é decisão de lançamento.
- O README e o `config/networks.json` estão **desatualizados**: dizem que a Circle não publicou os endereços da mainnet. Hoje a docs.arc.io publica (ver seção 5). Esse bloqueio saiu.
- A tese "x402 financia as recompensas" é correta no longo prazo, mas hoje é irreal como fonte inicial: a $0,001 por consulta, **cobrir 1 local (~$0,17) exige ~170 consultas**. Sem clientes pagantes, receita ≈ 0. Os números da candidatura de grant ($5 mil/mês de receita) são projeção, não base de caixa.

## 2. Quanto a tesouraria realmente precisa

Ciclo completo por local (valores atuais do contrato): NewLocation $0,10 + Verification $0,05 + QualityPhoto $0,02 = **$0,17**. Gás na Arc é meta de ~$0,001 por transferência, irrelevante perto disso.

| Meta | Custo de recompensa |
|---|---|
| 100 locais (meta da Fase 2 do README) | **$17** |
| 500 locais | $85 |
| 1.000 locais | $170 |
| 5.000 locais | $850 |

Ou seja: **$200 mapeiam ~1.100 locais; $1.000 mapeiam ~5.900.** A auditoria de mainnet já previa degraus de 50 → 200 → 1.000 USDC. Você não precisa de patrocinador para começar; precisa de um teto de risco.

Risco de dreno: 10 envios/dia × $0,17 = $1,70/dia por carteira. O limite é por carteira, então N carteiras sybil = N × $1,70. **Falta um teto global.** Esse é o item de segurança mais importante da tesouraria hoje, com ou sem patrocinador.

## 3. Alternativas, em ordem de recomendação

### A. Desacoplar o deploy do patrocínio (recomendado, faz agora)
Subir a mainnet com tesouraria pequena **autofinanciada** ($50–200) e um **teto diário on-chain**. O pior caso passa a ser "perder o teto do dia", não "perder a tesouraria".
- Adicionar em `RewardDistributor`: `maxPayoutPerDay` (janela de 24h por `block.timestamp`, ajustável pelo admin com limite máximo constante, mesmo padrão do `MAX_REWARD_AMOUNT`).
- **Modo fila (acúmulo):** quando o teto do dia ou o saldo acabam, `payReward` hoje reverte com `InsufficientTreasury`. Trocar por registrar em `failedRewards[]` (a estrutura e o `retryReward` permissionless já existem) e emitir `RewardQueued`. O contribuinte vê "pendente — aguardando fundos" e recebe quando alguém fundear. Mudança pequena, reaproveita código já auditado internamente.
- Efeito: a mainnet pode abrir **com tesouraria zero** e o mapa já funciona; o dinheiro entra depois, sem redeploy.

### B. Patrocínio por resultado (campanhas com escrow)
Mudar a pergunta ao patrocinador de "doe" para "pague só pelo que for verificado":
- Contrato novo e separado, `CampaignEscrow.sol` (não mexe no núcleo): patrocinador deposita USDC com meta (ex.: "200 locais na região X, $0,25 cada"), prazo e destino; só libera por contribuição **verificada** e atribuída à campanha; saldo não usado é **reembolsável** após o prazo.
- A atribuição à zona é off-chain (o Oracle só guarda `locationHash`), então um papel `campaignAttester` separado do relayer e do verificador faz `assign(contributionId, campaignId)`.
- Quem pode pagar ticket pequeno: associações de pessoas com deficiência, lojas/shoppings da região, prefeituras e secretarias, turismo, ONGs, empresas com meta de acessibilidade. O ticket de R$ 500 já paga ~$85 → 500 locais. Pitch honesto: "sem risco de desvio, devolvo o que não for entregue".
- Já existe o "Financie Rampas Reais" para doações pequenas; campanhas por zona com barra de progresso dão motivo para o patrocinador voltar.

### C. Quem se beneficia paga a verificação (demanda local)
Comerciante/estabelecimento paga uma taxa pequena (ex.: $2–5) para ter o local **verificado in loco** e ganhar selo "Verificado Stepless". A taxa cobre a recompensa de ~$0,17 com folga e o contribuinte da região recebe o bounty. Gera caixa sem esperar clientes de API. **Hipótese não validada** — testar com 5–10 estabelecimentos antes de construir.

### D. Pontos/IOU atrelados à receita futura
Contribuições geram pontos on-chain; quando houver receita x402 ou campanha, um percentual é distribuído por pontos. Útil como complemento ao modo fila, mas **não prometa retorno financeiro** e não chame de token. Receita x402 relevante é cenário de 2027+, não de 2026.

### E. Rendimento sobre a tesouraria — não agora
USYC (mainnet `0x8a5D…F490`, com Entitlements e Teller) e o Earn Kit (Morpho) existem na Arc, mas: USYC exige elegibilidade (na testnet, allowlist via Circle Support) e o Earn Kit adiciona risco de contrato. Matemática: $1.000 a 4% a.a. rende $40/ano; para render $1.000/ano seriam ~$25 mil de principal. Hipotético e irrelevante nesse tamanho. Reavaliar acima de ~$50 mil.

### F. Grants (manter em paralelo, não como pré-requisito)
Circle Developer Grants: pagamento em USDC **por marcos**, inscrição pelo portal (circle.questbook.app), avaliação por alinhamento com a Arc, produtos Circle, tração e histórico de entrega; áreas de interesse citadas: economia agêntica, câmbio com stablecoins, P2P, gestão de tesouraria, mercados de previsão, crédito. Acessibilidade não aparece na lista. Sugestão: reenquadrar como "tesouraria programável com liberação condicionada a verificação on-chain + dados consumidos por agentes via x402" e pedir **uma primeira parcela pequena atrelada a marcos concretos** ("primeiros 500 locais verificados na mainnet"). Valores e prazos não constam nas páginas; confirmar com o programa.

## 4. Plano sugerido (ordem)

1. Atualizar `config/networks.json` com a mainnet (seção 5) e rodar `npm run gen:network`; conferir `cast code` do USDC na mainnet antes de qualquer deploy.
2. Implementar `maxPayoutPerDay` + modo fila em `RewardDistributor` e os testes Foundry correspondentes (teto atingido, fila, retry após fundeio, teto não ultrapassável por sybil).
3. Deploy mainnet: admin = multisig (nunca EOA), relayer e verificador em chaves separadas, tesouraria **$50**, `maxPayoutPerDay` ≈ $10, rodar o loop completo com contas reais, depois 200 → 1.000 em degraus como a auditoria previa.
4. Publicar "Financie Rampas Reais" na mainnet e abrir 2–3 campanhas piloto (B) com associações/lojas de São Paulo.
5. Testar a hipótese C com poucos estabelecimentos.
6. Reenviar/atualizar o grant por marcos (F).

## 5. Dados da Arc mainnet (docs.arc.io, consultado em 2026-10-24)

| Item | Valor |
|---|---|
| Chain ID | 5042 |
| RPC | https://rpc.mainnet.arc.io (também Blockdaemon, dRPC, QuickNode, Alchemy) |
| Explorer | https://explorer.arc.io |
| USDC (ERC-20, 6 dec) | 0x3600000000000000000000000000000000000000 |
| Memo | 0x5294E9927c3306DcBaDb03fe70b92e01cCede505 |
| Multicall3 | 0xcA11bde05977b3631167028862bE2a173976CA11 |
| Gás | USDC nativo (18 dec), piso de 20 Gwei de `maxFeePerGas`; sem faucet na mainnet |

Observação: a docs consultada não menciona paymaster/Gas Station; o relayer continua pagando o gás em USDC. Os endereços são os mesmos da testnet, então confirme o código no endereço (`cast code`) na mainnet — o construtor já recusa endereço sem código.

## 6. Pendências antes de dinheiro real (do que o repositório mostra)

- Não encontrei evidência de auditoria externa concluída (checklist ainda com `[ ]`); com tesouraria de $50 e teto diário o dano máximo fica limitado, mas o admin precisa ser multisig.
- Há alterações não commitadas em `api/*` (git status); commitar e rodar CI (`check-live-contracts`) antes do deploy.
- `README.md` e `config/networks.json` precisam sair do estado "mainnet pendente".

## 7. Decisão de 2026-10-24: lançar sem patrocínio + apoio com marca

Implementado no repositório (nada deployado):

| Item | Onde |
|---|---|
| Teto diário `maxPayoutPerDay` (padrão $10, máx. $10.000, só o admin altera) | `RewardDistributor.sol` |
| Fila: sem saldo ou acima do teto, `payReward`/`batchPayRewards` enfileiram (`RewardQueued`) em vez de reverter; `retryReward` (permissionless) paga depois e respeita o teto | `RewardDistributor.sol` |
| `sponsorTreasury(amount, brandRef)`: aporte associado a uma marca; emite `TreasuryFunded` (mural atual continua valendo) e `TreasurySponsored` | `RewardDistributor.sol` |
| `/api/sponsor`: interesse da marca (pendente) → aprovação manual com segredo admin → aparece no mural; e-mail nunca é público; só https; sem HTML | `api/sponsor.js`, `frontend/index.html` |
| `verify.js` não diz "pago" quando a recompensa foi enfileirada (`queued: true`) | `api/verify.js` |
| Mainnet (chain 5042, RPCs, explorer, USDC, Memo, Multicall) no `networks.json` | `config/networks.json` |

Verificação feita: os contratos e os testes Foundry **compilam** (solc 0.8.24); `npm test` (50 testes Node) e `npm run check` passam. **Os testes Foundry não foram executados** — não há `forge` instalado no ambiente. Rode `cd contracts && forge test -vv` antes de qualquer deploy. O teste antigo `test_PayReward_RevertsOnInsufficientTreasury` foi trocado por `test_PayReward_QueuesWhenTreasuryIsEmpty`, porque o comportamento mudou de propósito.

### Política de anúncio de marcas (iFood, 99Food etc.)
- Só exibir nome/logo de empresa **com autorização escrita dela** (e-mail basta). Não use marca de terceiros como "exemplo" no site.
- Apoio não compra influência: a marca não escolhe quem é verificado nem o valor das recompensas. Diga isso na proposta.
- Sugestão de faixas (texto a validar com você): Apoiador (≥ $20, nome no mural), Destaque (≥ $100, logo + link), Campanha de zona (≥ $250, depende do contrato de campanhas da seção 3-B, ainda não implementado).
- Aporte e exibição são separados: o USDC entra por `sponsorTreasury`; a aprovação do mural é manual e pode ser recusada (reembolso fora do contrato, por decisão sua).
- Abordagem prática: e-mail curto para marketing/ESG/responsabilidade social com o painel público da tesouraria, o custo por local ($0,17) e a proposta "seu aporte vira N rampas mapeadas, auditável no explorer".

### Roteiro de lançamento (resumo)
1. `forge test -vv` verde → commitar (há alterações antigas não commitadas em `api/*` e outras).
2. Admin = multisig; relayer, verificador e deployer em chaves diferentes.
3. Deploy em mainnet com tesouraria $0 e `paused = true`; verificar no explorer; `setMaxPayoutPerDay` conforme o saldo.
4. Fundear $50, despausar, rodar o loop completo com contas reais; subir 50 → 200 → 1.000 só se o painel estiver limpo.

## 8. Ajuste de 2026-10-24 (tarde): sem pagamento até existir patrocínio

Pedido: não pagar por registro agora e não criar dívida. Mudanças (substituem a "fila" da seção 7):

- `rewardsEnabled` (padrão **false**): com recompensas desligadas, `payReward`/`batchPayRewards` revertem com `RewardsDisabled` e o `verify.js` nem chama o pagamento. Registrar e verificar continuam funcionando — o mapa cresce sem dinheiro.
- Com recompensas ligadas, sem saldo ou acima do teto: **não paga e não deve** (`RewardNotFunded`); a contribuição não é marcada como paga e pode ser paga depois se você quiser. A fila de dívida foi removida.
- Teto diário padrão reduzido para **$1/dia** (≈ 10 locais novos); o admin ajusta com `setMaxPayoutPerDay`.
- `/api/fund` informa `rewardsEnabled`; o site avisa que o mapeamento é voluntário nesta fase.

Custo real para operar sem recompensas: só o gás do relayer, pago em USDC (meta da Arc ≈ $0,001 por transação; cada local usa ~2–3 transações). Com **$1–2 de USDC** no relayer dá para algumas centenas de registros — valide o custo real no explorer após o primeiro registro. O deploy dos contratos também consome gás (estimativa, não medido: alguns centavos a poucos dólares).

Quando entrar patrocínio: `sponsorTreasury` → `setRewardsEnabled(true)` → `setMaxPayoutPerDay` no tamanho do aporte.

## 9. Revisão de UX, robô e IA (2026-10-24, noite)

### Pagamento por cadastro — removido de todo lugar visível
- Site: tabela de recompensas, card "Recompensas em USDC", passo "Receber USDC", "Mapeie e receba em USDC", "ganhe USDC", link "Como sacar" — substituídos por **"Por que mapear"** (voluntário, sem pagamento, recompensas só com apoiadores, sem promessa de valor/data).
- `como-sacar-recompensas.html` virou "Recompensas estão pausadas" (fica no ar porque o APK antigo aponta para lá).
- Dashboard: cards "Total ganho" e "Seu saldo USDC" e o histórico de recompensas ficam ocultos; o formulário diz "É gratuito: a taxa da rede é paga pelo Stepless"; a mensagem pós-cadastro agradece em vez de prometer pagamento.
- App Android: aba "Recompensas" oculta; textos de login, sobre, sucesso e o banner pós-cadastro sem USDC. **Precisa de um APK novo** para chegar aos usuários (não há atualização OTA).

### O robô que sobe a escada
Trocado. O robô em cadeira de rodas virava drone para *voar por cima* da escada e tinha "USDC" no peito. Dois problemas: a mensagem era o contrário do produto (o Stepless tira a barreira, não ensina a pular) e representava a pessoa com deficiência como robô. A nova cena é a escada ganhando uma **rampa** e uma **pessoa** (pictograma) subindo sozinha até o pin de "local verificado". Respeita "reduzir movimento" (mostra o quadro final, sem animação).

### Outros ajustes de UX
- "Conectar Wallet" → **"Entrar"**; nav sem jargão (Buscar · Como funciona · Por que mapear · Apoiar · Próximos passos · Mapear um local).
- Seção técnica (endereços, Solidity, viem) recolhida em **"Para desenvolvedores"**.
- Roadmap sem datas vencidas: Concluído → Agora (mainnet voluntária) → Com apoiadores (recompensas) → Depois (API).
- Busca mostra a descrição da foto gerada pela IA (texto alternativo).

### IA (OpenRouter, modelo gratuito) — onde ela ajuda
1. **Segunda opinião na confirmação do local**: o modelo de visão diz se o recurso declarado (rampa, elevador…) aparece na foto e se é foto de um lugar real. Vira um motivo no painel do revisor (+20 de risco se confiante que não aparece, +15 se não é foto de local). **Nunca aprova, rejeita ou bloqueia sozinha.**
2. **Texto alternativo**: descrição curta da foto, mostrada na busca — útil para quem usa leitor de tela.
- Código: `api/_ai.js`, ligado em `api/relay.js` em paralelo com as transações; testes em `test/ai.test.js`.
- Configuração: `OPENROUTER_API_KEY` na Vercel (ver `.env.example`). Sem chave = desligado, nada quebra.
- Modelo padrão: `nvidia/nemotron-3.5-super-vl:free` (o único gratuito com imagem na lista consultada hoje). Modelos grátis mudam e têm limite de uso — se parar de responder, a IA vira "indisponível" e o fluxo segue; troque `OPENROUTER_MODEL`.
- Privacidade: modelos grátis podem registrar as entradas; a foto já é pública no IPFS e o prompt proíbe descrever rostos e placas.

### Os $5 de taxa
Pela meta da Arc (~$0,001 por transação) e 2–3 transações por local, **$5 no relayer cobrem na ordem de 1.500–2.500 cadastros**. É estimativa: confira o custo real do primeiro cadastro no explorer e acompanhe o saldo em `/api/fund`. O deploy dos contratos sai da carteira de deploy, não do relayer.

### Público ampliado e viagem (2026-10-24)
- Nova seção **"Para quem é o Stepless"** na página inicial: cadeirantes e mobilidade reduzida, pessoas idosas, cegas ou com baixa visão, surdas, mobilidade reduzida temporária (gesso, cirurgia, gravidez, carrinho de bebê) e familiares/cuidadores. Frase do topo agora cita pessoas com deficiência, idosos e viagem.
- Destaque **"Vai viajar?"**: conferir quarto adaptado, banheiro com barras e elevador antes de reservar hotel/pousada.
- Nova categoria **9 — Quarto adaptado (hotel/pousada)** na web (cadastro e busca), no app e na IA. A busca passou a aceitar `?cat=room` (e `?cat=ramp`, `?cat=9`…), o que também consertou os links dos ícones da página inicial, que eram ignorados. A busca ganhou ainda o filtro "Entrada", que faltava.

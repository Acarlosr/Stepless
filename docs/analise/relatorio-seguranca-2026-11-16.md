# Stepless — Relatório de segurança e melhorias (16/11/2026)

Escopo: contratos v5 (`SteplessOracle`, `RewardDistributor`, `X402API`,
`CampaignEscrow`), API na Vercel (`api/*.js`), site (`frontend/`), deploy
(`scripts/deploy-contracts.mjs`, workflow "Deploy contratos") e a configuração
da testnet de 14/11. Revisão feita lendo o código e a saída de `/api/setup` —
**não é uma auditoria externa** e não substitui uma.

---

## 1. Resumo

| Situação | Itens |
|---|---|
| 🔴 Alta — corrigir **antes** da mainnet | 2 |
| 🟠 Média — corrigir antes de campanhas com valor relevante | 5 |
| 🟡 Baixa — melhorar quando der | 4 |
| ✅ Já bem resolvido | 12 |

O núcleo financeiro está sólido: o dinheiro das campanhas só sai para
contribuidor verificado ou de volta ao parceiro, não existe saque do admin, e
os papéis estão separados em chaves diferentes. Os riscos que sobram estão em
**volta** dos contratos: scripts de terceiros no navegador, regras de campanha
mais frouxas que as do registro, e custos que um atacante consegue empurrar
para o Stepless.

---

## 2. Achados

### 🔴 A1 — Biblioteca da carteira carregada sem versão fixa (cadeia de suprimentos)

**Onde:** `frontend/dynamic-wallet.js` importa
`https://esm.sh/@dynamic-labs-sdk/client`, `/evm` e `/client/waas` **sem
número de versão**. Também `exifr@7` (jsdelivr, versão flutuante) e
`viem@2.21.0` via esm.sh (versão fixa, mas o esm.sh recompila as dependências).

**Risco:** a cada visita o navegador baixa a versão que o esm.sh entregar
naquele dia. Uma atualização com bug — ou um pacote comprometido — roda dentro
do site com acesso à **carteira embarcada** (login por e-mail) e às assinaturas
do MetaMask. Na mainnet isso significa poder pedir assinatura de transações com
USDC real. Não há CSP nem SRI que limitem isso.

**Correção:**
1. Fixar versões exatas em todos os imports (`@dynamic-labs-sdk/client@X.Y.Z`).
2. Melhor: **copiar os pacotes para `frontend/vendor/`** (arquivos versionados
   no repositório) e carregar de lá. Atualizar vira uma decisão consciente,
   revisada num PR.
3. Adicionar `integrity` (SRI) onde der (scripts estáticos).

### 🔴 A2 — Campanha paga local enviado sem GPS na foto

**Onde:** `api/_campaign.js` → `attestContribution`. O registro (`relay.js`)
**bloqueia** foto com GPS de outro lugar, mas foto **sem** GPS passa quando
`EXIF_REQUIRED=false`.

> ⚠️ **A confirmar:** o valor atual de `EXIF_REQUIRED` na Vercel não foi
> conferido nesta revisão (a anotação de que estava `false` é de julho). Se
> estiver `true` ou ausente, foto sem GPS já é recusada no registro e este
> achado cai para 🟡 baixa. A correção abaixo vale de qualquer forma, porque
> tira a segurança da campanha de uma variável de ambiente.

**Risco:** para o mapa voluntário isso é aceitável — o revisor humano decide.
Para **campanha paga** vira o principal vetor de fraude: alguém declara
coordenadas dentro da zona sem estar lá, usa uma foto qualquer de rampa sem
GPS, e se o revisor aprovar, recebe USDC do parceiro.

**Correção (pequena):** o atestador só paga se a foto tiver GPS medido no
servidor **e** ele estiver a ≤ 500 m do ponto declarado
(`contrib.photo.hasGps === true` e sem flag de divergência). O local continua
no mapa normalmente; só não recebe da campanha. Mostrar isso no aviso da
campanha ("só fotos com localização ligada recebem").

> Limite que nenhum código resolve: EXIF pode ser forjado com ferramentas.
> GPS exigido aumenta o custo da fraude; o revisor humano e o limite por
> pessoa continuam sendo as defesas principais.

### 🟠 M1 — Spam de campanhas tira as campanhas reais do alcance do atestador

**Onde:** `api/_campaign.js` → `SCAN_LIMIT = 50` (só as 50 campanhas mais
recentes são consideradas) + `CampaignEscrow.MIN_REWARD = $0,01`.

**Risco:** criar 50 campanhas de $0,01 × 1 local custa ~$0,50 + gás. Isso
empurra as campanhas reais para fora da janela, e elas deixam de ser pagas
automaticamente (o parceiro ainda consegue pagar manualmente). Também enche a
lista pública de campanhas com lixo.

**Correção:** no **contrato da mainnet**, exigir depósito mínimo por campanha
(ex.: `MIN_DEPOSIT = $10`); no servidor, indexar as campanhas ativas com regras
publicadas no Upstash (lista completa, não "as últimas 50") e filtrar pela zona
antes de ler a chain.

### 🟠 M2 — Conteúdo das campanhas não tem moderação

**Onde:** qualquer pessoa cria campanha e publica regras com título livre
(texto é limpo de HTML, mas não de ofensas, golpes ou marcas de terceiros).

**Correção:** flag off-chain "oculta" controlada pelo admin (o dinheiro da
campanha continua intocado e o reembolso continua funcionando — só some da
lista e do mapa). Mostrar no site "campanhas são criadas por terceiros".

### 🟠 M3 — Gás do relayer pode ser drenado com contas falsas

**Onde:** `api/relay.js` limita 6 envios/min por IP e 10/dia por carteira.
Carteiras novas são gratuitas (login por e-mail), e IPs se trocam.

**Risco:** cada registro custa 2–3 transações pagas pelo relayer. Na
mainnet, um ataque com muitas contas e IPs esvazia o saldo do relayer e o
mapa para de aceitar registros. Hoje a foto obrigatória, o dedup de foto e o
GPS-vs-declarado deixam isso caro, mas não impossível.

**Correção:** teto **global** diário de registros (env, ex.: 300/dia) com
mensagem clara; alerta quando o saldo do relayer cair abaixo de um mínimo;
manter o relayer sempre com pouco saldo e recarregar aos poucos.

### 🟠 M4 — `/api/pending` expõe dados internos de antifraude

**Onde:** `api/pending.js` devolve, sem autenticação, o registro inteiro de
cada contribuição pendente: coordenadas, carteira, **score de risco**,
motivos, reputação no momento do envio e a avaliação da IA.

**Risco:** quem tenta fraudar vê exatamente quais sinais derrubam o score e
ajusta. Também expõe mais dado pessoal do que o necessário (LGPD).

**Correção:** listar para o público só o mínimo (id, nome, categoria, data);
os detalhes de risco só para quem assina como verificador (mesmo esquema do
`/api/verify`).

> Cuidado na correção: o painel web (`dashboard.js`) **e o app**
> (`mobile/src/services/api.ts`, tela de recompensas) leem este endpoint. A
> resposta pública precisa manter os campos que eles usam, senão o APK v1.2.0
> quebra.

### 🟠 M5 — Foto vai para o IPFS com todos os metadados

**Onde:** `api/upload.js` envia o arquivo original ao Pinata (IPFS). O EXIF
inteiro vai junto: GPS exato, horário, modelo do aparelho e, às vezes, nome do
dono e número de série.

**Risco (LGPD):** IPFS é público e **não dá para apagar**. O GPS do local já é
público por natureza, mas modelo/série/nome do aparelho não precisam ser.

**Correção:** extrair o EXIF no servidor (como já faz), **guardar só o que
precisa** no registro e enviar ao IPFS uma cópia **sem metadados**. Explicar
isso na política de privacidade antes do envio.

### 🟡 B1 — Sem cabeçalhos de segurança no site

`vercel.json` não define `Content-Security-Policy`, `X-Frame-Options`,
`Referrer-Policy` nem `Permissions-Policy`. Uma CSP com a lista exata de
domínios (esm.sh, unpkg, vlibras.gov.br, Dynamic, OpenStreetMap, RPCs, ViaCEP,
Nominatim) reduz o estrago de um script injetado e impede o site de ser
embutido em página falsa (clickjacking) para enganar na hora de assinar.

### 🟡 B2 — VLibras roda com acesso total à página

Script do governo federal (confiável), mas é código de terceiro com acesso ao
DOM, inclusive nas páginas onde a pessoa assina transação. Avaliar não
carregar o VLibras em `admin.html` e `campanhas.html` (formulário de depósito),
ou limitar por CSP.

### 🟡 B3 — `/api/setup` e `/api/fund` sem limite de requisições

São só leitura, mas cada chamada faz ~14 leituras na chain. Muitas chamadas
consomem a cota do RPC dedicado. Aplicar o mesmo `rateLimit` dos outros.

### 🟡 B4 — Aviso enganoso no painel de mapear

Quando algum item do `/api/setup` falha, o painel manda "rodar no terminal
`node scripts/setup-contracts.mjs`", que pede chaves privadas no computador
local — o oposto do fluxo atual. Trocar por "fale com o admin" e mostrar qual
item falhou.

---

## 3. O que já está bem resolvido ✅

1. **Admin em duas fases** (`Admin2Step`) — endereço errado não sequestra o contrato.
2. **Sem saque do admin** no `CampaignEscrow`; reembolso vai sempre ao parceiro; pausa não bloqueia reembolso.
3. **Destino do pagamento fixo** (contribuidor registrado no Oracle), nos dois contratos.
4. **Um pagamento por contribuição**, mesmo entre campanhas; só contribuição verificada **depois** da criação.
5. **Papéis separados**: admin, relayer, verificador do servidor, atestador — todos endereços diferentes (corrigido em 14/11: o verificador era a mesma chave do relayer).
6. **Verificação por assinatura** da carteira do revisor, conferida no contrato. O atalho por segredo vem desligado no código — **confirmar** que `ALLOW_ADMIN_SECRET_VERIFY` não está `true` na Vercel.
7. **Regras de campanha imutáveis** (hash on-chain conferido pelo servidor).
8. **Conferência de saldo real** em toda entrada/saída de USDC (blocklist e falha silenciosa da Arc).
9. **Proxy RPC com lista de métodos permitidos** e sem `eth_sendRawTransaction`.
10. **Prova de foto no servidor** (EXIF lido dos bytes, foto de uso único, carteira dona da foto).
11. **Secret Scan** (gitleaks) e **84 testes de contrato** rodando no CI.
12. **Deploy sem chave no computador local**, com travas (relayer ≠ admin, deployer ≠ admin, confirmação para mainnet) e conferência pós-deploy.

---

## 4. Melhorias de produto (não são falhas)

- **Mural das marcas** que patrocinam campanhas (hoje o parceiro fica invisível).
- **Página para parceiros**: como funciona, garantias, custo por local, exemplo de campanha.
- **Painel do parceiro**: "minhas campanhas", locais pagos, botão de devolver.
- **Notificação** para quem mapeou quando o pagamento cair (e-mail ou no app).
- **Monitoramento**: alerta automático (GitHub Actions agendado) quando `/api/setup` tiver item vermelho ou o saldo de gás do relayer/verificador/atestador estiver baixo.
- **Indexador** (Goldsky ou o próprio Upstash) para histórico de pagamentos sem depender de `getLogs` limitado do RPC.
- **Auditoria de acessibilidade do próprio site** (WCAG 2.2 AA com leitor de tela real), já que é a promessa do produto.
- **Migração dos locais do v4** (testnet) — opcional; a mainnet começa do zero de qualquer forma.

---

## 5. Ordem sugerida

| # | Item | Quando |
|---|---|---|
| 1 | A2 — campanha exige GPS na foto | antes da mainnet |
| 2 | A1 — fixar/hospedar bibliotecas (Dynamic, exifr, viem) | antes da mainnet |
| 3 | M1 — depósito mínimo + índice de campanhas | no contrato da mainnet |
| 4 | M4 — `/api/pending` sem dados de risco | antes da mainnet |
| 5 | M3 — teto global do relayer + alerta de saldo | antes da mainnet |
| 6 | M5 — foto sem metadados no IPFS + texto na privacidade | junto com os termos (LGPD) |
| 7 | B1/B2 — CSP e cabeçalhos | antes da mainnet |
| 8 | M2, B3, B4 | logo depois |

Itens 1, 3 (parte do servidor), 4, 5, 7 e B3/B4 são mudanças pequenas no
código atual. O item 3 (parte do contrato) precisa entrar **antes** do deploy
da mainnet, porque contrato publicado não muda.

---

## 6. Verificação deste relatório (16/11, segunda passada)

Cada achado foi reconferido no código:

| Achado | Conferido em | Resultado |
|---|---|---|
| A1 | `frontend/dynamic-wallet.js` (3 imports sem versão), `dashboard.html:411` (`exifr@7`) | confirmado |
| A2 | `api/relay.js:307-314`, `api/_campaign.js` (não olha a foto) | confirmado no código; **depende do valor de `EXIF_REQUIRED` na Vercel, não conferido** |
| M1 | `SCAN_LIMIT = 50`, `MIN_REWARD = 10_000`, `maxItems ≥ 1` | confirmado |
| M3 | `relay.js`: 6/min por IP + cota por carteira; sem teto global | confirmado |
| M4 | `pending.js` devolve o registro inteiro (`risk`, `ai`, `reputationAtSubmit`) | confirmado |
| M5 | `upload.js:302` envia o `buffer` original ao Pinata | confirmado |
| B1 | `vercel.json` sem bloco `headers` | confirmado |
| B3 | `setup.js` e `fund.js` sem `rateLimit` | confirmado |

**Não coberto por esta revisão** (para não passar a impressão de que foi):
- app Android (armazenamento da chave no aparelho, exportação da chave);
- o serviço Dynamic em si e a configuração do painel dele;
- configuração real da Vercel (variáveis, quem tem acesso à conta) e do GitHub (2FA, quem pode rodar o workflow de deploy);
- comportamento do USDC real da Arc na mainnet (os testes usam um USDC simulado);
- `X402API` em profundidade (não está em uso).

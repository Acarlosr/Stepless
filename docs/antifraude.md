# Anti-fraude do Stepless

## O problema

O dapp paga USDC por ponto de acessibilidade cadastrado. A pergunta que motivou
este documento:

> Se alguém de má-fé tira uma foto da porta da casa do vizinho e informa que é
> uma padaria ou uma farmácia, como saber se de fato é?

A checagem que existia antes era o EXIF: a foto tinha que ter sido tirada perto
da coordenada declarada. Isso prova **presença** — a pessoa esteve ali. Não
prova **identidade** — o que é aquilo. No cenário do vizinho, o EXIF bate
perfeitamente, porque a pessoa realmente estava na porta da casa.

Além disso, a checagem estava furada em três pontos:

1. **O app mobile falsificava a própria prova.** `api.ts` enviava
   `exifLat: input.exifLat ?? lat` — ou seja, quando não havia EXIF, mandava a
   coordenada declarada como prova dela mesma. A distância dava sempre 0m e o
   anti-fraude não existia de fato no mobile.
2. **`allowsEditing: true`** no `launchCameraAsync` acionava o recorte nativo,
   que reescreve o arquivo e apaga o bloco EXIF — inclusive o GPS.
3. **`EXIF_REQUIRED=false` desligava tudo**, inclusive o caso em que a foto TEM
   GPS e ele aponta para outra cidade — que não tem interpretação inocente.

## As camadas hoje

Nenhuma camada sozinha decide. Elas alimentam um score que o verificador humano
lê antes de aprovar o pagamento.

### 1. Prova de captura (`api/relay.js` → `validateExif`)

Separa a gravidade do sinal:

| severidade | o que é | comportamento |
|---|---|---|
| `mismatch` | foto tem GPS e ele aponta para >500m do ponto | **bloqueia sempre** |
| `missing` | foto sem GPS | respeita `EXIF_REQUIRED` |
| `stale` | foto com mais de 7 dias | respeita `EXIF_REQUIRED` |

`missing` e `stale` são sinais fracos de propósito: muita gente usa a câmera com
geolocalização desligada, e punir isso com bloqueio excluiria contribuintes
legítimos.

O mobile agora envia `gpsSource`: `'exif'` (metadados gravados pela câmera do
sistema, fora do alcance do JS do app) ou `'device'` (GPS lido no disparo,
falsificável). Se não tem nenhum dos dois, envia `null` — um null honesto vale
mais que um zero falso.

### 2. Cross-check com o OpenStreetMap (`api/_placecheck.js`)

**Esta é a camada que responde à pergunta original.** Consulta o Overpass API
num raio de 60m e compara com o que a pessoa declarou.

O nome digitado é traduzido para a tag OSM esperada — "Padaria X" → `shop=bakery`,
"Drogaria Y" → `amenity=pharmacy`, e assim por diante (24 tipos, PT/EN/ES).

| verdict | significado | risco |
|---|---|---|
| `type_match` | existe um POI do tipo declarado no raio | 0 |
| `name_match` | o nome bate com um POI existente | 0 |
| `commercial_nearby` | há comércio na área, nada confirma este | 10 |
| `unmapped` | OSM não sabe nada do ponto | 12 |
| `residential_only` | só construções residenciais, zero comércio | 35 |
| `type_mismatch` | tipo declarado + área bem mapeada + nada do tipo | 45 |
| `unknown` | Overpass indisponível | **0** |

`type_mismatch` e `residential_only` são o caso da porta do vizinho.

`unmapped` pesa pouco de propósito: boa parte da periferia e da zona rural
brasileira não está mapeada, e tratar isso como fraude excluiria justamente
quem mais precisa do app.

**Comparação de nomes.** A similaridade ignora conectivos *e substantivos de
tipo*. Sem isso, "Padaria do Zé" e "Padaria da Maria" davam 0,67 de
similaridade — acima do limiar — e a padaria real do outro lado da rua
**confirmaria** a padaria inventada. Removidas as palavras de tipo, a
similaridade cai para 0 e a pergunta certa é feita: não "é uma padaria?" (isso
o `type_match` já responde), mas "é ESTA padaria?".

### 3. Reputação por carteira (`api/_risk.js`)

O contador vive em `stepless:rep:<endereço>`:

- rejeição em `/api/verify` incrementa `rejected`;
- aprovação incrementa `approved`;
- carteira com 2+ rejeições e mais rejeições que aprovações: **+30** de risco;
- carteira com 3+ aprovações e nenhuma rejeição: **−18**.

Antes, rejeitar não tinha custo nenhum e a mesma carteira reaparecia no dia
seguinte com o score de estreante. É o que faz o custo de fraudar crescer a cada
tentativa.

### 4. Quota diária por carteira

O rate limit por IP que já existia trava rajadas, mas trocar de rede o anula.
Como o endereço é onde o USDC cai, `MAX_SUBMISSIONS_PER_DAY` (padrão 10) é o que
de fato limita quanto uma pessoa extrai por dia.

### 5. Score e painel do verificador

`scoreSubmission()` junta tudo num número 0–100 com motivos legíveis, gravados
no registro da contribuição. O painel (`frontend/dashboard.js`) mostra o selo de
risco, os POIs encontrados no OSM, a origem do GPS e o histórico da carteira —
antes o verificador aprovava vendo apenas um hash, um nome e uma coordenada.

O selo usa símbolo + palavra, não só cor: a ferramenta interna de um app de
acessibilidade também precisa ser acessível.

## Compatibilidade com APKs antigos

O `eas.json` não tem canal de update e o projeto não usa `expo-updates` — ou
seja, **não há OTA**. A correção do mobile só chega no usuário com um APK novo,
e os APKs até a 1.1.0 continuam na rua mandando a coordenada declarada como
prova dela mesma.

Eles não quebram (o backend aceita), mas seriam premiados por isso: distância
0m, nenhum sinal ruim, risco baixo. Por isso a origem **não declarada** custa
mais (`GPS_SOURCE_UNKNOWN`, +35) que o GPS do aparelho honestamente declarado
(+12). Sem essa assimetria o incentivo ficaria invertido — valeria a pena não
atualizar o app.

Quando os APKs antigos saírem de circulação, esse peso pode virar bloqueio.

## Variáveis de ambiente

| variável | padrão | efeito |
|---|---|---|
| `EXIF_REQUIRED` | `true` | se `false`, sinais fracos (sem GPS, foto antiga) não bloqueiam. `mismatch` bloqueia de qualquer forma. |
| `MAX_SUBMISSIONS_PER_DAY` | `10` | quota por carteira. `0` desliga. |
| `RISK_BLOCK_THRESHOLD` | `0` (desligado) | score a partir do qual o registro é recusado antes de gastar gas. |
| `OVERPASS_URL` | — | instância Overpass própria, tentada antes dos espelhos públicos. |

## Duas decisões de projeto

**Falha para o lado permissivo.** Overpass fora do ar vira `unknown` com risco
zero. Ninguém é acusado por causa de infraestrutura de terceiros.

**Bloqueio automático desligado por padrão.** O pagamento já depende de
aprovação humana; bloquear na entrada só frustraria quem contribui de boa-fé em
área mal mapeada. Suba `RISK_BLOCK_THRESHOLD` (ex.: 80) quando houver volume
suficiente para calibrar os pesos com dados reais.

## Nota de desempenho

A consulta ao Overpass é **disparada antes** das transações on-chain e
**aguardada depois** — o tempo do serviço público corre em paralelo com o da
blockchain, em vez de somar. `/api/relay` já gasta o orçamento dele com duas
transações e espera de recibo, dentro do `maxDuration` de 30s do `vercel.json`.

A exceção é quando `RISK_BLOCK_THRESHOLD` está ligado: aí o veredito precisa vir
antes de gastar gas, e a espera é sequencial.

## O que ainda falta

Em ordem de retorno sobre esforço:

1. **Confirmação comunitária** — segundo usuário confirma o ponto no local, e
   ambos recebem (quem confirma recebe menos). Fecha o caso em que o OSM não
   ajuda, que é justamente onde o app é mais necessário.
2. **Pagamento em duas parcelas** — 30% na submissão, 70% na validação. Exige
   mudança no `RewardDistributor` e redeploy.
3. **OCR da placa** — comparar o texto da fachada com o nome informado. Sinal
   forte e barato, mas exige guardar a foto (hoje só o hash é persistido).

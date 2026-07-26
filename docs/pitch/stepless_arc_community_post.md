<!-- MARCADORES DE IMAGEM: troque PRINT_x.png pelo caminho/arquivo do seu print.
     No fórum (Markdown), o ![...](arquivo.png) já renderiza a imagem.
     No Discord, apague as linhas ![...]() e anexe a imagem na posição, usando a legenda como texto.
     Ordem de prioridade se for usar menos prints: PRINT_2 (prova on-chain) > PRINT_1 (herói) > PRINT_4 (registro) > PRINT_3 (login). -->

# Stepless — acessibilidade descentralizada, recompensada em USDC na Arc
### Mapeie um lugar acessível, ajude alguém a viajar em paz, e ganhe por isso.

Oi, comunidade. Sou cadeirante e já tinha construído dois dApps aqui na Arc. Mas ficava aquela sensação de que dava pra fazer algo que mexesse com a vida das pessoas, não só com o on-chain. Então construí o **Stepless** — e queria muito mostrar pra vocês.

**TL;DR**
- dApp na **Arc Testnet** onde qualquer pessoa mapeia locais acessíveis (rampas, banheiros, entradas, vagas) e recebe **USDC** por contribuição válida.
- Entra só com **e-mail** — sem seed phrase, sem extensão, sem precisar entender nada de cripto. O relayer paga o gás.
- Já está **no ar e funcionando**: contratos v3 na rede e o ciclo completo validado em produção (registrar → receber 0,10 USDC on-chain).

![Tela principal do Stepless — mapa com locais acessíveis / dashboard](PRINT_1_HERO.png)
<!-- PRINT 1 (herói): dashboard ou mapa com locais registrados. Primeiro impacto visual. -->

## O que é

Quem tem qualquer dificuldade de locomoção conhece a cena: você quer sair, viajar, aproveitar — mas não sabe se vai conseguir entrar no lugar. Tem rampa? O banheiro é adaptado? Essa informação existe, mas está espalhada, desatualizada e presa em plataformas centralizadas. E ninguém tem incentivo pra manter isso vivo.

O Stepless ataca esse problema de um jeito simples: **paga as pessoas, em USDC, pra mapear e verificar locais acessíveis.** Cada contribuição vira um registro on-chain (coordenadas, categoria, foto). Com o tempo, isso forma um mapa aberto que prefeituras, apps de mobilidade e ONGs podem consumir. A recompensa é a ponta visível; por baixo, é um bem público que pode se sustentar por quem usa os dados.

**De onde vem o dinheiro:** as recompensas saem de uma **tesouraria em USDC pré-financiada** no contrato RewardDistributor — não do bolso de novos usuários (nada de ponzinomics). Como é testnet, hoje a tesouraria é abastecida pelo **faucet de USDC da Circle** + fundos meus. A sustentabilidade de longo prazo vem da demanda: **receita da API x402** — quem consome os dados (apps de mobilidade, cidades, empresas) paga, e isso realimenta a tesouraria.

## Para quem é

Pessoas com deficiência, idosos, cuidadores, famílias — e qualquer um que queira mapear a própria cidade e ser recompensado por contribuir.

## O que você pode fazer hoje

- Entrar com e-mail e receber uma carteira automaticamente (sem cripto na mão).
- Registrar um local acessível com GPS e foto.
- Receber **0,10 USDC** por novo local válido, direto na Arc Testnet.
- Acompanhar suas contribuições e o status de verificação no dashboard.
- Explorar os locais já mapeados na busca.

![Prova on-chain — pagamento de 0,10 USDC no histórico + transação no ArcScan](PRINT_2_PROVA_ONCHAIN.png)
<!-- PRINT 2 (o mais importante): histórico de recompensa mostrando 0,10 USDC pago E/OU a tx no ArcScan com o hash. Ofusque endereço/e-mail. -->

## Como usar

1. Acesse **www.stepless.lat**.
2. Clique em "Conectar Wallet" e entre com seu e-mail (código por OTP).

![Login por e-mail (OTP) — sem seed phrase, sem extensão](PRINT_3_LOGIN_EMAIL.png)
<!-- PRINT 3: tela de login por e-mail/OTP. Reforça a UX sem cripto na mão. -->

3. No dashboard, vá em "Mapear Local".
4. Preencha nome e categoria, tire ou envie a foto e confirme as coordenadas.
5. Envie — o relayer registra on-chain e paga o gás por você.
6. A contribuição entra como pendente; depois de verificada, a recompensa em USDC cai na sua carteira.

![Formulário de registro — nome, categoria, foto e GPS](PRINT_4_REGISTRO.png)
<!-- PRINT 4: tela/modal de registro com foto + coordenadas GPS preenchidas. Mostra a captura de GPS que sustenta o antifraude. -->

## Stack técnica

- **Arc Testnet** (L1 stablecoin-native da Circle), Chain ID 5042002
- **USDC** como recompensa (ERC-20, 6 casas); tesouraria abastecida via **Circle faucet**
- Contratos em **Solidity** (SteplessOracle + RewardDistributor), toolchain **Foundry**
- **viem** (TypeScript) no front e no backend/relayer
- Login por e-mail via **Dynamic** (embedded wallet — OTP, sem seed phrase)
- Backend em **funções serverless na Vercel** (o relayer que assina e paga o gás)
- **Upstash Redis** pra metadados fora da chain (nome/categoria do local)
- Fotos em **IPFS/Arweave** (hash ancorado on-chain)
- App mobile em **Expo / React Native** (build via **EAS**) — GPS + câmera, carteira embarcada com **expo-secure-store**
- Explorer: **ArcScan** (testnet.arcscan.app)

## Notas de integração

- **Modelo relayer:** a wallet do usuário nunca assina on-chain — ela só fornece um endereço pra receber USDC. Quem registra e paga o gás é um caller autorizado no backend. Foi essa decisão que permitiu o "entra só com e-mail".
- O endereço do Oracle é **immutable** dentro do RewardDistributor: todo redeploy do Oracle exige redeploy do Distributor (aprendi isso na prática e virou invariante documentada).
- Coordenadas empacotadas com offset `(lat+90)*1e6` / `(lng+180)*1e6` pra caber em uint256 — detalhe que importa porque o Brasil tem coordenadas negativas.
- API de consulta via **x402** (HTTP 402) planejada pra micropagamentos por query.

## Segurança / limites (sendo honesto)

Prefiro ser transparente aqui do que vender perfeição:

- **Antifraude de foto (já implementado):** o backend valida o **GPS embutido na foto (EXIF)** — ela precisa ter sido tirada **no próprio local** (até ~500 m) e ser **recente**. Então pegar a foto de outra pessoa, ou de outro lugar, pra tentar ganhar dinheiro **é bloqueado**. Exemplo real: alguém aqui no Brasil não consegue registrar uma praia acessível de outra cidade com uma foto qualquer da internet.
- **Na testnet essa checagem está permissiva** (aceita qualquer foto) só pra facilitar os testes de vocês. **No lançamento ela vira obrigatória**, junto com verificação em duas etapas, deduplicação geográfica e reputação por endereço.
- Hoje o relayer também é admin dos contratos — é um ponto único de confiança, e eu sei disso. O próximo passo é migrar pra **multisig + timelock**.
- Está em **testnet**: USDC de teste, sem valor real ainda. Auditoria profissional antes de qualquer mainnet.

## Por que eu construí isso

Essa parte é pessoal. Sendo cadeirante, eu queria construir algo que ajudasse quem tem qualquer dificuldade de locomoção a viajar e aproveitar a vida de verdade:

- O **idoso** que trabalhou a vida inteira e, na melhor idade, quer viajar tranquilo sabendo que o lugar é acessível.
- A **pessoa com deficiência** que quer curtir uma praia acessível, um hotel, um restaurante — sem aquela incerteza de não saber se vai conseguir entrar.
- O **cuidador ou a família** que planeja a viagem por alguém e precisa de informação confiável e atualizada.

A Arc entrou aqui não por moda: com as taxas baixíssimas dela, pagar 10 centavos por contribuição faz sentido econômico — coisa que não fecharia em quase nenhuma outra rede. É uma batalha pessoal que virou ferramenta aberta, e é por isso que trago ela pra vocês.

## Onde encontrar

- App: **www.stepless.lat**
- Código: **github.com/Acarlosr/Stepless**
- Rede: **Arc Testnet** (explorer: testnet.arcscan.app)

## Duas perguntas pra comunidade

1. Pra quem já construiu na Arc: qual a melhor forma de **descentralizar o relayer/admin** (multisig + timelock) sem perder a UX de "entrar só com e-mail"?
2. Que defesa **anti-sybil** vocês usariam num sistema que paga USDC por contribuição geolocalizada — proof-of-location, verificação por pares, reputação?

Comentário, crítica, ideia maluca — tudo é bem-vindo. Tô construindo isso no aberto.

## O que mudou (última atualização)

- App mobile **religado ao backend real** (registro via `/api/relay`) e **carteira embarcada** funcional.
- Reforço do desenho **antifraude** (validação de GPS/EXIF da foto) e do plano de descentralização do admin.

## Próximos passos

- Gerar o **APK** (Expo EAS) pra demo e testes com a comunidade.
- Descentralizar o admin (multisig + timelock) e ligar as defesas anti-sybil.
- Publicar a API x402 e buscar o primeiro consumidor dos dados (prefeitura, ONG ou app de rotas).

#Arc #Circle #USDC #Web3 #Acessibilidade #DePIN #BuildOnArc #Stepless

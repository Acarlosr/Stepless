# Stepless — roteiro do vídeo de 3 minutos
**Build on Arc Hackathon · Checkpoint 3**

Limite: 3:00. O roteiro abaixo fecha em **2:52** falado em ritmo normal, deixando folga.
Regra de ouro: **nada de slide durante a demo.** Juiz de hackathon assiste a dezenas
de vídeos; o que separa os que ele lembra é ver a coisa funcionando cedo.

Grave em 1080p, áudio por microfone (não o do notebook), e **abra a aba do
ArcScan antes de começar** — esperar página carregar no vídeo custa credibilidade.

---

## 0:00 – 0:22 · O problema (você na câmera ou voz sobre imagem de rua)

> "Se você usa cadeira de rodas, a pergunta 'esse café tem rampa?' não tem
> resposta confiável em lugar nenhum. Os dados de acessibilidade do mundo são
> voluntários, desatualizados e concentrados em cinco cidades ricas.
>
> Não é falta de tecnologia. É que mapear acessibilidade sempre foi trabalho
> não pago — feito de boa vontade, por quem já tem menos tempo e menos dinheiro
> do que a média.
>
> Stepless paga por esse trabalho. Em USDC. No momento em que ele é feito."

**Tela:** foto de uma rampa / calçada. Sem logo ainda.

---

## 0:22 – 0:35 · O que é, em uma frase

> "Stepless é uma infraestrutura de acessibilidade descentralizada na Arc.
> Pessoas com deficiência mapeiam rampas e locais acessíveis e recebem
> micropagamentos em USDC. O dado vira um oráculo global, que apps de mobilidade
> e prefeituras consomem pagando por consulta via x402."

**Tela:** logo + a arquitetura em uma linha:
`contribuidor → oráculo na Arc → USDC → consumidor paga por x402`

---

## 0:35 – 1:45 · DEMO AO VIVO (o coração do vídeo — 70 segundos)

Grave isto de uma vez só, sem corte, no celular ou no navegador.
Se algo falhar, regrave — **não corte no meio**, corte destrói a prova.

| Tempo | Ação na tela | O que você fala |
|---|---|---|
| 0:35 | Abre stepless.vercel.app no celular, GPS pega a localização | "Estou na frente de um local com rampa. Abro o app." |
| 0:45 | Tira a foto, escolhe categoria "rampa" | "Tiro a foto. O EXIF dela é a prova de que eu estava aqui — o servidor extrai o GPS dos bytes da imagem, o cliente não declara nada." |
| 0:57 | Toca em enviar | "Envio. Eu não tenho token nenhum na carteira. Não preciso: o relayer paga o gas em USDC." |
| 1:05 | Tx confirmada aparece | "Confirmado. **Menos de um segundo.** Isso é a Arc." |
| 1:12 | Verificador aprova (segunda janela / conta de verificador) | "Um verificador confirma on-chain." |
| 1:22 | Saldo USDC do contribuidor sobe | "E o USDC cai na carteira do contribuidor. Eu ainda estou parado na frente da rampa." |
| 1:32 | Abre a tx no ArcScan, aponta para o evento `Memo` | "Aqui na Arc: o registro passou pelo predeploy Memo, com os metadados anexados nativamente à transação e um índice sequencial. Não é log reconstruído depois — é a Arc guardando isso pra gente." |

> **Ponto de ênfase, fale devagar:** "Esse loop inteiro — foto, verificação,
> pagamento — levou menos de trinta segundos. Em qualquer outra rede isso é uma
> promessa de pagamento. Aqui é o pagamento."

---

## 1:45 – 2:15 · O lado que ninguém constrói: quem paga a conta

> "Todo projeto de 'ganhe cripto contribuindo dados' morre no mesmo lugar: o
> tesouro acaba. Então a segunda metade do Stepless é a demanda.
>
> O contrato X402API cobra por consulta ao oráculo, em USDC, via HTTP 402.
> Um app de rotas acessíveis, uma prefeitura auditando obras, uma plataforma de
> delivery — todos consultam pagando por chamada."

**Tela:** terminal com um `curl` real na API → resposta `402 Payment Required` →
pagamento → resposta com os dados. **Mostre o 402 de verdade**, não um slide.

> "Note que dos dois lados dessa transação não tem humano aprovando pagamento:
> o relayer paga o contribuidor automaticamente, contra uma verificação
> on-chain — não uma assinatura, uma condição. É isso que torna o pagamento
> programável, não só uma transferência."

---

## 2:15 – 2:35 · Estado real (honestidade vende — juiz reconhece maquiagem)

> "O que está no ar hoje na Arc Testnet: os três contratos, o app, o relayer, o
> tesouro em USDC pagando de verdade. Endereços no README, todos clicáveis.
>
> O que não está: mainnet. A Arc lança dia 16 de setembro e a Circle ainda não
> publicou os endereços de USDC e Memo. O nosso backend se recusa a subir contra
> mainnet enquanto isso — porque na Arc uma chamada para endereço sem código
> retorna sucesso, e o contrato marcaria recompensas como pagas sem mover um
> centavo. Preferimos não subir a subir com um endereço chutado."

**Tela:** o `config/networks.json` com os campos `null` e o comentário.

---

## 2:35 – 2:52 · Fecho

> "Acessibilidade hoje depende de boa vontade. Deveria pagar quem constrói ela.
>
> A Arc é o que torna isso possível: micropagamento de um centavo de dólar só
> faz sentido quando o gas é a própria stablecoin e a liquidação é instantânea.
>
> Stepless. Obrigado."

**Tela:** logo + stepless.vercel.app + link do repositório.

---

## Checklist antes de gravar

- [ ] Relayer com saldo em USDC (`RewardDistributor` tinha 24.6 USDC em 09/08)
- [ ] Conta de verificador logada numa segunda janela, pronta para aprovar
- [ ] Aba do ArcScan **já aberta e carregada** na tx que você vai mostrar
- [ ] `curl` do x402 testado e funcionando, com o comando já digitado no terminal
- [ ] Um local NOVO escolhido (registrar local já existente reverte com `LocationAlreadyRegistered`)
- [ ] Foto com GPS ligado no celular, senão o anti-fraude bloqueia
- [ ] Áudio testado — 30 segundos de gravação de teste ouvidos com fone

## Erros que matam vídeo de hackathon

1. **Gastar 1 minuto no problema.** Você tem 3 minutos. O juiz já sabe que
   acessibilidade importa. 22 segundos bastam.
2. **Demo em vídeo acelerado ou com corte.** Vira "não funcionava de verdade".
3. **Ler slide.** Se a tela mostra o texto que você está falando, um dos dois
   sobra.
4. **Esconder o que não funciona.** O juiz vai clicar no endereço. Chegar antes
   dele com a limitação é o que faz o resto do vídeo ser acreditado.

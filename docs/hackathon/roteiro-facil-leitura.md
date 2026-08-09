# Roteiro para ler em voz alta — versão fácil

Frases curtas, palavras simples, pausas marcadas com `//`. Leia no seu ritmo,
não corra. Errou uma frase? Pare, respire 2 segundos, repita só a frase —
depois corta no iMovie.

Dividido nas 4 partes da gravação, exatamente como no passo a passo.

---

## PARTE 1 — Abertura (slide do deck: título) · ~35 segundos

> Se você usa cadeira de rodas, // uma pergunta simples não tem resposta em
> lugar nenhum: // "esse lugar tem rampa?"
>
> Não é falta de tecnologia. // É que mapear acessibilidade sempre foi
> trabalho não pago. // Feito de boa vontade, // por quem já tem menos tempo
> e menos dinheiro que a média.
>
> O Stepless paga por esse trabalho. // Em USDC. // No momento em que ele
> acontece.
>
> [Troque de slide: arquitetura em uma linha]
>
> O Stepless é infraestrutura de pagamento programável na Arc. // Um
> contribuidor mapeia um local acessível // e recebe USDC automaticamente, //
> assim que uma verificação confirma o registro on-chain.

---

## PARTE 2 — Demo ao vivo (tela do app) · ~70 segundos

Fale enquanto faz cada ação. Não precisa decorar — é natural, tipo explicando
pra um amigo o que você está fazendo na tela.

> Estou na frente de um local acessível. // Vou abrir o app.
>
> [abre o app, GPS pega a localização]
>
> Tiro a foto do local.
>
> [tira a foto]
>
> O GPS dessa foto é a prova de que eu estou aqui. // O servidor lê isso
> direto dos dados da imagem — // eu não preciso digitar coordenada
> nenhuma.
>
> Agora envio.
>
> [clica em enviar]
>
> Eu não tenho nenhum token na minha carteira. // Não preciso: // quem paga o
> gas dessa transação é o relayer, // e ele paga em USDC.
>
> [transação confirma]
>
> Confirmado. // Menos de um segundo. // Isso é a Arc.
>
> Agora um verificador aprova.
>
> [troca pra aba do verificador, aprova]
>
> Pronto, aprovado on-chain.
>
> [volta pra carteira do contribuidor, mostra saldo subindo]
>
> E o USDC já caiu na carteira do contribuidor. // Eu ainda estou parado na
> frente do local.
>
> **[Se o Memo estiver funcionando — só fale isso se você testou e confirmou:]**
>
> [abre a transação no ArcScan]
>
> Aqui na Arc: // esse registro passou por um contrato chamado Memo. //
> Ele anexa os dados do local direto na transação, // com um número de
> índice. // Não é um log que a gente reconstrói depois. // É a própria
> Arc guardando isso.

---

## PARTE 3 — Quem paga a conta (slide do X402API) · ~30 segundos

> Todo projeto de "ganhe cripto contribuindo dados" // morre no mesmo
> lugar: // o dinheiro acaba.
>
> Por isso o Stepless tem um segundo lado. // Um contrato chamado X402API
> // cobra, em USDC, // toda vez que alguém consulta esse oráculo de
> acessibilidade.
>
> Um app de rotas, // uma prefeitura, // uma plataforma de entregas // —
> todos pagam por consulta.
>
> E repare: // nenhum humano aprova esse pagamento. // O contrato libera o
> dinheiro sozinho, // baseado numa condição on-chain. // Isso é dinheiro
> programável, // não só uma transferência comum.

---

## PARTE 4 — Estado real e fecho (slide de status + slide final) · ~37 segundos

> O que está no ar, hoje, na Arc: // os três contratos, // o aplicativo, //
> o relayer, // e um tesouro em USDC pagando de verdade.
>
> O que ainda não está: // a rede principal da Arc. // Ela lança em
> setembro, // e a Circle ainda não publicou os endereços oficiais. //
> Por isso nosso sistema se recusa a ligar nela. // Preferimos não subir //
> do que subir errado.
>
> [Troca pro slide final]
>
> Acessibilidade não devia depender de boa vontade. // Devia pagar quem
> constrói ela.
>
> Stepless. // Obrigado.

---

## Dicas rápidas de leitura

- Leia **devagar**. Parece lento pra você, mas soa normal gravado.
- As `//` são pausas de respiração — não tenha pressa de preencher o
  silêncio.
- Se travar no meio de uma frase, **pare totalmente**, conte até 2, e repita
  só aquela frase inteira (não a partir de onde travou). Facilita cortar
  depois.
- Não precisa decorar. Pode deixar o texto numa aba/impresso do lado e ler
  quase que direto — soa natural o suficiente numa demo técnica.

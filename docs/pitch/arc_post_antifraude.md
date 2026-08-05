# Post para a comunidade Arc — atualização anti-fraude

Estilo: parágrafo corrido, sem headers, sem bullets, sem emoji, primeira
pessoa. Tom honesto — inclusive sobre o que ainda não funciona.

---

## Versão principal

Uma atualização rápida do Stepless, o mapa de acessibilidade que estou construindo na Arc, onde quem mapeia rampa, banheiro adaptado e entrada acessível recebe em USDC.

Semana passada me fizeram a pergunta que eu deveria ter feito primeiro: o que impede alguém de fotografar a porta da casa do vizinho, dizer que é uma padaria e sacar a recompensa? Respondi na hora que era o GPS, que o EXIF da foto tinha que bater com a coordenada do local. Depois fui abrir o código pra conferir e descobri que o app estava mandando a coordenada declarada de volta como se fosse a prova dela mesma. A distância dava zero sempre. A checagem estava aprovando tudo havia semanas, e eu respondendo com confiança que ela funcionava.

Consertei isso e acrescentei a camada que de fato faltava. O EXIF prova que você esteve ali, mas não diz nada sobre o que é aquele lugar — e no caso da porta do vizinho o EXIF bate certinho, porque a pessoa realmente estava lá. Agora cada envio é cruzado com o OpenStreetMap: se alguém declara uma padaria, deveria existir um shop=bakery num raio de 60 metros; se declara uma farmácia, um amenity=pharmacy. Porta de casa em rua residencial não tem nenhum dos dois, e quem verifica passa a ver o motivo escrito na tela em vez de um hash e um nome. Rejeição também ficou colada na carteira, então a segunda tentativa já começa numa posição pior que a primeira.

Duas decisões que eu quero explicar em vez de deixar implícitas. Quando a consulta ao OpenStreetMap falha, o risco fica em zero, e o bloqueio automático vem desligado. Boa parte da periferia brasileira simplesmente não está mapeada, e tratar ausência de dado como fraude excluiria exatamente as pessoas pra quem eu fiz isso. O sistema informa quem verifica, não decide no lugar dele.

E a parte que continua aberta: nada ainda confere a informação de acessibilidade em si. Dá pra parar na frente de uma padaria de verdade, marcar "tem rampa" e passar por todas as camadas que acabei de descrever. Cruzar com a tag wheelchair do OSM é o próximo passo, e depois disso confirmação presencial por um segundo contribuidor. O código está aberto, se alguém quiser procurar buraco.

---

## Versão curta (pra canal de updates rápidos)

Me perguntaram o que impede alguém de fotografar a porta da casa do vizinho, dizer que é uma padaria e sacar a recompensa do Stepless. Respondi que o GPS da foto tinha que bater com o local — aí fui ler meu próprio código e vi que o app mandava a coordenada declarada como prova dela mesma, então a distância dava zero sempre. Corrigido, e junto veio o que faltava de verdade: agora todo envio é cruzado com o OpenStreetMap, porque uma padaria declarada deveria ter um shop=bakery num raio de 60 metros, e porta de casa em rua residencial não tem. Rejeição passou a ficar colada na carteira também. O que ainda não resolvi: nada confere a rampa em si. Esse é o próximo.

---

## Notas para o autor

O ângulo forte é assumir o próprio erro. Post de projeto que só anuncia acerto
soa a marketing; contar que a checagem estava passando tudo por semanas — e que
você respondeu com confiança antes de conferir — gera mais credibilidade
técnica que qualquer lista de features. É a mesma escolha do post de
apresentação, que fechava admitindo que os verificadores ainda são
permissionados.

Não citei número de risco, peso nem nome de arquivo. A comunidade da Arc é
ampla e detalhe de implementação só interessa a quem for abrir o repositório.

Se for postar em inglês, avisa que eu traduzo mantendo esse tom — tradução
literal costuma endurecer o texto e perder justamente a parte humana.

Antes de colar: conferir se o README já aponta os contratos certos. Quem ler o
post vai conferir no ArcScan, e hoje o README ainda lista os v1 órfãos.

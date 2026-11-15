# Stepless — Roteiro até a Arc Mainnet

Checklist do que falta para o dApp sair da testnet e ir para a mainnet com
dinheiro real. Marque `[x]` ao concluir. Ordem importa: cada fase depende da
anterior.

**Legenda:** 👤 você faz · 🤖 Claude faz · 🤝 juntos

Estado em 15/11/2026: contratos v5 publicados e configurados na **testnet**
(8/8 itens verdes em `/api/setup`), campanha #1 criada, site e app v1.2.0 no ar.

---

## Fase 1 — Terminar o ensaio na testnet

O objetivo é provar o ciclo completo antes de qualquer dinheiro real.

- [ ] 👤 Enviar o commit pendente (`frontend/admin.html`, `frontend/campanhas.js`)
- [ ] 👤 Ir até um lugar **dentro da zona da campanha #1** e registrar um local
      com foto real, entrando **por e-mail** (não com a carteira `0xfbBE…`)
- [ ] 👤 Aprovar o local em `dashboard.html` com a carteira pessoal `0xfbBE…9686`
- [ ] 🤝 Conferir:
  - [ ] USDC chegou na carteira de quem mapeou
  - [ ] `campanhas.html` mostra "1 de N locais pagos"
  - [ ] A busca mostra o aviso "💰 Campanha ativa perto daqui"
- [ ] 👤 Esperar a campanha vencer e clicar em **"Devolver saldo ao parceiro"**
- [ ] 🤝 Conferir que a sobra voltou para a conta Admin (`0x828D…12b4`)

> Se algo falhar aqui, corrigimos na testnet. **Não avance para a Fase 4 com
> pendência nesta fase.**

---

## Fase 2 — Segurança

Na mainnet, uma chave vazada ou perdida significa dinheiro perdido. O projeto
já perdeu contratos uma vez por chave perdida (v1) e teve chave vazada no git.

- [ ] 👤 **Criar um multisig (Safe)** em app.safe.global, rede **Arc mainnet**
  - [ ] Regra **2 de 3 assinaturas**
  - [ ] Donos: sua carteira principal, uma carteira **reserva** (guardada
        separada, ex.: seed em papel) e uma pessoa de confiança
  - [ ] Anotar o endereço do Safe — ele será o **admin** dos contratos
- [ ] 👤 **Criar contas novas só para a mainnet** (nunca reaproveitar chaves da testnet):
  - [ ] Deployer (só para o deploy; depois é descartada)
  - [ ] Relayer (registra os locais)
  - [ ] Verificador do servidor (envia as aprovações on-chain)
  - [ ] Attester (paga as campanhas)
- [ ] 🤖 **Separar os ambientes na Vercel**: um projeto para a mainnet, com
      chaves próprias, e o atual continua como testnet
- [ ] 🤖 Conferir que nenhuma chave aparece no código (Secret Scan do CI)

---

## Fase 3 — Conteúdo e jurídico

- [ ] 🤖 Rascunho de **Termos de Uso** (o que é o Stepless, responsabilidades,
      campanhas, sem promessa de pagamento fora de campanha)
- [ ] 🤖 Rascunho de **Política de Privacidade (LGPD)**: fotos e localização
      são dados pessoais; o que fica público na blockchain e no IPFS não pode
      ser apagado — isso precisa estar claro antes do envio
- [ ] 👤 Revisão dos termos por um advogado (recomendado)
- [ ] 🤖 Caixa de **aceite dos termos** antes do primeiro envio (site e app)
- [ ] 🤖 Trocar os textos de "fase de testes / testnet / USDC de teste" pelos
      da mainnet (site, app, `como-sacar-recompensas.html`)
- [ ] 🤝 **Revisão do contrato `CampaignEscrow`** por outra pessoa
  - Opções: revisão na comunidade Arc, programa de grants da Circle, auditor
  - Até lá: **campanhas pequenas** (até ~$200 cada)
- [ ] 🤖 Página/seção explicando para **parceiros** como funciona a campanha
      (garantias: só paga verificado, sobra volta, ninguém saca)

---

## Fase 4 — Deploy na mainnet

- [ ] 👤 Colocar **USDC real**:
  - [ ] Deployer: ~$2–5 (gás do deploy)
  - [ ] Relayer, Verificador e Attester: ~$5 cada (gás das transações)
- [ ] 👤 Cadastrar no GitHub o segredo `DEPLOYER_PRIVATE_KEY_MAINNET`
- [ ] 👤 Rodar **Actions → Deploy contratos**:
  - Rede: `arc-mainnet`
  - Admin: **endereço do Safe**
  - Relayer, Verificador, Atestador: as contas novas da mainnet
  - Confirmação: `sim`
- [ ] 👤 Pelo Safe, chamar `acceptAdmin()` nos **4 contratos**
- [ ] 👤 Pelo Safe, dar o papel de **verificador** às carteiras dos revisores humanos
- [ ] 🤖 Atualizar `config/networks.json` (mainnet), regenerar a config de rede
- [ ] 👤 Variáveis no projeto Vercel da mainnet:
      `STEPLESS_NETWORK=arc-mainnet`, `ORACLE_ADDRESS`, `DISTRIBUTOR_ADDRESS`,
      `X402_ADDRESS`, `CAMPAIGN_ESCROW_ADDRESS`, `RELAYER_PRIVATE_KEY`,
      `VERIFIER_PRIVATE_KEY`, `ATTESTER_PRIVATE_KEY`, Upstash, OpenRouter
- [ ] 👤 Apontar o domínio `stepless.lat` para o projeto da mainnet
- [ ] 🤝 Conferir `stepless.lat/api/setup` → **8/8 verdes**, sem alerta crítico
- [ ] 🤖👤 **APK novo** apontando para a mainnet + release no GitHub
- [ ] 👤 Queimar/descartar a chave do Deployer

---

## Fase 5 — Lançamento

- [ ] 🤝 Primeiro teste real com **valor mínimo** (registrar, aprovar)
- [ ] 👤 **Primeiro parceiro real** (associação, comércio, secretaria de turismo)
- [ ] 👤 Primeira campanha **pequena** (até ~$200), numa cidade brasileira
- [ ] 🤖 Mural mostrar as **marcas que patrocinam campanhas**
- [ ] 👤 Post no **grupo USDC** do Arc House (resposta ao post do Pi Edra sobre escrow)
- [ ] 👤 **Vídeo** para o capítulo Brasil (roteiro já preparado)
- [ ] 👤 Atualizar a candidatura ao **Circle Developer Grant** com o modelo de campanhas

---

## Depois do lançamento (acompanhamento)

- Saldo de gás do Relayer, Verificador e Attester (alerta quando baixo)
- `/api/setup` periodicamente
- Campanhas vencidas com saldo → lembrar o parceiro de clicar em "Devolver"
- Revisar avisos novos do forge-lint a cada mudança em contrato

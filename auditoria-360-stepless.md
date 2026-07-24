# Auditoria 360° — Stepless (Comitê de 4 Especialistas)

**Data:** 2026-07-24
**Insumos analisados:** site ao vivo (index, buscar.html, dashboard.html), README atualizado, contratos na Arc Testnet (SteplessOracle `0x2Ac8...5F48`, RewardDistributor `0x4959...584b`, X402API `0x0D31...fCc9`), contexto do projeto.

## Verificação de suficiência de insumos

Analisável com o que há. Faltam para uma rodada mais profunda: bundle real do frontend (JS/CSS servidos), screenshots do fluxo mobile/APK, código dos contratos verificado no ArcScan, e métricas reais (Lighthouse, RPC calls). Onde necessário, inferências estão marcadas **[SUPOSIÇÃO]**. Fatos observados vêm do HTML servido em 2026-07-24.

---

## 1. Diagnóstico em um parágrafo

O Stepless tem fundação acima da média para um MVP solo em testnet — copy do hero excelente, honestidade rara sobre limitações, contratos verificáveis e narrativa de negócio real (dados de acessibilidade via x402, sem token) — mas o site ao vivo contradiz o README em pontos críticos e vaza infraestrutura interna para o usuário final: a tabela de recompensas está **vazia** (só cabeçalhos), os links do GitHub apontam para `github.com` genérico, um **painel de administração do relayer aparece na página pública** do dashboard ("conecte a wallet que fez o deploy no Remix"), o roadmap exibe "Q2 2026" como futuro quando já estamos em Q3 2026, e o aviso do APK instrui o usuário a **desativar a análise do Play Protect** — exatamente o comportamento que golpistas pedem, minando a confiança que o resto do produto constrói com cuidado. Nada disso é estrutural; quase tudo é corrigível em dias, e é isso que torna urgente corrigir.

---

## 2. Scorecard

| Dimensão | Nota | Justificativa |
|---|---|---|
| Funcionalidade (Arquiteto) | 6.5/10 | Loop completo funciona on-chain, mas admin UI pública, relayer/verificadores centralizados e estado UI↔chain sem tratamento visível de falha. |
| Performance (Frontend) | 6/10 | Site estático leve e multicall previsto são bons sinais; WebSocket + polling de eventos e ausência de estados de erro visíveis são riscos. [SUPOSIÇÃO em métricas] |
| Aparência (Direção de Arte) | 7/10 | Identidade coerente, dark mode, WCAG declarado, skip-links reais; perde pontos por tabela vazia, emojis como iconografia e mistura de idiomas. |
| Marketing & Conversão (Marketing) | 5.5/10 | Hero e proposta de valor fortes; confiança sabotada por links quebrados, recompensas sem valores e instrução de desligar Play Protect. |

---

## 3. Top 5 riscos críticos

1. **Instrução para desativar o Play Protect no aviso do APK.** É o padrão exato de app malicioso. Um avaliador da Circle/Arc ou um usuário cauteloso abandona ali. Pode desqualificar o projeto em due diligence.
2. **Painel admin do relayer visível na página pública do dashboard** ("Autorizar Relayer no Oracle… wallet que fez o deploy no Remix"). Revela arquitetura de chave única, expõe superfície de ataque social e passa amadorismo.
3. **Tabela de recompensas vazia na homepage.** A promessa central do produto ("ganhe USDC") não tem um único número. Mata a conversão de contribuidor no ponto exato de decisão.
4. **Links do GitHub apontando para `github.com` genérico** em "Ver no GitHub" e no rodapé. Para um projeto que se declara open-source, link quebrado para o repositório é o anti-sinal de confiança número um.
5. **Contradição site ↔ README sobre evidência e onboarding.** O site afirma "foto (IPFS/Arweave)… hash imutável on-chain" e "verificação descentralizada"; o README admite que storage de produção não existe e que verificadores são permissionados. O site também abre com "Conectar Wallet" quando o diferencial declarado é login por e-mail. Quem ler os dois percebe a inflação.

---

## 4. Análise cadeira por cadeira

### 4.1 Arquiteto de Software Sênior (Web3)

**A1 — Admin UI na página pública**
- EVIDÊNCIA: dashboard.html exibe a todos: "⚠️ Ação única necessária: O relayer precisa ser autorizado no Oracle… Conecte a wallet que fez o deploy dos contratos no Remix (wallet admin)".
- IMPACTO: (a) vaza que existe uma única chave admin deployada via Remix — vetor de engenharia social; (b) usuário comum vê um aviso que não é para ele e conclui que o sistema está quebrado; (c) sugere que setup de produção é feito na UI pública.
- FIX: mover para rota separada (`/admin.html`) ou renderizar só quando `connectedAddress === adminAddress`. Nunca montar o bloco no DOM público.
- ESFORÇO: S

**A2 — Centralização declarada mas não mitigada na UI**
- EVIDÊNCIA: relayer gerenciado + admin único + verificadores permissionados (README, "Honest MVP model"). O site público, porém, chama de "Verificação Descentralizada".
- IMPACTO: overclaim auditável — qualquer leitor do README refuta o site. Em Web3, incoerência entre marketing e realidade técnica é tratada como red flag.
- FIX: no site, trocar "Verificação Descentralizada" por "Verificação comunitária (permissionada na fase testnet)". Uma linha resolve.
- ESFORÇO: S

**A3 — Tratamento de erro do caminho feliz**
- EVIDÊNCIA: o fluxo prevê "⏳ Buscando locais… Consultando a blockchain" e "Aguardando eventos…", mas não há estado visível para RPC fora do ar — e o histórico do projeto registra instabilidade do RPC oficial da Arc (proxies removidos, retry único).
- IMPACTO: com RPC instável, o usuário fica preso num spinner infinito. Nielsen #1 (visibilidade do status) e #9 (recuperação de erro).
- FIX: timeout de 10–15 s no fetch → estado de erro com botão "Tentar novamente" + link ArcScan como fallback de verificação. [SUPOSIÇÃO: não vi o JS; se já existe, exibir mensagem também no HTML inicial via noscript/estado default.]
- ESFORÇO: M

**A4 — Assinaturas e aprovações**
- EVIDÊNCIA: modelo relayer + gas patrocinado significa que o usuário não assina tx de escrita — bom. USDC de recompensa vai direto à wallet — bom, sem approve do usuário.
- IMPACTO: superfície de risco de assinatura opaca é baixa; o risco concentra-se na chave do relayer e na treasury do RewardDistributor.
- FIX: documentar no README o modelo de custódia da chave do relayer (env var Vercel? KMS?) e limite de gasto da treasury por período (rate limit on-chain ou no relayer) para conter drenagem em caso de comprometimento.
- ESFORÇO: M

**A5 — Reorg / sincronização UI↔chain**
- EVIDÊNCIA: "Eventos em Tempo Real… via WebSocket" no dashboard.
- IMPACTO: em L1 nova, WebSocket cai e eventos se perdem; o usuário vê contagem divergente do ArcScan.
- FIX: reconciliar com polling periódico do subgraph Goldsky (já no roadmap) como fonte de verdade, WebSocket só como enfeite de tempo real.
- ESFORÇO: M

### 4.2 Engenheiro Frontend Sênior

**F1 — Estados vazios que parecem bug**
- EVIDÊNCIA: "Total Ganho: —", "Treasury: —", tabela de verificação "Nenhuma contribuição pendente", recompensas "Carregando recompensas…" — tudo renderizado antes de conectar wallet, junto com "Você não é um verificador aprovado" exibido a visitante desconectado.
- IMPACTO: primeiro contato com o dashboard parece sistema quebrado ou acusatório ("você não é aprovado" antes de qualquer ação). CLS provável quando os dados chegam. [SUPOSIÇÃO sobre CLS]
- FIX: gate único: antes de conectar, mostrar só o card "Conecte para começar" e esconder painéis dependentes; skeletons com altura fixa para o que carrega depois.
- ESFORÇO: S/M

**F2 — Duplicação de assets de logo claro/escuro**
- EVIDÊNCIA: `Arc_Logo_Navy.svg` e `Arc_Logo_White.svg` ambos no DOM (idem ícones no rodapé, em todas as páginas).
- IMPACTO: pequeno em peso (SVG), mas indica troca de tema via display:none — ambos baixados sempre.
- FIX: um `<img>` com `src` trocado via CSS variable/`<picture media="(prefers-color-scheme)">`.
- ESFORÇO: S

**F3 — Deep-link de wallet mobile**
- EVIDÊNCIA: botão "Conectar Wallet" no topo; README diz que MetaMask é opção avançada e e-mail é o caminho principal, mas o dashboard público mostra wallet como caminho único.
- IMPACTO: no celular (público-alvo real de quem mapeia na rua), conectar extensão não existe; sem WalletConnect/deep-link nem e-mail em destaque, o funil morre no primeiro toque.
- FIX: botão primário "Entrar com e-mail" no dashboard; wallet como secundário. Se e-mail já existe no fluxo (dynamic-wallet.js), promovê-lo visualmente — hoje o texto servido não o menciona.
- ESFORÇO: M

**F4 — Alt text ausente nas bandeiras de idioma**
- EVIDÊNCIA: `<img src=".../br.svg">` sem alt (o fetch mostra `![]()` vazio) nas três páginas.
- IMPACTO: seletor de idioma invisível para leitor de tela — num produto DE acessibilidade, isso é autossabotagem direta (WCAG 2.2, 1.1.1). O mesmo vale para os botões-emoji (🌙, 🔍, 📍) se não tiverem aria-label. [SUPOSIÇÃO nos emojis; confirmado nas bandeiras]
- FIX: `alt="Português"` etc.; aria-label em todo botão icônico; auditar com axe-core.
- ESFORÇO: S

**F5 — Tabela de recompensas renderizada sem linhas**
- EVIDÊNCIA: homepage: `| Nível | Tipo | Recompensa (USDC) | Descrição |` — zero linhas de dados.
- IMPACTO: se as linhas são injetadas via JS a partir do contrato e o RPC falha, a seção fica permanentemente vazia — que é o estado observado. LCP-adjacente e conversão.
- FIX: valores estáticos no HTML como fallback (os tiers estão no contrato; mudam raramente) e JS só sobrescreve se conseguir ler on-chain.
- ESFORÇO: S

### 4.3 Diretor de Arte Sênior

**V1 — Teste dos 3 segundos: passa no hero, falha no dashboard**
- EVIDÊNCIA: hero comunica imediatamente propósito humano ("Encontre lugares onde você pode entrar, circular e ser atendido com autonomia") — excelente, verbo-dirigido, sem jargão. O dashboard, em contraste, abre com métricas vazias, aviso de relayer e jargão (Oracle, Remix, hex).
- IMPACTO: a homepage promete "Web3 invisível"; o dashboard entrega Web3 nu. Quebra de personalidade entre páginas.
- FIX: aplicar ao dashboard o mesmo princípio do hero: primeiro "O que você quer fazer? → Mapear um local / Verificar / Ver recompensas", jargão só em tooltips.
- ESFORÇO: M

**V2 — Emojis como sistema de ícones**
- EVIDÊNCIA: ♿🛗🚻🅿️✋🌙🔍📍⏳🔐 por todo o site.
- IMPACTO: renderização inconsistente entre SO/navegadores, sem controle de cor/peso, e visual de protótipo — enfraquece o sinal "auditável e solvente". Para daltônicos e leitores de tela, semântica imprevisível.
- FIX: substituir por set único de SVG (Lucide/Phosphor têm ícones de acessibilidade), com `currentColor` para respeitar tema. Manter os emojis de categoria só se testados com NVDA/VoiceOver.
- ESFORÇO: M

**V3 — Idiomas misturados na mesma tela**
- EVIDÊNCIA: título da aba em inglês ("Decentralized Accessibility Infrastructure"), corpo em PT, skip-link trilíngue numa linha só, README em EN.
- IMPACTO: dilui a voz. O usuário-alvo brasileiro lê um título que não entende; o avaliador gringo abre um site que não lê.
- FIX: `<title>` e meta por idioma ativo; skip-link só no idioma corrente; manter README EN (audiência: avaliadores/devs) e criar README-pt.md se quiser.
- ESFORÇO: S

**V4 — Hierarquia da homepage**
- EVIDÊNCIA: três CTAs de mesmo peso lado a lado ("Ver todos os locais", "Contribuir com o mapa", "Baixar aplicativo Android") logo após o campo de busca, que já é um CTA.
- IMPACTO: Lei de Hick — quatro ações primárias competindo; o olho não pousa em nenhuma.
- FIX: busca como ação primária única (é o "know before you go"); "Contribuir" secundário; APK terciário/na seção própria.
- ESFORÇO: S

**V5 — Números financeiros**
- EVIDÊNCIA: valores USDC exibidos em métricas e tabelas. [SUPOSIÇÃO: sem tabular numerals]
- IMPACTO: números que "dançam" ao atualizar em fonte proporcional parecem imprecisos — em dinheiro, precisão visual é confiança.
- FIX: `font-variant-numeric: tabular-nums` em toda célula monetária.
- ESFORÇO: S

### 4.4 Gerente de Marketing Sênior

**M1 — A promessa sem preço**
- EVIDÊNCIA: seção "Tabela de Recompensas" vazia; nenhuma menção a quanto se ganha em lugar nenhum do site.
- IMPACTO: o funil de aquisição do contribuidor (metade do modelo de negócio) para no ponto de decisão. "Ganhe USDC" sem número é ruído; com número ("0,50–5 USDC por contribuição verificada") é oferta.
- FIX: publicar os tiers reais do RewardDistributor na tabela, com nota "valores de testnet, sujeitos a ajuste no mainnet".
- ESFORÇO: S

**M2 — Anti-sinal de confiança: Play Protect**
- EVIDÊNCIA: "…se aparecer a opção de análise de segurança, desmarque o envio e marque o app como confiável."
- IMPACTO: pedir para desligar verificação de segurança é o playbook de malware. Um parceiro institucional ou jornalista que veja isso encerra a conversa. Contradiz frontalmente a marca "verifiable".
- FIX: reescrever para: "O Android pode alertar porque o app ainda não está na Play Store (fase de testes). Você pode manter a análise do Play Protect ativada — o app passa nela normalmente. Instalar mesmo assim → pronto." Nunca instruir a desmarcar envio. Melhor ainda: assinar o APK e publicar o hash SHA-256 na página + release do GitHub.
- ESFORÇO: S (texto) / M (hash + release process)

**M3 — Open-source sem porta de entrada**
- EVIDÊNCIA: "Ver no GitHub" → `https://github.com`; rodapé idem. O repositório real (github.com/Acarlosr/Stepless) só aparece no README.
- IMPACTO: trust signal central quebrado; dev interessado não chega ao código; parece descuido ou, pior, que o repo não existe.
- FIX: corrigir os dois hrefs. 5 minutos.
- ESFORÇO: S

**M4 — Roadmap com datas vencidas**
- EVIDÊNCIA: site mostra "Fase 2 — Q2 2026: App Mobile" como futuro; hoje é 24/07/2026 (Q3).
- IMPACTO: roadmap vencido comunica projeto abandonado — o oposto da verdade, já que há APK entregue (que era a Fase 2!).
- FIX: atualizar: Fase 2 marcada como entregue (APK v1.0.0 disponível), Q3/Q4 revisados. Roadmap por fase sem trimestre é mais seguro para projeto solo.
- ESFORÇO: S

**M5 — Posicionamento vs. concorrência**
- EVIDÊNCIA: o site nunca se compara a nada. Concorrentes reais: Google Maps (dados de acessibilidade rasos), Wheelmap/AXS Map (sem incentivo, dados envelhecem), apps municipais (fragmentados).
- IMPACTO: o diferencial — *incentivo econômico mantém o dado fresco* — está implícito, não afirmado. É exatamente o "modelo que só existe agora" que ecossistemas Web3 premiam.
- FIX: uma linha acima do fold ou na seção Problema: "Mapas de acessibilidade já existiram. Todos morreram desatualizados — porque ninguém era pago para mantê-los. O Stepless corrige o incentivo." Usar estrutura PAS (problema-agitação-solução), que a seção Problema já quase faz.
- ESFORÇO: S

**M6 — Loop de retenção inexistente**
- EVIDÊNCIA: não há motivo para voltar após 1 contribuição (sem streaks, sem ranking, sem notificação de "seu local foi verificado").
- IMPACTO: modelo depende de contribuidores repetidos ("repeat contributors" é métrica declarada do piloto), mas nada no produto os traz de volta.
- FIX: mínimo viável: e-mail transacional "sua contribuição foi aprovada — 1 USDC pago, veja no ArcScan" (já há e-mail no onboarding). Depois: ranking público de mapeadores por cidade.
- ESFORÇO: M

---

## 5. Roadmap priorizado

### 🟢 Quick wins (≤1 semana)
1. Corrigir links do GitHub (M3) — 5 min, maior ROI da auditoria.
2. Reescrever aviso do APK sem "desmarque a análise" (M2).
3. Preencher tabela de recompensas com valores estáticos (M1/F5).
4. Esconder painel admin do relayer do público (A1).
5. Atualizar roadmap do site — Fase 2 entregue (M4).
6. Alt nas bandeiras + aria-label nos botões-emoji (F4).
7. Trocar "Verificação Descentralizada" por versão honesta (A2).
8. Hierarquizar CTAs do hero (V4) e tabular-nums (V5).

### 🟡 Médio prazo (1–4 semanas)
1. Dashboard: gate de conexão + skeletons + estados de erro com retry (F1, A3).
2. Promover login por e-mail como caminho primário no dashboard (F3).
3. Publicar hash SHA-256 do APK e release formal no GitHub (M2).
4. Substituir emojis por sistema de ícones SVG (V2).
5. E-mail "contribuição aprovada" — primeiro loop de retenção (M6).
6. Reconciliação de eventos via subgraph Goldsky como fonte de verdade (A5).
7. Linha de posicionamento vs. mapas mortos (M5).

### 🔴 Estrutural (>1 mês)
1. Documentar e endurecer custódia da chave do relayer + limites de gasto da treasury (A4).
2. Autenticação de imagem/localização para mainnet (já no README — mantê-lo como critério de go/no-go).
3. Ranking/reputação pública de contribuidores por cidade.
4. Auditoria de acessibilidade formal (axe + teste com leitores de tela reais) — o produto precisa ser sua própria prova.

---

## 6. Veredito unificado

**ITERATE & RELAUNCH** — assinado pelas quatro cadeiras.

Razão única mais forte: **o produto é mais honesto e mais funcional do que o site aparenta.** Os defeitos dominantes não são de arquitetura nem de conceito — são incoerências de vitrine (tabela vazia, links quebrados, admin exposto, datas vencidas, instrução anti-Play-Protect) que custam quase nada para corrigir e hoje anulam a credibilidade que os contratos verificáveis e o README maduro conquistam. Uma semana de quick wins muda a leitura externa do projeto de "protótipo descuidado" para "MVP sólido em testnet".

- *Arquiteto:* assino; nada aqui exige redesenho de contrato.
- *Frontend:* assino; prioridade absoluta nos estados vazios/erro do dashboard.
- *Direção de Arte:* assino; a identidade existe — falta disciplina de execução.
- *Marketing:* assino; corrija os 5 quick wins de confiança antes de mostrar o site a qualquer avaliador da Circle/Arc.

---

## 7. Três perguntas para a próxima rodada

1. Quais são os valores reais dos tiers no RewardDistributor e qual o saldo atual da treasury? (Define a tabela de recompensas e o teto de campanha do piloto.)
2. O fluxo de login por e-mail (dynamic-wallet.js) está funcional no dashboard hoje, ou só o caminho MetaMask? (Muda completamente a prioridade F3.)
3. Como a chave do relayer é armazenada e qual o dano máximo se ela vazar? (Determina o item estrutural nº 1 e a resposta pronta para due diligence.)

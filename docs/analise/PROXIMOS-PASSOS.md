# Stepless — onde paramos (2026-10-24)

Branch: `feat/mapeamento-voluntario`. Detalhes de tudo em `docs/analise/tesouraria-sem-patrocinador.md` (seções 7–9).

## Feito hoje
- Contrato `RewardDistributor`: recompensas **desligadas por padrão** (`rewardsEnabled`), teto diário ($1), sem dívida (`RewardNotFunded`), `sponsorTreasury` com marca.
- `/api/sponsor`: formulário de marcas apoiadoras com aprovação manual.
- Mainnet Arc no `config/networks.json` (chain 5042); contratos Stepless ainda `null`.
- Site e app sem nenhuma menção a pagamento por cadastro; seção "Por que mapear".
- Robô-drone trocado pela cena "escada vira rampa".
- IA (OpenRouter grátis): segunda opinião sobre a foto + texto alternativo (`api/_ai.js`).
- Seção "Para quem é" (deficiência visual/auditiva, idosos, mobilidade temporária, cuidadores) + destaque "Vai viajar?" + categoria 9 "Quarto adaptado".

## Para amanhã
1. `cd contracts && forge test -vv` (não rodou aqui — sem Foundry).
2. Instalar dependências do app (`cd mobile && npm install`), checar tipos e gerar APK novo.
3. Revisar materiais de pitch/hackathon em `docs/` (ainda falam em recompensas).
4. Colocar `OPENROUTER_API_KEY` na Vercel e testar um cadastro real.
5. Deploy mainnet: admin multisig, tesouraria $0, `paused`, $5 de USDC no relayer, conferir custo do 1º cadastro.

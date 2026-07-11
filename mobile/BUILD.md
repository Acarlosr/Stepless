# Stepless Mobile — Build (Expo EAS)

App Android/iOS de mapeamento de acessibilidade. Registra locais via o backend
real (`www.stepless.lat/api/relay`) — o mesmo do dApp web. O usuário não assina
nada on-chain: a carteira embarcada só recebe o USDC.

**Status:** código fechado e validado por sintaxe (esbuild) + JSON válido.
Falta rodar os passos abaixo na sua máquina — ninguém rodou `npm install`
nem `tsc` de verdade ainda.

## Checklist de execução (nesta ordem)

- [ ] **1. Instalar dependências**
- [ ] **2. Rodar em desenvolvimento** (Expo Go, pra ver o app funcionando)
- [ ] **3. Preencher pendências opcionais** (Google Maps key, ícone) — pode pular pro build sem isso
- [ ] **4. Build do APK via EAS**
- [ ] **5. Instalar o APK no celular e testar o fluxo completo**

---

## 1. Instalar dependências

```bash
cd mobile
npm install
# garante versões compatíveis com o Expo SDK 51:
npx expo install --fix
```

Removi as libs `@crossmint/*` do `package.json` (não são usadas em nenhum
lugar do código — a carteira é embarcada via viem, não Crossmint). Isso reduz
o risco de conflito de versão no `npm install`.

Se der erro de peer dependency, rode `npx expo install --fix` de novo — ele
corrige a maioria. Se `npm install` falhar num pacote específico, me avise
com o erro exato que eu ajusto o `package.json`.

## 2. Rodar em desenvolvimento (Expo Go / emulador)

```bash
npx expo start
```

Abra no **Expo Go** (celular) ou num emulador Android/iOS. O fluxo já funciona:
abrir → criar carteira → mapear local (GPS + foto) → registrar → recompensa
pendente aparece em "Recompensas".

**Esse é o passo mais importante pra validar antes de gastar um build EAS** —
se algo quebrar, é mais rápido de debugar aqui do que esperando um build na
nuvem.

## 3. Pendências opcionais (pode pular)

- **Mapa no Android**: adicione uma Google Maps API key em
  `app.json → android.config.googleMaps.apiKey` (hoje está vazio — sem ela, o
  mapa fica em branco no Android; no iOS usa Apple Maps e funciona sem key).
- **Ícone/splash**: hoje usam o padrão do Expo. Para publicar, adicione
  `assets/icon.png` (1024×1024) e referencie em `app.json`.
- **Backend**: por padrão aponta para `https://www.stepless.lat`. Para trocar,
  defina `EXPO_PUBLIC_STEPLESS_API` antes do build.

Nenhuma dessas impede o build de APK pra demo — só afetam o mapa e a
identidade visual.

## 4. Build na nuvem com EAS (não precisa de Mac para iOS)

```bash
eas login
eas build:configure          # vincula o projeto (preenche extra.eas.projectId, hoje vazio)

# APK Android (instalável direto — ideal para demo de grant/hackathon):
eas build -p android --profile preview

# iOS (TestFlight — exige conta Apple Developer US$99/ano):
eas build -p ios --profile preview
```

O `eas.json` já tem os perfis `preview` (APK/internal) e `production` (AAB para loja).
O build roda na nuvem da Expo — não precisa de Android Studio nem Xcode localmente.
Ao terminar, o terminal mostra um link pra baixar o `.apk` direto.

## 5. Testar o APK

Baixe o `.apk` pelo link que o `eas build` imprime, transfira pro celular
Android (ou baixe direto nele) e instale (pode pedir "permitir fontes
desconhecidas"). Teste o fluxo completo: login → criar carteira → mapear
local com foto real → ver a recompensa pendente em "Recompensas".

## Arquitetura (resumo)

- `src/services/api.ts` — registra local via `POST /api/relay` (empacotamento
  idêntico ao `frontend/dashboard.js`).
- `src/services/wallet.tsx` — carteira embarcada (viem + expo-secure-store).
- `src/services/contracts.ts` — leituras on-chain (endereços v3 reais) + saldos.
- `src/screens/` — Map (mapear), Rewards (saldo/histórico), Profile, Login.

# Stepless Mobile — Build (Expo EAS)

App Android/iOS de mapeamento de acessibilidade. Registra locais via o backend
real (`www.stepless.lat/api/relay`) — o mesmo do dApp web. O usuário não assina
nada on-chain: a carteira embarcada só recebe o USDC.

## Pré-requisitos

- Node 18+
- Conta Expo (grátis): https://expo.dev
- `npm i -g eas-cli`

## 1. Instalar dependências

```bash
cd mobile
npm install
# garante versões compatíveis com o Expo SDK 51:
npx expo install --fix
```

## 2. Rodar em desenvolvimento (Expo Go / emulador)

```bash
npx expo start
```

Abra no **Expo Go** (celular) ou num emulador Android/iOS. O fluxo já funciona:
abrir → criar carteira → mapear local (GPS + foto) → registrar → recompensa
pendente aparece em "Recompensas".

## 3. Build na nuvem com EAS (não precisa de Mac para iOS)

```bash
eas login
eas build:configure          # vincula o projeto (preenche extra.eas.projectId)

# APK Android (instalável direto — ideal para demo de grant/hackathon):
eas build -p android --profile preview

# iOS (TestFlight — exige conta Apple Developer US$99/ano):
eas build -p ios --profile preview
```

O `eas.json` já tem os perfis `preview` (APK/internal) e `production` (AAB para loja).

## Configurações que valem a pena preencher

- **Mapa no Android**: adicione uma Google Maps API key em
  `app.json → android.config.googleMaps.apiKey` (sem ela, o mapa fica em branco
  no Android; no iOS usa Apple Maps e funciona sem key).
- **Ícone/splash**: hoje usam o padrão do Expo. Para publicar, adicione
  `assets/icon.png` (1024×1024) e referencie em `app.json`.
- **Backend**: por padrão aponta para `https://www.stepless.lat`. Para trocar,
  defina `EXPO_PUBLIC_STEPLESS_API` antes do build.

## Arquitetura (resumo)

- `src/services/api.ts` — registra local via `POST /api/relay` (empacotamento
  idêntico ao `frontend/dashboard.js`).
- `src/services/wallet.tsx` — carteira embarcada (viem + expo-secure-store).
- `src/services/contracts.ts` — leituras on-chain (endereços v3 reais) + saldos.
- `src/screens/` — Map (mapear), Rewards (saldo/histórico), Profile, Login.

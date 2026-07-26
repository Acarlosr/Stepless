# Guia — Como transformar um dApp em app Android (Expo + EAS)

Receita usada no Stepless, replicável em qualquer projeto. Tudo roda online
(EAS compila na nuvem) — não precisa de Android Studio nem de SDK local.

---

## Visão geral do método

O app é React Native via **Expo SDK** (JS/TS, mesma lógica do frontend web),
compilado na nuvem pelo **EAS Build**, que devolve um **APK instalável** por
link/QR code. A carteira é embarcada (viem) e as transações passam por um
**relayer backend** (o usuário não assina nada nem paga gas).

```
código (mobile/) ──► eas build (nuvem) ──► APK ──► link/QR ──► celular
```

---

## 1. Estrutura do projeto

Crie uma pasta `mobile/` dentro do repo do projeto:

```
mobile/
├── App.tsx              ← entrypoint (SÓ composição; nada de config aqui)
├── app.json             ← identidade do app (nome, pacote, ícone, permissões)
├── eas.json             ← perfis de build
├── package.json
├── assets/              ← icon.png, adaptive-icon.png, imagens
└── src/
    ├── config/          ← constantes compartilhadas (rede, cores) — SEMPRE aqui
    ├── screens/         ← telas
    ├── services/        ← wallet, contratos, chamadas de API
    └── i18n/            ← traduções
```

### Regra de ouro nº 1 — nunca importar de volta do App.tsx
Se `App.tsx` importa uma tela/serviço, essa tela/serviço **não pode** importar
nada de `App.tsx` — é import circular, e no Hermes (motor JS do Android) o
valor chega `undefined` e o app **crasha na abertura** com erros do tipo
`Cannot read property 'x' of undefined`. Config e constantes compartilhadas
vivem em `src/config/*`, nunca declaradas no entrypoint.

### Regra de ouro nº 2 — polyfills no topo do App.tsx
O Hermes não tem `TextEncoder`/`TextDecoder` (o viem precisa). Primeiras
linhas do `App.tsx`, antes de qualquer outro import:

```ts
import 'react-native-get-random-values'; // crypto p/ viem
import 'fast-text-encoding';             // TextEncoder/TextDecoder
```

E `npm install fast-text-encoding react-native-get-random-values`.

---

## 2. Arquivos de configuração

### app.json (mínimo)

```json
{
  "expo": {
    "name": "NomeDoApp",
    "slug": "nomedoapp",
    "version": "1.0.0",
    "icon": "./assets/icon.png",
    "android": {
      "package": "xyz.seudominio.app",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#EAF2FE"
      },
      "permissions": ["android.permission.ACCESS_FINE_LOCATION", "android.permission.CAMERA"],
      "config": { "googleMaps": { "apiKey": "SUA_CHAVE" } }
    },
    "extra": { "eas": { "projectId": "vem do eas init" } },
    "owner": "sua-conta-expo"
  }
}
```

- **Ícone**: `icon.png` e `adaptive-icon.png` em 1024×1024. Sem isso o app
  instala com o robozinho verde padrão do Android.
- **Google Maps** (se usar mapa): chave em `android.config.googleMaps.apiKey`.
  Criar em console.cloud.google.com → ativar **Maps SDK for Android** →
  Credenciais → Chave de API. Restrinja por "Restrição de APIs" (só Maps SDK
  for Android); evite restrição por app/SHA-1 até a fase final. **Sem a chave
  o app crasha ao abrir o mapa** (`API key not found`).

### eas.json

```json
{
  "cli": { "version": ">= 12.0.0", "appVersionSource": "remote" },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" }
    }
  }
}
```

- `preview` gera **APK** (instala direto no celular — é o que se usa em demo).
- `production` gera **AAB** (só serve pra Play Store).
- **Não** coloque `"channel"` nos perfis a menos que use OTA updates
  (`expo-updates`) — com channel e sem o pacote, o build é bloqueado.

---

## 3. Passo a passo do build

```bash
# 0. Node 20 (Expo SDK 51 não gosta do Node 25+)
nvm install 20 && nvm use 20

# 1. SEMPRE dentro da pasta mobile/ (errar a pasta cria projeto EAS órfão!)
cd mobile

# 2. Dependências (primeira vez)
npm install
npx expo install --fix        # alinha versões com o SDK do Expo

# 3. Vincular ao EAS (primeira vez; cria o projectId no app.json)
npx eas-cli@latest init

# 4. Build
npx eas-cli@latest build -p android --profile preview
```

Respostas às perguntas do CLI:
- "Generate a new Android Keystore?" → **Y** (o EAS guarda pra você).
- "Install expo-updates?" → **n** (não precisa pra APK de teste).
- "Install and run on an emulator?" → **n** (instala no celular pelo QR).

Ao final aparece um **QR code + link** — abre no celular e instala.

---

## 4. Checklist antes de cada build (evita gastar build à toa)

```bash
npx tsc --noEmit                                   # zero erros de tipo
npx expo export --platform android --output-dir /tmp/teste   # bundle compila?
grep -rn "from '../../App'\|from './App'" src/    # nada importando do entrypoint
```

Se o `expo export` passa, o "Run gradlew" do EAS quase certamente passa
(o bundle JS roda dentro do Gradle — arquivo faltando, ex. um
`require('./assets/x.png')` sem o arquivo, derruba o build inteiro).

---

## 5. Erros que já pegamos (e a solução)

| Sintoma | Causa | Solução |
|---|---|---|
| Crash na abertura, `Cannot read property ... of undefined` | Import circular com App.tsx | Mover config p/ `src/config/*` |
| Crash na abertura, erro de TextEncoder | Falta polyfill no Hermes | `fast-text-encoding` no topo do App.tsx |
| Crash ao abrir o mapa, `API key not found` | Chave Google Maps ausente | Preencher `app.json` + rebuild |
| Build falha "Run gradlew" sem detalhe | Asset referenciado não existe (ex. `robot.png.png` por extensão duplicada do Finder) | Conferir nomes; Finder → mostrar extensões |
| "channel ... expo-updates missing" | `channel` no eas.json sem o pacote | Remover `channel` (ou instalar expo-updates) |
| "No lockfile found" | Rodou fora da pasta `mobile/` | `cd mobile` antes de tudo |
| Peer dependency no npm install | Libs puxando React de outra major | Remover libs não usadas; `npx expo install --fix` |

---

## 6. Distribuição (sem Play Store)

1. **Link do EAS**: cada build gera um link/QR. Serve pra testes, mas
   **expira (~30 dias)** e pode pedir login.
2. **Recomendado — GitHub Release**: baixe o `.apk` da página do build no
   expo.dev e anexe num Release do repo. Link permanente e direto.
3. **No site do projeto**: botão "Baixar App Android (APK)" + aviso de que o
   Play Protect pode alertar (app fora da Play Store) — instruir "Mais
   detalhes" → "Instalar mesmo assim".

---

## 7. Contas/serviços envolvidos (todos com free tier)

| Serviço | Pra quê | Onde |
|---|---|---|
| Expo/EAS | Compilar o APK na nuvem | expo.dev |
| Google Cloud | Chave do Maps (se usar mapa) | console.cloud.google.com |
| Vercel | Backend relayer (`/api/*`) + site | vercel.com |
| Upstash Redis | Metadados fora da chain (nome/categoria) | upstash.com |
| Pinata | Fotos no IPFS | pinata.cloud |

Arquitetura que se repete bem em qualquer dApp mobile:
**app (carteira embarcada, só leitura on-chain) → backend relayer (assina e
paga gas) → contrato**. O usuário nunca vê seed phrase, gas ou popup de
assinatura — só usa o app.

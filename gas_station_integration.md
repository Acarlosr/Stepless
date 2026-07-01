# ♿ Stepless — Circle Gas Station Integration Guide

## Visão Geral

A Circle Gas Station patrocina automaticamente as taxas de transação (gas) para **Smart Contract Account (SCA) wallets** na Arc Testnet. Isso significa que contribuidores do Stepless **não precisam ter USDC para pagar gas** — o Gas Station cobre.

Isso é crítico para o Stepless porque:
- Contribuidores são pessoas com deficiência, muitas sem familiaridade com crypto
- Uma recompensa de $0.10 não faz sentido se o gas custa $0.01+
- Remove a maior barreira de entrada para novos contribuidores

---

## Como Funciona (Baseado na Doc da Arc)

1. **Circle Dev-Controlled Wallets** são SCA wallets criadas via Circle SDK
2. **Gas Station** detecta que a tx vem de uma SCA wallet e paga o gas automaticamente
3. O contrato inteligente **não precisa saber** que o gas foi patrocinado — é transparente
4. O Gas Station é financiado pela Circle na testnet (custo zero para o desenvolvedor)

### Da doc "Deploy contracts":
> *"With SCA wallets, Circle Gas Station automatically sponsors your transaction fees on Arc Testnet."*

### Do feed Arc House (Stablecoin 101):
> *"Circle Paymaster lets users pay network gas fees directly with USDC, making onchain payments simple, intuitive, and accessible."*

---

## Pré-requisitos

1. **Circle Developer Account** — [console.circle.com](https://console.circle.com)
2. **API Key** — Console → Keys → Create API key → Standard Key
3. **Entity Secret** — Registrar em Console → Wallets → Entity Secret
4. **Node.js v22+** instalado

---

## Passo a Passo

### 1. Instalar Circle SDK

```bash
npm install @circle-fin/wallets @circle-fin/developer-controlled-wallets
```

### 2. Configurar variáveis de ambiente

```env
CIRCLE_API_KEY=sua_api_key
CIRCLE_ENTITY_SECRET=seu_entity_secret
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
```

### 3. Criar Wallet Set + SCA Wallet para Contribuidor

```typescript
import { CircleSDK } from '@circle-fin/wallets';

const circle = new CircleSDK({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

// Criar wallet set (grupo de wallets)
const walletSet = await circle.wallets.createWalletSet({
  name: 'Stepless Contributors',
});

// Criar SCA wallet na Arc Testnet
const wallet = await circle.wallets.createWallet({
  walletSetId: walletSet.id,
  blockchain: 'ARC-TESTNET',
  accountType: 'SCA', // Smart Contract Account — Gas Station eligible
});

console.log('Contributor wallet:', wallet.address);
// → 0x... (esta wallet terá gas patrocinado automaticamente)
```

### 4. Habilitar Gas Station no Console

1. Acesse [console.circle.com](https://console.circle.com)
2. Vá para **Wallets → Gas Station**
3. Ative o Gas Station para **Arc Testnet**
4. O Gas Station patrocina automaticamente — sem código extra

### 5. Enviar Transação com Gas Patrocinado

```typescript
// O contribuidor envia uma transação para o SteplessOracle
// O Gas Station paga o gas automaticamente — o contribuidor não vê nenhuma taxa

const tx = await circle.wallets.sendTransaction({
  walletId: wallet.id,
  blockchain: 'ARC-TESTNET',
  contractAddress: '0x_ORACLE_ADDRESS',
  contractFunction: 'registerLocation',
  params: {
    locationHash: '0x...',
    latPacked: '-23600000',  // -23.6 * 1e6 (São Paulo)
    lngPacked: '-46600000',  // -46.6 * 1e6
    dataHash: '0x_IPFS_HASH',
  },
});

console.log('Tx hash:', tx.txHash);
// Gas foi patrocinado pelo Gas Station — contribuidor não pagou nada
```

### 6. Receber Recompensa na SCA Wallet

```typescript
// O RewardDistributor paga a recompensa em USDC para a SCA wallet
// O gas dessa transação também é patrocinado se o caller for SCA

const balance = await circle.wallets.getWalletBalance({
  walletId: wallet.id,
  blockchain: 'ARC-TESTNET',
});

console.log('USDC balance:', balance.amount);
// → 0.10 (recompensa recebida, sem desconto de gas)
```

---

## Arquitetura com Gas Station

```
┌──────────────────────────────────────────────────────────────┐
│                     CONTRIBUIDOR (SCA Wallet)                 │
│                                                              │
│  1. Mapeia local no app mobile                               │
│  2. App chama SteplessOracle.registerLocation()              │
│  3. Gas Station paga o gas ← SEM CUSTO PARA O CONTRIBUIDOR   │
│  4. Recompensa de $0.10 USDC creditada                       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                     VERIFICADOR (SCA Wallet)                  │
│                                                              │
│  1. Verifica contribuição de outro usuário                   │
│  2. App chama SteplessOracle.verifyContribution()            │
│  3. Gas Station paga o gas ← SEM CUSTO PARA O VERIFICADOR    │
│  4. Recompensa de $0.05 USDC creditada                       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                     CIRCLE GAS STATION                        │
│                                                              │
│  • Financia gas para todas as SCA wallets na Arc Testnet     │
│  • Detecta automaticamente — sem código extra                │
│  • Transparente para os contratos inteligentes               │
│  • Financiado pela Circle na testnet (gratuito)              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Integração com Crossmint/Dynamic

O feed Arc House confirma que Crossmint e Dynamic são **Day One Architects** na Arc. Ambos suportam SCA wallets:

### Crossmint
```typescript
// Crossmint cria embedded wallets com social login
// As wallets são SCA → elegíveis para Gas Station
import { Crossmint } from '@crossmint/sdk';

const crossmint = new Crossmint({
  apiKey: process.env.CROSSMINT_API_KEY,
});

// Login social (Google, Apple, Email)
const wallet = await crossmint.wallet.create({
  chain: 'arc-testnet',
  type: 'custodial', // SCA wallet
});
```

### Dynamic
```typescript
// Dynamic oferece embedded wallets + account abstraction
import { Dynamic } from '@dynamic/sdk';

const dynamic = await Dynamic.init({
  environmentId: process.env.DYNAMIC_ENV_ID,
});

// Login social → embedded wallet SCA na Arc
const user = await dynamic.auth.loginWithGoogle();
const wallet = user.wallet; // SCA wallet → Gas Station eligible
```

---

## Fluxo Completo do Contribuidor com Gas Station

```
1. Usuário baixa o app Stepless
   ↓
2. Login social (Google/Apple) via Crossmint ou Dynamic
   → Cria SCA wallet na Arc Testnet automaticamente
   ↓
3. Usuário mapeia um local acessível (tira foto, preenche dados)
   → App chama SteplessOracle.registerLocation()
   → GAS STATION paga a taxa (usuário não vê nada)
   ↓
4. Verificador valida a contribuição
   → App chama SteplessOracle.verifyContribution()
   → GAS STATION paga a taxa
   ↓
5. Recompensa de $0.10 USDC é creditada
   → RewardDistributor.payReward()
   → USDC aparece na wallet do contribuidor
   ↓
6. Usuário pode:
   → Continuar mapeando (mais recompensas)
   → Sacar via PIX (futuro: integração com offramp)
   → Usar USDC em outros apps na Arc
```

---

## Limitações Conhecidas

1. **Gas Station é apenas para testnet** — em mainnet, o modelo de gas abstraction pode mudar
2. **Apenas SCA wallets** — EOA wallets (MetaMask) não são patrocinadas
3. **Rate limits** — o Gas Station pode ter limites de taxa na testnet
4. **Offramp não coberto** — o Gas Station patrocina gas, mas não resolve o saque via PIX

---

## Próximos Passos

1. Criar conta no Circle Developer Console
2. Configurar Gas Station para Arc Testnet
3. Integrar Crossmint ou Dynamic para login social
4. Testar o fluxo completo: login → mapear → verificar → receber recompensa
5. Monitorar gas patrocinado via Circle Console
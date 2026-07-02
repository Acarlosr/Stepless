<div align="center">
  <img src="docs/mascot.svg" width="120" alt="Stepless mascot" />

  # Stepless

  **Decentralized accessibility infrastructure on Arc Testnet**

  People with disabilities map ramps & accessible locations and earn micro-USDC.  
  The data becomes a global oracle consumed via x402 by travel apps, municipalities & mobility platforms.

  [![Arc](https://img.shields.io/badge/Network-Arc%20Testnet-6C5CE7?style=flat-square)](https://arc.network)
  [![USDC](https://img.shields.io/badge/Stablecoin-USDC-2775CA?style=flat-square)](https://developers.circle.com)
  [![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?style=flat-square)](https://stepless.vercel.app)
  [![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
  [![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square)](contracts/src/)

  **[🌐 Live App](https://stepless.vercel.app)** · **[📊 Dashboard](https://stepless.vercel.app/dashboard.html)**

</div>

---

> **Accessibility shouldn't depend on goodwill. It should pay the people who build it.**

Stepless turns accessibility mapping into on-chain, instantly-settled USDC rewards. Contributors submit photos of ramps, elevators, and accessible locations. Verifiers confirm them on-chain. USDC lands in the contributor's wallet — settled on Arc in seconds.

---

## Deployed Contracts (Arc Testnet — Chain ID 5042002)

| Contract | Address | Purpose |
|---|---|---|
| **SteplessOracle** | [`0x220a3A4CAb8A5894C0926E9Ff700168F32F8192e`](https://testnet.arcscan.app/address/0x220a3A4CAb8A5894C0926E9Ff700168F32F8192e) | Location registry + contribution tracking |
| **RewardDistributor** | [`0x6A4EB7949eE5985e6524184cE7FA46a8b15e556B`](https://testnet.arcscan.app/address/0x6A4EB7949eE5985e6524184cE7FA46a8b15e556B) | USDC treasury + reward payments |
| **X402API** | [`0x0D318864C80eCe8d28800a750bdA06b6E52ffCc9`](https://testnet.arcscan.app/address/0x0D318864C80eCe8d28800a750bdA06b6E52ffCc9) | HTTP 402 payment protocol for API access |

**Example transaction:** `registerLocation` confirmed on-chain at block 49720668 on Arc Testnet.

---

## How It Works

1. **Contributor** opens the dApp, detects location via GPS or address search
2. **Submits** a photo + location name + category (ramp, elevator, restroom, etc.)
3. **Relayer** (Vercel serverless) validates EXIF GPS anti-fraud and calls `SteplessOracle.registerLocation()` — paying gas in USDC
4. **Verifier** confirms the submission on-chain via `verifyContribution()`
5. **RewardDistributor** releases USDC from treasury to the contributor's wallet

---

## Architecture

```
User (browser)
      │
      ▼
stepless.vercel.app          ← Vanilla HTML/JS frontend
      │
      ▼
/api/relay.js                ← Vercel serverless relayer (pays gas in USDC)
      │  EXIF GPS validation (anti-fraud)
      ▼
SteplessOracle.sol           ← Location registry on Arc Testnet
      │
      ▼
RewardDistributor.sol        ← USDC treasury + reward settlement
      │
      ▼
Goldsky Subgraph             ← Event indexer for dashboard (pending deploy)
```

### Why Arc?

| Feature | Benefit for Stepless |
|---|---|
| **USDC-native gas** | Micropayments (0.01–1 USDC) viable; no volatile token |
| **3-second finality** | Contributors see TX confirmed in real-time |
| **EVM-compatible** | Full Solidity 0.8.24 + viem support |
| **Programmable money** | x402 payment protocol for API consumers |

---

## Project Structure

```
stepless/
├── contracts/src/
│   ├── SteplessOracle.sol       # Location registry + contribution tracking
│   ├── RewardDistributor.sol    # USDC treasury + reward settlement
│   └── X402API.sol              # HTTP 402 API payment protocol
├── frontend/
│   ├── index.html               # Landing page (vanilla HTML/JS)
│   ├── dashboard.html           # Contributor dashboard
│   ├── dashboard.js             # Dashboard logic (viem, GPS, EXIF)
│   ├── arc-config.js            # Contract addresses + ABIs
│   └── dynamic-wallet.js        # Wallet onboarding (Dynamic SDK)
├── api/
│   ├── relay.js                 # Vercel serverless relayer (gasless UX)
│   └── setup.js                 # One-time relayer authorization endpoint
├── subgraph/
│   ├── schema.graphql           # GraphQL schema
│   └── subgraph.yaml            # Goldsky manifest
└── docs/
    └── mascot.svg               # Stepless mascot
```

---

## Smart Contracts

### SteplessOracle.sol

On-chain registry for accessible locations and contributions. Uses Arc block number (not timestamp) for ordering.

- `registerLocation(bytes32 locationHash, uint256 latPacked, uint256 lngPacked, bytes32 dataHash)` — Register a new accessible location
- `submitContribution(...)` — Submit update/photo for an existing location
- `verifyContribution(bytes32 id, bool approve, string reason)` — Verifier approves or rejects
- `setAuthorizedCaller(address, bool)` — Admin manages authorized relayers

### RewardDistributor.sol

USDC treasury and payment engine.

- `payReward(bytes32 contributionId, address contributor, uint8 tier)` — Release USDC to contributor
- `fundTreasury(uint256 amount)` — Admin deposits USDC
- `registerVerifier(address)` / `removeVerifier(address)` — Manage verifier set

### X402API.sol

HTTP 402 payment protocol: external apps pay per-request in USDC to query accessibility data.

---

## Frontend

Vanilla HTML + JavaScript — no build step, no framework.

- **GPS auto-detect** or address search for location input
- **EXIF GPS validation** on photo uploads (anti-fraud)
- **Dynamic SDK** for wallet onboarding
- **Vercel serverless relayer** pays gas on behalf of users (gasless UX)

Live: [stepless.vercel.app](https://stepless.vercel.app)

---

## Roadmap

### Phase 1 — Foundation ✅
- [x] 3 smart contracts deployed on Arc Testnet
- [x] Vercel serverless relayer (gasless UX)
- [x] GPS + EXIF anti-fraud validation
- [x] Contributor dashboard (vanilla HTML/JS)
- [x] `registerLocation` confirmed on-chain

### Phase 2 — Community (in progress)
- [ ] Goldsky subgraph deploy (rewards history + map)
- [ ] Fund RewardDistributor treasury
- [ ] Onboard initial verifiers
- [ ] Map first 100 accessible locations

### Phase 3 — Scale
- [ ] Mobile app (React Native / Expo)
- [ ] IPFS photo storage (Pinata)
- [ ] Circle Gas Station for sponsored transactions

### Phase 4 — Protocol
- [ ] Decentralized verifier election
- [ ] Multi-city expansion
- [ ] DAO governance

---

## Links

| Resource | URL |
|---|---|
| **Live App** | [stepless.vercel.app](https://stepless.vercel.app) |
| **Arc Network** | [arc.network](https://arc.network) |
| **ArcScan** | [testnet.arcscan.app](https://testnet.arcscan.app) |
| **Circle Faucet** | [faucet.circle.com](https://faucet.circle.com) |
| **Goldsky** | [goldsky.com](https://goldsky.com) |

---

**Accessibility shouldn't depend on goodwill. It should pay the people who build it.**

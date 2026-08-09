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

Stepless is programmable-money infrastructure: a USDC treasury that only releases funds against an independent, on-chain verification, running in the accessibility-data domain. Contributors submit photos of ramps, elevators, and accessible locations. Verifiers confirm them on-chain. USDC lands in the contributor's wallet — settled on Arc in seconds. Third parties then pay per query, in USDC via x402, to read the resulting oracle.

---

## Contracts

Addresses for **every** network live in [`config/networks.json`](config/networks.json)
— the single source read by the backend, the frontend, and the mobile app. No
address is hardcoded anywhere else.

```bash
node scripts/check-live-contracts.mjs   # asks Arc itself which pair is live
```

**Mainnet status:** Arc's public mainnet launches on **2026-09-16**, but Circle
has not yet published the USDC and Memo addresses for that network
("Mainnet addresses are not yet available", [docs.arc.io](https://docs.arc.io/arc/references/contract-addresses)).
That's why the `arc-mainnet` entry in the JSON carries `null` fields on
purpose, and the backend **refuses to boot** against it. Not shipping beats
shipping a guessed address: on Arc, a call to an address with no code returns
success, and the contract would mark rewards as paid without moving a cent.

> **Deprecated contracts — do not use.** The v3 pair (`0x53ba90e1…` /
> `0xdf8fa455…`) and v1 are still on-chain and still hold balance. v3 actually
> looks *more* active than the live pair (34 locations vs. a handful), so
> counting locations leads to the wrong conclusion about which one is in use.
> Both are listed under `deprecatedContracts` in the JSON, and a CI check fails
> if either reappears in the frontend or the app.

## Build on Arc Hackathon — submission notes

**Track:** DeFi — programmable, conditional USDC payments triggered by on-chain
verification.

**What is live right now** (Arc Testnet, chain 5042002 — click through and check):

| Contract | Address | Role |
|---|---|---|
| `SteplessOracle` | [`0x69b3f9ca…a5cc`](https://testnet.arcscan.app/address/0x69b3f9caca6514f76dd2f0dc4b54409e6d5da5cc) | Location + contribution registry |
| `RewardDistributor` | [`0xef5d148b…2ea0`](https://testnet.arcscan.app/address/0xef5d148b126d8dcdc7d344dfa367c61acbb02ea0) | USDC treasury, funded and paying |
| `X402API` | [`0x0D318864…fCc9`](https://testnet.arcscan.app/address/0x0D318864C80eCe8d28800a750bdA06b6E52ffCc9) | HTTP 402 metered access to the oracle |

Live app: **[stepless.vercel.app](https://stepless.vercel.app)** · Dashboard: **[/dashboard.html](https://stepless.vercel.app/dashboard.html)**

**The programmable-money flow:**

1. A contributor's submission is registered on-chain, unverified.
2. A verifier confirms it independently, on-chain — the payout is gated by
   that verification, not by a signature from the contributor or a human
   approving a transfer.
3. `RewardDistributor` releases USDC from treasury automatically once the
   condition is met. Multi-step settlement, each step on-chain.
4. `X402API` meters third-party reads of the resulting oracle and settles them
   in USDC per call — the demand side that keeps the treasury funded instead
   of running down to zero.

**Where the Arc stack is actually used, not just named:**

- **USDC-denominated gas.** The relayer pays gas in USDC. There is no second token anywhere in the system — a contributor never has to acquire anything to get paid.
- **Sub-second settlement.** A contributor watches the reward land while still standing in front of the ramp they photographed. This is the whole product: a 30-second feedback loop is a different thing from a 30-second promise.
- **`Memo` predeploy.** Registrations are submitted *through* Arc's `Memo` contract, which forwards the call via the `callFrom` precompile. Structured metadata (packed lat/lng + photo hash) is attached natively to the transaction with a sequential index, instead of being reconstructed from logs off-chain.
- **x402.** `X402API.sol` meters third-party reads of the accessibility oracle and settles them in USDC.

**Known limitation, stated plainly:** Arc mainnet launches 2026-09-16 and Circle has not published mainnet USDC/Memo addresses yet, so `arc-mainnet` in `config/networks.json` has `null` fields on purpose and the backend refuses to boot against it. Guessing an address would be worse than not shipping — on Arc, a call to an address with no code returns success, and the contract would mark rewards as paid without moving a cent.

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
stepless.vercel.app          ← Plain HTML/JS frontend
      │
      ▼
/api/upload.js               ← Receives the PHOTO; extracts EXIF server-side,
      │                        computes dataHash = keccak256(bytes), and
      │                        stores the image on IPFS. Returns a token.
      ▼
/api/relay.js                ← Serverless relayer (pays gas in USDC).
      │  Validates the photo's   Uses ONLY the token's proof — the client
      │  GPS against the         never declares coordinates or a hash.
      │  declared location
      ▼
Memo (Arc predeploy)         ← The relayer, an EOA, calls Memo with the
      │  0x5294E9…e505          oracle as target. The `callFrom` precompile
      │                         preserves msg.sender, so the oracle still
      │                         sees the authorized relayer — and a
      │                         sequential, indexable Memo event is emitted.
      │                         See api/_memo.js.
      ▼
SteplessOracle.sol           ← Location registry on Arc
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
| **Sub-second finality** | Contributors see the TX confirmed in real time |
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
│   ├── _memo.js                 # Arc Memo predeploy integration
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

### Phase 1.5 — Mainnet hardening (2026-08-06)
- [x] v5 contracts: `immutable` USDC/Memo, two-step admin transfer, 48h
      withdrawal timelock, permissionless retry via `failedRewards`,
      reentrancy guard
- [x] Server-side photo proof (the image itself is now uploaded and stored)
- [x] Separated keys: admin (multisig) / relayer / verifier
- [x] Deploy and admin-rotation endpoints removed from the API
- [x] `config/networks.json` as the single source of network truth
- [x] Arc `Memo` integration fixed to route through the relayer EOA instead of
      the contract — the contract-side call was reverting silently since the
      v4 deploy (2026-07-31); see `api/_memo.js`
- [ ] External audit of the contracts — **code freeze on 2026-08-29**
- [ ] Deploy v5 contracts and migrate state

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

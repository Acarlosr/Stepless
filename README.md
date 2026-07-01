# Stepless

> **Accessibility shouldn't depend on goodwill. It should pay the people who build it.**

Stepless is decentralized accessibility infrastructure powered by USDC micropayments on **Arc** — Circle's stablecoin-native Layer 1. It turns accessibility contributions (mapping wheelchair-accessible locations, translating content, verifying compliance) into on-chain, instantly-settled USDC rewards.

No grants to chase. No invoices to send. No 30-day net terms. You contribute, a verifier confirms, USDC lands in your wallet — settled on Arc in under 3 seconds for fractions of a cent.

---

## Badges

![Arc](https://img.shields.io/badge/Network-Arc%20Testnet-6C5CE7?style=flat-square)
![USDC](https://img.shields.io/badge/Stablecoin-USDC-2775CA?style=flat-square)
![WCAG](https://img.shields.io/badge/WCAG-2.1%20AA-005A9C?style=flat-square)
![i18n](https://img.shields.io/badge/i18n-EN%20%7C%20FR%20%7C%20DE%20%7C%20JP-FF6B6B?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square)
![Foundry](https://img.shields.io/badge/Built%20with-Foundry-FF7E33?style=flat-square)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Smart Contracts](#smart-contracts)
- [Frontend](#frontend)
- [Mobile App](#mobile-app)
- [Subgraph](#subgraph)
- [IPFS Integration](#ipfs-integration)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Links](#links)

---

## Overview

Accessibility maps are incomplete, outdated, and maintained by volunteers who burn out. Stepless fixes the incentive problem:

1. **Contributors** submit accessibility data — photos of ramps, translations of signage, WCAG compliance checks.
2. **Verifiers** (authorized community members) confirm the submission on-chain.
3. **RewardDistributor** releases USDC from the treasury to the contributor's wallet — instantly, on Arc.

Every step is transparent, auditable, and settled in programmable money. The protocol is open-source and permissionless: anyone can contribute, anyone can become a verifier, and every reward is traceable on ArcScan.

### Why Arc?

| Feature | Benefit for Stepless |
|---|---|
| **USDC-native** | Rewards are stablecoin by default — no volatile token, no price feeds needed |
| **Sub-cent fees** | Micropayments (0.01–1 USDC) are economically viable |
| **3-second finality** | Contributors see rewards confirmed in real-time |
| **Programmable money** | Gas Station can sponsor txs; Crossmint enables fiat on-ramp |
| **EIP-7708 events** | Rich on-chain data for the subgraph to index |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER LAYER                               │
│  Web Dashboard (React)    Mobile App (React Native)    API       │
└──────────┬──────────────────────┬────────────────────────┬──────┘
           │                      │                        │
           ▼                      ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      INDEXING LAYER                              │
│                   Goldsky Subgraph (GraphQL)                     │
│     Indexes RewardClaimed, LocationVerified, PaymentReceived     │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE LAYER                               │
│   IPFS (Pinata) — accessibility photos, metadata, translations   │
│   CIDs referenced on-chain in submission events                  │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SMART CONTRACT LAYER (Arc)                    │
│                                                                  │
│  ┌─────────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │ RewardDistributor   │  │ SteplessOracle   │  │ X402API    │ │
│  │                     │  │                  │  │            │ │
│  │ • Treasury mgmt     │  │ • Verifier registry│ │ • HTTP 402 │ │
│  │ • Reward claiming   │  │ • Submission store │ │ • API pay  │ │
│  │ • Admin controls    │  │ • Verification log │ │ • Webhook  │ │
│  └─────────────────────┘  └──────────────────┘  └────────────┘ │
│                                                                  │
│  All contracts settle in USDC (6 decimals) on Arc Testnet        │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                          │
│  Circle Gas Station (sponsored txs)   Crossmint (fiat on-ramp)   │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Purpose |
|---|---|---|
| **RewardDistributor.sol** | Solidity 0.8.24 | Manages USDC treasury, releases rewards to verified contributors |
| **SteplessOracle.sol** | Solidity 0.8.24 | Stores accessibility submissions, verifier registry, verification state |
| **X402API.sol** | Solidity 0.8.24 | HTTP 402 payment protocol for API consumers paying per-request in USDC |
| **Goldsky Subgraph** | GraphQL / The Graph | Indexes contract events into queryable GraphQL API |
| **IPFS (Pinata)** | IPFS / Pinata | Decentralized storage for accessibility photos and metadata |
| **Circle Gas Station** | Circle API | Sponsors gas for contributors so they don't need ARC tokens |
| **Crossmint** | Crossmint SDK | Fiat-to-USDC on-ramp for new contributors without crypto |
| **Frontend** | React + Vite + Tailwind | Landing page + contributor dashboard |
| **Mobile App** | React Native + Expo | Field submission app for mapping locations |

---

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`, `anvil`)
- [Node.js](https://nodejs.org/) 20+ and npm
- [Expo CLI](https://docs.expo.dev/) (for mobile app)
- A wallet with Arc Testnet configured
- Testnet USDC from the [Circle Faucet](https://faucet.circle.com)

### 1. Clone the repository

```bash
git clone https://github.com/stepless/stepless.git
cd stepless
```

### 2. Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 3. Install dependencies

```bash
# Smart contracts
forge install

# Frontend
cd frontend && npm install && cd ..

# Mobile app
cd mobile && npm install && cd ..

# Subgraph
cd subgraph && npm install && cd ..
```

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env with your private key, API keys, and Arc Testnet RPC
```

### 5. Compile and test contracts

```bash
forge build
forge test
```

### 6. Deploy to Arc Testnet

```bash
# Deploy RewardDistributor
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify

# Or use forge create for individual contracts
forge create src/RewardDistributor.sol:RewardDistributor \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $USDC_ADDRESS $ADMIN_ADDRESS \
  --verify
```

See the [Deployment Guide](docs/deployment_guide.md) for the full step-by-step process.

---

## Project Structure

```
stepless/
├── README.md                          # You are here
├── LICENSE                            # MIT License
├── .env.example                       # Environment variable template
├── foundry.toml                       # Foundry configuration
├── package.json                       # Root package.json (workspace)
│
├── src/                               # Smart contracts
│   ├── RewardDistributor.sol          # USDC treasury + reward claiming
│   ├── SteplessOracle.sol             # Submissions + verifier registry
│   └── X402API.sol                    # HTTP 402 API payment protocol
│
├── test/                              # Foundry tests
│   ├── RewardDistributor.t.sol        # Unit + fuzz tests
│   ├── SteplessOracle.t.sol           # Unit + fuzz tests
│   ├── X402API.t.sol                  # Unit + fuzz tests
│   └── invariant/                     # Invariant tests
│       └── RewardDistributor.invariant.t.sol
│
├── script/                            # Deploy scripts
│   └── Deploy.s.sol                   # Two-phase deployment script
│
├── frontend/                          # Web dashboard + landing page
│   ├── public/
│   │   └── locales/                   # i18n translations (EN, FR, DE, JP)
│   ├── src/
│   │   ├── components/
│   │   │   ├── LandingPage.tsx        # Marketing landing page
│   │   │   ├── Dashboard.tsx          # Contributor dashboard
│   │   │   ├── RewardHistory.tsx      # USDC reward history table
│   │   │   ├── SubmissionForm.tsx     # Accessibility submission form
│   │   │   └── WalletConnect.tsx      # Wallet connection modal
│   │   ├── hooks/
│   │   │   ├── useRewards.ts          # Hook for reward data from subgraph
│   │   │   └── useSubgraph.ts         # GraphQL query hook
│   │   ├── lib/
│   │   │   ├── arc.ts                 # Arc RPC + contract interactions
│   │   │   ├── ipfs.ts                # Pinata IPFS upload/fetch
│   │   │   └── crossmint.ts           # Crossmint fiat on-ramp
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
│
├── mobile/                            # React Native mobile app
│   ├── src/
│   │   ├── screens/
│   │   │   ├── MapScreen.tsx          # Map of accessible locations
│   │   │   ├── SubmitScreen.tsx       # Photo + location submission
│   │   │   ├── RewardsScreen.tsx      # Reward history + balance
│   │   │   └── ProfileScreen.tsx      # Wallet + verifier status
│   │   ├── components/
│   │   │   ├── CameraCapture.tsx      # In-app camera for photos
│   │   │   ├── LocationPicker.tsx     # GPS + manual location
│   │   │   └── RewardCard.tsx         # USDC reward display
│   │   ├── lib/
│   │   │   ├── arc.ts                 # Arc wallet + contract calls
│   │   │   └── ipfs.ts                # IPFS upload from mobile
│   │   └── App.tsx
│   ├── app.json                       # Expo config
│   ├── package.json
│   └── tsconfig.json
│
├── subgraph/                          # Goldsky subgraph
│   ├── schema.graphql                 # GraphQL schema
│   ├── subgraph.yaml                  # Subgraph manifest
│   ├── src/
│   │   ├── mapping.ts                 # Event handlers
│   │   └── helpers.ts                 # Entity helpers
│   ├── package.json
│   └── goldsky.json                   # Goldsky deployment config
│
├── docs/                              # Documentation
│   ├── contributing.md                # Contributing guide
│   ├── deployment_guide.md            # Arc Testnet deployment guide
│   ├── security_audit_checklist.md    # Pre-mainnet security checklist
│   └── architects_program_guide.md    # Arc Architects Program guide
│
├── .github/
│   └── workflows/
│       └── ci.yml                     # GitHub Actions CI pipeline
│
└── grants/
    └── circle-developer-grant.md      # Circle Developer Grants application
```

---

## Smart Contracts

All contracts are written in Solidity 0.8.24 and deployed on Arc Testnet. They use OpenZeppelin's IERC20 interface to interact with USDC.

### RewardDistributor.sol

The treasury and payment engine. Holds USDC and releases it to contributors when verifiers confirm submissions.

- **`fundTreasury(uint256 amount)`** — Admin deposits USDC into the treasury (requires ERC-20 approve first)
- **`claimReward(address contributor, uint256 amount, bytes32 submissionId)`** — Verifier-authorized reward release
- **`addVerifier(address verifier)` / `removeVerifier(address verifier)`** — Admin manages verifier set
- **`setRewardAmount(uint256 amount)`** — Admin sets default reward per verified submission
- **Events:** `RewardClaimed(contributor, amount, submissionId)`, `TreasuryFunded(amount, balance)`, `VerifierAdded(verifier)`, `VerifierRemoved(verifier)`

### SteplessOracle.sol

The data layer. Stores accessibility submissions and verification state on-chain. IPFS CIDs link to off-chain photos and metadata.

- **`submitLocation(bytes32 ipfsCID, uint256 lat, uint256 lng, string category)`** — Contributor submits accessibility data
- **`verifySubmission(bytes32 submissionId)`** — Verifier confirms a submission
- **`registerVerifier(address verifier)`** — Admin authorizes a new verifier
- **`getSubmission(bytes32 submissionId)`** — Read submission data
- **Events:** `LocationSubmitted(submissionId, contributor, ipfsCID, lat, lng)`, `LocationVerified(submissionId, verifier)`

### X402API.sol

HTTP 402 payment protocol for API consumers. Enables per-request USDC payments for accessing Stepless accessibility data.

- **`createAPIKey(address consumer, uint256 ratePerCall)`** — Admin creates an API key with a per-call rate
- **`recordPayment(bytes32 apiKey, uint256 calls)`** — Authorized caller records API usage
- **`settlePayment(bytes32 apiKey, address consumer)`** — Settles accumulated USDC charges
- **Events:** `PaymentReceived(consumer, amount, apiKey)`, `APIKeyCreated(consumer, ratePerCall)`

---

## Frontend

The web application has two parts:

### Landing Page

Marketing and onboarding page for new contributors. Explains the protocol, shows live stats from the subgraph (total rewards distributed, locations mapped, active verifiers), and includes a wallet connection CTA.

### Dashboard

Contributor dashboard for authenticated users:
- **Submission form** — Upload accessibility photos (to IPFS), select location, choose category
- **Reward history** — Table of all USDC rewards received, with transaction hashes linking to ArcScan
- **Verifier panel** — For authorized verifiers: pending submissions queue with approve/reject
- **Treasury status** — Current USDC balance in RewardDistributor

Built with React + Vite + Tailwind CSS. Supports i18n (EN, FR, DE, JP) via react-i18next.

```bash
cd frontend
npm install
npm run dev    # Local development
npm run build  # Production build
```

---

## Mobile App

React Native app built with Expo for field use. Contributors can:

- **Map locations** — Open the camera, take a photo of an accessibility feature (ramp, braille signage, audio signal), GPS tags the location, upload to IPFS, submit on-chain
- **View rewards** — Real-time USDC balance and reward history
- **Browse map** — View all verified accessible locations on an interactive map
- **Offline queue** — Submissions queue locally when offline and sync when connectivity returns

```bash
cd mobile
npm install
npx expo start    # Start Expo dev server
```

---

## Subgraph

A Goldsky subgraph indexes all Stepless contract events into a queryable GraphQL API. The frontend and mobile app use it to display reward history, submission status, and treasury stats without making direct RPC calls.

### Entities

- **Contributor** — Wallet address, total rewards, submission count
- **Submission** — IPFS CID, location, category, verification status, verifier
- **Reward** — Amount, contributor, submission ID, timestamp, tx hash
- **Treasury** — Current balance, total funded, total distributed
- **APIKey** — Consumer address, rate per call, total settled

### Deploy

```bash
cd subgraph
npm install

# Generate types and build
npx graph codegen
npx graph build

# Deploy to Goldsky
npx goldsky deploy stepless-v1
```

The subgraph endpoint is configured in `.env` as `GOLDSKY_SUBGRAPH_ENDPOINT`.

---

## IPFS Integration

Accessibility photos and metadata are stored on IPFS via Pinata pinning service. This ensures:

- **Decentralization** — Photos aren't stored on a single server
- **Immutability** — CIDs are content-addressed; tampering changes the CID
- **Cost efficiency** — On-chain storage only references the CID (bytes32)
- **Persistence** — Pinata pins content across multiple IPFS nodes

### Flow

1. Contributor takes a photo in the mobile app or uploads via the dashboard
2. EXIF metadata is stripped (privacy: no GPS in the photo itself — location is submitted separately)
3. Image is uploaded to Pinata → returns a CID
4. CID (as bytes32) is included in the on-chain `submitLocation` transaction
5. Subgraph indexes the event, frontend resolves CID → IPFS gateway URL for display

```typescript
// Upload to IPFS
const cid = await uploadToIPFS(photoBuffer, {
  name: `stepless-${submissionId}.jpg`,
  keyvalues: { category, submittedBy: address }
});
```

---

## Roadmap

### Phase 1 — Foundation (Q1 2026) ✅

- [x] 3 smart contracts (RewardDistributor, SteplessOracle, X402API)
- [x] Foundry tests (unit + fuzz)
- [x] Deploy script (two-phase pattern)
- [x] Goldsky subgraph
- [x] Frontend landing page + dashboard
- [x] React Native mobile app
- [x] IPFS integration (Pinata)
- [x] Circle Developer Grants application

### Phase 2 — Testnet & Community (Q2 2026)

- [ ] Deploy to Arc Testnet
- [ ] Onboard 10 initial verifiers
- [ ] Map 1,000 accessible locations in São Paulo pilot
- [ ] Launch i18n (FR, DE, JP)
- [ ] Integrate Circle Gas Station for sponsored transactions
- [ ] Integrate Crossmint for fiat on-ramp
- [ ] Public beta of mobile app (Expo + TestFlight)

### Phase 3 — Scale & Partnerships (Q3 2026)

- [ ] Security audit (Trail of Bits or OpenZeppelin)
- [ ] Deploy to Arc Mainnet
- [ ] Partner with accessibility organizations (WCAG, local disability rights groups)
- [ ] Open verifier application process
- [ ] API marketplace via X402API (paid access to accessibility data)
- [ ] Governance module for reward amount adjustments

### Phase 4 — Protocol (Q4 2026)

- [ ] Decentralized verifier election (stake + slash)
- [ ] Multi-city expansion (Paris, Berlin, Tokyo)
- [ ] Accessibility compliance NFT certificates
- [ ] Integration with municipal open-data portals
- [ ] DAO transition (admin → multisig → governance)

---

## Contributing

We welcome contributions from everyone — especially people with accessibility needs, translators, and Arc ecosystem developers.

See **[CONTRIBUTING.md](docs/contributing.md)** for the full guide.

### Areas We Need Help

| Area | Details |
|---|---|
| 🌍 Translations | French (FR), German (DE), Japanese (JP) |
| 🔒 Smart Contracts | Audit prep, fuzz tests, invariant tests |
| 📱 Mobile App | Expo, offline sync, camera optimization |
| 🎨 UX/UI | Accessibility-first design, WCAG 2.1 AA compliance |

---

## License

MIT License. See [LICENSE](LICENSE) for the full text.

```
MIT License

Copyright (c) 2026 Stepless Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Links

| Resource | URL |
|---|---|
| **Arc Network** | [arc.network](https://arc.network) |
| **Circle Faucet** (testnet USDC) | [faucet.circle.com](https://faucet.circle.com) |
| **ArcScan** (testnet explorer) | [testnet.arcscan.app](https://testnet.arcscan.app) |
| **Arc House** (Discord community) | [discord.gg/archouse](https://discord.gg/archouse) |
| **Circle Developer Platform** | [developers.circle.com](https://developers.circle.com) |
| **Goldsky** | [goldsky.com](https://goldsky.com) |
| **Crossmint** | [crossmint.com](https://crossmint.com) |
| **Pinata** (IPFS) | [pinata.cloud](https://pinata.cloud) |
| **Foundry Book** | [book.getfoundry.sh](https://book.getfoundry.sh) |

---

<p align="center">
  <strong>Accessibility shouldn't depend on goodwill. It should pay the people who build it.</strong>
</p>
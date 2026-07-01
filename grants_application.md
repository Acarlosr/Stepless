# Stepless — Circle Developer Grants Application

**Project:** Stepless — Decentralized Accessibility Infrastructure  
**Network:** Arc Testnet (Circle's stablecoin-native L1)  
**License:** MIT (Open Source)  
**Repository:** [github.com/Acarlosr/Stepless](https://github.com/Acarlosr/Stepless)  
**Contact:** senacarlos@gmail.com  
**Date:** June 2026  

---

## 1. Executive Summary

Over 1 billion people worldwide live with some form of disability. Yet the most basic question — *"Can I enter this building?"* — remains unanswered for millions of locations globally. Existing accessibility data is fragmented across proprietary databases, municipal portals, and volunteer-driven platforms that are slow to update, expensive to license, and concentrated in wealthy cities. The Global South, where 80% of people with disabilities reside, is effectively a data desert. Stepless solves this by building a decentralized accessibility oracle where contributors earn micro-USDC rewards for mapping and verifying accessible locations — ramps, restrooms, parking, entrances — directly on-chain.

Stepless is built natively on **Arc**, Circle's stablecoin-native L1. This is not an arbitrary choice: Arc's architecture makes micro-reward economics viable for the first time. USDC is the native gas token, transaction fees are sub-cent, and finality is sub-second. A $0.10 reward for mapping a new location is economically rational on Arc in a way it cannot be on Ethereum or even L2s where gas alone would consume the reward. The **Circle Gas Station** sponsors transaction fees for Smart Contract Account (SCA) wallets, meaning contributors never need to hold crypto to participate — they log in with social authentication via Crossmint or Dynamic, receive an embedded wallet, and start earning immediately. API consumers — travel apps, city governments, mobility platforms — pay for the data via **x402 nanopayments**, creating a self-sustaining revenue loop.

We are applying for a Circle Developer Grant to fund the critical path from our current Phase 1 (Foundation: contracts deployed on Arc Testnet, subgraph schema defined, Gas Station integration documented) to Phase 2 (Public Beta, Q3 2025) and Phase 3 (Mainnet Launch, Q4 2025). Grant funds will cover a professional smart contract audit, frontend and mobile development, Goldsky subgraph indexing infrastructure, IPFS/Arweave photo storage, and initial community building in Brazil (our launch market). Stepless directly advances Circle's mission of an internet-native financial system by demonstrating that stablecoin micropayments can fund real-world public goods — and by onboarding a demographic (people with disabilities, many unbanked) into the stablecoin economy through meaningful work rather than speculation.

---

## 2. Problem Statement

### The Scale

The World Health Organization estimates that **1.3 billion people — 16% of the global population — experience significant disability**. This number is growing due to population aging, chronic disease prevalence, and improved diagnostic rates. Yet the digital infrastructure to answer basic accessibility questions does not exist at scale:

- **Is there a ramp at this restaurant?**
- **Does this metro station have an accessible restroom?**
- **Is there accessible parking within 200m of this clinic?**
- **Can a wheelchair user enter this shop independently?**

### The Data Gap

Existing accessibility data sources are fundamentally broken:

| Source | Problem |
|---|---|
| **Google Maps / Business listings** | Accessibility attributes are optional, self-reported by business owners, unverified, and absent for 90%+ of locations globally |
| **Government databases** | Cover only municipal properties; updated on multi-year cycles; rarely machine-readable; non-existent in most of the Global South |
| **Wheelmap / AccessMap** | Volunteer-driven, underfunded, no incentive mechanism; coverage plateaus at ~1M locations globally (vs. 200M+ commercial venues) |
| **Commercial APIs** | Expensive ($0.10–$1.00 per query), proprietary, siloed, and focused on Western cities |

### The Centralization Problem

Accessibility data is a **public good** trapped in private silos. A travel app that wants accessibility data must license from multiple vendors, each with different schemas, coverage areas, and pricing. A city government that wants to audit its own infrastructure has no real-time data source. A wheelchair user in São Paulo, Lagos, or Mumbai has no map. The result: 80% of people with disabilities live in the Global South where accessibility data is effectively nonexistent, and even in wealthy cities, data coverage is sparse and outdated.

### The Incentive Problem

Volunteer mapping platforms fail because they rely on altruism. Mapping a location takes 2–5 minutes: photographing the entrance, noting the presence of a ramp, checking restroom dimensions, recording parking spots. Without compensation, the vast majority of potential contributors never start, and those who do burn out. The solution requires **aligned economic incentives** — pay people for verified contributions, and charge data consumers for access. This requires micropayments at a scale that traditional payment rails cannot support.

---

## 3. Solution

### Stepless: A Decentralized Accessibility Oracle

Stepless is a decentralized protocol where contributors map accessible locations and earn micro-USDC rewards for verified contributions. The aggregated data forms a global accessibility oracle — a queryable API that travel apps, city governments, and mobility platforms pay to consume via x402 nanopayments.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONTRIBUTOR FLOW                          │
│                                                                 │
│  1. Social login (Google, Apple) via Crossmint / Dynamic        │
│  2. Embedded wallet created (SCA — Gas Station sponsors gas)     │
│  3. Map a location: photo + accessibility attributes             │
│  4. Photo uploaded to IPFS/Arweave, hash stored on-chain         │
│  5. Contribution registered in SteplessOracle.sol                │
│  6. Verifier (another contributor) confirms the data             │
│  7. RewardDistributor.sol pays USDC to contributor + verifier    │
│                                                                 │
│  Reward: $0.10 new location · $0.05 verification · $0.02 photo   │
│          $0.03 update · $5.00 monthly top-contributor bonus      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API CONSUMER FLOW                           │
│                                                                 │
│  1. Travel app / city / mobility platform queries Stepless API   │
│  2. X402API.sol charges per-query via x402 nanopayment           │
│     OR consumer subscribes monthly (on-chain subscription)       │
│  3. Revenue flows to protocol treasury                           │
│  4. Treasury funds contributor rewards → self-sustaining loop    │
└─────────────────────────────────────────────────────────────────┘
```

### Contribution Types

| Type | Reward (USDC) | Description |
|---|---|---|
| New location | $0.10 | First registration of an accessible location with attributes |
| Verification | $0.05 | Second contributor confirms the location data is accurate |
| Photo | $0.02 | Photo of the accessibility feature (ramp, restroom, parking) |
| Update | $0.03 | Updated information for an existing location (e.g., ramp removed) |
| Monthly bonus | $5.00 | Top 10 contributors each month receive a bonus |

### Verification Model

Stepless uses a **peer verification model**: a contribution is confirmed when a different contributor visits the same location and verifies the data. Verifiers are registered on-chain and can be slashed for fraudulent verifications. This creates a trustless, self-policing data quality system without centralized reviewers.

### Data Schema

Each location record contains:

- **Location hash** (deterministic, geohash-based) — prevents duplicates
- **Accessibility attributes**: ramp, accessible restroom, accessible parking, step-free entrance, elevator, braille signage, wide doors
- **Photo hashes** (IPFS/Arweave CIDs stored on-chain via Arc Memo contract)
- **Contributor address** and **registration block number**
- **Verification count** and **verifier addresses**
- **Metadata** attached via Arc's predeployed Memo contract at `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`

### Internationalization

Stepless is built for global adoption from day one:

- **Phase 1 languages:** Portuguese (PT-BR), English (EN), Spanish (ES)
- **Planned:** French (FR), German (DE), Japanese (JP)
- **WCAG AA compliant** — the platform that serves people with disabilities is itself accessible

---

## 4. Why Arc

Arc is not just a deployment target for Stepless — it is the **only chain where the economics work**. Here is why:

### USDC as Native Gas

On Arc, USDC is the native gas token. This means:
- Contributors receive rewards in the same asset they would use to pay for anything else on-chain
- No token swaps, no wrapped tokens, no bridge risk
- The reward model ($0.10, $0.05, $0.02) is denominated in a stable unit — contributors know exactly what they're earning
- USDC exists in both native (18 decimals) and ERC-20 (6 decimals) interfaces — same asset, same balance. Our contracts use the ERC-20 interface (6 decimals) for intuitive amounts: $0.10 = 100,000 units

### Sub-Cent Transaction Fees

Arc's transaction fees are a fraction of a cent. On Ethereum, a single token transfer costs $1–$15. On L2s, $0.01–$0.50. On Arc, the cost of registering a location, verifying it, and paying a $0.10 reward is **less than $0.001 in gas** — and that gas is itself sponsored by the Circle Gas Station for contributor wallets. This makes micro-reward economics viable for the first time.

### Sub-Second Finality

Arc blocks are sub-second, and `block.timestamp` is non-strictly-increasing (multiple blocks can share the same timestamp). Our contracts use `block.number` for ordering instead of `block.timestamp` — a design decision directly informed by Arc's block production model. Contributors see their rewards confirmed in under 2 seconds.

### x402 Nanopayments

The x402 protocol enables HTTP 402-based payment challenges — API consumers pay per query in USDC with no intermediaries. Stepless's `X402API.sol` contract implements on-chain billing for API queries, with support for both per-query payments and monthly subscriptions. This is the revenue engine that funds the reward pool.

### Circle Gas Station

The Circle Gas Station automatically sponsors transaction fees for Smart Contract Account (SCA) wallets on Arc Testnet. This is the single most important feature for Stepless's contributor onboarding:

- Contributors are people with disabilities, many with no crypto experience
- A $0.10 reward is meaningless if the contributor must pay $0.01+ in gas
- With Gas Station, contributors log in via social auth (Crossmint/Dynamic), receive an SCA wallet, and **never need to hold or understand crypto to participate**
- Gas Station is transparent to the contract — no special code needed, the sponsorship happens at the account layer

### CCTP Cross-Chain

Circle's Cross-Chain Transfer Protocol (CCTP) enables USDC to move between Arc and other chains (Ethereum, Solana, Base, Arbitrum) with native burning and minting. This means:
- API consumers on any chain can pay for Stepless data using their native USDC
- Contributors can withdraw earnings to any chain via CCTP
- Future integration with offramps (PIX in Brazil, M-Pesa in Kenya, UPI in India) via CCTP bridges to local payment rails

### Multi-Currency: EURC and QCAD

Arc supports Circle's multi-currency stablecoins. A contributor in Montréal could earn in QCAD; a contributor in Paris in EURC. This eliminates FX friction and makes the platform feel native in every market — critical for adoption in the Global South and Europe.

### Arc-Specific Features Used

| Feature | How Stepless Uses It |
|---|---|
| **Memo contract** (`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`) | Attaches structured metadata to location registrations — emits Memo events with sequential indices, indexable by Goldsky |
| **Multicall3From** | Batches multiple contribution registrations in a single transaction — reduces gas for bulk mapping sessions |
| **EIP-7708 Transfer events** | Standardized USDC transfer events enable reliable reward payment tracking and treasury accounting |
| **USDC native + ERC-20 dual interface** | Contracts use ERC-20 (6 decimals) for intuitive amounts; native interface available for gas payments |
| **PREVRANDAO returns 0** | No on-chain randomness — verifier selection uses off-chain pseudo-random with `block.number` as entropy seed |
| **block.timestamp non-strictly-increasing** | All ordering uses `block.number` instead of timestamps |
| **SELFDESTRUCT unavailable** | Contracts avoid SELFDESTRUCT entirely — treasury withdrawal uses clean ERC-20 transfers |

---

## 5. Technical Architecture

### Smart Contracts (Solidity ^0.8.24, Foundry)

Three contracts form the Stepless protocol, deployed on Arc Testnet:

#### SteplessOracle.sol
The on-chain accessibility oracle. Registers location data, manages the verification lifecycle, and stores location hashes with contributor attribution.

- **Key functions:** `registerLocation()`, `verifyContribution()`, `getLocation()`, `locationCount()`
- **Arc integration:** Uses Memo contract for structured metadata attachment; `block.number` for ordering
- **Data model:** `bytes32 locationHash` (geohash-based, deterministic) → location record with contributor, registration block, verification count
- **Access control:** Admin-governed authorized callers for backend integration; circular dependency with RewardDistributor resolved via `setRewardDistributor()`

#### RewardDistributor.sol
Distributes micro-USDC rewards to contributors and verifiers. The economic engine of the protocol.

- **Reward types:** `NEW_LOCATION` ($0.10), `VERIFICATION` ($0.05), `PHOTO` ($0.02), `UPDATE` ($0.03), `MONTHLY_BONUS` ($5.00)
- **Treasury model:** Admin funds the contract with USDC; rewards are claimed per verified contribution
- **Safety:** All USDC transfers use try/catch (native USDC can revert even with sufficient balance due to blocklist, zero address, burn, or drain-empty-account edge cases); `RewardFailed` events emitted on transfer failure
- **Verifier slashing:** Registered verifiers can be slashed for fraudulent verifications
- **Cooldown system:** Prevents rapid-fire verification spam
- **Pause mechanism:** Admin can pause reward distribution in emergencies

#### X402API.sol
API billing via x402 nanopayments. Charges consumers per query or via monthly subscriptions.

- **Per-query billing:** `payPerQuery()` — consumer pays USDC for a single location query
- **Subscriptions:** `subscribe()` — monthly plans with on-chain start/end blocks
- **Revenue management:** `withdrawRevenue()` — admin can withdraw accumulated API revenue to fund rewards
- **Integration:** Works with Circle Gateway batched settlement (off-chain) for high-throughput API scenarios

### Goldsky Subgraph Indexing

All events from the three contracts are indexed via a Goldsky subgraph, providing a GraphQL API for the frontend, mobile app, and external consumers.

**Schema entities:**

| Entity | Purpose |
|---|---|
| `Location` | Indexed location records with contributor and verification data |
| `Contribution` | Individual contributions (new location, verification, photo, update) |
| `Contributor` | Aggregated contributor profiles with total earned, contribution count |
| `RewardPayment` | Every USDC reward payment with tx hash and block number |
| `TreasuryEvent` | Fund and withdrawal events for transparent treasury accounting |
| `APIQuery` | Every API query with consumer, fee paid, and query type |
| `Subscription` | Active API subscriptions with plan and billing period |
| `VerifierEvent` | Verifier registrations and slashing events |

### IPFS/Arweave Photo Storage

Accessibility data requires photographic evidence — a photo of a ramp, restroom, or parking spot. Photos are stored on IPFS/Arweave with content hashes anchored on-chain:

1. Contributor takes a photo in the mobile app
2. Photo is uploaded to IPFS (pinned via Pinata or similar) and backed up to Arweave (permanent storage)
3. The IPFS CID / Arweave TX ID is stored as a `bytes32 dataHash` in the contribution record on-chain
4. The Arc Memo contract attaches the hash as structured metadata
5. API consumers can retrieve photos via IPFS gateways or Arweave gateways

This ensures data permanence (Arweave) and availability (IPFS) while keeping on-chain storage costs minimal.

### Circle Gas Station Integration

Contributors interact with Stepless through Smart Contract Account (SCA) wallets created via Circle Dev-Controlled Wallets. The Gas Station automatically sponsors transaction fees for these wallets on Arc Testnet:

1. Contributor signs in via social login (Crossmint or Dynamic)
2. An embedded SCA wallet is created via Circle SDK
3. All transactions from this wallet have gas sponsored by Gas Station
4. The contributor never sees, holds, or thinks about gas
5. Contract code is unchanged — sponsorship is transparent at the account layer

**Prerequisites configured:**
- Circle Developer Account with API Key and Entity Secret
- Circle SDK (`@circle-fin/wallets`) integrated in frontend/backend
- Gas Station enabled for Arc Testnet SCA wallets

### Frontend (dApp)

- **Stack:** React + Viem/ethers.js + Tailwind CSS
- **Wallet:** Crossmint / Dynamic for social login + embedded wallets
- **Features:** Map interface (Leaflet/MapLibre), contribution forms, contributor dashboard, verifier queue
- **Accessibility:** WCAG AA compliant, screen-reader tested, keyboard navigation, high-contrast mode
- **i18n:** PT-BR, EN, ES (extensible to FR, DE, JP)

### Mobile App (React Native)

- **Stack:** React Native + Expo + Viem
- **Features:** Location-aware mapping (GPS), camera integration for photos, offline-first contribution queue, push notifications for verification requests
- **Wallet:** Same Crossmint/Dynamic embedded wallet as web
- **Accessibility:** VoiceOver/TalkBack compatible, dynamic font sizing, reduced motion support

### Architecture Diagram

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│   Web dApp       │   │  Mobile App      │   │  API Consumers   │
│  (React + Viem)  │   │ (React Native)   │   │ (Travel/City/Mob)│
└────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘
         │                      │                      │
         └──────────┬───────────┘                      │
                    ▼                                  │
         ┌─────────────────────┐                       │
         │  Crossmint/Dynamic  │                       │
         │  (Social Login +    │                       │
         │   Embedded Wallets) │                       │
         └────────┬────────────┘                       │
                  │                                    │
                  ▼                                    │
         ┌─────────────────────┐                       │
         │  Circle Gas Station │                       │
         │  (Sponsors gas for  │                       │
         │   SCA wallets)      │                       │
         └────────┬────────────┘                       │
                  │                                    │
                  ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                     Arc Testnet (L1)                         │
│                                                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│  │ SteplessOracle  │◄─┤RewardDistributor │  │  X402API    │ │
│  │     .sol        │  │      .sol        │  │    .sol     │ │
│  │                 │  │                  │  │             │ │
│  │ • registerLoc   │  │ • payReward      │  │ • payPerQry │ │
│  │ • verifyContrib │  │ • fundTreasury   │  │ • subscribe │ │
│  │ • Memo contract │  │ • slashVerifier  │  │ • withdraw  │ │
│  └─────────────────┘  └──────────────────┘  └─────────────┘ │
│                                                              │
│  USDC (native + ERC-20) · Memo · Multicall3From · EIP-7708  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
    ┌──────────────┐ ┌──────────┐ ┌──────────────┐
    │   Goldsky    │ │IPFS/     │ │  ArcScan     │
    │   Subgraph   │ │Arweave   │ │  Explorer    │
    │   (GraphQL)  │ │(Photos)  │ │              │
    └──────────────┘ └──────────┘ └──────────────┘
```

---

## 6. Traction & Roadmap

### Current Status — Phase 1: Foundation (In Progress)

| Milestone | Status |
|---|---|
| SteplessOracle.sol — designed and implemented | ✅ Complete |
| RewardDistributor.sol — designed and implemented | ✅ Complete |
| X402API.sol — designed and implemented | ✅ Complete |
| Arc-specific adaptations (Memo, block.number ordering, USDC dual interface, try/catch transfers) | ✅ Complete |
| Goldsky subgraph schema defined (8 entity types) | ✅ Complete |
| Circle Gas Station integration documented | ✅ Complete |
| Foundry project structure with test framework | ✅ Complete |
| Contracts deployed to Arc Testnet | 🔄 In Progress |
| Frontend dApp | 🔄 In Progress |
| Mobile app (React Native) | 🔄 In Progress |
| IPFS/Arweave photo storage integration | 🔄 In Progress |

### Roadmap

#### Phase 1: Foundation (Q2 2025) — Current
- Smart contract development and testing (Foundry)
- Goldsky subgraph deployment
- Gas Station integration with Circle Dev-Controlled Wallets
- Frontend dApp MVP (map, contribution, dashboard)
- Mobile app MVP (React Native, GPS, camera)
- IPFS/Arweave photo storage pipeline
- **Target:** 100 locations mapped on Arc Testnet by internal team

#### Phase 2: Public Beta (Q3 2025)
- Public launch in São Paulo, Brazil (pilot city)
- Onboard 500 contributors via community partnerships
- Integrate with 1–2 municipal accessibility programs
- Launch API with x402 billing for early consumer partners
- Bug bounty program for smart contracts
- **Target:** 10,000 locations mapped, 500 active contributors

#### Phase 3: Mainnet Launch (Q4 2025)
- Arc Mainnet deployment (pending mainnet availability)
- Professional smart contract audit (grant-funded)
- Expand to Rio de Janeiro, Brasília, and Lima
- Launch subscription API tiers for enterprise consumers
- Partnership with 1 major travel or mobility platform
- **Target:** 50,000 locations mapped, 2,000 active contributors, 5 API consumers

#### Phase 4: Scale (2026)
- Expand to Mexico City, Bogotá, Buenos Aires, Madrid, Lisbon
- Add EURC rewards for European markets
- Integrate with government open-data portals (bidirectional sync)
- Launch contributor reputation system with on-chain attestations
- Mobile app v2 with offline-first architecture
- **Target:** 500,000 locations mapped, 10,000 active contributors, 20 API consumers

### Long-Term Vision

By 2027, Stepless aims to be the **global standard for accessibility data** — a decentralized oracle consumed by every major mapping, travel, and mobility platform. The protocol's open-source nature means any city, NGO, or developer can build on top of it. The reward mechanism ensures continuous data freshness as locations change. The x402 revenue model ensures the protocol is self-sustaining without dependence on grants or donations.

---

## 7. Team

> **Note:** Team information will be completed before submission. Below is the placeholder structure.

### Core Team

| Role | Name | Background |
|---|---|---|
| **Project Lead & Smart Contract Developer** | Antonio Carlos | _[Add: years of experience, relevant projects, Solidity background]_ |
| **Frontend Developer** | _[To be added]_ | _[Add: React/Web3 experience]_ |
| **Mobile Developer** | _[To be added]_ | _[Add: React Native experience]_ |
| **Accessibility Consultant** | _[To be added]_ | _[Add: WCAG expertise, disability advocacy background]_ |
| **Community Manager (Brazil)** | _[To be added]_ | _[Add: community building, disability rights experience]_ |

### Advisors (To Be Confirmed)

- _[Accessibility rights organization representative]_
- _[Arc/Circle ecosystem advisor]_
- _[Local government partner in São Paulo]_

### Why This Team

Stepless is being built in Brazil, home to 46 million people with disabilities and the world's 4th-largest DeFi community. The team combines blockchain development experience with deep roots in the Brazilian accessibility community. Our launch market (São Paulo) has both the technical infrastructure and the accessibility advocacy ecosystem to support rapid adoption.

---

## 8. Budget Breakdown

### Requested Grant Amount: $75,000 USDC

| Category | Amount (USDC) | % | Description |
|---|---|---|---|
| **Smart Contract Audit** | $20,000 | 27% | Professional audit by a recognized firm (e.g., Trail of Bits, OpenZeppelin, Spearbit) covering all 3 contracts. Includes remediation review and public audit report. Critical for mainnet deployment and API consumer trust. |
| **Frontend Development** | $12,000 | 16% | React dApp: map interface, contribution forms, contributor dashboard, verifier queue, i18n (PT-BR/EN/ES), WCAG AA compliance, Crossmint/Dynamic wallet integration. ~8 weeks of development. |
| **Mobile App Development** | $12,000 | 16% | React Native app: GPS-based mapping, camera integration, offline-first queue, push notifications, VoiceOver/TalkBack accessibility. ~8 weeks of development. |
| **Goldsky Subgraph Indexing** | $5,000 | 7% | Subgraph deployment, indexing infrastructure, GraphQL API hosting for 12 months. Covers indexing all 3 contracts' events across testnet and mainnet. |
| **IPFS/Arweave Storage** | $4,000 | 5% | IPFS pinning service (Pinata) + Arweave permanent storage for accessibility photos. Estimated 50,000 photos in Year 1 at ~$0.08/photo (Arweave) + pinning costs. |
| **Legal & Compliance** | $6,000 | 8% | Terms of service, privacy policy (GDPR/LGPD compliant), data licensing agreements for API consumers, open-source license review, entity formation. |
| **Marketing & Community** | $10,000 | 13% | Community building in São Paulo: partnerships with disability rights organizations (e.g., AACD, Vagas para Todos), contributor onboarding events, social media, documentation, contributor hackathons. |
| **Contingency (10%)** | $6,000 | 8% | Buffer for unexpected costs, additional audit findings, or scope adjustments. |
| **Total** | **$75,000** | **100%** | |

### Use of Funds Timeline

| Quarter | Milestone | Funds Deployed |
|---|---|---|
| Q3 2025 | Audit initiated, frontend + mobile MVPs complete | $35,000 |
| Q3 2025 | Goldsky + IPFS infrastructure live, legal framework | $15,000 |
| Q4 2025 | Audit complete, mainnet deployment, community launch | $25,000 |

### Post-Grant Sustainability

The grant funds the path to self-sustainability. Once the API launches with paying consumers, the x402 revenue model funds the reward pool. The protocol does not require ongoing grant support — it requires initial capital to cross the chasm from testnet to mainnet with audited contracts and a polished user experience.

---

## 9. Impact Metrics

### Key Performance Indicators (KPIs)

#### Contributor Metrics

| KPI | Year 1 Target | Year 3 Target |
|---|---|---|
| Active contributors (monthly) | 2,000 | 50,000 |
| Total registered contributors | 5,000 | 200,000 |
| Contributions per contributor (avg/month) | 8 | 12 |
| USDC distributed in rewards | $50,000 | $2,000,000 |
| Countries with active contributors | 3 | 20 |

#### Data Metrics

| KPI | Year 1 Target | Year 3 Target |
|---|---|---|
| Locations mapped | 50,000 | 5,000,000 |
| Verified locations (≥1 verification) | 25,000 | 3,000,000 |
| Photos stored (IPFS/Arweave) | 100,000 | 10,000,000 |
| Data freshness (avg. last update) | < 6 months | < 3 months |
| Geographic coverage (cities) | 5 | 100 |

#### API & Revenue Metrics

| KPI | Year 1 Target | Year 3 Target |
|---|---|---|
| API consumers (apps/platforms) | 5 | 50 |
| API queries per month | 100,000 | 10,000,000 |
| Monthly API revenue (USDC) | $5,000 | $500,000 |
| Revenue-to-reward ratio | 1:10 (grant-subsidized) | 1:1 (self-sustaining) |

#### Social Impact Metrics

| KPI | Year 1 Target | Year 3 Target |
|---|---|---|
| Municipalities partnered | 2 | 25 |
| People benefiting from data (end users) | 100,000 | 10,000,000 |
| Accessibility improvements triggered* | 50 | 1,000 |
| Open-source contributors (GitHub) | 10 | 100 |

*Locations where Stepless data revealed accessibility gaps that were subsequently addressed by the property owner or municipality.

### Measurement & Transparency

All metrics are **on-chain and verifiable**:
- Locations mapped → `SteplessOracle.locationCount()`
- USDC distributed → `RewardDistributor` treasury events (indexed by Goldsky)
- API queries → `X402API` query events (indexed by Goldsky)
- Contributors → unique addresses with ≥1 reward payment
- A public dashboard (Goldsky-powered) will display real-time protocol metrics

---

## 10. Sustainability

### Revenue Model

Stepless generates revenue through two channels:

#### 1. Per-Query Payments (x402 Nanopayments)
API consumers pay per query via the x402 protocol. Each query to the Stepless API triggers an on-chain payment in USDC.

| Query Type | Price (USDC) | Use Case |
|---|---|---|
| Single location lookup | $0.001 | App checks one location |
| Radius search (10 locations) | $0.005 | App finds accessible spots nearby |
| City-wide export | $0.50 | City government bulk export |
| Full dataset access (per city) | $50.00 | Enterprise/mobility platform |

#### 2. Monthly Subscriptions
For high-volume consumers, on-chain subscription plans offer better economics:

| Plan | Price (USDC/month) | Queries/month | Target Customer |
|---|---|---|---|
| Starter | $100 | 50,000 | Small travel app |
| Business | $500 | 500,000 | Mid-size mobility platform |
| Enterprise | $2,000 | Unlimited | City government / major platform |

### The Self-Sustaining Loop

```
API Consumers pay (x402 + subscriptions)
         │
         ▼
   X402API.sol collects USDC
         │
         ▼
   Protocol Treasury
         │
         ▼
   RewardDistributor.sol funds rewards
         │
         ▼
   Contributors earn USDC → more locations mapped
         │
         ▼
   More data → more API consumers → more revenue
         │
         ▼
   ↻ Self-sustaining flywheel
```

### Path to Self-Sustainability

| Phase | Timeline | Revenue Source | Reward Funding |
|---|---|---|---|
| **Launch** | Q4 2025 | Grant + early API revenue | 90% grant, 10% revenue |
| **Growth** | Q2 2026 | API revenue + subscriptions | 50% grant, 50% revenue |
| **Sustainability** | Q4 2026 | API revenue + subscriptions | 100% revenue |
| **Surplus** | 2027+ | API revenue + subscriptions | Revenue funds expansion + treasury reserve |

### Unit Economics

At scale, the economics are compelling:

- **Cost per location mapped:** ~$0.15 (reward + verification + photo)
- **Revenue per location (lifetime):** ~$2.00 (queried ~2,000 times at $0.001/query)
- **Gross margin per location:** ~92%
- **Break-even point:** ~25,000 locations mapped with 5 active API consumers

### Decentralization & Governance

The protocol is designed for progressive decentralization:
- **Phase 1–2:** Admin-controlled (team multisig) for rapid iteration
- **Phase 3:** Community DAO for parameter adjustment (reward amounts, API pricing, verifier slashing thresholds)
- **Phase 4:** Fully decentralized governance with on-chain voting

---

## 11. Alignment with Circle's Mission

### Circle's Vision

Circle's mission is to **raise global economic prosperity through the frictionless exchange of value** — building an internet-native financial system where money moves as easily as data. Stepless embodies this mission in three concrete ways:

### 1. Stablecoin Adoption Through Real Utility

Stepless creates organic USDC demand from two populations that have no reason to use crypto today:

- **Contributors** (people with disabilities, many unbanked) earn USDC for real work — mapping their communities. They don't need to understand blockchain; they need to understand that mapping a ramp earns them money. USDC is the medium, not the message.
- **API consumers** (travel apps, city governments, mobility platforms) pay in USDC because that's what the protocol requires. They're buying data, not speculating on crypto.

This is **stablecoin adoption driven by utility, not speculation** — exactly the use case Circle has championed.

### 2. Financial Inclusion for the Unbanked

80% of people with disabilities live in the Global South, where banking penetration is low. Stepless onboards them into the stablecoin economy through:

- **Social login wallets** (no KYC barrier for micro-rewards, no bank account needed)
- **Gas Station sponsorship** (no crypto knowledge required to transact)
- **USDC rewards** (stable value, no volatility risk)
- **CCTP offramp pathways** (future: withdraw to PIX in Brazil, M-Pesa in Kenya, UPI in India)

A wheelchair user in a São Paulo favela who maps 50 accessible locations per month earns ~$10 USDC — meaningful income in a region where the minimum wage is ~$280/month. This is **financial inclusion through productive participation**, not aid.

### 3. Public Goods Funded by Markets

Accessibility data is a textbook public good — non-rivalrous, non-excludable, and chronically underfunded by markets alone. Stepless turns it into a **market-funded public good** by creating a two-sided marketplace:

- Contributors supply data (funded by rewards)
- Consumers demand data (paying via x402)
- The protocol captures the spread

This demonstrates that **stablecoin micropayments can fund real-world public goods** — a thesis that extends far beyond accessibility. If Stepless works, the same pattern can fund air quality monitoring, pothole reporting, food safety data, and any domain where micro-contributions aggregate into valuable datasets.

### Alignment with Arc Ecosystem

Stepless is a showcase for Arc's unique capabilities:

| Arc Feature | Stepless Use Case | Ecosystem Value |
|---|---|---|
| USDC native gas | Micro-rewards ($0.02–$5.00) | Proves sub-cent payment viability |
| Gas Station | Gasless contributor onboarding | Demonstrates zero-friction UX |
| x402 | API billing per query | Real-world x402 production use |
| CCTP | Cross-chain USDC for API consumers | Multi-chain payment interoperability |
| EURC/QCAD | Multi-currency rewards | Global market expansion |
| Memo contract | Structured on-chain metadata | Novel use of Arc predeploys |
| Goldsky indexing | Real-time GraphQL API | Subgraph ecosystem growth |

Stepless would be one of the **first production applications on Arc** that demonstrates the full stack: native USDC, Gas Station, x402, CCTP, and multi-currency stablecoins — all solving a real-world problem for a billion-person market.

---

## 12. Open Source Commitment

### License

Stepless is released under the **MIT License** — one of the most permissive open-source licenses. All smart contracts, frontend code, mobile app, subgraph definitions, and documentation are open source.

### Repository

**GitHub:** [github.com/Acarlosr/Stepless](https://github.com/Acarlosr/Stepless)

The repository contains:
- `contracts/` — Solidity smart contracts with Foundry test framework
- `frontend/` — React dApp
- `mobile/` — React Native app
- `subgraph/` — Goldsky subgraph schema and mappings
- `docs/` — Architecture documentation, Gas Station integration guide, grant application

### Contributing

Stepless welcomes community contributions. The project will maintain:

- **CONTRIBUTING.md** — contribution guidelines, code style, PR process
- **Code of Conduct** — inclusive and respectful community standards
- **Good First Issues** — labeled issues for new contributors
- **Developer documentation** — setup guides, contract architecture, subgraph deployment
- **Bounty program** — USDC bounties for community contributions (funded from protocol treasury)

### Open Data

The accessibility data itself is **open by design**:
- All location data is on-chain (publicly readable)
- Photo hashes are on-chain (photos retrievable via IPFS/Arweave gateways)
- The Goldsky subgraph provides a free GraphQL endpoint for basic queries
- Paid API access is for higher-rate, SLA-backed consumption — not for gating the data itself

### Reproducibility

- All contracts are verifiable on ArcScan (`https://testnet.arcscan.app`)
- Deploy scripts are included in `contracts/script/`
- Foundry tests reproduce all contract behavior
- Subgraph deployment is reproducible from `subgraph/subgraph.yaml`

### Why Open Source

Accessibility data is a public good. Locking it behind proprietary licenses would reproduce the exact problem Stepless is solving — centralized control of information that should be freely available. By open-sourcing everything, Stepless ensures:

- Any city can self-host the protocol
- Any developer can build alternative frontends
- Any researcher can access the data
- Any community can fork and adapt for their region
- The protocol survives even if the original team moves on

---

## Appendix A: Contract Addresses (Arc Testnet)

> Contracts are being deployed to Arc Testnet. Addresses will be populated here upon deployment.

| Contract | Address | ArcScan |
|---|---|---|
| SteplessOracle.sol | _[To be populated]_ | _[Link]_ |
| RewardDistributor.sol | _[To be populated]_ | _[Link]_ |
| X402API.sol | _[To be populated]_ | _[Link]_ |

**Arc Memo Contract:** `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`  
**ArcScan Explorer:** `https://testnet.arcscan.app`

---

## Appendix B: Reward Calculation Examples

| Scenario | Calculation | Total USDC |
|---|---|---|
| Contributor maps 1 new location with 1 photo | $0.10 (new) + $0.02 (photo) | $0.12 |
| Verifier confirms 1 location | $0.05 (verification) | $0.05 |
| Contributor maps 10 locations with photos + 5 are verified | 10×($0.10+$0.02) + 5×$0.05 | $1.45 |
| Top contributor (50 locations, 20 photos, 30 verifications) + monthly bonus | 50×$0.10 + 20×$0.02 + 30×$0.05 + $5.00 | $12.40 |
| API consumer queries 1,000 locations | 1,000 × $0.001 | $1.00 |
| City government monthly subscription | Business plan | $500.00 |

---

## Appendix C: References

- **Arc Documentation:** Circle's stablecoin-native L1 developer docs
- **Circle Gas Station:** SCA wallet gas sponsorship on Arc Testnet
- **x402 Protocol:** HTTP 402 nanopayment standard
- **CCTP:** Cross-Chain Transfer Protocol for USDC bridging
- **Goldsky:** Subgraph indexing and GraphQL API hosting
- **Crossmint / Dynamic:** Social login + embedded wallet providers
- **IPFS / Arweave:** Decentralized permanent storage for accessibility photos
- **WHO Disability Report:** 1.3 billion people (16% of global population) experience significant disability
- **WCAG 2.1 AA:** Web Content Accessibility Guidelines compliance standard

---

*Stepless is committed to building a more accessible world — one mapped location at a time. We believe Arc and USDC make this economically viable for the first time in history, and we invite Circle to partner with us in proving that stablecoin micropayments can fund global public goods.*

**License:** MIT  
**Repository:** [github.com/Acarlosr/Stepless](https://github.com/Acarlosr/Stepless)  
**Contact:** senacarlos@gmail.com
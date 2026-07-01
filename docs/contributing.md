# Contributing to Stepless

Thank you for your interest in contributing to Stepless! This guide covers everything you need to get started — from translations to smart contracts to mobile development.

Stepless is decentralized accessibility infrastructure powered by USDC micropayments on Arc. We welcome contributions from everyone, especially people with accessibility needs, multilingual contributors, and Arc ecosystem developers.

---

## Table of Contents

- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Arc Testnet Setup](#arc-testnet-setup)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Testing Requirements](#testing-requirements)
- [Security Considerations](#security-considerations)
- [Community](#community)
- [Areas Needing Help](#areas-needing-help)

---

## How to Contribute

### 1. Translations (i18n)

Stepless supports multiple languages so accessibility data is useful globally. We need translators for:

- **French (FR)** — `frontend/public/locales/fr/`
- **German (DE)** — `frontend/public/locales/de/`
- **Japanese (JP)** — `frontend/public/locales/jp/`

Translation files are JSON key-value pairs. To add a language:

1. Copy `frontend/public/locales/en/translation.json` to a new folder (e.g., `fr/`)
2. Translate all values (keep keys unchanged)
3. Add the locale code to `frontend/src/i18n.ts`
4. Test in the dashboard: switch language in the UI

### 2. Mapping Locations

Help us build the accessibility map:

- Use the mobile app to photograph and submit accessible locations (ramps, braille signage, audio signals, accessible restrooms)
- Each submission goes to IPFS and is recorded on-chain via SteplessOracle
- Verified submissions earn USDC rewards on Arc

### 3. Smart Contracts

Contribute to the core protocol:

- Bug fixes and gas optimizations in `src/`
- New test cases in `test/` (unit, fuzz, invariant)
- Arc-specific handling (USDC decimals, blocklist, event indexing)
- Always run `forge test` before submitting a PR

### 4. Mobile App

Improve the React Native field app:

- Camera capture and EXIF stripping
- Offline submission queueing
- Map rendering performance
- Accessibility features within the app itself (VoiceOver/TalkAway support)

### 5. UX/UI Design

Help make Stepless accessible by design:

- WCAG 2.1 AA compliance review
- Color contrast, focus indicators, screen reader labels
- Mobile-first responsive layouts
- Dark mode support

---

## Development Setup

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Foundry | Latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| npm | 10+ | Included with Node.js |
| Expo CLI | Latest | `npm install -g expo-cli` |
| Git | 2.40+ | [git-scm.com](https://git-scm.com/) |

### Smart Contracts (Foundry)

```bash
git clone https://github.com/stepless/stepless.git
cd stepless

# Install Foundry dependencies (OpenZeppelin, forge-std)
forge install

# Compile contracts
forge build

# Run tests
forge test

# Run tests with verbose output
forge test -vvv

# Run fuzz tests with more runs
forge test --fuzz-runs 10000

# Run invariant tests
forge test --invariant
```

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev      # Start dev server (http://localhost:5173)
npm run build    # Production build
npm run preview  # Preview production build
```

### Mobile App (React Native + Expo)

```bash
cd mobile
npm install
npx expo start   # Start Expo dev server

# Run on device
npx expo run:ios     # iOS simulator
npx expo run:android # Android emulator
```

### Subgraph (Goldsky)

```bash
cd subgraph
npm install
npx graph codegen   # Generate TypeScript types
npx graph build     # Build subgraph
```

---

## Arc Testnet Setup

### 1. Get Testnet USDC

Visit the [Circle Faucet](https://faucet.circle.com) and request testnet USDC. You'll need it for:

- Deploying contracts (gas is paid in USDC on Arc)
- Funding the RewardDistributor treasury
- Testing reward claims

### 2. Configure Your Wallet

Add Arc Testnet to your wallet (MetaMask, Rabby, etc.):

| Setting | Value |
|---|---|
| **Network Name** | Arc Testnet |
| **RPC URL** | `https://testnet.arc1.network/rpc` |
| **Chain ID** | _(check [arc.network](https://arc.network) for current ID)_ |
| **Currency Symbol** | USDC |
| **Block Explorer** | [testnet.arcscan.app](https://testnet.arcscan.app) |

### 3. Generate a Development Wallet

```bash
# Generate a new wallet
cast wallet new

# Or import an existing private key
cast wallet address --private-key $PRIVATE_KEY
```

### 4. Configure .env

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Arc Testnet RPC
ARC_TESTNET_RPC_URL=https://testnet.arc1.network/rpc

# Your wallet private key (NEVER commit this)
PRIVATE_KEY=0x...  # Use `cast wallet new` to generate

# Admin address (for contract admin role)
ADMIN_ADDRESS=0x...
```

### 5. Verify Connection

```bash
# Check block number
cast block-number --rpc-url $ARC_TESTNET_RPC_URL

# Check your USDC balance
cast balance $ADMIN_ADDRESS --rpc-url $ARC_TESTNET_RPC_URL
```

---

## Code Style

### Solidity

- **Version**: 0.8.24 (do not downgrade without discussion)
- **Style**: Follow the [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- **Formatting**: Run `forge fmt` before committing
- **Naming**:
  - Contracts: `PascalCase` (e.g., `RewardDistributor`)
  - Functions: `camelCase` (e.g., `claimReward`)
  - Events: `PascalCase` (e.g., `RewardClaimed`)
  - Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_REWARD_AMOUNT`)
  - Storage variables: `camelCase` with leading underscore for internal (e.g., `_treasuryBalance`)
- **Comments**: Use NatSpec for all public functions
- **USDC**: Always use 6 decimals — never hardcode `1e18` for USDC amounts

```solidity
/// @notice Claims a reward for a verified submission
/// @param contributor The address receiving the USDC reward
/// @param amount Reward amount in USDC base units (6 decimals)
/// @param submissionId Hash of the submission being rewarded
function claimReward(address contributor, uint256 amount, bytes32 submissionId) external onlyVerifier {
    // ...
}
```

### TypeScript

- **Style**: ESLint + Prettier (configs in each package)
- **Types**: Strict mode — no `any` without justification
- **Imports**: Use absolute imports within each package
- **Naming**: `camelCase` for variables/functions, `PascalCase` for components/types

### CSS

- **Framework**: Tailwind CSS
- **Dark mode**: All components must support `dark:` variants
- **Accessibility**: WCAG 2.1 AA — minimum 4.5:1 contrast ratio for text
- **Responsive**: Mobile-first, use `sm:` and `md:` breakpoints

---

## Pull Request Process

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Write tests** for your changes. All PRs must pass:
   ```bash
   forge test              # Smart contracts
   cd frontend && npm run lint && npm run build  # Frontend
   ```

3. **Run formatting**:
   ```bash
   forge fmt               # Solidity
   cd frontend && npm run format  # Frontend
   ```

4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat(reward): add batch claim function"
   git commit -m "fix(oracle): correct verifier removal event"
   git commit -m "docs: update deployment guide"
   git commit -m "test(reward): add fuzz test for claimReward"
   ```

5. **Open a PR** with:
   - Clear title following conventional commits
   - Description of what changed and why
   - Link to any related issues
   - Screenshots for UI changes
   - Test output showing all tests pass

6. **Address review feedback** — respond to comments, push fixes, re-request review.

7. **Squash merge** — PRs are squash-merged to keep history clean.

### PR Checklist

- [ ] Code follows style guidelines (`forge fmt`, `npm run format`)
- [ ] Tests pass (`forge test`, `npm run lint`)
- [ ] New functions have NatSpec/TSDoc comments
- [ ] No hardcoded addresses or private keys
- [ ] USDC amounts use 6 decimals (not 18)
- [ ] UI changes support dark mode and WCAG AA
- [ ] No new warnings or errors in CI

---

## Testing Requirements

### Smart Contract Tests

All smart contract PRs must include:

1. **Unit tests** — Test each function individually, including revert cases
2. **Fuzz tests** — Use `forge test --fuzz-runs 10000` for numeric inputs
3. **Invariant tests** — For stateful properties (e.g., "treasury balance never goes negative")

```bash
# Run all tests
forge test

# Run with verbose tracing
forge test -vvv

# Run specific test file
forge test --match-path test/RewardDistributor.t.sol

# Run fuzz tests with more runs
forge test --fuzz-runs 10000

# Run invariant tests
forge test --invariant

# Generate test coverage
forge coverage
```

### Arc RPC Integration Tests

Integration tests run against a live Arc Testnet RPC. These are marked with `@dev` and run manually:

```bash
# Set up environment
source .env

# Run integration tests against Arc Testnet
forge test --match-contract ArcIntegrationTest --fork-url $ARC_TESTNET_RPC_URL
```

### Frontend Tests

```bash
cd frontend
npm run lint       # ESLint
npm run build      # TypeScript type checking + build
```

### Subgraph Tests

```bash
cd subgraph
npx graph codegen  # Type generation must succeed
npx graph build    # Build must succeed
```

---

## Security Considerations

Stepless handles real USDC value. All contributors must be aware of these Arc-specific security considerations:

### USDC Decimal Handling

**USDC uses 6 decimals, not 18.** This is the single most common source of bugs:

```solidity
// ❌ WRONG — treats USDC like ETH (18 decimals)
uint256 reward = 1 ether; // = 1e18, but USDC has 6 decimals

// ✅ CORRECT — use 6 decimals
uint256 reward = 1e6; // = 1 USDC
uint256 reward = 1 * 10 ** 6; // explicit
```

Always validate decimal assumptions in tests. Never use `ether` keyword for USDC amounts.

### USDC Blocklist

USDC has a blocklist functionality. The USDC contract can `blocklist(address)` and `unblocklist(address)`. If a recipient is blocklisted, transfers revert. Stepless contracts must handle this:

```solidity
// Always check for blocklist reverts on USDC transfers
require(usdc.transfer(contributor, amount), "USDC transfer failed — check blocklist");
```

Consider adding a rescue function for rewards that fail to send due to blocklisted recipients.

### SELFDESTRUCT Avoidance

Arc may not support `SELFDESTRUCT` in the same way as Ethereum mainnet. Never use `selfdestruct` in Stepless contracts. If you need to deprecate a contract, use a pause + withdrawal pattern instead.

### PREVRANDAO = 0

On Arc, `block.prevrandao` (formerly `DIFFICULTY`) is always 0. Do not use it as a source of randomness. If randomness is needed, use a commit-reveal scheme or an oracle.

### block.number vs block.timestamp

Arc block times differ from Ethereum. Do not assume 12-second blocks. Use `block.timestamp` for time-based logic and test with realistic Arc block intervals.

### EIP-7708 Event Indexing

Arc supports EIP-7708 rich events. Ensure all important event fields are `indexed` for efficient subgraph filtering:

```solidity
event RewardClaimed(
    address indexed contributor,
    uint256 amount,
    bytes32 indexed submissionId,
    address indexed verifier
);
```

### General Solidity Security

- **Reentrancy**: Use Checks-Effects-Interactions pattern. Set `rewardClaimed[submissionId] = true` before the USDC transfer.
- **Access control**: Use OpenZeppelin `AccessControl` or custom `onlyAdmin` / `onlyVerifier` modifiers.
- **Integer overflow**: Solidity 0.8.24 has built-in overflow checks. Do not use `unchecked` without justification.
- **Front-running**: Submission and verification are not front-runnable (no MEV on Arc), but be aware of transaction ordering.

---

## Community

### Arc House

[Arc House](https://discord.gg/archouse) is the Discord community for Arc ecosystem builders. Join to:

- Get help with Arc-specific development questions
- Share your Stepless demos and get feedback
- Connect with Circle DevRel team
- Participate in hackathons and bounty programs

### Architects Program

The [Arc Architects Program](https://arc.network) is an ambassador program with points, tiers, and escalating benefits. Contributing to Stepless counts toward your Architect standing.

See our [Architects Program Guide](architects_program_guide.md) for how to get involved.

### Circle DevRel Office Hours

Circle's Developer Relations team holds bi-weekly office hours. Bring your Arc questions, deployment issues, or integration challenges.

---

## Areas Needing Help

We actively need help in these areas. If you're interested, open an issue or join the Discord:

### 🌍 Translations

| Language | Status | Priority |
|---|---|---|
| French (FR) | Not started | High |
| German (DE) | Not started | High |
| Japanese (JP) | Not started | High |

### 🔒 Smart Contracts

- Fuzz test expansion (target 10,000+ runs per test)
- Invariant tests for RewardDistributor
- Gas optimization (storage packing, batch operations)
- Arc-specific integration tests
- Formal verification (Certora) for critical functions

### 📱 Mobile App

- Offline submission queue with local SQLite
- Camera EXIF stripping on iOS and Android
- Map performance with 10,000+ markers
- Push notifications for reward claims
- VoiceOver/TalkAway accessibility audit

### 🎨 UX/UI

- WCAG 2.1 AA compliance audit
- Screen reader testing (NVDA, VoiceOver, TalkBack)
- Color blindness simulation and fixes
- Keyboard navigation for all dashboard functions
- Dark mode polish

---

<p align="center">
  <strong>Questions? Open an issue or join us in <a href="https://discord.gg/archouse">Arc House</a>.</strong>
</p>
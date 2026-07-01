# Stepless — Pre-Mainnet Security Audit Checklist

This checklist must be completed and signed off before any Stepless contract is deployed to Arc Mainnet. It covers smart contract security, Arc-specific considerations, infrastructure, and compliance.

> **Status legend:** ☐ Not started · 🔄 In progress · ✅ Complete

---

## Table of Contents

- [1. Smart Contract Audit](#1-smart-contract-audit)
- [2. Arc-Specific Checks](#2-arc-specific-checks)
- [3. Access Control Review](#3-access-control-review)
- [4. Reentrancy Review](#4-reentrancy-review)
- [5. Integer Overflow / Underflow](#5-integer-overflow--underflow)
- [6. Gas Optimization Review](#6-gas-optimization-review)
- [7. Multisig Setup for Admin](#7-multisig-setup-for-admin)
- [8. Upgradeability Decision](#8-upgradeability-decision)
- [9. Fuzzing Tests](#9-fuzzing-tests)
- [10. Invariant Tests](#10-invariant-tests)
- [11. Integration Tests Against Arc Testnet](#11-integration-tests-against-arc-testnet)
- [12. Subgraph Security](#12-subgraph-security)
- [13. Frontend Security](#13-frontend-security)
- [14. IPFS Security](#14-ipfs-security)
- [15. Compliance](#15-compliance)

---

## 1. Smart Contract Audit

A professional third-party audit is **mandatory** before mainnet deployment.

### Recommended Audit Firms

| Firm | Specialty | Contact |
|---|---|---|
| **Trail of Bits** | Solidity, DeFi, formal verification | [trailofbits.com](https://www.trailofbits.com) |
| **OpenZeppelin** | Smart contract security, standards | [openzeppelin.com/audit](https://www.openzeppelin.com/audit) |
| **Certora** | Formal verification, invariant proving | [certora.com](https://www.certora.com) |
| **ConsenSys Diligence** | Smart contract audit, DeFi | [consensys.net/diligence](https://consensys.net/diligence) |
| **Spearbit** | Protocol security review | [spearbit.com](https://spearbit.com) |

### Audit Process

- ☐ Select audit firm and scope (all 3 contracts + deploy script)
- ☐ Provide documentation: architecture, threat model, invariants
- ☐ Freeze code (no changes during audit)
- ☐ Receive audit report
- ☐ Remediate all findings (Critical, High, Medium)
- ☐ Acknowledge or accept Low / Informational findings
- ☐ Request re-audit of remediated items
- ☐ Publish audit report publicly
- ☐ Implement monitoring for audited code

### Audit Scope

| Contract | Lines | Complexity | Priority |
|---|---|---|---|
| `RewardDistributor.sol` | ~200 | High (USDC transfers, access control) | Critical |
| `SteplessOracle.sol` | ~180 | Medium (state management, verifier registry) | High |
| `X402API.sol` | ~150 | Medium (payment accounting) | High |
| `Deploy.s.sol` | ~80 | Low (deployment script) | Medium |

---

## 2. Arc-Specific Checks

Arc is a stablecoin-native L1 with different properties from Ethereum. These checks are **non-negotiable**.

### 2.1 USDC Decimal Handling (6 vs 18)

- ☐ No use of `ether` keyword for USDC amounts anywhere in the codebase
- ☐ All USDC amounts use `1e6` or `10**6` multiplier
- ☐ No hardcoded `1e18` values in USDC-related logic
- ☐ Test: `fundTreasury(1e6)` results in exactly 1 USDC
- ☐ Test: `claimReward` with `1e6` transfers exactly 1 USDC
- ☐ Fuzz test: random USDC amounts (0 to 1e12) don't overflow or misallocate
- ☐ Review: reward amount setter enforces reasonable bounds (min 1e4 = 0.01 USDC, max 1e8 = 100 USDC)
- ☐ Review: no intermediate calculations accidentally use 18-decimal math

```solidity
// ✅ CORRECT
uint256 constant ONE_USDC = 1e6;
uint256 reward = ONE_USDC * rewardMultiplier;

// ❌ WRONG
uint256 reward = 1 ether; // This is 1e18, not 1 USDC
```

### 2.2 USDC Blocklist Revert Handling

USDC can blocklist addresses. Transfers to/from blocklisted addresses revert.

- ☐ `claimReward` handles USDC transfer revert gracefully (not just `require`)
- ☐ Failed reward transfers are logged and recoverable (escrow or retry mechanism)
- ☐ Test: mock USDC with blocklist, verify `claimReward` to blocklisted address doesn't brick the contract
- ☐ Test: admin can rescue failed reward transfers
- ☐ Review: no assumption that `usdc.transfer()` always succeeds
- ☐ Consider: use `SafeERC20` from OpenZeppelin for all USDC transfers

```solidity
// ✅ Safe transfer pattern
bool success = usdc.transfer(contributor, amount);
require(success, "USDC transfer failed — recipient may be blocklisted");

// ✅ Better: SafeERC20
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
using SafeERC20 for IERC20;
usdc.safeTransfer(contributor, amount);
```

### 2.3 SELFDESTRUCT Avoidance

- ☐ No `selfdestruct` in any contract
- ☐ No `SELFDESTRUCT` in any dependency (check OpenZeppelin versions)
- ☐ Deprecation pattern uses `pause()` + `withdraw()` instead
- ☐ Test: paused contract rejects all state-changing calls
- ☐ Test: admin can withdraw remaining USDC after pause

### 2.4 PREVRANDAO = 0

- ☐ No use of `block.prevrandao` (formerly `block.difficulty`) for randomness
- ☐ No use of `block.difficulty` anywhere
- ☐ If randomness needed: use commit-reveal scheme or external oracle
- ☐ Test: verify no code path depends on non-zero `prevrandao`

### 2.5 block.number vs block.timestamp

- ☐ Time-based logic uses `block.timestamp` (not `block.number * 12`)
- ☐ No hardcoded block time assumptions (Arc ≠ 12s blocks)
- ☐ Test: time-locks and cooldowns work with Arc Testnet block times
- ☐ Review: any `block.number` usage is for ordering only, not time calculation
- ☐ Document: expected Arc block time in code comments

### 2.6 EIP-7708 Event Indexing

Arc supports EIP-7708 rich events. Ensure proper indexing for subgraph efficiency.

- ☐ All address-type event parameters are `indexed`
- ☐ All `submissionId` (bytes32) event parameters are `indexed`
- ☐ No more than 3 indexed fields per event (EVM limitation)
- ☐ Events match subgraph mapping expectations exactly
- ☐ Test: subgraph can filter by contributor, verifier, submissionId
- ☐ Review: event field names match across contract, subgraph, and frontend

```solidity
// ✅ Properly indexed
event RewardClaimed(
    address indexed contributor,
    uint256 amount,
    bytes32 indexed submissionId,
    address indexed verifier
);

// ❌ Missing indexed fields — subgraph can't filter efficiently
event RewardClaimed(
    address contributor,
    uint256 amount,
    bytes32 submissionId,
    address verifier
);
```

---

## 3. Access Control Review

### 3.1 Admin Role

- ☐ Admin can only be set in constructor (no `setAdmin` function, or requires existing admin)
- ☐ Admin functions: `fundTreasury`, `addVerifier`, `removeVerifier`, `setRewardAmount`, `pause`, `unpause`
- ☐ Admin cannot drain treasury to arbitrary addresses (only fund, not withdraw — or withdrawal requires timelock)
- ☐ Admin role transfer requires 2-step process (propose + accept)
- ☐ Test: non-admin cannot call admin functions
- ☐ Test: admin renounce works (for DAO transition)

### 3.2 Authorized Callers

- ☐ `authorizedCallers` mapping for inter-contract calls (e.g., RewardDistributor → SteplessOracle)
- ☐ Only authorized contracts can call privileged functions
- ☐ `setAuthorizedCaller` requires admin
- ☐ Test: unauthorized contract cannot call privileged functions
- ☐ Test: removing authorization immediately blocks calls

### 3.3 Verifier Role

- ☐ Verifiers can only verify submissions and trigger reward claims — nothing else
- ☐ Verifiers cannot verify their own submissions (conflict of interest)
- ☐ Verifier removal is instant (no delay needed for testnet, consider timelock for mainnet)
- ☐ Test: removed verifier cannot verify submissions
- ☐ Test: verifier cannot claim reward for themselves
- ☐ Review: verifier set size is bounded (gas limits on iteration if any)

### 3.4 Access Control Matrix

| Function | Admin | Verifier | Authorized Caller | Anyone |
|---|---|---|---|---|
| `fundTreasury` | ✅ | ❌ | ❌ | ❌ |
| `addVerifier` | ✅ | ❌ | ❌ | ❌ |
| `removeVerifier` | ✅ | ❌ | ❌ | ❌ |
| `setRewardAmount` | ✅ | ❌ | ❌ | ❌ |
| `claimReward` | ❌ | ✅ | ✅ | ❌ |
| `submitLocation` | ❌ | ❌ | ❌ | ✅ |
| `verifySubmission` | ❌ | ✅ | ❌ | ❌ |
| `pause` | ✅ | ❌ | ❌ | ❌ |
| `unpause` | ✅ | ❌ | ❌ | ❌ |

---

## 4. Reentrancy Review

### 4.1 Checks-Effects-Interactions Pattern

- ☐ `rewardClaimed[submissionId]` is set to `true` **before** USDC transfer
- ☐ State changes (balances, mappings) happen before external calls
- ☐ No external calls before state finalization
- ☐ `nonReentrant` modifier on `claimReward` and `fundTreasury` (defense in depth)

```solidity
// ✅ CORRECT — Checks-Effects-Interactions
function claimReward(address contributor, uint256 amount, bytes32 submissionId) external onlyVerifier nonReentrant {
    require(!rewardClaimed[submissionId], "Already claimed");     // Check
    require(treasuryBalance >= amount, "Insufficient treasury");   // Check
    rewardClaimed[submissionId] = true;                            // Effect
    treasuryBalance -= amount;                                     // Effect
    usdc.safeTransfer(contributor, amount);                        // Interaction
    emit RewardClaimed(contributor, amount, submissionId, msg.sender);
}
```

### 4.2 Reentrancy Test Coverage

- ☐ Test: malicious USDC contract that re-enters `claimReward` during transfer
- ☐ Test: malicious verifier contract that calls back during `claimReward`
- ☐ Fuzz test: reentrancy attempts with various submission IDs
- ☐ Invariant: total distributed + treasury balance == total funded (always)

---

## 5. Integer Overflow / Underflow

### 5.1 Solidity 0.8.24 Built-in Checks

- ☐ Compiler version is exactly `0.8.24` (not floating `^0.8.24`)
- ☐ No use of `unchecked` blocks without documented justification
- ☐ Review every `unchecked` block for safety
- ☐ Test: `treasuryBalance -= amount` reverts when balance < amount
- ☐ Test: reward amount overflow with max uint256
- ☐ Fuzz test: arithmetic operations with boundary values (0, 1, type(uint256).max)

### 5.2 Specific Overflow Scenarios

- ☐ `fundTreasury`: adding to treasury doesn't overflow uint256
- ☐ `claimReward`: subtracting from treasury doesn't underflow
- ☐ `setRewardAmount`: amount is bounded (min/max check)
- ☐ Batch operations: sum of rewards doesn't overflow
- ☐ API payment accumulation in X402API: `ratePerCall * calls` doesn't overflow

---

## 6. Gas Optimization Review

### 6.1 Storage Optimization

- ☐ Pack related storage variables into single slots
- ☐ Use `uint128` / `uint64` where values are bounded (reduces storage cost)
- ☐ Use `immutable` for constructor-set values (USDC address, admin)
- ☐ Use `constant` for fixed values (decimals, roles)
- ☐ Cache storage reads in memory for loop variables
- ☐ Review: no unnecessary SLOADs in hot paths

### 6.2 Batch Operations

- ☐ `claimRewardBatch` for multiple submissions in one transaction
- ☐ `verifySubmissionBatch` for verifiers processing multiple submissions
- ☐ Batch size limited to prevent gas limit issues
- ☐ Test: batch operations match individual operations in correctness

### 6.3 Event Efficiency

- ☐ Events emit only necessary data (no redundant fields)
- ☐ Indexed fields are selective (3 max per event)
- ☐ No events in internal functions that are also emitted by callers

### 6.4 Gas Reports

- ☐ Run `forge test --gas-report` and save output
- ☐ Compare gas costs against budget (target: < 200k gas per claimReward)
- ☐ Optimize hot paths: `submitLocation`, `verifySubmission`, `claimReward`
- ☐ Document gas costs in README or docs

---

## 7. Multisig Setup for Admin

### 7.1 Gnosis Safe Configuration

- ☐ Deploy a Gnosis Safe on Arc (or use existing if available)
- ☐ **Signer count**: 3-of-5 or 5-of-7 (no single point of failure)
- ☐ **Signers**: trusted team members, no overlapping private key custody
- ☐ Safe address is set as `ADMIN_ADDRESS` in all contracts
- ☐ Test: admin operations require multiple signatures
- ☐ Document: Safe address, signer list (public keys only), threshold

### 7.2 Operational Security

- ☐ Signers use hardware wallets (Ledger, Trezor) for Safe signing
- ☐ No signer holds admin keys in a hot wallet
- ☐ Safe transaction policy: 24-hour delay for treasury withdrawals
- ☐ Emergency contact: at least 2 signers reachable within 24h
- ☐ Document: recovery procedure if a signer loses key access

### 7.3 Timelock (Optional but Recommended)

- ☐ Deploy a timelock contract (e.g., OpenZeppelin `TimelockController`)
- ☐ Timelock is the admin of all contracts
- ☐ Gnosis Safe proposes transactions through the timelock
- ☐ Minimum delay: 48 hours for admin operations
- ☐ Test: timelock delays are enforced
- ☐ Document: timelock address, delay, proposer/canceller roles

---

## 8. Upgradeability Decision

### 8.1 Proxy vs Immutable

- ☐ **Decision documented**: proxy or immutable for each contract
- ☐ If proxy: use OpenZeppelin `TransparentUpgradeableProxy` or `UUPS`
- ☐ If immutable: no upgrade path — bugs require redeployment + migration
- ☐ If proxy: proxy admin is the Gnosis Safe (or timelock)
- ☐ If proxy: document upgrade process and who can execute it

### 8.2 Recommendation

| Contract | Recommendation | Rationale |
|---|---|---|
| `RewardDistributor` | UUPS Proxy | Treasury logic may need updates (rescue, batch) |
| `SteplessOracle` | UUPS Proxy | Submission format may evolve |
| `X402API` | Immutable | Simple payment accounting, low bug risk |

### 8.3 If Using Proxies

- ☐ Upgrade authorization goes through timelock + multisig
- ☐ Storage layout documented and versioned
- ☐ No storage slot collisions (use `__gap` pattern)
- ☐ Test: upgrade preserves all state
- ☐ Test: upgrade cannot change critical invariants (treasury balance, rewardClaimed mapping)
- ☐ Deploy: verify implementation contracts on ArcScan

---

## 9. Fuzzing Tests

### 9.1 Fuzz Test Coverage

- ☐ `claimReward`: fuzz `amount` (0 to type(uint256).max), `contributor` (random addresses)
- ☐ `fundTreasury`: fuzz `amount` (0 to type(uint256).max)
- ☐ `submitLocation`: fuzz `lat`, `lng` (int256 range), `category` (random strings)
- ☐ `verifySubmission`: fuzz `submissionId` (random bytes32)
- ☐ `setRewardAmount`: fuzz `amount` (0 to type(uint256).max)
- ☐ USDC decimals: fuzz amounts with 6-decimal boundary values

### 9.2 Fuzz Run Configuration

```bash
# Standard fuzz runs (CI)
forge test --fuzz-runs 5000

# Extended fuzz runs (pre-mainnet)
forge test --fuzz-runs 10000

# Maximum fuzz runs (deep audit)
forge test --fuzz-runs 100000
```

- ☐ All fuzz tests pass with 10,000 runs
- ☐ All fuzz tests pass with 100,000 runs (pre-mainnet requirement)
- ☐ No invariant violations found
- ☐ Fuzz test coverage report generated and reviewed
- ☐ Edge cases discovered by fuzzing are documented and handled

### 9.3 Fuzz Test Quality

- ☐ Fuzz inputs use realistic ranges (not just 0 to max)
- ☐ Fuzz tests include USDC-specific scenarios (6 decimals, blocklist mock)
- ☐ Fuzz tests include Arc-specific scenarios (prevrandao=0, block.timestamp)
- ☐ Fuzz tests check for state consistency after each run

---

## 10. Invariant Tests

### 10.1 Core Invariants

- ☐ **Treasury conservation**: `totalFunded == treasuryBalance + totalDistributed` (always true)
- ☐ **No double-claim**: `rewardClaimed[submissionId]` can only transition false → true
- ☐ **Verifier immutability**: removed verifiers can never verify again
- ☐ **Balance non-negativity**: `treasuryBalance >= 0` (enforced by uint256, but test anyway)
- ☐ **Reward bounded**: distributed rewards never exceed treasury funding
- ☐ **Submission uniqueness**: no two submissions have the same `submissionId`

### 10.2 Invariant Test Configuration

```bash
# Run invariant tests
forge test --invariant

# Run with more depth
forge test --invariant --invariant-depth 500

# Run with more runs
forge test --invariant --invariant-runs 10000
```

- ☐ All invariant tests pass with default depth
- ☐ All invariant tests pass with depth 500
- ☐ All invariant tests pass with 10,000 runs
- ☐ Invariant handlers cover all external functions
- ☐ Invariant handlers use realistic actor models (admin, verifier, contributor)

### 10.3 Invariant Handler Coverage

- ☐ Handler calls `fundTreasury` with random amounts
- ☐ Handler calls `claimReward` with random submissions and amounts
- ☐ Handler calls `addVerifier` / `removeVerifier` randomly
- ☐ Handler calls `submitLocation` / `verifySubmission` randomly
- ☐ Handler asserts invariants after every call
- ☐ Handler uses multiple actors (not just `address(this)`)

---

## 11. Integration Tests Against Arc Testnet RPC

### 11.1 Fork Tests

- ☐ Fork Arc Testnet and run all tests against forked state
- ☐ Test: `fundTreasury` with real USDC contract (forked)
- ☐ Test: `claimReward` with real USDC transfer (forked)
- ☐ Test: blocklist scenario with forked USDC
- ☐ Test: gas costs match expectations on forked Arc

```bash
# Fork Arc Testnet for integration tests
forge test --fork-url $ARC_TESTNET_RPC_URL --fork-block-number <STABLE_BLOCK>
```

### 11.2 Live Testnet Tests

- ☐ Deploy to Arc Testnet
- ☐ Execute full end-to-end flow (submit → verify → claim → check balance)
- ☐ Verify all events appear on ArcScan
- ☐ Verify subgraph indexes all events correctly
- ☐ Test: Gas Station sponsorship works for contributor transactions
- ☐ Test: Crossmint on-ramp works for new contributors
- ☐ Test: frontend reads from subgraph and displays correct data
- ☐ Test: mobile app can submit and view rewards
- ☐ Document: all testnet test results with tx hashes

### 11.3 Edge Case Testing on Testnet

- ☐ Claim reward when treasury is exactly equal to reward amount
- ☐ Claim reward when treasury is 1 less than reward amount (should revert)
- ☐ Submit from a contract address (not an EOA)
- ☐ Verify from a verifier that was just removed (should revert)
- ☐ Fund treasury with 0 USDC (should revert or no-op)
- ☐ Claim reward with 0 amount (should revert)
- ☐ Rapid successive claims (same block / next block)

---

## 12. Subgraph Security

### 12.1 Event Handler Validation

- ☐ Every event handler validates input data before creating entities
- ☐ Handler rejects events with invalid addresses (zero address)
- ☐ Handler rejects events with invalid amounts (0 or unreasonably large)
- ☐ Handler handles duplicate events gracefully (idempotent)
- ☐ Handler validates submission IDs are well-formed

### 12.2 Entity Integrity

- ☐ No orphaned entities (e.g., Reward without a corresponding Submission)
- ☐ Foreign key relationships enforced in handlers
- ☐ Entity updates are atomic (no partial updates)
- ☐ Subgraph schema enforces non-null fields where appropriate

### 12.3 Subgraph Deployment

- ☐ Subgraph start block is the contract deployment block (not 0)
- ☐ Subgraph network is set to `arc-testnet` (not `mainnet`)
- ☐ Contract ABIs in subgraph match deployed contract ABIs
- ☐ Subgraph is synced 100% before frontend goes live
- ☐ Subgraph indexing errors are monitored (Goldsky dashboard)

### 12.4 Query Security

- ☐ Frontend handles subgraph downtime gracefully (fallback to RPC)
- ☐ No GraphQL injection vulnerabilities (parameterized queries)
- ☐ Pagination enforced (no unbounded queries)
- ☐ Rate limiting on subgraph endpoint (if public)

---

## 13. Frontend Security

### 13.1 RPC Security

- ☐ RPC fallback: if primary Arc RPC fails, fallback to secondary
- ☐ No hardcoded private keys in frontend code
- ☐ Frontend only uses the user's wallet (no server-side signing)
- ☐ RPC URL is configurable via environment variable
- ☐ Connection errors are handled gracefully (not silent failures)

### 13.2 XSS Prevention

- ☐ No use of `dangerouslySetInnerHTML` in React
- ☐ All user-generated content (submission descriptions) is escaped
- ☐ IPFS content is loaded in sandboxed iframes or with content-type validation
- ☐ No `eval()` or `Function()` constructor usage
- ☐ Content Security Policy (CSP) header set on deployed frontend

### 13.3 Wallet Connection

- ☐ Wallet connection uses standard EIP-1193 / EIP-6963
- ☐ No wallet private keys ever touch the frontend
- ☐ Transaction signing shows clear details (contract, function, args, value)
- ☐ Users can disconnect wallet at any time
- ☐ No persistent wallet connection across sessions without explicit consent
- ☐ Wallet address is not stored in localStorage (session only)

### 13.4 General Frontend

- ☐ HTTPS enforced (HSTS header)
- ☐ No sensitive data in URL parameters
- ☐ Environment variables prefixed with `VITE_` are safe to expose
- ☐ API keys used in frontend are public-safe (Circle publishable key, not secret)
- ☐ Dependencies are pinned and audited (`npm audit`)
- ☐ No mixed content (HTTP resources on HTTPS page)

---

## 14. IPFS Security

### 14.1 EXIF Stripping

- ☐ All photos have EXIF metadata stripped before IPFS upload
- ☐ EXIF stripping happens client-side (mobile app and frontend) before upload
- ☐ Test: uploaded photo has no GPS, camera model, or timestamp in EXIF
- ☐ Test: EXIF stripping works on iOS (React Native) and web (browser)
- ☐ Fallback: server-side EXIF stripping if client-side fails

```typescript
// ✅ Strip EXIF before upload
import piexif from 'piexifjs';

function stripExif(dataUrl: string): string {
  const exifObj = piexif.load(dataUrl);
  delete exifObj['GPS']; // Remove GPS data
  delete exifObj['Exif']; // Remove camera metadata
  const exifBytes = piexif.dump(exifObj);
  return piexif.insert(exifBytes, dataUrl);
}
```

### 14.2 CID Verification

- ☐ CID returned from IPFS upload is verified against expected content hash
- ☐ On-chain `ipfsCID` (bytes32) matches the actual IPFS CID
- ☐ Frontend verifies CID before displaying content
- ☐ Test: tampered image produces different CID (content addressing)
- ☐ No use of IPFS gateways that can serve arbitrary content without CID validation

### 14.3 Content Security

- ☐ IPFS content is served via Pinata gateway (not random public gateways)
- ☐ Content-type is validated (only images allowed for accessibility photos)
- ☐ File size limits enforced (max 5MB per photo)
- ☐ Rate limiting on IPFS uploads (prevent abuse)
- ☐ Pinata API keys are server-side only (never in frontend)
- ☐ IPFS pins are monitored (Pinata dashboard) for persistence

### 14.4 Privacy

- ☐ No personally identifiable information (PII) in IPFS content or metadata
- ☐ Contributor wallet addresses are public (on-chain) but not linked to real identity
- ☐ Photos do not contain faces of identifiable individuals (guideline, not enforced)
- ☐ Location data is submitted as separate on-chain field, not embedded in photo EXIF

---

## 15. Compliance

### 15.1 TRM Labs / Elliptic Integration

Stepless uses USDC, which requires compliance with Circle's terms. API consumers (via X402API) must be screened.

- ☐ Integrate TRM Labs or Elliptic for address screening
- ☐ Screen contributor addresses before reward payout
- ☐ Screen API consumer addresses before API key creation
- ☐ Block rewards to sanctioned addresses (OFAC SDN list)
- ☐ Log screening results (compliance audit trail)
- ☐ Test: sanctioned address is blocked from receiving rewards
- ☐ Test: screening API failure doesn't block all rewards (fail-open vs fail-closed decision documented)

### 15.2 Circle Compliance

- ☐ Review Circle's terms of service for USDC usage
- ☐ Ensure Stepless use case complies with Circle's acceptable use policy
- ☐ USDC blocklist: contract handles blocklisted recipients gracefully
- ☐ No use of USDC for gambling, sanctions evasion, or prohibited activities
- ☐ Document: compliance contact at Circle (if applicable)

### 15.3 Data Privacy

- ☐ GDPR compliance: no personal data stored on-chain (only wallet addresses)
- ☐ Right to erasure: IPFS content can be unpinned (on-chain data is immutable)
- ☐ Privacy policy published on the frontend
- ☐ Cookie consent (if applicable in target jurisdictions)
- ☐ Data processing agreement with Pinata (IPFS provider)

### 15.4 Accessibility Compliance

- ☐ Frontend meets WCAG 2.1 AA (this is core to Stepless's mission)
- ☐ Mobile app supports VoiceOver (iOS) and TalkBack (Android)
- ☐ All forms have proper ARIA labels
- ☐ Color contrast ratio ≥ 4.5:1 for normal text, ≥ 3:1 for large text
- ☐ Keyboard navigation works for all interactive elements
- ☐ No information conveyed by color alone
- ☐ Automated accessibility scan (axe-core) passes with no critical issues

---

## Sign-Off

| Item | Reviewer | Date | Status |
|---|---|---|---|
| Smart contract audit | _________ | _______ | ☐ |
| Arc-specific checks | _________ | _______ | ☐ |
| Access control review | _________ | _______ | ☐ |
| Reentrancy review | _________ | _______ | ☐ |
| Fuzzing tests (100k runs) | _________ | _______ | ☐ |
| Invariant tests (10k runs) | _________ | _______ | ☐ |
| Integration tests (testnet) | _________ | _______ | ☐ |
| Subgraph security | _________ | _______ | ☐ |
| Frontend security | _________ | _______ | ☐ |
| IPFS security | _________ | _______ | ☐ |
| Compliance screening | _________ | _______ | ☐ |
| Multisig setup | _________ | _______ | ☐ |
| **Final approval** | _________ | _______ | ☐ |

> **All items must be ✅ before mainnet deployment. No exceptions.**

---

<p align="center">
  <strong>Security questions? Contact the team in <a href="https://discord.gg/archouse">Arc House</a> or open a security issue.</strong>
</p>
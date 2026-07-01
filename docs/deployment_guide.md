# Stepless — Arc Testnet Deployment Guide

This guide walks you through deploying the full Stepless stack to Arc Testnet, from smart contracts to frontend. Follow each step in order.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Clone and Install](#step-1-clone-and-install)
- [Step 2: Configure .env](#step-2-configure-env)
- [Step 3: Get Testnet USDC](#step-3-get-testnet-usdc)
- [Step 4: Deploy Contracts](#step-4-deploy-contracts)
- [Step 5: Verify on ArcScan](#step-5-verify-on-arcscan)
- [Step 6: Fund Treasury](#step-6-fund-treasury)
- [Step 7: Register Initial Verifiers](#step-7-register-initial-verifiers)
- [Step 8: Deploy Goldsky Subgraph](#step-8-deploy-goldsky-subgraph)
- [Step 9: Configure Circle Gas Station](#step-9-configure-circle-gas-station)
- [Step 10: Deploy Frontend](#step-10-deploy-frontend)
- [Step 11: Test End-to-End Flow](#step-11-test-end-to-end-flow)
- [Arc-Specific Warnings](#arc-specific-warnings)

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Foundry** | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| **Node.js** | Version 20+ — [nodejs.org](https://nodejs.org/) |
| **npm** | Version 10+ (bundled with Node.js) |
| **Git** | Version 2.40+ |
| **Wallet** | A wallet with Arc Testnet configured |
| **Testnet USDC** | From [faucet.circle.com](https://faucet.circle.com) |
| **Circle Account** | For Gas Station API — [developers.circle.com](https://developers.circle.com) |
| **Pinata Account** | For IPFS pinning — [pinata.cloud](https://pinata.cloud) |
| **Goldsky Account** | For subgraph hosting — [goldsky.com](https://goldsky.com) |

---

## Step 1: Clone and Install

```bash
git clone https://github.com/stepless/stepless.git
cd stepless

# Install Foundry dependencies (OpenZeppelin, forge-std)
forge install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install mobile app dependencies
cd mobile && npm install && cd ..

# Install subgraph dependencies
cd subgraph && npm install && cd ..
```

Verify Foundry is installed:

```bash
forge --version
cast --version
```

---

## Step 2: Configure .env

Copy the template and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with the following required values:

```bash
# Arc Testnet RPC (check https://arc.network for the latest URL)
ARC_TESTNET_RPC_URL=https://testnet.arc1.network/rpc

# Generate a new wallet (DO NOT use a mainnet key)
cast wallet new
# Copy the private key output and paste it below
PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# The address corresponding to your private key
# Get it with: cast wallet address --private-key $PRIVATE_KEY
ADMIN_ADDRESS=0xYOUR_ADMIN_ADDRESS

# Circle API credentials (from https://developers.circle.com)
CIRCLE_API_KEY=your_circle_api_key
CIRCLE_ENTITY_SECRET=your_entity_secret

# Pinata credentials (from https://app.pinata.cloud)
PINATA_API_KEY=your_pinata_api_key
PINATA_API_SECRET=your_pinata_api_secret
```

Load your environment:

```bash
source .env
```

Verify the RPC connection:

```bash
cast block-number --rpc-url $ARC_TESTNET_RPC_URL
```

You should see a recent block number. If this fails, check your RPC URL.

---

## Step 3: Get Testnet USDC

1. Go to [faucet.circle.com](https://faucet.circle.com)
2. Enter your wallet address (`$ADMIN_ADDRESS`)
3. Request testnet USDC
4. Verify the balance:

```bash
# Check your USDC balance on Arc Testnet
cast balance $ADMIN_ADDRESS --rpc-url $ARC_TESTNET_RPC_URL
```

> **⚠️ Warning:** You need USDC for both gas and treasury funding. Request enough (typically 100–1000 testnet USDC).

---

## Step 4: Deploy Contracts

Stepless uses a two-phase deployment pattern via `script/Deploy.s.sol`:

1. **Phase 1:** Deploy all three contracts with constructor arguments
2. **Phase 2:** Link contracts together (set oracle address in RewardDistributor, etc.)

### Option A: Deploy All at Once (Recommended)

```bash
source .env

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify
```

This will:
- Deploy `RewardDistributor` with USDC address and admin address
- Deploy `SteplessOracle` with admin address
- Deploy `X402API` with USDC address and admin address
- Call `setOracleAddress()` on RewardDistributor to link the oracle
- Verify all contracts on ArcScan
- Output all contract addresses

**Save the output addresses** — you'll need them for `.env` and the subgraph.

### Option B: Deploy Individually

If you prefer to deploy each contract manually:

```bash
source .env

# 1. Deploy RewardDistributor
forge create src/RewardDistributor.sol:RewardDistributor \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $USDC_ADDRESS $ADMIN_ADDRESS \
  --verify

# Save the output address as REWARD_DISTRIBUTOR_ADDRESS

# 2. Deploy SteplessOracle
forge create src/SteplessOracle.sol:SteplessOracle \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $ADMIN_ADDRESS \
  --verify

# Save the output address as STEPLESS_ORACLE_ADDRESS

# 3. Deploy X402API
forge create src/X402API.sol:X402API \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $USDC_ADDRESS $ADMIN_ADDRESS \
  --verify

# Save the output address as X402API_ADDRESS
```

### Link Contracts (Phase 2)

After deploying individually, link them together:

```bash
# Set the oracle address in RewardDistributor
cast send $REWARD_DISTRIBUTOR_ADDRESS \
  "setOracleAddress(address)" \
  $STEPLESS_ORACLE_ADDRESS \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY

# Set the reward distributor address in SteplessOracle
cast send $STEPLESS_ORACLE_ADDRESS \
  "setRewardDistributor(address)" \
  $REWARD_DISTRIBUTOR_ADDRESS \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### Update .env with Deployed Addresses

```bash
# Add these to your .env file
REWARD_DISTRIBUTOR_ADDRESS=0x...  # from deploy output
STEPLESS_ORACLE_ADDRESS=0x...     # from deploy output
X402API_ADDRESS=0x...             # from deploy output
```

---

## Step 5: Verify on ArcScan

Check that your contracts are verified on [testnet.arcscan.app](https://testnet.arcscan.app):

1. Open `https://testnet.arcscan.app/address/<YOUR_CONTRACT_ADDRESS>`
2. Go to the **Contract** tab
3. Verify the source code is displayed (green checkmark)
4. Read and write functions should be interactive

If verification failed during deploy, verify manually:

```bash
forge verify-contract $REWARD_DISTRIBUTOR_ADDRESS \
  src/RewardDistributor.sol:RewardDistributor \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --verifier-url $ARCSCAN_API_URL

forge verify-contract $STEPLESS_ORACLE_ADDRESS \
  src/SteplessOracle.sol:SteplessOracle \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --verifier-url $ARCSCAN_API_URL

forge verify-contract $X402API_ADDRESS \
  src/X402API.sol:X402API \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --verifier-url $ARCSCAN_API_URL
```

---

## Step 6: Fund Treasury

The RewardDistributor needs USDC in its treasury to pay rewards. Funding requires two transactions:

### 6a. Approve USDC Transfer

First, approve the RewardDistributor to spend your USDC:

```bash
source .env

# Approve 1000 USDC (1000 * 10^6 = 1000000000 in base units)
# ⚠️ USDC uses 6 decimals, NOT 18
cast send $USDC_ADDRESS \
  "approve(address,uint256)" \
  $REWARD_DISTRIBUTOR_ADDRESS \
  1000000000 \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### 6b. Fund the Treasury

Call `fundTreasury` on RewardDistributor:

```bash
# Fund with 1000 USDC
cast send $REWARD_DISTRIBUTOR_ADDRESS \
  "fundTreasury(uint256)" \
  1000000000 \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### 6c. Verify Treasury Balance

```bash
# Check USDC balance of RewardDistributor
cast call $USDC_ADDRESS \
  "balanceOf(address)" \
  $REWARD_DISTRIBUTOR_ADDRESS \
  --rpc-url $ARC_TESTNET_RPC_URL

# Or use the contract's getter
cast call $REWARD_DISTRIBUTOR_ADDRESS \
  "treasuryBalance()" \
  --rpc-url $ARC_TESTNET_RPC_URL
```

The output should show `1000000000` (1000 USDC in base units).

---

## Step 7: Register Initial Verifiers

Verifiers are authorized addresses that can approve submissions and trigger reward claims. Register your initial verifiers:

```bash
source .env

# Register a verifier in SteplessOracle
cast send $STEPLESS_ORACLE_ADDRESS \
  "registerVerifier(address)" \
  0xVERIFIER_ADDRESS \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY

# Register the same verifier in RewardDistributor (so they can trigger claims)
cast send $REWARD_DISTRIBUTOR_ADDRESS \
  "addVerifier(address)" \
  0xVERIFIER_ADDRESS \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

Verify the verifier was added:

```bash
cast call $STEPLESS_ORACLE_ADDRESS \
  "isVerifier(address)" \
  0xVERIFIER_ADDRESS \
  --rpc-url $ARC_TESTNET_RPC_URL
# Should return true (0x01)
```

Repeat for each verifier you want to register.

---

## Step 8: Deploy Goldsky Subgraph

The subgraph indexes all contract events into a queryable GraphQL API.

### 8a. Update Subgraph Manifest

Edit `subgraph/subgraph.yaml` and replace the placeholder addresses with your deployed contract addresses:

```yaml
dataSources:
  - name: RewardDistributor
    network: arc-testnet
    source:
      address: "0xYOUR_REWARD_DISTRIBUTOR_ADDRESS"
      abi: RewardDistributor
      startBlock: <DEPLOYMENT_BLOCK_NUMBER>
  - name: SteplessOracle
    network: arc-testnet
    source:
      address: "0xYOUR_STEPLESS_ORACLE_ADDRESS"
      abi: SteplessOracle
      startBlock: <DEPLOYMENT_BLOCK_NUMBER>
  - name: X402API
    network: arc-testnet
    source:
      address: "0xYOUR_X402API_ADDRESS"
      abi: X402API
      startBlock: <DEPLOYMENT_BLOCK_NUMBER>
```

Get the deployment block number:

```bash
# Find the block where your contract was deployed
# Check ArcScan for your contract's creation transaction
cast block-number --rpc-url $ARC_TESTNET_RPC_URL
```

### 8b. Generate Types and Build

```bash
cd subgraph

# Generate TypeScript types from schema
npx graph codegen

# Build the subgraph
npx graph build
```

### 8c. Deploy to Goldsky

```bash
# Login to Goldsky (if not already)
npx goldsky login

# Deploy the subgraph
npx goldsky deploy stepless-v1
```

Goldsky will output your subgraph endpoint URL. Save it:

```bash
# Add to .env
GOLDSKY_SUBGRAPH_ENDPOINT=https://api.goldsky.com/api/public/project/stepless/subgraphs/stepless-v1/gn
```

### 8d. Verify the Subgraph

Wait 1–2 minutes for indexing, then query:

```bash
curl -X POST $GOLDSKY_SUBGRAPH_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"query": "{ treasuries { id balance totalFunded totalDistributed } }"}'
```

You should see your treasury data.

---

## Step 9: Configure Circle Gas Station

The Circle Gas Station sponsors gas fees so contributors don't need ARC tokens to submit accessibility data.

### 9a. Create a Gas Station Policy

1. Go to [developers.circle.com](https://developers.circle.com) → Gas Station
2. Create a new policy for Arc Testnet
3. Specify the contract addresses that should have gas sponsored:
   - `REWARD_DISTRIBUTOR_ADDRESS`
   - `STEPLESS_ORACLE_ADDRESS`
4. Set a spending limit (e.g., 100 USDC/day for testnet)
5. Specify which functions to sponsor (e.g., `submitLocation`, `claimReward`)

### 9b. Get API Credentials

Save your Gas Station API key and entity secret in `.env`:

```bash
CIRCLE_API_KEY=your_gas_station_api_key
CIRCLE_ENTITY_SECRET=your_entity_secret
```

### 9c. Integrate in Frontend

The frontend uses the Gas Station to sponsor transactions. See `frontend/src/lib/arc.ts` for the integration code. Contributors' transactions are routed through the Gas Station when they don't have sufficient USDC for gas.

---

## Step 10: Deploy Frontend

### Option A: Vercel (Recommended)

```bash
cd frontend

# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# - ARC_TESTNET_RPC_URL
# - GOLDSKY_SUBGRAPH_ENDPOINT
# - REWARD_DISTRIBUTOR_ADDRESS
# - STEPLESS_ORACLE_ADDRESS
# - X402API_ADDRESS
# - USDC_ADDRESS
# - IPFS_GATEWAY_URL
# - CIRCLE_API_KEY (if using Gas Station from frontend)
# - CROSSMINT_API_KEY
```

### Option B: Netlify

```bash
cd frontend

# Build
npm run build

# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist
```

### Option C: IPFS

```bash
cd frontend
npm run build

# Upload to IPFS via Pinata
npx pinata upload dist/

# Access via IPFS gateway
# https://gateway.pinata.cloud/ipfs/<CID>
```

### Update Frontend Environment

Ensure the frontend has access to your deployed contract addresses. Create `frontend/.env.local`:

```bash
VITE_ARC_TESTNET_RPC_URL=https://testnet.arc1.network/rpc
VITE_GOLDSKY_SUBGRAPH_ENDPOINT=https://api.goldsky.com/...
VITE_REWARD_DISTRIBUTOR_ADDRESS=0x...
VITE_STEPLESS_ORACLE_ADDRESS=0x...
VITE_X402API_ADDRESS=0x...
VITE_USDC_ADDRESS=0x...
VITE_IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs/
VITE_CIRCLE_API_KEY=your_key
VITE_CROSSMINT_API_KEY=your_key
```

---

## Step 11: Test End-to-End Flow

Test the complete flow from submission to reward:

### 11a. Submit a Location (as Contributor)

```bash
source .env

# Upload a test photo to IPFS (simulated CID)
# In production, this is done via the mobile app or frontend
TEST_CID=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# Submit a location to SteplessOracle
cast send $STEPLESS_ORACLE_ADDRESS \
  "submitLocation(bytes32,uint256,uint256,string)" \
  $TEST_CID \
  -23560230 \
  -4665880 \
  "ramp" \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $CONTRIBUTOR_PRIVATE_KEY
```

### 11b. Verify the Submission (as Verifier)

```bash
# Get the submission ID from the event logs or subgraph
# For testing, query the oracle:
cast call $STEPLESS_ORACLE_ADDRESS \
  "getSubmissionByIndex(uint256)" \
  0 \
  --rpc-url $ARC_TESTNET_RPC_URL

# Verify the submission (using verifier's key)
cast send $STEPLESS_ORACLE_ADDRESS \
  "verifySubmission(bytes32)" \
  0xSUBMISSION_ID \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $VERIFIER_PRIVATE_KEY
```

### 11c. Claim the Reward (as Verifier)

```bash
# Claim reward for the contributor
cast send $REWARD_DISTRIBUTOR_ADDRESS \
  "claimReward(address,uint256,bytes32)" \
  0xCONTRIBUTOR_ADDRESS \
  1000000 \
  0xSUBMISSION_ID \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $VERIFIER_PRIVATE_KEY
```

### 11d. Verify the Reward

```bash
# Check contributor's USDC balance
cast call $USDC_ADDRESS \
  "balanceOf(address)" \
  0xCONTRIBUTOR_ADDRESS \
  --rpc-url $ARC_TESTNET_RPC_URL

# Check treasury balance decreased
cast call $REWARD_DISTRIBUTOR_ADDRESS \
  "treasuryBalance()" \
  --rpc-url $ARC_TESTNET_RPC_URL

# Query the subgraph for the reward event
curl -X POST $GOLDSKY_SUBGRAPH_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"query": "{ rewards { id contributor amount submissionId timestamp } }"}'
```

### 11e. Verify on ArcScan

Open the transaction hash on [testnet.arcscan.app](https://testnet.arcscan.app) and confirm:

- The `RewardClaimed` event was emitted
- USDC was transferred from RewardDistributor to the contributor
- The treasury balance decreased by the reward amount

---

## Arc-Specific Warnings

### ⚠️ USDC Uses 6 Decimals

USDC on Arc uses **6 decimals**, not 18. This is the most common source of deployment errors.

```bash
# ✅ CORRECT — 1 USDC = 1000000 (1e6)
cast send $REWARD_DISTRIBUTOR_ADDRESS "fundTreasury(uint256)" 1000000 ...

# ❌ WRONG — 1 USDC treated as 1e18 (1000x too much)
cast send $REWARD_DISTRIBUTOR_ADDRESS "fundTreasury(uint256)" 1000000000000000000 ...
```

### ⚠️ USDC Blocklist

USDC has a blocklist. If a recipient address is blocklisted, transfers will revert. If `claimReward` fails, check if the contributor is blocklisted:

```bash
# Check if an address is blocklisted on USDC
cast call $USDC_ADDRESS "isBlocklisted(address)" 0xADDRESS --rpc-url $ARC_TESTNET_RPC_URL
```

### ⚠️ Gas is Paid in USDC

On Arc, gas is paid in USDC (not a separate native token). Ensure your wallet has enough USDC for both gas and treasury funding. The Circle Gas Station can sponsor gas for contributors who don't have USDC.

### ⚠️ No SELFDESTRUCT

Arc may not support `SELFDESTRUCT`. Stepless contracts do not use it. If you add new contracts, avoid `selfdestruct` — use a pause + withdrawal pattern instead.

### ⚠️ PREVRANDAO = 0

`block.prevrandao` is always 0 on Arc. Do not use it for randomness. Use commit-reveal or an oracle.

### ⚠️ Block Time Differences

Arc block times differ from Ethereum. Do not assume 12-second blocks. Use `block.timestamp` for time-based logic and verify with Arc Testnet data.

### ⚠️ Constructor Argument Order

Double-check constructor argument order when using `forge create`. The contracts expect:

- **RewardDistributor**: `(address usdcAddress, address admin)`
- **SteplessOracle**: `(address admin)`
- **X402API**: `(address usdcAddress, address admin)`

### ⚠️ Verification on ArcScan

ArcScan verification may use a different API URL than Etherscan. Check [testnet.arcscan.app](https://testnet.arcscan.app) for the correct verifier URL. If `--verify` fails during `forge create`, use `forge verify-contract` separately.

---

<p align="center">
  <strong>Deployment issues? Join <a href="https://discord.gg/archouse">Arc House</a> on Discord for help.</strong>
</p>
// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — Deploy Script (Foundry)
//  Deploys all 3 contracts to Arc Testnet in correct dependency order.
//
//  Two-phase deploy pattern:
//    1. Deploy SteplessOracle with address(0) as distributor placeholder
//    2. Deploy RewardDistributor with real Oracle address
//    3. Deploy X402API with real Oracle address
//    4. Call oracle.setRewardDistributor(real distributor address)
//    5. Authorize callers on both Oracle and Distributor
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {SteplessOracle} from "../src/SteplessOracle.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {X402API} from "../src/X402API.sol";

contract DeployStepless is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("ADMIN_ADDRESS");

        vm.startBroadcast(privateKey);

        // ── Phase 1: Deploy Oracle with placeholder distributor ─────────────
        // Constructor accepts address(0) for _rewardDistributor in two-phase deploy.
        SteplessOracle oracle = new SteplessOracle(address(0), admin);

        // ── Phase 2: Deploy RewardDistributor with real Oracle address ──────
        RewardDistributor distributor = new RewardDistributor(address(oracle), admin);

        // ── Phase 3: Deploy X402API with real Oracle address ────────────────
        X402API api = new X402API(address(oracle), admin);

        // ── Phase 4: Wire Oracle → Distributor (resolve circular dep) ───────
        oracle.setRewardDistributor(address(distributor));

        // ── Phase 5: Authorize callers ──────────────────────────────────────
        // Authorize deployer (msg.sender) on both contracts for initial setup
        oracle.setAuthorizedCaller(msg.sender, true);
        distributor.setAuthorizedCaller(msg.sender, true);

        // Authorize the Oracle contract to call RewardDistributor.recordVerification
        distributor.setAuthorizedCaller(address(oracle), true);

        // Authorize the Distributor to call Oracle.getContribution
        oracle.setAuthorizedCaller(address(distributor), true);

        vm.stopBroadcast();

        // Log addresses
        console.log("=== Stepless Deployment on Arc Testnet ===");
        console.log("SteplessOracle:       ", address(oracle));
        console.log("RewardDistributor:    ", address(distributor));
        console.log("X402API:              ", address(api));
        console.log("Admin:                ", admin);
        console.log("==========================================");
        console.log("Next steps:");
        console.log("  1. Fund treasury: distributor.fundTreasury(amount)");
        console.log("  2. Register verifiers: distributor.registerVerifier(addr)");
        console.log("  3. Verify on ArcScan: https://testnet.arcscan.app");
    }
}
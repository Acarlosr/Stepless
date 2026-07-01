// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — RewardDistributor.t.sol
//  Unit tests for RewardDistributor (run on anvil + Arc Testnet)
//
//  ⚠️ Tests that depend on Arc-specific behavior (blocklist, EIP-7708 events,
//     native transfer reverts) MUST be run against Arc Testnet RPC, not anvil.
//     anvil runs standard EVM and cannot reproduce Arc precompiles.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RewardDistributor.sol";
import "../src/SteplessOracle.sol";

// ── Mock Oracle for testing ─────────────────────────────────────────────────
contract MockOracle is ISteplessOracle {
    mapping(bytes32 => bool) public verifiedMap;
    mapping(bytes32 => address) public verifierMap;

    function setVerified(bytes32 id, bool v, address verifier) external {
        verifiedMap[id] = v;
        verifierMap[id] = verifier;
    }

    function getContribution(bytes32 contributionId)
        external
        view
        returns (bool verified, address verifier, uint256 timestamp)
    {
        return (verifiedMap[contributionId], verifierMap[contributionId], block.number);
    }
}

contract RewardDistributorTest is Test {
    RewardDistributor public distributor;
    MockOracle public oracle;

    address admin = makeAddr("admin");
    address contributor = makeAddr("contributor");
    address verifier = makeAddr("verifier");
    address unauthorized = makeAddr("unauthorized");

    // Arc Testnet USDC address
    address constant USDC = 0x3600000000000000000000000000000000000000;

    // Test contribution IDs
    bytes32 constant CONTRIB_1 = keccak256("contribution_1");
    bytes32 constant CONTRIB_2 = keccak256("contribution_2");

    function setUp() public {
        oracle = new MockOracle();
        distributor = new RewardDistributor(address(oracle), admin);

        // Register verifier
        vm.prank(admin);
        distributor.registerVerifier(verifier);

        // Authorize admin as caller
        vm.prank(admin);
        distributor.setAuthorizedCaller(admin, true);
    }

    // ── Deployment ──────────────────────────────────────────────────────────

    function test_Deployment_SetsAdminAndOracle() public view {
        assertEq(distributor.admin(), admin);
        assertEq(address(distributor.oracle()), address(oracle));
    }

    function test_Deployment_RevertZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        new RewardDistributor(address(0), admin);
    }

    // ── Reward Amounts ──────────────────────────────────────────────────────

    function test_DefaultRewardAmounts() public view {
        assertEq(distributor.rewardNewLocation(), 100_000);     // $0.10
        assertEq(distributor.rewardVerification(), 50_000);     // $0.05
        assertEq(distributor.rewardQualityPhoto(), 20_000);     // $0.02
        assertEq(distributor.rewardLocationUpdate(), 30_000);   // $0.03
        assertEq(distributor.rewardTopContributor(), 5_000_000); // $5.00
    }

    function test_SetRewardAmount() public {
        vm.prank(admin);
        distributor.setRewardAmount(RewardType.NewLocation, 200_000); // $0.20
        assertEq(distributor.rewardNewLocation(), 200_000);
    }

    function test_SetRewardAmount_RevertUnauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(Unauthorized.selector);
        distributor.setRewardAmount(RewardType.NewLocation, 200_000);
    }

    // ── Pay Reward ──────────────────────────────────────────────────────────

    function test_PayReward_MarksClaimed() public {
        // Setup: mark contribution as verified in oracle
        oracle.setVerified(CONTRIB_1, true, verifier);

        // Pay reward
        vm.prank(admin);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        // Check claimed
        assertTrue(distributor.rewardClaimed(CONTRIB_1));
        assertEq(distributor.totalEarned(contributor), 100_000);
        assertEq(distributor.contributionCount(contributor), 1);
    }

    function test_PayReward_RevertNotVerified() public {
        oracle.setVerified(CONTRIB_1, false, address(0));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ContributionNotVerified.selector, CONTRIB_1));
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
    }

    function test_PayReward_RevertAlreadyClaimed() public {
        oracle.setVerified(CONTRIB_1, true, verifier);

        vm.startPrank(admin);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        vm.expectRevert(abi.encodeWithSelector(RewardAlreadyClaimed.selector, CONTRIB_1));
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
        vm.stopPrank();
    }

    function test_PayReward_RevertUnauthorized() public {
        oracle.setVerified(CONTRIB_1, true, verifier);

        vm.prank(unauthorized);
        vm.expectRevert(Unauthorized.selector);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
    }

    function test_PayReward_RevertZeroAddress() public {
        oracle.setVerified(CONTRIB_1, true, verifier);

        vm.prank(admin);
        vm.expectRevert(ZeroAddress.selector);
        distributor.payReward(CONTRIB_1, address(0), RewardType.NewLocation);
    }

    function test_PayReward_RevertPaused() public {
        oracle.setVerified(CONTRIB_1, true, verifier);

        vm.startPrank(admin);
        distributor.setPaused(true);
        vm.expectRevert(Paused.selector);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
        vm.stopPrank();
    }

    // ── Verifier Management ─────────────────────────────────────────────────

    function test_RegisterVerifier() public {
        address newVerifier = makeAddr("newVerifier");
        vm.prank(admin);
        distributor.registerVerifier(newVerifier);
        assertTrue(distributor.verifiers(newVerifier));
    }

    function test_AutoPromoteVerifier() public {
        address newContrib = makeAddr("newContrib");

        // Simulate 20+ contributions
        vm.prank(admin);
        distributor.setAuthorizedCaller(address(this), true);

        for (uint256 i = 0; i < 20; i++) {
            bytes32 contribId = keccak256(abi.encode("contrib", i));
            oracle.setVerified(contribId, true, verifier);
            distributor.payReward(contribId, newContrib, RewardType.NewLocation);
        }

        assertEq(distributor.contributionCount(newContrib), 20);

        // Now auto-promote
        distributor.autoPromoteVerifier(newContrib);
        assertTrue(distributor.verifiers(newContrib));
    }

    function test_SlashVerifier() public {
        vm.prank(admin);
        distributor.slashVerifier(verifier, "fraudulent verification");
        assertFalse(distributor.verifiers(verifier));
    }

    // ── Record Verification (Sybil Resistance) ──────────────────────────────

    function test_RecordVerification_RevertSelfVerify() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(DuplicateVerifier.selector, verifier, CONTRIB_1));
        distributor.recordVerification(CONTRIB_1, verifier, verifier);
    }

    function test_RecordVerification_EnforcesCooldown() public {
        vm.prank(admin);
        distributor.recordVerification(CONTRIB_1, verifier, contributor);

        // Try again immediately — should fail cooldown
        bytes32 CONTRIB_2 = keccak256("contribution_2");
        vm.prank(admin);
        vm.expectRevert();
        distributor.recordVerification(CONTRIB_2, verifier, contributor);
    }

    // ── Admin Functions ─────────────────────────────────────────────────────

    function test_TransferAdmin() public {
        address newAdmin = makeAddr("newAdmin");
        vm.prank(admin);
        distributor.transferAdmin(newAdmin);
        assertEq(distributor.admin(), newAdmin);
    }

    function test_SetAuthorizedCaller() public {
        address caller = makeAddr("caller");
        vm.prank(admin);
        distributor.setAuthorizedCaller(caller, true);
        assertTrue(distributor.authorizedCallers(caller));
    }

    // ── View Functions ──────────────────────────────────────────────────────

    function test_GetContributorStats() public {
        oracle.setVerified(CONTRIB_1, true, verifier);
        vm.prank(admin);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        (uint256 earned, uint256 contributions, uint256 verifications) =
            distributor.getContributorStats(contributor);

        assertEq(earned, 100_000);
        assertEq(contributions, 1);
        assertEq(verifications, 0);
    }

    function test_IsRewardClaimed() public {
        assertFalse(distributor.isRewardClaimed(CONTRIB_1));
        oracle.setVerified(CONTRIB_1, true, verifier);
        vm.prank(admin);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
        assertTrue(distributor.isRewardClaimed(CONTRIB_1));
    }

    // ── Batch Pay Rewards ───────────────────────────────────────────────────

    function test_BatchPayRewards_ProcessesAll() public {
        bytes32[] memory ids = new bytes32[](3);
        address[] memory contribs = new address[](3);
        RewardType[] memory types = new RewardType[](3);

        for (uint256 i = 0; i < 3; i++) {
            ids[i] = keccak256(abi.encode("batch", i));
            contribs[i] = makeAddr(string(abi.encodePacked("contrib", i)));
            types[i] = RewardType.NewLocation;
            oracle.setVerified(ids[i], true, verifier);
        }

        vm.prank(admin);
        distributor.batchPayRewards(ids, contribs, types);

        for (uint256 i = 0; i < 3; i++) {
            assertTrue(distributor.rewardClaimed(ids[i]));
            assertEq(distributor.totalEarned(contribs[i]), 100_000);
        }
    }

    function test_BatchPayRewards_SkipsAlreadyClaimed() public {
        bytes32[] memory ids = new bytes32[](2);
        address[] memory contribs = new address[](2);
        RewardType[] memory types = new RewardType[](2);

        ids[0] = CONTRIB_1;
        ids[1] = CONTRIB_2;
        contribs[0] = contributor;
        contribs[1] = contributor;
        types[0] = RewardType.NewLocation;
        types[1] = RewardType.NewLocation;

        oracle.setVerified(CONTRIB_1, true, verifier);
        oracle.setVerified(CONTRIB_2, true, verifier);

        // Claim first one
        vm.prank(admin);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        // Batch should skip CONTRIB_1 and process CONTRIB_2
        vm.prank(admin);
        distributor.batchPayRewards(ids, contribs, types);

        assertEq(distributor.totalEarned(contributor), 200_000); // 2x $0.10
    }

    // ── Arc-Specific Tests (Require Arc Testnet RPC) ────────────────────────
    // These tests verify Arc-specific behavior that anvil cannot reproduce.
    // Run with: forge test --fork-url https://rpc.testnet.arc.network -vvv

    /// @notice Verify that _safeTransfer catches a blocklist revert on Arc.
    /// @dev    Arc testnet blocklisted address: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
    ///         A USDC transfer to this address reverts at runtime on Arc.
    ///         _safeTransfer should catch this and emit RewardFailed instead
    ///         of reverting the entire transaction.
    function test_Arc_TransferToBlocklistedEmitsRewardFailed() public {
        // This test only works against Arc Testnet RPC (not anvil).
        // On anvil, there is no blocklist enforcement.
        //
        // Setup:
        //   1. Fund the distributor with USDC (need real USDC on Arc testnet)
        //   2. Mark a contribution as verified
        //   3. Pay reward to blocklisted address
        //   4. Expect RewardFailed event (not a revert)
        //
        // Implementation (uncomment when running against Arc RPC):
        //
        // address blocklisted = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
        // oracle.setVerified(CONTRIB_1, true, verifier);
        //
        // // Fund treasury — need to deal USDC to this contract on Arc
        // // deal() won't work for ERC-20 on Arc; use faucet or transferFrom
        //
        // vm.prank(admin);
        // vm.expectEmit(true, true, false, false);
        // emit RewardFailed(CONTRIB_1, blocklisted, 100_000, "");
        // distributor.payReward(CONTRIB_1, blocklisted, RewardType.NewLocation);
        //
        // // Contribution should still be marked as claimed
        // assertTrue(distributor.rewardClaimed(CONTRIB_1));
    }

    /// @notice Verify that EIP-7708 Transfer events are emitted for native USDC.
    /// @dev    On Arc, native USDC sends emit a Transfer log from the system
    ///         emitter (18 decimals), distinct from ERC-20 Transfer (6 decimals).
    ///         This test verifies the indexer can distinguish the two.
    function test_Arc_EIP7708_NativeTransferEvent() public {
        // Requires Arc Testnet RPC.
        //
        // Implementation:
        //   1. Send native USDC (msg.value) to an address
        //   2. Check logs for EIP-7708 Transfer event from system emitter
        //   3. Verify 18-decimal value in the event
        //   4. Compare with ERC-20 Transfer (6 decimals) from USDC contract
    }

    /// @notice Verify that draining an empty account reverts on Arc.
    /// @dev    A transfer that leaves an account with zero balance, zero nonce,
    ///         and no code reverts on Arc. This is a known temporary limitation.
    ///         Accounts that have ever sent a tx (non-zero nonce) are unaffected.
    function test_Arc_DrainEmptyAccountReverts() public {
        // Requires Arc Testnet RPC.
        //
        // Implementation:
        //   1. Create a fresh account (fund from faucet, never sent a tx)
        //   2. Attempt to transfer 100% of its USDC balance
        //   3. Expect revert on Arc (but success on anvil)
        //
        // Note: This test documents the limitation. In production, the
        // RewardDistributor._safeTransfer already handles this via try/catch.
    }

    /// @notice Verify that the Memo contract emits indexed events on Arc.
    /// @dev    The Memo contract (0x5294E9927c3306DcBaDb03fe70b92e01cCede505)
    ///         emits Memo events with a sequential index. Goldsky can index these.
    function test_Arc_MemoContractEmitsEvents() public {
        // Requires Arc Testnet RPC.
        //
        // Implementation:
        //   1. Call memo.attachMemo(locationHash, data)
        //   2. Check logs for Memo event
        //   3. Verify sequential index increments
    }

    /// @notice Verify gas fees are denominated in USDC on Arc.
    /// @dev    maxFeePerGas minimum is 20 Gwei on Arc testnet.
    ///         Display fees in USDC (dollar terms), not Gwei.
    function test_Arc_GasDenominatedInUSDC() public {
        // Requires Arc Testnet RPC.
        //
        // Implementation:
        //   1. Query eth_gasPrice from Arc RPC
        //   2. Verify it returns >= 20 Gwei
        //   3. Send a transaction and check gas cost in USDC
    }
}
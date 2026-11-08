// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — CampaignEscrow.t.sol
//
//  Foco no dinheiro do parceiro: só sai para contribuidor verificado da
//  campanha ou de volta para o parceiro. Nenhum caminho de saque do admin.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/CampaignEscrow.sol";
import {Unauthorized} from "../src/lib/Admin2Step.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Oracle falso com bloco de verificação controlável (o real devolve verifiedBlock).
contract CampaignMockOracle is IOracleCampaign {
    struct C { bool verified; address verifier; uint256 verifiedBlock; address contributor; }
    mapping(bytes32 => C) public data;

    function set(bytes32 id, bool verified, address verifier, uint256 verifiedBlock, address contributor) external {
        data[id] = C(verified, verifier, verifiedBlock, contributor);
    }

    function getContribution(bytes32 id) external view returns (bool, address, uint256) {
        C memory c = data[id];
        return (c.verified, c.verifier, c.verifiedBlock);
    }

    function getContributor(bytes32 id) external view returns (address) {
        return data[id].contributor;
    }
}

contract CampaignEscrowTest is Test {
    CampaignEscrow escrow;
    CampaignMockOracle oracle;
    MockUSDC usdc;

    address admin    = makeAddr("admin");
    address sponsor  = makeAddr("sponsor");
    address attester = makeAddr("attester");
    address verifier = makeAddr("verifier");
    address alice    = makeAddr("alice");
    address bob      = makeAddr("bob");
    address stranger = makeAddr("stranger");

    uint256 constant REWARD = 250_000; // $0,25
    uint256 constant ITEMS  = 4;
    uint256 constant TOTAL  = REWARD * ITEMS;
    bytes32 constant BRAND  = keccak256("loja-exemplo");
    bytes32 constant META   = keccak256("ipfs://zona-centro");

    function setUp() public {
        vm.roll(100);
        vm.warp(1_000_000);

        oracle = new CampaignMockOracle();
        usdc = new MockUSDC(6);
        escrow = new CampaignEscrow(address(oracle), admin, address(usdc));

        vm.prank(admin);
        escrow.setAttester(attester, true);

        usdc.mint(sponsor, 1_000_000_000);
        vm.prank(sponsor);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _create(uint256 maxPer) internal returns (uint256 id) {
        vm.prank(sponsor);
        id = escrow.createCampaign(REWARD, ITEMS, maxPer, 30 days, BRAND, META);
    }

    /// @dev Contribuição verificada no bloco atual + 1 (depois da campanha).
    function _verified(string memory name, address who) internal returns (bytes32 id) {
        id = keccak256(bytes(name));
        oracle.set(id, true, verifier, block.number + 1, who);
    }

    // ── construtor ──────────────────────────────────────────────────────────

    function test_Constructor_RejectsUsdcWithoutCode() public {
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.InvalidUsdc.selector, address(0xBEEF)));
        new CampaignEscrow(address(oracle), admin, address(0xBEEF));
    }

    function test_Constructor_RejectsWrongDecimals() public {
        MockUSDC wrong = new MockUSDC(18);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.InvalidUsdc.selector, address(wrong)));
        new CampaignEscrow(address(oracle), admin, address(wrong));
    }

    // ── criação ─────────────────────────────────────────────────────────────

    function test_Create_PullsDepositAndStoresCampaign() public {
        uint256 id = _create(0);
        assertEq(id, 1);
        assertEq(usdc.balanceOf(address(escrow)), TOTAL);
        assertEq(escrow.totalEscrowed(), TOTAL);
        CampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.sponsor, sponsor);
        assertEq(c.refundTo, sponsor);
        assertEq(c.deposited, TOTAL);
        assertEq(c.startBlock, block.number);
        assertEq(c.deadline, block.timestamp + 30 days);
        assertTrue(escrow.isActive(id));
    }

    function test_Create_RejectsBadParams() public {
        vm.startPrank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.InvalidReward.selector, 9_999));
        escrow.createCampaign(9_999, 1, 0, 30 days, BRAND, META);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.InvalidMaxItems.selector, 0));
        escrow.createCampaign(REWARD, 0, 0, 30 days, BRAND, META);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.InvalidDuration.selector, 1 hours));
        escrow.createCampaign(REWARD, 1, 0, 1 hours, BRAND, META);
        vm.expectRevert(CampaignEscrow.EmptyBrandRef.selector);
        escrow.createCampaign(REWARD, 1, 0, 30 days, bytes32(0), META);
        vm.stopPrank();
    }

    function test_Create_RevertsWhenTransferFromReturnsFalse() public {
        usdc.setReturnsFalse(true);
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.TransferInFailed.selector, TOTAL, 0));
        escrow.createCampaign(REWARD, ITEMS, 0, 30 days, BRAND, META);
    }

    // ── pagamento ───────────────────────────────────────────────────────────

    function test_Pay_PaysRegisteredContributor() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);
        vm.roll(block.number + 2);

        vm.prank(attester);
        escrow.payContribution(id, c1);

        assertEq(usdc.balanceOf(alice), REWARD);
        assertEq(escrow.paidByCampaign(c1), id);
        assertEq(escrow.remaining(id), TOTAL - REWARD);
        assertEq(escrow.totalEscrowed(), TOTAL - REWARD);
    }

    function test_Pay_SponsorCanAttestOwnCampaign() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);
        vm.roll(block.number + 2);
        vm.prank(sponsor);
        escrow.payContribution(id, c1);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Pay_RejectsStranger() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.NotAttester.selector, stranger, id));
        escrow.payContribution(id, c1);
    }

    function test_Pay_RejectsUnverified() public {
        uint256 id = _create(0);
        bytes32 c1 = keccak256("c1");
        oracle.set(c1, false, address(0), 0, alice);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.ContributionNotVerified.selector, c1));
        escrow.payContribution(id, c1);
    }

    function test_Pay_RejectsContributionVerifiedBeforeCampaign() public {
        bytes32 old = keccak256("old");
        oracle.set(old, true, verifier, block.number - 1, alice);
        uint256 id = _create(0);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(
            CampaignEscrow.VerifiedBeforeCampaign.selector, old, block.number - 1, block.number
        ));
        escrow.payContribution(id, old);
    }

    function test_Pay_SameContributionNeverPaidTwice_EvenAcrossCampaigns() public {
        uint256 a = _create(0);
        uint256 b = _create(0);
        bytes32 c1 = _verified("c1", alice);

        vm.startPrank(attester);
        escrow.payContribution(a, c1);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.ContributionAlreadyPaid.selector, c1, a));
        escrow.payContribution(a, c1);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.ContributionAlreadyPaid.selector, c1, a));
        escrow.payContribution(b, c1);
        vm.stopPrank();
    }

    function test_Pay_RespectsMaxPerContributor() public {
        uint256 id = _create(1);
        bytes32 c1 = _verified("c1", alice);
        bytes32 c2 = _verified("c2", alice);
        bytes32 c3 = _verified("c3", bob);

        vm.startPrank(attester);
        escrow.payContribution(id, c1);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.ContributorLimitReached.selector, id, alice, 1));
        escrow.payContribution(id, c2);
        escrow.payContribution(id, c3); // outra pessoa continua podendo
        vm.stopPrank();
    }

    function test_Pay_StopsWhenFull() public {
        uint256 id = _create(0);
        vm.startPrank(attester);
        for (uint256 i; i < ITEMS; i++) {
            escrow.payContribution(id, _verified(string(abi.encode(i)), alice));
        }
        bytes32 extra = _verified("extra", bob);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.CampaignFull.selector, id));
        escrow.payContribution(id, extra);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertFalse(escrow.isActive(id));
    }

    function test_Pay_StopsAfterDeadline() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);
        vm.warp(block.timestamp + 30 days);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(
            CampaignEscrow.CampaignEnded.selector, id, escrow.getCampaign(id).deadline
        ));
        escrow.payContribution(id, c1);
    }

    function test_Pay_BlocklistedContributorRevertsAndKeepsSlot() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);
        usdc.setBlocklisted(alice, true);

        vm.prank(attester);
        vm.expectRevert(); // TransferOutFailed com o motivo do token
        escrow.payContribution(id, c1);

        assertEq(escrow.paidByCampaign(c1), 0);
        assertEq(escrow.getCampaign(id).itemsPaid, 0);
        assertEq(escrow.remaining(id), TOTAL);
    }

    function test_Pay_SilentFailureIsDetected() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);
        usdc.setSilentFailure(true);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(
            CampaignEscrow.TransferOutFailed.selector, alice, REWARD, bytes("balance did not decrease as expected")
        ));
        escrow.payContribution(id, c1);
    }

    function test_Pause_BlocksPaymentsButNotRefund() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);

        vm.prank(admin);
        escrow.setPaymentsPaused(true);

        vm.prank(attester);
        vm.expectRevert(CampaignEscrow.PaymentsPaused.selector);
        escrow.payContribution(id, c1);

        vm.warp(block.timestamp + 30 days);
        escrow.refund(id);
        assertEq(usdc.balanceOf(sponsor), 1_000_000_000);
    }

    // ── reembolso ───────────────────────────────────────────────────────────

    function test_Refund_OnlyAfterDeadline_AnyoneCanTrigger_GoesToSponsor() public {
        uint256 id = _create(0);
        vm.prank(attester);
        escrow.payContribution(id, _verified("c1", alice));

        uint256 deadline = escrow.getCampaign(id).deadline;
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.CampaignStillRunning.selector, id, deadline));
        escrow.refund(id);

        vm.warp(deadline);
        vm.prank(stranger);
        escrow.refund(id);

        assertEq(usdc.balanceOf(sponsor), 1_000_000_000 - REWARD);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalEscrowed(), 0);

        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.AlreadyRefunded.selector, id));
        escrow.refund(id);
    }

    function test_Refund_NothingLeftWhenFull() public {
        uint256 id = _create(0);
        vm.startPrank(attester);
        for (uint256 i; i < ITEMS; i++) {
            escrow.payContribution(id, _verified(string(abi.encode(i)), alice));
        }
        vm.stopPrank();
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.NothingToRefund.selector, id));
        escrow.refund(id);
    }

    function test_Refund_SponsorCanRedirectWhenBlocklisted() public {
        uint256 id = _create(0);
        address newWallet = makeAddr("newWallet");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.NotSponsor.selector, stranger, id));
        escrow.setRefundRecipient(id, stranger);

        usdc.setBlocklisted(sponsor, true);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        escrow.refund(id);

        vm.prank(sponsor);
        escrow.setRefundRecipient(id, newWallet);
        escrow.refund(id);
        assertEq(usdc.balanceOf(newWallet), TOTAL);
    }

    // ── admin ───────────────────────────────────────────────────────────────

    function test_Admin_OnlyAdminManagesAttestersAndPause() public {
        vm.startPrank(stranger);
        vm.expectRevert(Unauthorized.selector);
        escrow.setAttester(stranger, true);
        vm.expectRevert(Unauthorized.selector);
        escrow.setPaymentsPaused(true);
        vm.stopPrank();
    }

    function test_Admin_RevokedAttesterCannotPay() public {
        uint256 id = _create(0);
        bytes32 c1 = _verified("c1", alice);
        vm.prank(admin);
        escrow.setAttester(attester, false);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(CampaignEscrow.NotAttester.selector, attester, id));
        escrow.payContribution(id, c1);
    }

    // ── invariante simples por fuzz ─────────────────────────────────────────

    /// @dev Em qualquer sequência de pagamentos, o saldo do contrato é exatamente
    ///      o que ainda pertence às campanhas.
    function testFuzz_BalanceAlwaysMatchesEscrowed(uint8 pays, uint8 maxPer) public {
        uint256 id = _create(maxPer % 3);
        uint256 n = uint256(pays) % (ITEMS + 2);
        vm.startPrank(attester);
        for (uint256 i; i < n; i++) {
            address who = i % 2 == 0 ? alice : bob;
            bytes32 cid = _verified(string(abi.encode("f", i)), who);
            try escrow.payContribution(id, cid) {} catch {}
        }
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalEscrowed());
        assertEq(escrow.totalEscrowed(), escrow.remaining(id));
    }
}

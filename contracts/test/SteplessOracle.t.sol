// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — SteplessOracle.t.sol  (v5)
//
//  O foco aqui é QUEM pode verificar. Na v4, verifyContribution era
//  `onlyAuthorized`, o que dava poder de verificação a qualquer relayer
//  autorizado — e como o relayer também registra locais em nome dos usuários,
//  uma única chave fechava o ciclo registrar → verificar → pagar.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SteplessOracle.sol";
import "../src/RewardDistributor.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract SteplessOracleTest is Test {
    SteplessOracle public oracle;
    RewardDistributor public distributor;
    MockUSDC public usdc;

    address admin       = makeAddr("admin");
    address relayer     = makeAddr("relayer");
    address verifier    = makeAddr("verifier");
    address contributor = makeAddr("contributor");
    address attacker    = makeAddr("attacker");

    bytes32 constant LOC_1     = keccak256("location_1");
    bytes32 constant CONTRIB_1 = keccak256("contribution_1");

    // Coordenadas empacotadas: (lat + 90) * 1e6, (lng + 180) * 1e6
    uint256 constant LAT_PACKED = 66_450_000;  // -23.55
    uint256 constant LNG_PACKED = 133_360_000; // -46.64

    function setUp() public {
        usdc = new MockUSDC(6);

        // Memo em address(0): a rede de teste não tem o predeploy da Arc.
        oracle = new SteplessOracle(address(0), admin, address(0));
        distributor = new RewardDistributor(address(oracle), admin, address(usdc));

        vm.startPrank(admin);
        oracle.setRewardDistributor(address(distributor));
        oracle.setAuthorizedCaller(relayer, true);
        distributor.setVerifier(verifier, true);
        distributor.setAuthorizedCaller(relayer, true);
        vm.stopPrank();

        usdc.mint(address(distributor), 1_000_000_000);

        vm.startPrank(relayer);
        oracle.registerLocation(LOC_1, LAT_PACKED, LNG_PACKED, bytes32("data"), contributor);
        oracle.submitContribution(
            CONTRIB_1, LOC_1, SteplessOracle.ContributionType.NewLocation, bytes32("data"), contributor
        );
        vm.stopPrank();
    }

    // ── Registro ────────────────────────────────────────────────────────────

    function test_RegisterLocation_CreditsTheRealContributor() public view {
        SteplessOracle.Location memory loc = oracle.getLocation(LOC_1);
        assertTrue(loc.exists);
        assertEq(loc.firstContributor, contributor); // não o relayer
        assertEq(oracle.locationCount(), 1);
    }

    function test_RegisterLocation_RejectsDuplicates() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SteplessOracle.LocationAlreadyRegistered.selector, LOC_1));
        oracle.registerLocation(LOC_1, LAT_PACKED, LNG_PACKED, bytes32("data"), contributor);
    }

    function test_RegisterLocation_RejectsUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert(Unauthorized.selector);
        oracle.registerLocation(keccak256("x"), LAT_PACKED, LNG_PACKED, bytes32("d"), attacker);
    }

    /// O Memo é opcional: com address(0) o registro funciona normalmente.
    /// Isso é o que permite deployar em mainnet antes de a Circle publicar o
    /// endereço do predeploy.
    function test_MemoIsOptional() public view {
        assertEq(address(oracle.memo()), address(0));
        assertTrue(oracle.getLocation(LOC_1).exists);
    }

    // ── Verificação  [A4] ───────────────────────────────────────────────────

    function test_Verify_WorksForRegisteredVerifier() public {
        vm.prank(verifier);
        oracle.verifyContribution(CONTRIB_1, true, "");

        (bool verified, address who, ) = oracle.getContribution(CONTRIB_1);
        assertTrue(verified);
        assertEq(who, verifier);
    }

    /// [A4] O relayer é authorizedCaller do Oracle — na v4 isso bastava para
    /// verificar. Agora a autoridade vem do conjunto `verifiers` do
    /// distributor, e o relayer não está nele.
    function test_Verify_RejectsAuthorizedCallerThatIsNotAVerifier() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SteplessOracle.NotAVerifier.selector, relayer));
        oracle.verifyContribution(CONTRIB_1, true, "");
    }

    /// Nem o admin escapa: administrar não é verificar.
    function test_Verify_RejectsAdmin() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SteplessOracle.NotAVerifier.selector, admin));
        oracle.verifyContribution(CONTRIB_1, true, "");
    }

    function test_Verify_RejectsSelfVerification() public {
        vm.prank(admin);
        distributor.setVerifier(contributor, true);

        vm.prank(contributor);
        vm.expectRevert(SteplessOracle.SelfVerificationForbidden.selector);
        oracle.verifyContribution(CONTRIB_1, true, "");
    }

    function test_Verify_RejectsDoubleVerification() public {
        vm.prank(verifier);
        oracle.verifyContribution(CONTRIB_1, true, "");

        vm.roll(block.number + 20);
        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(SteplessOracle.AlreadyVerified.selector, CONTRIB_1));
        oracle.verifyContribution(CONTRIB_1, true, "");
    }

    function test_Verify_RevertsWhenDistributorNotSet() public {
        SteplessOracle fresh = new SteplessOracle(address(0), admin, address(0));
        vm.prank(admin);
        fresh.setAuthorizedCaller(relayer, true);

        vm.prank(verifier);
        vm.expectRevert(SteplessOracle.RewardDistributorNotSet.selector);
        fresh.verifyContribution(CONTRIB_1, true, "");
    }

    function test_Reject_RecordsReasonAndVerifier() public {
        vm.prank(verifier);
        oracle.verifyContribution(CONTRIB_1, false, "foto nao corresponde ao local");

        (, , , , bool verified, address who, , bool rejected, ) = _contribution(CONTRIB_1);
        assertFalse(verified);
        assertTrue(rejected);
        assertEq(who, verifier);
    }

    /// Sem limite, um verificador podia gravar kilobytes em storage às custas
    /// do gas de quem paga a transação.
    function test_Reject_RejectsOversizedReason() public {
        string memory long = new string(201);
        vm.prank(verifier);
        vm.expectRevert(
            abi.encodeWithSelector(SteplessOracle.RejectReasonTooLong.selector, 201, 200)
        );
        oracle.verifyContribution(CONTRIB_1, false, long);
    }

    // ── Ciclo completo ──────────────────────────────────────────────────────

    function test_FullLoop_RegisterVerifyPay() public {
        vm.prank(verifier);
        oracle.verifyContribution(CONTRIB_1, true, "");

        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        assertEq(usdc.balanceOf(contributor), 100_000);
    }

    /// O ataque que a auditoria descreve em C1: uma única chave que registra,
    /// verifica e paga. Com a v5, a etapa de verificação barra o relayer.
    function test_RelayerAloneCannotCompleteTheRewardLoop() public {
        bytes32 fake = keccak256("fake");
        bytes32 fakeLoc = keccak256("fakeLoc");

        vm.startPrank(relayer);
        oracle.registerLocation(fakeLoc, LAT_PACKED, LNG_PACKED, bytes32("d"), relayer);
        oracle.submitContribution(
            fake, fakeLoc, SteplessOracle.ContributionType.NewLocation, bytes32("d"), relayer
        );

        vm.expectRevert(abi.encodeWithSelector(SteplessOracle.NotAVerifier.selector, relayer));
        oracle.verifyContribution(fake, true, "");
        vm.stopPrank();

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ContributionNotVerified.selector, fake));
        distributor.payReward(fake, relayer, RewardType.NewLocation);
    }

    // ── Admin  [M3] ─────────────────────────────────────────────────────────

    function test_AdminTransfer_RequiresAcceptance() public {
        address multisig = makeAddr("multisig");
        vm.prank(admin);
        oracle.transferAdmin(multisig);
        assertEq(oracle.admin(), admin);

        vm.prank(multisig);
        oracle.acceptAdmin();
        assertEq(oracle.admin(), multisig);
    }

    // ── Helper ──────────────────────────────────────────────────────────────
    function _contribution(bytes32 id)
        internal
        view
        returns (
            bytes32, address, SteplessOracle.ContributionType, bytes32,
            bool, address, uint256, bool, string memory
        )
    {
        return oracle.contributions(id);
    }
}

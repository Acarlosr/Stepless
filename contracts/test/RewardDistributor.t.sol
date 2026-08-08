// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — RewardDistributor.t.sol  (v5)
//
//  Cobertura focada no dinheiro: quem pode tirar, quanto, e o que acontece
//  quando a transferência falha. Cada teste marcado [C#]/[A#]/[M#] fecha um
//  achado da auditoria de mainnet (docs/analise/auditoria-mainnet-2026-08-06.md).
//
//  Os testes usam MockUSDC, que reproduz blocklist, falha silenciosa e retorno
//  false. A v4 era testada com vm.mockCall respondendo sempre "true", então
//  nenhum caminho de falha era exercitado de verdade.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RewardDistributor.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

// ── Oracle falso ────────────────────────────────────────────────────────────
contract MockOracle is ISteplessOracle {
    mapping(bytes32 => bool) public verifiedMap;
    mapping(bytes32 => address) public verifierMap;
    mapping(bytes32 => address) public contributorMap;

    function setContribution(bytes32 id, bool v, address verifier, address contributor) external {
        verifiedMap[id] = v;
        verifierMap[id] = verifier;
        contributorMap[id] = contributor;
    }

    function getContribution(bytes32 id)
        external
        view
        returns (bool verified, address verifier, uint256 blockNumber)
    {
        return (verifiedMap[id], verifierMap[id], block.number);
    }

    function getContributor(bytes32 id) external view returns (address) {
        return contributorMap[id];
    }

    /// @dev Repassa para o distributor como se fosse o Oracle de verdade.
    function callRecordVerification(
        address distributor,
        bytes32 id,
        address verifier,
        address contributor
    ) external {
        RewardDistributor(payable(distributor)).recordVerification(id, verifier, contributor);
    }
}

contract RewardDistributorTest is Test {
    RewardDistributor public distributor;
    MockOracle public oracle;
    MockUSDC public usdc;

    address admin       = makeAddr("admin");
    address relayer     = makeAddr("relayer");
    address contributor = makeAddr("contributor");
    address verifier    = makeAddr("verifier");
    address attacker    = makeAddr("attacker");

    bytes32 constant CONTRIB_1 = keccak256("contribution_1");
    bytes32 constant CONTRIB_2 = keccak256("contribution_2");

    uint256 constant TREASURY = 1_000_000_000; // 1000 USDC

    function setUp() public {
        oracle = new MockOracle();
        usdc = new MockUSDC(6);
        distributor = new RewardDistributor(address(oracle), admin, address(usdc));

        usdc.mint(address(distributor), TREASURY);

        vm.startPrank(admin);
        distributor.setVerifier(verifier, true);
        distributor.setAuthorizedCaller(relayer, true);
        vm.stopPrank();

        oracle.setContribution(CONTRIB_1, true, verifier, contributor);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Construtor — validação do USDC  [C3]
    // ════════════════════════════════════════════════════════════════════════

    function test_Constructor_SetsState() public view {
        assertEq(distributor.admin(), admin);
        assertEq(address(distributor.oracle()), address(oracle));
        assertEq(address(distributor.USDC()), address(usdc));
        assertEq(distributor.treasuryBalance(), TREASURY);
    }

    /// [C3] O endereço de USDC de testnet não tem código em mainnet. Sem esta
    /// checagem, `.call` para um endereço vazio retorna success=true e o
    /// contrato "pagaria" recompensas no vazio.
    function test_Constructor_RevertsOnUsdcWithoutCode() public {
        address empty = makeAddr("noCode");
        vm.expectRevert(abi.encodeWithSelector(InvalidUsdc.selector, empty));
        new RewardDistributor(address(oracle), admin, empty);
    }

    function test_Constructor_RevertsOnWrongDecimals() public {
        MockUSDC wrong = new MockUSDC(18);
        vm.expectRevert(abi.encodeWithSelector(InvalidUsdc.selector, address(wrong)));
        new RewardDistributor(address(oracle), admin, address(wrong));
    }

    function test_Constructor_RevertsOnZeroAddresses() public {
        vm.expectRevert(ZeroAddress.selector);
        new RewardDistributor(address(0), admin, address(usdc));

        vm.expectRevert(ZeroAddress.selector);
        new RewardDistributor(address(oracle), admin, address(0));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  payReward
    // ════════════════════════════════════════════════════════════════════════

    function test_PayReward_PaysContributor() public {
        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        assertEq(usdc.balanceOf(contributor), 100_000);
        assertTrue(distributor.rewardClaimed(CONTRIB_1));
        assertEq(distributor.totalEarned(contributor), 100_000);
        assertEq(distributor.contributionCount(contributor), 1);
    }

    /// [M4] Antes, um chamador autorizado podia direcionar a recompensa de
    /// qualquer contribuição verificada para o endereço que quisesse.
    function test_PayReward_RevertsWhenRecipientIsNotTheRegisteredContributor() public {
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(ContributorMismatch.selector, CONTRIB_1, contributor, attacker)
        );
        distributor.payReward(CONTRIB_1, attacker, RewardType.NewLocation);

        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_PayReward_RevertsWhenNotVerified() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ContributionNotVerified.selector, CONTRIB_2));
        distributor.payReward(CONTRIB_2, contributor, RewardType.NewLocation);
    }

    function test_PayReward_IsIdempotent() public {
        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RewardAlreadyClaimed.selector, CONTRIB_1));
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        assertEq(usdc.balanceOf(contributor), 100_000);
    }

    function test_PayReward_RevertsForUnauthorizedCaller() public {
        vm.prank(attacker);
        vm.expectRevert(Unauthorized.selector);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
    }

    function test_PayReward_RevertsWhenPaused() public {
        vm.prank(admin);
        distributor.setPaused(true);

        vm.prank(relayer);
        vm.expectRevert(Paused.selector);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
    }

    function test_PayReward_RevertsOnInsufficientTreasury() public {
        // Esvazia a tesouraria via saque com timelock.
        vm.prank(admin);
        distributor.requestWithdrawal(TREASURY, admin);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        distributor.executeWithdrawal();

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(InsufficientTreasury.selector, 100_000, 0));
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Falha de transferência e reenvio  [A2][A3]
    // ════════════════════════════════════════════════════════════════════════

    /// [A3] Na v4 a recompensa era marcada como paga e o USDC nunca saía —
    /// o contribuidor perdia o valor sem nenhum caminho automático de volta.
    function test_FailedTransfer_IsRecordedAndRetryable() public {
        usdc.setBlocklisted(contributor, true);

        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        // Marcado como pago, mas o dinheiro não saiu — e ficou registrado.
        assertTrue(distributor.rewardClaimed(CONTRIB_1));
        assertEq(usdc.balanceOf(contributor), 0);

        (address recipient, uint256 amount) = distributor.getFailedReward(CONTRIB_1);
        assertEq(recipient, contributor);
        assertEq(amount, 100_000);
        assertEq(distributor.totalFailedPending(), 100_000);

        // Saiu da blocklist: qualquer um pode destravar o pagamento.
        usdc.setBlocklisted(contributor, false);
        vm.prank(attacker); // permissionless de propósito
        distributor.retryReward(CONTRIB_1);

        assertEq(usdc.balanceOf(contributor), 100_000);
        (, uint256 after_) = distributor.getFailedReward(CONTRIB_1);
        assertEq(after_, 0);
        assertEq(distributor.totalFailedPending(), 0);
    }

    /// [A2] A v4 aceitava valor e destinatário livres — era um saque arbitrário
    /// disfarçado de retry. Agora não há nada a escolher.
    function test_RetryReward_RevertsWhenThereIsNoRecordedFailure() public {
        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(NoFailedReward.selector, CONTRIB_1));
        distributor.retryReward(CONTRIB_1);
    }

    /// Retry que falha de novo tem que voltar para a fila, não sumir.
    function test_RetryReward_ReRecordsWhenItFailsAgain() public {
        usdc.setBlocklisted(contributor, true);
        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        distributor.retryReward(CONTRIB_1); // ainda bloqueado

        (address recipient, uint256 amount) = distributor.getFailedReward(CONTRIB_1);
        assertEq(recipient, contributor);
        assertEq(amount, 100_000);
        assertEq(distributor.totalFailedPending(), 100_000);
    }

    /// O quirk que a checagem de saldo do _safeTransfer existe para pegar:
    /// transfer retorna true e não move nada.
    function test_SilentTransferFailure_IsCaught() public {
        usdc.setSilentFailure(true);

        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        assertEq(usdc.balanceOf(contributor), 0);
        (, uint256 amount) = distributor.getFailedReward(CONTRIB_1);
        assertEq(amount, 100_000);
    }

    function test_TransferReturningFalse_IsCaught() public {
        usdc.setReturnsFalse(true);

        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        (, uint256 amount) = distributor.getFailedReward(CONTRIB_1);
        assertEq(amount, 100_000);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Saque com timelock  [A1][C1]
    // ════════════════════════════════════════════════════════════════════════

    function test_Withdrawal_RequiresTheFullDelay() public {
        vm.prank(admin);
        distributor.requestWithdrawal(500_000, admin);

        vm.prank(admin);
        vm.expectRevert();
        distributor.executeWithdrawal();

        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        distributor.executeWithdrawal();

        assertEq(usdc.balanceOf(admin), 500_000);
    }

    function test_Withdrawal_CanBeCancelled() public {
        vm.prank(admin);
        distributor.requestWithdrawal(500_000, admin);
        vm.prank(admin);
        distributor.cancelWithdrawal();

        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        vm.expectRevert(NoPendingWithdrawal.selector);
        distributor.executeWithdrawal();
    }

    function test_Withdrawal_RevertsForNonAdmin() public {
        vm.prank(attacker);
        vm.expectRevert(Unauthorized.selector);
        distributor.requestWithdrawal(TREASURY, attacker);
    }

    /// [A1] A v4 tinha recoverNativeUSDC(), que apesar do nome transferia o
    /// saldo ERC-20 INTEIRO, sem limite, sem timelock e sem evento de saque.
    /// Este teste trava a ausência dela: se alguém reintroduzir uma função de
    /// saque instantâneo, ele quebra.
    function test_NoInstantDrainFunctionExists() public {
        // recoverNativeUSDC(address) — seletor da função removida na v5.
        (bool ok, ) = address(distributor).call(
            abi.encodeWithSignature("recoverNativeUSDC(address)", admin)
        );
        assertFalse(ok, "funcao de saque instantaneo nao deve existir");
        assertEq(usdc.balanceOf(address(distributor)), TREASURY);
    }

    /// Teto por recompensa: impede transformar setRewardAmount num saque.
    function test_SetRewardAmount_IsCapped() public {
        vm.prank(admin);
        vm.expectRevert(InvalidRewardAmount.selector);
        distributor.setRewardAmount(RewardType.NewLocation, TREASURY);

        vm.prank(admin);
        distributor.setRewardAmount(RewardType.NewLocation, 200_000);
        assertEq(distributor.getRewardAmount(RewardType.NewLocation), 200_000);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Verificadores  [A4][M1][M2]
    // ════════════════════════════════════════════════════════════════════════

    /// [A4] Na v4, recordVerification era `onlyAuthorized`, então o relayer —
    /// que está nessa lista — podia registrar verificações pulando o Oracle.
    function test_RecordVerification_OnlyOracleCanCall() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(OnlyOracle.selector, relayer));
        distributor.recordVerification(CONTRIB_1, verifier, contributor);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(OnlyOracle.selector, admin));
        distributor.recordVerification(CONTRIB_1, verifier, contributor);
    }

    function test_RecordVerification_RejectsSelfVerification() public {
        vm.expectRevert(
            abi.encodeWithSelector(DuplicateVerifier.selector, verifier, CONTRIB_1)
        );
        oracle.callRecordVerification(address(distributor), CONTRIB_1, verifier, verifier);
    }

    function test_RecordVerification_EnforcesCooldown() public {
        oracle.callRecordVerification(address(distributor), CONTRIB_1, verifier, contributor);

        vm.expectRevert();
        oracle.callRecordVerification(address(distributor), CONTRIB_2, verifier, contributor);

        vm.roll(block.number + 10);
        oracle.callRecordVerification(address(distributor), CONTRIB_2, verifier, contributor);
    }

    /// [M2] A v4 só permitia remover verificador via slashVerifier, que zerava
    /// o totalEarned. Quem sai da equipe não é fraudador.
    function test_SetVerifier_RemovesWithoutPunishing() public {
        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);
        uint256 earnedBefore = distributor.totalEarned(contributor);

        vm.prank(admin);
        distributor.setVerifier(contributor, true);
        vm.prank(admin);
        distributor.setVerifier(contributor, false);

        assertFalse(distributor.verifiers(contributor));
        assertEq(distributor.totalEarned(contributor), earnedBefore);
    }

    function test_SlashVerifier_RevokesAndZeroesEarnings() public {
        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        vm.prank(admin);
        distributor.setVerifier(contributor, true);
        vm.prank(admin);
        distributor.slashVerifier(contributor, "fraude");

        assertFalse(distributor.verifiers(contributor));
        assertEq(distributor.totalEarned(contributor), 0);
    }

    /// [M1] autoPromoteVerifier() era pública: 20 contribuições pagas promoviam
    /// qualquer endereço a verificador.
    function test_NoSelfPromotionFunctionExists() public {
        (bool ok, ) = address(distributor).call(
            abi.encodeWithSignature("autoPromoteVerifier(address)", attacker)
        );
        assertFalse(ok, "auto-promocao nao deve existir");
        assertFalse(distributor.verifiers(attacker));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Admin em duas fases  [M3]
    // ════════════════════════════════════════════════════════════════════════

    /// [M3] A v1 do projeto foi perdida por um transferAdmin de uma fase.
    function test_AdminTransfer_RequiresAcceptance() public {
        address multisig = makeAddr("multisig");

        vm.prank(admin);
        distributor.transferAdmin(multisig);

        // Nada mudou ainda.
        assertEq(distributor.admin(), admin);
        assertEq(distributor.pendingAdmin(), multisig);

        vm.prank(multisig);
        distributor.acceptAdmin();
        assertEq(distributor.admin(), multisig);
        assertEq(distributor.pendingAdmin(), address(0));
    }

    function test_AdminTransfer_ToWrongAddressIsRecoverable() public {
        address typo = makeAddr("enderecoErrado");

        vm.prank(admin);
        distributor.transferAdmin(typo);

        // O endereço errado nunca aceita — o admin atual segue no controle
        // e pode simplesmente cancelar.
        vm.prank(admin);
        distributor.transferAdmin(address(0));
        assertEq(distributor.admin(), admin);
        assertEq(distributor.pendingAdmin(), address(0));
    }

    function test_AcceptAdmin_RevertsForNonPending() public {
        vm.prank(admin);
        distributor.transferAdmin(makeAddr("multisig"));

        vm.prank(attacker);
        vm.expectRevert(Unauthorized.selector);
        distributor.acceptAdmin();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Lote  [M5]
    // ════════════════════════════════════════════════════════════════════════

    function test_BatchPayRewards_ProcessesAll() public {
        address c2 = makeAddr("contributor2");
        oracle.setContribution(CONTRIB_2, true, verifier, c2);

        bytes32[] memory ids = new bytes32[](2);
        address[] memory tos = new address[](2);
        RewardType[] memory types = new RewardType[](2);
        ids[0] = CONTRIB_1; tos[0] = contributor; types[0] = RewardType.NewLocation;
        ids[1] = CONTRIB_2; tos[1] = c2;          types[1] = RewardType.QualityPhoto;

        vm.prank(relayer);
        distributor.batchPayRewards(ids, tos, types);

        assertEq(usdc.balanceOf(contributor), 100_000);
        assertEq(usdc.balanceOf(c2), 20_000);
    }

    /// Um destinatário trocado no lote é pulado, não pago.
    function test_BatchPayRewards_SkipsContributorMismatch() public {
        bytes32[] memory ids = new bytes32[](1);
        address[] memory tos = new address[](1);
        RewardType[] memory types = new RewardType[](1);
        ids[0] = CONTRIB_1; tos[0] = attacker; types[0] = RewardType.NewLocation;

        vm.prank(relayer);
        distributor.batchPayRewards(ids, tos, types);

        assertEq(usdc.balanceOf(attacker), 0);
        assertFalse(distributor.rewardClaimed(CONTRIB_1));
    }

    /// [M5] Sem teto, o loop estoura o gas do bloco e reverte o lote inteiro.
    function test_BatchPayRewards_RejectsOversizedBatch() public {
        uint256 n = 51;
        bytes32[] memory ids = new bytes32[](n);
        address[] memory tos = new address[](n);
        RewardType[] memory types = new RewardType[](n);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(BatchTooLarge.selector, n, 50));
        distributor.batchPayRewards(ids, tos, types);
    }

    function test_BatchPayRewards_RejectsMismatchedArrays() public {
        bytes32[] memory ids = new bytes32[](2);
        address[] memory tos = new address[](1);
        RewardType[] memory types = new RewardType[](2);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArrayLengthMismatch.selector, 2, 1, 2));
        distributor.batchPayRewards(ids, tos, types);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Tesouraria
    // ════════════════════════════════════════════════════════════════════════

    function test_FundTreasury_MovesUsdcIn() public {
        address funder = makeAddr("funder");
        usdc.mint(funder, 1_000_000);

        vm.startPrank(funder);
        usdc.approve(address(distributor), 1_000_000);
        distributor.fundTreasury(1_000_000);
        vm.stopPrank();

        assertEq(distributor.treasuryBalance(), TREASURY + 1_000_000);
    }

    function test_AvailableBalance_ExcludesPendingFailures() public {
        usdc.setBlocklisted(contributor, true);
        vm.prank(relayer);
        distributor.payReward(CONTRIB_1, contributor, RewardType.NewLocation);

        assertEq(distributor.treasuryBalance(), TREASURY);
        assertEq(distributor.availableBalance(), TREASURY - 100_000);
    }

    function test_Receive_RejectsNativeSends() public {
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        (bool ok, ) = address(distributor).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Invariante
    // ════════════════════════════════════════════════════════════════════════

    /// Nunca se paga mais do que entrou. Fuzz sobre a quantidade de
    /// contribuições pagas.
    function testFuzz_NeverPaysMoreThanFunded(uint8 count) public {
        vm.assume(count > 0 && count <= 40);

        uint256 paid;
        for (uint256 i = 0; i < count; i++) {
            bytes32 id = keccak256(abi.encodePacked("c", i));
            address who = address(uint160(uint256(keccak256(abi.encodePacked("w", i)))));
            oracle.setContribution(id, true, verifier, who);

            vm.prank(relayer);
            distributor.payReward(id, who, RewardType.NewLocation);
            paid += 100_000;
        }

        assertEq(usdc.balanceOf(address(distributor)), TREASURY - paid);
        assertLe(paid, TREASURY);
    }
}

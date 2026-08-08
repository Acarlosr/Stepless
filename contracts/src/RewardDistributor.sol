// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — RewardDistributor.sol  (v5 — mainnet-ready)
//  Distribuição de micro-recompensas em USDC por contribuições de acessibilidade.
//
//  Construído sobre a Arc (L1 stablecoin-native da Circle) — USDC é o gas nativo.
//
//  Particularidades da Arc consideradas neste contrato:
//    1. USDC é nativo (18 decimais) E ERC-20 (6 decimais) — MESMO ativo.
//       Este contrato usa a interface ERC-20 (6 dec) em todas as transferências,
//       para manter os valores intuitivos ($0.10 = 100_000).
//    2. Transferências podem reverter mesmo com saldo suficiente (blocklist,
//       endereço zero, burn, drenagem de conta vazia). Todo envio é protegido.
//    3. Nunca parear USDC nativo com USDC ERC-20 — são o mesmo ativo.
//    4. PREVRANDAO retorna 0 na Arc — sem aleatoriedade on-chain.
//    5. SELFDESTRUCT é evitado por completo.
//    6. block.timestamp não é estritamente crescente (blocos sub-segundo
//       compartilham timestamp) — block.number é usado para ordenação.
//
//  ── Mudanças da v4 para a v5 (auditoria de mainnet, 2026-08-06) ────────────
//   1. USDC virou `immutable` recebido no construtor, com validação de que há
//      código no endereço e que decimals() == 6. O 0x3600… é da TESTNET e a
//      Circle ainda não publicou o de mainnet. Como `constant`, um endereço
//      errado seria impossível de corrigir — e pior: `.call` para um endereço
//      SEM CÓDIGO retorna success=true, então o contrato marcaria a recompensa
//      como paga e emitiria RewardPaid sem mover um centavo.
//   2. recoverNativeUSDC() REMOVIDA. Apesar do nome, ela transferia o saldo
//      ERC-20 INTEIRO — era um segundo caminho de saque total, sem limite e
//      sem evento. E era redundante: na Arc o saldo nativo e o ERC-20 são o
//      mesmo, então withdrawTreasury() já alcança fundos enviados à força.
//   3. retryReward() não aceita mais valor e destinatário arbitrários. Agora lê
//      de failedRewards[], preenchido quando uma transferência de fato falha,
//      e é PERMISSIONLESS — o destino é fixo, então não há motivo para exigir
//      admin. Antes, o admin podia reenviar qualquer valor, quantas vezes
//      quisesse, para qualquer endereço.
//   4. Saques passaram a ter timelock de 48h (request → execute), para que um
//      saque anômalo seja visível antes de ser irreversível.
//   5. autoPromoteVerifier() REMOVIDA (sybil barato). Verificador agora entra e
//      sai por setVerifier(addr, bool) — remoção neutra, sem punição embutida.
//   6. payReward() confere que o destinatário é o contribuidor registrado no
//      Oracle, em vez de aceitar qualquer endereço do chamador autorizado.
//   7. recordVerification() só aceita chamada vinda do Oracle.
//   8. Admin em duas fases + guarda de reentrância.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import {Admin2Step, Unauthorized, ZeroAddress} from "./lib/Admin2Step.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

// ────────────────────────────────────────────────────────────────────────────
//  Interfaces
// ────────────────────────────────────────────────────────────────────────────

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

interface ISteplessOracle {
    function getContribution(bytes32 contributionId)
        external
        view
        returns (bool verified, address verifier, uint256 blockNumber);
    function getContributor(bytes32 contributionId) external view returns (address);
}

// ────────────────────────────────────────────────────────────────────────────
//  Errors
// ────────────────────────────────────────────────────────────────────────────

error ContributionNotVerified(bytes32 contributionId);
error RewardAlreadyClaimed(bytes32 contributionId);
error InsufficientTreasury(uint256 needed, uint256 available);
error RewardTransferFailed(bytes32 contributionId, address recipient, bytes reason);
error InvalidRewardAmount();
error Paused();
error DuplicateVerifier(address verifier, bytes32 contributionId);
error CooldownActive(uint256 blockNumber, uint256 unlockBlock);
error ArrayLengthMismatch(uint256 contributionIdsLength, uint256 contributorsLength, uint256 rewardTypesLength);
/// @dev Lote grande demais — o loop estouraria o gas do bloco e reverteria tudo.
error BatchTooLarge(uint256 length, uint256 max);
/// @dev O destinatário informado não é o contribuidor registrado no Oracle.
error ContributorMismatch(bytes32 contributionId, address expected, address provided);
/// @dev O endereço passado como USDC não tem código, ou não usa 6 decimais.
error InvalidUsdc(address usdc);
/// @dev Só o Oracle pode registrar verificações.
error OnlyOracle(address caller);
/// @dev Não há recompensa falha registrada para esta contribuição.
error NoFailedReward(bytes32 contributionId);
/// @dev Timelock de saque: não existe pedido, ou ainda não amadureceu.
error NoPendingWithdrawal();
error WithdrawalNotReady(uint256 nowTs, uint256 readyAt);

// ────────────────────────────────────────────────────────────────────────────
//  Events (indexados para Goldsky / monitores)
// ────────────────────────────────────────────────────────────────────────────

event RewardPaid(
    bytes32 indexed contributionId,
    address indexed recipient,
    uint256 amount,
    RewardType rewardType,
    uint256 blockNumber
);

event RewardFailed(
    bytes32 indexed contributionId,
    address indexed recipient,
    uint256 amount,
    bytes reason
);

event RewardRecovered(bytes32 indexed contributionId, address indexed recipient, uint256 amount);

event TreasuryFunded(address indexed funder, uint256 amount, uint256 newBalance);
event TreasuryWithdrawn(address indexed admin, address indexed to, uint256 amount, uint256 newBalance);

event WithdrawalRequested(address indexed admin, address indexed to, uint256 amount, uint256 readyAt);
event WithdrawalCancelled(address indexed admin);

event RewardAmountUpdated(RewardType indexed rewardType, uint256 oldAmount, uint256 newAmount);

event VerifierUpdated(address indexed verifier, bool authorized, uint256 blockNumber);
event VerifierSlashed(address indexed verifier, uint256 slashedAmount, string reason);

event AuthorizedCallerUpdated(address indexed caller, bool authorized);

event PausedEvent(address indexed admin);
event UnpausedEvent(address indexed admin);

// ────────────────────────────────────────────────────────────────────────────
//  Enums
// ────────────────────────────────────────────────────────────────────────────

enum RewardType {
    NewLocation,        // +$0.10 USDC
    Verification,       // +$0.05 USDC
    QualityPhoto,       // +$0.02 USDC
    LocationUpdate,     // +$0.03 USDC
    TopContributorBonus // +$5.00 USDC
}

// ────────────────────────────────────────────────────────────────────────────
//  Contract
// ────────────────────────────────────────────────────────────────────────────

contract RewardDistributor is Admin2Step, ReentrancyGuard {
    // ════════════════════════════════════════════════════════════════════════
    //  Immutable State
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Interface ERC-20 do USDC na rede em uso.
    /// @dev    immutable, NÃO constant — o endereço muda entre testnet e mainnet.
    ///         Validado no construtor: precisa ter código e usar 6 decimais.
    IERC20 public immutable USDC;

    /// @notice Decimais da interface ERC-20 do USDC (checado no construtor).
    uint8 public constant USDC_DECIMALS = 6;

    /// @notice SteplessOracle, para checagens de verificação.
    ISteplessOracle public immutable oracle;

    // ════════════════════════════════════════════════════════════════════════
    //  Valores de recompensa (unidades de 6 decimais)
    //  $0.10 = 100_000 | $0.05 = 50_000 | $0.02 = 20_000
    //  $0.03 = 30_000  | $5.00 = 5_000_000
    // ════════════════════════════════════════════════════════════════════════

    uint256 public rewardNewLocation       = 100_000;   // $0.10
    uint256 public rewardVerification      = 50_000;    // $0.05
    uint256 public rewardQualityPhoto      = 20_000;    // $0.02
    uint256 public rewardLocationUpdate    = 30_000;    // $0.03
    uint256 public rewardTopContributor    = 5_000_000; // $5.00

    /// @notice Teto por recompensa individual. Um admin comprometido não
    ///         consegue transformar setRewardAmount() num saque disfarçado.
    uint256 public constant MAX_REWARD_AMOUNT = 100_000_000; // $100

    // ════════════════════════════════════════════════════════════════════════
    //  Controle de acesso
    // ════════════════════════════════════════════════════════════════════════

    mapping(address => bool) public verifiers;          // conjunto de verificadores
    mapping(address => bool) public authorizedCallers;  // relayer, backend, etc.

    // ════════════════════════════════════════════════════════════════════════
    //  Anti-double-spend e reputação
    // ════════════════════════════════════════════════════════════════════════

    mapping(bytes32 => bool) public rewardClaimed;
    mapping(address => uint256) public totalEarned;
    mapping(address => uint256) public contributionCount;
    mapping(address => uint256) public verificationCount;
    mapping(address => uint256) public lastVerificationBlock;
    mapping(bytes32 => address) public contributionVerifier;
    mapping(bytes32 => RewardType) public contributionRewardType;

    /// @notice Recompensas cuja transferência falhou e podem ser reenviadas.
    /// @dev    Sem este registro, retryReward() não tinha como saber QUANTO
    ///         reenviar nem PARA QUEM — e por isso aceitava os dois como
    ///         parâmetro livre do admin, virando um saque arbitrário.
    struct FailedReward {
        address recipient;
        uint256 amount;
    }
    mapping(bytes32 => FailedReward) public failedRewards;

    /// @notice Total já reservado para recompensas que falharam e não foram
    ///         reenviadas. Serve para o operador saber quanto do saldo não é
    ///         livre.
    uint256 public totalFailedPending;

    // ════════════════════════════════════════════════════════════════════════
    //  Resistência a Sybil
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Blocos mínimos entre verificações do mesmo verificador.
    /// @dev    Bloco da Arc ~0.48s, então 10 blocos ≈ 4.8 segundos.
    uint256 public constant VERIFIER_COOLDOWN_BLOCKS = 10;

    /// @notice Máximo de itens por batchPayRewards.
    uint256 public constant MAX_BATCH_SIZE = 50;

    // ════════════════════════════════════════════════════════════════════════
    //  Timelock de saque
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Espera obrigatória entre pedir e executar um saque.
    /// @dev    Usa block.timestamp e não block.number de propósito: o alerta do
    ///         projeto sobre timestamps não-monotônicos vale para ORDENAR
    ///         eventos em blocos sub-segundo, não para medir 48 horas. Em
    ///         contrapartida, block.number depende do tempo de bloco continuar
    ///         em 0.48s — uma premissa que não quero embutir num contrato de
    ///         mainnet.
    uint256 public constant WITHDRAWAL_DELAY = 48 hours;

    struct PendingWithdrawal {
        address to;
        uint256 amount;
        uint256 readyAt;
    }
    PendingWithdrawal public pendingWithdrawal;

    // ════════════════════════════════════════════════════════════════════════
    //  Pausable
    // ════════════════════════════════════════════════════════════════════════

    bool public paused;

    // ════════════════════════════════════════════════════════════════════════
    //  Modifiers
    // ════════════════════════════════════════════════════════════════════════

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier notPaused() {
        if (paused) revert Paused();
        _;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Constructor
    // ════════════════════════════════════════════════════════════════════════

    /// @param _oracle  Endereço do SteplessOracle já deployado.
    /// @param _admin   Multisig em produção.
    /// @param _usdc    Interface ERC-20 do USDC na rede alvo.
    constructor(address _oracle, address _admin, address _usdc) Admin2Step(_admin) {
        if (_oracle == address(0)) revert ZeroAddress();
        if (_usdc == address(0)) revert ZeroAddress();

        // Sem isto, um endereço de USDC errado (ex.: o de testnet usado em
        // mainnet) passaria despercebido: `.call` para endereço sem código
        // retorna success=true e o contrato "pagaria" recompensas no vazio.
        if (_usdc.code.length == 0) revert InvalidUsdc(_usdc);
        try IERC20(_usdc).decimals() returns (uint8 d) {
            if (d != USDC_DECIMALS) revert InvalidUsdc(_usdc);
        } catch {
            revert InvalidUsdc(_usdc);
        }

        oracle = ISteplessOracle(_oracle);
        USDC = IERC20(_usdc);
        authorizedCallers[_admin] = true;
        emit AuthorizedCallerUpdated(_admin, true);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Tesouraria
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Fundeia a tesouraria via ERC-20 transferFrom.
    /// @dev    O chamador precisa ter aprovado este contrato antes.
    function fundTreasury(uint256 amount) external notPaused nonReentrant {
        if (amount == 0) revert InvalidRewardAmount();

        bool success = USDC.transferFrom(msg.sender, address(this), amount);
        if (!success) revert RewardTransferFailed(
            bytes32(0), msg.sender, "treasury funding transferFrom failed"
        );

        emit TreasuryFunded(msg.sender, amount, USDC.balanceOf(address(this)));
    }

    /// @notice Fase 1 do saque — registra a intenção e inicia a espera de 48h.
    /// @dev    Um pedido novo substitui o anterior e reinicia o relógio.
    function requestWithdrawal(uint256 amount, address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidRewardAmount();

        uint256 readyAt = block.timestamp + WITHDRAWAL_DELAY;
        pendingWithdrawal = PendingWithdrawal({ to: to, amount: amount, readyAt: readyAt });
        emit WithdrawalRequested(msg.sender, to, amount, readyAt);
    }

    /// @notice Cancela o saque pendente.
    function cancelWithdrawal() external onlyAdmin {
        if (pendingWithdrawal.readyAt == 0) revert NoPendingWithdrawal();
        delete pendingWithdrawal;
        emit WithdrawalCancelled(msg.sender);
    }

    /// @notice Fase 2 do saque — executa depois da espera.
    function executeWithdrawal() external onlyAdmin nonReentrant {
        PendingWithdrawal memory w = pendingWithdrawal;
        if (w.readyAt == 0) revert NoPendingWithdrawal();
        if (block.timestamp < w.readyAt) revert WithdrawalNotReady(block.timestamp, w.readyAt);

        uint256 balance = USDC.balanceOf(address(this));
        if (w.amount > balance) revert InsufficientTreasury(w.amount, balance);

        delete pendingWithdrawal;

        (bool ok, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(IERC20.transfer.selector, w.to, w.amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert RewardTransferFailed(bytes32(0), w.to, data);
        }

        emit TreasuryWithdrawn(msg.sender, w.to, w.amount, USDC.balanceOf(address(this)));
    }

    /// @notice Saldo atual da tesouraria em USDC de 6 decimais.
    function treasuryBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    /// @notice Saldo livre — desconta o que está reservado para reenvios falhos.
    function availableBalance() external view returns (uint256) {
        uint256 balance = USDC.balanceOf(address(this));
        return balance > totalFailedPending ? balance - totalFailedPending : 0;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Core: pagamento de recompensas
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Paga a recompensa de uma contribuição verificada.
    /// @dev    Idempotente — cada contributionId só é pago uma vez.
    function payReward(
        bytes32 contributionId,
        address contributor,
        RewardType rewardType
    ) external onlyAuthorized notPaused nonReentrant {
        if (contributor == address(0)) revert ZeroAddress();
        if (rewardClaimed[contributionId]) revert RewardAlreadyClaimed(contributionId);

        (bool verified, , ) = oracle.getContribution(contributionId);
        if (!verified) revert ContributionNotVerified(contributionId);

        // v5: o destinatário tem que ser quem o Oracle registrou como
        // contribuidor. Antes, um chamador autorizado podia direcionar a
        // recompensa de qualquer contribuição verificada para si mesmo.
        address registered = oracle.getContributor(contributionId);
        if (registered != contributor) {
            revert ContributorMismatch(contributionId, registered, contributor);
        }

        uint256 amount = _getRewardAmount(rewardType);
        if (amount == 0) revert InvalidRewardAmount();

        uint256 balance = USDC.balanceOf(address(this));
        if (balance < amount) revert InsufficientTreasury(amount, balance);

        // Marca antes de transferir (checks-effects-interactions).
        rewardClaimed[contributionId] = true;
        contributionRewardType[contributionId] = rewardType;

        totalEarned[contributor] += amount;
        if (rewardType == RewardType.Verification) {
            verificationCount[contributor]++;
        } else {
            contributionCount[contributor]++;
        }

        if (_safeTransfer(contributor, amount, contributionId)) {
            emit RewardPaid(contributionId, contributor, amount, rewardType, block.number);
        }
    }

    /// @notice Paga várias recompensas numa transação só.
    /// @dev    Cada item é independente — uma falha não reverte o lote.
    function batchPayRewards(
        bytes32[] calldata contributionIds,
        address[] calldata contributors,
        RewardType[] calldata rewardTypes
    ) external onlyAuthorized notPaused nonReentrant {
        uint256 len = contributionIds.length;
        if (len != contributors.length || len != rewardTypes.length) {
            revert ArrayLengthMismatch(len, contributors.length, rewardTypes.length);
        }
        if (len > MAX_BATCH_SIZE) revert BatchTooLarge(len, MAX_BATCH_SIZE);

        for (uint256 i = 0; i < len; i++) {
            bytes32 id = contributionIds[i];
            address to = contributors[i];

            if (rewardClaimed[id]) continue;

            (bool verified, , ) = oracle.getContribution(id);
            if (!verified) {
                emit RewardFailed(id, to, 0, "contribution not verified");
                continue;
            }
            if (oracle.getContributor(id) != to) {
                emit RewardFailed(id, to, 0, "contributor mismatch");
                continue;
            }

            uint256 amount = _getRewardAmount(rewardTypes[i]);
            if (amount == 0) {
                emit RewardFailed(id, to, 0, "invalid reward amount");
                continue;
            }

            uint256 balance = USDC.balanceOf(address(this));
            if (balance < amount) {
                emit RewardFailed(id, to, amount, "insufficient treasury");
                continue; // não reverte — processa o resto
            }

            rewardClaimed[id] = true;
            contributionRewardType[id] = rewardTypes[i];

            totalEarned[to] += amount;
            if (rewardTypes[i] == RewardType.Verification) {
                verificationCount[to]++;
            } else {
                contributionCount[to]++;
            }

            if (_safeTransfer(to, amount, id)) {
                emit RewardPaid(id, to, amount, rewardTypes[i], block.number);
            }
        }
    }

    /// @notice Reenvia uma recompensa cuja transferência falhou.
    /// @dev    v5: SEM parâmetros de valor e destinatário. Ambos vêm de
    ///         failedRewards[], gravado no momento da falha. Por isso a função
    ///         pode ser permissionless: não há nada a escolher, então não há
    ///         nada que um admin comprometido possa desviar.
    ///
    ///         Caso de uso real: o destinatário estava na blocklist da Arc e
    ///         saiu, ou a falha foi transitória.
    function retryReward(bytes32 contributionId) external notPaused nonReentrant {
        FailedReward memory f = failedRewards[contributionId];
        if (f.amount == 0) revert NoFailedReward(contributionId);

        uint256 balance = USDC.balanceOf(address(this));
        if (balance < f.amount) revert InsufficientTreasury(f.amount, balance);

        // Limpa antes de transferir; se falhar de novo, _safeTransfer regrava.
        delete failedRewards[contributionId];
        totalFailedPending -= f.amount;

        if (_safeTransfer(f.recipient, f.amount, contributionId)) {
            emit RewardRecovered(contributionId, f.recipient, f.amount);
            emit RewardPaid(
                contributionId,
                f.recipient,
                f.amount,
                contributionRewardType[contributionId],
                block.number
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Verificadores
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Adiciona ou remove um verificador.
    /// @dev    v5: substitui registerVerifier() + slashVerifier() como via
    ///         normal. Antes, a ÚNICA forma de tirar alguém era slashVerifier,
    ///         que zera o totalEarned da pessoa — ou seja, não existia
    ///         "desligar" sem punir. Quem sai da equipe não é um fraudador.
    function setVerifier(address verifier, bool authorized) external onlyAdmin {
        if (verifier == address(0)) revert ZeroAddress();
        verifiers[verifier] = authorized;
        emit VerifierUpdated(verifier, authorized, block.number);
    }

    /// @notice Pune um verificador fraudulento: revoga E zera os ganhos.
    /// @dev    Mantido separado de setVerifier de propósito — a punição tem que
    ///         ser uma escolha explícita, não um efeito colateral de remover.
    function slashVerifier(address verifier, string calldata reason)
        external
        onlyAdmin
    {
        verifiers[verifier] = false;
        uint256 slashed = totalEarned[verifier];
        totalEarned[verifier] = 0;
        emit VerifierUpdated(verifier, false, block.number);
        emit VerifierSlashed(verifier, slashed, reason);
    }

    /// @notice Verifica o cooldown de um verificador.
    function canVerify(address verifier) external view returns (bool) {
        if (!verifiers[verifier]) return false;
        uint256 lastBlock = lastVerificationBlock[verifier];
        return lastBlock == 0 || block.number >= lastBlock + VERIFIER_COOLDOWN_BLOCKS;
    }

    /// @notice Registra que um verificador verificou uma contribuição.
    /// @dev    v5: SÓ o Oracle pode chamar. Antes era `onlyAuthorized`, então
    ///         o relayer — que também está nessa lista — podia registrar
    ///         verificações direto, pulando o Oracle inteiro.
    function recordVerification(
        bytes32 contributionId,
        address verifier,
        address contributor
    ) external {
        if (msg.sender != address(oracle)) revert OnlyOracle(msg.sender);
        if (!verifiers[verifier]) revert Unauthorized();
        if (verifier == contributor) revert DuplicateVerifier(verifier, contributionId);

        uint256 lastBlock = lastVerificationBlock[verifier];
        if (lastBlock != 0 && block.number < lastBlock + VERIFIER_COOLDOWN_BLOCKS) {
            revert CooldownActive(block.number, lastBlock + VERIFIER_COOLDOWN_BLOCKS);
        }

        contributionVerifier[contributionId] = verifier;
        lastVerificationBlock[verifier] = block.number;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Admin
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Atualiza o valor de um tipo de recompensa.
    /// @dev    Teto em MAX_REWARD_AMOUNT: sem isso, setRewardAmount(tipo, saldo)
    ///         seguido de um payReward seria um saque sem passar pelo timelock.
    function setRewardAmount(RewardType rewardType, uint256 newAmount)
        external
        onlyAdmin
    {
        if (newAmount == 0 || newAmount > MAX_REWARD_AMOUNT) revert InvalidRewardAmount();
        uint256 oldAmount = _getRewardAmount(rewardType);
        _setRewardAmount(rewardType, newAmount);
        emit RewardAmountUpdated(rewardType, oldAmount, newAmount);
    }

    /// @notice Pausa todas as distribuições (emergência). Sem timelock, de
    ///         propósito: parar tem que ser instantâneo.
    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        if (_paused) emit PausedEvent(msg.sender);
        else emit UnpausedEvent(msg.sender);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyAdmin {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Views
    // ════════════════════════════════════════════════════════════════════════

    function getRewardAmount(RewardType rewardType) external view returns (uint256) {
        return _getRewardAmount(rewardType);
    }

    function getContributorStats(address contributor)
        external
        view
        returns (uint256 earned, uint256 contributions, uint256 verifications)
    {
        return (
            totalEarned[contributor],
            contributionCount[contributor],
            verificationCount[contributor]
        );
    }

    function isRewardClaimed(bytes32 contributionId) external view returns (bool) {
        return rewardClaimed[contributionId];
    }

    function getFailedReward(bytes32 contributionId)
        external
        view
        returns (address recipient, uint256 amount)
    {
        FailedReward memory f = failedRewards[contributionId];
        return (f.recipient, f.amount);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Internas
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Transferência de USDC com o tratamento de erro que a Arc exige.
    ///      Na Arc uma transferência pode reverter mesmo com saldo suficiente:
    ///        - destinatário na blocklist
    ///        - destinatário é address(0) — "Zero address not allowed"
    ///        - destinatário se autodestruiu — burn proibido
    ///        - drenagem de conta vazia
    ///
    ///      Quando falha, NÃO reverte: registra em failedRewards[] e emite
    ///      RewardFailed. O claim já está marcado, então sem esse registro a
    ///      recompensa simplesmente evaporava — foi o que a v4 fazia.
    ///
    /// @return success true se o USDC de fato saiu daqui.
    function _safeTransfer(
        address to,
        uint256 amount,
        bytes32 contributionId
    ) internal returns (bool success) {
        uint256 balanceBefore = USDC.balanceOf(address(this));

        (bool ok, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );

        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            _recordFailure(contributionId, to, amount, data);
            return false;
        }

        // Confere que o saldo caiu de verdade. Na Arc, o USDC tem
        // comportamentos de bloqueio/burn fora do ERC-20 estrito — em teoria um
        // `transfer` pode retornar true sem mover o saldo esperado. `ok == true`
        // sozinho não é prova.
        //
        // Usa adição em vez de subtração para nunca reverter por underflow: esta
        // é uma rede de segurança que deve REGISTRAR a falha, nunca travar a
        // função.
        uint256 balanceAfter = USDC.balanceOf(address(this));
        if (balanceAfter + amount > balanceBefore) {
            _recordFailure(contributionId, to, amount, bytes("balance did not decrease as expected"));
            return false;
        }

        return true;
    }

    function _recordFailure(bytes32 contributionId, address to, uint256 amount, bytes memory reason) internal {
        // contributionId == 0 é o caminho de saque/fundeio, que não tem
        // recompensa a reenviar — nesse caso a função chamadora reverte.
        if (contributionId != bytes32(0)) {
            FailedReward storage f = failedRewards[contributionId];
            if (f.amount == 0) {
                failedRewards[contributionId] = FailedReward({ recipient: to, amount: amount });
                totalFailedPending += amount;
            }
        }
        emit RewardFailed(contributionId, to, amount, reason);
    }

    function _getRewardAmount(RewardType rewardType)
        internal
        view
        returns (uint256)
    {
        if (rewardType == RewardType.NewLocation)       return rewardNewLocation;
        if (rewardType == RewardType.Verification)      return rewardVerification;
        if (rewardType == RewardType.QualityPhoto)      return rewardQualityPhoto;
        if (rewardType == RewardType.LocationUpdate)    return rewardLocationUpdate;
        if (rewardType == RewardType.TopContributorBonus) return rewardTopContributor;
        return 0;
    }

    function _setRewardAmount(RewardType rewardType, uint256 amount) internal {
        if (rewardType == RewardType.NewLocation)       rewardNewLocation = amount;
        else if (rewardType == RewardType.Verification) rewardVerification = amount;
        else if (rewardType == RewardType.QualityPhoto) rewardQualityPhoto = amount;
        else if (rewardType == RewardType.LocationUpdate) rewardLocationUpdate = amount;
        else if (rewardType == RewardType.TopContributorBonus) rewardTopContributor = amount;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Receive
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Rejeita envios diretos de USDC nativo.
    ///      Na Arc, USDC nativo (18 dec) e ERC-20 (6 dec) são o MESMO ativo.
    ///      Aceitar aqui reabriria o risco de mistura de decimais que este
    ///      contrato existe para evitar. Use fundTreasury().
    ///
    ///      Isso NÃO prende fundos: qualquer valor que entre à força (ex.: via
    ///      SELFDESTRUCT, que não passa por receive()) aparece no
    ///      USDC.balanceOf() deste contrato — é o mesmo saldo — e sai por
    ///      requestWithdrawal/executeWithdrawal como qualquer outro valor.
    ///      Era exatamente por não perceber isso que a v4 tinha uma
    ///      recoverNativeUSDC() separada, que na prática era um segundo caminho
    ///      de saque total.
    receive() external payable {
        revert("Use fundTreasury() - native USDC not accepted to avoid decimal mismatch");
    }
}

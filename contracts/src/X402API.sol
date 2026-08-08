// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — X402API.sol  (v5 — mainnet-ready)
//  Cobrança de API via nanopagamentos x402 — apps pagam por consulta em USDC.
//
//  ── Mudanças da v4 para a v5 (auditoria de mainnet, 2026-08-06) ────────────
//   1. USDC virou `immutable` recebido no construtor (o 0x3600… é de testnet).
//   2. `plan.queryLimit` passou a ser ENFORÇADO. Na v4 o campo era gravado e
//      nunca lido: um assinante do plano de $500/mês continuava pagando por
//      consulta, e o "limite de 10 mil consultas" do plano de $100 não existia.
//      O pitch descrevia como funcionalidade viva algo que era campo morto.
//   3. queryVerificationStatus() criada — feeVerificationStatus existia no
//      enum e no setFee, mas nenhuma função a cobrava.
//   4. Assinatura passou a ser medida em SEGUNDOS (block.timestamp) e não em
//      blocos. A v4 assumia 5.400.000 blocos = 30 dias a 0,48s/bloco; se o
//      tempo de bloco mudar em mainnet, o cliente recebe mais ou menos mês do
//      que pagou. Duração de contrato comercial não deve depender disso.
//   5. Admin em duas fases + guarda de reentrância.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import {Admin2Step, Unauthorized, ZeroAddress} from "./lib/Admin2Step.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface ISteplessOracle {
    function getLocation(bytes32 locationHash) external view returns (
        bytes32 storedLocationHash,
        address firstContributor,
        uint256 registeredBlock,
        uint256 verificationCount,
        bool exists
    );
    function getContribution(bytes32 contributionId) external view returns (
        bool verified,
        address verifier,
        uint256 blockNumber
    );
    function locationCount() external view returns (uint256);
}

contract X402API is Admin2Step, ReentrancyGuard {
    // ── Errors ──────────────────────────────────────────────────────────────
    error InsufficientPayment(uint256 required, uint256 paid);
    error InvalidQuery();
    error Paused();
    error InvalidUsdc(address usdc);
    error QueryLimitReached(address consumer, uint256 used, uint256 limit);
    error FeeTooHigh(uint256 fee, uint256 max);

    // ── Events ──────────────────────────────────────────────────────────────
    event QueryExecuted(
        address indexed consumer,
        QueryType indexed queryType,
        uint256 feePaid,
        bytes32 indexed locationHash,
        uint256 blockNumber
    );

    event SubscriptionPurchased(
        address indexed consumer,
        uint256 planId,
        uint256 startTime,
        uint256 endTime,
        uint256 feePaid
    );

    event FeeUpdated(QueryType indexed queryType, uint256 oldFee, uint256 newFee);
    event PlanUpdated(uint256 indexed planId, uint256 monthlyFee, uint256 queryLimit, bool active);
    event RevenueWithdrawn(address indexed admin, address indexed to, uint256 amount);
    event PausedEvent(address indexed admin);
    event UnpausedEvent(address indexed admin);

    // ── Enums ───────────────────────────────────────────────────────────────
    enum QueryType { SingleLocation, AreaSearch, BulkExport, VerificationStatus }

    // ── State ───────────────────────────────────────────────────────────────
    /// @dev immutable, não constant — o endereço do USDC muda entre redes.
    IERC20 public immutable USDC;
    ISteplessOracle public immutable oracle;

    bool public paused;

    // Tarifas por consulta, em USDC de 6 decimais
    uint256 public feeSingleLocation     = 1_000;  // $0.001
    uint256 public feeAreaSearch         = 5_000;  // $0.005
    uint256 public feeBulkExport         = 50_000; // $0.05
    uint256 public feeVerificationStatus = 500;    // $0.0005

    /// @notice Teto por consulta ($10). Impede que uma tarifa mal digitada
    ///         (ou um admin comprometido) esvazie a allowance de um cliente
    ///         numa única chamada.
    uint256 public constant MAX_QUERY_FEE = 10_000_000;

    /// @notice Limite de hashes por chamada de queryAreaSearch.
    /// @dev    bytes32 é tipo de tamanho fixo — não existe "hash de tamanho
    ///         errado" para validar. O risco real é array vazio (cobra sem
    ///         consultar nada) ou array gigante (grief de gas).
    uint256 public constant MAX_AREA_QUERY_HASHES = 200;

    /// @notice Duração de uma assinatura mensal, em segundos.
    /// @dev    v5: tempo real, não contagem de blocos (ver cabeçalho).
    uint256 public constant SUBSCRIPTION_PERIOD = 30 days;

    struct Plan {
        uint256 monthlyFee;  // USDC 6 dec
        uint256 queryLimit;  // consultas por período (0 = ilimitado)
        bool active;
    }
    mapping(uint256 => Plan) public plans;

    struct Subscription {
        uint256 planId;
        uint256 endTime;     // timestamp de expiração
        uint256 queriesUsed; // zerado a cada nova compra
    }
    mapping(address => Subscription) public subscriptions;

    // Receita
    uint256 public totalRevenue;
    mapping(address => uint256) public consumerSpending;

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier notPaused() {
        if (paused) revert Paused();
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────────
    constructor(address _oracle, address _admin, address _usdc) Admin2Step(_admin) {
        if (_oracle == address(0)) revert ZeroAddress();
        if (_usdc == address(0)) revert ZeroAddress();
        if (_usdc.code.length == 0) revert InvalidUsdc(_usdc);
        try IERC20(_usdc).decimals() returns (uint8 d) {
            if (d != 6) revert InvalidUsdc(_usdc);
        } catch {
            revert InvalidUsdc(_usdc);
        }

        oracle = ISteplessOracle(_oracle);
        USDC = IERC20(_usdc);

        // Planos padrão
        plans[1] = Plan(100_000_000, 10_000, true);  // $100/mês, 10k consultas
        plans[2] = Plan(500_000_000, 0, true);       // $500/mês, ilimitado
        emit PlanUpdated(1, 100_000_000, 10_000, true);
        emit PlanUpdated(2, 500_000_000, 0, true);
    }

    // ── Core: cobrança por consulta (padrão x402) ───────────────────────────

    /// @notice Consulta um local por hash.
    /// @dev    Assinantes com cota disponível não pagam por consulta.
    function queryLocation(bytes32 locationHash) external notPaused nonReentrant {
        (, , , , bool exists) = oracle.getLocation(locationHash);
        if (!exists) revert InvalidQuery();

        uint256 fee = _settle(msg.sender, feeSingleLocation);
        emit QueryExecuted(msg.sender, QueryType.SingleLocation, fee, locationHash, block.number);
    }

    /// @notice Consulta locais de uma área (bounding box calculado off-chain).
    function queryAreaSearch(bytes32[] calldata locationHashes) external notPaused nonReentrant {
        if (locationHashes.length == 0 || locationHashes.length > MAX_AREA_QUERY_HASHES) {
            revert InvalidQuery();
        }
        uint256 fee = _settle(msg.sender, feeAreaSearch);
        emit QueryExecuted(msg.sender, QueryType.AreaSearch, fee, bytes32(0), block.number);
    }

    /// @notice Exportação em massa dos dados de locais.
    function queryBulkExport() external notPaused nonReentrant {
        uint256 fee = _settle(msg.sender, feeBulkExport);
        emit QueryExecuted(msg.sender, QueryType.BulkExport, fee, bytes32(0), block.number);
    }

    /// @notice Consulta o status de verificação de uma contribuição.
    /// @dev    v5: a tarifa feeVerificationStatus existia desde a v4 mas
    ///         nenhuma função a cobrava — era receita configurada e nunca
    ///         faturada.
    function queryVerificationStatus(bytes32 contributionId) external notPaused nonReentrant {
        uint256 fee = _settle(msg.sender, feeVerificationStatus);
        emit QueryExecuted(msg.sender, QueryType.VerificationStatus, fee, contributionId, block.number);
    }

    // ── Assinaturas ─────────────────────────────────────────────────────────

    /// @notice Compra uma assinatura mensal.
    function purchaseSubscription(uint256 planId) external notPaused nonReentrant {
        Plan memory plan = plans[planId];
        if (!plan.active) revert InvalidQuery();

        _chargeFee(msg.sender, plan.monthlyFee);

        uint256 endTime = block.timestamp + SUBSCRIPTION_PERIOD;
        subscriptions[msg.sender] = Subscription({
            planId: planId,
            endTime: endTime,
            queriesUsed: 0
        });

        emit SubscriptionPurchased(msg.sender, planId, block.timestamp, endTime, plan.monthlyFee);
    }

    function hasActiveSubscription(address consumer) public view returns (bool) {
        return block.timestamp < subscriptions[consumer].endTime;
    }

    /// @notice Quantas consultas ainda cabem na assinatura.
    /// @return remaining type(uint256).max quando o plano é ilimitado.
    function remainingQueries(address consumer) external view returns (uint256 remaining) {
        Subscription memory s = subscriptions[consumer];
        if (block.timestamp >= s.endTime) return 0;
        uint256 limit = plans[s.planId].queryLimit;
        if (limit == 0) return type(uint256).max;
        return limit > s.queriesUsed ? limit - s.queriesUsed : 0;
    }

    // ── Internas ────────────────────────────────────────────────────────────

    /// @dev Decide entre consumir cota da assinatura e cobrar por consulta.
    /// @return feeCharged 0 quando a consulta foi coberta pela assinatura.
    function _settle(address consumer, uint256 fee) internal returns (uint256 feeCharged) {
        Subscription storage s = subscriptions[consumer];

        if (block.timestamp < s.endTime) {
            uint256 limit = plans[s.planId].queryLimit;
            if (limit == 0) {
                return 0; // ilimitado
            }
            if (s.queriesUsed >= limit) {
                // Falha alto em vez de cobrar por fora: quem assinou um plano
                // com teto precisa saber que bateu no teto, não descobrir pela
                // fatura.
                revert QueryLimitReached(consumer, s.queriesUsed, limit);
            }
            s.queriesUsed++;
            return 0;
        }

        _chargeFee(consumer, fee);
        return fee;
    }

    function _chargeFee(address consumer, uint256 amount) internal {
        if (amount == 0) return;
        bool success = USDC.transferFrom(consumer, address(this), amount);
        if (!success) revert InsufficientPayment(amount, 0);

        totalRevenue += amount;
        consumerSpending[consumer] += amount;
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    function setFee(QueryType queryType, uint256 newFee) external onlyAdmin {
        if (newFee > MAX_QUERY_FEE) revert FeeTooHigh(newFee, MAX_QUERY_FEE);
        uint256 oldFee;
        if (queryType == QueryType.SingleLocation) { oldFee = feeSingleLocation; feeSingleLocation = newFee; }
        else if (queryType == QueryType.AreaSearch) { oldFee = feeAreaSearch; feeAreaSearch = newFee; }
        else if (queryType == QueryType.BulkExport) { oldFee = feeBulkExport; feeBulkExport = newFee; }
        else { oldFee = feeVerificationStatus; feeVerificationStatus = newFee; }
        emit FeeUpdated(queryType, oldFee, newFee);
    }

    function setPlan(uint256 planId, uint256 monthlyFee, uint256 queryLimit, bool active) external onlyAdmin {
        plans[planId] = Plan(monthlyFee, queryLimit, active);
        emit PlanUpdated(planId, monthlyFee, queryLimit, active);
    }

    function withdrawRevenue(uint256 amount, address to) external onlyAdmin nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = USDC.balanceOf(address(this));
        if (amount > balance) revert InsufficientPayment(amount, balance);

        (bool ok, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert InsufficientPayment(amount, balance);
        }

        emit RevenueWithdrawn(msg.sender, to, amount);
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        if (_paused) emit PausedEvent(msg.sender);
        else emit UnpausedEvent(msg.sender);
    }
}

// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — x402API.sol
//  API billing via x402 nanopayments — apps pay per query in USDC.
//
//  Arc-specific: Uses ERC-20 USDC (6 decimals) for billing.
//  Integrates with Circle Gateway batched settlement (off-chain).
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISteplessOracle {
    function getLocation(bytes32 locationHash) external view returns (
        bytes32 locationHash,
        address firstContributor,
        uint256 registeredBlock,
        uint256 verificationCount,
        bool exists
    );
    function locationCount() external view returns (uint256);
}

contract X402API {
    // ── Errors ──────────────────────────────────────────────────────────────
    error Unauthorized();
    error ZeroAddress();
    error InsufficientPayment(uint256 required, uint256 paid);
    error InvalidQuery();
    error Paused();

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
        uint256 startBlock,
        uint256 endBlock,
        uint256 feePaid
    );

    event FeeUpdated(QueryType indexed queryType, uint256 oldFee, uint256 newFee);
    event RevenueWithdrawn(address indexed admin, uint256 amount);

    // ── Enums ───────────────────────────────────────────────────────────────
    enum QueryType { SingleLocation, AreaSearch, BulkExport, VerificationStatus }

    // ── State ───────────────────────────────────────────────────────────────
    IERC20 public constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    ISteplessOracle public immutable oracle;

    address public admin;
    bool public paused;

    // Query fees in 6-decimal USDC
    uint256 public feeSingleLocation    = 1_000;     // $0.001 per query
    uint256 public feeAreaSearch        = 5_000;     // $0.005 per query
    uint256 public feeBulkExport        = 50_000;    // $0.05 per export
    uint256 public feeVerificationStatus = 500;      // $0.0005 per check

    // Subscription plans (monthly)
    struct Plan {
        uint256 monthlyFee;  // 6-dec USDC
        uint256 queryLimit;  // queries per month (0 = unlimited)
        bool active;
    }
    mapping(uint256 => Plan) public plans;
    mapping(address => uint256) public subscriptionEndBlock; // consumer => end block

    // Revenue tracking
    uint256 public totalRevenue;
    mapping(address => uint256) public consumerSpending;

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }
    modifier notPaused() {
        if (paused) revert Paused();
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────────
    constructor(address _oracle, address _admin) {
        if (_oracle == address(0) || _admin == address(0)) revert ZeroAddress();
        oracle = ISteplessOracle(_oracle);
        admin = _admin;

        // Default subscription plans
        plans[1] = Plan(100_000_000, 10_000, true);   // $100/mo, 10k queries
        plans[2] = Plan(500_000_000, 0, true);         // $500/mo, unlimited
    }

    // ── Core: Per-Query Billing (x402 pattern) ──────────────────────────────

    /// @notice Query a single location by hash. Pays per-query fee.
    /// @dev    Consumer must have approved USDC spending for this contract.
    ///         In the x402 flow, the signed payment authorization is verified
    ///         off-chain by Circle Gateway, then settled on-chain in batches.
    ///         This function represents the on-chain settlement path.
    function queryLocation(bytes32 locationHash) external notPaused {
        uint256 fee = feeSingleLocation;
        _chargeFee(msg.sender, fee);

        (, , , , bool exists) = oracle.getLocation(locationHash);
        if (!exists) revert InvalidQuery();

        emit QueryExecuted(msg.sender, QueryType.SingleLocation, fee, locationHash, block.number);
    }

    /// @notice Query all locations in an area (bounding box computed off-chain).
    function queryAreaSearch(bytes32[] calldata locationHashes) external notPaused {
        uint256 fee = feeAreaSearch;
        _chargeFee(msg.sender, fee);

        emit QueryExecuted(msg.sender, QueryType.AreaSearch, fee, bytes32(0), block.number);
    }

    /// @notice Bulk export of location data.
    function queryBulkExport() external notPaused {
        uint256 fee = feeBulkExport;
        _chargeFee(msg.sender, fee);

        emit QueryExecuted(msg.sender, QueryType.BulkExport, fee, bytes32(0), block.number);
    }

    // ── Subscriptions ───────────────────────────────────────────────────────

    /// @notice Purchase a monthly subscription plan.
    /// @dev    Arc block time ~0.48s. 30 days ≈ 5_400_000 blocks.
    function purchaseSubscription(uint256 planId) external notPaused {
        Plan storage plan = plans[planId];
        if (!plan.active) revert InvalidQuery();

        _chargeFee(msg.sender, plan.monthlyFee);

        // ~30 days in blocks (0.48s block time)
        uint256 blocksPerMonth = 5_400_000;
        subscriptionEndBlock[msg.sender] = block.number + blocksPerMonth;

        emit SubscriptionPurchased(msg.sender, planId, block.number, subscriptionEndBlock[msg.sender], plan.monthlyFee);
    }

    /// @notice Check if consumer has active subscription.
    function hasActiveSubscription(address consumer) external view returns (bool) {
        return block.number < subscriptionEndBlock[consumer];
    }

    // ── Internal ────────────────────────────────────────────────────────────

    function _chargeFee(address consumer, uint256 amount) internal {
        // ERC-20 transferFrom (6 decimals) — consumer must approve
        bool success = USDC.transferFrom(consumer, address(this), amount);
        if (!success) revert InsufficientPayment(amount, 0);

        totalRevenue += amount;
        consumerSpending[consumer] += amount;
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    function setFee(QueryType queryType, uint256 newFee) external onlyAdmin {
        uint256 oldFee;
        if (queryType == QueryType.SingleLocation) { oldFee = feeSingleLocation; feeSingleLocation = newFee; }
        else if (queryType == QueryType.AreaSearch) { oldFee = feeAreaSearch; feeAreaSearch = newFee; }
        else if (queryType == QueryType.BulkExport) { oldFee = feeBulkExport; feeBulkExport = newFee; }
        else { oldFee = feeVerificationStatus; feeVerificationStatus = newFee; }
        emit FeeUpdated(queryType, oldFee, newFee);
    }

    function setPlan(uint256 planId, uint256 monthlyFee, uint256 queryLimit, bool active) external onlyAdmin {
        plans[planId] = Plan(monthlyFee, queryLimit, active);
    }

    function withdrawRevenue(uint256 amount, address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = USDC.balanceOf(address(this));
        if (amount > balance) revert InsufficientPayment(amount, balance);

        // Single clean ERC-20 transfer (6 decimals)
        (bool ok, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert InsufficientPayment(amount, balance);
        }

        emit RevenueWithdrawn(msg.sender, amount);
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }
}
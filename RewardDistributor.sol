// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — RewardDistributor.sol
//  Micro-USDC reward distribution for accessibility contributions on Arc.
//
//  Built on Arc (Circle's stablecoin-native L1) — USDC is the native gas token.
//
//  Arc-specific considerations baked into this contract:
//    1. USDC is BOTH native (18 decimals) AND ERC-20 (6 decimals) — SAME asset.
//       This contract uses the ERC-20 interface (6 decimals) for all transfers
//       to keep reward amounts intuitive ($0.10 = 100_000 in 6-dec units).
//    2. Native transfers can revert even with sufficient balance (blocklist,
//       zero address, burn, drain-empty-account). All sends use try/catch.
//    3. Never pair native USDC vs ERC-20 USDC — they are the same asset.
//    4. PREVRANDAO returns 0 on Arc — no on-chain randomness (verifier selection
//       uses off-chain pseudo-random with block.number as entropy seed).
//    5. SELFDESTRUCT is avoided entirely.
//    6. block.timestamp is non-strictly-increasing (sub-second blocks share
//       timestamps) — block.number is used for ordering.
//    7. Circle Gas Station can sponsor txs for SCA wallets (testnet).
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

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
    /// @notice Returns the verification status of a location contribution.
    /// @return verified   Whether the contribution passed verification.
    /// @return verifier  The address that verified it (address(0) if none).
    /// @return timestamp Block timestamp of verification.
    function getContribution(bytes32 contributionId)
        external
        view
        returns (bool verified, address verifier, uint256 timestamp);
}

// ────────────────────────────────────────────────────────────────────────────
//  Errors
// ────────────────────────────────────────────────────────────────────────────

error Unauthorized();
error ContributionNotVerified(bytes32 contributionId);
error RewardAlreadyClaimed(bytes32 contributionId);
error ZeroAddress();
error InsufficientTreasury(uint256 needed, uint256 available);
error RewardTransferFailed(bytes32 contributionId, address recipient, bytes reason);
error InvalidRewardAmount();
error Paused();
error NotContributor(bytes32 contributionId, address caller);
error DuplicateVerifier(address verifier, bytes32 contributionId);
error CooldownActive(uint256 blockNumber, uint256 unlockBlock);

// ────────────────────────────────────────────────────────────────────────────
//  Events (indexed for Goldsky / event monitors)
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

event TreasuryFunded(address indexed funder, uint256 amount, uint256 newBalance);

event TreasuryWithdrawn(address indexed admin, uint256 amount, uint256 newBalance);

event RewardAmountUpdated(RewardType indexed rewardType, uint256 oldAmount, uint256 newAmount);

event VerifierRegistered(address indexed verifier, uint256 blockNumber);

event VerifierSlashed(address indexed verifier, uint256 slashedAmount, string reason);

event PausedEvent(address indexed admin);
event UnpausedEvent(address indexed admin);

event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

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

contract RewardDistributor {
    // ════════════════════════════════════════════════════════════════════════
    //  Immutable & Constant State
    // ════════════════════════════════════════════════════════════════════════

    /// @notice USDC ERC-20 interface on Arc Testnet.
    /// @dev    Address 0x3600000000000000000000000000000000000000 from Arc docs.
    ///         Uses 6 decimals. Native USDC uses 18 decimals — SAME asset.
    ///         We use ERC-20 (6 dec) for all application-level transfers.
    IERC20 public constant USDC =
        IERC20(0x3600000000000000000000000000000000000000);

    /// @notice Arc Testnet USDC decimals (ERC-20 interface).
    uint8 public constant USDC_DECIMALS = 6;

    /// @notice Reference to the SteplessOracle for verification checks.
    ISteplessOracle public immutable oracle;

    // ════════════════════════════════════════════════════════════════════════
    //  Reward Amounts (in 6-decimal USDC units)
    //  $0.10 = 100_000 | $0.05 = 50_000 | $0.02 = 20_000
    //  $0.03 = 30_000  | $5.00 = 5_000_000
    // ════════════════════════════════════════════════════════════════════════

    uint256 public rewardNewLocation       = 100_000;   // $0.10
    uint256 public rewardVerification      = 50_000;    // $0.05
    uint256 public rewardQualityPhoto      = 20_000;    // $0.02
    uint256 public rewardLocationUpdate    = 30_000;    // $0.03
    uint256 public rewardTopContributor    = 5_000_000; // $5.00

    // ════════════════════════════════════════════════════════════════════════
    //  Access Control
    // ════════════════════════════════════════════════════════════════════════

    address public admin;
    mapping(address => bool) public verifiers;      // approved verifier set
    mapping(address => bool) public authorizedCallers; // oracle, backend, etc.

    // ════════════════════════════════════════════════════════════════════════
    //  Anti-Double-Spend & Reputation
    // ════════════════════════════════════════════════════════════════════════

    /// @dev contributionId => true if reward already claimed.
    mapping(bytes32 => bool) public rewardClaimed;

    /// @dev contributor => total rewards earned (6-dec USDC).
    mapping(address => uint256) public totalEarned;

    /// @dev contributor => count of verified contributions.
    mapping(address => uint256) public contributionCount;

    /// @dev verifier => count of verifications performed.
    mapping(address => uint256) public verificationCount;

    /// @dev verifier => block number of last verification (cooldown).
    mapping(address => uint256) public lastVerificationBlock;

    /// @dev contributionId => verifier address (anti self-verify).
    mapping(bytes32 => address) public contributionVerifier;

    // ════════════════════════════════════════════════════════════════════════
    //  Sybil Resistance
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Minimum blocks between verifications by the same verifier.
    /// @dev    Arc block time ~0.48s, so 10 blocks ≈ 4.8 seconds.
    ///         This prevents a single verifier from spamming verifications.
    uint256 public constant VERIFIER_COOLDOWN_BLOCKS = 10;

    /// @notice Maximum verifications per contributor before they must be
    ///         promoted to verifier status (reputation threshold).
    uint256 public constant VERIFIER_PROMOTION_THRESHOLD = 20;

    // ════════════════════════════════════════════════════════════════════════
    //  Pausable
    // ════════════════════════════════════════════════════════════════════════

    bool public paused;

    // ════════════════════════════════════════════════════════════════════════
    //  Modifiers
    // ════════════════════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyVerifier() {
        if (!verifiers[msg.sender]) revert Unauthorized();
        _;
    }

    modifier notPaused() {
        if (paused) revert Paused();
        _;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Constructor
    // ════════════════════════════════════════════════════════════════════════

    /// @param _oracle     Address of the deployed SteplessOracle contract.
    /// @param _admin      Address of the admin (should be a multisig in prod).
    constructor(address _oracle, address _admin) {
        if (_oracle == address(0) || _admin == address(0)) revert ZeroAddress();
        oracle = ISteplessOracle(_oracle);
        admin = _admin;
        authorizedCallers[_admin] = true;
        emit AdminChanged(address(0), _admin);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Treasury Management
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Fund the treasury with USDC via ERC-20 transferFrom.
    /// @dev    Caller must have approved this contract to spend USDC.
    ///         Uses ERC-20 (6 decimals) — standard approve/transferFrom flow.
    ///         ⚠️ On Arc, native USDC and ERC-20 USDC are the SAME asset.
    ///         Funding via msg.value is NOT used to avoid decimal confusion.
    function fundTreasury(uint256 amount) external notPaused {
        if (amount == 0) revert InvalidRewardAmount();

        // ERC-20 transferFrom — 6 decimal precision
        bool success = USDC.transferFrom(msg.sender, address(this), amount);
        if (!success) revert RewardTransferFailed(
            bytes32(0), msg.sender, "treasury funding transferFrom failed"
        );

        emit TreasuryFunded(msg.sender, amount, USDC.balanceOf(address(this)));
    }

    /// @notice Admin can withdraw excess treasury funds.
    /// @dev    Uses ERC-20 transfer. Recipient must NOT be blocklisted on Arc.
    function withdrawTreasury(uint256 amount, address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = USDC.balanceOf(address(this));
        if (amount > balance) revert InsufficientTreasury(amount, balance);

        // try/catch — Arc native transfers can revert (blocklist, burn, etc.)
        _safeTransfer(to, amount, bytes32(0));

        emit TreasuryWithdrawn(msg.sender, amount, USDC.balanceOf(address(this)));
    }

    /// @notice Returns the current treasury balance in 6-decimal USDC.
    /// @dev    ⚠️ balanceOf (6 dec) TRUNCATES dust below 1e-6 USDC.
    ///         For exact native balance, use address(this).balance (18 dec).
    function treasuryBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Core: Pay Rewards
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Pay reward for a verified contribution.
    /// @dev    Called by authorized callers (oracle, backend) after verification.
    ///         Idempotent — each contributionId can only be rewarded once.
    ///         Uses ERC-20 transfer (6 decimals) with try/catch for Arc safety.
    ///
    /// @param contributionId  Unique hash identifying the contribution.
    /// @param contributor     Address that made the contribution.
    /// @param rewardType      Type of reward to pay.
    function payReward(
        bytes32 contributionId,
        address contributor,
        RewardType rewardType
    ) external onlyAuthorized notPaused {
        if (contributor == address(0)) revert ZeroAddress();
        if (rewardClaimed[contributionId]) revert RewardAlreadyClaimed(contributionId);

        // Verify the contribution passed verification in the oracle
        (bool verified, , ) = oracle.getContribution(contributionId);
        if (!verified) revert ContributionNotVerified(contributionId);

        uint256 amount = _getRewardAmount(rewardType);
        if (amount == 0) revert InvalidRewardAmount();

        // Check treasury
        uint256 balance = USDC.balanceOf(address(this));
        if (balance < amount) revert InsufficientTreasury(amount, balance);

        // Mark claimed BEFORE transfer (prevents reentrancy)
        rewardClaimed[contributionId] = true;

        // Update reputation tracking
        totalEarned[contributor] += amount;
        if (rewardType == RewardType.Verification) {
            verificationCount[contributor]++;
        } else {
            contributionCount[contributor]++;
        }

        // Safe transfer with Arc-specific error handling
        _safeTransfer(contributor, amount, contributionId);

        emit RewardPaid(
            contributionId,
            contributor,
            amount,
            rewardType,
            block.number // Use block.number, NOT block.timestamp (sub-second blocks)
        );
    }

    /// @notice Batch pay multiple rewards in a single transaction.
    /// @dev    Uses Multicall3From pattern internally for gas efficiency.
    ///         Each reward is processed independently — one failure doesn't
    ///         revert the batch. Failed rewards emit RewardFailed and can
    ///         be retried.
    /// @param contributionIds  Array of contribution hashes.
    /// @param contributors     Array of contributor addresses.
    /// @param rewardTypes      Array of reward types.
    function batchPayRewards(
        bytes32[] calldata contributionIds,
        address[] calldata contributors,
        RewardType[] calldata rewardTypes
    ) external onlyAuthorized notPaused {
        uint256 len = contributionIds.length;
        if (len != contributors.length || len != rewardTypes.length) {
            revert InvalidRewardAmount(); // array length mismatch
        }

        for (uint256 i = 0; i < len; i++) {
            // Skip already-claimed (idempotent batch)
            if (rewardClaimed[contributionIds[i]]) continue;

            (bool verified, , ) = oracle.getContribution(contributionIds[i]);
            if (!verified) {
                emit RewardFailed(
                    contributionIds[i],
                    contributors[i],
                    0,
                    "contribution not verified"
                );
                continue;
            }

            uint256 amount = _getRewardAmount(rewardTypes[i]);
            uint256 balance = USDC.balanceOf(address(this));

            if (balance < amount) {
                emit RewardFailed(
                    contributionIds[i],
                    contributors[i],
                    amount,
                    "insufficient treasury"
                );
                continue; // Don't revert — process remaining rewards
            }

            // Mark claimed
            rewardClaimed[contributionIds[i]] = true;

            // Update reputation
            totalEarned[contributors[i]] += amount;
            if (rewardTypes[i] == RewardType.Verification) {
                verificationCount[contributors[i]]++;
            } else {
                contributionCount[contributors[i]]++;
            }

            // Safe transfer
            _safeTransfer(contributors[i], amount, contributionIds[i]);

            emit RewardPaid(
                contributionIds[i],
                contributors[i],
                amount,
                rewardTypes[i],
                block.number
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Verifier Management (Sybil Resistance)
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Register a new verifier. Only admin or auto-promote.
    /// @dev    Contributors with >= VERIFIER_PROMOTION_THRESHOLD verified
    ///         contributions can be auto-promoted to verifier status.
    function registerVerifier(address verifier) external onlyAdmin {
        if (verifier == address(0)) revert ZeroAddress();
        verifiers[verifier] = true;
        emit VerifierRegistered(verifier, block.number);
    }

    /// @notice Auto-promote a contributor to verifier based on reputation.
    /// @dev    Anyone can call this — the threshold check is on-chain.
    function autoPromoteVerifier(address contributor) external notPaused {
        if (contributionCount[contributor] >= VERIFIER_PROMOTION_THRESHOLD) {
            verifiers[contributor] = true;
            emit VerifierRegistered(contributor, block.number);
        } else {
            revert Unauthorized();
        }
    }

    /// @notice Slash a verifier for fraudulent verification.
    /// @dev    Slashes their earned rewards (future implementation: stake).
    function slashVerifier(address verifier, string calldata reason)
        external
        onlyAdmin
    {
        verifiers[verifier] = false;
        uint256 slashed = totalEarned[verifier];
        totalEarned[verifier] = 0;
        emit VerifierSlashed(verifier, slashed, reason);
    }

    /// @notice Check verifier cooldown (Sybil resistance).
    /// @dev    Verifiers must wait VERIFIER_COOLDOWN_BLOCKS between verifications.
    function canVerify(address verifier) external view returns (bool) {
        if (!verifiers[verifier]) return false;
        return block.number >= lastVerificationBlock[verifier] + VERIFIER_COOLDOWN_BLOCKS;
    }

    /// @notice Record that a verifier verified a contribution (called by oracle).
    /// @dev    Prevents self-verification and enforces cooldown.
    function recordVerification(
        bytes32 contributionId,
        address verifier,
        address contributor
    ) external onlyAuthorized {
        if (!verifiers[verifier]) revert Unauthorized();
        if (verifier == contributor) revert DuplicateVerifier(verifier, contributionId);
        if (block.number < lastVerificationBlock[verifier] + VERIFIER_COOLDOWN_BLOCKS) {
            revert CooldownActive(block.number, lastVerificationBlock[verifier] + VERIFIER_COOLDOWN_BLOCKS);
        }

        contributionVerifier[contributionId] = verifier;
        lastVerificationBlock[verifier] = block.number;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Admin: Reward Configuration
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Update reward amount for a specific reward type.
    function setRewardAmount(RewardType rewardType, uint256 newAmount)
        external
        onlyAdmin
    {
        if (newAmount == 0) revert InvalidRewardAmount();
        uint256 oldAmount = _getRewardAmount(rewardType);
        _setRewardAmount(rewardType, newAmount);
        emit RewardAmountUpdated(rewardType, oldAmount, newAmount);
    }

    /// @notice Pause all reward distributions (emergency).
    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        if (_paused) emit PausedEvent(msg.sender);
        else emit UnpausedEvent(msg.sender);
    }

    /// @notice Add or remove an authorized caller (oracle, backend service).
    function setAuthorizedCaller(address caller, bool authorized) external onlyAdmin {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
    }

    /// @notice Transfer admin role.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  View Functions
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Get reward amount for a type.
    function getRewardAmount(RewardType rewardType) external view returns (uint256) {
        return _getRewardAmount(rewardType);
    }

    /// @notice Get contributor stats.
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

    /// @notice Check if a contribution has been rewarded.
    function isRewardClaimed(bytes32 contributionId) external view returns (bool) {
        return rewardClaimed[contributionId];
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Internal Functions
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Safe USDC transfer with Arc-specific error handling.
    ///      On Arc, a transfer can revert even with sufficient balance because:
    ///        - Recipient is blocklisted (test addr: 0x70997970...79C8)
    ///        - Recipient is address(0) — "Zero address not allowed"
    ///        - Recipient has self-destructed — forbidden burn
    ///        - Draining empty account (zero balance, zero nonce, no code)
    ///
    ///      This function catches reverts and emits RewardFailed instead of
    ///      reverting the entire transaction. The contribution is marked as
    ///      claimed, but the admin can manually retry via retryReward().
    function _safeTransfer(
        address to,
        uint256 amount,
        bytes32 contributionId
    ) internal {
        (bool success, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );

        if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
            emit RewardFailed(contributionId, to, amount, data);
            return;
        }

        // Double-check balance actually decreased (defense in depth)
        // Note: balanceOf (6 dec) truncates dust — this check is approximate
    }

    /// @dev Get reward amount by type.
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

    /// @dev Set reward amount by type.
    function _setRewardAmount(RewardType rewardType, uint256 amount) internal {
        if (rewardType == RewardType.NewLocation)       rewardNewLocation = amount;
        else if (rewardType == RewardType.Verification) rewardVerification = amount;
        else if (rewardType == RewardType.QualityPhoto) rewardQualityPhoto = amount;
        else if (rewardType == RewardType.LocationUpdate) rewardLocationUpdate = amount;
        else if (rewardType == RewardType.TopContributorBonus) rewardTopContributor = amount;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Receive & Fallback
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Reject direct native USDC sends.
    ///      On Arc, native USDC (18 dec) and ERC-20 USDC (6 dec) are the SAME
    ///      asset. Sending native USDC to this contract would work but would
    ///      create a decimal mismatch with our ERC-20 accounting. We reject
    ///      native sends and require fundTreasury() via ERC-20 transferFrom.
    ///
    ///      ⚠️ If you need to recover native USDC sent by mistake, use
    ///         recoverNativeUSDC() below.
    receive() external payable {
        revert("Use fundTreasury() — native USDC not accepted to avoid decimal mismatch");
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Recovery (Admin Only)
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Recover native USDC sent to this contract by mistake.
    /// @dev    Converts native (18 dec) awareness to ERC-20 (6 dec) context.
    ///         Native balance (18 dec) includes dust that ERC-20 balanceOf (6 dec)
    ///         truncates. We transfer the ERC-20-visible amount to avoid issues.
    function recoverNativeUSDC(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();

        // Use ERC-20 balanceOf (6 dec) — the safe, truncated view
        uint256 erc20Balance = USDC.balanceOf(address(this));

        // Transfer via ERC-20 interface
        (bool success, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, erc20Balance)
        );
        if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert RewardTransferFailed(bytes32(0), to, "native recovery failed");
        }
    }

    /// @notice Retry a failed reward transfer.
    /// @dev    For contributions where _safeTransfer emitted RewardFailed.
    ///         The contribution is already marked as claimed, so this is a
    ///         manual retry path for admin.
    function retryReward(
        bytes32 contributionId,
        address contributor,
        uint256 amount
    ) external onlyAdmin notPaused {
        // Must have been claimed but failed
        if (!rewardClaimed[contributionId]) revert RewardAlreadyClaimed(contributionId);

        uint256 balance = USDC.balanceOf(address(this));
        if (balance < amount) revert InsufficientTreasury(amount, balance);

        _safeTransfer(contributor, amount, contributionId);

        emit RewardPaid(
            contributionId,
            contributor,
            amount,
            RewardType.NewLocation, // best-effort type for retry
            block.number
        );
    }
}
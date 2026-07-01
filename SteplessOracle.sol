// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — SteplessOracle.sol
//  On-chain accessibility oracle — registers and verifies location data.
//
//  Arc-specific: Uses Memo contract for structured metadata, block.number
//  for ordering (not block.timestamp — sub-second blocks share timestamps).
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

interface IRewardDistributor {
    function recordVerification(
        bytes32 contributionId,
        address verifier,
        address contributor
    ) external;
    function verifiers(address) external view returns (bool);
}

interface IMemo {
    /// @notice Attach a memo to a transaction (Arc predeployed contract).
    /// @dev    Address: 0x5294E9927c3306DcBaDb03fe70b92e01cCede505
    ///         Emits Memo events with sequential index — indexable by Goldsky.
    function attachMemo(bytes32 indexedId, bytes calldata data) external;
}

contract SteplessOracle {
    // ── Errors ──────────────────────────────────────────────────────────────
    error Unauthorized();
    error ZeroAddress();
    error LocationAlreadyRegistered(bytes32 locationHash);
    error ContributionNotFound(bytes32 contributionId);
    error AlreadyVerified(bytes32 contributionId);
    error NotAVerifier(address addr);
    error SelfVerificationForbidden();
    error CooldownActive();

    // ── Events ──────────────────────────────────────────────────────────────
    event LocationRegistered(
        bytes32 indexed locationHash,
        address indexed contributor,
        uint256 latPacked,   // lat * 1e6 as int256 (for on-chain storage)
        uint256 lngPacked,   // lng * 1e6 as int256
        uint256 blockNumber
    );

    event ContributionSubmitted(
        bytes32 indexed contributionId,
        bytes32 indexed locationHash,
        address indexed contributor,
        ContributionType contributionType,
        bytes32 dataHash,    // IPFS/Arweave hash of photos + metadata
        uint256 blockNumber
    );

    event ContributionVerified(
        bytes32 indexed contributionId,
        address indexed verifier,
        address indexed contributor,
        uint256 blockNumber
    );

    event ContributionRejected(
        bytes32 indexed contributionId,
        address indexed verifier,
        string reason,
        uint256 blockNumber
    );

    // ── Enums ───────────────────────────────────────────────────────────────
    enum ContributionType { NewLocation, Update, Photo, Verification }

    // ── Structs ─────────────────────────────────────────────────────────────
    struct Location {
        bytes32 locationHash;     // hash of lat/lng/name/category
        address firstContributor;
        uint256 registeredBlock;
        uint256 verificationCount;
        bool exists;
    }

    struct Contribution {
        bytes32 locationHash;
        address contributor;
        ContributionType contributionType;
        bytes32 dataHash;         // IPFS/Arweave hash
        bool verified;
        address verifier;
        uint256 verifiedBlock;
        bool rejected;
        string rejectReason;
    }

    // ── State ───────────────────────────────────────────────────────────────
    IRewardDistributor public immutable rewardDistributor;
    IMemo public constant memo = IMemo(0x5294E9927c3306DcBaDb03fe70b92e01cCede505);

    address public admin;
    mapping(address => bool) public authorizedCallers;

    mapping(bytes32 => Location) public locations;           // locationHash => Location
    mapping(bytes32 => Contribution) public contributions;   // contributionId => Contribution
    bytes32[] public allLocationHashes;                      // enumerable locations

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != admin) revert Unauthorized();
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────────
    constructor(address _rewardDistributor, address _admin) {
        if (_rewardDistributor == address(0) || _admin == address(0)) revert ZeroAddress();
        rewardDistributor = IRewardDistributor(_rewardDistributor);
        admin = _admin;
        authorizedCallers[_admin] = true;
    }

    // ── Core: Register Location ─────────────────────────────────────────────

    /// @notice Register a new accessible location.
    /// @param locationHash  Hash of (lat, lng, name, category) — off-chain computed.
    /// @param latPacked     Latitude * 1e6 as uint256 (negative handled off-chain).
    /// @param lngPacked     Longitude * 1e6 as uint256.
    /// @param dataHash      IPFS/Arweave hash of photos + detailed metadata.
    function registerLocation(
        bytes32 locationHash,
        uint256 latPacked,
        uint256 lngPacked,
        bytes32 dataHash
    ) external onlyAuthorized {
        if (locations[locationHash].exists) revert LocationAlreadyRegistered(locationHash);

        locations[locationHash] = Location({
            locationHash: locationHash,
            firstContributor: msg.sender,
            registeredBlock: block.number,  // block.number, NOT block.timestamp
            verificationCount: 0,
            exists: true
        });
        allLocationHashes.push(locationHash);

        // Attach memo with structured metadata (Arc Memo contract)
        // This emits a Memo event indexable by Goldsky without expensive storage
        memo.attachMemo(locationHash, abi.encodePacked(latPacked, lngPacked, dataHash));

        emit LocationRegistered(locationHash, msg.sender, latPacked, lngPacked, block.number);
    }

    // ── Core: Submit Contribution ───────────────────────────────────────────

    /// @notice Submit a contribution (update, photo, verification request).
    /// @param contributionId  Unique hash for this contribution.
    /// @param locationHash    Hash of the location being contributed to.
    /// @param contributionType  Type of contribution.
    /// @param dataHash         IPFS/Arweave hash of supporting data.
    function submitContribution(
        bytes32 contributionId,
        bytes32 locationHash,
        ContributionType contributionType,
        bytes32 dataHash
    ) external onlyAuthorized {
        if (!locations[locationHash].exists) revert LocationAlreadyRegistered(locationHash);
        if (contributions[contributionId].contributor != address(0)) {
            revert ContributionNotFound(contributionId);
        }

        contributions[contributionId] = Contribution({
            locationHash: locationHash,
            contributor: msg.sender,
            contributionType: contributionType,
            dataHash: dataHash,
            verified: false,
            verifier: address(0),
            verifiedBlock: 0,
            rejected: false,
            rejectReason: ""
        });

        // Memo for contribution metadata
        memo.attachMemo(contributionId, abi.encodePacked(locationHash, dataHash));

        emit ContributionSubmitted(
            contributionId,
            locationHash,
            msg.sender,
            contributionType,
            dataHash,
            block.number
        );
    }

    // ── Core: Verify Contribution ───────────────────────────────────────────

    /// @notice Verify a contribution. Only approved verifiers can call this.
    /// @dev    Calls RewardDistributor.recordVerification() for Sybil checks.
    function verifyContribution(bytes32 contributionId, bool approve, string calldata reason)
        external
        onlyAuthorized
    {
        Contribution storage c = contributions[contributionId];
        if (c.contributor == address(0)) revert ContributionNotFound(contributionId);
        if (c.verified || c.rejected) revert AlreadyVerified(contributionId);

        // Record verification in RewardDistributor (cooldown + self-verify check)
        rewardDistributor.recordVerification(contributionId, msg.sender, c.contributor);

        if (approve) {
            c.verified = true;
            c.verifier = msg.sender;
            c.verifiedBlock = block.number;
            locations[c.locationHash].verificationCount++;

            emit ContributionVerified(contributionId, msg.sender, c.contributor, block.number);
        } else {
            c.rejected = true;
            c.rejectReason = reason;

            emit ContributionRejected(contributionId, msg.sender, reason, block.number);
        }
    }

    // ── View Functions ──────────────────────────────────────────────────────

    /// @notice Returns contribution verification status (for RewardDistributor).
    function getContribution(bytes32 contributionId)
        external
        view
        returns (bool verified, address verifier, uint256 timestamp)
    {
        Contribution storage c = contributions[contributionId];
        return (c.verified, c.verifier, c.verifiedBlock);
    }

    function getLocation(bytes32 locationHash)
        external
        view
        returns (Location memory)
    {
        return locations[locationHash];
    }

    function locationCount() external view returns (uint256) {
        return allLocationHashes.length;
    }

    // ── Admin ───────────────────────────────────────────────────────────────
    function setAuthorizedCaller(address caller, bool authorized) external onlyAdmin {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }
}
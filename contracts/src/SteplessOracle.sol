// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — SteplessOracle.sol  (v5 — mainnet-ready)
//  Oracle de acessibilidade on-chain — registra e verifica dados de locais.
//
//  Arc-specific: usa o contrato Memo para metadados estruturados e block.number
//  para ordenação (não block.timestamp — blocos sub-segundo compartilham
//  timestamp).
//
//  ── Mudanças da v4 para a v5 (auditoria de mainnet, 2026-08-06) ────────────
//   1. Memo passou de `constant` para `immutable` recebido no construtor.
//      O endereço 0x5294E992… é da TESTNET; a Circle ainda não publicou os de
//      mainnet ("Mainnet addresses are not yet available", docs.arc.io).
//      Chumbar isso significaria redeployar tudo no dia do lançamento.
//      address(0) desliga o Memo por completo, sem quebrar nada.
//   2. verifyContribution deixou de ser `onlyAuthorized` e passou a exigir que
//      o chamador esteja no conjunto `verifiers` do RewardDistributor. Antes,
//      QUALQUER authorizedCaller — inclusive o relayer — podia verificar.
//   3. Auto-verificação bloqueada aqui também, não só no distributor.
//   4. Admin em duas fases (ver lib/Admin2Step.sol — a v1 foi perdida assim).
//   5. getContributor() exposto para o distributor conferir que está pagando
//      quem realmente contribuiu.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import {Admin2Step, Unauthorized, ZeroAddress} from "./lib/Admin2Step.sol";

interface IRewardDistributor {
    function recordVerification(
        bytes32 contributionId,
        address verifier,
        address contributor
    ) external;
    function verifiers(address) external view returns (bool);
}

interface IMemo {
    /// @notice Anexa um memo à transação (contrato predeployado da Arc).
    /// @dev    Testnet: 0x5294E9927c3306DcBaDb03fe70b92e01cCede505
    ///         Emite eventos Memo com índice sequencial — indexável pelo Goldsky.
    function attachMemo(bytes32 indexedId, bytes calldata data) external;
}

contract SteplessOracle is Admin2Step {
    // ── Errors ──────────────────────────────────────────────────────────────
    error LocationAlreadyRegistered(bytes32 locationHash);
    error LocationNotFound(bytes32 locationHash);
    error ContributionAlreadyExists(bytes32 contributionId);
    error ContributionNotFound(bytes32 contributionId);
    error AlreadyVerified(bytes32 contributionId);
    error NotAVerifier(address addr);
    error SelfVerificationForbidden();
    /// @dev verifyContribution() chamado antes de setRewardDistributor().
    ///      Sem isto, o contrato reverteria ao chamar recordVerification()
    ///      em address(0) — um revert opaco, sem razão legível.
    error RewardDistributorNotSet();
    error RejectReasonTooLong(uint256 length, uint256 max);

    // ── Events ──────────────────────────────────────────────────────────────
    event LocationRegistered(
        bytes32 indexed locationHash,
        address indexed contributor,
        uint256 latPacked,   // (lat + 90) * 1e6 — offset off-chain evita negativos
        uint256 lngPacked,   // (lng + 180) * 1e6
        uint256 blockNumber
    );

    event ContributionSubmitted(
        bytes32 indexed contributionId,
        bytes32 indexed locationHash,
        address indexed contributor,
        ContributionType contributionType,
        bytes32 dataHash,    // hash IPFS/Arweave das fotos + metadados
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

    /// @dev Emitido quando a chamada ao Memo falha e é engolida pelo try/catch.
    ///      Sem isto, a perda de metadados era silenciosa — ninguém saberia que
    ///      o registro no Goldsky ficou incompleto.
    event MemoAttachFailed(bytes32 indexed id, uint256 blockNumber);

    event RewardDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);

    // ── Enums ───────────────────────────────────────────────────────────────
    enum ContributionType { NewLocation, Update, Photo, Verification }

    // ── Structs ─────────────────────────────────────────────────────────────
    struct Location {
        bytes32 locationHash;     // hash de lat/lng/nome/categoria
        address firstContributor;
        uint256 registeredBlock;
        uint256 verificationCount;
        bool exists;
    }

    struct Contribution {
        bytes32 locationHash;
        address contributor;
        ContributionType contributionType;
        bytes32 dataHash;         // hash IPFS/Arweave
        bool verified;
        address verifier;
        uint256 verifiedBlock;
        bool rejected;
        string rejectReason;
    }

    // ── Constantes ──────────────────────────────────────────────────────────
    /// @notice Limite do texto de rejeição. Sem limite, um verificador podia
    ///         gravar kilobytes de string em storage às custas do gas do relayer.
    uint256 public constant MAX_REJECT_REASON = 200;

    // ── State ───────────────────────────────────────────────────────────────
    // Não-immutable: setado após deploy via setRewardDistributor() (two-phase deploy).
    IRewardDistributor public rewardDistributor;

    /// @notice Contrato Memo da Arc. address(0) = indexação por Memo desligada.
    /// @dev    immutable, não constant: o endereço muda entre testnet e mainnet.
    IMemo public immutable memo;

    mapping(address => bool) public authorizedCallers;

    mapping(bytes32 => Location) public locations;           // locationHash => Location
    mapping(bytes32 => Contribution) public contributions;   // contributionId => Contribution
    bytes32[] public allLocationHashes;                      // locais enumeráveis

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != admin) revert Unauthorized();
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────────
    /// @param _rewardDistributor  Pode ser address(0) no two-phase deploy.
    /// @param _admin              Deve ser o multisig em produção.
    /// @param _memo               Contrato Memo da rede; address(0) desliga.
    constructor(address _rewardDistributor, address _admin, address _memo) Admin2Step(_admin) {
        if (_rewardDistributor != address(0)) {
            rewardDistributor = IRewardDistributor(_rewardDistributor);
            emit RewardDistributorUpdated(address(0), _rewardDistributor);
        }
        memo = IMemo(_memo);
        authorizedCallers[_admin] = true;
        emit AuthorizedCallerUpdated(_admin, true);
    }

    /// @notice Seta/atualiza o RewardDistributor (somente admin).
    /// @dev    Atualizável de propósito: a versão "só uma vez" travou a v1
    ///         apontando para um distributor inexistente, quebrando toda
    ///         verificação sem caminho de conserto.
    function setRewardDistributor(address _distributor) external onlyAdmin {
        if (_distributor == address(0)) revert ZeroAddress();
        emit RewardDistributorUpdated(address(rewardDistributor), _distributor);
        rewardDistributor = IRewardDistributor(_distributor);
    }

    // ── Interno: Memo ───────────────────────────────────────────────────────
    /// @dev Falha no Memo não deve reverter o registro (é indexação auxiliar),
    ///      mas silenciar de vez não deixa rastro de que o Goldsky ficou sem
    ///      esses metadados — por isso o catch emite evento em vez de `{}`.
    function _attachMemo(bytes32 id, bytes memory data) internal {
        if (address(memo) == address(0)) return;
        try memo.attachMemo(id, data) {}
        catch { emit MemoAttachFailed(id, block.number); }
    }

    // ── Core: Register Location ─────────────────────────────────────────────

    /// @notice Registra um novo local acessível.
    /// @param locationHash  Hash de (lat, lng, nome, categoria) — calculado off-chain.
    /// @param latPacked     (Latitude + 90) * 1e6.
    /// @param lngPacked     (Longitude + 180) * 1e6.
    /// @param dataHash      Hash IPFS/Arweave das fotos + metadados.
    /// @param contributor   Endereço REAL do contribuidor (o relayer chama em
    ///                      nome do usuário). address(0) → usa msg.sender.
    function registerLocation(
        bytes32 locationHash,
        uint256 latPacked,
        uint256 lngPacked,
        bytes32 dataHash,
        address contributor
    ) external onlyAuthorized {
        if (locations[locationHash].exists) revert LocationAlreadyRegistered(locationHash);
        address actualContributor = contributor == address(0) ? msg.sender : contributor;

        locations[locationHash] = Location({
            locationHash: locationHash,
            firstContributor: actualContributor,
            registeredBlock: block.number,  // block.number, NÃO block.timestamp
            verificationCount: 0,
            exists: true
        });
        allLocationHashes.push(locationHash);

        _attachMemo(locationHash, abi.encodePacked(latPacked, lngPacked, dataHash));

        emit LocationRegistered(locationHash, actualContributor, latPacked, lngPacked, block.number);
    }

    // ── Core: Submit Contribution ───────────────────────────────────────────

    /// @notice Submete uma contribuição (atualização, foto, pedido de verificação).
    /// @param contributor  Endereço REAL do contribuidor (address(0) → msg.sender).
    function submitContribution(
        bytes32 contributionId,
        bytes32 locationHash,
        ContributionType contributionType,
        bytes32 dataHash,
        address contributor
    ) external onlyAuthorized {
        if (!locations[locationHash].exists) revert LocationNotFound(locationHash);
        if (contributions[contributionId].contributor != address(0)) {
            revert ContributionAlreadyExists(contributionId);
        }
        address actualContributor = contributor == address(0) ? msg.sender : contributor;

        contributions[contributionId] = Contribution({
            locationHash: locationHash,
            contributor: actualContributor,
            contributionType: contributionType,
            dataHash: dataHash,
            verified: false,
            verifier: address(0),
            verifiedBlock: 0,
            rejected: false,
            rejectReason: ""
        });

        _attachMemo(contributionId, abi.encodePacked(locationHash, dataHash));

        emit ContributionSubmitted(
            contributionId,
            locationHash,
            actualContributor,
            contributionType,
            dataHash,
            block.number
        );
    }

    // ── Core: Verify Contribution ───────────────────────────────────────────

    /// @notice Verifica uma contribuição. Só verificadores aprovados podem chamar.
    /// @dev    v5: a autoridade vem do conjunto `verifiers` do RewardDistributor,
    ///         NÃO da lista `authorizedCallers` deste contrato.
    ///
    ///         Na v4 o modificador era `onlyAuthorized`, o que dava poder de
    ///         verificação a qualquer relayer autorizado. Como o relayer também
    ///         assina em nome dos usuários, isso fechava o ciclo
    ///         registrar → verificar → pagar numa única chave. Separar as duas
    ///         listas é o que faz a verificação significar alguma coisa.
    function verifyContribution(bytes32 contributionId, bool approve, string calldata reason)
        external
    {
        if (address(rewardDistributor) == address(0)) revert RewardDistributorNotSet();
        if (!rewardDistributor.verifiers(msg.sender)) revert NotAVerifier(msg.sender);
        if (bytes(reason).length > MAX_REJECT_REASON) {
            revert RejectReasonTooLong(bytes(reason).length, MAX_REJECT_REASON);
        }

        Contribution storage c = contributions[contributionId];
        if (c.contributor == address(0)) revert ContributionNotFound(contributionId);
        if (c.verified || c.rejected) revert AlreadyVerified(contributionId);
        // Checado aqui além do distributor: defesa em profundidade barata.
        if (msg.sender == c.contributor) revert SelfVerificationForbidden();

        // Registra no RewardDistributor (cooldown + anti auto-verificação).
        rewardDistributor.recordVerification(contributionId, msg.sender, c.contributor);

        if (approve) {
            c.verified = true;
            c.verifier = msg.sender;
            c.verifiedBlock = block.number;
            locations[c.locationHash].verificationCount++;

            emit ContributionVerified(contributionId, msg.sender, c.contributor, block.number);
        } else {
            c.rejected = true;
            c.verifier = msg.sender;
            c.rejectReason = reason;

            emit ContributionRejected(contributionId, msg.sender, reason, block.number);
        }
    }

    // ── View Functions ──────────────────────────────────────────────────────

    /// @notice Status de verificação de uma contribuição (para o RewardDistributor).
    function getContribution(bytes32 contributionId)
        external
        view
        returns (bool verified, address verifier, uint256 blockNumber)
    {
        Contribution storage c = contributions[contributionId];
        return (c.verified, c.verifier, c.verifiedBlock);
    }

    /// @notice Endereço de quem de fato contribuiu.
    /// @dev    v5: usado pelo RewardDistributor para conferir que a recompensa
    ///         vai para o contribuidor registrado, e não para um endereço
    ///         qualquer passado pelo chamador autorizado.
    function getContributor(bytes32 contributionId) external view returns (address) {
        return contributions[contributionId].contributor;
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
        emit AuthorizedCallerUpdated(caller, authorized);
    }
}

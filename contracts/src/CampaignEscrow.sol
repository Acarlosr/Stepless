// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — CampaignEscrow.sol  (v1)
//  Campanhas de mapeamento financiadas por parceiros, com pagamento por resultado.
//
//  POR QUE ISTO EXISTE
//  A tesouraria única do RewardDistributor depende de alguém doar "no escuro".
//  Aqui a pergunta ao parceiro muda de "doe" para "pague só pelo que for
//  verificado":
//
//    1. O parceiro (loja, hotel, prefeitura, associação, empresa com meta ESG)
//       cria uma campanha e deposita  valorPorLocal × quantidade  em USDC.
//    2. Contribuições VERIFICADAS no SteplessOracle — por um verificador que não
//       é o contribuidor — são atribuídas à campanha e pagas ao contribuidor
//       registrado no Oracle. O destino nunca é escolhido por quem chama.
//    3. Terminado o prazo, o que não foi usado volta para o parceiro.
//       Qualquer pessoa pode disparar a devolução; o destino é fixo.
//
//  O QUE O ADMIN NÃO PODE FAZER (de propósito)
//    - Não existe saque do admin. O dinheiro de uma campanha só sai para
//      (a) contribuidores verificados dela ou (b) o parceiro, no reembolso.
//    - Pausar bloqueia novos pagamentos, mas NUNCA bloqueia o reembolso.
//  É isso que permite dizer ao parceiro: "nem o Stepless consegue mexer no seu
//  dinheiro".
//
//  PAPÉIS
//    admin     — multisig. Liga/desliga atestadores e pausa pagamentos.
//    attester  — serviço que decide se uma contribuição pertence à campanha
//                (zona, categoria). Isso é off-chain porque o Oracle só guarda
//                locationHash. DEVE ser uma chave diferente do relayer e dos
//                verificadores, senão uma chave só fecha o ciclo
//                registrar → verificar → pagar.
//    sponsor   — pode atestar a PRÓPRIA campanha (ex.: uma prefeitura que
//                confere a zona dela) e trocar o endereço de reembolso.
//
//  LIMITES DO QUE UM ATESTADOR COMPROMETIDO CONSEGUE FAZER
//    - Só paga contribuição já verificada no Oracle por outra pessoa.
//    - Só contribuição verificada DEPOIS da criação da campanha (não drena a
//      campanha com o histórico antigo).
//    - Cada contribuição é paga por no máximo UMA campanha.
//    - Respeita maxPerContributor, se o parceiro definir.
//    - O pagamento vai sempre para o contribuidor registrado no Oracle.
//
//  Particularidades da Arc (as mesmas do RewardDistributor):
//    - USDC: interface ERC-20 com 6 decimais ($0,25 = 250_000).
//    - Transferências podem reverter com saldo (blocklist, address(0)) ou, em
//      teoria, "dar certo" sem mover saldo — toda entrada e saída confere o
//      saldo real antes e depois.
//    - block.timestamp não é estritamente crescente em blocos sub-segundo;
//      usado só para prazos em dias, e block.number para "verificado depois de".
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import {Admin2Step, Unauthorized, ZeroAddress} from "./lib/Admin2Step.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

interface IERC20Campaign {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IOracleCampaign {
    function getContribution(bytes32 contributionId)
        external
        view
        returns (bool verified, address verifier, uint256 blockNumber);
    function getContributor(bytes32 contributionId) external view returns (address);
}

contract CampaignEscrow is Admin2Step, ReentrancyGuard {
    // ════════════════════════════════════════════════════════════════════════
    //  Errors
    // ════════════════════════════════════════════════════════════════════════

    error InvalidUsdc(address usdc);
    error InvalidReward(uint256 reward);
    error InvalidMaxItems(uint256 maxItems);
    error InvalidDuration(uint256 duration);
    error EmptyBrandRef();
    error CampaignNotFound(uint256 campaignId);
    error CampaignEnded(uint256 campaignId, uint256 deadline);
    error CampaignStillRunning(uint256 campaignId, uint256 deadline);
    error CampaignFull(uint256 campaignId);
    error AlreadyRefunded(uint256 campaignId);
    error NothingToRefund(uint256 campaignId);
    error ContributionNotVerified(bytes32 contributionId);
    error VerifiedBeforeCampaign(bytes32 contributionId, uint256 verifiedBlock, uint256 startBlock);
    error ContributionAlreadyPaid(bytes32 contributionId, uint256 campaignId);
    error UnknownContributor(bytes32 contributionId);
    error ContributorLimitReached(uint256 campaignId, address contributor, uint256 limit);
    error NotAttester(address caller, uint256 campaignId);
    error NotSponsor(address caller, uint256 campaignId);
    error TransferInFailed(uint256 expected, uint256 received);
    error TransferOutFailed(address to, uint256 amount, bytes reason);
    error PaymentsPaused();

    // ════════════════════════════════════════════════════════════════════════
    //  Events
    // ════════════════════════════════════════════════════════════════════════

    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed sponsor,
        bytes32 indexed brandRef,
        uint256 rewardPerItem,
        uint256 maxItems,
        uint256 maxPerContributor,
        uint256 deadline,
        bytes32 metaRef,
        uint256 deposited
    );
    event CampaignPaid(
        uint256 indexed campaignId,
        bytes32 indexed contributionId,
        address indexed contributor,
        uint256 amount,
        address attester
    );
    event CampaignRefunded(uint256 indexed campaignId, address indexed to, uint256 amount);
    event RefundRecipientUpdated(uint256 indexed campaignId, address indexed newRecipient);
    event AttesterUpdated(address indexed attester, bool authorized);
    event PaymentsPausedSet(bool paused);

    // ════════════════════════════════════════════════════════════════════════
    //  Constantes
    // ════════════════════════════════════════════════════════════════════════

    uint8 public constant USDC_DECIMALS = 6;

    /// @notice $0,01 — abaixo disso o gás do pagamento vira parte relevante do valor.
    uint256 public constant MIN_REWARD = 10_000;
    /// @notice $100 — mesmo teto por item do RewardDistributor.
    uint256 public constant MAX_REWARD = 100_000_000;
    /// @notice Limite de itens por campanha (evita overflow e campanhas absurdas).
    uint256 public constant MAX_ITEMS = 100_000;

    /// @notice Prazo mínimo: tempo para a comunidade ver a campanha e mapear.
    uint256 public constant MIN_DURATION = 1 days;
    /// @notice Prazo máximo: o dinheiro do parceiro não fica preso por mais de ~1 ano.
    uint256 public constant MAX_DURATION = 366 days;

    // ════════════════════════════════════════════════════════════════════════
    //  Estado
    // ════════════════════════════════════════════════════════════════════════

    IERC20Campaign public immutable USDC;
    IOracleCampaign public immutable oracle;

    struct Campaign {
        address sponsor;           // quem criou e depositou
        address refundTo;          // para onde volta o saldo (padrão = sponsor)
        bytes32 brandRef;          // identificador da marca (mural off-chain)
        bytes32 metaRef;           // hash/CID com zona, categorias e descrição
        uint256 rewardPerItem;     // USDC 6 dec
        uint256 maxItems;
        uint256 maxPerContributor; // 0 = sem limite
        uint256 itemsPaid;
        uint256 deposited;
        uint256 paidOut;
        uint256 startBlock;        // contribuições verificadas antes disto não contam
        uint256 deadline;          // timestamp
        bool refunded;
    }

    /// @notice Campanhas, começando em 1 (0 = "nenhuma" em paidByCampaign).
    mapping(uint256 => Campaign) public campaigns;
    uint256 public campaignCount;

    /// @notice contributionId => campanha que pagou (0 = nenhuma).
    mapping(bytes32 => uint256) public paidByCampaign;

    /// @notice campaignId => contribuidor => quantas contribuições pagas.
    mapping(uint256 => mapping(address => uint256)) public paidCountOf;

    mapping(address => bool) public attesters;

    bool public paymentsPaused;

    /// @notice Soma de tudo que ainda pertence a campanhas (depositado − pago − reembolsado).
    uint256 public totalEscrowed;

    // ════════════════════════════════════════════════════════════════════════
    //  Constructor
    // ════════════════════════════════════════════════════════════════════════

    /// @param _oracle SteplessOracle já deployado.
    /// @param _admin  Multisig em produção.
    /// @param _usdc   Interface ERC-20 do USDC na rede alvo (6 decimais).
    constructor(address _oracle, address _admin, address _usdc) Admin2Step(_admin) {
        if (_oracle == address(0) || _usdc == address(0)) revert ZeroAddress();
        if (_usdc.code.length == 0) revert InvalidUsdc(_usdc);
        try IERC20Campaign(_usdc).decimals() returns (uint8 d) {
            if (d != USDC_DECIMALS) revert InvalidUsdc(_usdc);
        } catch {
            revert InvalidUsdc(_usdc);
        }
        oracle = IOracleCampaign(_oracle);
        USDC = IERC20Campaign(_usdc);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Parceiro
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Cria uma campanha e deposita rewardPerItem × maxItems.
    /// @dev    O chamador precisa ter aprovado este contrato no USDC antes.
    /// @param rewardPerItem     Valor por contribuição verificada (6 dec).
    /// @param maxItems          Quantas contribuições a campanha paga no máximo.
    /// @param maxPerContributor Limite por pessoa (0 = sem limite). Recomendado
    ///                          usar: reduz o ganho de quem cria várias contas.
    /// @param duration          Segundos até o prazo (entre 1 e 366 dias).
    /// @param brandRef          Identificador da marca (não pode ser zero).
    /// @param metaRef           Hash/CID da descrição (zona, categorias). Pode ser zero.
    function createCampaign(
        uint256 rewardPerItem,
        uint256 maxItems,
        uint256 maxPerContributor,
        uint256 duration,
        bytes32 brandRef,
        bytes32 metaRef
    ) external nonReentrant returns (uint256 campaignId) {
        if (rewardPerItem < MIN_REWARD || rewardPerItem > MAX_REWARD) revert InvalidReward(rewardPerItem);
        if (maxItems == 0 || maxItems > MAX_ITEMS) revert InvalidMaxItems(maxItems);
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration(duration);
        if (brandRef == bytes32(0)) revert EmptyBrandRef();

        uint256 total = rewardPerItem * maxItems; // máx. 1e8 × 1e5 = 1e13, sem risco de overflow

        _pullExact(msg.sender, total);

        campaignId = ++campaignCount;
        Campaign storage c = campaigns[campaignId];
        c.sponsor = msg.sender;
        c.refundTo = msg.sender;
        c.brandRef = brandRef;
        c.metaRef = metaRef;
        c.rewardPerItem = rewardPerItem;
        c.maxItems = maxItems;
        c.maxPerContributor = maxPerContributor;
        c.deposited = total;
        c.startBlock = block.number;
        c.deadline = block.timestamp + duration;

        totalEscrowed += total;

        emit CampaignCreated(
            campaignId, msg.sender, brandRef, rewardPerItem, maxItems,
            maxPerContributor, c.deadline, metaRef, total
        );
    }

    /// @notice Troca o endereço que recebe o reembolso (ex.: carteira do parceiro
    ///         entrou numa blocklist ou ele quer receber em outra conta).
    function setRefundRecipient(uint256 campaignId, address to) external {
        Campaign storage c = _get(campaignId);
        if (msg.sender != c.sponsor) revert NotSponsor(msg.sender, campaignId);
        if (to == address(0)) revert ZeroAddress();
        c.refundTo = to;
        emit RefundRecipientUpdated(campaignId, to);
    }

    /// @notice Devolve o saldo não usado depois do prazo. Qualquer um pode chamar;
    ///         o destino é sempre refundTo. Funciona mesmo com pagamentos pausados.
    function refund(uint256 campaignId) external nonReentrant {
        Campaign storage c = _get(campaignId);
        if (block.timestamp < c.deadline) revert CampaignStillRunning(campaignId, c.deadline);
        if (c.refunded) revert AlreadyRefunded(campaignId);

        uint256 amount = c.deposited - c.paidOut;
        if (amount == 0) revert NothingToRefund(campaignId);

        c.refunded = true;
        totalEscrowed -= amount;

        _pushExact(c.refundTo, amount);
        emit CampaignRefunded(campaignId, c.refundTo, amount);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Pagamento por contribuição verificada
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Atribui uma contribuição verificada à campanha e paga o contribuidor.
    /// @dev    Chamado por um atestador autorizado ou pelo próprio parceiro.
    ///         Se a transferência falhar (ex.: contribuidor na blocklist), reverte
    ///         inteiro — nada é consumido e a vaga continua livre.
    function payContribution(uint256 campaignId, bytes32 contributionId) external nonReentrant {
        if (paymentsPaused) revert PaymentsPaused();

        Campaign storage c = _get(campaignId);
        if (!attesters[msg.sender] && msg.sender != c.sponsor) revert NotAttester(msg.sender, campaignId);
        if (c.refunded || block.timestamp >= c.deadline) revert CampaignEnded(campaignId, c.deadline);
        if (c.itemsPaid >= c.maxItems) revert CampaignFull(campaignId);

        uint256 already = paidByCampaign[contributionId];
        if (already != 0) revert ContributionAlreadyPaid(contributionId, already);

        (bool verified, , uint256 verifiedBlock) = oracle.getContribution(contributionId);
        if (!verified) revert ContributionNotVerified(contributionId);
        if (verifiedBlock < c.startBlock) {
            revert VerifiedBeforeCampaign(contributionId, verifiedBlock, c.startBlock);
        }

        address contributor = oracle.getContributor(contributionId);
        if (contributor == address(0)) revert UnknownContributor(contributionId);

        uint256 count = paidCountOf[campaignId][contributor];
        if (c.maxPerContributor != 0 && count >= c.maxPerContributor) {
            revert ContributorLimitReached(campaignId, contributor, c.maxPerContributor);
        }

        uint256 amount = c.rewardPerItem;

        // Efeitos antes da interação.
        paidByCampaign[contributionId] = campaignId;
        paidCountOf[campaignId][contributor] = count + 1;
        c.itemsPaid += 1;
        c.paidOut += amount;
        totalEscrowed -= amount;

        _pushExact(contributor, amount);
        emit CampaignPaid(campaignId, contributionId, contributor, amount, msg.sender);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Admin
    // ════════════════════════════════════════════════════════════════════════

    function setAttester(address attester, bool authorized) external onlyAdmin {
        if (attester == address(0)) revert ZeroAddress();
        attesters[attester] = authorized;
        emit AttesterUpdated(attester, authorized);
    }

    /// @notice Pausa só os pagamentos. Criar campanha e reembolsar continuam funcionando.
    function setPaymentsPaused(bool _paused) external onlyAdmin {
        paymentsPaused = _paused;
        emit PaymentsPausedSet(_paused);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Leitura
    // ════════════════════════════════════════════════════════════════════════

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _get(campaignId);
    }

    /// @notice Saldo ainda disponível para pagar contribuições.
    function remaining(uint256 campaignId) external view returns (uint256) {
        Campaign storage c = _get(campaignId);
        if (c.refunded) return 0;
        return c.deposited - c.paidOut;
    }

    /// @notice A campanha aceita pagamentos agora?
    function isActive(uint256 campaignId) external view returns (bool) {
        Campaign storage c = campaigns[campaignId];
        return c.sponsor != address(0)
            && !c.refunded
            && block.timestamp < c.deadline
            && c.itemsPaid < c.maxItems;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Internos
    // ════════════════════════════════════════════════════════════════════════

    function _get(uint256 campaignId) internal view returns (Campaign storage c) {
        c = campaigns[campaignId];
        if (c.sponsor == address(0)) revert CampaignNotFound(campaignId);
    }

    /// @dev Puxa exatamente `amount` do parceiro e confere que o saldo subiu isso.
    function _pullExact(address from, uint256 amount) internal {
        uint256 before = USDC.balanceOf(address(this));
        (bool ok, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(IERC20Campaign.transferFrom.selector, from, address(this), amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert TransferInFailed(amount, 0);
        }
        uint256 received = USDC.balanceOf(address(this)) - before;
        if (received != amount) revert TransferInFailed(amount, received);
    }

    /// @dev Envia `amount` e confere que o saldo caiu isso. Reverte em qualquer falha.
    function _pushExact(address to, uint256 amount) internal {
        uint256 before = USDC.balanceOf(address(this));
        (bool ok, bytes memory data) = address(USDC).call(
            abi.encodeWithSelector(IERC20Campaign.transfer.selector, to, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert TransferOutFailed(to, amount, data);
        }
        uint256 afterBal = USDC.balanceOf(address(this));
        if (afterBal + amount > before) {
            revert TransferOutFailed(to, amount, bytes("balance did not decrease as expected"));
        }
    }
}

// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — Admin2Step.sol
//  Transferência de admin em duas fases, compartilhada pelos 3 contratos.
//
//  POR QUE ISTO EXISTE: a v1 do Stepless foi perdida exatamente por um
//  `transferAdmin` de uma fase — o admin foi transferido para um endereço que
//  ninguém controlava e os contratos ficaram órfãos, com saldo dentro. Em
//  mainnet esse erro não tem desfazer.
//
//  Com duas fases, o endereço novo precisa PROVAR que consegue assinar
//  (chamando acceptAdmin) antes de receber o poder. Um endereço digitado
//  errado simplesmente nunca aceita, e o admin atual continua no controle.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

// Declarados no nível do arquivo (não dentro do contrato) para que qualquer
// arquivo que importe este consiga referenciá-los como `Unauthorized.selector`
// sem qualificar pelo nome do contrato — inclusive os testes.
error Unauthorized();
error ZeroAddress();

abstract contract Admin2Step {
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    address public admin;
    address public pendingAdmin;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
        emit AdminChanged(address(0), _admin);
    }

    /// @notice Fase 1 — o admin atual propõe um sucessor. Nada muda ainda.
    /// @dev    Passar address(0) cancela uma transferência pendente.
    function transferAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    /// @notice Fase 2 — o sucessor aceita. Só aqui o poder muda de mãos.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        emit AdminChanged(admin, msg.sender);
        admin = msg.sender;
        pendingAdmin = address(0);
    }
}

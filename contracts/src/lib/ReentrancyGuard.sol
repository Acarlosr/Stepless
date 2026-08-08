// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — ReentrancyGuard.sol
//
//  POR QUE ISTO EXISTE: o RewardDistributor já segue checks-effects-interactions
//  (marca `rewardClaimed` antes de transferir), e em tese isso basta. Mas o
//  próprio contrato documenta que o USDC da Arc tem comportamentos que fogem do
//  ERC-20 estrito (blocklist, burn proibido, drenagem de conta vazia). Confiar
//  só na ordem das operações contra um token com semântica não padrão é margem
//  fina demais para um contrato que guarda dinheiro real.
//
//  Implementação em storage (não transient): `transient` só existe a partir do
//  solc 0.8.28 e o projeto está travado em 0.8.24.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

abstract contract ReentrancyGuard {
    error ReentrancyDetected();

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyDetected();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

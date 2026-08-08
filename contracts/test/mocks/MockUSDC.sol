// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — MockUSDC.sol (apenas testes)
//
//  ERC-20 de 6 decimais que reproduz os comportamentos da Arc que quebram a
//  suposição ERC-20 padrão:
//
//    blocklist       → transfer reverte, mesmo com saldo sobrando
//    silentFailure   → transfer retorna true SEM mover saldo (o quirk que a
//                      checagem de "o saldo caiu mesmo?" do _safeTransfer
//                      existe para pegar)
//    returnsFalse    → transfer retorna false em vez de reverter
//
//  A v4 do RewardDistributor era testada com vm.mockCall num endereço fixo,
//  o que sempre respondia "true" e nunca exercitava nenhum desses caminhos.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

contract MockUSDC {
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";
    uint8 public immutable decimalsValue;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    mapping(address => bool) public blocklisted;
    bool public silentFailure;
    bool public returnsFalse;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint8 _decimals) {
        decimalsValue = _decimals;
    }

    function decimals() external view returns (uint8) {
        return decimalsValue;
    }

    // ── Controles de teste ──────────────────────────────────────────────────
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setBlocklisted(address who, bool value) external {
        blocklisted[who] = value;
    }

    function setSilentFailure(bool value) external {
        silentFailure = value;
    }

    function setReturnsFalse(bool value) external {
        returnsFalse = value;
    }

    // ── ERC-20 ──────────────────────────────────────────────────────────────
    function transfer(address to, uint256 amount) external returns (bool) {
        if (returnsFalse) return false;
        // Arc: transferir de/para endereço bloqueado reverte em runtime.
        require(!blocklisted[msg.sender] && !blocklisted[to], "USDC: blocklisted");
        require(to != address(0), "USDC: Zero address not allowed");
        if (silentFailure) return true; // diz que deu certo, não move nada
        require(balanceOf[msg.sender] >= amount, "USDC: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (returnsFalse) return false;
        require(!blocklisted[from] && !blocklisted[to], "USDC: blocklisted");
        require(allowance[from][msg.sender] >= amount, "USDC: insufficient allowance");
        require(balanceOf[from] >= amount, "USDC: insufficient balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

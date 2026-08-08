// SPDX-License-Identifier: MIT
// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — Deploy Script (Foundry)
//
//  Deploy em duas fases (dependência circular Oracle ↔ Distributor):
//    1. Oracle com address(0) no lugar do distributor
//    2. RewardDistributor com o endereço real do Oracle
//    3. X402API com o endereço real do Oracle
//    4. oracle.setRewardDistributor(distributor)
//    5. Autoriza o relayer e o Oracle nos lugares certos
//    6. Transfere o admin para o multisig (fase 1 de 2 — o multisig precisa
//       chamar acceptAdmin() depois)
//
//  ── Variáveis de ambiente obrigatórias ────────────────────────────────────
//    PRIVATE_KEY       chave do deployer (só faz o deploy; NÃO fica admin)
//    ADMIN_ADDRESS     multisig que vai administrar os contratos
//    RELAYER_ADDRESS   EOA do relayer (escreve em nome dos usuários)
//    USDC_ADDRESS      interface ERC-20 do USDC na rede alvo
//    MEMO_ADDRESS      contrato Memo da rede (0x0 desliga a indexação por memo)
//
//  Nenhum valor tem default. Um endereço de USDC errado em mainnet é
//  irreversível, então preferimos falhar no deploy a adivinhar.
//
//  Uso:
//    forge script script/DeployStepless.s.sol:DeployStepless \
//      --rpc-url $ARC_RPC_URL --broadcast --verify
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {SteplessOracle} from "../src/SteplessOracle.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {X402API} from "../src/X402API.sol";

contract DeployStepless is Script {
    function run() external {
        uint256 privateKey  = vm.envUint("PRIVATE_KEY");
        address admin       = vm.envAddress("ADMIN_ADDRESS");
        address relayer     = vm.envAddress("RELAYER_ADDRESS");
        address usdc        = vm.envAddress("USDC_ADDRESS");
        address memoAddr    = vm.envAddress("MEMO_ADDRESS");

        address deployer = vm.addr(privateKey);

        require(admin != address(0), "ADMIN_ADDRESS obrigatorio");
        require(relayer != address(0), "RELAYER_ADDRESS obrigatorio");
        require(usdc != address(0), "USDC_ADDRESS obrigatorio");
        require(usdc.code.length > 0, "USDC_ADDRESS sem codigo nesta rede");
        // O relayer NAO pode ser o admin: e exatamente o acoplamento que
        // permitia drenar a tesouraria com uma unica chave (auditoria C1).
        require(relayer != admin, "RELAYER_ADDRESS deve ser diferente de ADMIN_ADDRESS");

        vm.startBroadcast(privateKey);

        // ── Fase 1: Oracle com placeholder ──────────────────────────────────
        // O deployer entra como admin temporario para poder fazer o wiring;
        // na fase 6 o poder passa para o multisig.
        SteplessOracle oracle = new SteplessOracle(address(0), deployer, memoAddr);

        // ── Fase 2 e 3 ──────────────────────────────────────────────────────
        RewardDistributor distributor = new RewardDistributor(address(oracle), deployer, usdc);
        X402API api = new X402API(address(oracle), deployer, usdc);

        // ── Fase 4: resolve a dependencia circular ──────────────────────────
        oracle.setRewardDistributor(address(distributor));

        // ── Fase 5: autorizacoes minimas ────────────────────────────────────
        // O relayer escreve no Oracle (registerLocation/submitContribution) e
        // dispara pagamentos no Distributor (payReward).
        oracle.setAuthorizedCaller(relayer, true);
        distributor.setAuthorizedCaller(relayer, true);

        // O deployer nao precisa continuar autorizado depois do wiring.
        oracle.setAuthorizedCaller(deployer, false);
        distributor.setAuthorizedCaller(deployer, false);

        // NOTA: o Oracle NAO precisa mais ser authorizedCaller do Distributor.
        // recordVerification() agora exige msg.sender == address(oracle)
        // diretamente, o que e mais restrito do que estar numa lista.

        // ── Fase 6: entrega o admin ao multisig (fase 1 de 2) ───────────────
        oracle.transferAdmin(admin);
        distributor.transferAdmin(admin);
        api.transferAdmin(admin);

        vm.stopBroadcast();

        console.log("=== Stepless v5 ===");
        console.log("SteplessOracle:      ", address(oracle));
        console.log("RewardDistributor:   ", address(distributor));
        console.log("X402API:             ", address(api));
        console.log("USDC (ERC-20):       ", usdc);
        console.log("Memo:                ", memoAddr);
        console.log("Relayer autorizado:  ", relayer);
        console.log("Admin pendente:      ", admin);
        console.log("");
        console.log("PROXIMOS PASSOS (nesta ordem):");
        console.log("  1. Do multisig, chamar acceptAdmin() nos TRES contratos.");
        console.log("     Ate isso acontecer, o admin ainda e o deployer.");
        console.log("  2. distributor.setVerifier(<verificador>, true)");
        console.log("  3. Aprovar USDC e chamar distributor.fundTreasury(<valor>)");
        console.log("  4. Conferir: distributor.USDC() == USDC_ADDRESS");
        console.log("  5. Queimar a chave do deployer.");
    }
}

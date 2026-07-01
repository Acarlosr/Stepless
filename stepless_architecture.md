# ♿ RewardDistributor.sol — Documentação de Arquitetura

## Visão Geral

O `RewardDistributor.sol` é o contrato central do Stepless responsável por distribuir micro-recompensas em USDC para contribuidores que mapeiam e verificam locais acessíveis. Ele foi projetado especificamente para a **Arc Testnet**, respeitando todas as peculiaridades documentadas oficialmente.

---

## Arquitetura dos 3 Contratos

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND / BACKEND                        │
│  (Viem/ethers.js + Circle Wallets + Gas Station)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌───────────────────┐    ┌──────────────┐  │
│  │ SteplessOracle│◄──►│ RewardDistributor │◄──►│   X402API    │  │
│  │     .sol      │    │      .sol         │    │     .sol     │  │
│  │               │    │                   │    │              │  │
│  │ • Registra    │    │ • Paga USDC       │    │ • Cobra por  │  │
│  │   localidades │    │   por contribuição│    │   query      │  │
│  │ • Verifica    │    │ • Anti-Sybil      │    │ • Assinaturas│  │
│  │   contribs    │    │ • Reputação       │    │   mensais    │  │
│  │ • Usa Memo    │    │ • Pausável        │    │ • Receita →  │  │
│  │   contract    │    │ • Batch payments  │    │   treasury   │  │
│  └──────┬────────┘    └────────┬──────────┘    └──────┬───────┘  │
│         │                      │                      │          │
│         │         ┌────────────┘                      │          │
│         ▼         ▼                                   ▼          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              USDC (ERC-20, 6 decimals)                   │   │
│  │              0x3600000000000000000000000000000000000000  │   │
│  │              (Mesmo asset que native USDC 18 decimals)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Memo Contract (Arc predeployed)                         │   │
│  │  0x5294E9927c3306DcBaDb03fe70b92e01cCede505             │   │
│  │  • Metadados on-chain sem storage caro                   │   │
│  │  • Emite Memo events indexáveis por Goldsky              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Recompensa (End-to-End)

```
1. Contribuidor mapeia local
   → Backend cria contributionId (hash)
   → SteplessOracle.registerLocation() + submitContribution()
   → Memo contract anexa metadados (lat/lng/dataHash)

2. Verificador valida
   → SteplessOracle.verifyContribution(contributionId, true)
   → RewardDistributor.recordVerification() — checa cooldown + anti-self-verify
   → Emite ContributionVerified event

3. Recompensa é paga
   → Backend chama RewardDistributor.payReward(contributionId, contributor, type)
   → Contrato verifica no Oracle que contribution está verified
   → Marca rewardClaimed[contributionId] = true (anti double-spend)
   → _safeTransfer() envia USDC via ERC-20 (6 decimals)
   → try/catch captura reverts (blocklist, zero address, drain)
   → Emite RewardPaid event (indexável por Goldsky)

4. Se transfer falhar
   → Emite RewardFailed event
   → Admin pode chamar retryReward() depois
   → Contribuição já está marcada como claimed (não double-spend)

5. App consume a API
   → X402API.queryLocation() — paga fee por query
   → Receita vai para o treasury do RewardDistributor
   → Ciclo recomeça
```

---

## Decisões Arquiteturais Baseadas na Doc da Arc

### 1. USDC ERC-20 (6 dec) como Interface Padrão

**Decisão:** Todas as transferências de recompensa usam `IERC20(USDC).transfer()` com 6 decimals.

**Razão (da doc):**
> *"Native USDC and the ERC-20 USDC interface are the same asset, not two separate tokens."*
> *"It's recommended to rely solely on the standard ERC-20 interface for reading balances and sending transfers."*

**Implementação:**
- $0.10 USDC = `100_000` (6 decimals)
- $0.05 USDC = `50_000` (6 decimals)
- $5.00 USDC = `5_000_000` (6 decimals)

**Armadilha evitada:** Misturar `msg.value` (18 dec) com `balanceOf` (6 dec) causaria bugs onde $0.10 aparece como $100,000.

### 2. `_safeTransfer()` com try/catch

**Decisão:** Toda transferência de USDC usa low-level call com try/catch.

**Razão (da doc):**
> *"A native transfer can revert even with a sufficient balance."*

**Casos cobertos:**
- Transfer para `address(0)` → reverte com "Zero address not allowed"
- Transfer para endereço blocklisted (`0x70997970...79C8` na testnet) → reverte
- Transfer para conta self-destructed → reverte (forbidden burn)
- Draining empty account (saldo zero, nonce zero, sem código) → reverte

**Implementação:**
```solidity
function _safeTransfer(address to, uint256 amount, bytes32 contributionId) internal {
    (bool success, bytes memory data) = address(USDC).call(
        abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
    );
    if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
        emit RewardFailed(contributionId, to, amount, data);
        return;
    }
}
```

**Benefício:** Uma transferência que reverte não derruba a transação inteira. O contribuidor não perde a recompensa — o admin pode retentar via `retryReward()`.

### 3. `receive()` Rejeita Native USDC

**Decisão:** O contrato rejeita envios de native USDC via `receive()`.

**Razão (da doc):**
> *"Native USDC and the ERC-20 USDC interface are the same asset."*

Se alguém envia native USDC (18 dec) para o contrato, o saldo nativo aumenta mas `balanceOf` (6 dec) pode não refletir corretamente (truncamento). Para evitar confusão contábil, todo funding deve passar por `fundTreasury()` que usa `transferFrom` (ERC-20, 6 dec).

**Exceção:** `recoverNativeUSDC()` permite ao admin recuperar USDC nativo enviado por engano.

### 4. `block.number` em Vez de `block.timestamp`

**Decisão:** Todos os eventos e lógica de ordering usam `block.number`.

**Razão (da doc):**
> *"Block timestamps are non-decreasing, not strictly increasing. Timestamps come from the proposer's wall clock at one-second granularity, so sub-second blocks may share a timestamp."*

Como a Arc tem block time de ~0.48s, dois blocos consecutivos podem ter o mesmo `block.timestamp`. Usar `block.number` garante ordering estrito.

### 5. Cooldown de Verificador em Blocos (Não Segundos)

**Decisão:** `VERIFIER_COOLDOWN_BLOCKS = 10` (~4.8 segundos na Arc).

**Razão:** Como timestamps não são estritamente crescentes, medir cooldown em blocos é mais preciso. 10 blocos ≈ 4.8s na Arc (0.48s/block).

### 6. Anti-Self-Verification

**Decisão:** Um contribuidor não pode verificar sua própria contribuição.

**Implementação:**
```solidity
if (verifier == contributor) revert DuplicateVerifier(verifier, contributionId);
```

### 7. Memo Contract para Metadados

**Decisão:** O `SteplessOracle` usa o contrato Memo da Arc (`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`) para anexar metadados.

**Razão (do feed Arc House):**
> *"Transaction memos on Arc give developers and businesses a way to attach structured context to onchain actions."*

**Benefício:**
- Lat/lng/dataHash anexados como memo sem storage on-chain caro
- Emite `Memo` events com index sequencial
- Indexável por Goldsky subgraphs
- Reduz custo de gas significativamente vs. armazenar strings em storage

### 8. Pausable de Emergência

**Decisão:** Admin pode pausar todas as distribuições de recompensa.

**Razão:** Se um bug for descoberto ou o treasury estiver sendo drenado por um ataque Sybil, o admin pode pausar imediatamente para evitar perda de fundos.

### 9. Sem SELFDESTRUCT

**Decisão:** Nenhum contrato usa `SELFDESTRUCT`.

**Razão (da doc):**
> *"A contract's USDC is its native balance, so self-destructing transfers that USDC to the beneficiary."*
> *"A non-zero-value call to a self-destructed account reverts on Arc."*

O comportamento do SELFDESTRUCT na Arc é semanticamente diferente do Ethereum e pode causar perda de fundos se mal compreendido.

### 10. Sem PREVRANDAO

**Decisão:** Não usar `block.prevrandao` para randomness.

**Razão (da doc):**
> *"PREVRANDAO always returns 0. No onchain randomness. Use an oracle or verifiable random function (VRF)."*

A seleção de verificadores usa cooldown + reputação em vez de randomness. Para seleção aleatória no futuro, será necessário integrar um VRF externo (não listado na doc da Arc).

---

## Tabela de Recompensas

| RewardType | Valor (USD) | Valor (6-dec) | Quando |
|------------|-------------|---------------|--------|
| `NewLocation` | $0.10 | `100_000` | Novo local mapeado e verificado |
| `Verification` | $0.05 | `50_000` | Contribuidor verifica local de outro |
| `QualityPhoto` | $0.02 | `20_000` | Foto de qualidade submetida |
| `LocationUpdate` | $0.03 | `30_000` | Atualização de local existente |
| `TopContributorBonus` | $5.00 | `5_000_000` | Bônus mensal do top contribuidor |

---

## Sybil Resistance — Estratégia Multi-Camada

```
Camada 1: Verificador deve ser aprovado (registerVerifier ou autoPromoteVerifier)
    ↓
Camada 2: Verificador não pode verificar sua própria contribuição
    ↓
Camada 3: Cooldown de 10 blocos (~4.8s) entre verificações
    ↓
Camada 4: Auto-promoção exige 20+ contribuições verificadas
    ↓
Camada 5: Admin pode slashar verificadores fraudulentos (perdem reputação)
    ↓
Camada 6: Pausable de emergência se ataque for detectado
```

---

## Integração com Circle Gas Station

A doc da Arc confirma que Circle Gas Station patrocina taxas para SCA wallets na testnet. O `RewardDistributor.sol` é compatível:

- Contribuidores com SCA wallets (via Crossmint/Dynamic) não precisam ter USDC para gas
- O Gas Station paga o gas da transação de recompensa
- O contrato funciona normalmente — o Gas Station é transparente para o contrato

**Para implementar:**
1. Criar SCA wallets para contribuidores via Circle SDK
2. Configurar Gas Station no Circle Developer Console
3. As transações de `payReward()` serão patrocinadas automaticamente

---

## Integração com Goldsky (Indexação)

O feed Arc House confirma que Goldsky suporta Arc Testnet com subgraphs gerenciados.

**Eventos para indexar:**

| Event | Indexar Por | Uso |
|-------|-------------|-----|
| `RewardPaid` | `contributor`, `contributionId` | Dashboard de recompensas, ranking |
| `RewardFailed` | `recipient` | Alertas para retry manual |
| `TreasuryFunded` | `funder` | Auditoria de treasury |
| `LocationRegistered` | `locationHash` | Mapa de localidades |
| `ContributionVerified` | `verifier`, `contributor` | Métricas de verificação |
| `QueryExecuted` | `consumer` | Métricas de uso da API |
| `Memo` (do Memo contract) | `indexedId` | Metadados de localidades |

---

## Deploy na Arc Testnet

### Pré-requisitos (da doc)
1. Foundry instalado (`forge`, `cast`)
2. Carteira com USDC testnet (faucet.circle.com)
3. RPC: `https://rpc.testnet.arc.network`

### Script de Deploy

```bash
# 1. Configurar .env
export ARC_TESTNET_RPC_URL="https://rpc.testnet.arc.network"
export PRIVATE_KEY="sua_chave_privada"

# 2. Deploy SteplessOracle (precisa do RewardDistributor address depois)
forge create src/SteplessOracle.sol:SteplessOracle \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args "0xREWARD_DISTRIBUTOR_ADDRESS" "0xADMIN_ADDRESS"

# 3. Deploy RewardDistributor
forge create src/RewardDistributor.sol:RewardDistributor \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args "0xORACLE_ADDRESS" "0xADMIN_ADDRESS"

# 4. Deploy X402API
forge create src/X402API.sol:X402API \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args "0xORACLE_ADDRESS" "0xADMIN_ADDRESS"
```

### Verificação no ArcScan
- Explorer: `https://testnet.arcscan.app`
- Verificar contratos após deploy
- Configurar event monitors via Circle Contracts API

---

## Próximos Passos Recomendados

1. **Escrever testes Foundry** — Unit tests em `anvil` + integration tests contra RPC da Arc
2. **Configurar Goldsky subgraph** — Indexar eventos dos 3 contratos
3. **Integrar Circle Gas Station** — Para SCA wallets de contribuidores
4. **Aplicar para Circle Developer Grants** — Programa relançado em Mai/2026
5. **Entrar no Architects Program** — Pontos, tiers, office hours com DevRel
6. **Estudar Crumb** — Arquitetura de batched settlement para micro-recompensas
7. **Avaliar Arc Privacy Sector** — Para contribuidores que não querem localização pública
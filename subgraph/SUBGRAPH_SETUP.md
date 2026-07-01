# Goldsky Subgraph — Setup

## 1. Preencher endereços após deploy

Editar `subgraph.yaml` — substituir os 3 placeholders:

```yaml
address: "0x_REWARD_DISTRIBUTOR_ADDRESS"   → endereço do RewardDistributor
address: "0x_ORACLE_ADDRESS"               → endereço do SteplessOracle
address: "0x_X402API_ADDRESS"              → endereço do X402API
```

Também atualizar `startBlock` para o bloco de deploy (pega no ArcScan).

## 2. Instalar dependências

```bash
cd subgraph
npm install
```

## 3. Instalar Goldsky CLI

```bash
curl https://goldsky.com/install | sh
goldsky login   # autenticar com conta Goldsky
```

## 4. Gerar tipos e compilar

```bash
npm run codegen   # gera tipos AssemblyScript dos ABIs
npm run build     # compila wasm
```

## 5. Deploy no Goldsky

```bash
npm run deploy
# Equivale a: goldsky subgraph deploy stepless/v1.0 --path .
```

Saída:
```
Subgraph deployed: https://api.goldsky.com/api/public/project/XXX/subgraphs/stepless/v1.0/gn
```

Copiar essa URL para `NEXT_PUBLIC_SUBGRAPH_URL` no `.env.local`.

## 6. Testar query

```graphql
{
  contributors(first: 5, orderBy: totalEarned, orderDirection: desc) {
    id
    totalEarned
    contributionCount
    isVerifier
  }
  locations(first: 5) {
    id
    firstContributor
    verificationCount
  }
  rewardPayments(first: 10, orderBy: blockNumber, orderDirection: desc) {
    recipient { id }
    amount
    rewardType
    blockNumber
    txHash
  }
}
```

## Network name no Goldsky

O campo `network: arc-testnet` no subgraph.yaml deve corresponder ao nome
que o Goldsky usa internamente para Arc Testnet. Se o deploy falhar com
"unknown network", consulte https://docs.goldsky.com/chains/supported-networks
ou use o Discord do Goldsky para confirmar o slug correto.

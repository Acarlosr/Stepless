# Checklist de submissão — Build on Arc, Checkpoint 3

**Deadline:** domingo 09/08/2026, Anywhere on Earth (UTC-12) → **09:00 de 10/08 em Brasília**.
A plataforma tranca no horário e submissão final atrasada não é julgada. Suba cedo.

---

## Exigido pelo edital

| Item | Estado | Onde |
|---|---|---|
| MVP funcional deployado na Arc | ✅ | 3 contratos vivos na Arc Testnet, app em stepless.vercel.app |
| Repositório de código público | ⚠️ **conferir** | github.com/Acarlosr/… — confirme que está público, não privado |
| Vídeo de 3 minutos (pitch + demo) | ⬜ **você grava** | roteiro em `video-script.md` |
| Deck | ✅ | `Stepless-Build-on-Arc.pptx` (+ PDF) |

---

## Feito nesta sessão

- [x] **Contratos conferidos on-chain**, não no papel. Oracle, Distributor e X402API estão vivos; o Distributor tem 24.6 USDC de tesouro; última atividade 07/08 22:59.
- [x] **Bug do Memo corrigido.** Toda `registerLocation`/`submitContribution` desde 31/07 tinha uma internal transaction revertida contra o predeploy Memo — assinatura errada (`attachMemo` não existe) *e* o Memo ser EOA-only. Reescrito em `api/_memo.js`: o relayer chama o Memo com o oracle como target, via `callFrom`. Sem redeploy.
- [x] **`IMemo` corrigida** em `contracts/src/SteplessOracle.sol` com a assinatura real, e `_attachMemo` marcado como no-op deliberado com a explicação completa.
- [x] **README** com seção de submissão em inglês: endereços clicáveis, uso real da stack Arc, encaixe nas duas trilhas, e a limitação de mainnet declarada de frente.
- [x] **Script de verificação** (`scripts/verify-arc-contracts.mjs`) que descobre a fonte e as flags exatas de cada contrato comparando o metadata hash com o que está on-chain.

---

## Antes de submeter — ordem sugerida

### 1. Deploy do fix do Memo (30 min)

```bash
npm run gen:network          # se mexeu em config/networks.json
vercel --prod                # ou push, se o deploy for automático
```

Depois faça **um registro de teste** e confirme na resposta da API:

```json
"memo": { "attached": true, "error": null }
```

Se vier `attached: false`, o fallback funcionou e o registro aconteceu — mas
não afirme o Memo no vídeo. Confira o log do relayer para o motivo.

Abra a tx no ArcScan e confirme que existe um evento `Memo` do predeploy
`0x5294E9…e505`. **É esse print que vale no vídeo.**

### 2. Verificar os contratos no ArcScan (15–40 min)

```bash
npm i solc@0.8.24            # o script usa
node scripts/verify-arc-contracts.mjs
```

Ele imprime o comando `forge verify-contract` pronto para cada contrato.
Para o `SteplessOracle` os parâmetros já estão confirmados:

```
commit d4756643 · solc 0.8.24 · optimizer 200 · evmVersion shanghai
constructor(0xdf8fa455f01965866ac99ebc553ad3c2b58a0368,
            0xbc8ae412f4f6afa21adf4a18deffabbfb21304ae)
```

> ⚠️ **Não verifique contra o HEAD.** O `ba28c0ea` ("contracts v5") tem um
> construtor de 3 argumentos e nunca foi deployado. Verificar contra ele falha.
> Use `git checkout d4756643 -- contracts/src/` numa branch descartável.
>
> ⚠️ **`evm_version = "osaka"` no foundry.toml é uma pegadinha.** O solc 0.8.24
> não conhece "osaka" e cai no default (shanghai). Declarar osaka na verificação
> faz ela falhar. Vale corrigir o `foundry.toml` para `shanghai`.

### 3. Gravar o vídeo (1–2 h com regravações)

Siga `video-script.md`. O checklist pré-gravação está no fim dele. O erro que
mais custa: registrar um local que já existe — reverte com
`LocationAlreadyRegistered` no meio da demo. Escolha um local novo.

### 4. Revisar o deck

`Stepless-Build-on-Arc.pptx`, 11 slides, com notas do apresentador. Confira:

- [ ] O link do GitHub no slide final está com o repositório certo
- [ ] O saldo do tesouro no slide 9 ainda bate (era 24.6 USDC em 09/08)
- [ ] Se você verificou os contratos, atualize o slide 9 para dizer "verified"

### 5. Submeter

Envie **antes** do último minuto. Se der tempo depois, você ainda pode editar;
se travar, não pode.

---

## Números do deck que valem checar antes de falar em público

O slide 2 usa três números. Os dois primeiros vêm de fontes externas e você deve
conseguir citá-las se um juiz perguntar:

- **1.3 bilhão / 16%** — estimativa da OMS de pessoas com deficiência
  significativa. Confirme a edição mais recente do relatório antes de citar.
- **<1% dos POIs com dado de acessibilidade utilizável** — é uma estimativa, não
  um número publicado. Se não tiver fonte firme, troque no slide por algo que
  você consiga defender (por exemplo, a cobertura real do OpenStreetMap na sua
  cidade, que você pode medir e mostrar).
- **0 pessoas pagas** — retórico, e verdadeiro no sentido de que não existe
  mercado remunerado para isso. Deixe claro que é uma afirmação sobre o mercado,
  não uma estatística.

Juiz de hackathon raramente checa número de slide. Investidor do acelerador
checa. O custo de errar um número é alto e o de trocar por um defensável é zero.

---

## O que eu não consegui verificar daqui

- **Fluxo end-to-end ao vivo.** O sandbox não alcança o RPC da Arc nem a Vercel,
  então li o estado dos contratos pela API do ArcScan, não executando o fluxo.
  O caminho novo do Memo está simulado antes de gastar gas e tem fallback, mas
  **não foi executado contra a rede.** Rode o passo 1 antes de gravar.
- **Compilação dos contratos.** Não há `forge` no ambiente. As mudanças em
  `SteplessOracle.sol` são pequenas (interface + corpo de uma função interna),
  mas rode `forge build` antes de confiar.
- **Se o repositório está público.** Não tenho acesso ao GitHub daqui.

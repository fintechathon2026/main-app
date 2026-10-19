# Reins: Prepaid Escrow Contract and Chain Integration (PRD)

| Field | Value |
|---|---|
| Document | `PRD_PrepaidEscrow_Contract.md` v1.0 |
| Date | October 20, 2026 |
| Owner | R3 (contract, adapter, indexer); second reviewer R2 (`roles.md` §1.2, §6.1) |
| Parent documents | `PRD_Reins_v2.0.md` F19, §10.8, §15.12; `architecture.md` §24 (this PRD refines it; §24 stays the reference for the why) |
| Tasks covered | `task.md` R3-02, R3-03 (deploy/spike scripts), R3-08, R3-09, R3-10 (merchant sim, partly), R3-13, R3-15 (contract part) |
| Branch | `feat/r3-02-escrow-contract` |

---

## 1. Summary

Reins keeps prepaid money (gym, salon and tutoring packages) in an escrow contract instead of sending it to the merchant up front. The money leaves the contract in exactly three ways:

1. **Redeem:** one session's price to the merchant, only with the customer's **and** the merchant's signatures.
2. **Attested exit:** the whole unused balance back to the customer, when a registered oracle has signed an official notice (court enforcement or closure). The customer or the customer's named agent may submit it.
3. **Voluntary exit:** the unused balance back to the customer minus a fee capped at 20%, with the customer's signature.

No function takes a recipient address. There is no owner, admin, pause, upgrade, sweep or oracle rotation. A stolen agent key can only return money early to its owner.

This document specifies the contracts (`TestCNY`, `PrepaidEscrow`), their tests, deployment, and how the rest of Reins (executor, Gate, simulators, indexer, database) talks to them.

## 2. Goals and non-goals

### 2.1 Goals

| ID | Goal | Measured by |
|---|---|---|
| CG1 | Guarantees G9/G10 hold on chain, independent of the server | Foundry invariant tests (§8.3) |
| CG2 | Every money path has one positive and at least one negative test per `require` | Foundry unit suite (§8.1) |
| CG3 | The agent's attested exit runs end to end: risk job → planner → Gate → executor → contract | Vitest integration on anvil + local Supabase (§8.5) |
| CG4 | The same EIP-712 bytes are signed in TypeScript and checked in Solidity | Digest parity test (§8.4) |
| CG5 | Each side effect is sent at most once, with distinct nonces under concurrency | Adapter tests (§8.5) |
| CG6 | Three Base Sepolia transaction hashes (purchase, redeem, attested exit) as evidence | `Spike.s.sol` output in `docs/evidence/spike.md` (§9) |
| CG7 | Switching `REINS_ESCROW=mock|chain` changes nothing in the Gate, agent or UI | Same executor tests pass with both adapters |

### 2.2 Non-goals for this release

- Mainnet, real money, e-CNY integration (PRD §24).
- Browser key management and signing UI (R4, `src/ui/screens/prepaid.tsx`): this release provides the server and simulator side only.
- User-initiated purchase, check-in and voluntary-exit **API routes** with consumer-signature recovery in the executor's phase A (R2-07). The adapter methods exist; the routes do not.
- Replace-by-fee gas bumping and the `reconcile` cron job (R1 roadmap).
- Basescan source verification (optional, needs an API key).
- Merchant dispute window before attested exits (architecture §23 Q13).

## 3. Actors and keys

| Key | Held by | Can do | Cannot do | Env var | Read only in |
|---|---|---|---|---|---|
| Consumer | Lin's browser (demo setup script on a dev machine) | Sign permit, `PurchaseAuth`, `Redeem`, `VoluntaryExit` | Release money without the merchant's signature | none on the server | client / `scripts/chain-demo-setup.ts` |
| Merchant | Merchant simulator | Sign `Offer`, `Redeem` | Release money without the consumer's signature; touch refunds | `MERCHANT_SIM_PRIVATE_KEY` | `src/sim/**` |
| Oracle | Registry simulator | Sign `Attestation` | Act alone: someone with the plan's consumer or agent role must submit | `ORACLE_PRIVATE_KEY` (address fixed in the contract) | `src/sim/**` |
| Agent | Server | Call `exitWithAttestation` on plans that named it | Any other function; choose a recipient | `AGENT_PRIVATE_KEY` | `src/server/adapters/settlement/chain/**` |
| Relayer | Server | Pay gas for purchase, redeem, voluntary exit | Change any signed field | `RELAYER_PRIVATE_KEY` | `src/server/adapters/settlement/chain/**` |
| Deployer / minter | Deploy script, demo faucet | Deploy; mint tCNY | Anything on the escrow after deployment | `DEPLOYER_PRIVATE_KEY`, `TOKEN_MINTER_PRIVATE_KEY` | `contracts/script/**`, `scripts/**` |

The key-scoping column is enforced by an ESLint rule (§7.8), not by convention.

## 4. Contract specification

Solidity `0.8.24`, OpenZeppelin Contracts 5.x (pinned in `contracts/lib`), optimizer on (200 runs). Target chain: Base Sepolia (84532); local: anvil (31337).

### 4.1 `TestCNY`

| Property | Value |
|---|---|
| Base | OpenZeppelin `ERC20`, `ERC20Permit` (EIP-2612), `Ownable` |
| Name / symbol | `Test CNY (no value)` / `tCNY` |
| Decimals | 2 (1 tCNY = 100 fen; amounts on chain are fen, matching `prepaid_*` columns) |
| Mint | `mint(address to, uint256 amount)`, `onlyOwner` (the demo faucet) |
| Other | Nothing else. The escrow never calls owner functions |

### 4.2 `PrepaidEscrow`: state

```
Plan { consumer, merchant, agent, unitPrice (uint128, fen), units (uint32), redeemed (uint32), cancelFeeBps (uint16), status }
Status  ∈ { None, Active, Completed, ExitedAttested, ExitedVoluntary }
token   : IERC20 (TestCNY), immutable, non-zero
oracle  : address, immutable, non-zero
nextPlanId : starts at 1
plans[planId]       : Plan
authUsed[digest]    : PurchaseAuth digests already used
MAX_ATTESTATION_AGE = 2 days
MAX_CANCEL_FEE_BPS  = 2000 (20%)
```

### 4.3 EIP-712

Domain: `{ name: "PrepaidEscrow", version: "1", chainId, verifyingContract: <escrow address> }`.

```
Offer(address merchant,uint128 unitPrice,uint32 units,uint16 cancelFeeBps,uint64 expiresAt,uint256 nonce)
PurchaseAuth(bytes32 offerHash,address consumer,address agent,uint64 deadline)
Redeem(uint256 planId,uint32 sessionNo,uint64 deadline)
Attestation(address merchant,uint8 kind,bytes32 caseRef,uint64 issuedAt,uint64 expiresAt)
VoluntaryExit(uint256 planId,uint64 deadline)
```

- `offerHash` is the full EIP-712 digest of the offer, so the consumer signs exactly the terms the merchant signed.
- `kind`: 1 = court enforcement, 2 = closure notice (same codes as `src/sim/registry/eip712.ts`).
- The `Attestation` struct must stay byte-identical to `ATTESTATION_TYPES` in `src/sim/registry/eip712.ts`. The digest parity test (§8.4) fails the build otherwise.
- An offer is a public price list: many consumers may buy from the same signed offer. Replay protection is per `PurchaseAuth` digest.

### 4.4 Functions

| Function | Caller | Checks (each one a custom error) | Effect |
|---|---|---|---|
| `purchaseWithPermit(offer, merchantSig, auth, consumerSig, permit)` | anyone (relayer) | `now ≤ offer.expiresAt` and `now ≤ auth.deadline` (`Expired`); `units > 0`, `unitPrice > 0`, `cancelFeeBps ≤ 2000` (`BadTerms`); merchant signed the offer (`BadMerchantSig`); `auth.offerHash` equals the offer digest (`OfferMismatch`); consumer signed the auth (`BadConsumerSig`); auth not used (`AuthUsed`) | Marks the auth used; creates plan `nextPlanId++` as Active; tries `permit` (a failure is ignored: a front-run permit sets the same allowance); `transferFrom(consumer → escrow, unitPrice × units)`; emits `Purchased` |
| `redeem(planId, sessionNo, deadline, consumerSig, merchantSig)` | anyone (relayer) | plan Active (`Inactive`); `now ≤ deadline` (`Expired`); `sessionNo == redeemed + 1` (`WrongSession`); both signatures over the same `Redeem` (`BadConsumerSig`, `BadMerchantSig`) | `redeemed = sessionNo`; Completed after the last unit; pays one `unitPrice` to the merchant; emits `Redeemed` |
| `exitWithAttestation(planId, att, oracleSig)` | plan's consumer, or plan's agent if non-zero | plan Active (`Inactive`); caller (`BadCaller`); `att.merchant == plan.merchant` (`WrongMerchant`); `kind ∈ {1,2}` (`BadKind`); `issuedAt ≤ now ≤ expiresAt` (`OutsideWindow`); `now − issuedAt ≤ 2 days` (`Stale`); signer is `oracle` (`BadOracleSig`) | Status ExitedAttested; pays `unitPrice × (units − redeemed)` to the **consumer**; emits `Exited` |
| `exitVoluntaryBySig(planId, deadline, consumerSig)` | anyone (relayer) | plan Active (`Inactive`); `now ≤ deadline` (`Expired`); consumer signed `VoluntaryExit` (`BadConsumerSig`) | Status ExitedVoluntary; `fee = remaining × cancelFeeBps / 10000` to the merchant, the rest to the consumer; emits `Exited` |

View helpers (no state change, used by the off-chain parity test and the simulators): `hashOffer`, `hashPurchaseAuth`, `hashRedeem`, `hashAttestation`, `hashVoluntaryExit` (all return the full EIP-712 digest), `remaining(planId)`, `getPlan(planId)`.

Events:

```
Purchased(uint256 indexed planId, address indexed consumer, address indexed merchant, address agent, uint256 total)
Redeemed(uint256 indexed planId, uint32 sessionNo, uint256 amount)
Exited(uint256 indexed planId, Status kind, uint256 refund, uint256 fee)
```

`Purchased` also carries `agent` (architecture §24.4 left it out); the indexer needs it without an extra read.

### 4.5 Invariants

1. `token.balanceOf(escrow) == Σ_{Active plans} unitPrice × (units − redeemed)` (nothing is stuck, nothing is missing).
2. Money leaves the escrow only to `plan.merchant` (one unit per redeem, or the fee) or to `plan.consumer`.
3. `redeemed ≤ units`; status changes only from Active, never back; Completed iff `redeemed == units`.
4. A plan's consumer, merchant, agent, unit price, units and fee never change after purchase.

### 4.6 Implementation rules

- Checks, then effects, then transfers, in every function; `nonReentrant` on every state-changing function; `SafeERC20`.
- OpenZeppelin 5 `ECDSA.recover` reverts on malformed or malleable signatures, so `address(0)` can never pass a signature check.
- Plans are never deleted, so a replayed signature always meets a non-Active plan or a used session number.
- Custom errors instead of revert strings: cheaper, and viem decodes them by name for `chain_txs.revert_reason`.

## 5. Repository layout

```
contracts/                                 Foundry project (ESLint ignores it)
├─ foundry.toml                            solc 0.8.24, optimizer 200, fuzz/invariant runs
├─ src/PrepaidEscrow.sol, src/TestCNY.sol
├─ test/PrepaidEscrow.t.sol                unit + fuzz
├─ test/Invariants.t.sol, test/handlers/EscrowHandler.sol
├─ test/utils/Signatures.sol               EIP-712 signing helpers for tests
├─ script/Deploy.s.sol                     deploy, write deployments/<chainId>.json
├─ script/Spike.s.sol                      purchase, redeem, attested exit; prints 3 hashes
├─ deployments/                            addresses per chain (committed for 84532)
└─ lib/                                    forge-std, openzeppelin-contracts (git submodules, pinned tags)

src/server/chain/                          viem clients, ABI, EIP-712 types, indexer (no keys)
├─ abi.ts                                  generated from contracts/out by scripts/export-contract-abi.ts
├─ eip712.ts                               escrow typed-data definitions + domain
├─ client.ts                               public client from CHAIN_ID / RPC env (fallback transport)
└─ indexer.ts                              chain-sync: logs → prepaid_plans / prepaid_sessions
src/server/adapters/settlement/chain/
└─ escrow.ts                               ChainEscrowAdapter (relayer + agent senders; only place that reads their keys)
src/sim/merchant/                          merchant simulator: signed offers, check-in signatures
app/api/cron/chain-sync/route.ts           indexer cron (CRON_SECRET)
app/sim/merchant/{offers,checkin}/route.ts simulator routes (SIM_API_KEY)
supabase/migrations/20261020000012_chain_nonces.sql
scripts/export-contract-abi.ts, scripts/chain-demo-setup.ts
tests/chain/                               Vitest suites on anvil (skipped without anvil / artifacts / DB)
```

## 6. Data model changes

Existing tables (`wallets`, `prepaid_merchants`, `prepaid_offers`, `prepaid_plans`, `prepaid_sessions`, `attestations`, `risk_signals`, `chain_txs`, `chain_cursors`) already match architecture §24.8 and are not edited (applied migrations are never changed).

New migration `20261020000012_chain_nonces.sql`:

```sql
create table public.chain_nonces (
  sender     text primary key check (sender ~ '^0x[0-9a-fA-F]{40}$'),  -- lowercase address
  next_nonce bigint not null check (next_nonce >= 0),
  updated_at timestamptz not null default now()
);
-- System table: reins_server only, like chain_cursors.
```

Why a new table: `chain_txs` is user-scoped under RLS, so "max stored nonce + 1" read inside one user's transaction cannot see other users' transactions from the same relayer. A row lock on `chain_nonces` serializes allocation across all users.

## 7. Off-chain integration

### 7.1 How the pieces connect

```
 consumer key ──signs──┐          merchant sim ──signs Offer/Redeem──┐       registry sim ──signs Attestation──┐
                       ▼                                             ▼                                         ▼
               (R4 UI / demo script) ───────────────► ChainEscrowAdapter.purchase/redeem            cron/risk stores attestations
                                                                     │                                         │
 cron/risk → agent graph → prepaid_exit → ActionExecutor ── phase A: readPlan (contract) ─┐                    │
                                             │  phase B: Gate decide (PrepaidFacts from contract + DB) ◄───────┘
                                             └─ phase C: ChainEscrowAdapter.exitWithAttestation (agent key)
                                                                     │ tx
                                                                     ▼
                                                              PrepaidEscrow ──logs──► cron/chain-sync ──► prepaid_plans / prepaid_sessions
```

### 7.2 Adapter selection

`createExecutor()` picks the escrow adapter from the environment:

| `REINS_ESCROW` | `ESCROW_ADDRESS` | Adapter |
|---|---|---|
| `chain` | valid address | `ChainEscrowAdapter` |
| `chain` | missing | startup error on first prepaid action (`escrow_not_configured`, definitive) |
| `mock` or unset | any | mock escrow over `/mockbank` (architecture §24.13) |

Tests inject the adapter through `ExecutorDeps.escrow` as today.

### 7.3 `EscrowAdapter` interface changes (additive, reviewed by R2)

- `EscrowSendOpts` gains `userId: string`. The chain adapter writes `chain_txs` (RLS: `user_id = app.user_id`) and loads the attestation row inside that user's transaction. The mock ignores it.
- `lookup(idempotencyKey, userId?)`: with a user id the chain adapter returns the stored transaction's receipt; without one it returns `null` (no cross-user reads).
- `ChainEscrowAdapter` adds `purchase` and `redeem` (relayer) on top of the shared interface; they are not on `EscrowAdapter` because the mock does not support them yet.

### 7.4 Send path (exactly once per action)

1. Load `chain_txs` by `action_id`. If a row exists: re-broadcast the stored raw transaction (same hash; "already known" and "nonce too low" count as sent) and go to step 5.
2. Simulate the call (`eth_call` + gas estimate) from the sender. A revert returns `{status: "reverted", txHash: null, reason: <error name>}` and sends nothing.
3. One DB transaction (user scope): insert-or-lock `chain_nonces` row for the sender address (`for update`); `nonce = max(next_nonce, getTransactionCount(pending))`; sign locally with viem; insert `chain_txs(status 'signed', raw_tx, tx_hash, nonce)`; `next_nonce = nonce + 1`; commit. A failure rolls everything back, so no nonce gap.
4. `sendRawTransaction`; status `broadcast`.
5. `waitForTransactionReceipt` (timeout `CHAIN_RECEIPT_TIMEOUT_MS`, default 30 s). Success → `confirmed` with decoded events; revert → `reverted` with the decoded error; timeout → `pending`.

Executor mapping (unchanged): `confirmed` → action `succeeded` with the tx hash in `result_json`; `reverted` → `failed` (definitive, cap reservation released); `pending` → `unknown` (reconcile later).

Idempotency layers: stored raw transaction (same hash on retry), `actions.idempotency_key`, `chain_txs.action_id unique`, and on chain `authUsed`, sequential `sessionNo` and the Active-status check.

### 7.5 Reads (phase A)

`readPlan(chainPlanId)` calls `getPlan(planId)` and maps `Status` to the existing `EscrowPlanState` strings (`active`, `completed`, `exited_attested`, `exited_voluntary`; `None` → `null`). The snapshot builder already cross-checks the chain plan against the indexed row (plan id and merchant address), so the Gate code does not change.

### 7.6 Indexer (`cron/chain-sync`)

- Range: `chain_cursors.last_block + 1` … `latest − CHAIN_CONFIRMATIONS` (default 2; 0 on anvil), in chunks of at most `CHAIN_LOG_CHUNK` blocks (default 2,000). The first run starts at `CHAIN_START_BLOCK` (the deploy block).
- Logs: `Purchased`, `Redeemed`, `Exited` from `ESCROW_ADDRESS`.
- Users: `REINS_CRON_USER_IDS` (the same stop-gap as `cron/detect` until a security-definer lookup exists). For each user: read the wallet address, keep the plans whose consumer is that wallet, re-read each touched plan with `getPlan`, then upsert `prepaid_plans` (keyed by `chain_plan_id`, `origin 'chain'`) and insert `prepaid_sessions` from `Redeemed` logs (tx hash, block time).
- Merchant mapping: `prepaid_merchants.chain_address` (case-insensitive). An unknown merchant address is skipped and counted, never invented.
- The cursor advances only after every user is processed. Idempotent: re-running a range changes nothing.

### 7.7 Simulators

- **Registry** (exists): signs attestations with the oracle key over the escrow domain (`ESCROW_ADDRESS`, `CHAIN_ID`). Nothing changes: once `ESCROW_ADDRESS` is set, its signatures verify on chain.
- **Merchant** (new, `src/sim/merchant`): `GET /sim/merchant/offers` returns signed offers for the seeded merchants (FitBox Futian 60 × ¥100, fee 10%, escrow supported; IronPulse Nanshan without escrow support); `POST /sim/merchant/checkin {planId}` reads the next session number from the contract and returns `{planId, sessionNo, deadline, merchantSig}`. Both use `SIM_API_KEY` like the registry routes.

### 7.8 Key-scoping lint rule

ESLint `no-restricted-syntax` on `process.env.AGENT_PRIVATE_KEY` and `process.env.RELAYER_PRIVATE_KEY` everywhere except `src/server/adapters/settlement/chain/**`, and on `process.env.MERCHANT_SIM_PRIVATE_KEY` and `process.env.ORACLE_PRIVATE_KEY` everywhere except `src/sim/**` (architecture §5.1). `tests/**` and `scripts/**` are exempt (they set test keys).

### 7.9 Configuration

| Var | Used by | Notes |
|---|---|---|
| `REINS_ESCROW` | executor | `chain` or `mock` (§7.2) |
| `CHAIN_ID` | client, EIP-712 domain | 84532 Base Sepolia; 31337 anvil |
| `BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_RPC_URL_FALLBACK` | client | viem `fallback` transport |
| `ESCROW_ADDRESS`, `TOKEN_ADDRESS` | client, adapter, indexer, sims | from `contracts/deployments/<chainId>.json` |
| `ORACLE_ADDRESS`, `AGENT_ADDRESS` | Gate facts, risk job | must equal the oracle in the contract and the agent key's address (checked at adapter start) |
| `RELAYER_PRIVATE_KEY`, `AGENT_PRIVATE_KEY` | adapter only | funded with Base Sepolia ETH |
| `MERCHANT_SIM_PRIVATE_KEY`, `ORACLE_PRIVATE_KEY` | simulators only | |
| `CHAIN_START_BLOCK`, `CHAIN_CONFIRMATIONS`, `CHAIN_LOG_CHUNK`, `CHAIN_RECEIPT_TIMEOUT_MS` | indexer, adapter | new, optional with defaults |
| `DEPLOYER_PRIVATE_KEY` | `Deploy.s.sol` | local/CI only, never on Vercel |

## 8. Testing

### 8.1 Foundry unit (`test/PrepaidEscrow.t.sol`)

| Area | Cases |
|---|---|
| Constructor | zero token, zero oracle revert; domain fields |
| Purchase | happy path (plan fields, balances, event, plan id increments); expired offer; expired auth; zero units; zero price; fee above 20%; merchant signature by another key; offer terms changed after signing; auth for another offer; consumer signature by another key; reused auth; purchase without permit but with prior approval; front-run permit still succeeds |
| Redeem | happy path (merchant paid, counter, event); last unit completes plan; wrong session (skip, replay); expired; merchant-only signature; consumer-only signature; signatures over different sessions; inactive plan |
| Attested exit | by consumer; by agent; plan without agent rejects a non-consumer; wrong caller; other merchant; kind 0 and 3; future `issuedAt`; expired; stale (> 2 days); forged oracle signature; second exit; refund amount after N redeems |
| Voluntary exit | fee split; zero fee; expired; wrong signer; second exit; after completion |
| Views | `hash*` equal locally computed digests; `remaining` |

### 8.2 Foundry fuzz

Random `unitPrice`, `units`, `cancelFeeBps`, number of redeems and exit choice: balances always reconcile and the refund + fee + paid sessions equal the purchase total. Random signer keys never pass a merchant, consumer or oracle check.

### 8.3 Foundry invariant (`test/Invariants.t.sol`)

A handler buys, redeems, exits (attested and voluntary) with random inputs across several consumers and merchants and tracks ghost totals. Invariants: §4.5 #1 (balance), #2 (outflows only to merchant or consumer: Σ received by them = Σ deposited − escrow balance; no third address ever gains tokens), #3 (redeemed ≤ units, status monotonic), #4 (terms unchanged).

### 8.4 Cross-language parity (Vitest + anvil, `tests/chain/eip712.test.ts`)

Deploy the compiled contracts on a fresh anvil, sign each typed struct with viem using `src/server/chain/eip712.ts` and `src/sim/registry/eip712.ts`, and assert `hash*` from the contract equals viem's `hashTypedData`. Assert the committed `abi.ts` equals the compiled artifact.

### 8.5 Adapter and executor integration (Vitest + anvil [+ local Supabase])

| Test | Needs | Checks |
|---|---|---|
| `tests/chain/adapter.test.ts` | anvil, DB | purchase and redeem through the relayer; reverts caught at simulation send nothing; re-running an action re-uses the stored transaction (same hash); 10 parallel sends get distinct consecutive nonces |
| `tests/chain/exit.e2e.test.ts` | anvil, DB | chain-sync indexes a purchased plan for the user; a signed attestation + `prepaid_exit` action → executor `succeeded` with a real tx hash; consumer balance up by the unused amount; escrow balance 0; second run returns the same result and sends nothing; forged attestation → Gate denies and no transaction is sent |
| `tests/chain/indexer.test.ts` | anvil, DB | plans, sessions and exits indexed; unknown merchant skipped; re-run is a no-op |

All chain suites skip when `anvil` is not on `PATH` or `contracts/out` is missing; DB suites skip when `DATABASE_URL` is unset (existing pattern).

### 8.6 Existing suites

`pnpm lint && pnpm typecheck && pnpm test` stay green with `REINS_ESCROW=mock` (the default for tests).

## 9. Deployment and evidence

1. Generate keys: deployer, relayer, agent, merchant, oracle (`cast wallet new`). Fund deployer, relayer and agent from a Base Sepolia faucet.
2. `cd contracts && forge test`.
3. `forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast` with `DEPLOYER_PRIVATE_KEY` and `ORACLE_ADDRESS` (add `--verify` with a Basescan key). Writes `deployments/84532.json` with token, escrow, oracle and the deploy block.
4. `forge script script/Spike.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast`: purchase, one redeem and an attested exit with the configured keys; record the three hashes in `docs/evidence/spike.md`.
5. Copy addresses into the environment (`ESCROW_ADDRESS`, `TOKEN_ADDRESS`, `CHAIN_START_BLOCK`), set `REINS_ESCROW=chain`.
6. Demo data: `scripts/chain-demo-setup.ts` mints tCNY to Lin's demo consumer key, buys FitBox 60 × ¥100 with the merchant simulator's offer, redeems 12 sessions, points Lin's `wallets` row at the consumer address, removes the seeded mock plan and runs chain-sync once.

The same steps run against a local anvil (`--rpc-url http://127.0.0.1:8545`, anvil's default keys) for rehearsal.

## 10. Security review checklist (R2 second review)

- [ ] No function has a recipient, admin, owner, pause, upgrade, sweep or oracle-rotation parameter.
- [ ] Every transfer goes to `plan.merchant` or `plan.consumer`.
- [ ] Effects before transfers; `nonReentrant` everywhere.
- [ ] Every signature covers the full domain (chain id and contract address), so it cannot be replayed on another deployment.
- [ ] The agent key is used only for `exitWithAttestation` (adapter code path and lint rule).
- [ ] Private keys are read only in their modules; nothing logs a key or a raw signature.
- [ ] Gate decides before any send; the adapter never chooses an attestation (it uses the id the decision used).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Faucet limits or RPC outages on Base Sepolia on submission day | Fallback RPC; rehearse on anvil; mock escrow stays selectable (`REINS_ESCROW=mock`) |
| Nonce gaps or stuck transactions | Allocation and signing in one DB transaction; same-hash re-broadcast; `pending` maps to `unknown`, never to a second send |
| EIP-712 drift between TypeScript and Solidity | Parity test on every run where anvil is available |
| Lost consumer key | Attested exit still refunds to the owner address (testnet, valueless token); passkey smart account in R2 |
| Indexer cross-user lookup without a definer function | Uses the configured user list, like the other cron jobs; documented stop-gap |

## 12. Acceptance criteria

1. `forge test` passes: unit, fuzz (≥ 256 runs) and invariant (≥ 64 runs × depth 32).
2. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass; chain suites pass locally with anvil and Supabase.
3. On anvil, the spike script prints three confirmed hashes, and the integration test moves Lin-like money back to the consumer through the agent with the Gate in the loop.
4. With `REINS_ESCROW=mock`, behavior is unchanged.
5. The Base Sepolia deployment and the three evidence hashes are recorded once funded keys are available (§9; needs the team's keys, not part of the code change).

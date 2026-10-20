# Security Self-Assessment

Owner: R2. Status: **draft** (R2-12), updated for the escrow contract and chain adapter. References: PRD §10, §16, §20; `architecture.md` §5.1, §7, §8, §16, §24; `PRD_PrepaidEscrow_Contract.md`; `injection-defenses.md`.

Reins is an AI finance agent that acts only inside a user-signed mandate. This report says what that protects, how we know, and what it does not protect. It is written so a reader can check each claim against a file.

**How to read it.** Every guarantee below names the file that enforces it and the test that keeps it true. Tests marked *needs DB* are skipped when `DATABASE_URL` is unset. Numbers we have not produced yet say **pending** and name an owner. We do not fill them in until they exist.

**State of the build this draft describes.** Commit `4ac4669` (`origin/main`). The bank is the mock bank. The escrow contract (`contracts/src/PrepaidEscrow.sol`) and the chain adapter (`src/server/adapters/settlement/chain/escrow.ts`) are in the tree. They are **not the default**: `src/server/executor/run.ts:82` uses the mock escrow unless `REINS_ESCROW=chain`, and `.env.example:49` sets `REINS_ESCROW=mock`. The contract is not deployed anywhere (`contracts/deployments/` holds only `.gitkeep`). The eval runner is not built (`task.md` R2-11). Where a defense depends on one of these, the table says so.

## 1. Scope

| In scope | Out of scope |
|---|---|
| Bill payment, subscription cancel, trial auto-cancel | Real banks, real money, real customers |
| Prepaid escrow: purchase, session release, attested exit, voluntary exit | Mainnet, any token with value |
| The Policy Gate, the executor, approvals, the audit log | Browser agent (P2), savings sweep beyond a stub (P1) |
| Quarantined Readers for documents and soft signals | Device and OS security of the user's phone or laptop |
| Simulated outside parties: bank, registry (oracle), merchant | The security of the LLM provider's own systems |

The attacker we design for: someone who controls any untrusted text (a bill PDF, an email, a CSV row, a complaint post), and who may fully control the LLM's output. We also consider a compromised agent key or relayer key. We do not consider an attacker who owns the database, the server or the user's device.

## 2. Permission tiers

A tier says how much the agent may do on its own. The Gate, not the LLM, decides the tier of each action.

| Tier | Meaning | Who authorizes | Examples |
|---|---|---|---|
| **T0** | Read and explain. No side effect. | Nobody; no money path | Read tools (`get_balance`, `list_bills`, `advise_prepaid`, ...), Explainer text |
| **T1** | Propose only. A row is written, no money moves. | Nobody yet; the user may act on it later | `propose_action` (specified in `architecture.md` §6.4; not yet a tool in this tree); "new biller detected: add to registry?" |
| **T2** | Runs only after one approval, bound to that exact action | The user, one tap | Bill over `auto_pay_max`; anomalous bill; normal subscription cancel; unattested prepaid exit with the owner's signature |
| **T3** | Runs without a per-action approval, inside the signed mandate | The mandate | Bill under `auto_pay_max` from a trusted amount origin; trial auto-cancel; attested prepaid exit |
| **Denied** | Never runs, and an approval cannot change that | Nobody | See the rows below |

How the Gate (`src/core/gate/decide.ts`) lands on each tier:

| Action | T3 (allow) | T2 (require_confirm) | Denied |
|---|---|---|---|
| `pay_bill` | Registry destination, verified allowed payee, amount matches the bill row, amount origin `mock_bank` or `aggregator` (or `document`/`email` only if registered, under `auto_pay_max` and not anomalous), no anomaly, under both caps | Over `auto_pay_max`; anomaly; untrusted amount origin; payee not on the allow list when `new_payee: confirm` | Destination not from the registry; amount differs from the bill; FX rate stale or unknown; over the daily or per-payee cap; new payee when `new_payee: deny`; kill switch; bad mandate |
| `cancel_subscription` | Trial from a trusted origin, `auto_cancel_trials` on, no keep flag, notice sent | Any other cancel; trial from an untrusted origin | Mandate says `cancel: deny`; already cancelled; unknown subscription |
| `prepaid_exit` (agent) | Oracle-signed attestation, same merchant, fresh, kind in `auto_exit_on`, plan owned by the user and naming our agent | No attestation but the owner's exit signature is valid | No attestation and no owner signature; plan not owned or not active; agent not ours |
| `prepaid_purchase`, `prepaid_redeem`, `prepaid_exit_voluntary` | User-initiated. Allowed only with the user's own signatures (and the merchant's, for a release) | Not applicable | Any of these started by the agent; a bad or missing signature |
| `sweep_to_savings` (P1) | Never | Only when the mandate enables sweeps | Sweeps disabled |

Two things to know about tiers:

- The `actions.tier` column exists (`supabase/migrations/20261017000003_execution_tables.sql`) but no code writes it yet, and the feed does not show tier badges from it. The decision is stored as `allow`, `require_confirm` or `deny` plus the rule IDs. **Open: R2 to add a tier derivation and show it in the feed before the final.**
- The PRD names T0 only in the feed badge list (FR10.1). The T0 and T1 definitions above are our reading of how the code behaves. They need a check against the PRD owner.

## 3. Guarantees and what enforces them

These are the architecture guarantees (`architecture.md` §3), not the PRD product goals that share the numbers G1 to G6. Every path below was checked to exist at `4ac4669`. Where a test is skipped by default, the row says what it needs.

| # | Guarantee | Enforced in | Kept true by | Status |
|---|---|---|---|---|
| **G1** | No money moves unless the Gate returns `allow` for that exact action at execution time | `src/core/gate/decide.ts` (pure); `src/server/executor/run.ts` phase B calls `decide()` inside the transaction, phase C settles only after an `allow`; import boundary in `eslint.config.mjs` (only `src/server/executor/**` may import settlement adapters) | `src/core/gate/decide.test.ts`; `src/core/gate/gate.property.test.ts` (property test: a narrower mandate is never more permissive, `describe` at line 488); `tests/evals/gate-arm.test.ts` (17 Gate-only attack cases from `evals/cases/gate/index.json` run through the real `decide()`, no DB); `tests/foundations/executor.test.ts`; `tests/agent/graph.test.ts` ("only the execute node ever calls the executor"); `tests/harness/kill-switch.test.ts`; `pnpm lint` | Built. DB tests need DB |
| **G2** | Untrusted values can inform a proposal, never authorize or route money | `src/core/gate/decide.ts` (provenance rules: destination from `registry` only, amount must match the bill row); `src/server/executor/snapshot.ts` re-derives provenance from DB rows; `src/agent/tools/action-schemas/index.ts` (strict schemas, no account or recipient field); Readers in `src/agent/nodes/reader`, `src/agent/nodes/signal_reader`; redaction in `src/server/pii/redact.ts` | `tests/harness/canary.test.ts`; `tests/harness/quarantine.test.ts`; `tests/quarantine/reader.test.ts`; `src/server/pii/redact.test.ts`; `tests/agent/graph.test.ts` (extra `account_number` rejected; canary only in labeled JSON); `tests/foundations/executor.test.ts` (amount mismatch, biller mismatch) | Built |
| **G3** | An approval authorizes exactly one action, once, before it expires | `src/server/approvals/index.ts` (`consumeApproval` updates one row `where action_hash = $2 and status = 'approved' and expires_at > now()`); `run.ts` rolls the transaction back if the count is not 1; `verifyActionHash` in `src/server/executor/snapshot.ts` | `tests/harness/resume.test.ts` (forged `{approved:true}`, approval for another action, double and concurrent resume); `tests/approvals/routes.test.ts` (expired, double approve, non-owner); `tests/foundations/executor.test.ts` (hash mismatch refused); `src/core/gate/decide.test.ts` (approval never upgrades a deny) | Built. R0 approvals are session-only, no passkey (see KR-4) |
| **G4** | Cumulative caps hold under concurrency | `run.ts` phase B: `select ... for update` on the `daily_limits` row, then reservation in `cap_reservations`, then commit or release in `finalize` | `tests/foundations/executor.test.ts` ("20 parallel payments never exceed the daily cap") | Built, tested at **20** parallel, not the 100 the plan asks for (KR-9). Needs DB |
| **G5** | Every side effect executes at most once | Idempotency key fixed in `persist_plan`; `ENTRY_STATUSES` check and conditional `update ... where status = any(...)` in `run.ts`; the adapter replays the stored result for a repeated key | `tests/harness/resume.test.ts` (double resume, concurrent resume, resume that bypasses the plan claim); `tests/foundations/executor.test.ts` (duplicate run is idempotent) | Built. `reconcile` for outcomes marked `unknown` is not built (KR-10). Needs DB |
| **G6** | The LLM never edits mandates, creates payees, or computes the numbers users see | Planner binds only the 11 read tools in `src/agent/tools/read/index.ts` plus three capture-only action tools; no mandate or payee tool exists; mandate compile output is read back from templates (`src/server/mandate/readback.ts`) and is only a draft until the user signs; Explainer post-check in `src/agent/nodes/explain.ts` and `src/agent/nodes/numbers.ts` | `tests/agent/explain.test.ts` (changed number falls back to template; unknown number withheld); `tests/agent/mandate-compile.test.ts`; `tests/e2e/bill.test.ts` (an `add_payee` call has no tool to hit); `src/core/mandate/mandate.test.ts`; `src/core/mandate/narrow.test.ts` (the narrowing order used to tell a looser mandate from a tighter one) | Built for the agent path. `compareMandates` is **not wired** to any route yet (TODOs in `app/api/mandates/compile/route.ts:8` and `src/server/db/read/mandate-view.ts:99`). `app/api/mandates/` has only `active`, `compile` and `history`: no sign or store route (KR-3) |
| **G7** | Every decision is explainable from an append-only, hash-chained log | `src/server/audit/index.ts` (`appendAudit`, `verifyAuditChain`); append-only trigger and revoked grants in `supabase/migrations/20261017000005_rls.sql`; the Gate writes its trace in `run.ts` before acting | `tests/foundations/executor.test.ts` ("keeps a verifiable hash chain ... and the log is append-only"); `tests/foundations/rls-roles.test.ts`; `tests/platform/audit-export.db.test.ts` | Built. There is no `/api/audit/verify` route yet, only export (KR-11). Needs DB |
| **G8** | Same scenarios run with and without the Gate, deterministically | Planned: build flag `REINS_EVAL_DISABLE_GATE=1`, refused when `NODE_ENV=production` (`architecture.md` §16.3) | `tests/evals/gate-arm.test.ts` covers arm B (full Gate) for 17 cases only. Nothing covers arm A or the guard | **Not built.** A search of `src/`, `app/`, `scripts/` and `eslint.config.mjs` finds no `REINS_EVAL_DISABLE_GATE`. It appears only in `architecture.md` (lines 1157, 1236) and `task.md` (R2-11, I-04). Guard: **pending** (R2). Another branch may add it |
| **G9** | Escrowed money goes only to the merchant (one unit per two-signature session) or back to the plan owner, enforced independently of the Gate | `contracts/src/PrepaidEscrow.sol`: see §3.1 for line cites. One more path exists than this sentence says: a consumer-signed voluntary exit also pays a capped fee to the merchant (`PrepaidEscrow.sol:212`, note C1). The mock escrow `src/mockbank/escrow.ts` applies the same rules when `REINS_ESCROW=mock` | `contracts/test/PrepaidEscrow.t.sol` (unit and 2 fuzz tests), `contracts/test/Invariants.t.sol` (3 invariants); `tests/foundations/mock-escrow.test.ts`; `tests/foundations/voluntary-exit.test.ts`; `tests/chain/eip712.test.ts` (TS and contract digests agree, needs anvil). Foundry pass: CI job `contracts` in `.github/workflows/ci.yml:23-36`; the `ci` workflow succeeded on `4ac4669` (`gh run list --branch main`). Not re-run locally for this update (the OpenZeppelin submodule is not checked out here) | Built, **not audited**, **not deployed**, not the default. See §3.1 and KR-1 |
| **G10** | Every on-chain transaction comes from the executor after the Gate; release keys never reach the server | Chain adapter is imported only by `src/server/executor/**` (`eslint.config.mjs:38-42`, `src/server/executor/run.ts:15`). Chain and simulator key reads are restricted by `eslint.config.mjs:85-102`. Consumer key lives in the browser (`src/ui/prepaid/consumer-key.ts`). See §3.2 | `pnpm lint`; `tests/chain/adapter.test.ts` (simulate first, same hash on re-run, consecutive nonces, no voluntary exit without the consumer signature, refuses a mismatched agent key; needs anvil, `contracts/out` and DB); `tests/chain/exit.e2e.test.ts` (forged attestation denied by the Gate, nothing sent; same needs); `tests/foundations/user-prepaid.test.ts` (purchase, check-in and exit run through the Gate on the mock escrow; DB); `src/server/prepaid/purchase-signature.test.ts` and `redeem-signature.test.ts` (high-s twins rejected) | Built in code. No chain transaction has been sent on a public network (KR-17). Lint rule has gaps (§3.2) |

A note on G1 and G10 together: the lint rule is a build check, not a runtime check. It stops a careless import. It does not stop someone who edits the lint config. Code review covers that (`roles.md` §6.1, CODEOWNERS).

Test status. The last count we measured was `pnpm test` on `ad0f9aa` with no database: **459 passed, 157 skipped** (41 files passed, 23 skipped). The skipped ones are the DB suites. That count is **out of date**: the tree has since gained the chain, signature and eval tests. A new count on `4ac4669`, with and without the local Supabase and anvil: **pending (R2, before the final)**. This update did not run `pnpm test` (no `node_modules` in the worktree). What we can say from CI: the `ci` workflow succeeded on `4ac4669` (`gh run list --branch main`). That run has no database and no anvil, so the DB and chain suites were skipped in it (KR-15).

### 3.1 The escrow contract (`contracts/`)

**Status: not audited.** No external review has been done. The only review is the team's own tests (below) and a second reviewer (R2-10, **pending**). It has not been deployed: `contracts/deployments/` holds only `.gitkeep`. Treat everything below as a description of the code, not as a proof.

Files: `contracts/src/PrepaidEscrow.sol` (251 lines) and `contracts/src/TestCNY.sol` (22 lines, a valueless 2-decimal test token). Spec: `docs/PRD_PrepaidEscrow_Contract.md` and `architecture.md` §24. Solidity 0.8.24 (`PrepaidEscrow.sol:2`). The contract inherits only OpenZeppelin `EIP712` and `ReentrancyGuard` (`:18`). OpenZeppelin v5.7.0 is the version `contracts/README.md` names. The submodule is not checked out in the worktree used for this update, so we did not read the library source.

What the code enforces:

| Claim | Where | How we know |
|---|---|---|
| Token leaves the escrow in four places only: one unit to `pl.merchant`, the refund to `pl.consumer` (attested), the refund to `pl.consumer` (voluntary), the fee to `pl.merchant` (voluntary) | `PrepaidEscrow.sol:173`, `:195`, `:211`, `:212`. These are the only `safeTransfer` calls. `:152` is the only `safeTransferFrom`, and it pulls into the escrow | Read the file. `Invariants.t.sol:48` (`invariant_outflowsOnlyToConsumersAndMerchants`) |
| So money leaves in **three** ways, not two: a session to the merchant (two signatures), a refund to the plan owner, and a voluntary exit that also pays the merchant a capped fee (note C1) | `:157-174`, `:178-196`, `:200-213` | Read the file. `architecture.md` §24.3 lists all four functions |
| No recipient parameter. The only addresses a caller supplies sit inside signed structs (`Offer.merchant`, `PurchaseAuth.consumer`, `PurchaseAuth.agent`). Payouts go to the addresses stored at purchase | `:125-130`, `:157`, `:178`, `:200` (signatures); `:144` (stored plan) | Read the file |
| No owner, admin, pause, upgrade, sweep or oracle rotation. `token` and `oracle` are `immutable`. Four external functions change state; the rest are views. No `delegatecall`, `selfdestruct` or low-level call | `:87-88`, `:115-119` | Read the file. A grep for `delegatecall`, `selfdestruct`, `.call(` and `onlyOwner` found nothing in it |
| The agent has one on-chain power: it may call `exitWithAttestation` for a plan that named it. The refund still goes to the consumer | `:184`, `:195` | `PrepaidEscrow.t.sol:306` (`test_attestedExit_byAgentRefundsConsumer`), `:345` (other callers revert) |
| The agent address is stored from the consumer's signed `PurchaseAuth`. The other three functions are open to any caller but need signatures the agent key does not hold | `:38-43`, `:144`, `:137-138`, `:166-167`, `:204` | Read the file. On our side the adapter also refuses to send anything but `exitWithAttestation` from the agent key (`chain/escrow.ts:37-42`) |
| Session ordering: `sessionNo` must equal `redeemed + 1`; the counter moves before the transfer; the last unit sets `Completed` | `:164`, `:169-170`, `:173` | `PrepaidEscrow.t.sol:243` (`test_redeem_revertsOnWrongSession`), `:225`, `:213` |
| Both signatures are needed to pay a session, and they must cover the same `(planId, sessionNo, deadline)` | `:165-167`, `:77` | `:261` (`test_redeem_needsBothSignatures`), `:271`, `:280` |
| The EIP-712 domain is `("PrepaidEscrow", "1")` from OpenZeppelin `EIP712`, so chain id and contract address are in every digest | `:115`, `:229`, `:235`, `:239`, `:243`, `:249` | `PrepaidEscrow.t.sol:514` (hashes match a local EIP-712), `:530` (a signature does not replay on a second deployment). The chain id part rests on the library |
| Replay: purchase authorization digests are recorded; a plan is Active only until one exit or the last session; stale signatures meet a non-Active plan or a used session number | `:91`, `:139-140`, `:183`, `:192`, `:202`, `:208` | `:144` (`test_purchase_revertsWhenAuthReused`), `:419`, `:497` |
| An attestation must name the plan's merchant, be kind 1 or 2, be inside its own window, be at most 2 days old, and be signed by `oracle` | `:82`, `:185-189` | `:368`, `:374`, `:382`, `:395`, `:410` |
| Refund + fee + paid sessions equal the amount paid in; the escrow balance equals the unused balance of Active plans; plan terms never change | `:191`, `:206-212` | `PrepaidEscrow.t.sol:548` (`testFuzz_moneyIsConserved`), `:584` (random signers rejected); `Invariants.t.sol:37`, `:48`, `:61` |
| Reentrancy: all four money functions are `nonReentrant` and set state before they move tokens | `:131`, `:160`, `:180`, `:200` | Read the file |
| The voluntary-exit fee is capped at 2000 bps (20%). Zero units or zero price are refused at purchase | `:83`, `:133` | `PrepaidEscrow.t.sol:94`, `:103` |

Test suite: `contracts/test/PrepaidEscrow.t.sol` (596 lines), `contracts/test/Invariants.t.sol` (80 lines, three invariants), plus a handler and a base in `contracts/test/handlers/` and `contracts/test/utils/`. `contracts/foundry.toml` sets 256 fuzz runs and 64 invariant runs of depth 32 by default. The `ci` profile sets 1024 fuzz runs and 256 invariant runs of depth 64. CI runs `forge test` with the `ci` profile (`.github/workflows/ci.yml:23-36`). The Foundry pass count is **pending (R3)**: we did not run `forge test` for this update, and CI shows pass or fail only. The three forced on-chain reverts and the Base Sepolia transaction hashes are **pending (R3)**. `docs/evidence/` does not exist and `contracts/deployments/` is empty, so the Day-1 spike (`contracts/script/Spike.s.sol`) has not been run on a public chain. A local anvil rehearsal script exists (`contracts/script/anvil-rehearsal.sh`).

**Contract notes for the reviewer.** These are places where the contract is weaker than, or different from, what `architecture.md` §24 or `AGENTS.md` suggest. We did not smooth them over.

- **C1. Voluntary exit pays the merchant on the consumer's signature alone** (`PrepaidEscrow.sol:206-212`). The fee is up to 20% of the unused balance (`:83`). `AGENTS.md` and the G9 line say money goes to the merchant "one unit per two-signature session". The fee path is a second way money reaches the merchant, with one signature. `architecture.md` §24.3 documents it. The AGENTS.md wording does not, and invariant 2 in `Invariants.t.sol:48` only checks "consumers and merchants". Decide whether to reword G9 or to tighten the invariant test.
- **C2. An attestation is not tied to one plan and is never marked used** (`:45-51`, `:185-189`, `:242-246`). `planId` is not in the signed attestation, and there is no used-set. `caseRef` is signed but never checked or stored. The same signed attestation can exit every Active plan of that merchant whose consumer or named agent submits it, for up to 2 days. This matches the idea of a merchant-level event, but one oracle signature then affects many plans. The oracle is immutable with no rotation (`:88`), so a leaked oracle key cannot be replaced. A new deployment is the only fix. The impact is bounded: refunds go to the plan's consumer (`:195`), and only a consumer or a named agent can submit (`:184`). The cost lands on the merchant's cash flow (KR-2).
- **C3. `Offer.nonce` is signed but never recorded** (`:35`, `:91`). Only the purchase authorization is single-use. One merchant-signed offer can create many plans, for many consumers or for one consumer with different deadlines. `PrepaidEscrow.t.sol:155` (`test_purchase_sameOfferServesManyConsumers`) shows this is intended. A reader who expects the nonce to cap an offer would be wrong.
- **C4. High-s rejection is not tested in Solidity.** All signature checks call `ECDSA.recover` (`:135`, `:138`, `:166`, `:167`, `:189`, `:204`). The contract PRD relies on OpenZeppelin 5 reverting on malleable signatures (`docs/PRD_PrepaidEscrow_Contract.md:138`). The only malformed-signature test checks length (`PrepaidEscrow.t.sol:135`). The high-s twin is tested only in TypeScript (`src/server/prepaid/purchase-signature.test.ts:189`, `src/server/prepaid/redeem-signature.test.ts:160`).
- **C5. The off-chain voluntary-exit check does not reject high-s.** `recoverVoluntaryExitSigner` (`src/server/prepaid/exit-signature.ts:35-47`) does not call `isCanonicalSignature`, and neither does the `prepaid_exit_voluntary` branch in `src/server/executor/snapshot.ts:327-331`. Purchase and redeem do (`purchase-signature.ts:64`, `:80`; `redeem-signature.ts:62`). A high-s exit signature would pass the Gate's check, then revert in the adapter's simulation, which sends nothing (`chain/escrow.ts:181-189`). It fails closed, but the Gate's `consumerSigValid` can say true for a signature the contract will refuse.
- **C6. Only externally-owned accounts can sign.** `ECDSA.recover` has no ERC-1271 path. The passkey smart account that `architecture.md` §24.2 plans for the consumer would not work with this contract as written.
- **C7. Tokens sent straight to the escrow are locked for good** (no sweep, by design). Fee-on-transfer or rebasing tokens would break the balance invariant (`:142` and `:152` assume the full `total` arrives). The token is fixed at deployment (`:87`) and `TestCNY` is a plain ERC-20, so this is not reachable today.
- **C8. A redeem deadline has no upper bound in the contract** (`:163`). A leaked pair of signatures for the next session stays usable until its deadline or until the plan ends. The browser and the gym tablet choose the deadline, not the contract.
- **C9. `TestCNY` has an owner who can mint without limit** (`TestCNY.sol:19-21`). The escrow never calls it (`TestCNY.sol:11`). It is a demo faucet for a valueless token. A real deployment would need a different token and a fresh review.

### 3.2 The chain adapter and key handling

**Where the code is.** The chain adapter is one file, `src/server/adapters/settlement/chain/escrow.ts` (332 lines). It is built only when `REINS_ESCROW=chain` (`src/server/executor/run.ts:82-92`). Anything else uses the mock escrow. If the chain is selected but not configured, the first prepaid action fails with `escrow_not_configured` instead of falling back to the mock (`escrow.ts:322-325`). Helpers live in `src/server/chain/` (`client.ts`, `types.ts`, `eip712.ts`, `abi.ts`, `indexer.ts`).

**Which keys the server reads.**

| Key | Read at | Used for |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | `escrow.ts:327` | Gas for `purchaseWithPermit`, `redeem`, `exitVoluntaryBySig` (`SENDER_OF`, `:37-42`) |
| `AGENT_PRIVATE_KEY` | `escrow.ts:328` | `exitWithAttestation` only (`:41`) |
| `AGENT_ADDRESS` (not a key) | `escrow.ts:329` | Must equal the agent key's address, or the adapter refuses to start (`:108-111`). `tests/chain/adapter.test.ts:148` covers this |

The consumer key is never read by the server. The simulator keys (`MERCHANT_SIM_PRIVATE_KEY`, `ORACLE_PRIVATE_KEY`) are read only under `src/sim/` (`src/sim/merchant/keys.ts:16`, `src/sim/registry/attestations.ts:58`). `TOKEN_MINTER_PRIVATE_KEY` is read by no file under `src/` or `app/`, only by `scripts/chain-demo-setup-main.ts:36`.

**The lint rule** (`eslint.config.mjs:11-31`, `:85-102`). `RELAYER_PRIVATE_KEY` and `AGENT_PRIVATE_KEY` may be read only under `src/server/adapters/settlement/chain/**`. The simulator keys may be read only under `src/sim/**`. The chain adapter may not read simulator keys, and `src/sim/**` may not read chain keys. The selectors catch `a.KEY`, `a["KEY"]` and `const { KEY } = a`. We read the config; we did not run `pnpm lint` for this update. The rule has limits you should know about:

- Tests, `scripts/**` and `*.test.*` files are exempt (`eslint.config.mjs:17`). `scripts/chain-demo-setup-main.ts:34-36` reads `DEMO_CONSUMER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY` and `TOKEN_MINTER_PRIVATE_KEY`. It is a local demo script, not request code.
- A read through a variable name, such as `process.env[name]`, is not matched. Review has to catch that.
- It is a build check. Someone who edits the config removes it. CODEOWNERS covers that (`roles.md` §6.1).
- The relayer, agent, oracle and merchant simulator keys are all read by code in the same Next.js app. If they are set in one deployment, one server compromise yields all of them. Only the consumer key is outside the server. The simulators are meant to be outside parties; here they are not separate processes.

**Nonce allocation and stored raw transactions** (`escrow.ts:157-236`, `supabase/migrations/20261020000012_chain_nonces.sql`). Each send follows this order:

1. If a `chain_txs` row exists for the action, re-broadcast its stored `raw_tx`, same hash (`:163-178`). `chain_txs.action_id` is `unique` (`supabase/migrations/20261017000004_prepaid_tables.sql:93`), so an action has at most one transaction.
2. Simulate with `estimateContractGas`. A contract revert returns `reverted` and nothing is signed or sent (`:181-189`). An RPC failure throws `chain_rpc_unavailable` (`:189`, `:191-193`).
3. In one database transaction: lock the sender's `chain_nonces` row with `for update` (`:201`), take `max(next_nonce, pending count)` (`:202-203`), sign, insert the `chain_txs` row with `raw_tx` and `tx_hash`, and advance `next_nonce` (`:198-222`). A failure rolls all of it back, so there is no nonce gap from a failed signing.
4. Broadcast. A failure leaves the signed row and returns `pending` (`:225-229`). A receipt timeout also returns `pending` (`:126-134`). The executor maps `pending` to `unknown`, not to a second send (`run.ts:295`, `:342`).

What is stored: the raw signed transaction (public once broadcast) and its hash. No private key is stored. `chain_txs` is user-scoped under RLS (`supabase/migrations/20261017000005_rls.sql:13`). `chain_nonces` is a system table, `reins_server` only, with forced RLS (`20261020000012_chain_nonces.sql:13-17`). Tested by `tests/chain/adapter.test.ts:108` (same hash on re-run) and `:123` (parallel sends get consecutive nonces). Both need anvil, `contracts/out` and a database.

Limits of this design:

- If a signed transaction is never broadcast, later transactions from that sender take higher nonces and wait behind it. A re-run of the same action re-broadcasts it (`:167-178`), but no job does that alone. `reconcile` is not built (KR-10).
- Gas price comes from the RPC with no cap (`:191`, `:210-212`), and gas is the estimate plus 20% (`:210`). Test ETH only.
- Chain deploy is not done, so none of this has run against a public network (KR-17).

**User-signed flows.** Purchase, check-in and voluntary exit start in the browser and run through the same executor and Gate as agent actions (`src/server/prepaid/user-actions.ts:1-7`).

- The signed payload is stored next to the action, not in its args, in `prepaid_action_signatures` (`user-actions.ts:92`). The agent cannot supply or change it. The `prepaid_exit` owner signature is stored in `prepaid_exit_signatures` for the same reason (`exit-signature.ts:1-8`).
- Phase B of `src/server/executor/run.ts` re-verifies before anything is reserved: `snapshot.ts:297-331` builds `consumerSigValid` and `merchantSigValid` from the stored payload against the plan owner and merchant read from the escrow. The Gate decides on those facts.
- An approved `prepaid_exit` whose stored owner signature no longer verifies is denied by the executor before any cap is reserved or the approval consumed (`run.ts:178-207`, rule name at `:36`). The settle step sends exactly the signature phase B verified (`run.ts:287-293`).
- Storing the exit signature is session-scoped and checks that the signer is the user's own `consumer_browser` wallet and that the deadline is in the future by the database clock (`exit-signature.ts:70-108`). The audit event holds the action id and deadline, not the signature (`:115`).
- High-s signatures are rejected before recovery for purchase and redeem (`purchase-signature.ts:51-56`, `:64`, `:80`; `redeem-signature.ts:62`), with tests (`purchase-signature.test.ts:189`, `redeem-signature.test.ts:160`). **They are not rejected for the voluntary exit** (note C5).
- "Never throws" holds for the signature recovery helpers. `purchaseSignatureFacts` returns failing facts on any bad input (`purchase-signature.ts:267-281`), `verifyRedeemSignatures` catches and fails (`redeem-signature.ts:90-100`), and `recoverVoluntaryExitSigner` returns `null` (`exit-signature.ts:35-47`). `verifiedVoluntaryExitSignature` (`:55-67`) runs a database query and can throw on a database error. That aborts the phase B transaction, which fails closed.
- Every user-signed action also needs the Gate to return `allow`. The rows in §2 apply. With `REINS_ESCROW=mock` the same checks run, but the mock bank, not a contract, moves the money.

**The browser consumer key** (`src/ui/prepaid/consumer-key.ts`).

- It is generated in the browser (`:57`) and stored in IndexedDB database `reins-keys` (`:11-13`, `:43-45`). It is stored as a plain hex string. The backup file is encrypted (PBKDF2-SHA256, 310,000 rounds, AES-GCM, `:72-95`). The stored key is not. Script injection on our own origin could read it. We have not assessed a Content-Security-Policy.
- We checked that it is never sent to the server. The only `fetch` in the file sends the address to `POST /api/prepaid/wallet` (`:61-66`). Every other request in `src/ui` and `app` is a GET, a body-less POST, or sends signatures and ids: `src/ui/prepaid/actions.tsx:79` (offer, signatures, optional permit), `:147` (check-in signatures), `:170` (exit signature), `src/ui/screens/approval.tsx:47` (exit signature). The signing code is `src/ui/prepaid/sign.ts`, which receives an account object and returns signatures. No file under `src/server`, `src/agent`, `src/core` or `app/api` imports `src/ui` code (a search found one comment in `app/api/kill-switch/route.ts:4`). This is a read of the code, not a network capture.
- The server also sees the token permit signature, which lets the escrow pull the exact purchase total (`sign.ts:64-80`). It is a signature, not a key.
- Losing the key means the owner cannot sign a voluntary exit or a check-in. Attested exits still work (T27, KR-7).

## 4. Threats and residual risk

Ratings in the "PRD rating" column are copied from PRD §16.1. The PRD says these are filled from red-team results. The last column is our own current view. It is not a measurement. Where it says "pending", it waits on the red-team run in §6.

| # | Threat | Main control (file) | PRD rating | Our view now |
|---|---|---|---|---|
| T1 | Indirect prompt injection | Readers, provenance, no account parameter (`src/agent/nodes/reader`, `decide.ts`) | Measured | Money path closed by code. Planner proposals can still be skewed. Rate pending |
| T2 | Multi-turn escalation | No mandate tool for the agent (`src/agent/tools/read/index.ts`) | Measured | Closed for the agent. User-side widening flow not built (KR-3). Pending |
| T3 | Mandate mis-compiled | Read-back from the DSL, fail closed (`src/server/mandate/readback.ts`) | Medium | Medium. Ambiguity detection is planned for release R1 (Alpha), not in the hackathon cut |
| T4 | Parser misreads amount | Amount must match the bill row (`decide.ts`) | Measured | A wrong amount that is also wrong in the bill row still passes. Anomaly check then asks |
| T5 | Hallucinated numbers | Numbers from tools; Explainer post-check (`src/agent/nodes/numbers.ts`) | Low | Low |
| T6 | PII to the LLM provider | Tokenization (`src/server/pii/redact.ts`) | Cross-border review | Regex only. Open |
| T7 | Replay / double execution | Idempotency keys, conditional status update (`run.ts`) | Low | Low |
| T8 | Race on caps | Row lock (`run.ts`) | Load-tested | Tested at 20, not 100. Pending |
| T9 | Approval reuse | Hash-bound single-use rows (`approvals/index.ts`) | Low | Low |
| T10 | Mandate change mid-flight | Re-decide in phase B, `cancelled_replan` (`run.ts`) | Low | Low (`tests/harness/replan.test.ts`, needs DB) |
| T11 | Spoofed forwarded receipts | Email is untrusted input | Medium | Medium. Email forwarding is not built |
| T12 | Poisoned CSV rows | CSV is untrusted input | Medium | Medium |
| T13 | Session takeover | Session only in R0; passkeys later | Open in R0 | **High in R0.** Anyone with the session can approve (KR-4) |
| T14 | Browser agent hijack | P2 only | High | Not built, not exposed |
| T15 | Server forges user signatures | User-held keys; server stores public data | Low | Low for prepaid (browser key). Mandate "signature" is a hash in R0 (KR-3) |
| T16 | Stale or manipulated FX | `fx.rate_fresh`, 2-day limit (`decide.ts`) | Low | Low (`decide.test.ts`) |
| T17 | Trial auto-cancel abuse | Trusted trial origin, keep flag, notice (`decide.ts`) | Low | Low (`decide.test.ts`, `cancel-and-exit.test.ts`) |
| T18 | Misleading recommendations | Cited signals; simulated signals labeled | Medium | Medium |
| T19 | Checkpoint or resume tampering | Resume carries no authority (`approvals/index.ts`, `run.ts`) | Low | Low (`tests/harness/resume.test.ts`) |
| T20 | Re-execution on resume | `interrupt()` alone in its node; keys persisted first | Low | Low |
| T21 | Forged, stale or mismatched attestation | Oracle address check, merchant and age checks in the Gate (`decide.ts`); the contract repeats them (`PrepaidEscrow.sol:185-189`) | Low | Low in the Gate (`tests/risk/job.test.ts`, `tests/foundations/cancel-and-exit.test.ts`, `tests/chain/exit.e2e.test.ts`). Registry is simulated. Contract layer: tested in Foundry (`PrepaidEscrow.t.sol:368-410`), unaudited, not deployed. One attestation can exit many plans of a merchant (C2) |
| T22 | Fake check-ins | Two signatures over one numbered session (`PrepaidEscrow.sol:164-167`) | Low | Contract and mock both enforce it (`PrepaidEscrow.t.sol:243-280`, `tests/foundations/mock-escrow.test.ts`). Contract unaudited, not deployed. The merchant simulator key sits in the same app (§3.2) |
| T23 | Agent key compromise | Key may only call `exitWithAttestation` (`chain/escrow.ts:37-42`; contract `:184`, refund to consumer `:195`) | Low | Low by design: a stolen agent key can only trigger a refund to the owner, and only with a fresh oracle attestation. Not exercised on a public chain |
| T24 | Contract bug | Minimal contract, OpenZeppelin, Foundry tests, second reviewer | Medium, unaudited | **Unknown. The contract is in the tree, tested by us, and unaudited.** Nine reviewer notes in §3.1 (C1 to C9). Second reviewer: pending (R2-10) |
| T25 | Soft-signal injection | Signal Reader quarantine; warnings only | Low for money | Low for money (`tests/harness/quarantine.test.ts`, `tests/risk/job.test.ts`) |
| T26 | Relayer key misuse | Relayer carries only signed payloads; test ETH only; sends are simulated first (`chain/escrow.ts:181-189`) | Low | Low for funds: the contract checks every field (§3.1). The relayer can still waste gas (no price cap, `:191`) or stall a queue (KR-10) |
| T27 | Lost consumer key | Encrypted backup; attested exits still work | High for real money | High. Acceptable for a testnet demo only |

## 5. Known-risk list

These are open on purpose or open because the work is not done. KR-1 to KR-7 are the ones the plan asks us to state.

| ID | Risk | Why it matters | Owner | Plan |
|---|---|---|---|---|
| KR-1 | **The escrow contract is not audited.** It is in the tree (`contracts/src/PrepaidEscrow.sol`) but not deployed, and it is not the default (KR-17) | A contract bug could lock funds or pay the wrong address (T24). A Gate bug could then no longer be caught by the second layer. See C1 to C9 in §3.1 | R3 builds; R2 second review (R2-10) | Testnet and valueless token only. Say "not audited" on the slide and in the README. Foundry pass count: **pending (R3)**. Second review: **pending (R2)** |
| KR-2 | **The registry (oracle) is simulated.** One oracle key decides which exits are valid (T21) | A leaked or wrong oracle key can trigger early exits. Worst case is a refund to the owner, which hurts the merchant's cash flow | R3 | v1 only. A real registry needs several sources and a dispute window (release R1) |
| KR-3 | **The R0 mandate "signature" is a hash.** `src/server/executor/snapshot.ts:86-88` marks a mandate valid when its stored hash matches its stored policy (a comment there says "no passkey yet"). The routes to create, sign and store a mandate (`/api/mandates/*`) are not built | Anyone who can write the database can write a matching hash. G6 holds for the agent, not for a database writer | R2 (R2-08) | Passkey signing in release R1 |
| KR-4 | **R0 approvals are authenticated by the session only** (T13, PRD §10.5) | A stolen session can approve actions. The approval is still hash-bound, single-use and expiring | R2 | Passkeys arrive in release R1 |
| KR-5 | **Fake check-ins and the merchant key** (T22). The merchant simulator signs check-ins. The release still needs the owner's signature | Depends on the device key staying safe. The merchant simulator key is read by `src/sim/merchant/keys.ts:16` in the same app that holds the relayer and agent keys | R3 | Contract enforces two signatures (`PrepaidEscrow.sol:165-167`) |
| KR-6 | **Agent key and relayer key** (T23, T26). Read only at `chain/escrow.ts:327-328`. The key-read lint rule is on main (`eslint.config.mjs:85-102`) | A server compromise yields both keys, and the oracle and merchant simulator keys if they share the deployment. The lint rule does not cover tests, scripts or computed property names (§3.2) | R3 | Keep keys in separate env scopes for a public demo. Not run for this update: `pnpm lint` |
| KR-7 | **Lost consumer key** (T27). The key is stored as plain hex in the browser's IndexedDB (`consumer-key.ts:43-45`). Only the backup file is encrypted | Funds stay in escrow until a merchant or an attested exit moves them. The owner cannot sign a voluntary exit. Script injection on our origin could read the key | R3 | Encrypted backup. Smart account with recovery later (the contract accepts only EOA signatures, C6) |
| KR-8 | `MOCKBANK_API_KEY` is read outside the executor's adapter: `src/sim/merchant/checkin.ts` reads it to look up a plan, and `src/mockbank/http.ts` checks it. `architecture.md` §16.3 says only the executor's adapter reads it | The key gives access to the mock bank API. It is test data, but the doc claim is wider than the code | R2 with R3 | Either narrow the simulator read or change the doc sentence. No lint rule covers this key |
| KR-9 | Concurrency test runs 20 parallel payments, not 100 | The PRD acceptance criterion is 100 | R2 (R2-09) | Raise to 100. Result: **pending** |
| KR-10 | `reconcile` is not built (`run.ts:7`, `:32`, `:383` and `chain/escrow.ts:132` only mention it). An outcome marked `unknown` keeps its cap reserved and no job resolves it. A signed but unbroadcast chain transaction is not re-sent by any job | Fails closed for caps (money cannot be over-spent), but a stuck reservation lowers headroom and a stuck nonce can hold later transactions from that sender (§3.2) | R2 with R3 | Build reconcile or document manual repair |
| KR-11 | **Resolved.** `GET /api/audit/verify` now exists (`app/api/audit/verify/route.ts`) and the Evidence screen reads it (`src/ui/screens/evidence.tsx`). Route tests: `tests/ui-routes/routes.test.ts` | None open from the draft | R2 | Keep as a record |
| KR-12 | `REINS_EVAL_DISABLE_GATE` (arm A of the experiment) and its production guard: **pending**. We find neither in `src/`, `app/` or `scripts/` | The "without Gate" numbers cannot be produced yet, and no code refuses to start with the flag in production (`task.md` I-04 is open) | R2 (R2-11) | Build with the production guard. Another branch may add it; this row changes only when it is on main |
| KR-13 | Redaction is regex-based. Scanned (image-only) PDFs are unsupported | Unusual formats can slip past tokenization (T6) | R1 | Marked for review, not processed |
| KR-14 | Cross-border transfer of tokenized text to the LLM provider (T6) | Legal review is open (PRD) | Team | Open |
| KR-15 | CI has no database and no anvil. The `check` job (`.github/workflows/ci.yml:9-21`) runs lint, typecheck and `pnpm test`, so the DB suites (most of the G3, G4, G5 and G7 tests) and the chain suites (`tests/chain/*`, skipped without anvil, `contracts/out` or a database) are skipped in CI and run only on a developer machine. The `contracts` job (`:23-36`) does run `forge test` | A regression in those guarantees would not fail the build | R2 with R3 | Add a Supabase service and anvil to CI, or record a local run for each release |
| KR-16 | Tier badges are not computed in code (§2). We found no code under `src/` or `app/` that writes `actions.tier` | The feed cannot show the tier the PRD promises | R2 | Derive from rule IDs |
| KR-17 | **The escrow is the mock by default, and the Base Sepolia deployment and spike are not done.** `REINS_ESCROW=mock` is the default (`run.ts:82`, `.env.example:49`). `contracts/deployments/` holds only `.gitkeep`. `docs/evidence/` does not exist. `README.md:79` still says the contract "is not built yet", which is out of date | Every on-chain claim in this report is about code that has only run on a local anvil or in Foundry. No transaction hash exists. The demo may run on the mock unless `REINS_ESCROW=chain` is set | R3 | Deploy, run `Spike.s.sol`, record hashes in `docs/evidence/spike.md` (`contracts/README.md`). **Pending (R3)**. R2 to fix the README line |
| KR-18 | **The Playwright suite is not in CI.** `e2e/flows.spec.ts` runs on fixtures (`REINS_FIXTURES=1`) with `pnpm exec playwright test`; `ci.yml` has no Playwright step. Three of five planned flows are covered, and there is no spec for prepaid buy, check-in or exit (`task.md` R4-10) | UI regressions, including the approval and signing screens, do not fail the build | R4 | Add a CI job, or run it by hand before each release |
| KR-19 | **Contract notes C1 to C9** in §3.1 are open until the contract owner and the second reviewer decide each one | Some are wording (C1), some are design (C2, C3, C6), some are test gaps (C4, C5) | R3 with R2 | Decide, then fix the contract, the test or the sentence |

## 6. Red-team results

None of the numbers below exist yet. We list what we will report and the rule we will use.

**Design** (PRD §20.3). Same Planner, same tools, same scenarios. Arm A has no Gate. Arm B is full Reins. For prepaid cases, arm A still meets the contract, and the report says which attacks fail there.

**Upper bound.** For 0 successes in n trials, the 95% upper bound on the attack success rate is `1 - 0.05^(1/n)`. This gives 13.9% at n = 20 and 7.2% at n = 40. With any successes we use Clopper-Pearson. Zero successes does not mean zero risk; it means the true rate is probably below the bound.

| Item | Target | Result | Owner |
|---|---|---|---|
| Attack suite size | at least 40 cases, including prepaid cases 19 to 26 | **pending.** Today `evals/cases/attacks/index.json` lists 5 fixtures (3 PDFs, 2 soft-signal bundles). `evals/cases/gate/index.json` adds 17 Gate-only cases for categories 19 to 22, 25 and 26, run by `tests/evals/gate-arm.test.ts`. They are cases, not results: no success rate has been measured | R2 (R2-11) |
| Attack success, arm A (no Gate) | measured | **pending** | R2 |
| Attack success, arm B (full Reins) | measured, with upper bound | **pending** | R2 |
| Benign suite (false blocks) | at least 30 tasks | **pending** | R2 with R5 |
| Ambiguity set | at least 30 phrasings | **pending** | R1 |
| Concurrency | 100 parallel attempts | **pending** (20 tested today) | R2 |
| Foundry unit, fuzz, invariant tests | all pass | **pending (pass count).** The `contracts` CI job runs them (`ci.yml:23-36`) and the `ci` workflow succeeded on `4ac4669`. We did not run `forge test` locally for this update | R3 |
| Three forced on-chain reverts | three transaction hashes | **pending** | R3 |
| Purchase, redeem, attested exit transaction hashes on Base Sepolia | three hashes with Basescan links | **pending** | R3 |

The utility cost of the Gate (tasks lost to false blocks) will be reported next to the security numbers.

## 7. What is NOT protected

- **A compromised server, database or CI.** Whoever can write the database can write actions, approvals and a matching mandate hash (KR-3). The audit chain would show tampering to a later reader. It does not prevent it.
- **A stolen user session or device** (T13). The R0 approval needs only the session.
- **Wrong proposals.** Quarantine lowers the chance that an injection changes what the Planner proposes. It cannot remove it. The Gate limits what is allowed. It does not judge whether a proposal was a good idea.
- **Allowed but unwise actions.** A payment that passes every rule in the mandate will run. The mandate is the user's risk setting.
- **Loss or theft of the consumer key** (T27, KR-7). The key sits unencrypted in the browser's IndexedDB. Everything here is for a testnet and a mock bank, not for real money.
- **The escrow contract.** It is not audited and not deployed (KR-1, KR-17).
- **The oracle and the registry.** They are simulated. We do not claim real-world attestation security.
- **Privacy at the LLM provider** beyond tokenization (T6, KR-13, KR-14).
- **Availability.** A kill switch, a stale rate or a failed adapter stops actions. We do not promise uptime.
- **Prompt, model and dependency supply chain.** Versions are pinned. CI (`.github/workflows/ci.yml`) runs lint, typecheck and test only. `pnpm audit` is not run. We do not claim more.

## 8. How to re-check

Run these from the repo root unless noted. The first block needs no database.

```bash
pnpm lint            # module boundaries, adapter import rule, private-key read rules
pnpm typecheck       # next typegen + tsc --noEmit
pnpm test            # Vitest; DB and chain suites are skipped without their setup
```

The database suites (G3, G4, G5, G7 and the user-prepaid flows) need local Supabase:

```bash
pnpm exec supabase start
pnpm exec supabase db reset
set -a; . ./.env.local; set +a; pnpm test
```

The contract tests need the submodules (forge-std and OpenZeppelin), then Foundry:

```bash
git submodule update --init --recursive
cd contracts
forge test                           # unit, fuzz, invariant (default profile)
FOUNDRY_PROFILE=ci forge test        # what CI runs: more fuzz and invariant runs
```

The chain suites (`tests/chain/*`) start a private anvil and deploy from `contracts/out`. They are skipped unless `anvil` is on the path and `forge build` has been run in `contracts/` (`tests/chain/anvil.ts:50`). The adapter and exit tests also need `DATABASE_URL` (`tests/chain/adapter.test.ts:25`). With the env above loaded:

```bash
(cd contracts && forge build)
pnpm vitest run tests/chain
```

The browser flows run on fixtures. Stop `pnpm dev` first, because both use `.next`:

```bash
pnpm exec playwright test
```

Two quick checks that need no setup: `grep -rn "REINS_EVAL_DISABLE_GATE" src app scripts` (empty means the guard is still pending), and `ls contracts/deployments` (only `.gitkeep` means nothing is deployed).

## 9. Before the final (Tuesday 12:00)

1. Run the full suite with the local Supabase loaded and put the real counts in §3. Owner: R2.
2. Fill §6 from the eval runner. Owner: R2.
3. Run `forge test` and record the pass count, deploy to Base Sepolia, and add the three transaction hashes and the forced reverts. Owner: R3.
4. Decide KR-8 (narrow the read or change the sentence in `architecture.md` §16.3). Owner: R2 with R3.
5. Derive tiers in code (KR-16) so the feed matches §2, and decide how CI runs the DB, chain and Playwright suites (KR-15, KR-18). Owner: R2 with R3.
6. Check the T0 and T1 wording against the PRD owner. Owner: R2.
7. R3 and the second reviewer answer C1 to C9 (KR-19), and R2 fixes the stale `README.md:79` line (KR-17).
8. R1 and R3 read the sections on their modules. R5 edits the language.

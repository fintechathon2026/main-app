# Reins: R0 Task Checklist

| Field | Value |
|---|---|
| Document | `tasks.md` v1.0 |
| Date | October 16, 2026 (20:30 WIB) |
| Scope | Everything needed for the R0 submission (PRD v2.0 §21.1), including the prepaid escrow module |
| Related | `PRD_Reins_v2.0.md`, `architecture.md` v1.1 (§ refs below), `roles.md` v1.1 (owners) |
| Deadline | October 20, 23:59 Beijing = **22:59 WIB**. Team target: **submit 18:00 WIB** |

**How to use:** tick items as they merge to `main` (`[x]`). Times are WIB. "Dep" lists items that must land first. Anything already finished from the earlier plan: tick it now so the list shows real status. Post blockers older than 60 minutes in the team chat.

---

## 0. Today: decisions and messages (Friday, October 16)

- [ ] **T0-1** Team agrees on the v2.0 scope: bills + subscriptions + prepaid escrow, Topic A, demo persona Lin (PRD §1, §21). Owner: team leader. Due Fri 21:30
- [ ] **T0-2** Fill names in `roles.md` §9, including tech lead and contract owner. Owner: team leader. Due Fri 21:30
- [ ] **T0-3** Check whether a Leash co-author is on the team; if yes, they run the spike (`roles.md` §1.2). Owner: team leader. Due Fri 21:30
- [ ] **T0-4** Registration form sent to fintechathon@ican-x.com (passport note CC info@ican-x.com). Owner: team leader. Due Fri 23:59
- [ ] **T0-5** Organizer question sent to info@ican-x.com: can Topic A entries earn the on-chain exploration bonus, and do testnet transaction hashes count as on-chain evidence? Owner: team leader. Due Fri 23:59
- [ ] **T0-6** Message friends in mainland China with the validation questions (`roles.md` R5). Owner: R5. Due Fri 23:59

---

## 1. Decision gates and milestones

| ID | When | Pass condition | If it fails |
|---|---|---|---|
| **G1** Testnet spike (**passed Oct 20**, `docs/evidence/spike.md`) | Sat Oct 17, 18:00 | Three confirmed Base Sepolia hashes (purchase, redeem, attested exit) in `docs/evidence/spike.md` | `REINS_ESCROW=mock`; build `MockEscrowAdapter` (§24.13); deck drops on-chain claims |
| **M1** First bill end to end | Sun Oct 18, 12:00 | Bill → plan → approval → payment on the mock bank; attack PDF blocked | Tech lead cuts per `roles.md` §5 cut order |
| **M2** Prepaid end to end (**passed Oct 20**, see `docs/evidence/spike.md`) | Sun Oct 18, 21:00 | Buy → check in → publish attestation → attested exit, three hashes in the feed (or mock ids after G1 fail) | Cut voluntary exit and soft signals first |
| **M3** Pitch dry run | Mon Oct 19, 19:00 | 10-minute run with the live demo path | Fix list owned by R5 |
| **M4** Code freeze | Tue Oct 20, 12:00 | `main` green, tagged `demo-*`, deployed | Only demo-blocking fixes after this |
| **M5** Submission sent | Tue Oct 20, 18:00 | All six items sent (Section 8) | Hard deadline 22:59 |

---

## 2. R1 Agent and Read Side

- [x] **R1-01** Graph skeleton with stub nodes; `RecordedModelClient` (§6.1 to §6.5)
- [x] **R1-02** Read queries and read tools against seed data; API types + fixtures for `/api/summary`, `/api/subscriptions`, `/api/recommendations` (§6.4, §13)
- [x] **R1-03** Reader subgraph + bill PDF upload job; `suspicious_text` flag (§6.3, §10). Due Sat
- [x] **R1-04** Planner prompts; `persist_plan`, `gate_preview`, `create_approval`, `await_approval` (interrupt only) (§6.3). Due Sat
- [x] **R1-05** FX fetch (Frankfurter, CNY and IDR) into `fx_rates` (§10.1). Due Sat
- [x] **R1-06** **Advisor tool** `advise_prepaid` as a pure function with unit tests: savings, break-even, `λ_t`, expected loss, recommendation; Lin's example gives 1,500 / 48 / 300 (PRD §15.11). Due Sat
- [x] **R1-07** Prepaid read tools `list_prepaid_plans`, `list_risk_signals`; `prepaid_exit(plan_id)` schema captured, not executed (§6.4). Due Sat
- [x] **R1-08** API types + fixtures for `/api/prepaid/plans`, `/api/prepaid/offers`, `/api/prepaid/offers/:id/advice` (§13). Due Sat 12:00 (R4 depends on it)
- [x] **R1-09** **Signal Reader** subgraph: complaint and news text → `{level, summary, sourceIds}`, no tools, disjoint state (§6.3). Due Sat
- [x] **R1-10** Recurring detection (FX-normalized), MAD anomaly, rec score, summary figures; routes live (PRD §15). Due Sun 12:00
- [x] **R1-11** First end-to-end bill run with R2 (M1). Due Sun 12:00 *(on local Supabase, against minimal R2/R3 pieces; see note below)*
- [x] **R1-12** `prepaid_risk` trigger from `cron/risk` into the graph; Planner proposes `prepaid_exit` on a hard signal, warning only on soft signals. Dep: R3-10, R2-07. Due Sun 21:00
- [x] **R1-13** Explainer templates incl. currency and `tx {short_hash}`; numbers post-checked against audit rows (§6.7). Due Mon
- [x] **R1-14** Harness tests: canary strings (PDFs and complaint texts) never in Planner prompts; forged resume; double resume; Reader and Signal Reader have no tools (§18.1). Due Mon
- [x] **R1-15** Demo-mode recordings for the full demo path incl. prepaid (§18.3). Due Mon 21:00 *(hand-written answers in `evals/recordings/demo_lin`; re-record live with `scripts/record-demo.ts` once an Anthropic key exists)*
- [x] **R1-16** Tech doc sections: agent design, injection defenses, core algorithms incl. advisor. Due Mon 20:00

> **R1 status (Oct 17):** all R1 items are on branch `feat/r1-agent`, not yet on `main`. To run end to end, R1 also built **minimal versions** of R2/R3 work, each marked "Owner: R2|R3 … Minimal version by R1" in its header: shared types, migrations + seed + RLS, mock bank, Gate `decide`, executor + mock-bank adapter + mock escrow, approvals + routes, audit log, plan store, registry simulator, cron/risk. R2/R3 should extend these instead of starting over; handover notes are in each file header. Those items are annotated with an *[R1 note: …]* below and left unticked, because the owners decide when they are done.

## 3. R2 Safety, Execution and Evaluation

- [x] **R2-01** Shared types: `TypedAction`, `GateResult`, `GateSnapshot`, `Labeled<T>`, **`PrepaidFacts`**, prepaid rule IDs (§7.1, §24.9). Due Fri 23:00 *[R1 note: Minimal version by R1 in `src/core/types/index.ts` (types incl. `PrepaidFacts`). R2 note: reviewed; `PREPAID_RULE_IDS`, `SHARED_RULE_IDS` and `PREPAID_PATH_RULE_IDS` added in `src/core/gate/rule-ids.ts`, checked against every rule ID the prepaid tests see. Still loose: `GateSnapshot.mandate.policy` is `unknown`, `GateResult.reasons` carry keys without params]*
- [x] **R2-02** Mandate schema incl. `prepaid` block, defaults, canonical hash, narrowing incl. prepaid rules (PRD §9). Due Sat *[R1 note: zod schema, defaults, canonical hash, `LIN_MANDATE_V3` in `src/core/mandate/`. R2 note: `narrows`, `compareMandates` and `equivalent` added in `src/core/mandate/narrow.ts` (PR #15). Unclear field orders count as widening and are listed in the file header. A change of `alpha` under the conformal method is "incomparable", because the conformal check fails closed on short history. Not wired into the activate route or the history `direction` yet. Needs a second reviewer (`src/core/mandate`)]*
- [x] **R2-03** Gate pipeline steps 1 to 10 with unit tests; provenance matrix incl. `chain`, `oracle`, `web` (§7.2). Due Sat *[R1 note: Minimal version by R1: pure `decide()` with the §7.2 pipeline and table tests in `src/core/gate/`. R2 note: the conformal check is built and wired. About 190 test rows added for the untested provenance and prepaid rows, plus `anomaly.test.ts` (PR #14). Oct 20: PR #28 fixes the `conformalCheck` rank rounding, makes an invalid `alpha` fail closed, and reads per-payee caps from own keys only (`constructor` no longer skips the cap), with tests. `snapshot.ts` now sets `facts.sessionNo` for redeem, so the session check is live. Left: no p95 timing test]* *[note, Oct 20: merged to `main` branch work: `decide.ts` now fails closed when a signed redeem's `sessionNo` is missing (was treated as a pass), plus an exact-integer reference test for `conformalCheck`'s rank across n=1..200, p=1..99 and a fast-check boundary property. All green: `pnpm vitest run src/core/gate/` (348 tests)]*
- [x] **R2-04** **Prepaid Gate rules** with table-driven tests for every row in §24.9. Due Sat *[R1 note: Minimal version by R1 with table-driven tests in `src/core/gate/decide.test.ts`. R2 note: the §24.9 gaps are covered (PR #14). Open: voluntary exit without a consumer signature denies, but §24.9 says `require_confirm`; per-payee cap is not applied on redeem. The doc or the code has to change]*
- [ ] **R2-05** Executor phases A/B/C, row lock, cap reservation, approvals, audit log (§8). Due Sat *[R1 note: Minimal version by R1 in `src/server/executor/` (phases A/B/C, row lock, cap reservation, hash re-check under lock, approvals, audit). R2 to review. Oct 20 review of the executor, chain adapter and prepaid routes: safe for the testnet demo; to fix before real funds: nonce gap after a failed broadcast has no reconcile job, a crash after phase B leaks the cap reservation, phase C re-reads a signed payload that `reins_server` can update, redeem `session_no` is not checked against the signed payload, the stored offer expiry and nonce are not enforced, prepaid POST routes do not check content type or Origin. These need the database tests, so they wait for Docker]*
- [x] **R2-06** **User-initiated actions** (`actor = user`, plan trigger `user_action`) through the same executor (§8.2). Due Sat *[R1 note: Not built. The Gate denies user-initiated prepaid actions until signatures exist. R2 note: pure purchase and redeem signature checks are on `main` (PR #17). The user-action insert and the executor `settle` cases for purchase, redeem and voluntary exit are not built; they need a database to test]* *[PR #25 note, Oct 20: built. `src/server/prepaid/user-actions.ts`: a `user_action` plan and an `actor = user` action, signed payload kept in `prepaid_action_signatures` (migration 017, RLS) out of the args, then the same `ActionExecutor.run`. Executor `settle` handles purchase, redeem and voluntary exit. DB test `tests/foundations/user-prepaid.test.ts` (buy, check in, leave; forged offer and one-signer check-in denied)]*
- [x] **R2-07** **Phase-A prepaid facts:** read plan from contract, recover signatures (viem), re-verify attestations against `ORACLE_ADDRESS` (§24.9, ADR-012). Dep: R3-03. Due Sun 12:00 *[R1 note: attestation signature re-verified with viem at decision time. R2 note: purchase and redeem signature recovery added as pure modules in `src/server/prepaid/` (high-s and bad `v` rejected, never throws, injected clock). Not wired into `snapshot.ts`, which should fill `merchantSigValid`, `termsMatchStored`, `consumerSigValid` and `sessionNo` from them. Contract reads wait for R3-03]* *[PR #25 note, Oct 20: wired. `snapshot.ts` fills `offer.merchantSigValid`, `termsMatchStored`, `expired`, `consumerSigValid`, `merchantSigValid` and `sessionNo` from the stored signatures, re-verified in phase B against the offer row and the escrow plan read in phase A (contract on chain, mock otherwise)]*
- [x] **R2-08** Routes live: `/api/approvals`, `/api/feed` (+ `why`), `/api/mandates/*`, `/api/prepaid/purchase`, `/checkin`, `/exit`, `/api/prepaid/wallet` (§13). Due Sun 18:00 *[R1 note: `GET /api/approvals` and `POST /api/approvals/[id]`. R2 note: added `GET /api/audit/verify`, `/api/feed`, `/api/feed/[id]/why`, `/api/mandates/active`, `/api/mandates/history` and `POST /api/mandates/compile` with types, fixtures and tests (PR #18). The SQL has only been typechecked, never run against Postgres. Not built: `/api/mandates/activate`, `/api/prepaid/purchase`, `/checkin`, `/exit`, `/wallet`. `compile.ts` has no PII redaction or rate limit]* *[PR #25 note, Oct 20: all listed routes now exist: `/api/prepaid/wallet`, `/purchase`, `/plans/:id/checkin`, `/plans/:id/exit`, plus `/api/prepaid/exit-signature/:actionId`, `/signing` and `/gym/*`. Feed, why, mandates active/history/compile and audit verify ran against local Postgres and the live UI. Still missing: `/api/mandates/activate`]* *[note, Oct 20: `POST /api/mandates/activate` built — classifies every activation against the active mandate with `compareMandates` (narrowing/equivalent activate at once, widening/incomparable need `confirmWidening`, sent by the Rules screen's change sheet only after its 10 s review). DB test + e2e test (narrowing and widening signing) pass]*
- [x] **R2-09** Concurrency test (100 parallel payments); property tests incl. prepaid narrowing (§7.3, §18.1). Due Sun *[R1 note: concurrency test with 20 parallel payments (not 100) in `tests/foundations/`. R2 note: property tests added in `src/core/gate/gate.property.test.ts` (narrowing monotonicity incl. prepaid, canonicalization). The 100-payment test still needs a database]* *[note, Oct 20: the 100-payment test is in `tests/foundations/executor.test.ts` — 100 distinct bills, each run twice at once (200 concurrent `executor.run` calls); the daily cap holds (G4) and every bill is paid at most once (G5). Passes against local Postgres]*
- [ ] **R2-10** Second review of `contracts/**` (§24.11). Dep: R3-02. Due Sun 12:00 *[R2 note, Oct 20: reviewer-agent pass done on `PrepaidEscrow.sol`: no fund-theft path, no admin, pause, upgrade, sweep or recipient parameter, agent key limited to `exitWithAttestation`, EIP-712 hashes match `chain/types.ts`. For R3 before the first deploy: an attestation issued before the plan was bought can refund it (no `purchasedAt`), `Exited` omits the attestation digest, fee-on-transfer tokens break accounting, `Offer.nonce` is never checked on chain, `anvil-rehearsal.sh` has no chain-id guard, and the tests miss attestation reuse across plans and malleability cases. A human second reviewer is still needed (`roles.md` §6.1)]*
- [ ] **R2-11** Eval runner, arms A/B, ≥ 40 attacks incl. cases 19 to 26; three force-sent on-chain reverts for evidence (PRD §20, §24.5). Due Mon 18:00 *[R2 note: partly done: 17 Gate-only cases for categories 19 to 22, 25 and 26 in `evals/cases/gate/`, run through the real `decide()` by `tests/evals/gate-arm.test.ts`, and `evals/stats.ts` (rule of three, Clopper-Pearson) (PR #16). Not built: the runner, arm A (needs the database and mock bank; `REINS_EVAL_DISABLE_GATE` is not implemented), the other 40+ cases, the force-sent reverts]* *[note, Oct 20: arm A built — `REINS_EVAL_DISABLE_GATE` bypasses the Gate in the executor and is refused outside a deployed env (`assertGateNotDisabled`, I-04 closed). 19 gate cases (categories 19-22, 25, 26) plus 25 redteam cases (categories 1-18, 23-24) declared in `evals/cases/`; `evals/runner/{cases,persona,script}.ts` load and validate them and drive the compromised-Planner replay. `tests/chain/force-send.test.ts` force-sends 3 attack transactions as real on-chain reverts on anvil with recorded revert reasons. Still missing: the top-level `evals/runner.ts` orchestrator and `evals/runner/scenarios.ts` that the case files' own descriptions point to — the case data and the pieces that run each kind exist, but nothing yet stitches a full run end to end]*
- [ ] **R2-12** Security self-assessment: tiers, known-risk list incl. T21 to T27 and "contract not audited", red-team numbers with upper bounds. Due Mon 20:00 draft, Tue 12:00 final *[R2 note: draft in `docs/submission/security-self-assessment.md` (PR #19). Red-team numbers, Foundry results and transaction hashes are marked pending. Open questions in the PR: T0 and T1 definitions, `MOCKBANK_API_KEY` read by the merchant sim. Oct 20: PR #30 brings it up to date with the contract, chain adapter, wired signatures and the contract notes C1 to C9. Foundry count and OpenZeppelin high-s behaviour are unverified]*
- [x] **R2-13** Lint rules: only the executor imports settlement adapters; chain keys read only in their modules (§5.1). Due Sat *[R1 note: ESLint import boundaries in `eslint.config.mjs`. R2 note: chain-key rule added (PR #13): `RELAYER_PRIVATE_KEY` and `AGENT_PRIVATE_KEY` only in `src/server/adapters/settlement/chain/**`, the sim, oracle and minter keys only in `src/sim/**`. The chain adapter does not exist yet, so the first rule protects no code]*

## 4. R3 Platform, Data and Chain

- [x] **R3-01** Generate relayer, agent, merchant, oracle and deployer keys; fund relayer, agent and deployer on Base Sepolia with margin; note faucet limits (§24.2, §24.12). Due Fri 23:59 *[Base Sepolia, Oct 20: deployer, relayer, agent, merchant sim, oracle and spike consumer keys generated (kept in `.env.local` only); deployer, relayer and agent funded from the Coinbase CDP faucet]*
- [x] **R3-02** `contracts/`: `TestCNY`, `PrepaidEscrow` (§24.3, §24.4); Foundry unit tests for every `require`. Due Sat 13:00 *[PR #25 note, Oct 20: `contracts/src/PrepaidEscrow.sol`, `TestCNY.sol`, unit tests in `contracts/test/PrepaidEscrow.t.sol`; `forge test` 48 passed (from `feat/r3-02-escrow-contract`)]*
- [x] **R3-03** Deploy script + `deployments/base-sepolia.json`; spike script → three hashes in `docs/evidence/spike.md` (**G1**). Due Sat 18:00 *[Base Sepolia, Oct 20: deployed at block 48356082, `contracts/deployments/84532.json` (escrow `0xcf9e…37d0`, tCNY `0x7218…87F1`). Spike passed: purchase, redeem and attested exit confirmed, hashes and checks in `docs/evidence/spike.md`. Contract not verified on Basescan yet]*
- [ ] **R3-04** Migrations, roles, RLS for the core tables (§12) plus prepaid tables (§24.8) and the `actions.actor` column; seed loader with Lin's data. Due Sat 12:00 if not done *[R1 note: Done by R1 (minimal): migrations 001–011, RLS, append-only audit log, seed for Lin in `supabase/`. R3 to review; add new migrations, don't edit applied ones]*
- [ ] **R3-05** Mock bank: accounts, bills, billers, payments with idempotency, subscriptions with trials, cancel, scenarios, attack injection; mock bank adapter (§3, PRD §14.1). Due Sat *[R1 note: Done by R1 (minimal): `src/mockbank/`, `app/mockbank/`, settlement adapter. Internal transfer and reverse routes not built]*
- [ ] **R3-06** Checkpointer `setup()` + Supabase pooler test; Vercel deploy on Node 22 (§19). Due Sat *[R1 note: Partly by R1: `pnpm db:checkpointer` script with grants. Pooler test and Vercel deploy not done]* *[R3 note, Oct 20: checkpoint tables created on the hosted project (same SQL as `setup()` in `@langchain/langgraph-checkpoint-postgres` 1.1.0, `checkpoint_migrations` at v5, so a later `pnpm db:checkpointer` is a no-op), granted to `reins_server`. Left: role passwords, `DATABASE_URL_POOLER` pooler test against the hosted project, Vercel deploy]*
- [ ] **R3-07** Cron routes with run-now buttons, incl. `chain-sync` and `risk`; kill switch; settings (§11). Due Sun *[R1 note: Partly by R1: `cron/fx`, `cron/detect`, `cron/risk`, `cron/cleanup`. `chain-sync`, run-now buttons, kill switch and settings not built]*
- [x] **R3-08** **`EscrowAdapter`:** relayer and agent senders, advisory-lock nonces, stored raw transactions, receipts, `reconcile`; eval force-send option (§24.5). Dep: R3-03, R2-01. Due Sun 15:00 *[PR #25 note, Oct 20: `src/server/adapters/settlement/chain/escrow.ts` behind `REINS_ESCROW=chain`: relayer and agent senders (agent only `exitWithAttestation`), nonce rows in `chain_nonces`, raw tx stored in `chain_txs` and re-broadcast on retry, simulation before send. Implements the shared `EscrowAdapter`. Tested on anvil incl. 10 parallel nonces. No eval force-send option yet]*
- [x] **R3-09** Indexer `chain-sync` into `prepaid_plans`, `prepaid_sessions`, `chain_cursors` (§24.6). Due Sun 15:00 *[PR #25 note, Oct 20: `src/server/chain/indexer.ts`, run by `cron/chain-sync` through the shared cron job (also `run-now`); an incomplete chain env answers 501 `chain_not_configured`]*
- [x] **R3-10** Simulators: merchant offers (FitBox with escrow; one merchant without), check-in signing, gym-tablet page; registry attestations, publish button, soft signals incl. attack texts (§24.7). Due Sun 15:00 *[R1 note: Partly by R1: registry simulator only (`src/sim/registry/`, `app/sim/registry/`). Merchant offers, check-in signing and gym tablet not built]* *[PR #25 note, Oct 20: gym tablet page added at `/sim/tablet` (signs the plan's next session with the merchant key, server side). Check-in reads the plan from the chain in chain mode, from the mock escrow otherwise]*
- [x] **R3-11** Prepaid end to end on testnet with R1, R2, R4 (**M2**). Due Sun 21:00 *[PR #25 note, Oct 20: works end to end on the mock escrow (browser buy, check in, leave, all through the Gate). On Base Sepolia it waits for the deploy (R3-03)]* *[Base Sepolia, Oct 20: done. Lin's plan 2 bought, 12 sessions checked in, indexed by chain-sync and exited by the agent through the Gate after a court-enforcement attestation; ¥4,800 back to the owner. Hashes in `docs/evidence/spike.md`]*
- [x] **R3-12** *Only if G1 failed:* `MockEscrowAdapter` with the same checks (§24.13). Due Sun 15:00 *[R1 note: Partly by R1: mock escrow handles `prepaid_exit` only, without signature checks]* *[PR #25 note, Oct 20: the mock escrow now runs purchase, redeem, attested and voluntary exit with the contract's signature checks; a mock purchase is mirrored into `prepaid_plans`]*
- [ ] **R3-13** Foundry fuzz and invariant tests (§24.11); chain integration tests on anvil incl. 10 parallel nonces. Due Mon 15:00 *[PR #25 note, Oct 20: Foundry fuzz and invariant suites in `contracts/test/Invariants.t.sol` pass; chain integration tests on anvil (`tests/chain`, 18 tests, incl. 10 parallel nonces and attested exit end to end) pass locally. Not in CI with a database yet]*
- [x] **R3-14** RLS tests per role; audit export JSONL/CSV; mock bank log export; **transaction hash list with Basescan links** (§17). Due Mon *[R1 note: Partly by R1: a cross-user RLS test. Per-role tests, audit export and hash list not built]* *[Oct 20: transaction hash list with Basescan links: `GET /api/audit/transactions` (JSON/CSV, from `chain_txs` plus indexed purchases and sessions), shown on the Evidence screen with a CSV download]*
- [ ] **R3-15** README, deployment instructions incl. contract deploy and addresses; tech doc "System architecture" + contract spec. Due Mon 20:00 *[R4 note, Oct 20: `README.md` is on `main` with the judge intro, quick start, tour and real-versus-simulated table. Added with the deploy and architecture PR: hosted Vercel and Supabase steps with the variables by group, an escrow contract section with the Base Sepolia addresses marked pending, and `docs/submission/system-architecture.md`. Left for R3: the real deploy, the addresses and the three transaction hashes, and checking the contract spec against the final contract]*
- [ ] **R3-16** Final deploy, tag `demo-*`, smoke E2E (**M4**). Due Tue 12:00

> **R3 status (backend and database, branch `feat/r3-backend-db`, not yet on `main`):** items stay unticked until merged.
> - **R3-04:** new migrations 012–016 (security-definer `cron_user_ids()` / `risk_active_prepaid_plans()` granted only to `reins_server`; `mockbank.transfers` and `call_log.customer_id`; mock escrow plan id sequence, used-auth store and payout ledger; `prepaid_exit_signatures` with RLS enabled and forced, bound to `actions (id, user_id)` by a composite FK). 001–011 unchanged.
> - **R3-05:** mock bank internal transfer and 24h reverse (bank picks the destination), `payday` scenario and scenario listing, `transferInternal` in the adapter. Sweeps accept amounts with up to two decimals (numeric(14,2)).
> - **R3-06:** pooler test for RLS settings and the checkpointer (`tests/foundations/pooler.test.ts`, runs only with `DATABASE_URL_POOLER`).
> - **R3-07:** shared cron jobs, `cron/chain-sync` (`CRON_SECRET`), admin-allowlisted `/api/admin/run-now`, `/api/kill-switch`, `/api/settings`, with API types and fixtures.
> - **R3-10:** merchant simulator offers (FitBox with escrow, one without) and check-in signing under `src/sim/merchant`, `app/sim/merchant`.
> - **R3-12:** mock escrow with the contract's signature checks and rules for purchase, redeem, attested and voluntary exit; payouts only to plan merchant or owner; EIP-712 types in `src/server/chain/types.ts`. An approved voluntary exit sends the owner's signature, stored via `recordVoluntaryExitSignature` and re-verified in the executor (an invalid signature denies the action and records `executor.consumer_signature_invalid`); `EscrowAdapter.exitVoluntary` now requires `deadline` and `consumerSig`. `EscrowAdapter` (R2-owned), `run.ts`, `snapshot.ts` and migrations 015–016 changed; needs R2 sign-off.
> - **R3-14:** RLS tests per role for every user-scoped table, a catalog test that every `public` table has RLS enabled and forced, audit export (JSONL/CSV), mock bank call log export.
>
> **Remaining:** Vercel deploy on Node 22 (R3-06); real pooler check against Supabase cloud (R3-06); gym-tablet page (R3-10); all chain items R3-01/02/03/08/09/11/13; Basescan transaction hash list (R3-14, needs chain). Follow-ups: wire `recordVoluntaryExitSignature` into the approval sheet (R2 route, R4 browser signing); `prepaid_exit_voluntary` is still `not_supported` in `settle`.

## 5. R4 Frontend and UI/UX

- [x] **R4-01** App shell, auth, layout, component kit; design tokens from the canvas (lime, ink, grey, lavender; Plus Jakarta Sans, Geist Mono) (§15.1) *[R4 note: Partly done on `feat/ui-screens`: app shell (sidebar on desktop, floating tab bar on phones), tokens, Plus Jakarta Sans + Geist Mono, own component kit (no shadcn), Phosphor icons. Lavender dropped (one accent: lime on ink), see `docs/ui-direction.md`. Sign in page (email link), auth gate and sign out on `feat/ui-login`: needs NEXT_PUBLIC_SUPABASE_URL and ANON_KEY; without them the app opens as before. Not tried against a real Supabase project yet]*
- [ ] **R4-02** Move design data to Lin and CNY in the canvas and Figma (rupiah amounts, Indonesian billers → Shenzhen equivalents). Due Sat 12:00
- [x] **R4-03** Approval card and feed item rendered from structured fields only (§15.3). Due Sat *(on `feat/ui-screens`; feed items use labelled sample data until `GET /api/feed` lands)*
- [x] **R4-04** Chat with streaming; approvals inbox; mandate editor with read-back and diff, incl. prepaid rules (§15.2). Due Sat *[R4 note: Streaming chat, approvals in Home, rules screen with change history and a change sheet that calls `/api/mandates/compile`. The compile and active/history routes are on `main` now (R2-08), but the sheet does not show the read-back or diff yet and the screen still reads the sample mandate. The 10 s widening review waits for the activate route]* *[PR #25 note, Oct 20: Rules reads `/api/mandates/active` and `/history` (no more hardcoded mandate) and the change sheet shows the compile read-back. Signing a new version waits for `/api/mandates/activate`]* *[note, Oct 20: the change sheet now signs through `/api/mandates/activate`. A narrowing or equivalent change signs at once; a widening or incomparable change shows the 10 s review (`confirmWidening`) before it can sign. e2e test covers both paths]*
- [x] **R4-05** **Prepaid screen**: plans with sessions left and balance in escrow, risk status with signal sources, "test token, no value" tag. Dep: R1-08 fixtures. Due Sat *(on `feat/ui-screens`)*
- [x] **R4-06** **Advisor card** (savings, break-even, expected loss with and without escrow, risk source). Due Sat *(on `feat/ui-screens`, numbers from `/api/prepaid/offers/:id/advice`)*
- [x] **R4-07** **Buy sheet with browser signing:** generate the consumer key (viem), keep it in IndexedDB, register the address, sign permit + purchase, encrypted backup download (§15.3, §24.2). Due Sun 12:00 *[R4 note: Not built. The Buy button is shown disabled with the reason. Needs a decision on `idb-keyval`]* *[PR #25 note, Oct 20: built without a new dependency: `src/ui/prepaid/consumer-key.ts` keeps the key in IndexedDB, registers only the address, signs PurchaseAuth (+ permit on chain); encrypted backup (PBKDF2 + AES-GCM) download. Restore exists in code but has no UI button yet]*
- [x] **R4-08** Subscriptions + recommendations; feed "Why?" with explorer links on prepaid items; evidence screen v1 with the hash list. Due Sun *(on `feat/ui-screens`; evidence uses labelled sample data until `/api/audit/*` lands)*
- [x] **R4-09** **Check-in flow** (scan or paste the gym-tablet payload, sign, submit) and gym-tablet page styling; exit cards (attested exit result, voluntary exit with fee). Due Sun 21:00 *[R4 note: Partly done on `feat/ui-screens`: exit result card (amount back, reason, sessions used). Check-in and voluntary exit buttons shown disabled; gym-tablet page not built (needs R3-10 check-in signing and a QR package, `qrcode.react` not added yet)]* *[PR #25 note, Oct 20: check-in signs the gym tablet's Redeem in the browser and submits both signatures; voluntary exit with fee and confirm; exited plans show the refund. Agent exits without a notice ask for the owner's signature before the OK. Check-in fetches the gym signature server side instead of scanning a QR]*
- [x] **R4-10** Playwright E2E for 5 flows: bill with approval, attack PDF blocked, cancel, mandate edit, prepaid buy → check-in → exit. Due Mon *[R4 note: Partly done: 3 of 5 flows in `e2e/flows.spec.ts` (bill with approval, attack PDF blocked, cancel) plus sign in, 14 tests on desktop and phone, run on a production build with `REINS_FIXTURES=1`: `pnpm exec playwright test`. Mandate edit and prepaid buy, check-in, exit wait for their routes. Not in CI yet]* *[PR #25 note, Oct 20: prepaid buy, check-in and exit verified by hand in the browser against local Postgres; no Playwright spec for it yet]* *[R4 note, Oct 20: all five flows now have specs (PR #29): `e2e/mandate.spec.ts` (read-back, nothing activated, failed compile) and `e2e/prepaid.spec.ts` (real browser signing, key never sent), 36 tests pass on desktop and phone. Server routes are stubbed, so the real routes are not covered. Still not in CI. The blocked-payment test now asserts there is no agent note, after commit 30004c6 removed it on purpose]*
- [x] **R4-11** Mobile polish; PWA manifest and icons. Due Mon *(PWA manifest, favicon and app icons are on `main`. Phone pass on `chore/ui-phone-polish`: 44px touch targets, 16px inputs so iOS does not zoom, ask bar moved to the top of Home, confirm popup fixed on phones. Real-device check still to do once the demo device is chosen)*
- [x] **R4-12** Screenshots for deck and docs; UX section of the tech doc. Due Mon 20:00 *(`docs/screenshots/` 28 images, light and dark; `docs/submission/ux-design.md`)*
- [ ] **R4-13** Record the demo video with R5 (Section 9). Due Tue 15:00

> **R4 status (Oct 20):** The seven R0 screens, sign in, the phone pass, the Playwright flows (3 of 5, plus sign in and pause), the screenshots and the UX doc are on `main`. R2 read routes are now on `main` too: `/api/feed`, `/api/mandates/active|history|compile`, `/api/audit/verify`. Done in PR #25: Activity, Rules and Evidence read those routes (`src/ui/sample.ts` is gone), the compile read-back shows, and buy, check-in, leave and the gym tablet page work with browser signing. Still blocked: mandate activate (R2). Run with `REINS_FIXTURES=1 pnpm dev`.

## 6. R5 Finance and Product

- [ ] **R5-01** Lin's demo data v1 (CNY): rent, electricity, mobile, four subscriptions incl. ChatGPT Plus in USD and a trial, FitBox package (60 × ¥100, pay-per-visit ¥125, 10% fee), payday. Due Sat 10:00
- [ ] **R5-02** Mandate templates incl. Lin's (PRD §9.3), checked with R2. Due Sat
- [ ] **R5-03** Attack cases in R2's format: ≥ 25 for bills and subscriptions plus cases 19 to 26 for prepaid. Due Sat 21:00
- [ ] **R5-04** Prepaid evidence slide with sources (PRD §2.2.1). Verify or drop: 10.39% gym closure rate; 30-day closure notice rule. Due Sun
- [ ] **R5-05** Validation notes from friends in mainland China (元管家 flow, foreigner access, WeBank's role, lost-money stories); screenshots only with permission and without personal data. Due Sun 18:00
- [ ] **R5-06** Deck outline → v1 with screenshots → final (≤ 10 minutes). Due Sat outline, Sun v1, Tue 14:00 final
- [ ] **R5-07** Q&A list with prepared answers (PRD §2.7 plus "Who tells the contract the gym is in trouble?" and "How is this different from 元管家?"). Due Sun
- [ ] **R5-08** Video script and storyboard (Section 9); narration. Due Sat v1, Mon final
- [ ] **R5-09** Claims check: every [verify] item in the deck is verified or removed; "Reins" name conflict check; Leash disclosure present. Due Mon 20:00
- [ ] **R5-10** Language edit of the tech doc and security self-assessment. Due Tue 12:00
- [ ] **R5-11** Package and send the submission (Section 8) (**M5**). Due Tue 18:00

---

## 7. Integration checks (whoever finishes their item runs them)

- [ ] **I-01** `pnpm lint && pnpm test` green on `main`; `forge test` green when `contracts/**` changes *[PR #25 note, Oct 20: on the merge: `pnpm lint`, `pnpm typecheck`, `pnpm test` (967 passed) and `forge test` (48 passed) green; every DB suite also green against local Supabase]*
- [x] **I-02** Import rule check: only `src/server/executor/**` imports settlement adapters, including the chain adapter *[note, Oct 20: `tests/platform/settlement-imports.test.ts` lints 8 representative source paths and scans every file under version control for the three adapter import specifiers, catching dynamic `import()`/`require()` that the ESLint rule's static check does not see]*
- [ ] **I-03** No private key in the client bundle except the browser-generated consumer key; no key in logs or LangSmith traces *[PR #25 note, Oct 20: the consumer key stays in IndexedDB; the browser only gets the public RPC (`NEXT_PUBLIC_RPC_URL`), never `BASE_SEPOLIA_RPC_URL`; `SIM_API_KEY` stays server side via `/api/prepaid/gym/*`. Not yet checked on a production bundle]*
- [x] **I-04** Gate cannot be disabled in production (`REINS_EVAL_DISABLE_GATE` refused) *[R2 note, Oct 20: the refusal guard `assertGateNotDisabled` is on `main` (PR #28) and runs when the executor is built. The disabling flag itself is not implemented anywhere, since arm A of the eval runner is not built]* *[note, Oct 20: arm A is now implemented in the executor behind `REINS_EVAL_DISABLE_GATE`; the guard throws if that flag is set and `NODE_ENV=production` or any `VERCEL_ENV` is set, verified by `tests/chain/force-send.test.ts > refuses force-send in a deployed environment`]*
- [ ] **I-05** Every on-chain feed item shows a hash and a Basescan link; every simulated item shows "simulated"
- [ ] **I-06** Kill switch on → bill, cancel and prepaid actions all denied; escrowed balance unchanged

---

## 8. Submission checklist (rules Section 5)

| # | Item | Owner | Done |
|---|---|---|---|
| 1 | Technical documentation: system architecture, core algorithms (detector, anomaly, advisor), security design, contract specification | R2 (editor) | [ ] |
| 2 | Presentation deck, ≤ 10 minutes | R5 | [ ] |
| 3 | Demo video, ≤ 5 minutes | R5 + R4 | [ ] |
| 4 | Source code: GitHub link, README, deployment instructions (incl. contract), test cases (Vitest, Foundry, Playwright, eval suites) | R3 | [ ] |
| 5 | Security self-assessment: permission tiers, known-risk list (T1 to T27), red-team results, "contract not audited, testnet only" | R2 | [ ] |
| 6 | Execution evidence: sandbox operation logs, demo video, **Base Sepolia transaction hashes with Basescan links** (purchase, redeem, attested exit, plus the forced-revert attack cases) | R3 + R5 | [ ] |
| | Repository public (or access granted) before sending | R3 | [ ] |
| | Final email sent; confirmation saved | R5 | [ ] |

---

## 9. Demo video shot list (≤ 5 minutes)

1. **0:00 Hook (20 s):** "Would you let an AI pay your bills? Only if it can't break your rules."
2. **0:20 Mandate (30 s):** Lin writes rules in plain language; read-back; signs.
3. **0:50 Bill attack (50 s):** PDF with hidden text asking to pay account 8812; feed shows "Blocked: account came from a document"; "Why?" shows the rule.
4. **1:40 Bill with approval (30 s):** unusual electricity bill → approval card → approve → paid.
5. **2:10 Trial auto-cancel (20 s):** T3 item in the feed.
6. **2:30 Prepaid advisor and purchase (40 s):** FitBox offer, break-even 48 visits; buy through escrow; transaction hash on Basescan.
7. **3:10 Check-in (20 s):** gym tablet QR, Lin signs, one session released; hash.
8. **3:30 Attested exit (40 s):** registry publishes a court-enforcement record; agent proposes exit; Gate allows; ¥4,800 back to Lin; hash. Then a fake complaint with injected text: warning only, no exit.
9. **4:10 Evidence (35 s):** with/without-Gate numbers; audit chain verified; list of transaction hashes; "test token, no value; production rail: e-CNY via an operator bank".
10. **4:45 Close (15 s):** one-line positioning.

---

## 10. Claims to verify before they appear anywhere

| Claim | Status | Owner |
|---|---|---|
| Topic A entries can earn the on-chain bonus; testnet hashes count | Asked (T0-5) | team leader |
| 10.39% gym closure rate (2022) and its primary source | [verify] | R5 |
| 30-day closure notice and stop on prepayments: exact article | [verify] | R5 |
| WeBank's role in e-CNY (wallet provider seen in 2022 coverage; "Tier-2 operator" unverified) | [verify] | R5 |
| Foreigners can or cannot use 元管家 | [verify via friends] | R5 |
| Mainland China rules on crypto trading and payment (for the compliance slide) | [verify] | R5 |
| Base Sepolia confirmation time and faucet limits | [verify Day 1] | R3 |
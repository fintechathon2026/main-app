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
| **G1** Testnet spike | Sat Oct 17, 18:00 | Three confirmed Base Sepolia hashes (purchase, redeem, attested exit) in `docs/evidence/spike.md` | `REINS_ESCROW=mock`; build `MockEscrowAdapter` (§24.13); deck drops on-chain claims |
| **M1** First bill end to end | Sun Oct 18, 12:00 | Bill → plan → approval → payment on the mock bank; attack PDF blocked | Tech lead cuts per `roles.md` §5 cut order |
| **M2** Prepaid end to end | Sun Oct 18, 21:00 | Buy → check in → publish attestation → attested exit, three hashes in the feed (or mock ids after G1 fail) | Cut voluntary exit and soft signals first |
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

- [ ] **R2-01** Shared types: `TypedAction`, `GateResult`, `GateSnapshot`, `Labeled<T>`, **`PrepaidFacts`**, prepaid rule IDs (§7.1, §24.9). Due Fri 23:00 *[R1 note: Minimal version by R1 in `src/core/types/index.ts` (types incl. `PrepaidFacts`). R2 to review and extend]*
- [ ] **R2-02** Mandate schema incl. `prepaid` block, defaults, canonical hash, narrowing incl. prepaid rules (PRD §9). Due Sat *[R1 note: Partly by R1: zod schema, defaults, canonical hash, `LIN_MANDATE_V3` in `src/core/mandate/`. Narrowing not built]*
- [ ] **R2-03** Gate pipeline steps 1 to 10 with unit tests; provenance matrix incl. `chain`, `oracle`, `web` (§7.2). Due Sat *[R1 note: Minimal version by R1: pure `decide()` with the §7.2 pipeline and table tests in `src/core/gate/`. Conformal anomaly and property tests not built]*
- [ ] **R2-04** **Prepaid Gate rules** with table-driven tests for every row in §24.9. Due Sat *[R1 note: Minimal version by R1 with table-driven tests in `src/core/gate/decide.test.ts`]*
- [ ] **R2-05** Executor phases A/B/C, row lock, cap reservation, approvals, audit log (§8). Due Sat *[R1 note: Minimal version by R1 in `src/server/executor/` (phases A/B/C, row lock, cap reservation, hash re-check under lock, approvals, audit). R2 to review]*
- [ ] **R2-06** **User-initiated actions** (`actor = user`, plan trigger `user_action`) through the same executor (§8.2). Due Sat *[R1 note: Not built. The Gate denies user-initiated prepaid actions until signatures exist]*
- [ ] **R2-07** **Phase-A prepaid facts:** read plan from contract, recover signatures (viem), re-verify attestations against `ORACLE_ADDRESS` (§24.9, ADR-012). Dep: R3-03. Due Sun 12:00 *[R1 note: Partly by R1: attestation signature re-verified with viem at decision time. Contract reads and user/merchant signature recovery not built]*
- [ ] **R2-08** Routes live: `/api/approvals`, `/api/feed` (+ `why`), `/api/mandates/*`, `/api/prepaid/purchase`, `/checkin`, `/exit`, `/api/prepaid/wallet` (§13). Due Sun 18:00 *[R1 note: Partly by R1: `GET /api/approvals` and `POST /api/approvals/[id]` only]*
- [ ] **R2-09** Concurrency test (100 parallel payments); property tests incl. prepaid narrowing (§7.3, §18.1). Due Sun *[R1 note: Partly by R1: concurrency test with 20 parallel payments (not 100) in `tests/foundations/`. Property tests not built]*
- [ ] **R2-10** Second review of `contracts/**` (§24.11). Dep: R3-02. Due Sun 12:00
- [ ] **R2-11** Eval runner, arms A/B, ≥ 40 attacks incl. cases 19 to 26; three force-sent on-chain reverts for evidence (PRD §20, §24.5). Due Mon 18:00
- [ ] **R2-12** Security self-assessment: tiers, known-risk list incl. T21 to T27 and "contract not audited", red-team numbers with upper bounds. Due Mon 20:00 draft, Tue 12:00 final
- [ ] **R2-13** Lint rules: only the executor imports settlement adapters; chain keys read only in their modules (§5.1). Due Sat *[R1 note: Done by R1: ESLint import boundaries in `eslint.config.mjs`. Chain-key env rule not built]*

## 4. R3 Platform, Data and Chain

- [ ] **R3-01** Generate relayer, agent, merchant, oracle and deployer keys; fund relayer, agent and deployer on Base Sepolia with margin; note faucet limits (§24.2, §24.12). Due Fri 23:59
- [ ] **R3-02** `contracts/`: `TestCNY`, `PrepaidEscrow` (§24.3, §24.4); Foundry unit tests for every `require`. Due Sat 13:00
- [ ] **R3-03** Deploy script + `deployments/base-sepolia.json`; spike script → three hashes in `docs/evidence/spike.md` (**G1**). Due Sat 18:00
- [ ] **R3-04** Migrations, roles, RLS for the core tables (§12) plus prepaid tables (§24.8) and the `actions.actor` column; seed loader with Lin's data. Due Sat 12:00 if not done *[R1 note: Done by R1 (minimal): migrations 001–011, RLS, append-only audit log, seed for Lin in `supabase/`. R3 to review; add new migrations, don't edit applied ones]*
- [ ] **R3-05** Mock bank: accounts, bills, billers, payments with idempotency, subscriptions with trials, cancel, scenarios, attack injection; mock bank adapter (§3, PRD §14.1). Due Sat *[R1 note: Done by R1 (minimal): `src/mockbank/`, `app/mockbank/`, settlement adapter. Internal transfer and reverse routes not built]*
- [ ] **R3-06** Checkpointer `setup()` + Supabase pooler test; Vercel deploy on Node 22 (§19). Due Sat *[R1 note: Partly by R1: `pnpm db:checkpointer` script with grants. Pooler test and Vercel deploy not done]*
- [ ] **R3-07** Cron routes with run-now buttons, incl. `chain-sync` and `risk`; kill switch; settings (§11). Due Sun *[R1 note: Partly by R1: `cron/fx`, `cron/detect`, `cron/risk`, `cron/cleanup`. `chain-sync`, run-now buttons, kill switch and settings not built]*
- [ ] **R3-08** **`EscrowAdapter`:** relayer and agent senders, advisory-lock nonces, stored raw transactions, receipts, `reconcile`; eval force-send option (§24.5). Dep: R3-03, R2-01. Due Sun 15:00
- [ ] **R3-09** Indexer `chain-sync` into `prepaid_plans`, `prepaid_sessions`, `chain_cursors` (§24.6). Due Sun 15:00
- [ ] **R3-10** Simulators: merchant offers (FitBox with escrow; one merchant without), check-in signing, gym-tablet page; registry attestations, publish button, soft signals incl. attack texts (§24.7). Due Sun 15:00 *[R1 note: Partly by R1: registry simulator only (`src/sim/registry/`, `app/sim/registry/`). Merchant offers, check-in signing and gym tablet not built]*
- [ ] **R3-11** Prepaid end to end on testnet with R1, R2, R4 (**M2**). Due Sun 21:00
- [ ] **R3-12** *Only if G1 failed:* `MockEscrowAdapter` with the same checks (§24.13). Due Sun 15:00 *[R1 note: Partly by R1: mock escrow handles `prepaid_exit` only, without signature checks]*
- [ ] **R3-13** Foundry fuzz and invariant tests (§24.11); chain integration tests on anvil incl. 10 parallel nonces. Due Mon 15:00
- [ ] **R3-14** RLS tests per role; audit export JSONL/CSV; mock bank log export; **transaction hash list with Basescan links** (§17). Due Mon *[R1 note: Partly by R1: a cross-user RLS test. Per-role tests, audit export and hash list not built]*
- [ ] **R3-15** README, deployment instructions incl. contract deploy and addresses; tech doc "System architecture" + contract spec. Due Mon 20:00
- [ ] **R3-16** Final deploy, tag `demo-*`, smoke E2E (**M4**). Due Tue 12:00

## 5. R4 Frontend and UI/UX

- [ ] **R4-01** App shell, auth, layout, component kit; design tokens from the canvas (lime, ink, grey, lavender; Plus Jakarta Sans, Geist Mono) (§15.1) *[Branch `feat/r4-demo-ui`: shell, layout, tokens, kit done. Auth/login screen not built; local demo uses `REINS_DEMO_AUTH=1` + `NEXT_PUBLIC_REINS_DEMO_USER`]*
- [ ] **R4-02** Move design data to Lin and CNY in the canvas and Figma (rupiah amounts, Indonesian billers → Shenzhen equivalents). Due Sat 12:00
- [x] **R4-03** Approval card and feed item rendered from structured fields only (§15.3). Due Sat *[Branch `feat/r4-demo-ui`: approval card and feed item (`/activity`) done]*
- [x] **R4-04** Chat with streaming; approvals inbox; mandate editor with read-back and diff, incl. prepaid rules (§15.2). Due Sat *[Branch `feat/r4-demo-ui`: streaming chat, approvals inbox, and mandate card + editor (`/mandate`: read-back, diff, narrowing/widening, widening confirm, history) done. Tested on fixtures, not yet against the DB]*
- [ ] **R4-05** **Prepaid screen**: plans with sessions left and balance in escrow, risk status with signal sources, "test token, no value" tag. Dep: R1-08 fixtures. Due Sat *[Branch `feat/r4-demo-ui`: done against fixtures]*
- [ ] **R4-06** **Advisor card** (savings, break-even, expected loss with and without escrow, risk source). Due Sat *[Branch `feat/r4-demo-ui`: done]*
- [ ] **R4-07** **Buy sheet with browser signing:** generate the consumer key (viem), keep it in IndexedDB, register the address, sign permit + purchase, encrypted backup download (§15.3, §24.2). Due Sun 12:00
- [x] **R4-08** Subscriptions + recommendations; feed "Why?" with explorer links on prepaid items; evidence screen v1 with the hash list. Due Sun *[Branch `feat/r4-demo-ui`: subscriptions, feed + "Why?" (`/activity`), evidence v1 (`/evidence`: audit verify, JSONL/CSV export, tx hash list, kill switch) done. Run-now buttons and eval report not built]*
- [ ] **R4-09** **Check-in flow** (scan or paste the gym-tablet payload, sign, submit) and gym-tablet page styling; exit cards (attested exit result, voluntary exit with fee). Due Sun 21:00
- [ ] **R4-10** Playwright E2E for 5 flows: bill with approval, attack PDF blocked, cancel, mandate edit, prepaid buy → check-in → exit. Due Mon
- [ ] **R4-11** Mobile polish; PWA manifest and icons. Due Mon *[Branch `feat/r4-demo-ui`: mobile-first layout, manifest and SVG icon done]*
- [ ] **R4-12** Screenshots for deck and docs; UX section of the tech doc. Due Mon 20:00
- [ ] **R4-13** Record the demo video with R5 (Section 9). Due Tue 15:00

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

- [ ] **I-01** `pnpm lint && pnpm test` green on `main`; `forge test` green when `contracts/**` changes
- [ ] **I-02** Import rule check: only `src/server/executor/**` imports settlement adapters, including the chain adapter
- [ ] **I-03** No private key in the client bundle except the browser-generated consumer key; no key in logs or LangSmith traces
- [ ] **I-04** Gate cannot be disabled in production (`REINS_EVAL_DISABLE_GATE` refused)
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
# Reins: Team Roles and Responsibilities

| Field | Value |
|---|---|
| Document | `roles.md` v1.1 |
| Date | October 16, 2026 |
| Related | `PRD_Reins_v2.0.md`, `architecture.md` v1.1 (section numbers below refer to `architecture.md` unless marked PRD), `tasks.md` (checklist) |
| Deadline | Registration and submission: **October 20, 23:59 Beijing = 22:59 WIB**. Team target: **submit by 18:00 WIB on October 20** |
| Changes in v1.1 | Prepaid escrow module (PRD F19, architecture §24): new owners in Section 1.2, new rows in every role, new interfaces, a decision gate on October 17, a new day plan from October 16 evening, new cut order, new CODEOWNERS paths |

---

## 1. Is the split balanced?

**Headcount is balanced; workload is not, unless the scopes below are used.**

| Role as proposed | Risk if left as is | Fix in this document |
|---|---|---|
| 2 × AI | "The agent" is not two people's work for 5 days. Two people editing the same graph will collide | Split into **AI: Agent** and **AI: Safety and Evaluation** (Gate, mandate logic, detectors, red team) |
| 1 × Backend + DB | Bottleneck: everyone depends on schema, mock bank, executor, and deploy. Too much for one person, but two people editing the same migrations is worse | **Split backend by coupling, not by adding a second owner to the same files** (Section 1.1) |
| 1 × Frontend + UI/UX | Nine screens is too many to design and build in 5 days | Cut to 6 must-have screens; design in code, not in Figma first |
| 1 × Finance (non-coder) + deck | Overloaded on the last two days (deck, video, documents, evidence) | Engineers write their own technical sections; frontend co-records the video; finance owns content and the final package |

### 1.1 How backend work is shared

Backend work is spread over three people along clean seams, so each file still has one owner:

| Backend slice | Owner | Why there |
|---|---|---|
| **Foundations:** schema, roles, RLS, migrations, seed loader, mock bank, cron, deploy, CI | R3 | Everyone depends on it; must ship first; needs one owner for consistency |
| **Execution:** ActionExecutor (Gate snapshot + transaction), approvals, audit log, reconcile | R2 | Tightly coupled to the Gate (the snapshot is built inside the executor's transaction); the most security-critical code sits with the person who owns the Gate |
| **Read side:** read-tool queries, detectors, summary and recommendation figures, FX fetch | R1 | It is exactly what the agent's read tools return |
| **UI API routes:** thin route handlers the screens call | Owner of the data behind each route: R1 (summary, subscriptions, recommendations), R2 (approvals, feed and "Why?", mandates), R3 (kill switch, settings, exports) | The person who owns the data knows its shape and its security rules; R4 stays on frontend and UI/UX only |

Result: about 2.5 people's worth of backend capacity, R3 is free to finish the foundations by Saturday, and R4 does no backend work.

**Keeping R4 unblocked:** on Day 1, each route owner commits the response type in `src/server/api-types.ts` plus a JSON fixture in `fixtures/api/`. R4 builds every screen against the fixtures and switches to the real route when it lands, with no change to the component.

**One inconsistency to resolve:** earlier the team was described as 3 coders and 2 non-coders. This split has 4 coders and 1 non-coder. If the frontend person is a designer who does not code, the frontend build moves mostly to the backend person, and that role becomes overloaded. This document assumes **4 coders**. Confirm in the kickoff.

**Effect of everyone having AI coding agents (Claude Code, Codex, etc.):** writing code is no longer the bottleneck. The bottlenecks become **integration, review, and agents breaking invariants they don't know about**. So:
- Do not spend the extra speed on more features. Spend it on tests, a bigger attack suite (aim for n ≥ 40 already in R0), and demo polish.
- Frontend can likely deliver 8 screens instead of 6, but the 6 must-haves still come first.
- Finance can contribute files directly through an agent (demo data JSON, eval cases, deck), not just descriptions for others to type in.
- Review load moves to R2 and R3: security-critical files get a second human reviewer (Section 6.1).

**Missing roles that someone must hold (not new people):**
- **Tech lead / integrator:** owns the shared interfaces, merges to `main`, decides on scope cuts. Suggested: R3 (sees every stream's dependencies, and has spare capacity from Sunday).
- **Submission owner:** owns the checklist and presses "send". Suggested: Finance.
- **Registration owner:** sends the registration form and the passport question. Suggested: team leader.

### 1.2 Who owns the prepaid module (v1.1)

The module is split along the same seams as the rest of the system, so no new role is needed and every file still has one owner.

| New work | Owner | Second reviewer | Architecture ref |
|---|---|---|---|
| Contract `PrepaidEscrow` + `TestCNY`, Foundry tests (unit, fuzz, invariant), deploy and spike scripts | R3 | R2, plus any teammate who co-authored Leash | §24.3, §24.4, §24.11, §24.12 |
| `EscrowAdapter` (relayer and agent senders, nonce lock, receipts, reconcile), indexer `chain-sync` | R3 | R2 | §24.5, §24.6 |
| Merchant and registry simulators (offers, check-in signing, gym-tablet page, attestations, soft signals incl. attack texts) | R3 | R1 | §24.7 |
| Gate rules `prepaid.*`, `PrepaidFacts`, phase-A chain reads and signature recovery, DSL `prepaid` block, narrowing rules | R2 | R1 | §24.9, PRD §9 |
| Executor support for user-initiated actions and chain results | R2 | R3 | §8.2, §24.5 |
| Advisor tool, `list_prepaid_plans`, `list_risk_signals`, `prepaid_exit` capture, Signal Reader subgraph, `risk` trigger, prepaid routes' read side | R1 | R2 | §6.3, §6.4, PRD §15.11 |
| Prepaid screen, advisor card, buy sheet and check-in with browser signing (viem), exit cards, explorer links, key backup; design data moves to CNY and Lin | R4 | R1 | §15 |
| Lin's demo data (CNY), prepaid evidence with sources, chain and China Q&A, validation questions to friends in mainland China | R5 | team leader | PRD §2.2.1, §2.7 |

**Why R3 owns the contract:** the contract plays the same part for prepaid money that the mock bank plays for bills: the external system plus the adapter that talks to it. R3's floating capacity from Sunday now goes to the chain stream.

**Load and the spike:** the testnet spike (deploy, buy, check in, attested exit, three hashes) decides whether the module runs on chain. It is time-boxed to 3 hours on Saturday morning. **If a teammate co-authored Leash (Foundry, Base Sepolia), that person runs the spike**, even if their main role is R1 or R2, and R3 takes one of their Saturday items in exchange. **Decision gate: Saturday, October 17, 18:00 WIB** (`tasks.md`, gate G1). If it fails, the prepaid flow uses the mock escrow (architecture §24.13) and the deck drops on-chain claims.

**Tech lead:** stays R3. If the chain stream slips past Sunday 12:00, tech-lead duties (merges, scope cuts) move to R1 for Monday and Tuesday.

---

## 2. Roles

### R1. AI Engineer: Agent and Read Side

**Mission:** the agent plans well, never sees raw untrusted text, never holds the power to execute, and every number it reads comes from code.

| Owns | Architecture ref |
|---|---|
| LangGraph.js graph, state, nodes, edges | §6.1 to §6.3 |
| Read tools (side-effect-free) **and their database queries**; action schemas (captured, not executed) | §6.4 |
| UI routes: `/api/summary`, `/api/subscriptions`, `/api/recommendations`, `/api/subscriptions/:id/keep` (types + fixtures on Day 1) | §13 |
| Detectors and algorithms: recurring detection (FX-normalized), MAD anomaly, recommendation score, summary figures | PRD §15 |
| FX: Frankfurter fetch into `fx_rates` | §10.1 |
| Reader subgraph: bill PDF → zod-validated, `origin = document` fields; `suspicious_text` flag | §6.3, §10 |
| PDF upload → Reader job (the ingestion path that feeds the Reader) | §10.1 |
| Planner and Explainer prompts; Explainer template post-check | §6.7 |
| Model clients: Anthropic, Recorded, Recording; demo mode | §6.5, §18.3 |
| Mandate compiler LLM call (text → DSL JSON, k = 1 in R0) | §9.1 |
| Harness tests: canary strings, forged resume, double resume, Reader has no tools | §18.1 |
| Chat streaming endpoint `/api/chat`, resume endpoint `/api/agent/resume` | §13 |
| **Prepaid read side:** advisor tool (pure function + tests, PRD §15.11), `list_prepaid_plans`, `list_risk_signals`, `advise_prepaid`; `prepaid_exit` schema (captured); UI routes `/api/prepaid/plans`, `/api/prepaid/offers`, `/api/prepaid/offers/:id/advice` (types + fixtures) | §6.4, §13 |
| **Signal Reader** subgraph and the `prepaid_risk` trigger into the graph; canary test for complaint texts | §6.3, §24.11 |

**Does not own:** Gate rules, executor, approvals, database schema (requests new tables or columns from R3).

**Writes for submission:** technical documentation sections "Agent design", "Prompt-injection defenses" (adapt from `architecture.md` §4 and §6), and "Core algorithms" (detectors).

### R2. AI Engineer: Safety, Execution and Evaluation

**Mission:** prove, with numbers, that the agent cannot move money outside the mandate, and own the one code path that can move money.

| Owns | Architecture ref |
|---|---|
| Policy Gate `decide()` (pure TS), full rule pipeline, provenance matrix, `fx.rate_fresh` rule | §7 |
| Mandate core: schema, defaults, canonicalize, hash, narrowing, read-back templates, diff | §9.2 |
| Property tests (fast-check): narrowing monotonicity, Gate never more permissive | §7.3 |
| **ActionExecutor:** snapshot builder, phases A/B/C, row lock, cap reservation, approval consume, finalize, reconcile | §8.2 |
| **Approvals:** create, approve/reject handler, expiry | §8.3 |
| **Audit log:** append, chain verify | §12.2, §17 |
| UI routes: `/api/approvals`, `/api/feed`, `/api/feed/:id/why`, `/api/mandates/*`, `/api/audit/verify` (types + fixtures on Day 1) | §13 |
| Lint rule: only the executor imports settlement adapters | §5.1 |
| Concurrency test (100 parallel payments) | §18.1 |
| Eval runner: arms with/without Gate, recorded models, report with upper bounds | §18.2 |
| Attack and benign suites in code (cases authored with Finance) | PRD §20 |
| **Prepaid Gate rules** (`prepaid.*` table), `PrepaidFacts` type, phase-A chain reads and signature recovery, DSL `prepaid` block and narrowing rules, property test for prepaid narrowing | §24.9, PRD §9 |
| **User-initiated actions** in the executor (`actor = user`, plan trigger `user_action`); UI routes `/api/prepaid/purchase`, `/checkin`, `/exit`, `/api/prepaid/wallet` (types + fixtures) | §8.2, §13 |
| Attack cases 19 to 26 in both arms; three force-sent on-chain reverts for evidence | PRD §20.2, §24.5 |
| Second reviewer for `contracts/**` | §24.11 |

**Does not own:** the graph (R1), table definitions and RLS (R3; R2 requests changes and reviews them).

**Writes for submission:** "Security design" and the **Security self-assessment report** (permission tiers, known-risk list including T21 to T27 and "contract not audited", red-team results).

**Load note:** this is the heaviest technical role. If R2 falls behind, the eval runner moves to R1 first (it reuses R1's recorded model client), then the concurrency test moves to R3.

### R3. Backend Engineer: Platform and Data

**Mission:** the foundations everyone builds on, and the chain those prepaid promises live on. Ship foundations first, then the contract and its adapter.

| Owns | Architecture ref |
|---|---|
| Supabase setup: schemas (`public`, `langgraph`, `mockbank`, `eval`), roles, RLS, migrations, seed loader | §12 |
| Mock bank: HTTP API, idempotency store, scenarios, attack injection endpoints, call log | §3, PRD §14.1 |
| Mock bank settlement adapter (implements R2's `SettlementAdapter` interface) | §8.4 |
| Cron routes with run-now buttons; kill switch endpoint; settings routes (types + fixtures on Day 1) | §11, §14.5 |
| Audit export JSONL/CSV and mock bank log export (execution evidence) | §17 |
| Deploy: Vercel (Node 22), env vars, CI pipeline, LangGraph checkpointer `setup()`, Supabase pooler test | §19 |
| RLS tests per role | §18.1 |
| **Contract and chain:** `PrepaidEscrow`, `TestCNY`, Foundry tests, deploy and spike scripts, key generation and funding, `EscrowAdapter`, indexer, `chain_txs`/`chain_cursors` tables | §24 |
| **Simulators:** merchant (offers, check-in signing, gym-tablet page) and registry (attestations, soft signals with attack texts) | §24.7 |
| `MockEscrowAdapter` fallback (only if gate G1 fails) | §24.13 |
| Floating support after the chain stream is done | |

**Does not own:** executor and approvals (R2), detectors and read queries (R1), UI components (R4).

**Writes for submission:** README, deployment instructions (including contract deployment and addresses), "System architecture" section, the contract specification (from architecture §24), and the **execution evidence** export (sandbox operation logs plus the transaction hash list with Basescan links).

### R4. Frontend and UI/UX Engineer

**Mission:** a judge understands the product in 30 seconds and sees the blocked attack in one screen.

**Scope:** frontend and UI/UX only. No route handlers, database, or agent code. R4 consumes the typed API contracts and fixtures from R1, R2, and R3 (Section 1.1).

| Owns | Architecture ref |
|---|---|
| Visual design and component kit (Tailwind + shadcn/ui or similar), design in code | §15.1 |
| R0 must-have screens (below) | §15.2 |
| Approval card and feed item rendering from structured fields only | §15.3 |
| Mobile-first responsive layout; PWA manifest and icons | §15.1 |
| Playwright E2E for the 4 demo flows | §18.1 |
| Demo flow polish: seeded demo user, "Run now" buttons on the evidence screen | §18.3 |
| Screen recording of the demo video (with Finance) | Section 4 |
| **Prepaid UI:** Prepaid screen, advisor card, buy sheet with browser signing (viem, consumer key in IndexedDB, backup download), check-in flow, gym-tablet page styling, exit cards, explorer links with a "test token, no value" tag | §15.2, §15.3, §24.10 |
| Design data moves to Lin and CNY (canvas and Figma mockups currently show rupiah) | |

**R0 must-have screens (7):**
1. Home / chat
2. Approvals inbox (approval card)
3. Activity feed with "Why?" (transaction links on prepaid items)
4. Subscriptions and recommendations
5. Mandate editor and Mandate Card (read-back, diff; includes the prepaid rules)
6. Evidence (audit log, chain status, with/without-Gate results, transaction hash list)
7. **Prepaid** (plans, advisor card, buy sheet, check-in, exit), plus the gym-tablet page for the demo

**Nice to have if time allows:** Summary and insights (can be merged into Home as cards), Bills (can be merged into Feed), Settings.

**Writes for submission:** screenshots for the deck and docs; UX section of the technical documentation.

### R5. Finance and Product (non-coder)

**Mission:** make the product believable to WeBank judges and make the submission complete.

| Owns | Output |
|---|---|
| Domain realism | **Lin (demo, CNY):** Shenzhen rent, electricity, mobile; subscriptions including ChatGPT Plus in USD and a trial; the FitBox package (60 × ¥100, pay-per-visit ¥125, 10% voluntary-exit fee); amounts, due dates, payday. **Rina and Bima (validation, IDR)** stay for benign eval tasks |
| Mandate templates | "Student" and "First job" starter mandates in plain language, checked against the DSL with R2 |
| Scenario and attack authoring | Attack and benign cases written as structured descriptions (template from R2), at least 20 attacks for R0 |
| Formula sanity checks | Review recurring detection, anomaly thresholds, recommendation score, savings figures for financial sense |
| Business model and impact | PRD §6 content in pitch form; one slide with numbers, all sourced |
| **Presentation deck** | ≤ 10-minute presentation (submission item 2) |
| **Demo video script** | ≤ 5 minutes; script and storyboard; narration |
| Judge Q&A prep | "Why a Shenzhen persona?", "Why a public testnet if China bans crypto payments?", "How is this different from 元管家?", "Who tells the contract the gym is in trouble?", "How is this different from Rocket Money?", "What if the LLM is wrong?" (prepared answers: PRD §2.7) |
| Prepaid evidence and claims | Evidence slide with sources (PRD §2.2.1); verify the 10.39% closure rate and the 30-day notice rule, or drop them; never claim "WeBank is a Tier-2 operator" unless verified |
| Validation with friends in mainland China | Questions: have they or people they know lost prepaid money; how 元管家 looks in the e-CNY app; whether foreigners can use it; whether WeBank appears as an e-CNY wallet. Screenshots only without personal data, and only with permission |
| **Submission package** | Collects all six items, checks the list, submits |
| Name and claims checks | "Reins" conflict check; every [verify] claim in the deck is either verified or removed |

**Does not own:** technical writing of sections owned by engineers (edits them for clarity instead).

---

## 3. Submission Checklist Ownership

From the official rules (Section 5). The demo video is listed as optional, but execution evidence for non-on-chain topics requires "operation logs **and demo video**", so treat the video as required.

| # | Item | Owner | Contributors | Due (WIB) |
|---|---|---|---|---|
| 1 | Technical documentation (architecture, core algorithms, security design) | R2 (editor) | R1 agent + algorithms (incl. advisor), R3 architecture + contract spec, R4 UX, R5 language edit | Oct 19, 20:00 draft; Oct 20, 12:00 final |
| 2 | Presentation deck (≤ 10 min) | R5 | R4 screenshots, R2 results slide | Oct 19, 20:00 draft; Oct 20, 14:00 final |
| 3 | Demo video (≤ 5 min) | R5 (script, narration) | R4 recording, R1 demo mode | Oct 20, 15:00 |
| 4 | Source code (README, GitHub link, deployment instructions, test cases) | R3 | all | Code freeze Oct 20, 12:00 |
| 5 | Security self-assessment (permission tiers, known-risk list incl. T21 to T27, contract not audited) | R2 | R1, R3 (contract tests), R5 edit | Oct 20, 12:00 |
| 6 | Execution evidence (sandbox logs + video + testnet transaction hashes with Basescan links) | R3 (log and hash export) | R5 packaging | Oct 20, 15:00 |
| | **Final submission email** | R5 | team leader reviews | **Oct 20, 18:00** (deadline 22:59) |

Registration (separate): form to fintechathon@ican-x.com, passport question CC info@ican-x.com. Owner: team leader. **Send by October 16.**

Organizer question (new, owner: team leader, **send October 16**): can Topic A entries earn the on-chain exploration bonus, and do testnet transaction hashes count as on-chain evidence? (PRD §25, question 4.)

---

## 4. Shared Interfaces (agree on Day 1)

These let the four coders work in parallel. Changing any of them after Day 1 requires the tech lead's approval and a message in the team chat.

| Interface | Owner | Consumers | Where |
|---|---|---|---|
| `TypedAction`, `GateResult`, `GateSnapshot`, `Labeled<T>` types | R2 | R1, R3, R4 | `src/core/types` |
| All table definitions and RLS (`actions`, `approvals`, `plans`, `audit_log`, ...) | R3 (R2 co-designs execution tables) | R1, R2, R4 | `supabase/migrations` |
| `SettlementAdapter` interface | R2 | R3 implements the mock bank adapter; only the executor calls it | `src/server/adapters/settlement` |
| `ActionExecutor.run(actionId, userId)` | R2 | R1 (`execute` node) | `src/server/executor` |
| `ModelClient` interface | R1 | R2 (eval runner) | `src/agent/models` |
| Mock bank scenario format | R3 | R2, R5 | `src/mockbank/scenarios` |
| Eval case format | R2 | R5 | `evals/cases` |
| Read repositories and summary/detector outputs | R1 | R1, R2, R3 (UI routes) | `src/server/db/read`, `src/core/detectors` |
| API response types and fixtures for UI | Route owner (R1, R2, R3 per Section 1.1); R4 reviews for UI needs | R4 | `src/server/api-types.ts`, `fixtures/api/` |
| Contract ABI, EIP-712 types, deployment addresses | R3 | R2, R1, R4 (browser signing) | `contracts/`, `src/server/chain/types.ts`, `contracts/deployments/base-sepolia.json` |
| `EscrowAdapter` interface | R2 (defines, like `SettlementAdapter`) | R3 implements chain and mock versions | `src/server/adapters/settlement/chain/` |
| `PrepaidFacts` and prepaid rule IDs | R2 | R1, R3 | `src/core/types` |
| Simulator API (offers, check-in, attestations, signals) | R3 | R4 (gym tablet), R5 (demo data), R2 (attack cases) | `src/sim/` |

Until a real implementation exists, each owner ships a stub with the agreed signature on Day 1, so nobody waits.

---

## 5. Day-by-Day Plan

The plan below restarts from Friday evening, October 16, with the prepaid module added. Items from the earlier plan that are not done yet move to Saturday morning; `tasks.md` tracks each item.

| Day | R1 Agent & Read Side | R2 Safety, Execution & Eval | R3 Platform, Data & Chain | R4 Frontend | R5 Finance & Product |
|---|---|---|---|---|---|
| **Fri Oct 16 (evening)** | Read PRD F19 and architecture §24; add prepaid read tools and `prepaid_exit` to the stubs; continue Friday items | Add `PrepaidFacts`, `prepaid.*` rule IDs and the DSL `prepaid` block to the shared types (stubs) | Generate the five chain keys; fund relayer, agent and deployer from the faucet; `contracts/` skeleton; continue foundations | Move design data to Lin and CNY; sketch Prepaid screen and buy sheet against fixtures | Team leader sends the organizer question; message friends in mainland China; Lin demo data v1 |
| **Sat Oct 17** | Reader + PDF upload; planner prompts; `persist_plan`, `gate_preview`, `await_approval`; FX; **advisor tool with tests**; Signal Reader subgraph | Gate steps 7 to 10, anomaly; executor A/B/C; approvals; audit log; **prepaid Gate rules with table tests; phase-A chain reads and signature recovery** | **Morning: contract, Foundry tests, spike → three hashes (gate G1 at 18:00)**; then mock bank adapter, scenarios, attack injection; checkpointer + pooler test; cron routes | Chat with streaming; approvals inbox; mandate editor; **Prepaid screen, advisor card, buy sheet with browser signing** (fixtures) | Mandate templates incl. Lin's; attack cases 19 to 26 in R2's format; prepaid evidence slide with sources; video script v1 |
| **Sun Oct 18** | **First end-to-end bill run** (with R2); detection, rec score, summary; routes live; `prepaid_risk` trigger and `prepaid_exit` capture | Approvals, feed, mandates, prepaid action routes live; concurrency and property tests (incl. prepaid narrowing); eval runner skeleton; **review the contract** | `EscrowAdapter`, indexer, simulators and gym-tablet page; wallet route; **prepaid end-to-end on testnet by 21:00** (or mock escrow if G1 failed) | Subscriptions + recs; feed "Why?" with transaction links; evidence v1; **check-in flow and exit cards** | Deck v1 with screenshots; Q&A list incl. chain and China; validation notes from friends |
| **Mon Oct 19** | Explainer incl. transaction templates; harness tests incl. Signal Reader canary; demo-mode recordings incl. prepaid; bug fixes | Eval arms A/B on ≥ 40 attacks incl. 19 to 26, three force-sent reverts; report; security self-assessment draft | Foundry invariant tests; README and deployment docs incl. contract; evidence export with hash list; support | E2E incl. prepaid flow; mobile polish; PWA manifest | **Dry run of the 10-min pitch at 19:00**; tech doc language edit |
| **Tue Oct 20** | **Code freeze 12:00.** Support recording | Final numbers into deck and report | Final deploy, tag `demo-*`; logs and hash export | Record demo video 12:00 to 15:00 | Final deck 14:00; package all six items; **submit 18:00** |

**Decision gate G1 (Saturday 18:00 WIB):** three confirmed Base Sepolia transaction hashes from the spike (purchase, redeem, attested exit), recorded in `docs/evidence/spike.md`. Pass: build the chain path. Fail: `REINS_ESCROW=mock`, keep the prepaid flow, drop on-chain claims.

**Cut order if behind schedule (v1.1):**
1. Soft-signal warnings: replace the Signal Reader with one static, labeled warning.
2. Trial auto-cancel (keep the rule in the DSL, skip the cron path).
3. Voluntary exit (keep the attested exit).
4. Recommendation scoring (show detected subscriptions without ranking).
5. Summary screen (merge numbers into Home).
6. If gate G1 failed: the chain path itself (mock escrow instead).
7. Never cut: bill payment with the blocked PDF attack, one-tap cancel with approval, **prepaid buy → check-in → attested exit** (on chain, or on the mock escrow), the Gate, the audit log, and the with/without-Gate numbers.

---

## 6. Working Agreements

- **Stand-up:** 10 minutes at 09:00 and 21:00 WIB in the team chat or a call: done, next, blocked.
- **Branches:** short-lived feature branches, PR into `main`, one reviewer. Owner of the touched interface must review interface changes.
- **Definition of done:** merged, deployed to preview, test exists, demo path not broken.
- **Integration rule:** `main` must always run the demo path end to end from Sunday onward.
- **Decisions:** the tech lead decides scope cuts after hearing the owner; Finance has a veto on any claim in the deck that is not backed by a source or a test result.
- **No silent blockers:** stuck for more than 60 minutes means post in chat.

### 6.1 Working with AI coding agents

Agents write fast and confidently. They do not know the Reins invariants unless told, and they will "helpfully" route around them (for example, calling the settlement adapter directly to make a test pass). These rules exist for that.

**Repo instructions file (Day 1, owner: tech lead).** One `AGENTS.md` at the repo root (with `CLAUDE.md` pointing to it, so Claude Code and Codex read the same rules). It contains:
- The guarantees G1 to G8 and harness invariants H1 to H9 in short form.
- Module import rules (`architecture.md` §5.1).
- "Never" list: never import a settlement adapter outside `src/server/executor`; never put work before `interrupt()` in the same node; never read approval status from a resume payload; never add an account-number parameter to a tool; never use `service_role` in request code; never weaken RLS; never change a shared interface (Section 4) without the owner; never edit migrations that are already applied (add a new one); never add an admin, upgrade, pause, sweep or recipient parameter to the escrow contract; never let the agent key call anything except `exitWithAttestation`; never send the consumer key to the server or log it; never read chain private keys outside their modules (architecture §5.1).
- Pinned package versions and links to the LangGraph.js docs, because agents often write code for older LangGraph/LangChain APIs (`createReactAgent`, old streaming).
- Commands: `pnpm test`, `pnpm lint`, how to run the local Supabase and the eval runner.

**Per-person rules:**
- One agent session per task, on its own branch (or git worktree). No two agents editing the same files at once.
- The human owner reads every diff before opening a PR. "The agent wrote it" is not a review.
- Agents must run `pnpm lint && pnpm test` before a PR; CI blocks merges if anything fails.
- Give agents the relevant section of `architecture.md` or the PRD as context instead of describing the task from memory.

**Second human reviewer required for these paths** (protect with CODEOWNERS):

| Path | Second reviewer |
|---|---|
| `src/core/gate/**`, `src/core/mandate/**` | R2 (if author is not R2) or R1 |
| `src/server/executor/**`, `src/server/approvals/**` | R3 (author is usually R2) |
| `supabase/migrations/**` (RLS, roles, functions) | R3 or R2 |
| `src/agent/nodes/execute.ts`, `await_approval.ts`, `reader/**` | R1 and R2 |
| `contracts/**` | R2 (author is usually R3), plus any Leash co-author |
| `src/server/adapters/settlement/chain/**`, `src/server/chain/**` | R2 |
| `src/sim/**` | R1 |
| `AGENTS.md` | tech lead |

**Finance with an agent:** R5 can write demo data, scenario JSON, and eval cases directly in `evals/cases/` and `supabase/seed/` through PRs (R2 or R3 reviews). R5 does not edit `src/**`. The deck can be drafted with an agent, but every number and claim on it is checked against a source or a test result before it ships.

**Watch for these agent mistakes (reviewers check them first):**
1. Tests changed to pass instead of code fixed (look for edited expectations, `.skip`, lowered thresholds).
2. New dependencies added without asking.
3. Secrets or real-looking personal data in seed files.
4. Invented API calls for LangGraph.js, Supabase, Vercel, viem, or OpenZeppelin that do not exist in the pinned version (OpenZeppelin 4 vs 5 differ in import paths and `ECDSA`/`Ownable` APIs).
5. Security logic quietly moved into prompts ("the model is instructed not to...") instead of code.

---

## 7. Coverage and Backups

Each critical area has a named backup so a sick day does not stop the team.

| Area | Primary | Backup |
|---|---|---|
| Agent graph, read side, detectors | R1 | R2 |
| Gate, executor, approvals, evals | R2 | R1 (evals), R3 (executor) |
| Database, mock bank, cron, deploy | R3 | R2 |
| Contract, chain adapter, simulators | R3 | Leash co-author if on the team, otherwise R2 |
| UI | R4 | R1 (with agent help) |
| Deck, video, submission | R5 | R4 |
| Registration and organizer emails | Team leader | R5 |

---

## 8. Finals (if selected)

- Finalists are announced by October 31; finals are November 21 to 23 in Shenzhen. At least one member must attend in person; the number of invited members per team is stated in the invitation.
- **Presenters:** R5 (story, business, impact) and one engineer (live demo and technical Q&A), ideally R2 because the security results are the strongest argument.
- Everyone traveling needs a valid passport. The member whose passport arrives on October 21 is fine for the finals timeline but should start visa preparation as soon as it arrives.
- The finals may include an on-site 48-hour hackathon (PRD §21.2, week 6). Whoever attends should include at least one coder.

---

## 9. Names

| Role | Person |
|---|---|
| R1 AI Engineer: Agent and Read Side | [name] |
| R2 AI Engineer: Safety, Execution and Evaluation | [name] |
| R3 Backend Engineer: Platform and Data | [name] |
| R4 Frontend and UI/UX | [name] |
| R5 Finance and Product | [name] |
| Tech lead / integrator | [name] |
| Contract owner (R3 by default) and spike runner (Leash co-author if any) | [name] |
| Team leader (registration, organizer contact) | [name] |
| Submission owner | [R5 name] |
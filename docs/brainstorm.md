# Reins (formerly "Mandate"): Brainstorm Notes

> **FinTechathon 2026, International Track ("AI as a Financial Participant"), Topic A: Personal Finance Assistant**
> Compiled: October 14, 2026
> Status: idea locked, engineering direction agreed, detailed timeline deferred (see Section 18)
> Name changed from "Mandate" to **Reins** on October 14 (see Section 0.5). "Mandate" remains the name of the signed rule set inside the product.

---

## 0. TL;DR

- **What it is:** Reins is an AI finance agent that pays bills and manages subscriptions on its own, but only inside a signed, versioned set of money rules (the *mandate*). Those rules are enforced by deterministic code (the *Policy Gate*), never by the LLM.
- **Framing:** the problem is universal (people won't trust an AI with money it can't be bounded on); **Indonesia is the launch market**, **China the second market** (Section 0.5).
- **One-line positioning:**
  - vs FinAgent (2025 third prize): *"FinAgent tells you what you should do. Reins does it for you, and can prove it never goes past your limits."*
  - vs Rocket Money: *"Rocket Money uses humans to cancel subscriptions on your behalf. Reins does it itself, but only inside rules you signed, and it can prove it."*
- **Core engineering bets (where we go deep):**
  1. An untrusted-data boundary with provenance labels on every value.
  2. A policy engine with formal guarantees (safe narrowing, ambiguity detection).
  3. An evaluation harness with a with/without-Gate comparison and honest statistics.
- **Platform:** responsive web app first (desktop and mobile, installable as a PWA). Native mobile only if a go/no-go check on Saturday, October 17 passes.
- **Foundation:** builds on our earlier project **Leash** (NTU InnovateX Hackathon 2026). Reuse is fine but must be disclosed, and co-authors must agree.

---

## 0.5 Name and Framing Decisions (October 14)

### Name: **Reins** (formerly "Mandate")

- **Meaning:** "you hold the reins": the user stays in control, the agent does the work. Echoes Leash, but more positive.
- **"Mandate" stays as a concept:** the signed, versioned rule set inside the product is still called the *mandate* (AP2 uses the same term). Feature names like Mandate Card and mandate compiler remain.
- **Conflict check:** a quick web search found no finance app named "Reins". Not exhaustive: still check Play Store, App Store, domains, GitHub, and PDKI (DJKI) trademarks.
- **Small note:** in insurance, "reins." is a common abbreviation for *reinsurance*. Not a real problem, but have an answer ready.

**Other candidates considered:**

| Name | Meaning | Verdict |
|---|---|---|
| Titip | Indonesian "entrust" ("titip bayarin listrik ya") | Best story, but Indonesians may associate it with *jastip* (personal shopping services) |
| Tali | Rope, bond (continuity with Leash) | Good link to Leash, less self-explanatory |
| Kuasa | From *surat kuasa* (power of attorney) | Conceptually exact, but sounds controlling |
| Saku / Jaga | Pocket money / to guard | Friendly or security-flavored, but generic |
| Clause | Every action cites a clause | Dry |
| Covenant | Loan-agreement restrictions | Very "finance", but heavy and slightly religious |
| Envoy / Proxy | Someone acting on your behalf | Fits "agent", weak on "money" |
| **Avoid** | Cleo, Copilot, Albert, Tally, Penny, Tether, Ledger | Already used by finance products (as far as we know) |

### Framing: universal problem, Indonesian launch market

- **Risk:** opening with "young Indonesians..." makes the product sound local; a judge could say "then join an Indonesian hackathon".
- **Decision:** lead with the **trust gap in agentic finance** (universal, and the core question of the theme "AI as a Financial Participant"). Recurring obligations are the first job worth delegating. **Indonesia is the launch market; China is the second market**, demonstrated through the CSV adapter and the Shenzhen-aligned H-5 renewal rule.
- **Why Indonesia first:** we are the users (real validation), and fragmented data is the hardest case; if it works here, it works where aggregation is easy.
- **Prepared answer:**
  > "The problem isn't Indonesian. Trusting an AI with your money is universal. What's local is only where the data comes from. We started in Indonesia because we are the users and can validate with real people, and because fragmented data is the hardest case. The same core runs unchanged on Chinese payment data, and our default 5-day renewal reminder matches Shenzhen's guideline."
- The PRD (`PRD_Reins_v1.2.md`) Summary and Problem sections were rewritten with this framing; persona Lin moved from "secondary" to "second market".

### Scope decisions (October 14, evening)

- **Bill payment kept** in the hackathon cut (it carries the strongest security demo: the hidden-text PDF attack).
- **Cancellation:** one-tap approval by default, plus an optional mandate rule that **auto-cancels free trials before they convert** (trial status from trusted sources only, 3-day notice with "keep it"). Reason: cancelling paid services can lose promos, data, or annual discounts; a trial about to convert is the one near-risk-free case, and it shows T3 and T2 side by side in the demo.
- **Team build list merged into the PRD (v1.1):** financial summary promoted to P0; multi-currency subscriptions with FX-normalized detection and IDR equivalents; usage signals (simulated in sandbox, self-report later, real APIs only P2); interpretable cancel-recommendation scoring with cited signals; business model and impact section.
- **Agenda duplicates merged:** "fetch subscriptions" = "how we know the user's subscriptions"; "check usage" = "which subscriptions are rarely used".

### Harness decision (October 15)

- **LangGraph.js** (explicit `StateGraph`) inside Next.js route handlers, Postgres checkpointer on Supabase (schema `langgraph`). Two team members already know LangGraph, so the learning-cost objection does not apply.
- Python LangGraph service rejected: duplicated Gate or a network hop per Gate call, service-to-service auth, a second holder of DB credentials.
- Security stays outside the framework: read-only tools bound to the Planner; side-effecting calls persisted as `actions` rows; one `execute` node calls the Gate and verifies approval tokens in Postgres; `interrupt()` alone in its node (nodes restart from the top on resume).
- Fallbacks: plain Anthropic SDK loop; Vercel AI SDK 7 (`toolApproval`) considered for R1+.
- Details in PRD v1.2, Section 11.6.
- Deadline settled from the rules: registration and submission both close October 20, 23:59 Beijing (22:59 WIB). Questions to info@ican-x.com; registration to fintechathon@ican-x.com.

---

## 1. Competition Context

### 1.1 Rules that matter (from the official International Track rules document)

| Item | Detail |
|---|---|
| Theme | "AI as a Financial Participant": build an AI agent that completes real tasks in a financial scenario |
| Our topic | **Topic A, Personal Finance Assistant**: smart budgeting, bill analysis, spending insights, actionable recommendations |
| Scoring | Task completion **40%**, Security & compliance **30%**, Innovation & interaction **30%**, on-chain challenge bonus **0 to 5 points** (listed under Topic F; unclear whether other topics can earn it) |
| Deadline | **October 20, 2026, 23:59 Beijing time = 22:59 WIB**. Submissions can be updated until the deadline; the latest version counts |
| Team | 2 to 5 full-time students at universities outside China; at least 60% non-Chinese nationals; one team per person |
| Language | English for everything |
| Review | Online review late October; finalists announced by October 31 |
| Finals | November 21 to 23, Shenzhen; at least one member in person; travel and lodging covered for invited finalists |
| Prizes (International) | RMB 250,000 total: 1st 100k, 2nd 80k, 3rd 50k, Best Innovation 20k, several Excellence Awards; fast-track WeBank interviews |
| IP | Work must be our own; third-party code/data must be properly licensed; IP stays with contestants |

**Submission checklist (required):**
1. Technical documentation (system architecture, core algorithm description, security design)
2. Presentation deck (final presentation no longer than 10 minutes)
3. Demo video (optional, no longer than 5 minutes)
4. Source code (GitHub link, README, deployment instructions, test cases)
5. Security self-assessment report (**permission-tier implementation** and **known-risk list**)
6. Execution evidence (for non-on-chain topics: **simulated-account/sandbox operation logs** and demo video)

### 1.2 Unconfirmed or conflicting information (from a 2026 news article, iFeng)

- **Deadline conflict:** the article says registration runs until **November 1** with blind review November 2 to 10. Our rules doc says **October 20**. It may describe the domestic track. **Plan for October 20** and ask the organizers.
- **Finals format:** the article says finals include a **48-hour on-site hackathon** to improve the project, followed by pitch and defense (the 2022 edition used 36 hours). Whoever travels must know the whole codebase.
- **Domestic track requirements** (a strong hint at what judges probe): tiered permission controls, hallucination and prompt-injection defenses, intent understanding and task planning.
- Total 2026 prize pool reported as RMB 750,000 (consistent with RMB 250,000 for International).

### 1.3 What past winners looked like (2025 edition)

| Project | Track / prize | What it was |
|---|---|---|
| **Ling Caopan (灵操盘)** | AI track, 1st prize | Zero-code quant trading engine: natural-language investment ideas become backtestable, executable strategies. Finance LLM plus multi-agent architecture, A-share knowledge graph, hallucination filtering. Built by 4 PhD students at HKUST (Guangzhou), advised by their dean. An **earlier version won silver at a 2023 competition**, and the team reports pilots with securities firms (self-reported by their university). |
| AML mixture-of-experts ensemble | Data Analytics track, 1st prize | Scalable mixture-of-experts ensemble for anti-money-laundering detection; targets high false positives and cost. |
| **FinAgent** | AI track, 3rd prize | Personal finance agent by **two undergraduates** (3rd and 2nd year). Builds a user profile from bill data, then gives spending guidance and investment suggestions. Multi-agent architecture. **Used WeBank-provided user data**; teachers steered them to an "accounting management system" problem statement. Output stops at advice, no execution, no mentioned security layer. |

2025 scale: 1,709 students, 372 teams, 270 universities; RMB 500,000 total; first prize RMB 100,000.

Careful: "FinAgent" is also the name of a well-known trading-agent paper (KDD 2024) and several repos. Not the same project.

### 1.4 Lessons we took

- Champions were **complete systems with trust mechanisms**, not chat wrappers.
- A consumer-facing personal finance agent **can place** (FinAgent).
- Building on prior work is normal (Ling Caopan had a 2023 version), as long as it is disclosed.
- Winners stressed **"product landing"** over pure algorithms. Real user evidence matters.
- **Multi-agent alone is not a differentiator**: both 2025 AI-track prize winners already used it.
- Organizers supplied data in 2025, so **ask whether they provide data or a sandbox in 2026**.

---

## 2. The Idea

### 2.1 Problem

Young Indonesians (students on allowances and new workers) typically have 6 to 12 recurring obligations: boarding house rent (kos), PLN electricity tokens, mobile data, BPJS, paylater installments, and 3 to 5 subscriptions. Three recurring failures:

1. **Late payments** lead to fines.
2. **Subscriptions quietly pile up** (forgotten trials, duplicates, price increases).
3. **"I know my budget but I don't follow it."**

Existing apps (Money Lover, Spendee, bank PFM menus) only **record and display**. They do not act. On the other hand, a fully autonomous agent is **too scary to trust with money**.

### 2.2 Concept

1. The user writes money rules once, in plain language. Example: *"Bills under Rp500k pay automatically; ask me first for subscriptions; never transfer to a new recipient."*
2. The rules are compiled into a **structured, versioned, user-signed mandate**.
3. The agent runs the user's finances in a **mock bank (sandbox)**.
4. **Every action passes the Policy Gate**, plain code, not an LLM, which returns `allow`, `require_confirm`, or `deny`, plus the rule that decided it.
5. Every action is logged in a **hash-chained audit log** and cites the clause that allowed it, e.g. *"Paid PLN Rp312,500 under §bills.auto_pay v7."*

### 2.3 Positioning

| Compared with | Their limit | Reins' difference |
|---|---|---|
| PFM apps (Money Lover, Spendee, bank menus) | Show charts, never act | Executes: pays, cancels, with limits |
| FinAgent (2025 3rd prize) | Stops at advice | Delegated execution with provable limits; measurable security |
| Rocket Money (US) | Tracks via bank linking; cancels and negotiates via **human concierge**; trust the company | Agent acts itself inside **user-signed rules**; evidence for every action; Indonesian context |
| Research (Progent, CaMeL) | Tested on general agent benchmarks | Applies symbolic privilege policies with a natural-language mandate editor to consumer finance |

Note: the claim "no one has applied Progent-style policies to consumer finance with a natural-language mandate editor" is **unverified**. Also cite **AP2** (Google's Agent Payments Protocol), which already uses the word "mandate" for agent spending authority, as related work, or a judge will raise it.

### 2.4 Why Rocket Money helps our pitch

Rocket Money proves that people pay to have subscriptions and bills handled for them. In the US, Plaid gives near-universal bank and card coverage. In Indonesia, data is fragmented (banks, e-wallets, app stores, mobile credit), so a multi-source approach is required. Saying this shows we understand the market.

---

## 3. What the Agent Does

The agent **manages the user's recurring money obligations proactively**. It acts on its own inside the mandate and asks for permission outside it. The difference from a chatbot: it reacts to **events** (a new bill arrives, payday, H-3 before a due date) without being asked.

### 3.1 Tasks

1. **Collect bills.** The Reader parses bill PDFs or emails. The agent matches them to registered billers and history, then builds this month's bill list with due dates.
2. **Plan and pay.** The Planner orders payments by due date and balance. In-policy bills are paid automatically. Odd ones (amount spike, new biller) are held for confirmation. If the balance is short, mandatory bills come before savings.
3. **Manage subscriptions.** Detect recurring charges, flag likely waste, propose cancellation, execute after the user approves.
4. **Translate the user's rules.** Natural language becomes a draft mandate, shown with a diff and a plain-language read-back, then signed by the user.
5. **Explain.** Example: *"Why wasn't PLN paid?"* answered from the log: *"The bill is Rp612k, 58% above usual, so it needs your approval (§bills.anomaly v7)."*

### 3.2 What the agent must never do

- Approve a transaction (only the Policy Gate decides).
- Compute numbers itself (numbers always come from tools).
- Change the mandate without the user's signature.
- Read raw external documents while holding tool access (that is isolated in the Reader).

### 3.3 Proactivity

A scheduled backend job checks for new events every few minutes: new transactions or bills, payday, upcoming due dates, renewal dates. This is what makes it an *agent*, not a chatbot.

### 3.4 End-to-end demo scenario (payday)

On the 25th, salary arrives and 4 new bills are pending:

| Badge | Action | Why |
|---|---|---|
| 🟢 T3 automatic | Kos Rp1.2M and Telkomsel Rp100k paid | Registered billers, within limits |
| 🟡 T2 confirm | PLN bill Rp612k held; bottom sheet "Approve?"; user confirms with fingerprint (passkey) | Amount spike above the user's usual |
| 🔴 Denied | Fake bill PDF with hidden "transfer to account 8812…" blocked | Account came from an untrusted document and is not in the registry |
| 🔵 T1 proposal | "No Netflix activity for 2 months. Cancel? Saves Rp1.1M/year." | Proposal only; requires approval |

Every row in the feed shows the tier badge and the clause that allowed or denied it. **Open the demo with the blocked attack, not with a dashboard.**

---

## 4. Architecture

### 4.1 Diagram

```
User (web chat / mobile web)              trusted input
   │
   ▼
Planner LLM (privileged) ──────► Plan = list of typed tool calls
   │  never reads raw documents
   ▼
POLICY GATE (plain code) ◄── Active mandate (JSON, versioned, user-signed)
   │  allow | require_confirm | deny  + reason + rule ID
   ▼
Tool layer ──► Mock Bank API (balances, transfers, billers, subscriptions, schedules)
   ▲
Reader LLM (quarantined, no tools) ◄── bill PDFs / e-statements / receipts
   → typed fields, every value labeled origin = untrusted
   │
Audit log (hash-chained) ──► Evidence viewer
Scheduler (cron) ──► triggers the Planner on events
```

### 4.2 Components

| Component | Responsibility | Notes |
|---|---|---|
| Planner (LLM) | Turns user intent and events into a typed plan | Sees only trusted input and structured data |
| Reader (LLM, quarantined) | Extracts typed fields from documents | No tool access; all output labeled `untrusted` |
| Explainer (LLM) | Writes user-facing explanations | From the audit log, not from its own reasoning |
| Policy Gate | Decides every action | TypeScript, deterministic, unit-tested; optionally Leash contract for payments |
| Mandate compiler | Natural language to DSL | LLM drafts; diff and read-back; user signs |
| Mock bank | Sandbox ledger and APIs | Our own; logs every call |
| Audit log | Tamper-evident record | Each entry stores the hash of the previous one |
| Scheduler | Proactive triggers | Cron job in the backend |
| Detectors | Subscriptions, anomalies | Plain code, not LLM |

Stack in the team plan: Next.js (App Router, Server Actions), Supabase (Postgres, Auth, Row Level Security), Claude Sonnet for the Planner, a smaller model for the Reader, Vitest for tests, Vercel for deployment.

### 4.3 Multi-agent: role separation, not a swarm

We considered an "agent swarm" (many autonomous agents talking to each other) and rejected it:

- **More attack surface:** every agent-to-agent message is a new prompt-injection path; hidden text in a bill PDF can propagate.
- **More fragile:** CNFinBench found a **15.4-point** performance drop from single modules to full execution chains. Longer chains fail more, and task completion is 40% of the score.
- **Harder to test and demo:** more LLM calls mean non-determinism, latency and cost; demos stop being repeatable.
- **Not a differentiator:** 2025 prize winners already used multi-agent.

Instead: **small multi-agent with privilege separation.** Each role is also a security boundary (Planner, Reader, Explainer; the Gate is code). This is the Dual LLM / Plan-Then-Execute pattern from CaMeL and the Design Patterns paper, so "multi-agent architecture" is accurate and defensible.

### 4.4 Example mandate (DSL)

```yaml
version: 7
payees:        { allow: [PLN, TELKOMSEL, KOS_BU_SRI, BPJS], new_payee: deny }
bills:         { auto_pay_max: 500000, anomaly: { method: median_mad, k: 3, min_history: 3 } }
subscriptions: { cancel: confirm, subscribe: deny, renewal_notice_days: 5 }
savings_sweep: { on: payday+1, pct: 20, keep_buffer_for_bills: true }   # stretch
global:        { daily_outflow_cap: 1000000 }
```

(`renewal_notice_days: 5` mirrors the Shenzhen auto-renewal guideline; see Section 9.4.)

### 4.5 Permission tiers

| Tier | Examples | Enforcement |
|---|---|---|
| T0 Read | Balances, insights | Free |
| T1 Suggest | Budget plans, drafts, cancellation proposals | No side effects |
| T2 Execute with confirmation | Payee outside auto-pay rules, cancel subscription, anomalous bill | Confirmation card built from the **tool-call arguments**, never from LLM text; passkey approval |
| T3 Autonomous within limits | Registered biller under limit | Daily cap; undo window where possible |
| Kill switch | Freeze the agent | One click, immediate |

### 4.6 Threat model (team plan, with our corrections)

| # | Threat | Example | Control | Note |
|---|---|---|---|---|
| T1 | Indirect prompt injection | Hidden text in a bill PDF or email | Quarantined Reader; provenance labels; untrusted values cannot add payees or supply account numbers | Strengthened by Section 6.1 item 4 |
| T2 | Multi-turn escalation | "Just this once, raise my limit" | Widening requires re-auth (passkey); LLM cannot edit the mandate | |
| T3 | Mandate mis-compiled | NL to DSL error | Diff, read-back, strict schema, **ambiguity detection** | Main product risk |
| T4 | Parser misreads amount | OCR or extraction error | Schema validation; robust anomaly check | Use median/MAD, not a 3-month average |
| T5 | Hallucinated numbers | LLM does arithmetic | All numbers from tools | |
| T6 | PII leaks to a cloud LLM | Account number or NIK in a prompt | Tokenize before sending | Cloud LLM means data leaves Indonesia; check UU PDP cross-border rules |
| T7 | Replay / double execution | Network retry | Idempotency key per action | |
| T8 | Race on caps | Two parallel payments both pass the cap check | Atomic check-and-debit (DB transaction with row lock) | Added by us |
| T9 | Approval reuse | Approval for action A used for action B | Approval token bound to exact action arguments, with expiry | Added by us |
| T10 | Mandate changes mid-flight | Plan approved under v7, user narrows to v8 | Re-check at execution against the active version; log version and hash | Added by us |

**Residual-risk ratings must be backed by red-team numbers, not asserted.**

---

## 5. Relationship to Leash

### 5.1 What Leash is

- Built for **NTU InnovateX Hackathon 2026** (Track 2: Web3 Applications, AI Agents and Real-World Use Cases). Last commit August 15, 2026.
- Tagline: *"We do not put money on-chain. We put spending authority on-chain."*
- A user registers an on-chain mandate (`LeashMandate.sol`, Base Sepolia) with: session key, target allowlist, **cumulative** spending cap, expiry, one-way revocation.
- Agent payment requests must pass `authorizePayment`. Valid requests emit `AuthorizationGranted`; invalid ones revert with `TargetNotAllowed`, `AmountExceedsCap`, `Revoked`, `Expired`, and so on.
- The LLM only turns chat into structured intents; it never approves.
- Components: Solidity contract with **26 Foundry tests**, TypeScript agent CLI, Next.js web app, backend listener on confirmed blocks, idempotent mock BaaS settlement, grammY Telegram bot, demo runner, docs (architecture, risks and limitations, verification, demo script, deck).
- Its README is honest that **it does not solve prompt injection**, it only contains the blast radius.

### 5.2 Overlap, and what Reins adds

| Same as Leash | New in Reins |
|---|---|
| User-approved mandate (allowlist, cap, expiry, revocation) | Natural-language rules compiled to a mandate, **versioned with diffs** (Leash mandates are immutable, only revocable) |
| Enforcement outside the LLM | **Monotonic updates**: narrowing applies immediately, widening needs re-auth |
| LLM produces intents only | **Richer rules**: per-category behavior, anomaly confirmation, subscription policy (Leash has one cap and one target list) |
| Mock settlement | **Prevention**, not just containment: quarantined Reader plus provenance labels |
| Refusal-driven demo | A real consumer job: bills and subscriptions |

### 5.3 Reuse plan

- Reuse architecture, docs structure and possibly code.
- Option: use the Leash contract as the **enforcement point for payments** (authority on-chain, fiat settles off-chain through the mock bank). Far more meaningful than anchoring a hash. Only if the team knows the code well; otherwise a plain-code Gate.
- Natural extension: a `narrowMandate` function that only allows a lower cap, fewer targets or an earlier expiry, covered by Foundry tests. Then "narrowing is safe" is enforced on-chain.
- "Authority on-chain, money off-chain" is the compliance-friendly framing for Indonesia.

### 5.4 IP and disclosure

- State in the docs that Reins builds on Leash (NTU InnovateX 2026).
- **The Leash repo has no license file**, so all authors (Fachry Alfareeza, hendrakurnia, NandadnaN Majid) co-own the code. If any are not on this team, get their consent before reusing code.
- Check whether NTU InnovateX rules claim rights to entries.

### 5.5 Why Topic A, not Topic F

Topic F wants an agent that executes on-chain operations and moves assets. That contradicts Leash's "no money on-chain" principle. Topic A fits better.

---

## 6. Engineering Priorities

### 6.1 Must-fix holes

1. **Who holds the signing key?** If the server signs mandates, the signature is theater. Use a **user-held key**: a passkey (WebAuthn) or a wallet as in Leash. The Gate verifies the signature of each mandate version before using it.
2. **Race on `daily_outflow_cap`.** Do the cap check and the debit in **one Postgres transaction with a row lock**. (The Leash contract is already atomic: `spentAmount += amount` in the same transaction.)
3. **Mandate version changes mid-flight.** Re-check every action against the version active at execution time. Log the mandate version and hash used.
4. **Payee identity binding (highest value).** A PDF can say "PLN" while listing the attacker's account number. **Account numbers must only come from the trusted biller registry, never from a document.** Implement provenance labels:
   ```ts
   type Origin = "user" | "registry" | "mock_bank" | "document";
   type Labeled<T> = { value: T; origin: Origin; sourceId?: string };
   ```
   Gate rules (examples):
   - `payee.account.origin` must be `registry`, otherwise **deny**.
   - `amount.origin === "document"` is allowed only if the biller is registered, the amount is within `auto_pay_max`, and it passes the anomaly check; otherwise **require_confirm**.
   - Any value from `document` can never create a payee or widen a mandate.
   - The explanation must state why: *"This account comes from the PDF and is not in your payee list."*
5. **Fragile anomaly rule.** Replace "X% above the 3-month average" with per-biller **median and MAD**; if history has fewer than `min_history` bills, always confirm (details in Section 7).

### 6.2 Differentiators

6. **Ambiguity detection in the compiler.** Compile the same rule several times (or from paraphrases). If the resulting policies are not equivalent (subset check in both directions), the rule is ambiguous: **fail closed** to the narrowest reading and ask the user to clarify. Example: "under Rp500k", per bill or per month? Always show a plain-language read-back before signing.
7. **Comparative experiment (strongest evidence).** Run the same attack suite against the same agent **without the Gate** and **with the Gate**. Add a benign-task suite to measure false blocks. Report the 95% upper bound instead of "100% blocked" (Section 7.4). Report the security vs utility trade-off honestly (CaMeL reports 77% task success with provable security vs 84% undefended).
8. **If time allows:** use the Leash contract for payment enforcement plus `narrowMandate` (Section 5.3).

Plus: an **approval token bound to exact arguments** (`{approvalId, actionHash = sha256(tool + canonical args), mandateVersion, expiresAt, userSig}`), so an approval cannot be reused for a different action.

### 6.3 What not to engineer

- More agents / swarm.
- ML models for subscription detection (simple rules work and are testable).
- On-chain extras beyond `narrowMandate` (no Merkle anchoring).
- Budget reallocation as an LP (valid, adds little).
- UI polish beyond clarity.

If forced to pick two: **item 4** (closes the attack judges are most likely to try) and **item 7** (gives numbers).

---

## 7. Where Math Helps (and Where It Is Decoration)

### 7.1 Bill-spike threshold

**Option A, robust z-score (default):**
`z = |x − median| / (1.4826 · MAD)`; require confirmation if `z > k` (e.g., k = 3) or if history has fewer than `min_history` bills.

**Option B, conformal threshold (when history is long enough):**
- `m` = median of past bills; scores `s_i = |x_i − m|`.
- `q` = the ⌈(n+1)(1−α)⌉-th smallest score.
- Auto-pay if `|x_new − m| ≤ q`, otherwise ask.
- **Guarantee:** a normal bill interrupts the user with probability at most α (marginal). So α becomes a user-facing **"interruption budget"** on the Mandate Card.
- **Limits:** α = 0.1 needs n ≥ 9 past bills; α = 0.2 needs n ≥ 4; otherwise the interval is infinite (always ask). Trends and seasonality break exchangeability, so detrend or use a recent window.

### 7.2 Safe narrowing as a partial order

- A mandate `p` defines an allowed action set `A(p)`. Narrowing means `A(p′) ⊆ A(p)`.
- Field-wise: caps `≤`, allowlists `⊆`, categories `⊆`, expiry earlier or equal, and for every action the decision is no more permissive (`deny < confirm < allow`).
- **Property-based tests** (fast-check in TS, or Hypothesis in Python): for thousands of random policy pairs and actions, if `p′` narrows `p`, then `rank(gate(p′, a)) ≤ rank(gate(p, a))`.
- If rules become logical conditions, encode as formulas and check `φ_p′ ∧ ¬φ_p` is unsatisfiable with an SMT solver (Z3), as Progent does. Start field-wise; move to Z3 only if needed.
- **Equivalence** (for ambiguity detection) = narrowing in both directions.

### 7.3 Worst-case "blast radius"

Compute from the mandate the maximum possible loss per day if the agent is fully hijacked:
`min(daily_outflow_cap, Σ over allowlisted payees of auto-pay cap × max auto-pays per day)`, only to allowlisted payees.
Show it on the Mandate Card: *"Worst case: Rp X per day, only to these payees."* A few lines of arithmetic that turn a vague claim into a checkable number.

### 7.4 Honest red-team statistics

With zero successful attacks in n trials, the 95% upper bound on the attack success rate is `1 − 0.05^(1/n)`:
- n = 20 → **13.9%**
- n = 40 → **7.2%**

Use Clopper-Pearson intervals in general. Put the attacks we know can still work in the known-risk list.

### 7.5 Detection quality

Measure subscription-detector **precision and recall** against user confirmations ("yes, this is a subscription" / "no").

### 7.6 Where math would be decoration

- Budget reallocation LP.
- The NL compiler, Dual LLM design and PDF parsing (engineering, not formulas).
- "Unused subscription" detection without usage data (no formula fixes missing data).

**Priority if time is tight:** 7.3 and 7.4 first (a few hours), then 7.1 (about half a day), then 7.2.

---

## 8. Sandbox, APIs, and Real Payments

### 8.1 Mock bank (we build it)

Why our own instead of a real sandbox:
- Real Indonesian bank / open-finance sandboxes usually need business registration and approval; not feasible in days.
- Payment-gateway test modes are built for merchants receiving money, not for one person's bills.
- We need **full control** to inject attacks and replay identical scenarios.
- The rules accept "simulated-account/sandbox operation logs" as execution evidence.

Build (about a day for one coder):
- Small service (Next.js route handlers or FastAPI) on Postgres/SQLite.
- Endpoints: accounts and balances, transactions, payees, bills (with PDF attachments), subscriptions, transfers/payments, cancel-subscription.
- Every call logged; the log is our execution evidence.
- Written as an **OpenAPI spec**, so we can honestly say "swapping in a real bank means replacing one adapter."
- Optional realism: copy field names from **Bank Indonesia's SNAP** open API standard (verify the spec; from memory).

### 8.2 Tool calling vs MCP

- **Plain function calling** that wraps the mock bank REST API is faster to build and debug.
- MCP is a standard way to expose tools ("any agent can plug in"), but adds a layer.
- If we use MCP: **the Policy Gate must live inside the tool handler**, so no path bypasses it.

Tools: `list_transactions`, `list_subscriptions`, `list_bills`, `propose_action`, `pay_bill`, `cancel_subscription(subscription_id, approval_id)`. Detectors run as backend jobs, not as agent tools.

### 8.3 Can the agent pay with real money?

Technically yes, but not for this competition:
- **Access:** no Indonesian bank API lets an individual pay bills from a personal account. SNAP is for institutions. Payment gateways (e.g., Xendit, Midtrans) have payout and bill-payment APIs, but live money movement typically needs business verification (PT/CV).
- **Licensing:** paying on behalf of others as a service falls under payment service provider licensing by Bank Indonesia.
- **Crypto route:** as far as we know, Bank Indonesia prohibits crypto as a payment instrument, so stablecoin bill payment is not relevant (verify current rules).
- **Irreversible errors:** an LLM misreading an amount means real losses; not worth it in front of judges.
- **No extra points:** the rules ask for sandbox evidence for non-on-chain topics.

### 8.4 Middle ground: "real API, fake money"

- Register for a payment gateway's **test mode** (usually available before business verification; check first) and use it as the settlement adapter behind the Policy Gate.
- Pitch line: *"For production, swap test keys for live keys once licensing and verification are done."*
- About half a day to a day for one coder; only after the mock bank works.
- Production path: partner with a licensed payment provider that moves the money; Reins/Leash is the authorization and limits layer. That is Leash's core message: **separate authority from settlement**.

---

## 9. Subscription Detection and Management

### 9.1 Hackathon version (sandbox)

**Detector: plain code, not an LLM.** Group transactions by normalized merchant; a merchant is recurring if there are at least 3 charges with gaps near 7, 30 or 365 days (±3 days) and a stable amount.

```ts
function isRecurring(txs: Tx[]): Cycle | null {
  if (txs.length < 3) return null;
  const gaps = txs.slice(1).map((t, i) => daysBetween(txs[i].date, t.date));
  for (const cycle of [7, 30, 365]) {
    const okGap = gaps.every(g => Math.abs(g - cycle) <= 3);
    const amts = txs.map(t => t.amount);
    const okAmt = (Math.max(...amts) - Math.min(...amts)) / median(amts) <= 0.1;
    if (okGap && okAmt) return cycle;
  }
  return null;
}
```

Deterministic, unit-testable, cannot hallucinate.

**"Unused" must be handled honestly.** Bank transactions cannot tell us whether Netflix is watched. The agent must not claim it. What *is* detectable from transactions:
- **Duplicate subscriptions** in the same category (Spotify and YouTube Music).
- **Price increases** versus previous months.
- **Free trials that converted to paid.**
- **Small forgotten recurring charges.**

Otherwise the agent asks: *"Still using Spotify? Rp55k/month = Rp660k/year."* In the sandbox we may add simulated usage signals from mock merchants, **stated as simulated** in the docs.

**Execution flow:**
1. Scheduled job ingests new transactions; the detector finds subscriptions.
2. Planner creates a **T1 proposal**; savings computed by a tool (amount × cycles per year).
3. User approves via bottom sheet with passkey; the server issues an **approval token bound to the exact arguments** (`subscription_id`, merchant, amount) with an expiry.
4. Agent calls `cancel_subscription(subscription_id, approval_id)`. The Gate checks the mandate (`subscriptions.cancel: confirm`) and the token; the mock bank executes (`status = cancelled`, future charges stop).
5. Everything logged; the Explainer shows the result.

**Production gap to state in the pitch:** in the sandbox cancellation is one API call. In reality every merchant differs (probably why Rocket Money uses humans).

**Also copy from Rocket Money:** the **Active/Inactive** rule (no payment detected in the last month moves an item to Inactive; a new payment moves it back).

### 9.2 Real-world version (if we had about 2 months)

The algorithm stays the same. The hard part is **where the data comes from**, because Indonesia has no single complete source.

**Data sources, most realistic first:**

1. **Subscription receipt emails (best signal).** Netflix, Spotify, Google Play, Apple, Canva send emails with plan, price, renewal date, trial end.
   - *Forwarding address:* users forward receipts to an app address. No Google approval needed.
   - *Gmail API:* smoother, but as far as we know email-reading scopes are "restricted": testing mode is limited to about 100 users, and production needs a Google security assessment (time and cost). Fine for a 2-month pilot.
2. **Bank e-statement upload (PDF).** Works for any bank, no partnership; data lags a month; per-bank parsers; PDFs are often password-protected.
3. **Open finance aggregators.** Consented account linking to read transaction history. Names to check: **Brick, Brankas, Ayoconnect, Finverse** (verify which still operate and which banks they cover). Business onboarding takes weeks, so contact them in week 1.
4. **Android notification listener.** Reads push notifications from m-banking and e-wallets (GoPay, OVO, DANA) in real time; the only way to catch e-wallet charges. Sensitive permission, heavily policed by Play Store policy, impossible on iOS. Good for an APK pilot.

**Avoid:**
- **Reading SMS:** Play Store restricts this permission to default SMS apps.
- **Scraping internet banking:** violates bank terms and endangers users.

**Indonesia-specific gap:** many subscriptions are paid via Google Play / App Store, e-wallets, or mobile credit (pulsa). In bank statements they appear as mixed "GOOGLE *…" lines or not at all. Email and notifications fill the gaps.

**Pipeline:**
1. **Merchant normalization:** raw descriptors ("NETFLIX.COM SG", "DANA*SPOTIFY") to canonical merchants via dictionary, fuzzy matching, and LLM fallback flagged for review.
2. **Recurring detection** (same logic as 9.1).
3. **Merge sources and deduplicate** (the same charge may appear in email and bank data).
4. **Email facts** enable **warnings before charges**: *"Canva trial ends in 3 days, Rp95k will be charged."* More valuable than notifying after money leaves.
5. **Confidence score;** low confidence → ask the user.

**2-month plan:**
- Weeks 1 to 2: forwarding address, e-statement upload, merchant dictionary; start aggregator conversations.
- Weeks 3 to 4: Gmail API in testing mode; Android notification-listener prototype.
- Weeks 5 to 6: aggregator integration for 1 to 2 banks (if onboarding completes); pilot with 20 to 30 users.
- Weeks 7 to 8: hardening; privacy (UU PDP consent, store derived data only, delete raw emails); cancellation guidance (deep links to each service's manage page).

**Natural math here:** precision and recall of the detector against user confirmations.

### 9.3 How Rocket Money does it (from their help center)

- Links bank accounts and credit cards through **Plaid**: *"Connect your bank accounts and credit cards through our secure linking provider, Plaid."*
- Algorithms analyze transactions from linked accounts to identify subscriptions and bills (algorithm details not published). The help pages mention only bank and card data, not email.
- **Why a subscription can be missing:** the paying account isn't linked, it was linked recently (processing delay), or the bank isn't supported.
- **Apple subscriptions appear differently** because Apple bundles them (same problem as "GOOGLE *…" lines in Indonesia).
- **Active/Inactive:** no detected payment in the past month moves an item to Inactive; a new payment moves it back.
- **Manual fallback (mobile app only):** add a bill and use "Find Transactions" to link matching transactions.
- Premium: cancellation help from real humans; a concierge negotiates bills; automated savings; budgets; balance alerts. Their homepage doesn't mention bill payment execution or AI (except the word "algorithm"). US-focused (partner bank is FDIC-insured).

**Lessons for Reins:**
1. Same core approach as ours (account data plus recurring detection), but Plaid gives them one near-complete source; we need several.
2. Copy the Active/Inactive rule.
3. Copy "Find Transactions": a fallback and a source of **labels** for precision and recall.

### 9.4 China context (International track, judges in Shenzhen)

**Subscriptions live in Alipay and WeChat Pay, not on credit cards.** They run as auto-deduction agreements (免密支付/自动扣款: password-free payment / automatic deduction). The list is already in one place:
- Alipay path: 我的 → 设置 → 用户保护中心 → 免密支付/自动扣款.
- WeChat Pay path: not verified.

Users rarely check. A Jiangsu reporter found **15 new auto-deduction services** signed in about a year, and **121 data authorizations** dating back to 2015.

**No consumer "Plaid" in China.** Third-party apps generally cannot read a user's Alipay/WeChat transactions, and China's personal information law (PIPL) is strict. What works: **users export their own bills as CSV** (WeChat Pay: 账单 → "…" → 导出账单; Alipay: personal web version). Same pattern as Indonesian e-statement uploads. The CSVs need cleaning before merging; check real column names.

**The problem is real and regulated:**
- Xinhua investigation (December 2025): **over 200,000 complaints** about auto-renewal on one third-party complaint platform; cancellation can take **5+ steps** with retention pop-ups; one user was charged **over 300 yuan across nearly two years** after uninstalling an app and got a refund only after a regulator complaint.
- The Consumer Rights Protection Law implementing regulations and the Online Trading Supervision Measures require **prominent reminders before the service starts and before each renewal**.
- **Shenzhen, July 2026:** the city's Market Supervision Administration issued China's first dedicated compliance guideline for platform auto-renewal: no pre-checked boxes, forced bundling or hidden terms; a **prominent reminder at least 5 days before each renewal** (SMS, pop-up, push, or call); a convenient cancellation channel. It is a recommended guideline without direct penalties.

**What this means for Reins:**
- **Pitch hook:** Reins can be the **consumer-side enforcer** of that right. A rule like `subscriptions: renewal_notice_days: 5, renew: confirm` mirrors the Shenzhen guideline, but the user no longer depends on merchants to remind them; the agent detects the cycle and warns.
- **Cancellation in China is centralized:** revoke the agreement in Alipay or WeChat. But only the platform can do that, so a third-party agent would need a partnership or API. Present it as the production path, not a current capability.
- **The judges know this well:** WeBank is affiliated with Tencent, which owns WeChat Pay. A wrong picture will be noticed.

**Hackathon version:**
- Main demo stays Indonesian.
- Add **one WeChat-Pay-style CSV import adapter** with **synthetic data** (no real personal data) and show the same detector and Policy Gate working unchanged.
- One slide: *"One architecture, different data sources: Indonesia (e-statements, email) and China (Alipay/WeChat CSV, auto-deduction agreements), plus an H-5 renewal rule matching Shenzhen's guideline."*

---

## 10. Platform: Web First, Mobile Later

**Decision:** responsive web app (desktop and mobile modes) first; native mobile only if time allows.

**Making the web app feel native on phones:**
- Mobile-first design for the 5 core screens; on desktop, widen to two panes (action feed left; Mandate Card or evidence log right).
- Approvals as a **bottom sheet** on mobile (modal on desktop) with **passkey (WebAuthn)** confirmation, which uses fingerprint/Face ID in mobile browsers.
- Add a **web app manifest and icons** for "Add to Home Screen" and full-screen launch (about an hour). Service worker optional.
- The evidence / log viewer can be desktop-only; judges usually use laptops.

**Five core screens:**
1. Home (upcoming bills)
2. Action feed with tier badges
3. Approval sheet (fingerprint)
4. Mandate Card with diff
5. Chat

**Mobile go/no-go: Saturday, October 17, evening.** Move to Expo only if all three are true:
1. All core flows run end to end on the web.
2. The red-team harness runs and produces numbers.
3. Drafts of the technical doc and security self-assessment exist.

Otherwise, spend the time on docs, video and fixes. A half-built app adds nothing; rushed docs cost points.

**If we do go native (Expo / React Native):**
- Same TypeScript stack; real push notifications and built-in biometrics.
- One coder is effectively consumed by the app.
- Judges need an Android APK plus video (sharing iOS builds needs a paid developer account).
- Native biometrics usually only **unlock**; to make them a real signature, keep the key in the phone's keystore or use native passkeys (check library maturity first).
- **Keep all logic server-side** (Planner, Gate, mock bank, audit log). The app is only a UI.

---

## 11. Scope

**Must-have:**
1. Pay this month's bills: PDF via quarantined Reader, anomaly confirmation, **hidden-text injection blocked**.
2. Detect subscriptions and cancel with bound approval.
3. Create and edit the mandate: compiler with read-back, versions and diffs; widening needs re-auth, narrowing applies immediately.
4. Policy Gate with tiers, provenance labels, atomic caps, audit log.
5. Evaluation harness: attack suite and benign suite, with/without-Gate comparison.

**Should-have:**
- Mandate Card with diff and blast-radius number.
- Kill switch.
- Passkey signing of mandate versions.
- WeChat-style CSV adapter (China slide).
- PWA manifest.

**Stretch (only if ahead):**
- Savings sweep with 24-hour undo.
- Leash contract enforcement plus `narrowMandate`.
- Payment-gateway test-mode adapter.
- Native mobile app (gated, Section 10).
- Telegram bot.

**Cut:**
- Budget reallocation.
- On-chain Merkle anchoring.
- Z3 (unless rules require it).
- Investment features (Topic B territory).
- Real bank integration.
- Agent swarm.
- Starting with a 40-attack target (start at about 20, grow).

---

## 12. Team Roles (5 people: 3 coders, 2 non-coders)

| Role | Owns |
|---|---|
| **Coder 1, policy engine** | Mandate data model, versioning and diff, narrowing and equivalence checks, Policy Gate, atomic caps, audit log, property tests; `narrowMandate` and Foundry tests if Leash is used |
| **Coder 2, agent and sandbox** | Mock bank API, Planner, quarantined Reader, provenance labels, compiler with read-back, approval tokens |
| **Coder 3, UI and evaluation** | Responsive UI (Mandate Card, action feed with tier badges, approval sheet), detectors (subscription, anomaly), evaluation harness, demo data |
| **Non-coder 1, evidence and data** | Realistic Indonesian bills and subscriptions, test PDFs (including hidden-text variants), 15 to 20 user interviews, UX copy (Indonesian/English) |
| **Non-coder 2, docs and red team** | Attack and benign test cases, technical doc, security self-assessment and known-risk list, deck, demo video |

**Pair people so at least two know each module** (finals include an on-site hackathon and only some members travel).

---

## 13. Evaluation and Evidence

**Two test suites:**
- **Attack suite** (start about 20, grow): written by non-coders, run automatically.
- **Benign suite** (about 20 to 30 tasks from personas, τ²-Bench-style scenario generation per the team plan).

**Attack categories to cover:**
- Indirect injection in bill PDFs (hidden/white text, metadata).
- Payee swap (right biller name, attacker's account number).
- Amount inflation within caps.
- Multi-turn escalation ("just this once, raise my limit").
- Social engineering ("I'm your parent, send money").
- Approval reuse (approval for A replayed for B).
- Race on caps (parallel payments).
- Mandate edit via chat without re-auth.
- Duplicate execution (retries).
- Tool-output injection (merchant names containing instructions).
- Homoglyph payee names.

**Metrics:**
- Attack success rate, **with vs without Gate**, with 95% upper bound.
- Task success rate.
- False-block rate (legitimate tasks refused).
- Latency and cost per task.
- Rupiah saved per persona per month (fines avoided plus subscriptions cancelled).
- Detector precision and recall.

**Regression rule:** every attack that ever succeeds becomes a permanent test.

**Execution evidence:** the harness and mock bank logs double as the required sandbox operation logs.

---

## 14. Research Grounding (citations checked)

| Paper | Status | Notes for our docs |
|---|---|---|
| **Progent** (Shi et al., arXiv 2504.11703; v3 May 14, 2026) | ✅ Matches | LLM generates the initial policy and updates; an SMT solver classifies each update as narrowing (applied automatically) or expansion (needs explicit approval). Core mechanism of Reins. |
| **CaMeL**, "Defeating Prompt Injections by Design" (Debenedetti et al., arXiv 2503.18813) | ✅ Real | Separates control and data flow; capabilities enforce policies at tool-call time. **77% of AgentDojo tasks with provable security vs 84% undefended**: show our own utility cost. |
| **Design Patterns for Securing LLM Agents against Prompt Injections** (Beurer-Kellner et al., arXiv 2506.08837) | ✅ Real | Source of Plan-Then-Execute, Dual LLM, Action-Selector patterns. |
| **The Automated but Risky Game** (Zhu et al., arXiv 2506.00073) | ✅ Real | Agents overspend and accept unreasonable deals; motivates hard limits outside the LLM. |
| **CNFinBench** (arXiv 2512.09506) | ✅ Real, venue unconfirmed | 15.4-point drop from single modules to full execution chains; violations up 159.05% in round 2 of multi-turn attacks. "KDD 2026" not confirmed on the arXiv page (it has an ACM DOI). |
| **Are Generative AI Agents Effective Personalized Financial Advisors?** (Takayanagi et al., arXiv 2504.05862) | ⚠️ Real but overstated in our draft | 64-participant lab study. Users were insensitive to advice quality, "or worse" the relationship can be inverse (extroverted personas got higher satisfaction while giving worse advice). Don't write "satisfaction is inversely proportional to quality". SIGIR 2025 not confirmed on the arXiv page. |
| "Only tested on generic tasks" (claim about CaMeL / Design Patterns) | ⚠️ Shaky | AgentDojo includes a banking suite. Don't claim these were never tested on finance-like tasks. |
| **AP2**, Agent Payments Protocol (Google with 60+ organizations incl. Mastercard, PayPal, Adyen) | Related work | Intent Mandate (pre-authorized conditions like price limits), Cart Mandate, Payment Mandate as signed Verifiable Credentials; non-repudiable audit trail. Cite it; say "inspired by", not "compliant". |
| **τ²-Bench** (arXiv 2506.07982) | From team plan, not checked | Scenario-based evaluation reference. |

---

## 15. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Compiler mistranslates rules | Ambiguity detection, fail closed, read-back, diff, user confirmation |
| Judges see "Rocket Money clone" or "FinAgent variant" | Lead with the blocked attack and the with/without-Gate numbers; positioning lines |
| Live demo fails (LLM slow or errors) | Backup video; deterministic seed data; recorded LLM responses for the demo path |
| Scope creep | Must/should/stretch/cut list; go/no-go gate for mobile |
| Topic A is crowded | Differentiate on execution with provable limits plus measurable security |
| Overclaiming | Report upper bounds, not "100%"; flag simulated data; state production gaps (cancellation, real payments) |
| Privacy / UU PDP | Tokenize PII before LLM calls; store derived data only; describe concrete measures instead of claiming "compliant"; check cross-border transfer rules (cloud LLM) |
| Leash IP | Disclose; get co-author consent; check NTU InnovateX rules |
| Deadline confusion | Treat October 20, 22:59 WIB as final; submit a complete v1 early and update |
| Indonesian context unfamiliar to Shenzhen judges | Explain PLN/BPJS briefly; show the architecture generalizes (China CSV adapter, H-5 rule) |

---

## 16. Open Questions and To-Dos

**Email to info@ican-x.com:**
1. Is the International-track deadline October 20 or November 1?
2. Do the organizers provide any dataset, sandbox or API this year?
3. How many members per finalist team are invited to Shenzhen?
4. Do testnet transactions count as on-chain evidence, and can non-Topic-F entries earn the on-chain bonus?

**Team:**
- Are Leash co-authors (Fachry, Nanda) on this team? If not, get consent for code reuse.
- Check NTU InnovateX rules on IP.

**Verify before claiming:**
- WeChat Pay auto-renewal menu path; real Alipay/WeChat CSV column names.
- Which Indonesian aggregators still operate and their bank coverage.
- Gmail API restricted-scope limits and assessment requirements.
- Current Bank Indonesia stance on crypto as a payment instrument.
- UU PDP cross-border data transfer rules (cloud LLM).
- SNAP API spec details.
- Whether any Indonesian app already does subscription tracking (before saying "no local equivalent").
- CNFinBench and Takayanagi venues.

---

## 17. Ideas Considered and Dropped

| Idea | Why dropped |
|---|---|
| Fingerprint + blockchain + AI (aid distribution, ATM authentication paper) | Doesn't fit the hackathon topics; fingerprint hardware earns no points; blockchain adds little when one party controls the system. The ATM paper used tree classifiers for 1:1 verification and reported "accuracy" instead of FAR/FRR/EER, with no liveness detection. |
| Idea 1: deadline-aware tuition FX and remittance routing (Topic C) | Solid math, but if IDR is already in hand, "convert now" is zero-risk, and forecasting barely beats naive thresholds; lowest innovation. |
| Idea 5: SME receivables copilot with conformal survival bounds (Topic E) | Strongest math, but public invoice datasets were unverified and small. |
| Idea 3: revealed-preference robo-advisor (Topic B) | Simulated investor proves little; looks like a textbook Markowitz demo. |
| Idea 7: sandwich-aware agent wallet (Topic F) | Shrinking problem (sandwich extraction fell to about $2.5M/month by Oct 2025, per research); attack evaluation only in simulation. |
| IETF draft "AgentCard" (draft-aevum-agentcard-00) | Identity/capability format only: no authorization, delegation, revocation or spend caps; Landauer arithmetic error (k_B·T·ln2 at 300 K ≈ 2.871e-21 J, draft says 2.854e-21 J); overlaps with A2A's Agent Card. |
| Agent swarm | More attack surface, more fragile, not a differentiator (Section 4.3). |
| Real-money payments | Access, licensing, irreversible errors, no extra points (Section 8.3). |

---

## 18. Deferred: Plan Fixes (to revisit when planning)

The team's 8-day plan needs these fixes (agreed to handle later):
- **Feature freeze conflict:** freeze is on day 4, but the compiler is scheduled for day 5 and UI for day 6. Move freeze to October 17 or move the compiler earlier.
- **Red-team too late:** day 7 is too late for the regression rule to work. Build the harness by day 3 with 5 cases; non-coders add cases daily.
- **No buffer:** docs on day 8 and submission on October 20 at 22:00 is too tight. Submit a complete v1 on **October 18**, then update.
- **Team table assumes 4 people:** map to 3 coders and 2 non-coders (Section 12).
- **Savings sweep:** cut unless ahead of schedule by day 5.
- **Residual risk:** back "Low" ratings with red-team numbers.
- **UU PDP wording:** describe concrete measures, not "compliant".

---

## 19. Sources

**Competition:**
- Official International Track rules (team's local copy: `international-topics-rules-en.docx`)
- 2026 edition article (iFeng): https://tech.ifeng.com/c/8wJG9eH2KFs
- 2025 results (People's Daily): https://www.peopleapp.com/column/30051004536-500007261769
- 2025 results (China.com): https://m.tech.china.com/redian/2025/1209/122025_1778234.html
- 2022 finals format (Pedaily): https://news.pedaily.cn/20221124/46752.shtml
- HKUST (Guangzhou) news on 2025 winners (team-provided text; URL from team plan): https://www.hkust-gz.edu.cn/zh/?p=13630%2F

**Leash:**
- https://github.com/hendrakurn/leash
- https://devpost.com/software/leash-0f31yq

**Research:**
- Progent: https://arxiv.org/abs/2504.11703
- CaMeL: https://arxiv.org/abs/2503.18813
- Design Patterns: https://arxiv.org/abs/2506.08837
- The Automated but Risky Game: https://arxiv.org/abs/2506.00073
- CNFinBench: https://arxiv.org/abs/2512.09506
- Takayanagi et al.: https://arxiv.org/abs/2504.05862
- τ²-Bench (unchecked): https://arxiv.org/abs/2506.07982
- AP2 overview (Vellum): https://www.vellum.ai/blog/googles-ap2-a-new-protocol-for-ai-agent-payments
- IETF AgentCard draft: https://www.ietf.org/archive/id/draft-aevum-agentcard-00.html

**Rocket Money:**
- https://www.rocketmoney.com/
- https://help.rocketmoney.com/en/articles/1940551-how-to-get-the-most-out-of-rocket-money
- https://help.rocketmoney.com/en/articles/934383-missing-subscriptions
- https://help.rocketmoney.com/en/articles/2185531-managing-your-bills-and-subscriptions

**Indonesia data access:**
- https://openbankingtracker.com/api-aggregators?country=ID
- https://ibsintelligence.com/ibsi-news/4-fintechs-offering-open-banking-solutions-in-indonesia/

**China auto-renewal:**
- Shenzhen guideline (July 2026): https://www.sznews.com/news/content/2026-07/08/content_32115084.htm
- Xinhua investigation (Dec 2025): https://www.news.cn/politics/20251224/397baff1ef554b61a1668e771b5474f6/c.html
- Alipay auto-deduction check (Yangtse Evening Post): https://www.yzwb.net/news/jiangsu/202509/t20250915_264460.html
- WeChat Pay / Alipay bill export (ifanr): https://www.ifanr.com/app/1185339

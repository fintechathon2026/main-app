# Reins: Product Requirements Document (PRD) v2

| Field | Value |
|---|---|
| Product | **Reins** (working name, formerly "Mandate"): an AI finance agent that manages your financial commitments (bills, subscriptions and prepaid packages) and acts only inside rules you signed |
| Document version | v2.0 (draft) |
| Date | October 16, 2026 |
| Planning horizon | 8 weeks (October 14 to December 8, 2026) |
| Context | FinTechathon 2026, International Track, Topic A (Personal Finance Assistant), with an on-chain prepaid-escrow module aimed at the on-chain exploration bonus (eligibility to be confirmed with the organizers, Section 25). This PRD describes the full 2-month product; Section 21 defines the smaller hackathon cut. |
| Related documents | `architecture.md` (implementation), `roles.md` (owners), `tasks.md` (R0 checklist), `brainstorm.md` (decisions, research, rejected ideas) |
| Markets | Demo market (R0): China, with a Shenzhen persona and CNY. Validation market: Indonesia, where the team are the users. See Section 2.4 |
| Status of facts | Items marked **[verify]** are unconfirmed and must be checked before they appear in submissions or pitches |

### Changes in v2.0 (October 16, 2026)

| # | Change | Sections |
|---|---|---|
| 1 | **New commitment type: prepaid packages (F19).** Purchase advisor, escrow purchase, per-session release with two signatures, merchant risk monitoring, early exit | 1, 2.2.1, 7, 8 (F19) |
| 2 | **On-chain escrow** (`PrepaidEscrow`) on Base Sepolia with a valueless test token (tCNY). The prepaid flow produces real transaction hashes as execution evidence | 8 (F19), 12.7 to 12.9, 14.4, 17.6 |
| 3 | **Source-of-truth rules for prepaid:** sessions need the customer's and the merchant's signatures; exits need a signed attestation from a registered oracle; complaints and news can only warn | 10.3, 10.8, 15.12 |
| 4 | Mandate DSL `prepaid` block; Gate rules `prepaid.*`; narrowing rules; base currency per user (IDR or CNY) | 9, 10 |
| 5 | **Demo persona is now Lin (Shenzhen, CNY).** Indonesia stays the validation market; Rina and Bima remain as its personas | 1, 2.4, 4, 21 |
| 6 | **Wording fix:** the agent proposes side-effecting actions; only the executor runs them. Planner-facing `cancel_subscription(subscription_id)`; the executor finds the approval by action hash (as in `architecture.md`) | 8 (FR5.7), 12.3, 12.6, 14.2 |
| 7 | New threats T21 to T27, attack cases 19 to 26, risks, dependencies, open questions, glossary, references | 16, 20, 22, 23, 25, 26, 27 |

### Changes in v1.2 (October 15, 2026)

| # | Change | Sections |
|---|---|---|
| 1 | **Agent harness decided:** LangGraph.js (explicit `StateGraph`) inside Next.js route handlers, Postgres checkpointer on Supabase. No separate Python service | 11.6 (new), 12.1, 23 |
| 2 | **Graph design with fixed security placement:** Planner binds read-only tools only; side-effecting calls become persisted plan rows; one `execute` node holds the settlement adapter and calls the Gate; `interrupt()` sits alone in its own node | 11.6, 12.2, 14.2 |
| 3 | **Resume carries no authority:** approvals are verified in Postgres by `actionHash` at execution; checkpoint and resume payloads are never trusted | 10.5, 11.6, 16.1 |
| 4 | New threats (T19 checkpoint/resume tampering, T20 re-execution on resume), attack cases 17 and 18, runtime NFRs, harness risks and dependencies | 16, 19, 20, 22, 23 |
| 5 | Deadline question closed: the rules state registration and submission both close October 20, 23:59 Beijing time; registration goes to fintechathon@ican-x.com | 25 |
| 6 | R0 note: passkeys arrive in R1, so R0 approvals are session-authenticated but still hash-bound and single-use | 10.5, 11.6, 16.1 |

### Changes in v1.1 (October 14, 2026)

| # | Change | Sections |
|---|---|---|
| 1 | **Cancellation policy:** one-tap approval by default, plus an optional, mandate-controlled rule that auto-cancels free trials before they convert to paid | 8 (FR5.7), 9, 10, 16 |
| 2 | **Bill payment kept** in the hackathon cut (R0) | 21 |
| 3 | **Multi-currency and FX:** foreign-currency subscriptions, FX-normalized detection, IDR equivalents, FX cost estimates (new F18) | 8, 9, 10, 13, 14, 15 |
| 4 | **Usage signals:** simulated (sandbox), self-report, and future real adapters; no "unused" claims without data | 8 (FR2.8, FR5.9) |
| 5 | **Cancel recommendations:** interpretable scoring with cited signals | 8 (FR5.10), 15.9 |
| 6 | **Financial summary and insights promoted to P0** (F12a); budgets stay P1 (F12b) | 7, 8, 18 |
| 7 | **Business model and impact** added | 6 |
| 8 | New threats, attack cases, and metrics for the above | 3, 16, 20 |

---

## Table of Contents

1. Summary
2. Problem
3. Goals, Non-Goals, and Success Metrics
4. Users and Personas
5. Product Principles
6. Topic A Fit, Business Model, and Impact
7. Feature Overview and Priorities
8. Functional Requirements
9. Mandate DSL Specification
10. Policy Gate Specification
11. Agent Design
12. System Architecture and Key Flows
13. Data Model
14. APIs and Agent Tools
15. Algorithms
16. Security
17. Privacy and Compliance
18. UX Requirements
19. Non-Functional Requirements
20. Evaluation Plan
21. Release Plan and Milestones
22. Risks and Mitigations
23. Dependencies and Assumptions
24. Out of Scope for v1
25. Open Questions
26. Glossary
27. References

---

## 1. Summary

AI agents can now pay bills, cancel subscriptions and move money. The missing piece is not capability, it is **trust**: people will not hand their money to an agent they cannot bound, inspect, or stop.

**Reins closes that gap.** Users write their money rules once, in plain language (for example, *"bills under Rp500k pay automatically, ask me before anything to do with subscriptions, never send money to someone new"*). Reins compiles those rules into a **structured, versioned mandate that the user signs with their own passkey**. An AI agent then manages the user's financial commitments (bills, subscriptions and prepaid packages) proactively, but **every action passes through a deterministic Policy Gate, not the LLM**, which allows, asks for confirmation, or denies, and cites the exact clause that decided it. Every action lands in a **tamper-evident audit log**.

**Prepaid packages, held in escrow.** Gyms, salons and tutoring centers sell discounted packages paid months in advance. When the business closes, customers lose the unused balance. China's central bank already runs an e-CNY smart-contract service (元管家) that keeps prepaid money in the customer's wallet and releases it per session. Reins adds the missing layer around it: advice before buying, one place for every package next to bills and subscriptions, release only with the customer's and the merchant's signatures, monitoring for official signs of trouble, and an early exit that returns the unused balance, all inside the mandate. In v1 this runs on a public testnet with a valueless test token and produces real transaction hashes.

**Markets.** The problem is universal; only data sources and settlement rails differ. The **R0 demo uses a Shenzhen persona (CNY)**: the prepaid-escrow rail (e-CNY smart contracts) exists in China, and the judges and finals are there. **Indonesia remains the validation market**, where the team are the users and obligations are scattered across banks, e-wallets, app stores and mobile credit. Renewal reminders match Shenzhen's 2026 auto-renewal guideline.

**Positioning:**
- vs PFM apps: they show charts; Reins executes.
- vs FinAgent (FinTechathon 2025 third prize): *"FinAgent tells you what you should do. Reins does it for you, and can prove it never goes past your limits."*
- vs Rocket Money: *"Rocket Money uses humans to cancel subscriptions on your behalf. Reins does it itself, inside rules you signed, and can prove it."*
- vs 元管家 (e-CNY prepaid service): *"元管家 keeps prepaid money from being taken. Reins makes sure you don't have to wait for the gym to close to get it back."*

**Name.** *Reins*: the user holds the reins, the agent does the work. The signed rule set inside the product is called the **mandate** (the same term AP2 uses for agent spending authority).

**What makes it defensible (engineering bets):**
1. **Untrusted-data boundary:** every value carries a provenance label; values from documents can never choose where money goes.
2. **Policy engine with formal guarantees:** narrowing a mandate is provably safe; ambiguous rules fail closed.
3. **Measured security:** the same attack suite run with and without the Gate, reported with honest statistics.
4. **Contract-bounded refunds:** the escrow contract fixes the refund destination to the customer, so even a compromised agent key can only return money early to its owner.

---

## 2. Problem

### 2.1 The trust gap in agentic finance

- Agents with tool access can already execute payments. Today their limits usually live in a prompt, or in an `if` statement on the operator's own server, with the approval record in that same operator's database.
- Known failure modes are not exotic: indirect prompt injection through documents and web pages, misread amounts, repeated orders. Research shows autonomous shopping agents overspend and accept unreasonable deals (Zhu et al., 2025), and financial agents degrade sharply from single modules to full execution chains (CNFinBench reports a 15.4-point drop).
- Before delegating money, users need three things: **bounds they define**, **visibility** into every action and why it happened, and **a stop button**.
- This is the central question of the hackathon theme, "AI as a Financial Participant": *how can an AI participate in someone's finances safely?*

### 2.2 Recurring obligations: the first job worth delegating

Recurring obligations are high-frequency, low-judgment and rule-friendly, which makes them ideal for bounded delegation. The pains are the same everywhere:

1. **Late payments and fines.** Due dates are spread across the month and across apps.
2. **Subscription creep.** Free trials convert to paid, prices rise, duplicates accumulate, small charges are forgotten.
3. **Budgets that are never executed.** People know their budget, but the money does not move accordingly.
4. **Prepaid packages that disappear.** Money paid in advance for future sessions is lost when the business closes (Section 2.2.1).

**Evidence across markets:**

| Market | Evidence |
|---|---|
| United States | **Rocket Money** shows demand for handing subscriptions and bills to a service: it links accounts via Plaid, detects recurring charges, and uses a human concierge for cancellations and bill negotiation. |
| China | A **Xinhua investigation** (December 2025) found over **200,000 complaints** about auto-renewal on one complaint platform, cancellation flows of **5+ steps**, and a user charged **over 300 yuan across nearly two years** after uninstalling an app. In **July 2026**, Shenzhen issued China's first compliance guideline for platform auto-renewal, including a prominent reminder **at least 5 days before each renewal**. |
| Indonesia | Obligations span banks, e-wallets, app stores and mobile credit (pulsa); no single data source covers them. To be confirmed with 15 to 20 user interviews **[verify]**. |

#### 2.2.1 Third commitment type: prepaid packages

Bills are paid after a service; subscriptions are paid per cycle; **prepaid packages are paid before the service**, often for months. The risk is not forgetting, it is the merchant failing to deliver.

**Evidence (China):**

| Fact | Source |
|---|---|
| 159,600 prepaid-consumption complaints on one platform from January to October 2024; 28.48% were about refusals to refund | CCTV, March 2025 |
| A Beijing yoga studio closed with about ¥400,000 prepaid by about 200 members; only one member sued | CCTV, March 2025 |
| "Professional store closers" (职业闭店人) are paid ¥10,000 to ¥20,000 per batch of members they transfer away | CCTV, March 2025 |
| About 10.39% of gyms closed in 2022 (industry report cited by the media) | Tencent News, July 2024 **[verify primary source]** |
| Businesses facing serious operating risk must stop collecting prepayments and announce a closure at least 30 days in advance | Revised Consumer Rights Protection Law Implementation Regulations, as reported by CCTV **[verify article]** |

**Existing solution: 元管家 (e-CNY smart-contract prepaid service).** Launched in the e-CNY app in September 2022 by the PBOC's Digital Currency Research Institute. An operator bank holds the prepaid money as e-CNY under a contract; it stays the customer's until a session is delivered; the merchant requests payment per lesson and the contract checks the conditions. When a Qingdao gym chain closed abruptly, 51 members who had bought through 元管家 were refunded within two days. By mid-2024 it covered 7 operator banks, 69 cities and **61 merchants**: merchants dislike losing the upfront cash.

**Gaps Reins fills:**
1. **Protection starts after the closure, and refunds are manual.** In the Qingdao case, the refund first failed, the bank phoned members, and members entered their ID and a receiving wallet. Reins watches for official signals earlier and runs the exit inside the user's rules.
2. **No advice at purchase time.** Nobody tells the customer whether a 20% discount is worth the risk of prepaying (Section 15.11).
3. **Packages live apart from bills and subscriptions.** Reins shows every commitment in one place, under one mandate.
4. **Merchant reluctance.** Reins does not solve this; it offers a voluntary-exit fee in the merchant's signed terms and an "escrow-protected" label that can help sales. We do not claim more.

### 2.3 Why existing solutions fall short

| Approach | Example | Gap |
|---|---|---|
| PFM and tracking apps | Money Lover, Spendee, bank PFM menus | Record and chart; never act |
| Concierge services | Rocket Money | Rely on humans and near-complete account aggregation; you trust the company, not rules you control |
| Advice agents | FinAgent (FinTechathon 2025) | Stop at recommendations; no execution, no permission system |
| Autonomous agents | General LLM agents with payment tools | No enforceable limits; authority sits inside the agent |
| Prepaid escrow | 元管家 (e-CNY) | Protects the principal, but passive: no advice at purchase, no early warning, manual refunds after closure, separate from other commitments |

### 2.4 Markets: demo in Shenzhen, validate in Indonesia

- **Demo market (R0): China.** The prepaid-escrow rail exists there (e-CNY smart contracts, 元管家), the prepaid problem is documented (Section 2.2.1), Shenzhen has the first auto-renewal guideline, and the judges and finals are in Shenzhen. The demo persona is Lin (Section 4.3) with CNY amounts.
- **Validation market: Indonesia.** We are the users and can validate quickly and honestly with real people. Fragmented data is the hardest case: if Reins works with scattered sources (e-statements, receipts, notifications, CSV exports), it works where aggregation is easy. Indonesia's large, young, digital population is a natural market **[verify figures before citing]**.
- **Prepaid escrow in Indonesia** needs a programmable-money rail or a licensed escrow partner; we do not know of an e-CNY equivalent there yet **[verify]**. Until then, prepaid escrow is a China-first feature.

### 2.5 Why it generalizes

- The core (mandate, Policy Gate, agent roles, audit log) is **market-agnostic**. Markets differ only in **ingestion and settlement adapters** (mock bank, escrow contract, later real rails).
- **Demonstrated, not claimed:** a China CSV adapter (Alipay / WeChat Pay exports) runs through the same detector and Gate unchanged, and the default `renewal_notice_days: 5` matches Shenzhen's guideline.
- Further markets need only adapters (for example, account aggregation where it exists, as Plaid does in the US).

### 2.6 Why now

- LLM agents can now plan and call tools reliably enough to execute routine tasks.
- Research gives concrete, testable patterns for safe agents: privilege control with monotonic policy updates (Progent), control/data-flow separation (CaMeL), and agent design patterns (Plan-Then-Execute, Dual LLM).
- Regulators (for example Shenzhen) are moving toward consumer-protective auto-renewal rules, which Reins can enforce from the consumer side.

### 2.7 Prepared answers

**"You're Indonesian. Why a Shenzhen persona?"**

> "Trusting an AI with your money is universal; only the rails differ. We demo in Shenzhen because the prepaid-escrow rail already exists there, in e-CNY smart contracts, and our default 5-day renewal reminder matches Shenzhen's guideline. We validate bills and subscriptions in Indonesia because we are the users. The core is the same; only adapters change."

**"Why a public testnet, if China doesn't allow crypto payments?"**

> "We don't use crypto as money. The token has no value and exists only to show the escrow logic and give verifiable transaction hashes. In production, the same contract logic belongs on a licensed rail such as e-CNY smart contracts through an operator bank, which is how 元管家 already works."

---

## 3. Goals, Non-Goals, and Success Metrics

### 3.1 Goals

| ID | Goal |
|---|---|
| G1 | Users can delegate bill payments, subscription management and prepaid packages to an agent with limits they define and understand. |
| G2 | No action that moves money can happen outside the signed mandate, even if the LLM is manipulated. |
| G3 | Every action is explainable: which rule allowed it, which data it used, and where that data came from. |
| G4 | Security claims are measured, not asserted. |
| G5 | The core is market-agnostic: it runs on Chinese (CNY) and Indonesian (IDR) data and on different settlement rails (mock bank, escrow contract); only adapters differ. |
| G6 | Prepaid money stays the user's until a session is delivered, and refunds can only go to the user. The contract enforces this, not the agent. |

### 3.2 Non-goals (v1)

- Moving real money (v1 uses a sandbox and, optionally, a payment-gateway test mode). No real crypto assets: on-chain parts use a valueless test token on a public testnet.
- Investment advice or portfolio features (Topic B territory).
- Credit scoring, lending, or paylater origination.
- Multi-user / shared finances.
- Fully autonomous operation without any user-defined limits.

### 3.3 Success metrics

**Product metrics (pilot, weeks 7 to 8, 20 to 30 users):**

| Metric | Target | Notes |
|---|---|---|
| Activation: user connects at least one data source and signs a mandate | ≥ 60% of pilot users | |
| Share of eligible bills handled automatically (T3) | ≥ 50% | Within mandate limits |
| On-time payment rate for tracked bills | ≥ 95% | Sandbox or user-reported |
| Median time from approval request to user decision | < 2 hours | Push notifications required |
| Subscriptions detected per user | Report only | Baseline metric |
| Money saved per user per month (base currency) | Report only | Fines avoided + subscriptions cancelled |
| Prepaid balance protected | Report only | Unused balance held in escrow, and balance returned by exits |
| User trust score ("I feel in control of what the agent can do", 1 to 5) | ≥ 4.0 mean | Exit survey |

**System and safety metrics:**

| Metric | Target |
|---|---|
| Attack success rate with Gate, 95% upper bound | ≤ 10% at n ≥ 40 attacks (0 successes gives 7.2%) |
| Attack success rate without Gate (baseline arm) | Report; expected substantially higher |
| False-block rate on benign tasks | ≤ 5% |
| Benign task success rate | ≥ 85% |
| Subscription detector precision / recall (vs user confirmations) | ≥ 0.90 / ≥ 0.80 |
| FX-billed subscriptions detected (synthetic set with ±5% IDR variation) | ≥ 0.95 recall |
| Recommendation acceptance rate | Report; used to tune weights |
| Escrow refunds paid to anyone other than the plan owner | 0 (contract invariant, fuzz-tested) |
| Forged, stale or mismatched attestations accepted | 0 in the attack suite |
| Policy Gate decision latency | p95 < 50 ms |
| End-to-end plan and execute latency | p95 < 10 s |

Targets are goals for the pilot, not claims.

---

## 4. Users and Personas

Personas are illustrative composites until interviews confirm them **[verify]**. **Lin is the R0 demo persona (China).** Rina and Bima represent the validation market (Indonesia).

### 4.1 Validation market (Indonesia): Rina, 21, university student (Bandung)

- Monthly allowance from parents; pays kos, PLN prepaid tokens, mobile data, a shared Netflix, Spotify, and a paylater installment.
- Pain: forgets due dates during exams; was charged after a free trial; doesn't want an app that "does whatever it wants".
- Wants: "Pay the boring stuff, warn me about anything weird, never touch anything new without asking."

### 4.2 Validation market (Indonesia): Bima, 24, first-jobber (Jakarta)

- Salary on the 25th; kos, postpaid PLN, BPJS, phone plan, 4 to 5 subscriptions, two paylater installments.
- Pain: late fees on paylater; subscriptions creeping up; budget never executed.
- Wants: savings moved automatically on payday, bills paid on time, a clear log of what happened.

### 4.3 Demo persona (China): Lin, 26, first-jobber (Shenzhen)

- Salary monthly; pays rent, electricity and mobile bills; four subscriptions, including ChatGPT Plus billed in USD and a trial that is about to convert; pays almost everything through WeChat Pay and Alipay and never reviews her auto-deduction agreements.
- Bought a **60-session gym package for ¥6,000** (¥100 per session; pay-per-visit is ¥125) and has used 12 sessions, so ¥4,800 is still unused.
- Pain: renewals she didn't notice; cancellation flows buried in settings; friends who lost money when a gym closed.
- Wants: one list of everything she has committed to pay, reminders before renewals, and her gym money back if the gym is in trouble.
- v1: **synthetic data only** (mock bank in CNY, testnet escrow, simulated merchant and registry). All amounts are sample values for R5 to sanity-check.

### 4.4 Jobs to be done

1. "When a bill arrives, make sure it's paid on time without me thinking about it, unless something is off."
2. "When I'm about to be charged for something I forgot, warn me first."
3. "When I set a rule, make sure it's followed exactly, and show me when it was used."
4. "When something goes wrong, let me stop everything instantly."
5. "When I prepay for a service, make sure I only pay for what I use, and get the rest back if the business is in trouble."

---

## 5. Product Principles

1. **Authority lives outside the agent.** The LLM proposes and calls tools; only the Policy Gate and the user's signature authorize.
2. **Numbers come from tools.** The LLM never computes amounts, totals, or savings.
3. **Untrusted data never chooses destinations.** Account numbers and payees come only from the trusted registry.
4. **Fail closed.** Ambiguity, missing data, invalid signatures, or errors lead to "ask" or "deny", never "allow".
5. **Narrowing is instant; widening needs proof.** Reducing permissions applies immediately; expanding requires re-authentication.
6. **Explain everything.** Every action cites a rule, a mandate version, and the origin of the data used.
7. **User-held keys.** Mandates are signed by the user's passkey, not by the server.
8. **Least data.** Collect, store, and send to LLMs only what is needed.
9. **Measure, don't assert.** Security and quality claims come from test suites with stated uncertainty.
10. **Contracts bound the agent too.** Where money sits in a contract, the contract itself limits where it can go; the agent's key can only trigger refunds to the owner.

---

## 6. Topic A Fit, Business Model, and Impact

### 6.1 Topic A fit

| Topic A requirement | Reins feature |
|---|---|
| Smart budgeting | Category budgets, payday savings sweep, budget fixes with confirmation (F11, F12b) |
| Bill analysis | Bill ingestion, extraction, anomaly detection, payment planning and execution (F4) |
| Spending insights | Financial summary, subscription detection, price-hike and duplicate detection, FX cost of foreign subscriptions; all numbers computed by tools (F5, F12a, F18) |
| Actionable recommendations based on income and expenses | Ranked cancel recommendations with cited signals (FR5.10); prepaid purchase advisor with break-even and risk (FR19.1); T1 proposals executed after approval; payday-aware planning (F8) |
| Security and compliance (30% of score) | Mandate, Policy Gate, provenance labels, tiers, audit log, red-team metrics (F6, F7, F10, F15); contract-level limits on escrowed money (Section 10.8) |
| On-chain exploration (challenge bonus, 0 to 5 points) | Prepaid escrow contract with real testnet transaction hashes (F19). Eligibility for Topic A entries to be confirmed (Section 25) |

### 6.2 Business model

| Option | How it works | Notes |
|---|---|---|
| **Freemium (B2C)** | Free: summary, subscription detection, reminders. Paid: automation (auto-pay, trial auto-cancel, savings sweep), more data sources | Simple; validates willingness to pay |
| **B2B / B2B2C licensing** | Banks and e-wallets license the mandate + Policy Gate layer to offer "safe agent" features inside their own apps | Most relevant to bank judges; the permission layer is market-agnostic |
| **Success-based fee** | Small share of verified savings (cancelled subscriptions, FX fees avoided) | Needs trustworthy measurement; can feel extractive |
| **Escrow-protected packages (B2B2C)** | Operator banks or merchants offer packages through Reins' escrow and advisor; small fee per protected package | Assumption; merchant adoption is the known weak point (Section 2.2.1) |

**Conflict of interest to avoid:** affiliate or referral fees from services we recommend (for example, switching plans) would undermine neutral "cancel this" advice. Either avoid them or disclose them in every recommendation that involves a partner.

### 6.3 Impact

Measured per persona per month, all computed by tools:
- **Subscriptions cancelled:** monthly and annualized savings.
- **Fines avoided:** late fees on bills paid on time by the agent.
- **FX costs avoided:** card FX markup on foreign-currency subscriptions switched or cancelled.
- **Prepaid money protected and recovered:** unused balance held in escrow, and balance returned by exits.
- **Time saved:** number of routine actions handled without user effort (T3 actions).
- **Trust:** share of users who keep automation enabled after 2 weeks (pilot).

---

## 7. Feature Overview and Priorities

Priority key: **P0** = required for v1; **P1** = expected in v1; **P2** = if time allows.

| ID | Feature | Priority |
|---|---|---|
| F1 | Onboarding, identity, passkeys, consent | P0 |
| F2 | Data ingestion (mock bank, e-statement, email forwarding, Gmail, aggregator, notification listener, China CSV, usage signals) | P0 to P2 (per source) |
| F3 | Merchant normalization and categorization | P0 |
| F4 | Bill management (extraction, anomaly detection, planning, payment) | P0 |
| F5 | Subscription management (detection, reminders, cancellation) | P0 |
| F6 | Mandate (compiler, DSL, signing, versioning, Mandate Card) | P0 |
| F7 | Policy Gate (decisions, provenance, caps, approvals, kill switch) | P0 |
| F8 | Agent (Planner, Reader, Explainer, scheduler, chat) | P0 |
| F9 | Approvals and notifications | P0 |
| F10 | Activity feed, explanations, evidence viewer, audit export | P0 |
| F11 | Savings sweep with undo | P1 |
| F12a | Financial summary and spending insights | P0 |
| F12b | Budgets | P1 |
| F13 | Settlement adapters (mock bank, escrow contract, gateway test mode, Leash on-chain) | P0 / P0 / P1 / P2 |
| F14 | Platforms (responsive web + PWA, native app) | P0 / P1 |
| F15 | Evaluation and red-team harness | P0 |
| F16 | Localization (Bahasa Indonesia, English) | P1 |
| F17 | Browser-agent cancellation for merchants without APIs | P2 |
| F18 | Multi-currency and FX | P0 (display, normalized detection) / P1 (fee estimate, local-billing suggestions) |
| F19 | Prepaid commitments (advisor, escrow purchase, per-session release, risk monitoring, early exit) | P0 (R0 cut in Section 21) |

---

## 8. Functional Requirements

Format: user story, then requirements (FR) with acceptance criteria (AC).

### F1. Onboarding, Identity, Passkeys, Consent (P0)

**Story:** As a new user, I want to sign up quickly, secure my account with my fingerprint, and choose exactly which data Reins can see.

- **FR1.1** Account creation with email; session auth.
- **FR1.2** Passkey (WebAuthn) registration during onboarding; at least one passkey required before any mandate can be signed.
  - AC: a user without a registered passkey cannot activate a mandate; the UI explains why.
- **FR1.3** Per-source consent screens stating what is read, why, retention period, and how to revoke.
  - AC: each data source has a consent record (scope, text version, timestamp); revoking stops sync within one sync cycle and deletes raw data per retention rules.
- **FR1.4** Guided first mandate: start from a template ("Student", "First job") or plain language.
- **FR1.5** Kill switch visible from the first session.

### F2. Data Ingestion

All ingested values are labeled with `origin` (Section 10.3). Every source is an adapter producing normalized transactions, bills, or subscription facts.

| ID | Source | Priority | Notes |
|---|---|---|---|
| FR2.1 | **Mock bank sandbox** (accounts, transactions, billers, bills, subscriptions) | P0 | Our own; full control; replayable scenarios; attack injection for tests |
| FR2.2 | **Bank e-statement upload (PDF)** | P1 | Per-bank parsers; password-protected PDFs supported via user-entered password (never stored) |
| FR2.3 | **Email forwarding address** for receipts | P1 | Per-user address; sender allowlist (Netflix, Spotify, Google Play, Apple, Canva, etc.); output is `origin = email`, untrusted |
| FR2.4 | **Gmail API (read-only, testing mode)** | P2 | As far as we know, restricted scope: testing mode limited to about 100 users; production needs a Google security assessment **[verify]** |
| FR2.5 | **Open-finance aggregator adapter** | P2 | Candidates: Brick, Brankas, Ayoconnect, Finverse **[verify status and coverage]**; business onboarding takes weeks |
| FR2.6 | **Android notification listener** (native app only) | P2 | Bank and e-wallet push notifications; sensitive permission; Play Store policy review; not possible on iOS |
| FR2.7 | **WeChat Pay / Alipay CSV import** | P1 | User-exported bills; synthetic data for demos; column mapping **[verify real headers]** |
| FR2.8a | **Usage signals: simulated** (sandbox merchants report last-used dates and sessions) | P0 | Always labeled `simulated: true` in UI and docs |
| FR2.8b | **Usage signals: self-report check-in** ("How often did you use X this month?") | P1 | `origin = user`; monthly prompt, one tap |
| FR2.8c | **Usage signals: Spotify "recently played" API** (user OAuth) | P2 | **[verify]** endpoint availability and developer-mode user limits |
| FR2.8d | **Usage signals: Android app-usage stats** (native app only) | P2 | Sensitive permission; Play Store policy review; not possible on iOS |

- AC (all): ingestion is idempotent (re-uploading the same file creates no duplicates); each record stores `source_id`, `origin`, and a content hash.
- AC (FR2.2, FR2.7): parse errors are shown per row; nothing is silently dropped.
- **Forbidden sources:** SMS reading (Play Store restricts to default SMS apps) and internet-banking scraping (violates bank terms, endangers users).

### F3. Merchant Normalization and Categorization (P0)

- **FR3.1** Map raw descriptors (for example `NETFLIX.COM SG`, `DANA*SPOTIFY`, `GOOGLE *YouTube`) to canonical merchants using a curated dictionary, then fuzzy matching, then LLM fallback.
- **FR3.2** LLM-suggested mappings are flagged `needs_review` and never used to create payees.
- **FR3.3** Each merchant has: category, aliases, `cancel_method` (`api`, `deeplink`, `browser`, `manual`), and `manage_url` where known.
- AC: normalization accuracy measured on a labeled set of at least 300 descriptors (target ≥ 95% for dictionary hits).

### F4. Bill Management (P0)

**Story:** As Rina, when a bill arrives, I want it paid on time automatically if it looks normal, and I want to be asked if it doesn't.

- **FR4.1 Bill ingestion.** Bills come from the mock bank, documents (PDF), or email. Documents are parsed only by the quarantined Reader (F8).
- **FR4.2 Matching.** Each bill is matched to a registered biller in the user's registry. Unmatched bills become T1 proposals ("New biller detected: add to registry?"), never payments.
- **FR4.3 Anomaly check.** Robust per-biller check (Section 15.2). Anomalous bills require confirmation.
  - AC: a bill whose amount is flagged anomalous is never auto-paid, regardless of `auto_pay_max`.
- **FR4.4 Payment planning.** On each trigger, the Planner orders payable bills by due date; if balance is insufficient, prioritization follows Section 15.5.
- **FR4.5 Payment execution.** `pay_bill(bill_id, biller_id, amount)` through the Gate. The destination account is resolved server-side from the registry; the tool has **no account-number parameter**.
  - AC: a document containing a different account number for a registered biller cannot change the destination.
- **FR4.6 Due-date reminders.** H-3 and H-1 reminders for bills that require confirmation and are still pending.
- **FR4.7 Payment receipts.** Each payment produces a receipt entry in the feed with rule citation and data provenance.

### F5. Subscription Management (P0)

**Story:** As Bima, I want to see everything that auto-charges me, get warned before renewals, and cancel what I don't need with one approval.

- **FR5.1 Detection.** Recurring-charge detector (Section 15.1) over all ingested transactions; email facts (renewal date, trial end) merged when available.
- **FR5.2 Signals detectable without usage data:**
  - Duplicate subscriptions in the same category.
  - Price increase vs. previous cycles.
  - Free trial converted to paid.
  - Small forgotten recurring charges.
- **FR5.3 "Unused" claims.** The agent must not claim a subscription is unused without usage data. It asks instead ("Still using Spotify? Rp55k/month = Rp660k/year"). Simulated usage signals in the sandbox are labeled as simulated.
- **FR5.4 Active/Inactive status.** No detected charge in the last cycle plus tolerance moves a subscription to Inactive; a new charge moves it back.
- **FR5.5 Pre-renewal reminders.** Default `renewal_notice_days: 5` (mirrors the Shenzhen guideline); user-configurable in the mandate.
- **FR5.6 Manual add with "Find Transactions".** Users can add a subscription and link matching transactions; these confirmations become labels for precision/recall.
- **FR5.7 Cancellation.**
  - **Default: one-tap approval.** The agent proposes `cancel_subscription(subscription_id)`; the user approves with a passkey (session in R0); the executor, not the LLM, re-runs the Gate, finds the approval by action hash, and cancels.
  - **Optional: trial auto-cancel (T3).** If the mandate enables `auto_cancel_trials`, the agent proposes and the executor carries out the cancellation of a free trial `days_before_charge` days before it converts to paid, without per-action approval, only if:
    - trial status and conversion date come from a **trusted source** (`mock_bank` or merchant API), never from email or documents;
    - the user has not marked the trial "keep";
    - the user was notified at least 3 days before (or at enrollment if the trial is shorter), with a one-tap "keep it" option.
  - Sandbox merchants: cancellation via API.
  - Real merchants without APIs: guided cancellation (deep link to manage page plus steps).
  - China path: guidance to revoke the auto-deduction agreement in Alipay (我的 → 设置 → 用户保护中心 → 免密支付/自动扣款) or WeChat Pay (path **[verify]**).
  - P2: browser-agent cancellation (F17).
  - AC: outside the trial auto-cancel rule, cancellation never executes without a valid approval token bound to that subscription.
  - AC: trial auto-cancel never fires on a paid subscription or on trial data from an untrusted origin.
- **FR5.8 Savings computation.** Annual savings computed by a tool: amount × cycles per year (converted to the base currency for foreign-currency subscriptions, F18).
- **FR5.9 Usage awareness.** When usage signals exist (FR2.8), show last-used date, sessions per month, and cost per use. When they don't, show "no usage data" and ask; never infer "unused" from transactions alone.
- **FR5.10 Cancel recommendations.** Rank subscriptions by an interpretable score (Section 15.9) built from cited signals: duplicates, price increases, trial conversions, low usage (only if data exists), FX cost, and share of monthly spending. Each recommendation lists its signals and their sources.
  - AC: every recommendation shows at least one cited signal; numbers come from tools.
  - Metric: recommendation acceptance rate (user agrees to cancel).

### F6. Mandate (P0)

**Story:** As a user, I want to write my rules in my own words, see exactly what they mean, sign them, and change them safely.

- **FR6.1 Natural-language compiler.** Converts user text to the DSL (Section 9) with constrained JSON output.
- **FR6.2 Read-back.** Before signing, the system shows a plain-language rendering generated **from the compiled DSL** (template-based, not free LLM text).
- **FR6.3 Ambiguity detection.** Compile k times (k = 3) and from at least one paraphrase. If results are not equivalent (Section 9.6), mark ambiguous, apply the narrowest interpretation, and ask a clarifying question.
  - AC: a set of at least 30 known-ambiguous phrasings is detected at ≥ 90%.
- **FR6.4 Diff.** Every change shows a field-level diff against the active version.
- **FR6.5 Versioning.** Mandates are immutable versions; edits create a new version linked to the previous one.
- **FR6.6 Signing.** The user signs each version with a passkey: the WebAuthn challenge is the SHA-256 hash of the canonical mandate JSON. The assertion is stored and verified server-side.
- **FR6.7 Monotonic updates.** Narrowing (Section 9.5) takes effect immediately after signing; widening additionally requires a fresh user verification (passkey with user verification) and a 10-second review screen.
  - AC: the agent cannot submit a widening edit; mandate changes only come from the user UI.
- **FR6.8 Templates.** "Student" and "First job" starter mandates.
- **FR6.9 Mandate Card.** One page showing current rules, version, signature time, diff history, **interruption budget** (α, Section 15.2), and **worst-case daily exposure** (Section 15.4).

### F7. Policy Gate (P0)

Specified in Section 10. Summary of requirements:

- **FR7.1** Every tool call with side effects passes the Gate; no code path bypasses it (including MCP handlers if used).
- **FR7.2** Decisions: `allow`, `require_confirm`, `deny`, each with rule IDs and human-readable reasons.
- **FR7.3** Provenance enforcement (Section 10.3).
- **FR7.4** Atomic cumulative caps (check and reserve in one database transaction).
- **FR7.5** Re-evaluation at execution time against the currently active mandate version.
- **FR7.6** Approval tokens bound to exact arguments, single use, with expiry.
- **FR7.7** Idempotency keys for every side-effecting action.
- **FR7.8** Kill switch: when on, every side-effecting action is denied.
- **FR7.9** Signature verification of the active mandate before every decision (cached by hash).

### F8. Agent (P0)

Specified in Section 11. Summary:
- **FR8.1** Planner (privileged), Reader (quarantined), Explainer (log-grounded).
- **FR8.2** Proactive triggers via scheduler (Section 11.4).
- **FR8.3** Chat for questions, rule edits (which open the mandate UI), and on-demand tasks.
- **FR8.4** All tool calls typed with JSON Schema; invalid calls are rejected before the Gate.

### F9. Approvals and Notifications (P0)

- **FR9.1** Approval requests show: action, amount, payee, reason for asking, rule ID, data origin, expiry.
  - The approval card is rendered **from tool-call arguments**, never from LLM text.
- **FR9.2** Approve with passkey; decline with optional reason; expired approvals require a new request.
- **FR9.3** Notifications: web push (PWA) in v1; native push in the mobile app (F14). Email fallback.
- **FR9.4** Batch approvals (P1): approve several low-risk items at once, each still bound individually.

### F10. Activity Feed, Explanations, Evidence (P0)

- **FR10.1** Feed of every proposal, decision, and execution with tier badge (T0 to T3, denied) and rule citation (for example `§bills.auto_pay v7`).
- **FR10.2** "Why?" on any item shows: rule, mandate version and hash, data origins, Gate decision trace.
- **FR10.3** Evidence viewer (desktop-first): audit log with hash-chain verification status.
- **FR10.4** Export: audit log and sandbox operation logs as JSONL and CSV (for hackathon execution evidence).

### F11. Savings Sweep (P1)

- **FR11.1** On payday + N days, move a percentage of income to savings, keeping a buffer for upcoming obligations (Section 15.6).
- **FR11.2** 24-hour undo for sweeps (reverse transfer in sandbox).
- AC: a sweep never reduces the balance below the computed obligations buffer.

### F12a. Financial Summary and Spending Insights (P0)

**Story:** As a user, I want to see where my money goes each month, what's coming up, and what my subscriptions really cost me.

- **FR12a.1 Summary.** Income, spending by category, recurring obligations (bills plus subscriptions), upcoming 14 days, and balance after obligations, per user and per month.
- **FR12a.2 Detail views.** Drill-down from any category to transactions, with merchant normalization (F3) and data origin.
- **FR12a.3 Insights computed by tools:** top categories, subscription total (IDR, including FX-converted amounts), price changes, fines avoided, month-over-month changes.
- **FR12a.4 Explanations.** The Explainer may describe insights, but every number comes from tool outputs.
- AC: every figure on the summary links to the underlying transactions.

### F12b. Budgets (P1)

- **FR12b.1** Category budgets from income and recurring obligations.
- **FR12b.2** Budget-overrun fixes: proposals to move allocation between categories (T2, requires confirmation).

### F13. Settlement Adapters

- **FR13.1 Mock bank (P0):** default settlement for all actions.
- **FR13.2 Payment-gateway test mode (P1):** "real API, fake money" adapter (for example Xendit or Midtrans test keys **[verify availability before business verification]**).
- **FR13.3 Leash on-chain authorization (P2):** payments must receive `AuthorizationGranted` from the Leash contract before off-chain settlement; add `narrowMandate` (lower cap, fewer targets, earlier expiry only) with Foundry tests.
- All adapters sit behind the same interface; switching adapters requires no agent changes.

### F14. Platforms

- **FR14.1 Responsive web app (P0):** mobile-first; desktop uses two panes. PWA manifest and icons for "Add to Home Screen".
- **FR14.2 Native app with Expo (P1):** push notifications, biometrics, Android notification listener (FR2.6). All logic stays server-side; the app is a UI client.
  - Native biometrics must sign with a keystore-held key or native passkey, not merely unlock **[verify library maturity]**.
  - Distribution for evaluation: Android APK; iOS via development builds only.

### F15. Evaluation and Red-Team Harness (P0)

Specified in Section 20. The harness is part of the product: it runs in CI and produces the metrics in Section 3.3.

### F16. Localization (P1)

- English UI for the R0 demo (Lin, CNY, Asia/Shanghai). Bahasa Indonesia, rupiah formatting and WIB for the validation market (P1).
- Chinese UI is out of scope for v1; China CSV path is demonstrated with English UI.

### F17. Browser-Agent Cancellation (P2)

- A browser agent may navigate a merchant's account page to cancel when no API exists.
- Constraints: allowlisted domains only; cancellation flow only; never enters payment data; stops before the final confirmation and requests user approval; page content is untrusted input.
- Demo only against a mock merchant site in v1.

### F18. Multi-Currency and FX

**Story:** As Bima, I pay for ChatGPT and Notion in USD with my IDR card; I want to see what they really cost me and not have them missed or misflagged when the rate moves.

*v2.0 note: "IDR" below means the user's base currency. Lin's base currency is CNY; ECB reference rates include both IDR and CNY.*

- **FR18.1 Original amounts (P0).** Store `original_amount` and `original_currency` when the source provides them (statement lines, receipts, merchant API).
- **FR18.2 FX rates (P0).** Daily reference rates from a trusted provider (Frankfurter / ECB reference rates, which include IDR); cached with date and source.
- **FR18.3 FX-normalized detection (P0).** Recurring-charge detection and anomaly checks run on the original currency when known, otherwise on IDR amounts normalized by the day's rate (Section 15.1).
- **FR18.4 IDR equivalents (P0).** Every foreign-currency amount is shown with its IDR equivalent and the rate date.
- **FR18.5 FX cost estimate (P1).** Estimated card FX markup per subscription per year, using a configurable markup rate **[verify typical Indonesian card markups]**.
- **FR18.6 Local-billing suggestions (P1).** If a service offers local-currency billing (for example via app stores), suggest it with estimated savings **[verify per service]**.
- **FR18.7 Caps in base currency (P0).** Mandate caps are in IDR; foreign amounts are converted at the decision-time rate plus `fx.margin_pct` before cap checks (Section 9.4).
- AC: a USD subscription with ±5% IDR variation month to month is still detected as recurring and not flagged as anomalous solely due to FX.

### F19. Prepaid Commitments (P0)

**Story:** As Lin, before I prepay a gym package I want to know whether the discount is worth the risk. After I buy, I want money released only for sessions I attend, and the rest returned if the gym is in trouble.

- **FR19.1 Purchase advisor.** For an offer (price `P` for `N` sessions, pay-per-visit price `q`), a tool computes savings, the break-even number of sessions, the expected loss without escrow, and a recommendation (Section 15.11). The LLM only phrases the result.
  - AC: the advice card shows savings, break-even sessions, the risk parameter used and its source, and expected loss with and without escrow; every number comes from the tool.
- **FR19.2 Escrow purchase (user-initiated only).** The user buys through the escrow contract (Section 14.4). Money moves from the user's wallet into the contract, not to the merchant. Terms (unit price, units, cancellation fee, offer expiry) come from a **merchant-signed offer**; the user signs the purchase on a confirmation sheet. The agent can never start a purchase.
  - AC: a purchase above `prepaid.max_prepay` is denied; with `escrow_only: true`, merchants without escrow support are blocked with an explanation; an offer whose terms differ from what the merchant signed is rejected by the server and by the contract.
- **FR19.3 Per-session release.** Each check-in releases one unit price to the merchant only with **two signatures over the same numbered session**: the user's device key and the merchant's key.
  - AC: a release with only one signature reverts; a reused or out-of-order session number reverts.
- **FR19.4 Risk monitoring in two tiers** (Section 15.12):
  - **Hard signals** can authorize an exit: attestations signed by a registered oracle (court enforcement listing, official closure notice).
  - **Soft signals** can only warn: complaint spikes and news, read by a quarantined Signal Reader. They have no path to an exit.
  - AC: no soft signal, however phrased, leads to an exit; an attestation that is unsigned, signed by an unknown key, about another merchant, or older than `attestation_max_age_days` is rejected.
- **FR19.5 Early exit on an attestation (T3).** If the attestation kind is listed in `prepaid.auto_exit_on`, the agent proposes `prepaid_exit(plan_id)`; the Gate allows it; the executor submits the attestation to the contract; the unused balance returns to the user's wallet.
  - AC: no code path and no contract function can send an exit refund to an address other than the plan owner.
- **FR19.6 Voluntary exit.** The user can leave a plan at any time. The unused balance returns minus the cancellation fee from the merchant's signed offer. Requires the user's signature.
- **FR19.7 Prepaid view.** Packages with sessions left and balance in escrow, merchant risk status with signals and their sources, advice for open offers, and transaction links to a block explorer.
- **FR19.8 Evidence.** Every on-chain action stores its transaction hash in the audit log and the feed; the audit export includes them.
- **Simulated in v1, and labeled as such:** the test token (tCNY, no value), the merchant service, the attestation registry, and complaint and news signals.

---

## 9. Mandate DSL Specification

### 9.1 Format

Canonical JSON (YAML accepted for authoring). Canonicalization: sorted keys, no insignificant whitespace, integers for amounts in whole base-currency units (rupiah or yuan); adapters convert to minor units where a rail needs them. The mandate hash is SHA-256 over the canonical JSON.

### 9.2 Schema (v1)

```yaml
version: integer            # monotonically increasing per user
base_currency: "IDR" | "CNY"
fx:
  rate_source: "ecb_reference"   # trusted provider (Frankfurter)
  margin_pct: number             # safety margin added before cap checks
payees:
  allow: [biller_id, ...]   # registry IDs only
  new_payee: deny | confirm
bills:
  auto_pay_max: integer     # per bill, rupiah
  anomaly:
    method: median_mad | conformal
    k: number               # robust z threshold (median_mad)
    alpha: number           # interruption budget (conformal)
    min_history: integer    # below this, always confirm
  pay_days_before_due: integer
subscriptions:
  cancel: confirm | deny
  subscribe: confirm | deny
  renewal_notice_days: integer
  renew_unseen_price_increase: confirm | allow
  auto_cancel_trials:
    enabled: boolean
    days_before_charge: integer
    notify_days_before: integer
savings_sweep:              # optional (P1)
  enabled: boolean
  on: "payday+N"
  pct: number
  keep_buffer_for_bills: boolean
  undo_hours: integer
budgets:                    # optional (P1)
  move_between_categories: confirm | deny
prepaid:                    # F19
  purchase: confirm | deny  # user-initiated only; the agent never purchases
  escrow_only: boolean      # block packages that are not held in escrow
  max_prepay: integer       # per purchase, base currency
  auto_exit_on: [court_enforcement | closure_notice]   # attestation kinds that allow a T3 exit
  attestation_max_age_days: integer
  warn_on_soft_signals: boolean
global:
  daily_outflow_cap: integer
  per_payee_daily_cap: { biller_id: integer }   # optional
  expires_at: timestamp                          # optional
```

### 9.3 Examples

**Validation market (Bima, IDR):**

```yaml
version: 7
base_currency: IDR
fx:            { rate_source: ecb_reference, margin_pct: 3 }
payees:        { allow: [PLN, TELKOMSEL, KOS_BU_SRI, BPJS], new_payee: deny }
bills:         { auto_pay_max: 500000, anomaly: { method: median_mad, k: 3, min_history: 3 }, pay_days_before_due: 2 }
subscriptions: { cancel: confirm, subscribe: deny, renewal_notice_days: 5, renew_unseen_price_increase: confirm,
                 auto_cancel_trials: { enabled: true, days_before_charge: 1, notify_days_before: 3 } }
savings_sweep: { enabled: true, on: "payday+1", pct: 20, keep_buffer_for_bills: true, undo_hours: 24 }
global:        { daily_outflow_cap: 1000000 }
```

**R0 demo persona (Lin, CNY):**

```yaml
version: 3
base_currency: CNY
fx:            { rate_source: ecb_reference, margin_pct: 3 }
payees:        { allow: [SZ_POWER, CHINA_MOBILE, LANDLORD_WANG], new_payee: deny }
bills:         { auto_pay_max: 300, anomaly: { method: median_mad, k: 3, min_history: 3 }, pay_days_before_due: 2 }
subscriptions: { cancel: confirm, subscribe: deny, renewal_notice_days: 5, renew_unseen_price_increase: confirm,
                 auto_cancel_trials: { enabled: true, days_before_charge: 1, notify_days_before: 3 } }
prepaid:       { purchase: confirm, escrow_only: true, max_prepay: 8000,
                 auto_exit_on: [court_enforcement, closure_notice], attestation_max_age_days: 2, warn_on_soft_signals: true }
global:        { daily_outflow_cap: 1000 }
```

Payee IDs and amounts are sample values; R5 checks them for realism.

### 9.4 Semantics

- Each action type maps to rules; the Gate evaluates all applicable rules and combines them with **most-restrictive-wins**: `deny > require_confirm > allow`.
- Missing fields default to the most restrictive value (`deny` or `confirm`, caps of 0).
- Unknown fields cause the mandate to be rejected at compile time.
- **Currency:** all caps are in `base_currency`. A foreign amount `x` is converted as `x × rate × (1 + margin_pct/100)` using the trusted rate at decision time; the converted value is used for every cap and threshold check.
- **Trial auto-cancel** is an autonomous permission (T3). It applies only to trials whose status comes from a trusted origin (Section 10.3).
- **Prepaid.** Escrow deposits do not count toward `daily_outflow_cap`, because the money stays the user's until a session is released; they are bounded by `max_prepay` instead. Session releases count as outflows. `auto_exit_on` is an autonomous permission (T3) that can only return money to the user.

### 9.5 Narrowing (partial order)

`p′ ⪯ p` ("p′ narrows p") iff for every field:
- caps: `p′.cap ≤ p.cap`
- allowlists and category sets: `p′.set ⊆ p.set`
- enumerations: `p′.value` is no more permissive (`deny ⪯ confirm ⪯ allow`)
- expiry: `p′.expires_at ≤ p.expires_at`
- thresholds that trigger confirmation: `p′.k ≤ p.k`, `p′.alpha ≥ p.alpha`, `p′.min_history ≥ p.min_history`
- autonomous permissions: `p′.auto_cancel_trials.enabled ⇒ p.auto_cancel_trials.enabled` (turning it on is widening)
- FX safety: `p′.fx.margin_pct ≥ p.fx.margin_pct` (a larger margin is more conservative)
- prepaid: `p′.max_prepay ≤ p.max_prepay`; `p.prepaid.escrow_only ⇒ p′.prepaid.escrow_only`; `p′.auto_exit_on ⊆ p.auto_exit_on` (adding a kind is widening, because it adds autonomous authority, even though refunds only go to the user); `p′.attestation_max_age_days ≤ p.attestation_max_age_days`

**Theorem to test (not just claim):** if `p′ ⪯ p`, then for every action `a`, `rank(gate(p′, a)) ≤ rank(gate(p, a))`, where `rank(deny) < rank(confirm) < rank(allow)`.
Verified with property-based tests (fast-check) over thousands of random policies and actions. If rules grow into logical formulas, check `φ_p′ ∧ ¬φ_p` unsatisfiable with an SMT solver (Z3), as Progent does.

### 9.6 Equivalence (for ambiguity detection)

`p ≡ q` iff `p ⪯ q` and `q ⪯ p` (structural equality after canonicalization for the v1 schema). Ambiguity = any pair of compiled candidates that are not equivalent.

---

## 10. Policy Gate Specification

### 10.1 Interface

```ts
type Decision = "allow" | "require_confirm" | "deny";

interface GateResult {
  decision: Decision;
  ruleIds: string[];          // e.g. ["bills.auto_pay", "bills.anomaly"]
  reasons: string[];          // human-readable, template-based
  mandateVersion: number;
  mandateHash: string;
  reservationId?: string;     // for cumulative caps
}

function decide(action: TypedAction, ctx: GateContext): Promise<GateResult>;
```

### 10.2 Evaluation order

1. **Kill switch** on → `deny`.
2. **Mandate validity:** active version exists; signature verifies; not expired → otherwise `deny`.
3. **Schema validation** of action arguments → invalid: `deny`.
4. **Provenance rules** (10.3) → violation: `deny`.
5. **Payee rules:** payee in `payees.allow` → continue; not in allowlist → `new_payee` policy.
6. **Action-type rules** (for example `subscriptions.subscribe: deny`, `prepaid.purchase`, `prepaid.auto_exit_on`; an agent-initiated purchase is always `deny`).
7. **Amount rules:** convert foreign amounts to base currency (Section 9.4); above `auto_pay_max` → `require_confirm`; hard caps exceeded → `deny`.
8. **Anomaly rules** → anomalous: `require_confirm`.
9. **Cumulative caps:** atomic reservation against `daily_outflow_cap` and per-payee caps → insufficient headroom: `deny`.
10. **Approval requirement:** if the combined decision is `require_confirm` and a valid approval token is attached, upgrade to `allow`.
11. Combine with most-restrictive-wins; emit trace to the audit log.

### 10.3 Provenance rules

```ts
type Origin = "user" | "registry" | "mock_bank" | "aggregator" | "fx_provider" | "chain" | "oracle"
            | "email" | "document" | "notification" | "csv" | "web" | "simulated";
type Labeled<T> = { value: T; origin: Origin; sourceId?: string };
```

| Argument | Allowed origins | Otherwise |
|---|---|---|
| Destination account / payee | `registry` only (resolved server-side from `biller_id`) | deny |
| Amount for auto-pay | `mock_bank`, `aggregator`; or `document`/`email` if biller registered, amount ≤ `auto_pay_max`, and anomaly check passes | require_confirm |
| New payee creation | `user` (via UI) only | deny |
| Mandate changes | `user` (via UI with passkey) only | deny |
| Subscription to cancel | any origin, but approval token required | require_confirm |
| Trial status for auto-cancel | `mock_bank` or merchant API only | require_confirm (falls back to one-tap approval) |
| FX rate | `fx_provider` only, dated within 2 days | deny (stale or unknown rate) |
| Usage signals | any; `simulated` must be labeled in UI | Used for recommendations only, never for authorization |
| Prepaid plan state (owner, merchant, sessions left, status) | `chain` only (read from the contract) | deny |
| Purchase terms (unit price, units, cancellation fee) | merchant-signed offer, verified by the server and again by the contract | deny |
| Trigger for a T3 prepaid exit | `oracle`: attestation signed by the registered key, same merchant, within `attestation_max_age_days` | require_confirm (falls back to a voluntary exit the user signs) |
| Complaints and news | `web` or `simulated`; any content | Warnings only, never authorization |

Untrusted origins (`email`, `document`, `notification`, `csv`, `web`) can **inform** proposals but can never **authorize** or **route** money.

### 10.4 Atomic caps

- Reservation and debit happen in one Postgres transaction with `SELECT ... FOR UPDATE` on the user's daily-limit row (or a single SQL function).
- Reservations expire if the action is not executed within 60 seconds.
- AC: 100 concurrent payment attempts that together exceed `daily_outflow_cap` never exceed it (load test in CI).

### 10.5 Approval tokens

```json
{
  "approvalId": "uuid",
  "actionHash": "sha256(tool + canonical(args))",
  "mandateVersion": 7,
  "expiresAt": "ISO-8601",
  "credentialId": "passkey id",
  "assertion": "WebAuthn assertion over actionHash"
}
```

- Single use; marked consumed on execution.
- The token row in Postgres is the only source of truth for approval. A resume payload from the client or the graph checkpoint never counts as approval (Section 11.6).
- R0 (hackathon): passkeys arrive in R1, so R0 approvals are authenticated by the login session only. Tokens are still bound to `actionHash`, expiring, and single use; `credentialId` and `assertion` are empty until R1.
- AC: an approval for action A presented with action B is rejected (hash mismatch); a replayed approval is rejected (consumed).

### 10.6 Execution-time re-check

- Every action stores the mandate version used at planning time.
- At execution, the Gate re-decides against the active version; if the decision changed, the action is cancelled and the Planner re-plans.

### 10.7 Idempotency

- Every side-effecting call carries an idempotency key; the settlement adapter returns the original result for duplicates.
- On-chain: the signed transaction is stored before broadcast and re-broadcast unchanged on retry (same hash); the contract itself rejects a second use of the same purchase authorization, session number, or exit.

### 10.8 Contract-level limits (defense in depth)

For prepaid money, the escrow contract is a second, independent enforcement layer:
- Refunds from an exit go only to the plan owner; there is no recipient parameter.
- A session release needs both the owner's and the merchant's signatures over the same numbered session.
- An attested exit needs an attestation signed by the oracle key fixed at deployment, and the caller must be the owner or the agent address the owner named at purchase.
- No admin withdrawal, no upgrade, no owner-changeable oracle.

A Gate bug cannot redirect escrowed money; a compromised agent key can at worst return money early to its owner. The Gate still decides whether Reins submits an action; the contract decides whether it can happen at all.

---

## 11. Agent Design

### 11.1 Roles (privilege separation, not a swarm)

| Role | Sees | Can do | Cannot do |
|---|---|---|---|
| **Planner** (privileged LLM) | User messages, structured data, labeled values | Produce typed plans; call tools | Read raw documents; approve; edit mandates |
| **Reader** (quarantined LLM) | One raw document at a time | Return typed fields, all labeled untrusted | Call any tool; see the mandate; see other documents |
| **Explainer** (LLM) | Audit-log entries and Gate traces | Write user-facing explanations | Call tools; invent facts not in the log |
| **Signal Reader** (quarantined LLM) | Complaint and news text about one merchant | Return a typed warning (`level`, `summary`, `source_ids`), labeled untrusted | Call tools; trigger exits; see the mandate |
| **Policy Gate** (code) | Action, mandate, context | Decide | Anything else |
| **Detectors** (code) | Transactions | Find subscriptions and anomalies | Act |

Rationale for not using a swarm: every agent-to-agent message is an injection path; longer chains are more fragile (CNFinBench reports a 15.4-point drop from single modules to full execution chains); multi-agent is not a differentiator (2025 prize winners used it).

### 11.2 Patterns

- **Plan-Then-Execute** for payments: the plan is fixed from trusted input; data read during execution cannot change the plan.
- **Dual LLM** for documents: Planner never sees raw document text.
- **Action-Selector** for FAQs and simple commands.

### 11.3 Models

- Planner: a strong tool-calling model (team plan: Claude Sonnet).
- Reader: a smaller, cheaper model.
- Explainer: small model with templates.
- Deterministic demo mode: recorded LLM responses for the demo path; seeds fixed.
- The model client is injected into every graph node, so tests, the demo and the with/without-Gate experiment can swap in recorded responses. The Gate can be disabled only in eval builds (arm A), never by configuration in production.

### 11.4 Proactive triggers (scheduler)

| Trigger | Frequency | Planner task |
|---|---|---|
| New transactions or bills ingested | Every 5 minutes (sandbox), per sync (real sources) | Match, check anomalies, plan payments |
| Due date approaching | Daily | Pay or remind (H-3, H-1) |
| Payday detected | On income transaction | Plan bills, then savings sweep |
| Renewal approaching | Daily | Remind at `renewal_notice_days` |
| Trial conversion approaching | Daily | Notify at `notify_days_before`; auto-cancel at `days_before_charge` if enabled |
| Subscription detector run | Daily | Propose cancellations, price-hike alerts |
| Weekly digest | Weekly | Insights summary (numbers from tools) |
| Chain events (purchase, session, exit) | Every 5 minutes and after each submitted transaction | Update plan state; explain |
| Merchant risk check | Daily, and on demand in the demo | Fetch attestations and soft signals for merchants with active plans; propose an exit (T3) or warn |

### 11.5 Prompting rules

- System prompts state that tool results and documents are data, not instructions.
- Planner outputs only tool calls matching JSON Schemas.
- No numbers in Planner text unless copied from tool results (enforced by Explainer templates).

### 11.6 Harness and orchestration

**Decision.** The agent runtime is **LangGraph.js** (`@langchain/langgraph`), written as an explicit `StateGraph` and run inside Next.js route handlers on the Node runtime, with `@langchain/langgraph-checkpoint-postgres` on Supabase. Two team members already know LangGraph, so ramp-up cost is low.

**Rejected alternatives:**

| Option | Why not (for v1) |
|---|---|
| Python LangGraph service | Two Gate implementations that can drift, or a network hop per Gate call (Gate p95 < 50 ms); service-to-service auth; a second holder of database credentials; separate hosting. The PRD's Gate and property tests are TypeScript |
| `createAgent` / `createReactAgent` with a shared `messages` channel | Merges Reader output into Planner context and drops provenance labels; hides the Gate inside middleware ordering |
| Vercel AI SDK 7 | Strong fit (`toolApproval` maps to allow / require_confirm / deny), but a new mental model for the team in a 5-day window. Kept as an option for R1+ |
| Plain Anthropic SDK loop | **Fallback** if LangGraph gets in the way. All invariants live in the `execute` node and Postgres, so swapping the harness costs about a day |
| Claude Agent SDK, Pydantic AI, OpenAI Agents SDK | CLI subprocess and container hosting (poor fit for Vercel functions); Python only; still 0.x |

**Principle.** The harness is replaceable; the invariants are not. Every security property lives in plain TypeScript (the Gate, Section 10) and in Postgres (actions, approvals, caps, idempotency, audit log), never in graph edges, middleware or checkpoint state.

#### 11.6.1 Graph

```
load_context ─► reader (subgraph) ─► planner ⇄ read_tools
                                        │
                                        ▼
                                  persist_plan ─► gate_preview ─┬─► execute ─┬─► explain
                                                                │            └─► planner (re-plan, max 1)
                                                                ├─► create_approval ─► await_approval ─► execute
                                                                └─► record_deny ─► explain
```

| Node | Type | Holds / does |
|---|---|---|
| `load_context` | code | Active mandate version and hash, kill switch, `userId` from the auth session (never from the LLM or request body) |
| `reader` | LLM subgraph | Own state schema `{documentId} → {fields}`; fetches the raw document itself; small model with zod-validated structured output; every field labeled `origin = document`. **No tools, no `messages` key** |
| `signal_reader` | LLM subgraph | Same isolation as `reader`, for complaint and news text; output is a warning, never an action |
| `planner` ⇄ `read_tools` | LLM + ToolNode | ToolNode is bound to **side-effect-free tools only**. Side-effecting tool calls (`pay_bill`, `cancel_subscription`, `sweep_to_savings`, `prepaid_exit`) are captured as plain data and not executed |
| `persist_plan` | code | Schema validation (`additionalProperties: false`), canonical args, insert `actions` rows with `args_hash`, `mandate_version`, deterministic `idempotency_key = hash(plan_id, index)` |
| `gate_preview` | code | Dry-run `decide()`; only chooses the route. Not a security boundary |
| `create_approval` | code | Inserts the pending approval row; approval card built from persisted `actions.args_json`, not from LLM text |
| `await_approval` | interrupt | Contains **only** `interrupt({ approvalId })` |
| `execute` | code | **Only node that holds the settlement adapter.** Per `actionId`: load row, recompute `args_hash`, `Gate.decide` against the active mandate, look up the approval in Postgres; in one transaction reserve cap, consume approval, mark executing; call adapter with idempotency key; append audit entry |
| `record_deny` | code | Audit entry and feed item with rule IDs |
| `explain` | LLM | Reads audit rows only (Explainer role) |

The Planner's state holds pointers only: `userId`, `trigger`, `messages` (user turns and tool results serialized as `Labeled<T>` JSON), `extracted: Labeled[]`, `actionIds[]`. It never holds executable arguments.

#### 11.6.2 Harness invariants

| # | Invariant | Source |
|---|---|---|
| H1 | Side effects run only in `execute`, which always calls the Gate. A conditional edge that skips `gate_preview` is harmless because `execute` enforces the Gate itself | FR7.1, 10.2, T1 |
| H2 | Resume carries no authority. `execute` accepts only `actionId`s and verifies hash and approval in Postgres. The resume endpoint checks that the thread belongs to the session user | 10.5, T9, T19 |
| H3 | Nothing with side effects runs before `interrupt()` in the same node. LangGraph restarts a node from the beginning on resume, so code before `interrupt()` runs again | 10.7, T7, T20 |
| H4 | Idempotency keys are deterministic and persisted before execution; never generated in a node that can re-run | 10.7, FR7.7 |
| H5 | Reader and Planner state schemas are disjoint; raw document text never enters the Planner context | 11.2, T1 |
| H6 | Provenance is re-derived server-side from IDs (`bill_id` → bill row → origin), never carried in LLM arguments or graph state | 10.3, attack 10 |
| H7 | Approvals are approve or reject only. The built-in "edit" decision is disabled for money actions; an edited action needs a new hash and a new token | 10.5 |
| H8 | Identity and mandate version come from the auth session and database, never from the LLM or request body; least-privilege DB role, not `service_role` | T13, 16.3 |
| H9 | The plan is frozen before execution; data read during execution cannot change it, except through the bounded re-plan edge (max 1) | 11.2, 10.6 |

**CI checks for the harness:**
- Canary test: attack PDFs carry unique canary strings; the test asserts none appears in any Planner prompt.
- Resume test: resuming with a forged `{ approved: true }` payload and no valid token must not execute.
- Double-resume test: resuming the same thread twice executes the action once.

#### 11.6.3 Runtime configuration (Day 1)

- Node runtime (not Edge); Node 22 or later (LangGraph v1 requirement). The checkpointer uses `pg` over TCP.
- Checkpoint tables in their own schema: `PostgresSaver.fromConnString(url, { schema: "langgraph" })`. The default `public` schema is exposed by Supabase's Data API.
- Run `setup()` once over a direct or session-mode connection, not on every cold start. Test the transaction pooler (port 6543) on Day 1 **[verify]**.
- Pause and resume are separate HTTP requests; no function stays alive while waiting for approval. Vercel function limits (reported 300 s Hobby, 800 s Pro) cover one planner turn **[verify]**.
- Pin exact versions of `langchain`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres` (weekly releases).
- Tracing: LangSmith free tier (5k traces per month) for debugging and the demo. No LangSmith deployment needed. The hash-chained audit log, not LangSmith, is the record of truth.

---

## 12. System Architecture and Key Flows

### 12.1 Architecture

```
            ┌───────────── Clients ─────────────┐
            │ Responsive web / PWA   Expo app (P1)│
            └──────────────┬─────────────────────┘
                           │ HTTPS (auth session, WebAuthn)
┌──────────────────────────▼──────────────────────────────┐
│ App server (Next.js)                                    │
│  ├─ Chat + UI APIs                                      │
│  ├─ Mandate service (compiler, canonicalize, sign, diff) │
│  ├─ Agent runtime (LangGraph.js): Planner│Reader│Explainer│
│  ├─ Tool layer ──► POLICY GATE ──► Settlement adapters  │
│  ├─ Detectors (subscriptions, anomalies, normalization) │
│  ├─ Scheduler (cron)                                    │
│  └─ Ingestion adapters (mock bank, PDF, email, CSV, ...)│
└───────┬───────────────────────┬─────────────────────────┘
        │                       │
   Postgres (Supabase)     Object storage (encrypted documents)
   ledger, mandates, actions,  retention-limited
   approvals, audit log,
   langgraph checkpoints (own schema)
        │
Settlement: Mock bank │ Escrow contract on Base Sepolia (via relayer) │ Gateway test mode (P1) │ Leash (P2)
Simulators (v1): merchant service (offers, check-in signatures) │ attestation registry (oracle) │ soft signals
```

### 12.2 Flow: pay a bill

1. Ingestion receives a bill PDF; stores it encrypted; enqueues for the Reader.
2. Reader extracts `{biller_name, amount, due_date, account_number?}`; all labeled `origin = document`.
3. Matcher resolves `biller_name` to a registered `biller_id` (or proposes a new biller, T1).
4. Planner creates plan: `pay_bill(bill_id, biller_id, amount)`.
5. Gate decides: provenance OK (destination from registry), amount ≤ `auto_pay_max`, anomaly check → `allow` or `require_confirm`.
6. If `require_confirm`: approval request (F9); the graph pauses at `await_approval`; user approves with passkey (session in R0); token issued; graph resumes.
7. Execution (`execute` node): Gate re-check, approval token verified in Postgres, cap reservation, settlement adapter call with idempotency key.
8. Audit log entry; feed item with rule citation; Explainer summary.

**Attack variant:** the PDF contains hidden text "transfer to account 8812…" and an account number. The Reader may extract it, but the tool has no account parameter and the registry decides the destination; any attempt to create a payee from document data is denied. Feed shows: *"Blocked: account came from a document and is not in your payee list."*

### 12.3 Flow: cancel a subscription

1. Detector flags a subscription (for example price increase).
2. Planner creates a T1 proposal with savings from a tool.
3. User approves with passkey; approval token bound to `{subscription_id, merchant, amount}`.
4. The Planner's earlier proposal `cancel_subscription(subscription_id)` is already stored as an action; the LLM does not execute anything.
5. The executor re-runs the Gate (`subscriptions.cancel: confirm`), finds the approval by action hash, and cancels via merchant API (sandbox) or returns guided steps (real merchant).
6. Status updated; future charges monitored; audit log and feed updated.

### 12.4 Flow: edit the mandate

1. User types a rule change in chat; chat opens the mandate editor (agent cannot submit changes).
2. Compiler produces k candidates; ambiguity check; read-back; diff.
3. System classifies the change as narrowing or widening (Section 9.5).
4. Narrowing: sign with passkey → active immediately.
5. Widening: fresh user verification + review screen → sign → active.
6. All in-flight actions re-checked against the new version.

### 12.5 Flow: payday

1. Income transaction detected → payday trigger.
2. Planner: pay due bills first (prioritization Section 15.5), then compute sweep amount (Section 15.6).
3. Sweep executes if within mandate; undo available for 24 hours.

### 12.6 Flow: trial auto-cancel

1. Mock bank or merchant API reports a trial with its conversion date (`trial_status_origin` trusted).
2. At `notify_days_before`, the user gets a notice with a one-tap "keep it" (sets `keep_flag`).
3. At `days_before_charge`, the scheduler triggers the Planner, which proposes `cancel_subscription(subscription_id)`; under this rule no approval is needed.
4. The Gate allows it only if `auto_cancel_trials.enabled`, the subscription is still a trial from a trusted origin, `keep_flag` is false, and the notice was sent. Otherwise it falls back to one-tap approval.
5. Feed shows a 🟢 T3 item: *"Cancelled Canva trial before it converted (§subscriptions.auto_cancel_trials v7). Saved Rp95k."*

### 12.7 Flow: buy a prepaid package

1. Lin opens a gym offer in the Prepaid tab. The offer comes from the merchant simulator, signed with the merchant's key.
2. The advisor tool computes savings, break-even sessions and expected loss (Section 15.11); the Explainer phrases the card.
3. Lin taps Buy. On the confirmation sheet her browser key signs a token permit and the purchase authorization, which names Reins' agent address as allowed to submit attested exits.
4. The app stores a `prepaid_purchase` action with `actor = user`. The executor runs the Gate (`prepaid.purchase`, `max_prepay`, `escrow_only`, offer signature), then the relayer submits `purchaseWithPermit`.
5. The transaction hash goes to the audit log and the feed, with an explorer link.

### 12.8 Flow: check in

1. At the gym, the merchant device shows a QR code with `{planId, sessionNo, deadline}` and the merchant's signature.
2. Lin's app checks the payload and signs the same session.
3. A `prepaid_redeem` action carries both signatures. The Gate checks the plan is active, the session number is next, and the daily cap; the relayer submits `redeem`; the contract verifies both signatures and pays one unit price to the merchant.

### 12.9 Flow: early exit on an attestation

1. The daily risk job fetches attestations for merchants with active plans from the registry (simulated in v1).
2. A `court_enforcement` attestation for Lin's gym arrives, signed by the registered oracle key.
3. The Planner proposes `prepaid_exit(plan_id)`.
4. The Gate allows it (T3) only if `court_enforcement` is in `prepaid.auto_exit_on`, the signature verifies, the merchant matches and the attestation is fresh. Otherwise it asks Lin, and her approval becomes a voluntary exit she signs.
5. The executor submits `exitWithAttestation` from the agent key. The contract re-checks the attestation and sends the unused balance to the plan owner.
6. Feed: *"Returned ¥4,800 from FitBox Futian: the gym was listed for court enforcement (signed record, simulated registry). §prepaid.auto_exit_on v3. tx 0x…"*

**Soft-signal variant:** a complaint spike reaches the Signal Reader, which returns a warning only: *"Complaints about FitBox rose sharply this week (simulated). Your rules don't allow an automatic exit on complaints. Exit now (fee ¥480) or keep watching?"*

---

## 13. Data Model

```
users(id, email, locale, timezone, created_at)
credentials(id, user_id, credential_id, public_key, sign_count, created_at)
consents(id, user_id, source_type, scope, text_version, granted_at, revoked_at)
data_sources(id, user_id, type, status, consent_id, last_synced_at)
  -- type: mock_bank | estatement | email_forward | gmail | aggregator | notification | csv_wechat | csv_alipay

accounts(id, user_id, data_source_id, provider, type, currency, balance, updated_at)
transactions(id, account_id, posted_at, amount, currency, raw_descriptor,
             original_amount, original_currency, fx_rate, fx_rate_date,
             merchant_id, source_id, origin, content_hash, created_at)
merchants(id, canonical_name, category, aliases[], cancel_method, manage_url)
merchant_mappings(id, raw_descriptor, merchant_id, method, needs_review, reviewed_by)

billers(id, user_id, merchant_id, payee_account_ref, verified_at, verified_via)
  -- payee_account_ref: registry value; never sourced from documents
bills(id, user_id, biller_id, amount, due_date, period, document_id,
      extracted_fields_json, status, created_at)
documents(id, user_id, type, storage_ref, sha256, received_at, retention_until)

subscriptions(id, user_id, merchant_id, cycle_days, amount, currency, next_renewal,
              billing_currency, original_amount, status, first_seen, last_charged,
              confidence, detection_source, trial_end, trial_status_origin, keep_flag)
subscription_labels(id, subscription_id, user_id, label, created_at)  -- for precision/recall
fx_rates(date, base, quote, rate, source, fetched_at)
usage_signals(id, user_id, merchant_id, subscription_id, source, metric, value,
              period_start, period_end, origin, simulated, created_at)
recommendations(id, user_id, subscription_id, score, signals_json, status, created_at)
  -- status: open | accepted | dismissed

mandates(id, user_id, version, policy_json, policy_hash, prev_version,
         signed_at, credential_id, assertion, status, created_via)
  -- status: active | superseded | revoked ; created_via: nl | template | edit

plans(id, user_id, trigger, planner_model, created_at, status)
actions(id, plan_id, tool, args_json, args_hash, tier, decision, rule_ids,
        mandate_version, approval_id, idempotency_key, actor, executed_at, result_json)
  -- tool adds: prepaid_purchase | prepaid_redeem | prepaid_exit | prepaid_exit_voluntary
  -- actor: agent | user (user-initiated actions skip the Planner, not the Gate)
approvals(id, user_id, action_hash, mandate_version, expires_at,
          credential_id, assertion, status, consumed_at)
cap_reservations(id, user_id, amount, day, expires_at, action_id, status)

audit_log(seq, user_id, prev_hash, hash, actor, event_type, event_json, created_at)
  -- actor: agent | user | gate | system ; hash = sha256(prev_hash || canonical(event))

wallets(id, user_id, address, kind, created_at)
  -- kind: consumer_browser (R0: key generated and kept in the browser; the server never sees it)
prepaid_merchants(id, merchant_id, chain_address, escrow_supported, risk_level, updated_at)
prepaid_offers(id, merchant_id, unit_price, units, cancel_fee_bps, expires_at, offer_json, merchant_sig)
prepaid_plans(id, user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed,
              cancel_fee_bps, agent_address, status, purchase_tx, origin, last_synced_block)
  -- status: active | completed | exited_attested | exited_voluntary ; origin: chain
prepaid_sessions(id, plan_id, session_no, tx_hash, redeemed_at)
attestations(id, merchant_id, kind, case_ref_hash, issued_at, expires_at, signer, signature, sig_valid, raw_json)
risk_signals(id, merchant_id, kind, level, summary, source_ids, origin, simulated, observed_at)
chain_txs(id, action_id, sender, method, raw_tx, tx_hash, nonce, status, block_number, submitted_at, confirmed_at)

notifications(id, user_id, type, payload_json, channel, sent_at, read_at)
kill_switch(user_id, enabled, changed_at)

eval_cases(id, suite, category, input_json, expected_json)
eval_runs(id, case_id, arm, outcome, latency_ms, cost_usd, created_at)
  -- arm: with_gate | without_gate
```

Row Level Security on all user-scoped tables.

---

## 14. APIs and Agent Tools

### 14.1 Mock bank API (OpenAPI, sandbox)

Optionally mirror field names from Bank Indonesia's SNAP standard **[verify spec]**.

| Method | Path | Purpose |
|---|---|---|
| GET | `/accounts` | List accounts and balances |
| GET | `/accounts/{id}/transactions?from&to` | Transaction history |
| GET | `/billers` | Registered billers |
| GET | `/bills?status` | Bills |
| POST | `/payments` | `{bill_id, biller_id, amount, idempotency_key}` → payment |
| GET | `/subscriptions` | Merchant subscriptions |
| POST | `/subscriptions/{id}/cancel` | Cancel (mock merchant) |
| POST | `/transfers/internal` | Savings sweep |
| POST | `/transfers/{id}/reverse` | Undo within window |
| GET | `/events?since` | Event feed for the scheduler |
| POST | `/test/scenarios/{name}` | Seed scenarios (test only) |
| POST | `/test/inject` | Inject attack documents or transactions (test only) |

Every call is logged with request, response, and latency; logs are exportable (F10.4).

### 14.2 Agent tools (function calling)

| Tool | Side effect | Notes |
|---|---|---|
| `get_balance()` | No | |
| `list_transactions(from, to, merchant?)` | No | |
| `list_bills(status?)` | No | |
| `list_subscriptions(status?)` | No | |
| `compute_savings(subscription_id)` | No | Returns annual amount in the base currency |
| `get_financial_summary(period)` | No | F12a figures |
| `get_fx_rate(base, quote, date)` | No | Trusted provider only |
| `list_recommendations()` | No | Ranked, with signals |
| `propose_action(type, args, reason_code)` | Creates a proposal | No money moves |
| `pay_bill(bill_id, biller_id, amount)` | Yes | **No account parameter**; destination from registry |
| `cancel_subscription(subscription_id)` | Yes | Approval required; the executor finds it by action hash (the Planner never handles approval IDs) |
| `list_prepaid_plans()` | No | Balances and sessions from the contract (`origin = chain`) |
| `advise_prepaid(offer_id)` | No | Section 15.11 |
| `list_risk_signals(merchant_id)` | No | Hard and soft signals with origins |
| `prepaid_exit(plan_id)` | Yes | T3 only with a valid attestation; otherwise approval. No destination parameter: the contract pays the plan owner |
| `sweep_to_savings(amount)` | Yes | P1 |
| `explain(action_id)` | No | Explainer only |

**Not tools:** detectors, mandate editing, payee creation, prepaid purchase, check-in and voluntary exit (UI only, signed by the user).

**Binding (Section 11.6):** only side-effect-free tools are bound to the Planner's ToolNode. Calls to side-effecting tools are persisted as `actions` rows and executed only by the `execute` node, which calls the Gate.

**MCP:** optional. If tools are exposed via MCP, the Gate runs inside each handler.

Example schema:

```json
{
  "name": "pay_bill",
  "description": "Pay a registered bill. Destination is resolved from the biller registry.",
  "parameters": {
    "type": "object",
    "properties": {
      "bill_id": { "type": "string" },
      "biller_id": { "type": "string" },
      "amount": { "type": "integer", "minimum": 1 }
    },
    "required": ["bill_id", "biller_id", "amount"],
    "additionalProperties": false
  }
}
```

### 14.3 Internal app API (selected)

- `POST /mandates/compile` → candidates, ambiguity report, read-back, diff
- `POST /mandates/{version}/sign` → WebAuthn assertion over mandate hash
- `POST /approvals/{id}/approve` → WebAuthn assertion over action hash
- `POST /kill-switch` → toggle
- `GET /audit/export?format=jsonl|csv`
- `POST /ingest/estatement`, `POST /ingest/csv`, inbound email webhook
- `GET /prepaid/offers/{id}/advice`, `POST /prepaid/purchase`, `POST /prepaid/plans/{id}/checkin`, `POST /prepaid/plans/{id}/exit` (user-signed payloads)

### 14.4 Escrow contract interface (summary)

Full specification in `architecture.md` Section 24. Solidity, OpenZeppelin, Base Sepolia. Token: `TestCNY` (tCNY), an ERC-20 with permit, 2 decimals, no value.

```solidity
function purchaseWithPermit(Offer calldata offer, bytes calldata merchantSig,
                            PurchaseAuth calldata auth, bytes calldata consumerSig,
                            Permit calldata permit) external returns (uint256 planId);
function redeem(uint256 planId, uint32 sessionNo, uint64 deadline,
                bytes calldata consumerSig, bytes calldata merchantSig) external;
function exitWithAttestation(uint256 planId, Attestation calldata att, bytes calldata oracleSig) external;
                // caller must be the plan owner or the agent named in the purchase; refund goes to the owner
function exitVoluntaryBySig(uint256 planId, uint64 deadline, bytes calldata consumerSig) external;
                // refund minus the cancellation fee to the owner; fee to the merchant
```

All signed payloads are EIP-712 typed data. The oracle address is immutable. There is no admin function.

---

## 15. Algorithms

### 15.1 Recurring-charge detection

Group transactions by normalized merchant. Recurring if at least 3 charges with gaps near 7, 30, or 365 days (±3 days) and amount spread within 10% of the median.

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

Extensions: allow one missed cycle; detect price change as a new regime (amount step with stable cadence); merge email facts (trial end, renewal date).

**FX normalization:** if `original_currency` is known, run the amount-stability test on `original_amount`. Otherwise convert each IDR amount back to the suspected billing currency using the rate on its posting date, and test stability on the converted values. This keeps USD subscriptions detectable when the IDR charge moves with the exchange rate. The same normalization applies before anomaly checks.

**Quality:** precision and recall vs user labels (FR5.6), reported with confidence intervals.

### 15.2 Bill anomaly detection

**Default, robust z-score:**
`z = |x − median(H)| / (1.4826 · MAD(H))`; confirm if `z > k` or `|H| < min_history`.

**Conformal option (when history is long enough):**
- Scores `s_i = |x_i − m|` with `m = median(H)`.
- `q` = the ⌈(n+1)(1−α)⌉-th smallest score.
- Auto-pay if `|x_new − m| ≤ q`.
- Guarantee: under exchangeability, a normal bill triggers confirmation with probability at most α (the **interruption budget**).
- Requires n ≥ 9 for α = 0.1, n ≥ 4 for α = 0.2; otherwise always confirm.
- Seasonality (for example electricity) breaks exchangeability: detrend or use same-season history when available.

### 15.3 Merchant normalization

1. Exact match on dictionary aliases.
2. Normalized fuzzy match (lowercase, strip prefixes like `DANA*`, `GOOGLE *`, country suffixes) with similarity threshold.
3. LLM fallback → `needs_review`.
Metrics: accuracy on a labeled descriptor set.

### 15.4 Worst-case daily exposure ("blast radius")

`exposure = min(daily_outflow_cap, Σ_{p ∈ allow} min(per_payee_daily_cap_p, auto_pay_max × max_autopays_per_day_p))`, money only to allowlisted payees. Shown on the Mandate Card.

### 15.5 Bill prioritization under insufficient balance

Given balance `B` and payable bills with amounts `a_i` and late penalties `f_i` (fine plus mandatory flag), choose a set `S` maximizing avoided penalties subject to `Σ_{i∈S} a_i ≤ B`.
- Small n: exact 0/1 knapsack by dynamic programming.
- Mandatory bills (kos, BPJS) have priority weight; ties broken by earliest due date.
- Output is a proposal; unpaid items generate reminders.

### 15.6 Savings sweep amount (chance-constrained)

Choose sweep `s` such that `P(balance − s < obligations until next payday) ≤ ε`.
- Obligations distribution from known bills plus recurring-charge history (empirical quantiles).
- `s = max(0, balance − Q_{1−ε}(obligations) − buffer)`, capped by `pct × income`.
- Default ε = 0.05.

### 15.7 Ambiguity detection

Compile the rule k = 3 times plus one paraphrase; canonicalize; if any pair is not equivalent (Section 9.6), flag ambiguous, adopt the meet (most restrictive interpretation), and ask a targeted clarification generated from the differing fields.

### 15.8 Audit hash chain

`hash_n = SHA-256(hash_{n−1} || canonical(event_n))`; verification recomputes the chain; the evidence viewer shows the first broken link if any.

### 15.9 Cancel-recommendation score

Interpretable points, not a black box. For subscription `s`:

`score(s) = 3·duplicate + 2·price_increase + 2·trial_converted + 3·low_usage + 1·fx_cost_high + 1·high_share`

- `duplicate`: another active subscription in the same category.
- `price_increase`: latest charge above the previous regime (FX-normalized).
- `trial_converted`: first paid charge after a trial within the last cycle.
- `low_usage`: usage below a threshold (for example fewer than 2 sessions per month) **only when usage data exists**; otherwise 0 and the item shows "no usage data".
- `fx_cost_high`: estimated FX markup above a threshold per year.
- `high_share`: subscription above a set share of monthly spending.

Weights are defaults to tune with pilot feedback (acceptance rate). Each recommendation shows which terms fired and their sources. The LLM writes the explanation; it never sets the score.

### 15.10 FX cost estimate

`annual_fx_cost = original_amount × cycles_per_year × rate × markup_pct`, with `markup_pct` configurable per card or bank **[verify typical values]**. Shown with the rate date and assumptions.

### 15.11 Prepaid purchase advisor

Inputs: package price `P` for `N` sessions; pay-per-visit price `q`; expected sessions `n_e` (asked from the user, default `N`); expected usage period `t` months (default 12); merchant annual closure probability `λ`; expected unused fraction at closure `u` (default 0.5); escrow available or not.

- Savings if the package is fully used: `S = N·q − P`.
- Break-even sessions: `k* = ⌈P / q⌉`. Below `k*` sessions, pay-per-visit is cheaper.
- Closure probability over the period: `λ_t = 1 − (1 − λ)^(t/12)`.
- Expected loss without escrow: `L = λ_t · u · P`. With escrow and an attested exit, the expected loss from closure is close to 0 (the residual risk is that no attestation arrives in time).
- Recommendation:
  - `n_e < k*` → pay per visit.
  - escrow available and `S > 0` → prepay through escrow.
  - no escrow and `S − L > 0` → prepay is still worth it, with the risk shown; otherwise pay per visit.
- `λ` default: 10% (2022 gym closure figure, Section 2.2.1, **[verify primary source]**). An "elevated" soft-signal level raises `λ` for new purchases (default ×3) and says so; nothing ever lowers it below the default without data.

**Lin's example:** `P = 6,000`, `N = 60`, `q = 125`. `S = 1,500`; `k* = 48`; `L = 0.10 × 0.5 × 6,000 = 300`. Advice: *"Prepay through escrow if you expect at least 48 visits. Without escrow, the expected loss from a closure is about ¥300."* All numbers come from this tool.

### 15.12 Hard and soft signals

**Attestation** (EIP-712): `{merchant, kind (1 = court_enforcement, 2 = closure_notice), caseRef (hash of the registry record ID), issuedAt, expiresAt}`, signed by the oracle key.

Valid for a T3 exit if and only if:
1. the recovered signer is the oracle address fixed in the contract (mirrored in app config);
2. `merchant` equals the plan's merchant;
3. `now ≤ expiresAt` and `now − issuedAt ≤ attestation_max_age_days` (the contract also enforces a fixed 2-day maximum);
4. `kind ∈ prepaid.auto_exit_on` (checked by the Gate only; the contract accepts both kinds from the oracle);
5. the plan is active and its owner is the user's registered wallet.

It is checked twice: by the Gate before Reins submits, and by the contract on chain.

**Soft signals:** complaint counts and news snippets, `origin = web` (simulated in v1). The Signal Reader returns `{level: none | watch | elevated, summary, source_ids}`. Effects: a warning in the feed and, for `elevated`, a higher `λ` in the advisor. They never reach the exit path.

---

## 16. Security

### 16.1 Threat model

| # | Threat | Example | Controls | Residual risk |
|---|---|---|---|---|
| T1 | Indirect prompt injection | Hidden text in a bill PDF or email | Quarantined Reader; provenance rules; no account parameter in tools | Measured by red team |
| T2 | Multi-turn escalation | "Just this once, raise my limit" | Agent cannot edit mandates; widening requires passkey + review | Measured |
| T3 | Mandate mis-compiled | "Under Rp500k" per bill vs per month | Ambiguity detection; read-back from DSL; diff; fail closed | Medium; measured on ambiguity set |
| T4 | Parser misreads amount | OCR error | Schema validation; anomaly check; registry-matched billers | Measured |
| T5 | Hallucinated numbers | LLM computes totals | Numbers from tools only; template explanations | Low |
| T6 | PII leakage to LLM provider | Account numbers or NIK in prompts | Tokenization before LLM calls; minimal context | Cross-border transfer must be reviewed |
| T7 | Replay / double execution | Network retry | Idempotency keys | Low |
| T8 | Race on caps | Parallel payments | Atomic reservation | Load-tested |
| T9 | Approval reuse | Approval for A used for B | Action-hash-bound, single-use tokens | Low |
| T10 | Mandate change mid-flight | Plan under v7, user narrows to v8 | Execution-time re-check | Low |
| T11 | Spoofed receipts via forwarding address | Forged "renewal" email | Email data untrusted; proposals only; sender allowlist | Medium |
| T12 | Data-source poisoning | Fake CSV rows | CSV data untrusted; cannot route money | Medium |
| T13 | Session/account takeover | Stolen session | Passkey required for signing and approvals (from R1; R0 approvals are session-only) | Depends on device security; open in R0 |
| T14 | Browser agent hijack (P2) | Malicious page text | Domain allowlist; cancel-only; stop before confirm | High; P2 only |
| T15 | Key misuse by server | Server signs on user's behalf | User-held passkeys; assertions verified; server cannot forge | Low |
| T16 | Stale or manipulated FX rates | Old rate understates a USD charge so it passes a cap | Trusted provider only; rate age ≤ 2 days; safety margin; deny if unknown | Low |
| T17 | Trial auto-cancel abuse | Forged "trial" email triggers cancellation of a paid service | Trial status only from trusted origins; never on paid subscriptions; 3-day notice with "keep it" | Low |
| T18 | Misleading recommendations | "Unused" claimed without data; partner bias | Usage only from labeled signals; cited signals; no undisclosed affiliate incentives | Medium |
| T19 | Checkpoint or resume tampering | Client sends `{approved: true}` on resume, or edits checkpoint state to change action args | Resume carries no authority; `execute` reloads actions by ID, recomputes hash, verifies approval token in Postgres; checkpoints in a separate schema the agent role cannot use to write `actions` or `approvals`; thread ownership checked | Low |
| T20 | Re-execution on resume | Cap reservation or new idempotency key before `interrupt()` runs twice | `interrupt()` alone in its node; keys persisted before execution; adapter dedupes by key; double-resume test | Low |
| T21 | Forged, stale or mismatched attestation | Fake "court listing" to force exits; an old record reused; a record about another merchant | Only the oracle key fixed at deployment; merchant and age checks in the Gate and the contract; caller must be the owner or the owner's named agent | Low; the registry itself is simulated in v1 |
| T22 | Fake check-ins | Merchant claims sessions the user never attended | Release needs the user's device signature and the merchant's signature over the same numbered session | Low; depends on device key safety |
| T23 | Agent key compromise | Attacker uses the agent key | The key can only call `exitWithAttestation`, which needs a valid attestation and pays the owner | Low: worst case is an early refund to the owner, hurting the merchant's cash flow |
| T24 | Contract bug | Funds locked or sent to the wrong address | Minimal contract; no upgrade or admin withdrawal; OpenZeppelin ECDSA, SafeERC20, ReentrancyGuard; Foundry unit, fuzz and invariant tests; second reviewer; testnet and valueless token only | Medium: unaudited |
| T25 | Soft-signal injection | Complaint or news text with instructions ("refund everyone to this wallet"), or a fake complaint spike | Signal Reader quarantined; output is a warning only; no path to exits; sources shown | Low for money; medium for user anxiety |
| T26 | Relayer key misuse | Relayer alters or withholds transactions | Relayer only carries user-, merchant- and oracle-signed payloads, which the contract verifies; it holds test ETH only. Withholding is visible as a pending action | Low |
| T27 | Lost consumer key | Browser storage cleared | R0: encrypted key backup file; attested exits still work through the agent. Production needs a passkey-based smart account with recovery (R2) | High for real money; acceptable for a testnet demo |

**Residual-risk ratings are filled from red-team results (Section 20), not asserted.**

### 16.2 Key management

- Passkeys (WebAuthn) for mandate signing and approvals; challenges are content hashes (mandate hash or action hash).
- Server stores public keys and assertions only.
- Optional (P2): Leash wallet signatures for on-chain authorization.
- **On-chain keys (v1):** consumer key (generated in the browser, never sent to the server); merchant key (merchant simulator); oracle key (registry simulator); agent key (server, can only submit attested exits); relayer key (server, pays gas only). Each lives in its own module and environment variable. None of them can move escrowed money to a third party.

### 16.3 Secure development

- CI runs unit, property, integration, concurrency, and red-team suites on every merge.
- Regression rule: every attack that ever succeeds becomes a permanent test.
- Dependency scanning; secrets in a vault; least-privilege database roles.
- Pinned exact versions for the agent framework packages; upgrades only with the full suite green.

---

## 17. Privacy and Compliance

### 17.1 Data handling

- **Minimization:** store derived data (transactions, bills, subscriptions); raw documents and emails encrypted with a retention limit (default 30 days), then deleted.
- **LLM calls:** tokenize PII (account numbers, NIK, phone numbers, names) before sending; no raw documents to the Planner.
- **No training on user data** by us; check LLM provider terms **[verify]**.
- **Deletion:** user-initiated deletion of all data within 7 days.
- **Consent records** per source with versioned text (F1).

### 17.2 Indonesia

- **UU PDP (Law No. 27 of 2022)** applies: describe concrete measures (consent, minimization, retention, deletion, security) rather than claiming compliance. Using a cloud LLM sends personal data abroad; review the law's cross-border transfer requirements **[verify]**.
- **No real money movement in v1.** Executing payments for others as a service would fall under Bank Indonesia payment service provider licensing; production requires a licensed partner.
- **Crypto:** as far as we know, Bank Indonesia prohibits crypto as a payment instrument **[verify]**; Reins does not use crypto for payments.

### 17.3 China (CSV path)

- Personal Information Protection Law (PIPL) applies to Chinese users' data; v1 demos use **synthetic data only**.
- Shenzhen auto-renewal guideline (July 2026): no pre-checked boxes, forced bundling, or hidden terms; prominent reminder at least 5 days before each renewal; convenient cancellation. It is a recommended guideline without direct penalties. Reins' default `renewal_notice_days: 5` mirrors it from the consumer side.
- Cancellation of auto-deduction agreements is centralized in Alipay/WeChat Pay but only the platform can revoke them; integration would require a partnership.

### 17.4 Prior work and IP

- Reins builds on **Leash** (NTU InnovateX Hackathon 2026). Disclose this in documentation. The escrow contract is new code, but it reuses Leash's tooling and test style (Foundry, Base Sepolia).
- The Leash repository has no license file; all its authors co-own the code. Obtain consent before reusing code, and check NTU InnovateX rules on IP.

### 17.5 Related standards and work

- Cite **AP2** (Agent Payments Protocol) as related work: Intent, Cart, and Payment Mandates as signed Verifiable Credentials. Reins is "inspired by", not "compliant with".

### 17.6 On-chain and e-CNY (v2.0)

- v1 uses a public testnet (Base Sepolia) and a test token with **no monetary value**. No real crypto asset is bought, sold, held for users, or used for payment.
- Mainland China prohibits crypto trading and its use for payment **[verify current rules]**; Bank Indonesia prohibits crypto as a payment instrument (17.2). A production version belongs on a licensed programmable-money rail, such as e-CNY smart contracts through an operator bank (the 元管家 model), not on a public chain.
- Merchant data, attestations and complaint signals in v1 are simulated. Real court or closure data would need licensed access and a PIPL review **[verify]**.
- The escrow pattern is borrowed openly from 元管家, and the docs cite it.

---

## 18. UX Requirements

### 18.1 Core screens

| # | Screen | Key elements |
|---|---|---|
| 1 | **Home** | Upcoming bills and renewals (next 14 days), balance, items waiting for approval, kill switch |
| 2 | **Activity feed** | Every action with tier badge (🟢 T3, 🟡 T2, 🔵 T1, 🔴 denied), rule citation, "Why?" |
| 3 | **Approval sheet** | Bottom sheet (mobile) / modal (desktop); amount, payee, reason, rule, data origin, expiry; approve with passkey |
| 4 | **Mandate Card** | Current rules in plain language, version and signature time, diff history, interruption budget, worst-case daily exposure |
| 5 | **Chat** | Questions, tasks, rule-change requests (opens editor) |
| 6 | **Subscriptions** | Active / Inactive / Cancelled; price changes; renewal dates; trials with auto-cancel status and "keep it"; ranked recommendations with cited signals; IDR equivalents for foreign subscriptions; "Find Transactions" |
| 7 | **Data sources** | Connected sources, consent details, revoke |
| 8 | **Evidence viewer** (desktop-first) | Audit log, hash-chain status, export |
| 9 | **Summary & insights** | Income vs spending, categories, recurring obligations, next 14 days, balance after obligations, FX cost; every number links to transactions |
| 10 | **Prepaid** | Packages with sessions left and balance in escrow; merchant risk status with signals and sources; advisor card before buying; check-in; exit; transaction links |

### 18.2 Interaction rules

- Approval cards are rendered from tool-call arguments; LLM text appears only as a labeled explanation.
- Every number displayed has a tooltip with its source.
- Denials explain what would make the action allowed (for example "add this biller in Payees").
- Destructive or widening actions use a distinct visual style and require passkey.

### 18.3 Copy principles

- Plain language; English in the R0 demo, Indonesian first for the validation market; no jargon ("tier" shown as an icon plus a short label; "escrow" explained as "held safely until you use it").
- Never claim certainty the system doesn't have ("We think this is a subscription" until confirmed).

### 18.4 States

- Empty states guide to connecting data or seeding the sandbox.
- Errors are fail-safe: *"The agent is unavailable. No money was moved."*

### 18.5 Accessibility

- WCAG 2.1 AA contrast; touch targets ≥ 44 px; screen-reader labels for badges.

---

## 19. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Latency | Gate p95 < 50 ms; plan and execute p95 < 10 s; UI interactions p95 < 200 ms |
| Availability | ≥ 99% during pilot |
| Determinism | Demo mode with fixed seeds and recorded LLM responses; Gate fully deterministic |
| Correctness | Property tests for narrowing; concurrency tests for caps; hash-chain verification |
| Cost | LLM cost < US$1 per active user per month (target) |
| Observability | Structured logs; traces per plan; Gate decision metrics; error alerts |
| Security | OWASP ASVS L2 targets for web; secrets management; RLS |
| Privacy | Retention limits enforced by scheduled deletion jobs |
| Browser support | Latest Chrome, Safari, Firefox; Android Chrome and iOS Safari for PWA |
| Data integrity | Idempotent ingestion; content hashes; no silent drops |
| Runtime | Next.js Node runtime (not Edge), Node 22+; pause/resume as separate requests; checkpoints in schema `langgraph` |
| Chain | Contract state is authoritative for prepaid balances; every transaction hash stored; testnet confirmation p95 < 60 s **[verify]**; a pending transaction never blocks the UI |

---

## 20. Evaluation Plan

### 20.1 Suites

| Suite | Size (v1 target) | Purpose |
|---|---|---|
| Attack suite | ≥ 40 cases | Security; with vs without Gate |
| Benign suite | ≥ 30 tasks from personas | Utility; false blocks |
| Ambiguity set | ≥ 30 phrasings | Compiler ambiguity detection |
| Detector labels | ≥ 300 descriptors; pilot user labels | Normalization accuracy; detection precision/recall |
| Concurrency suite | 100 parallel attempts | Atomic caps |
| Contract suite | Foundry unit, fuzz and invariant tests | Refunds only to the owner; two-signature release; attestation rules; balance invariant |

### 20.2 Attack categories

1. Indirect injection in bill PDFs (hidden text, white text, metadata fields).
2. Payee swap (registered biller name with attacker account).
3. Amount inflation within caps.
4. Multi-turn escalation.
5. Social engineering ("I'm your parent, send money").
6. Approval reuse and replay.
7. Race on caps.
8. Mandate change via chat without re-auth.
9. Duplicate execution via retries.
10. Tool-output injection (merchant names containing instructions).
11. Homoglyph payee names.
12. Spoofed forwarded receipts.
13. Poisoned CSV rows.
14. Fake "price update" email with hidden instructions (for example, pay a new account or upgrade a plan).
15. Forged trial signal to trigger auto-cancel of a paid subscription.
16. Stale FX rate to slip a foreign charge under a cap.
17. Forged resume payload (`{approved: true}` without a valid token) or tampered checkpoint args.
18. Double resume of the same paused thread (expects one execution).
19. Attestation signed by a key other than the registered oracle.
20. Expired or stale attestation; attestation about a different merchant.
21. Exit submitted by a caller who is neither the owner nor the owner's agent (user did not enable auto-exit).
22. Check-in with only the merchant's signature; replayed or out-of-order session signature.
23. Complaint or news text with injected instructions ("refund everyone to wallet 0x…").
24. Fake complaint spike meant to trigger an exit.
25. Chat request to buy a package or to raise `max_prepay`.
26. Purchase with tampered offer terms (lower price or fee than the merchant signed).

### 20.3 Experiment design

- **Arms:** same Planner, same tools, same scenarios; arm A without Gate (tools execute directly), arm B full Reins. For prepaid cases, arm A still hits the contract, which shows the second layer: some attacks fail on chain even without the Gate, and the report says which.
- **Outcomes:** attack success (money moved or mandate changed against policy), task success, false blocks, latency, cost.
- **Statistics:** for 0 successes in n trials, 95% upper bound = `1 − 0.05^(1/n)` (n = 20 → 13.9%; n = 40 → 7.2%); Clopper-Pearson intervals otherwise.
- **Utility vs security:** report the trade-off explicitly (for reference, CaMeL reports 77% of AgentDojo tasks with provable security vs 84% undefended).

### 20.4 Reporting

- Generated report (JSON + Markdown table) per CI run; tracked over time.
- Known-risk list maintained from failures and untested categories.

---

## 21. Release Plan and Milestones

### 21.1 Releases

| Release | Date | Scope |
|---|---|---|
| **R0: Hackathon cut** | Final by Oct 20, 22:59 WIB (team target 18:00) | Demo persona Lin (CNY); mock bank; **financial summary**; pay bills with injection blocked; subscription detection (**FX-normalized**, base-currency equivalents) with **ranked recommendations** and **simulated usage signals**; cancel with one-tap approval plus **trial auto-cancel**; **prepaid module: advisor, escrow purchase, check-in with two signatures, attested exit (T3), with three real Base Sepolia transaction hashes**; mandate create/edit with read-back and diff; Gate with tiers, provenance, atomic caps; audit log; eval harness (≥ 20 attacks including prepaid cases, with/without Gate); responsive web + PWA. **Fallback:** if the testnet spike fails by Oct 17, 18:00 WIB, the prepaid flow runs on a mock escrow in the mock bank (same interface) and the on-chain claim is dropped |
| **R1: Alpha** | End of week 4 (Nov 10) | Passkey signing; ambiguity detection; property tests; e-statement upload; email forwarding; merchant normalization; China CSV import; approvals with web push; Mandate Card complete; prepaid: merchant dispute window before attested exits, `setAgentBySig`, soft-signal sources beyond simulation **[verify access]** |
| **R2: v1 Pilot** | End of week 8 (Dec 8) | Savings sweep; budgets and insights; gateway test-mode adapter; Expo app (push, biometrics); Android notification listener (if policy allows); Gmail testing mode; aggregator adapter (if onboarding completes); passkey-based smart account with recovery for the prepaid wallet; talks with an e-CNY operator bank about the 元管家 rail; pilot with 20 to 30 users; full evaluation at n ≥ 40 |

### 21.2 Week-by-week (8 weeks)

| Week | Dates | Focus |
|---|---|---|
| 1 | Oct 14 to Oct 20 | R0: core platform, Gate, mock bank, summary, bills, subscriptions (FX-aware, recommendations, trial auto-cancel), prepaid escrow on Base Sepolia, mandate edit, harness, PWA, hackathon submission |
| 2 | Oct 21 to Oct 27 | Passkey signing, approval tokens hardening, execution-time re-check, concurrency tests |
| 3 | Oct 28 to Nov 3 | Compiler ambiguity detection, property tests for narrowing, Mandate Card (exposure, α) |
| 4 | Nov 4 to Nov 10 | Real-data ingestion: e-statements, email forwarding, normalization, China CSV; R1 |
| 5 | Nov 11 to Nov 17 | Savings sweep, budgets; FX cost estimate and local-billing suggestions; self-report usage check-ins; gateway test mode; start Expo app; recruit pilot users |
| 6 | Nov 18 to Nov 24 | Expo push and biometrics; notification listener prototype. **Note:** FinTechathon finals Nov 21 to 23 (on-site 48-hour hackathon if selected); keep this week light |
| 7 | Nov 25 to Dec 1 | Pilot starts; Gmail testing mode; aggregator adapter if available; red team to n ≥ 40 |
| 8 | Dec 2 to Dec 8 | Pilot metrics, precision/recall, privacy hardening, docs; R2 |

### 21.3 Exit criteria for v1

- All P0 features pass acceptance criteria.
- Attack suite n ≥ 40 run in both arms; results reported with upper bounds.
- False-block rate and benign task success measured.
- Pilot with at least 20 users completed; trust survey collected.
- Privacy controls (retention, deletion, consent revocation) verified.

---

## 22. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Compiler mistranslates rules | Wrong permissions | Ambiguity detection; read-back from DSL; fail closed; diff |
| Data access in Indonesia is fragmented | Weak detection | Multiple adapters; user-assisted uploads; "Find Transactions" |
| Aggregator onboarding delays | Missing live data | Start in week 1; e-statement and email paths independent |
| Gmail restricted-scope requirements | Limited email access | Forwarding address first; testing mode for pilot |
| Play Store policy blocks notification listener | No e-wallet signal | APK pilot; not a P0 dependency |
| Live demo failure | Lost points | Recorded LLM responses; seeded data; backup video |
| Judges see a clone (Rocket Money / FinAgent) | Low innovation score | Lead with blocked attack and with/without-Gate numbers |
| Overclaiming security | Credibility loss | Upper bounds; known-risk list; simulated data labeled |
| Privacy and cross-border data | Legal exposure | Tokenization; minimization; legal review **[verify]** |
| Leash IP | Disqualification or dispute | Disclosure; co-author consent |
| Scope creep over 8 weeks | Nothing finished | Priority tiers; release gates R0, R1, R2 |
| LLM cost growth | Unsustainable pilot | Small models for Reader/Explainer; caching; cost metric in CI |
| Agent framework churn (weekly LangGraph/LangChain releases) | Breakage mid-build | Pin exact versions; invariants outside the framework; plain Anthropic SDK loop as fallback |
| Supabase pooler or Vercel limits misbehave with the checkpointer | Paused runs cannot resume | Test on Day 1; direct connection for `setup()`; session pooler as fallback |
| Team relies on graph wiring or middleware for security | Gate bypass | Harness invariants H1 to H9; canary, forged-resume and double-resume tests in CI |
| Testnet faucet or RPC unavailable | No transaction hashes | Fund all addresses on Day 1; second RPC provider; mock-escrow fallback with the same interface |
| Bug in an unaudited contract | Locked or misrouted test funds; credibility | Minimal contract; fuzz and invariant tests; second reviewer; testnet and valueless token only |
| Judges question public-chain use for a China scenario | Compliance doubt | Valueless token; production path is e-CNY through an operator bank; say it before they ask (Section 2.7) |
| Prepaid module makes R0 two half-finished products | Low task-completion score | Prepaid is one complete flow (buy, check in, exit); cut order in `roles.md` |
| Merchant adoption (元管家 has 61 merchants) | Weak business case | Voluntary-exit fee in the merchant's terms; don't overclaim |
| Bonus not available to Topic A entries | Less upside | Ask the organizers now; the module still supports the security and innovation scores |
| Lost consumer key | Refund goes to an address nobody controls | Testnet only; encrypted backup; smart account with recovery in R2 |

---

## 23. Dependencies and Assumptions

**Dependencies:**
- LLM provider with reliable tool calling.
- Supabase (Postgres, Auth), Vercel hosting, object storage.
- LangGraph.js and the Postgres checkpointer (`@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`); LangSmith free tier for tracing (optional).
- WebAuthn support in target browsers and devices.
- Optional: payment gateway test mode; aggregator partner; Google API access; Expo build services.
- Base Sepolia, two RPC providers, a faucet for test ETH; Foundry; OpenZeppelin Contracts (v5); viem (server and browser).

**Assumptions:**
- Pilot users accept manual uploads or forwarding while live connections are limited.
- Sandbox evidence is acceptable for the hackathon (stated in the rules for non-on-chain topics). Testnet transaction hashes count as on-chain evidence **[verify with the organizers]**.
- Users prefer bounded automation over full autonomy (to be validated by interviews and the trust survey).

---

## 24. Out of Scope for v1

- Real-money settlement and production licensing.
- Investment advice, portfolio management, credit products.
- Shared or family finances.
- Chinese-language UI and direct Alipay/WeChat integration.
- iOS App Store release.
- SMS reading and internet-banking scraping (never).
- Fine-tuning models on user data.
- Real e-CNY integration, mainnet deployment, real court or complaint data.

---

## 25. Open Questions

**For the organizers (questions: info@ican-x.com; registration: fintechathon@ican-x.com):**
1. ~~Is the International-track deadline October 20 or November 1?~~ Closed: the rules state registration and submission both close October 20, 23:59 Beijing time (22:59 WIB).
2. Is any dataset, sandbox, or API provided this year?
3. How many members per finalist team are invited to Shenzhen?
4. Do testnet transactions count as on-chain evidence, and can non-Topic-F entries earn the bonus?

**Product and technical:**
5. Which aggregators currently operate in Indonesia, and which banks do they cover? **[verify]**
6. Exact Gmail restricted-scope limits and assessment requirements? **[verify]**
7. Real CSV headers for WeChat Pay and Alipay exports; WeChat auto-renewal menu path? **[verify]**
8. Payment-gateway test-mode availability before business verification? **[verify]**
9. UU PDP cross-border transfer requirements for cloud LLM usage? **[verify]**
10. Do any Indonesian apps already offer subscription tracking or cancellation? (check before claiming "no local equivalent")
11. Leash co-author consent and NTU InnovateX IP rules.
12. Venues for CNFinBench (KDD 2026?) and Takayanagi et al. (SIGIR 2025?) **[verify]**
13. Does the LangGraph.js Postgres checkpointer work through Supabase's transaction pooler? **[verify on Day 1]**
14. Primary source for the 2022 gym closure rate (10.39%). **[verify]**
15. Exact article for the 30-day closure notice and the stop on prepayments. **[verify]**
16. Is WeBank an e-CNY operator? Seen as a wallet provider for 元管家 in 2022 coverage; do not claim "Tier-2 operator" until verified.
17. Can foreigners use 元管家 and e-CNY smart contracts? (ask the team's friends in mainland China)
18. Base Sepolia faucet limits for five funded addresses (relayer, agent, deployer, merchant, consumer). **[verify Day 1]**

**Ask the organizers now (v2.0):** question 4 decides whether the prepaid module earns the bonus; send it with the registration follow-up.

---

## 26. Glossary

| Term | Meaning |
|---|---|
| Reins | Product name: the user holds the reins, the agent does the work |
| Mandate | User-signed, versioned money rules the agent must follow |
| Policy Gate | Deterministic code deciding allow / require_confirm / deny for every action |
| Provenance label | Tag on every value stating where it came from (registry, document, email, etc.) |
| Narrowing / widening | Reducing / expanding what a mandate allows |
| Approval token | Single-use, expiring authorization bound to the exact action arguments |
| Interruption budget (α) | Maximum probability that a normal bill asks for confirmation (conformal option) |
| Worst-case daily exposure | Maximum money that can leave per day if the agent is fully compromised |
| Planner / Reader / Explainer | Privileged planning LLM / quarantined document LLM / log-grounded explanation LLM |
| Plan-Then-Execute, Dual LLM | Security patterns that fix plans from trusted input and isolate untrusted data |
| Idempotency key | ID ensuring a retried action executes once |
| Hash-chained audit log | Log where each entry includes the previous entry's hash, making tampering detectable |
| PWA | Progressive Web App: a website installable on the home screen |
| WebAuthn / passkey | Standard for signing with device biometrics or PIN |
| PFM | Personal finance management apps |
| FX normalization | Converting amounts to a common currency at the right date before comparing them |
| Trial auto-cancel | Optional mandate rule that cancels a free trial before it converts to paid, without per-action approval |
| Usage signal | Evidence of how often a subscription is used (simulated, self-reported, or from an API) |
| LangGraph / StateGraph | Agent framework that runs LLM steps as nodes of a graph with shared, typed state |
| Checkpointer | Stores graph state after each step so a paused run can resume later |
| `interrupt()` | LangGraph call that pauses a run (here: waiting for approval); the node restarts from the beginning on resume |
| Prepaid package | Services paid before delivery, such as 60 gym sessions |
| Escrow | Money held by a contract until conditions are met; here, until a session is delivered |
| 元管家 | e-CNY smart-contract service for prepaid consumption, launched by the PBOC's Digital Currency Research Institute in 2022 |
| e-CNY | China's central bank digital currency (digital renminbi) |
| Attestation | A signed record (court enforcement listing, closure notice) that can authorize an exit |
| Oracle | The registered signer of attestations; simulated in v1 |
| Hard / soft signal | Signals that can authorize an exit (signed attestations) / signals that can only warn (complaints, news) |
| Relayer | Server account that pays gas and submits user-signed payloads; it cannot change them |
| EIP-712 | Standard for signing typed, human-readable data with an Ethereum key |
| Permit (EIP-2612) | Signed approval that lets the contract pull tokens without a separate transaction |
| Testnet | Public blockchain for testing; its tokens have no value (here: Base Sepolia, tCNY) |

---

## 27. References

**Research:**
- Progent: Securing AI Agents with Privilege Control. https://arxiv.org/abs/2504.11703
- CaMeL: Defeating Prompt Injections by Design. https://arxiv.org/abs/2503.18813
- Design Patterns for Securing LLM Agents against Prompt Injections. https://arxiv.org/abs/2506.08837
- The Automated but Risky Game. https://arxiv.org/abs/2506.00073
- CNFinBench. https://arxiv.org/abs/2512.09506
- Are Generative AI Agents Effective Personalized Financial Advisors? https://arxiv.org/abs/2504.05862
- τ²-Bench (from team plan, unchecked). https://arxiv.org/abs/2506.07982
- AP2 overview (Vellum). https://www.vellum.ai/blog/googles-ap2-a-new-protocol-for-ai-agent-payments

**Harness:**
- LangGraph.js interrupts. https://docs.langchain.com/oss/javascript/langgraph/interrupts
- LangGraph.js human-in-the-loop. https://docs.langchain.com/oss/javascript/langgraph/add-human-in-the-loop
- LangGraph v1 migration (JS). https://docs.langchain.com/oss/javascript/migrate/langgraph-v1
- LangChain custom middleware. https://docs.langchain.com/oss/javascript/langchain/middleware/custom
- Vercel function limits. https://vercel.com/docs/functions/limitations
- AI SDK 7. https://vercel.com/changelog/ai-sdk-7

**Competition:**
- International Track rules (team copy: `international-topics-rules-en.docx`)
- 2026 edition (iFeng): https://tech.ifeng.com/c/8wJG9eH2KFs
- 2025 results (People's Daily): https://www.peopleapp.com/column/30051004536-500007261769

**Prior work:**
- Leash: https://github.com/hendrakurn/leash and https://devpost.com/software/leash-0f31yq

**Prepaid consumption and e-CNY (v2.0):**
- CCTV on prepaid consumption, store closers and fund custody (March 2025): https://news.cctv.com/2025/03/16/ARTIFby8SEFM3FGFDNbkjaDq250316.shtml
- Sina Finance, hands-on with 元管家 (September 2022): https://finance.sina.com.cn/jjxw/2022-09-08/doc-imqmmtha6532652.shtml
- China Securities Journal, Bank of Communications e-CNY prepaid contract (September 2022): https://www.cs.com.cn/xwzx/hg/202209/t20220909_6297327.html
- Yicai, e-CNY smart contracts and prepaid funds (July 2024): https://www.yicai.com/news/102199858.html
- Tencent News, adoption problems and the Qingdao refund (July 2024): https://news.qq.com/rain/a/20240729A07VYO00
- mpaypass, refund experience with 元管家 (July 2024): https://m.mpaypass.com.cn/news/202407/12094130.html
- Yangzhou Evening News, Postal Savings Bank 元管家 for tutoring (June 2026): https://www.yzwb.net/news/juc/202606/t20260624_365698.html
- The Paper, WeChat Pay supports e-CNY quick pay (March 2023): https://m.thepaper.cn/newsDetail_forward_22161660

**Market and data access:**
- Rocket Money: https://www.rocketmoney.com/
- Rocket Money help: https://help.rocketmoney.com/en/articles/1940551-how-to-get-the-most-out-of-rocket-money , https://help.rocketmoney.com/en/articles/934383-missing-subscriptions , https://help.rocketmoney.com/en/articles/2185531-managing-your-bills-and-subscriptions
- Aggregators covering Indonesia: https://openbankingtracker.com/api-aggregators?country=ID
- Open banking fintechs in Indonesia: https://ibsintelligence.com/ibsi-news/4-fintechs-offering-open-banking-solutions-in-indonesia/

**China auto-renewal:**
- Shenzhen guideline (July 2026): https://www.sznews.com/news/content/2026-07/08/content_32115084.htm
- Xinhua investigation (December 2025): https://www.news.cn/politics/20251224/397baff1ef554b61a1668e771b5474f6/c.html
- Alipay auto-deduction check: https://www.yzwb.net/news/jiangsu/202509/t20250915_264460.html
- WeChat Pay / Alipay bill export: https://www.ifanr.com/app/1185339
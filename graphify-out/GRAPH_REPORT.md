# Graph Report - reins  (2026-10-19)

## Corpus Check
- 281 files · ~248,184 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2009 nodes · 4900 edges · 146 communities (127 shown, 19 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 97 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b5eb136f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lin-seed.ts
- recurring.ts
- lin.ts
- ModelClient
- bank.ts
- decide.ts
- fakes.ts
- api-types.ts
- models.test.ts
- graph.ts
- index.ts
- upload.test.ts
- attestations.ts
- recommendation.ts
- compilerOptions
- withUserTx
- summary.ts
- run.ts
- job.ts
- api-schemas.ts
- graph.ts
- route.ts
- devDependencies
- run.ts
- http.ts
- types.ts
- compile.ts
- views.ts
- dependencies
- 8. Functional Requirements
- record-demo-main.ts
- mockbank.ts
- actionHash
- helpers.ts
- db.integration.test.ts
- repo.ts
- cards.ts
- Reins: Team Roles and Responsibilities
- storage.ts
- graph.ts
- quarantine.test.ts
- Reins: Product Requirements Document (PRD) v2
- explain.ts
- graph.test.ts
- demo-script.ts
- reader.test.ts
- Reins: System Architecture
- 24. On-chain Prepaid Escrow Module
- gen-fixture-pdfs.ts
- 15. Algorithms
- redact.ts
- MemoryPlans
- index.ts
- signals.ts
- 20261017000002_data_tables.sql
- Reins: R0 Task Checklist
- wiring.ts
- 20261017000006_mockbank.sql
- 11. Agent Design
- 12. System Architecture and Key Flows
- Core Algorithms
- planner.ts
- 20261017000003_execution_tables.sql
- 20261017000004_prepaid_tables.sql
- Reins: Agent Instructions
- 0. Tech Stack at a Glance
- 10. Policy Gate Specification
- 2. Problem
- scripts
- quarantine.ts
- advisor.ts
- 6. Agent Runtime (LangGraph.js)
- 14. Key Sequences
- 17. Privacy and Compliance
- 9. Mandate DSL Specification
- Agent Design
- Prompt-Injection Defenses
- index.ts
- 18. UX Requirements
- routes.test.ts
- layout.tsx
- 19. Environments, Configuration, and Deployment
- 8. Execution Path and Approvals
- 14. APIs and Agent Tools
- 20. Evaluation Plan
- 4. Users and Personas
- evals
- package.json
- routes.test.ts
- 10. Ingestion and Provenance
- 12. Data Architecture
- 15. Frontend
- 16. Security Architecture
- 18. Testing and Evaluation Architecture
- 1. Architectural Drivers
- 7. Policy Gate
- 16. Security
- 21. Release Plan and Milestones
- 3. Goals, Non-Goals, and Success Metrics
- 6. Topic A Fit, Business Model, and Impact
- eslint.config.mjs
- 20261017000005_rls.sql
- 11. Detectors, Scheduler, and Triggers
- 9. Mandate Service
- 20261017000007_eval.sql
- cron-route.test.ts
- page.tsx
- CLAUDE.md
- fast-check
- @langchain/langgraph
- @langchain/langgraph-checkpoint-postgres
- next.config.ts
- unpdf
- checkpointer-setup.ts
- 20261017000008_documents_status.sql
- 20261017000009_document_trigger_langgraph_grants.sql
- GET
- POST
- GET
- POST
- GET
- POST
- isoTimestamp
- deps.ts
- getSessionUserId
- Contributing to Reins
- DocumentRepo
- signals.ts
- rules.tsx
- index.ts
- format.ts
- anomaly.ts
- route.ts
- route.ts
- chat.tsx
- @langchain/core
- pg
- zod
- tailwindcss

## God Nodes (most connected - your core abstractions)
1. `ModelClient` - 37 edges
2. `withUserTx()` - 32 edges
3. `Reins: Product Requirements Document (PRD) v2` - 32 edges
4. `ChatRequest` - 29 edges
5. `ChatResponse` - 27 edges
6. `Reins: System Architecture` - 27 edges
7. `getPool()` - 26 edges
8. `parseRows()` - 24 edges
9. `StructuredRequest` - 22 edges
10. `getMockbankPool()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `visibleBill()` --indirect_call--> `text()`  [INFERRED]
  scripts/gen-fixture-pdfs.ts → tests/e2e/demo-script.ts
- `listPendingCards()` --indirect_call--> `tx()`  [INFERRED]
  app/api/approvals/_lib/cards.ts → tests/read/lin-seed.ts
- `run()` --indirect_call--> `isUuid()`  [INFERRED]
  app/api/cron/cleanup/route.ts → src/server/auth/session.ts
- `run()` --indirect_call--> `isUuid()`  [INFERRED]
  app/api/cron/detect/route.ts → src/server/auth/session.ts
- `toLabeled()` --indirect_call--> `field()`  [INFERRED]
  src/agent/nodes/reader/graph.ts → tests/e2e/demo-script.ts

## Import Cycles
- None detected.

## Communities (146 total, 19 thin omitted)

### Community 0 - "lin-seed.ts"
Cohesion: 0.05
Nodes (32): AccountRow, BillRow, FxRateRow, PrepaidOfferRow, PrepaidPlanRow, PrepaidSessionRow, RecommendationRow, ReadRepos (+24 more)

### Community 1 - "recurring.ts"
Cohesion: 0.11
Nodes (40): AnomalyResult, conformalAnomaly(), conformalMinHistory(), ConformalResult, fxNormalizedAnomaly(), madAnomaly(), MadOptions, cadence() (+32 more)

### Community 2 - "lin.ts"
Cohesion: 0.11
Nodes (29): RFC-4122, arg(), isReplayable(), main(), printFlow(), createPgDocumentRepo(), IngestResult, AttackIndex (+21 more)

### Community 3 - "ModelClient"
Cohesion: 0.11
Nodes (12): RecordingModelClient, ChatRequest, ChatResponse, ModelClient, StructuredRequest, ScriptedModelClient, SpyModelClient, CapturedStructured (+4 more)

### Community 4 - "bank.ts"
Cohesion: 0.12
Nodes (38): Ctx, GET(), POST(), cancelSubscription(), createPayment(), emit(), escrowExit(), getEscrowPlan() (+30 more)

### Community 5 - "decide.ts"
Cohesion: 0.20
Nodes (21): ageDays(), cancelSubscription(), caps(), checkMandate(), CONDITIONAL_AMOUNT_ORIGINS, decide(), ownedActivePlan(), payBill() (+13 more)

### Community 6 - "fakes.ts"
Cohesion: 0.12
Nodes (6): PlanStore, ToolContext, ActionExecutorPort, GateResult, FakeWorld, ruleFor()

### Community 7 - "api-types.ts"
Cohesion: 0.13
Nodes (26): GET(), GET(), GET(), GET(), POST(), GET(), GET(), ApiError (+18 more)

### Community 8 - "models.test.ts"
Cohesion: 0.14
Nodes (24): modelIdsFromEnv(), createModelClients(), parseMode(), ROLES, loadRecordings(), RecordedModelClient, RecordedModelClientOptions, RecordingMissError (+16 more)

### Community 9 - "graph.ts"
Cohesion: 0.16
Nodes (26): afterExecute(), afterLoadContext(), afterPersist(), afterPlanner(), afterPreview(), afterReader(), buildGraph(), needsSignals() (+18 more)

### Community 10 - "index.ts"
Cohesion: 0.14
Nodes (23): ToolSpec, getBalance, listBills, listTransactions, defineReadTool(), ToolDeps, zCurrency, zDate (+15 more)

### Community 11 - "upload.test.ts"
Cohesion: 0.17
Nodes (12): DocumentRepo, DocumentRow, DocumentType, documentKey(), IngestDeps, ingestUpload(), sha256Hex(), sniffPdf() (+4 more)

### Community 12 - "attestations.ts"
Cohesion: 0.15
Nodes (17): ATTESTATION_VARIANTS, AttestationVariant, Store, STORE_KEY, ATTESTATION_KIND_CODE, ATTESTATION_PRIMARY_TYPE, ATTESTATION_TYPES, AttestationJson (+9 more)

### Community 13 - "recommendation.ts"
Cohesion: 0.11
Nodes (27): computeSavings(), cyclesPerYear(), fxCostEstimate(), FxCostInput, FxCostResult, SavingsInput, SavingsResult, fmt() (+19 more)

### Community 14 - "compilerOptions"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 15 - "withUserTx"
Cohesion: 0.10
Nodes (28): RFC-8785, actionHash(), canonical(), hashPolicy(), sha256Hex(), Trigger, consumeApproval(), createApproval() (+20 more)

### Community 16 - "summary.ts"
Cohesion: 0.13
Nodes (19): baseAmountOf(), capitalize(), computeSummary(), Insight, KIND_ORDER, SETTLED_BILL_STATUSES, SummaryBill, SummaryInput (+11 more)

### Community 17 - "run.ts"
Cohesion: 0.10
Nodes (20): Cfg, client(), createMockbankSettlement(), createMockEscrow(), MockbankTransport, ChainResult, EscrowAdapter, EscrowPlanState (+12 more)

### Community 18 - "job.ts"
Cohesion: 0.13
Nodes (18): attestationVerifies(), prepaidFacts(), AttestationWire, freshness(), FreshnessReason, recoverAttestationSigner(), VerifiedAttestation, verifyAttestation() (+10 more)

### Community 19 - "api-schemas.ts"
Cohesion: 0.08
Nodes (24): Assert, ChainTxRef, Checks, date, Equal, FxMoney, iso, KeepTrialResponse (+16 more)

### Community 20 - "graph.ts"
Cohesion: 0.16
Nodes (15): buildSignalReaderGraph(), SignalReaderDeps, SignalReaderInvalidOutput, createSignalReader(), signalReaderInput(), SignalBundle, SignalFetcher, SignalWarningOutput (+7 more)

### Community 21 - "route.ts"
Cohesion: 0.46
Nodes (7): accessTokenFromCookies(), getSession(), isUuid(), parseCookies(), Session, supabaseConfig(), verifySupabaseToken()

### Community 22 - "devDependencies"
Cohesion: 0.09
Nodes (23): eslint, eslint-config-next, fast-check, devDependencies, eslint, eslint-config-next, fast-check, supabase (+15 more)

### Community 23 - "run.ts"
Cohesion: 0.10
Nodes (15): json(), POST(), ResumeBody, PlanNotFoundError, PlanRegistry, PlanStatus, resumePlan(), runConfig() (+7 more)

### Community 24 - "http.ts"
Cohesion: 0.19
Nodes (16): GET(), POST(), GET(), bearer(), safeEqual(), simAdminOk(), simReadOk(), listAttestations() (+8 more)

### Community 25 - "types.ts"
Cohesion: 0.16
Nodes (12): AnthropicModelClient, fingerprint(), isRecord(), mapStopReason(), ModelIds, ModelRefusalError, StructuredOutputError, toInputSchema() (+4 more)

### Community 26 - "compile.ts"
Cohesion: 0.18
Nodes (15): ModelClients, compile(), CompileResult, MandateCompileError, act(), readback(), Act, AttestationKind (+7 more)

### Community 27 - "views.ts"
Cohesion: 0.10
Nodes (37): RiskLevel, AdviceOptions, buildAdvice(), buildPrepaidOffers(), buildPrepaidPlans(), buildRiskSignals(), buildSavings(), chargesByMerchant() (+29 more)

### Community 28 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, canonicalize, @langchain/anthropic, @langchain/langgraph-checkpoint-postgres, next, dependencies, @anthropic-ai/sdk, canonicalize (+13 more)

### Community 29 - "8. Functional Requirements"
Cohesion: 0.10
Nodes (21): 8. Functional Requirements, F10. Activity Feed, Explanations, Evidence (P0), F11. Savings Sweep (P1), F12a. Financial Summary and Spending Insights (P0), F12b. Budgets (P1), F13. Settlement Adapters, F14. Platforms, F15. Evaluation and Red-Team Harness (P0) (+13 more)

### Community 30 - "record-demo-main.ts"
Cohesion: 0.29
Nodes (10): setMockbankPool(), decideApproval(), setPool(), prepaidUser(), trialUser(), adminPool(), createTestUser(), inProcessTransport() (+2 more)

### Community 31 - "mockbank.ts"
Cohesion: 0.14
Nodes (26): run(), run(), run(), RecScore, DetectPlan, verifyCronAuth(), getPool(), DetectDeps (+18 more)

### Community 32 - "actionHash"
Cohesion: 0.12
Nodes (18): attestationKind, confirmOrDeny, nonNegInt, parsePolicy(), ParseResult, Policy, PolicyInput, policySchema (+10 more)

### Community 33 - "helpers.ts"
Cohesion: 0.14
Nodes (13): StartPlanInput, RiskJobDeps, RiskLevel, resetRegistry(), attestationDomain(), deps(), fakeStartPlan(), FITBOX (+5 more)

### Community 34 - "db.integration.test.ts"
Cohesion: 0.10
Nodes (19): Logo(), BottomSheet(), Modal(), useOverlay(), Button, postJson(), AppShell(), EVIDENCE (+11 more)

### Community 35 - "repo.ts"
Cohesion: 0.16
Nodes (9): ActivePlan, AttestationRow, PrepaidPolicyFacts, RiskMerchant, RiskSignalRow, createPgRiskRepo(), fallbackUserIds(), listActivePlans() (+1 more)

### Community 36 - "cards.ts"
Cohesion: 0.21
Nodes (11): ApprovalCard, ApprovalRow, buildCard(), CardLookups, iso(), listPendingCards(), lookups(), Money (+3 more)

### Community 37 - "Reins: Team Roles and Responsibilities"
Cohesion: 0.11
Nodes (18): 1.1 How backend work is shared, 1.2 Who owns the prepaid module (v1.1), 1. Is the split balanced?, 2. Roles, 3. Submission Checklist Ownership, 4. Shared Interfaces (agree on Day 1), 5. Day-by-Day Plan, 6.1 Working with AI coding agents (+10 more)

### Community 38 - "storage.ts"
Cohesion: 0.23
Nodes (22): getAccounts(), listBills(), parseRows(), getFxRateRow(), listFxRates(), getPrepaidOffer(), listPrepaidOffers(), listPrepaidPlans() (+14 more)

### Community 39 - "graph.ts"
Cohesion: 0.18
Nodes (15): ReaderFailureReason, ReaderInvalidOutput, summarizeIssues(), buildReaderGraph(), FIELD_ORDER, LoadedDocument, ReaderDeps, toLabeled() (+7 more)

### Community 40 - "quarantine.test.ts"
Cohesion: 0.15
Nodes (9): SignalReaderPort, PlannerState, PlannerStateT, ProposedCall, ReaderStateT, Route, SignalReaderState, SignalReaderStateT (+1 more)

### Community 41 - "Reins: Product Requirements Document (PRD) v2"
Cohesion: 0.12
Nodes (16): 13. Data Model, 19. Non-Functional Requirements, 1. Summary, 22. Risks and Mitigations, 23. Dependencies and Assumptions, 24. Out of Scope for v1, 25. Open Questions, 26. Glossary (+8 more)

### Community 42 - "explain.ts"
Cohesion: 0.15
Nodes (15): AgentDeps, AuditRow, DocumentReaderPort, DocumentStatus, ACTION_LABELS, checkedPlannerAnswer(), DECISION_LABELS, explain() (+7 more)

### Community 43 - "graph.test.ts"
Cohesion: 0.10
Nodes (26): UNTRUSTED_ORIGINS, ActionRow, allRoles(), Harness, HarnessOptions, harnessWith(), initialInput(), listBillsTool() (+18 more)

### Community 44 - "demo-script.ts"
Cohesion: 0.12
Nodes (18): calls(), DemoScriptModelClient, explainer(), field(), Labeled, planner(), PlannerContext, reader() (+10 more)

### Community 45 - "reader.test.ts"
Cohesion: 0.20
Nodes (11): extractDocument(), ExtractedDocument, extractPdf(), isPdf(), METADATA_KEYS, ReaderState, fixtureBytes(), DOCS (+3 more)

### Community 46 - "Reins: System Architecture"
Cohesion: 0.14
Nodes (13): 13. API Surface, 17. Observability and Audit, 20. Failure Modes and Recovery, 21. R0 Build Cut (by October 20), 22. Architecture Decision Records, 23. Open Technical Questions, 2. System Context, 3. Containers and Deployment Units (+5 more)

### Community 47 - "24. On-chain Prepaid Escrow Module"
Cohesion: 0.14
Nodes (14): 24.10 Sequences, 24.11 Tests, 24.12 Deployment and the Day-1 spike, 24.13 Fallback: `MockEscrowAdapter`, 24.1 Overview, 24.2 Keys, 24.3 Contract specification: `PrepaidEscrow`, 24.4 Solidity sketch (+6 more)

### Community 48 - "gen-fixture-pdfs.ts"
Cohesion: 0.17
Nodes (13): ATTACK_ACCOUNTS, buildPdf(), CANARIES, esc(), main(), PDF_FIXTURES, PdfFixture, PdfSpec (+5 more)

### Community 49 - "15. Algorithms"
Cohesion: 0.15
Nodes (13): 15.10 FX cost estimate, 15.11 Prepaid purchase advisor, 15.12 Hard and soft signals, 15.1 Recurring-charge detection, 15.2 Bill anomaly detection, 15.3 Merchant normalization, 15.4 Worst-case daily exposure ("blast radius"), 15.5 Bill prioritization under insufficient balance (+5 more)

### Community 50 - "redact.ts"
Cohesion: 0.22
Nodes (10): redactBundle(), containsPii(), digitsOf(), normalizeKey(), PiiKind, PiiMap, redactPii(), RedactResult (+2 more)

### Community 51 - "MemoryPlans"
Cohesion: 0.12
Nodes (18): metadata, MasterDetail(), subscribeDesktop(), useIsDesktop(), AuditRow, FeedItem, MandateVersion, SAMPLE_APPROVALS (+10 more)

### Community 52 - "index.ts"
Cohesion: 0.11
Nodes (19): cancel, clonePolicy(), electricity, Patch, PolicyPatch, Row, snap(), ActionStatus (+11 more)

### Community 53 - "signals.ts"
Cohesion: 0.21
Nodes (11): argsHash(), idempotencyKey(), persistPlan(), actionToolSpecs, isAgentActionTool(), createReadTools(), READ_TOOL_NAMES, readTools (+3 more)

### Community 54 - "20261017000002_data_tables.sql"
Cohesion: 0.40
Nodes (12): public.accounts, public.billers, public.bills, public.data_sources, public.documents, public.fx_rates, public.merchants, public.recommendations (+4 more)

### Community 55 - "Reins: R0 Task Checklist"
Cohesion: 0.15
Nodes (12): 0. Today: decisions and messages (Friday, October 16), 10. Claims to verify before they appear anywhere, 1. Decision gates and milestones, 2. R1 Agent and Read Side, 3. R2 Safety, Execution and Evaluation, 4. R3 Platform, Data and Chain, 5. R4 Frontend and UI/UX, 6. R5 Finance and Product (+4 more)

### Community 56 - "wiring.ts"
Cohesion: 0.23
Nodes (11): checkpointerConnString(), getCheckpointer(), AgentGraph, compileGraph(), createHttpSignalFetcher(), pgPlanRegistry, getAgentDeps(), getRunEnv() (+3 more)

### Community 57 - "20261017000006_mockbank.sql"
Cohesion: 0.26
Nodes (11): mockbank.accounts, mockbank.billers, mockbank.bills, mockbank.call_log, mockbank.escrow_plans, mockbank.escrow_sessions, mockbank.events, mockbank.operations (+3 more)

### Community 58 - "11. Agent Design"
Cohesion: 0.20
Nodes (10): 11.1 Roles (privilege separation, not a swarm), 11.2 Patterns, 11.3 Models, 11.4 Proactive triggers (scheduler), 11.5 Prompting rules, 11.6.1 Graph, 11.6.2 Harness invariants, 11.6.3 Runtime configuration (Day 1) (+2 more)

### Community 59 - "12. System Architecture and Key Flows"
Cohesion: 0.20
Nodes (10): 12.1 Architecture, 12.2 Flow: pay a bill, 12.3 Flow: cancel a subscription, 12.4 Flow: edit the mandate, 12.5 Flow: payday, 12.6 Flow: trial auto-cancel, 12.7 Flow: buy a prepaid package, 12.8 Flow: check in (+2 more)

### Community 60 - "Core Algorithms"
Cohesion: 0.20
Nodes (9): 1. Recurring-charge detection (PRD §15.1), 2. Bill anomaly detection (PRD §15.2), 3. Cancel-recommendation score (PRD §15.9), 4. FX cost estimate (PRD §15.10), 5. Financial summary (PRD FR12a.1), 6. Prepaid purchase advisor (PRD §15.11), 7. Hard and soft signals (PRD §15.12), 8. Audit hash chain (PRD §15.8) (+1 more)

### Community 61 - "planner.ts"
Cohesion: 0.36
Nodes (7): planner(), plannerMessages(), plannerTurns(), buildContextMessage(), PlannerContextInput, QUEUED_FOR_REVIEW, TRIGGER_TASKS

### Community 62 - "20261017000003_execution_tables.sql"
Cohesion: 0.27
Nodes (9): public.actions, public.approvals, public.audit_log, public.cap_reservations, public.daily_limits, public.job_runs, public.kill_switch, public.mandates (+1 more)

### Community 63 - "20261017000004_prepaid_tables.sql"
Cohesion: 0.31
Nodes (9): public.attestations, public.chain_cursors, public.chain_txs, public.prepaid_merchants, public.prepaid_offers, public.prepaid_plans, public.prepaid_sessions, public.risk_signals (+1 more)

### Community 64 - "Reins: Agent Instructions"
Cohesion: 0.20
Nodes (9): Architecture (big picture), Commands, Commit convention, Guarantees (never weaken), Module rules, Never, Next.js 16, Reins: Agent Instructions (+1 more)

### Community 65 - "0. Tech Stack at a Glance"
Cohesion: 0.22
Nodes (9): 0.1 Runtime and hosting, 0.2 Data and auth, 0.3 Agent and LLM, 0.4 Core logic and security code, 0.5 Frontend, 0.6 On-chain, 0.7 Testing and evaluation, 0.8 Later (not in R0) (+1 more)

### Community 66 - "10. Policy Gate Specification"
Cohesion: 0.22
Nodes (9): 10.1 Interface, 10.2 Evaluation order, 10.3 Provenance rules, 10.4 Atomic caps, 10.5 Approval tokens, 10.6 Execution-time re-check, 10.7 Idempotency, 10.8 Contract-level limits (defense in depth) (+1 more)

### Community 67 - "2. Problem"
Cohesion: 0.22
Nodes (9): 2.1 The trust gap in agentic finance, 2.2.1 Third commitment type: prepaid packages, 2.2 Recurring obligations: the first job worth delegating, 2.3 Why existing solutions fall short, 2.4 Markets: demo in Shenzhen, validate in Indonesia, 2.5 Why it generalizes, 2.6 Why now, 2.7 Prepared answers (+1 more)

### Community 68 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, build, db:checkpointer, dev, lint, start, test, test:watch (+1 more)

### Community 69 - "quarantine.ts"
Cohesion: 0.28
Nodes (7): assertQuarantinedGraph(), GraphLike, INSTRUCTION_PATTERNS, looksLikeInstructions(), looksLikeToolRunner(), QuarantineViolation, StructuredOnlyModel

### Community 70 - "advisor.ts"
Cohesion: 0.28
Nodes (7): advisePrepaid(), AdvisorInput, AdvisorResult, Recommendation, RiskLevel, round2(), lin

### Community 71 - "6. Agent Runtime (LangGraph.js)"
Cohesion: 0.25
Nodes (8): 6.1 Graph, 6.2 State, 6.3 Nodes, 6.4 Tools, 6.5 Model clients, 6.6 Threads, checkpoints, and runs, 6.7 Prompting, 6. Agent Runtime (LangGraph.js)

### Community 72 - "14. Key Sequences"
Cohesion: 0.29
Nodes (7): 14.1 Pay a bill that needs confirmation, 14.2 Injection attack in a bill PDF, 14.3 Trial auto-cancel (T3), 14.4 Mandate narrowing while an action waits, 14.5 Kill switch, 14.6 Prepaid sequences, 14. Key Sequences

### Community 73 - "17. Privacy and Compliance"
Cohesion: 0.29
Nodes (7): 17.1 Data handling, 17.2 Indonesia, 17.3 China (CSV path), 17.4 Prior work and IP, 17.5 Related standards and work, 17.6 On-chain and e-CNY (v2.0), 17. Privacy and Compliance

### Community 74 - "9. Mandate DSL Specification"
Cohesion: 0.29
Nodes (7): 9.1 Format, 9.2 Schema (v1), 9.3 Examples, 9.4 Semantics, 9.5 Narrowing (partial order), 9.6 Equivalence (for ambiguity detection), 9. Mandate DSL Specification

### Community 75 - "Agent Design"
Cohesion: 0.29
Nodes (6): 1. Roles, not a swarm, 2. Graph, 3. Harness invariants, 4. Model clients and determinism, 5. Numbers come from tools, Agent Design

### Community 76 - "Prompt-Injection Defenses"
Cohesion: 0.29
Nodes (6): 1. Trust zones, 2. Layers, 3. Worked example: hidden text in a bill PDF, 4. Tests that keep it true, 5. Known limits, Prompt-Injection Defenses

### Community 77 - "index.ts"
Cohesion: 0.12
Nodes (14): checkKey(), createLocalDocumentStorage(), createSupabaseDocumentStorage(), DocumentStorage, DocumentStorageUnavailable, getDocumentStorage(), ServerStorageEnv, BYTES (+6 more)

### Community 78 - "18. UX Requirements"
Cohesion: 0.33
Nodes (6): 18.1 Core screens, 18.2 Interaction rules, 18.3 Copy principles, 18.4 States, 18.5 Accessibility, 18. UX Requirements

### Community 79 - "routes.test.ts"
Cohesion: 0.33
Nodes (4): cards, db, run, session

### Community 80 - "layout.tsx"
Cohesion: 0.33
Nodes (4): geistMono, jakarta, metadata, viewport

### Community 81 - "19. Environments, Configuration, and Deployment"
Cohesion: 0.40
Nodes (5): 19.1 Environments, 19.2 Configuration, 19.3 Pinned toolchain, 19.4 Deployment pipeline, 19. Environments, Configuration, and Deployment

### Community 82 - "8. Execution Path and Approvals"
Cohesion: 0.40
Nodes (5): 8.1 Action lifecycle, 8.2 `ActionExecutor.run(actionId)`, 8.3 Approval tokens, 8.4 Settlement adapter interface, 8. Execution Path and Approvals

### Community 83 - "14. APIs and Agent Tools"
Cohesion: 0.40
Nodes (5): 14.1 Mock bank API (OpenAPI, sandbox), 14.2 Agent tools (function calling), 14.3 Internal app API (selected), 14.4 Escrow contract interface (summary), 14. APIs and Agent Tools

### Community 84 - "20. Evaluation Plan"
Cohesion: 0.40
Nodes (5): 20.1 Suites, 20.2 Attack categories, 20.3 Experiment design, 20.4 Reporting, 20. Evaluation Plan

### Community 85 - "4. Users and Personas"
Cohesion: 0.40
Nodes (5): 4.1 Validation market (Indonesia): Rina, 21, university student (Bandung), 4.2 Validation market (Indonesia): Bima, 24, first-jobber (Jakarta), 4.3 Demo persona (China): Lin, 26, first-jobber (Shenzhen), 4.4 Jobs to be done, 4. Users and Personas

### Community 86 - "evals"
Cohesion: 0.40
Nodes (4): evals, Known gaps, Re-recording, `recordings/demo_lin`

### Community 87 - "package.json"
Cohesion: 0.40
Nodes (4): name, packageManager, private, version

### Community 88 - "routes.test.ts"
Cohesion: 0.40
Nodes (3): PlanNotFoundError, runMock, session

### Community 89 - "10. Ingestion and Provenance"
Cohesion: 0.50
Nodes (4): 10.1 Adapters, 10.2 Rules, 10.3 Provenance at decision time, 10. Ingestion and Provenance

### Community 90 - "12. Data Architecture"
Cohesion: 0.50
Nodes (4): 12.1 Schemas and roles, 12.2 Core tables, 12.3 RLS pattern, 12. Data Architecture

### Community 91 - "15. Frontend"
Cohesion: 0.50
Nodes (4): 15.1 Stack, 15.2 Screens (PRD §18.1), 15.3 Rendering rules, 15. Frontend

### Community 92 - "16. Security Architecture"
Cohesion: 0.50
Nodes (4): 16.1 Control map (threats from PRD §16.1), 16.2 Platform controls, 16.3 Gate bypass prevention, as code, 16. Security Architecture

### Community 93 - "18. Testing and Evaluation Architecture"
Cohesion: 0.50
Nodes (4): 18.1 Test pyramid, 18.2 Eval runner, 18.3 Demo determinism, 18. Testing and Evaluation Architecture

### Community 94 - "1. Architectural Drivers"
Cohesion: 0.50
Nodes (4): 1.1 What the architecture must guarantee, 1.2 Quality targets, 1.3 Design principles, 1. Architectural Drivers

### Community 95 - "7. Policy Gate"
Cohesion: 0.50
Nodes (4): 7.1 Shape, 7.2 Evaluation pipeline, 7.3 Determinism and tests, 7. Policy Gate

### Community 96 - "16. Security"
Cohesion: 0.50
Nodes (4): 16.1 Threat model, 16.2 Key management, 16.3 Secure development, 16. Security

### Community 97 - "21. Release Plan and Milestones"
Cohesion: 0.50
Nodes (4): 21.1 Releases, 21.2 Week-by-week (8 weeks), 21.3 Exit criteria for v1, 21. Release Plan and Milestones

### Community 98 - "3. Goals, Non-Goals, and Success Metrics"
Cohesion: 0.50
Nodes (4): 3.1 Goals, 3.2 Non-goals (v1), 3.3 Success metrics, 3. Goals, Non-Goals, and Success Metrics

### Community 99 - "6. Topic A Fit, Business Model, and Impact"
Cohesion: 0.50
Nodes (4): 6.1 Topic A fit, 6.2 Business model, 6.3 Impact, 6. Topic A Fit, Business Model, and Impact

### Community 100 - "eslint.config.mjs"
Cohesion: 0.50
Nodes (3): eslintConfig, ioModules, settlementAdapters

### Community 101 - "20261017000005_rls.sql"
Cohesion: 0.83
Nodes (3): audit_log_no_truncate, audit_log_no_update, public.audit_log_immutable()

### Community 102 - "11. Detectors, Scheduler, and Triggers"
Cohesion: 0.67
Nodes (3): 11.1 Cron jobs (Vercel Cron → route handlers), 11.2 Trigger to run, 11. Detectors, Scheduler, and Triggers

### Community 103 - "9. Mandate Service"
Cohesion: 0.67
Nodes (3): 9.1 Pipeline, 9.2 Modules, 9. Mandate Service

### Community 107 - "page.tsx"
Cohesion: 0.13
Nodes (17): metadata, RecommendationItem, SubscriptionItem, Tag(), EmptyState(), ErrorState(), SkeletonList(), dayMonth() (+9 more)

### Community 109 - "fast-check"
Cohesion: 0.15
Nodes (15): Row(), Rows(), SourceInfo(), expiresIn(), ApprovalDetail(), approvalHeadline(), approvalSubtitle(), ERRORS (+7 more)

### Community 111 - "@langchain/langgraph-checkpoint-postgres"
Cohesion: 0.26
Nodes (12): billOrigin(), chainTxRef(), Queryable, zDay, zNum, zNumOrNull, zOrigin, zTs (+4 more)

### Community 113 - "unpdf"
Cohesion: 0.13
Nodes (16): metadata, PrepaidOfferItem, PrepaidPlanItem, PrepaidSignal, getNow(), getServerNow(), Loaded, PostResult (+8 more)

### Community 129 - "deps.ts"
Cohesion: 0.14
Nodes (15): metadata, PageHeader(), AgentNote(), ButtonProps, ChainLink(), MONEY_SIZE, SampleTag(), SimulatedTag() (+7 more)

### Community 130 - "getSessionUserId"
Cohesion: 0.31
Nodes (8): ApprovalsResponse, ErrorBody, GET(), json(), ChatBody, error(), POST(), getSessionUserId()

### Community 131 - "Contributing to Reins"
Cohesion: 0.33
Nodes (5): 1. Branch first, for every task, 2. Branch names, 3. Pull requests, 4. Commits, Contributing to Reins

### Community 132 - "DocumentRepo"
Cohesion: 0.23
Nodes (16): startPlan(), attestedExitFlow(), billDueFlow(), drain(), runDemoPath(), softSignalFlow(), summarize(), trialFlow() (+8 more)

### Community 133 - "signals.ts"
Cohesion: 0.20
Nodes (13): oracleKey(), publishAttestation(), findSimMerchant(), SIM_MERCHANTS, SimMerchant, day(), fitbox(), ironpulse() (+5 more)

### Community 134 - "rules.tsx"
Cohesion: 0.19
Nodes (11): metadata, dateTime(), formatMoney(), WhyDetail(), PlanDetail(), History(), Mandate, PAYEE_NAMES (+3 more)

### Community 135 - "index.ts"
Cohesion: 0.29
Nodes (10): GET(), handle(), POST(), defaultRiskJobDeps(), runRiskJobRecorded(), RegistryClient, createHttpRegistryClient(), finishJobRun() (+2 more)

### Community 136 - "format.ts"
Cohesion: 0.23
Nodes (10): Money(), currencySymbol(), dayLabel(), daysFrom(), dayStart(), MoneyLike, moneyParts(), shortDate() (+2 more)

### Community 137 - "anomaly.ts"
Cohesion: 0.44
Nodes (7): AnomalyVerdict, conformalCheck(), mad(), median(), medianMadCheck(), actionArgSchemas, anomalyVerdict()

### Community 138 - "route.ts"
Cohesion: 0.28
Nodes (7): DecisionBody, ERROR_STATUS, ErrorBody, json(), POST(), DecisionResponse, ApprovalError

### Community 139 - "route.ts"
Cohesion: 0.36
Nodes (6): ErrorResponse, json(), POST(), UploadResponse, onDocumentUploaded(), OnDocument

### Community 140 - "chat.tsx"
Cohesion: 0.29
Nodes (5): metadata, ChatScreen(), Msg, NODE_TEXT, STARTERS

## Knowledge Gaps
- **639 isolated node(s):** `metadata`, `metadata`, `metadata`, `metadata`, `metadata` (+634 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `withUserTx()` connect `withUserTx` to `lin.ts`, `repo.ts`, `cards.ts`, `storage.ts`, `upload.test.ts`, `run.ts`, `run.ts`, `mockbank.ts`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `Origin` connect `recommendation.ts` to `actionHash`, `decide.ts`, `api-types.ts`, `graph.ts`, `graph.test.ts`, `@langchain/langgraph-checkpoint-postgres`, `MemoryPlans`, `index.ts`, `views.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `PlanStore` connect `fakes.ts` to `explain.ts`, `graph.test.ts`, `withUserTx`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `metadata`, `metadata`, `metadata` to the rest of the system?**
  _639 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lin-seed.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05142857142857143 - nodes in this community are weakly interconnected._
- **Should `recurring.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10904255319148937 - nodes in this community are weakly interconnected._
- **Should `lin.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1140819964349376 - nodes in this community are weakly interconnected._
# Agent Design

Owner: R1. Source of truth for behavior: the code in `src/agent/`. Design references: `architecture.md` §6, PRD §11.

## 1. Roles, not a swarm

Reins uses one privileged LLM and two quarantined ones, plus deterministic code for everything that matters.

| Role | Model | Sees | Can do | Cannot do |
|---|---|---|---|---|
| Planner | `claude-sonnet-5-5` | User turns, tool results, labeled values | Call read tools; propose actions | Execute anything; read raw documents; edit mandates; approve |
| Reader | `claude-haiku-5-5` | One redacted document | Return typed fields, all `origin = document` | Call tools; see the mandate or other documents |
| Signal Reader | `claude-haiku-5-5` | Redacted complaint and news text for one merchant | Return a warning `{level, summary, sourceIds}`, `origin = web` | Call tools; trigger an exit |
| Explainer | `claude-haiku-5-5` | Audit rows for one plan | Rephrase template lines | Introduce numbers not in the audit rows |
| Policy Gate | code | Action, mandate, DB-derived facts | allow / require_confirm / deny | Anything else |
| Detectors | code | Transactions | Find subscriptions and anomalies | Act |

Every agent-to-agent message is an injection path, so there is exactly one privileged model. Model IDs are configuration (`REINS_PLANNER_MODEL`, `REINS_READER_MODEL`, `REINS_EXPLAINER_MODEL`).

## 2. Graph

The agent is an explicit LangGraph.js `StateGraph` (`src/agent/graph.ts`) running inside Next.js route handlers, with a Postgres checkpointer in its own `langgraph` schema.

```
load_context ─► reader? ─► signal_reader? ─► planner ⇄ read_tools
                                                │
                                          persist_plan ─► gate_preview ─┬─► execute ─┬─► explain ─► END
                                                                        │            └─► planner (re-plan, max 1)
                                                                        ├─► create_approval ─► await_approval ─► execute
                                                                        └─► record_deny ─► explain
```

| Node | What it does |
|---|---|
| `load_context` | Loads mandate version, hash and kill switch for the session user. No mandate or kill switch on → `record_deny` |
| `reader`, `signal_reader` | Call the quarantined subgraphs through injected ports; results enter state only as `Labeled` JSON |
| `planner` | Binds read tools and the action schemas. Read calls run; side-effecting calls (`pay_bill`, `cancel_subscription`, `prepaid_exit`) are **captured** and answered with `{status: "queued_for_review"}` |
| `persist_plan` | Validates captured calls with strict zod schemas (unknown args rejected), canonicalizes args (RFC 8785), writes `actions` rows with `args_hash = sha256(tool + canonical(args))` and `idempotency_key = sha256(planId + ":" + index)` |
| `gate_preview` | Dry-run Gate decision used only to pick the route. Not a security boundary |
| `create_approval` | Inserts a pending approval bound to the action hash; the card is built from stored args and registry names, never LLM text |
| `await_approval` | Contains only `interrupt({ approvalId })` |
| `execute` | The only node that reaches the executor. Calls `ActionExecutor.run(actionId, userId)` per action |
| `record_deny` | Audit entry and feed item with rule IDs |
| `explain` | Template-first feed text; any LLM rephrasing is checked number by number against the audit rows |

Triggers: chat, due date, payday, renewal, trial, detector (incl. uploaded documents), digest, prepaid risk, chain event, user action.

## 3. Harness invariants

Security lives in the executor, the Gate and Postgres, not in graph edges. The graph can be replaced (plain SDK loop as fallback) without weakening any guarantee.

| # | Invariant | How it is enforced |
|---|---|---|
| H1 | Side effects only in `execute`, which always calls the Gate | Executor re-decides at execution time; ESLint blocks settlement-adapter imports outside `src/server/executor` |
| H2 | Resume carries no authority | Resume endpoint accepts `{planId}` only, checks ownership, and the executor reads approvals from Postgres by action hash |
| H3 | No work before `interrupt()` | `await_approval` holds only the interrupt |
| H4 | Idempotency keys fixed before execution | Computed in `persist_plan`, upserted; mock bank deduplicates |
| H5 | Reader and Planner state are disjoint | Separate state schemas without a `messages` channel; build-time assertion |
| H6 | Provenance re-derived server-side | Executor snapshot loads bill, biller and attestation rows by ID |
| H7 | Approve or reject only | No edit decision for money actions |
| H8 | Identity from the session | `userId` set by the route handler; tools take it from config, never from args |
| H9 | Plan frozen before execution | One bounded re-plan edge when the mandate changed the decision |

## 4. Model clients and determinism

`ModelClient` (`chat`, `structured`) has three implementations, selected by `REINS_MODELS`:

- `live`: Anthropic SDK; structured output via the SDK's zod helpers, then a second zod validation.
- `recorded`: replays JSON recordings keyed by `sha256(role + canonical(request))`; a miss fails loudly. Used by the demo, CI and the with/without-Gate evaluation.
- `recording`: wraps live calls and writes new recordings.

## 5. Numbers come from tools

The Planner never computes amounts. Read tools return figures computed by deterministic code (`src/core/detectors`, `src/core/algorithms`), and the same view builders feed both the agent and the UI routes, so the chat and the screens always agree. The Explainer's text is checked against audit rows; on any mismatch the raw template is shown instead.

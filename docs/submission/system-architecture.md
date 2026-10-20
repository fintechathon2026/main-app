# System Architecture

Owner: R3 (platform), first version written from the repo by R4/R2. Full detail: [`docs/architecture.md`](../architecture.md). Contract details: [`docs/PRD_PrepaidEscrow_Contract.md`](../PRD_PrepaidEscrow_Contract.md) and [`contracts/README.md`](../../contracts/README.md).

This page is the short version: what the parts are, who is trusted, and how one payment moves through the system.

## 1. In one paragraph

Reins is one Next.js app plus a Supabase Postgres database. A language model reads documents and proposes actions, but it can never move money. Every proposal is saved as a row, checked by a deterministic program (the Policy Gate), and only then run by one piece of trusted code (the executor). Prepaid packages sit in a smart contract on a test network, and the user signs the important steps in the browser with a key the server never sees.

## 2. The parts

| Part | Where | What it does |
|---|---|---|
| Screens (phone and laptop) | `src/ui/`, `app/(app)/` | Seven screens, read from the API routes below |
| API routes | `app/api/**` | Thin handlers for the screens: approvals, feed, mandates, prepaid, kill switch, audit export |
| Agent | `src/agent/` | A LangGraph graph: reads documents, plans, asks for approval. It only proposes |
| Policy Gate | `src/core/gate/decide.ts` | A pure function: allow, ask the user, or deny, with the rule that decided |
| Mandate (the user's rules) | `src/core/mandate/` | Schema, canonical hash, and the order that says whether a change gives the agent more or less permission |
| Executor | `src/server/executor/` | The only code that runs side effects. Re-checks the Gate at the moment of execution |
| Audit log | `src/server/audit/` | Append-only, hash-chained per user |
| Database | `supabase/migrations/` | Postgres with row-level security on every user table |
| Mock bank | `src/mockbank/`, `/mockbank/*` | A simulated bank with its own schema and database role, reached over HTTP |
| Simulators | `src/sim/`, `/sim/*` | A simulated gym and an official-notice registry, each with its own signing key |
| Escrow contract | `contracts/src/PrepaidEscrow.sol` | Holds prepaid money on Base Sepolia (test token, no value) |
| Chain adapter | `src/server/adapters/settlement/chain/` | Sends the transactions; behind `REINS_ESCROW=chain` (default is a mock) |

One deployment holds the app, the mock bank and the simulators. They talk over HTTP and use separate keys, so each can move into its own project later without code changes.

## 3. Trust zones

```
 untrusted content (bill PDFs, emails, notices, CSV)
        |  raw bytes only
        v
 quarantine: Reader / Signal Reader (no tools, no rules, one input at a time)
        |  validated fields, each labelled with where it came from
        v
 planning: Planner + read-only tools. Proposes actions as IDs and amounts
        |  saved as rows with an action hash
        v
 execution: executor -> Gate -> approval check -> spending caps -> bank or chain -> audit log
        (the only zone with settlement access)

 user authority: rules, approvals, saved payees, "Pause everything"
        (only from the signed-in app)
```

The rule that holds everywhere: text from a document can inform a suggestion but can never decide who gets paid. See [`injection-defenses.md`](injection-defenses.md).

## 4. One bill, step by step

1. **A bill arrives** (a PDF, or a row in the mock bank). The Reader extracts fixed fields; instruction-like text is ignored and flagged.
2. **The Planner proposes** `pay_bill(bill_id)`. It has no account-number or recipient argument: the executor looks up the destination from the saved payees.
3. **The plan is saved.** Each action becomes a row with an action hash.
4. **The Gate previews the action.** If the rules say "ask", an approval card is created from structured fields (amount, who, why, which rule). The graph then waits.
5. **The user approves.** The approval is tied to that exact action hash, works once, and expires.
6. **The executor runs it.** Inside one database transaction it takes the daily-limit row lock, builds a snapshot from database rows, calls the Gate again, reserves the cap and consumes the approval. Only after that does it call the bank, outside the transaction.
7. **It is recorded.** The result and the Gate's reasons go into the audit log, and the feed shows the "Rule check" for the action.

A resume request after approval carries only a plan id. Approval status is always read from the database, never from the request or a checkpoint.

## 5. Prepaid packages

- **Buy.** The browser creates the consumer key and keeps it in IndexedDB. The user signs a purchase authorization; the merchant simulator signs the offer. The Gate checks both signatures before the executor sends anything.
- **Check in.** Each session needs two signatures, the customer's and the merchant's, in order. The contract releases one unit to the merchant.
- **Exit.** Either the user signs a voluntary exit, or an official notice signed by the registered oracle triggers an attested exit. The refund can only go back to the plan owner.
- **Keys.** The server never holds the consumer key. The agent key can call only `exitWithAttestation`. Chain keys are read only in their own modules, and a lint rule enforces it.
- **Mock mode.** With `REINS_ESCROW=mock` (the default) the mock bank holds the plans and runs the same flow. The contract is tested with Foundry and a local chain; it is not deployed to Base Sepolia yet.

## 6. Where each guarantee is enforced

| Guarantee | Enforced in |
|---|---|
| No money moves unless the Gate allows that exact action when it runs (G1) | `src/server/executor/run.ts`, `src/core/gate/decide.ts` |
| Untrusted values never authorize or route money (G2) | Reader subgraphs in `src/agent/nodes/`, provenance checks in the Gate |
| An approval covers one action, once, before it expires (G3) | Approval rows and the action hash, checked in the executor |
| Caps hold under concurrency (G4) | The `daily_limits` row lock in the executor |
| Each side effect runs at most once (G5) | Idempotency keys on actions and on chain transactions |
| The model never edits rules, payees or the numbers shown (G6) | The agent has no tool that edits rules or payees; screens are built from stored fields, never from model text |
| Every decision can be explained from the log (G7) | `src/server/audit/index.ts` |
| Escrow money goes only to the merchant per session, or back to the owner (G9, G10) | `contracts/src/PrepaidEscrow.sol` |

The full mapping, with tests and known gaps, is in [`security-self-assessment.md`](security-self-assessment.md).

## 7. Data

Postgres schemas: `public` (app tables, RLS everywhere), `langgraph` (agent checkpoints), `mockbank` (reachable only by the mock bank role), `eval` (evaluation runs). The app role does not bypass RLS and sets the user id for each transaction. No request code uses `service_role`.

## 8. Environments

| Environment | App | Database | Models |
|---|---|---|---|
| Local | `pnpm dev` | Supabase CLI in Docker | recorded or live |
| Preview | Vercel preview per PR | shared dev project | recorded |
| Demo | Vercel production | demo project | recorded by default |

Steps and variables: the "Deploy" section of the [README](../../README.md).

## 9. What is simulated or not built

Simulated: the bank, the gym and the notice registry. Mocked by default: the escrow. Not deployed: the contract on Base Sepolia. Not built: passkey signing of the mandate (the stored mandate is checked by its hash today) and the `/api/mandates/activate` route. Details are in the README table.

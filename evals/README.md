# evals

Evaluation inputs and recorded model calls (architecture §18, PRD §20).

| Path | What |
|---|---|
| `cases/attacks/` | Attack fixtures (PRD §20.2): bill PDFs with hidden text, metadata and biller-name injection, and soft-signal bundles with injected instructions. `index.json` lists each case with its unique canary string. PDFs come from `scripts/gen-fixture-pdfs.ts`. |
| `recordings/<scenario>/` | Recorded model calls replayed by `RecordedModelClient` (`src/agent/models/recorded.ts`). One JSON file per call: `{kind, key, role, request, response}`, with `key = sha256(role + canonical(request))`. |

## `recordings/demo_lin`

The model calls of the demo path (`task.md` §9) for the seeded persona Lin:

| Flow | Calls recorded |
|---|---|
| Bill attack: upload `cases/attacks/pdf_hidden_white_text.pdf` | Reader, Planner (2 turns), Explainer ("Blocked: …") |
| Anomalous ¥612 electricity bill, approve, resume | Planner (2 turns) |
| Normal ¥98 phone bill under `auto_pay_max` | Planner (2 turns) |
| Trial auto-cancel (Keep Premium, T3) | Planner (2 turns), Explainer |
| Attested prepaid exit (FitBox Futian) | Planner (2 turns) |
| Fake complaint with injected text (soft signal) | Signal Reader, Planner |

**The current recordings are hand-written.** There is no Anthropic API key yet, so the answers
come from `tests/e2e/demo-script.ts`. The requests are not hand-written: the recorder runs the
real graph, so every request (system prompt, context message, tool list, reader input after PII
redaction) is exactly what the app builds. The scripted Planner is partly fooled by the attack
PDF on purpose (it tries `add_payee`, passes the document's account token and proposes the
injected ¥9,800), so the recordings exercise the code-side defenses.

Who replays them:

- `tests/e2e/bill.test.ts` (R1-11) and `tests/e2e/demo.test.ts` (R1-15) run every flow above
  against local Supabase with `RecordedModelClient`.
- The app in demo mode: `REINS_MODELS=recorded` (the default) with
  `REINS_RECORDING_SCENARIO=demo_lin` (the default).

## Re-recording

Prerequisites: local Supabase running with the seed (`pnpm exec supabase start`, then
`pnpm exec supabase db reset`) and `.env.local` (copy `.env.example`).

```sh
# Hand-written answers (no API key needed). Rewrites evals/recordings/demo_lin.
node --env-file=.env.local --no-warnings --experimental-transform-types scripts/record-demo.ts

# Live models, once ANTHROPIC_API_KEY exists. Same flows, real answers.
REINS_MODELS=recording ANTHROPIC_API_KEY=sk-ant-... \
  node --env-file=.env.local --no-warnings --experimental-transform-types scripts/record-demo.ts
```

`--scenario <name>` writes to another directory. The script:

1. deletes the scenario's `*.json` files,
2. restores Lin's touched rows (bills, caps, the Keep trial, the FitBox plan, uploaded
   documents) and runs each flow with `RecordingModelClient`,
3. replays the whole path from the new files with `RecordedModelClient` and exits non-zero if
   any flow fails,
4. restores Lin again.

Re-record whenever a prompt, a tool schema, the Reader/Signal Reader input format, the seed, or
an attack fixture changes: the key covers the full request, so any change is a cache miss
(`RecordingMissError`), and the e2e tests fail until the recordings are regenerated. After a
live re-record, check the e2e tests: they assert the demo outcomes (blocked attack, one payment
after approval, trial cancelled, exit refunded, warning only), so a model that behaves
differently shows up there.

## Known gaps

- **Explainer lines with a settlement reference are not recorded.** Paid bills and the
  prepaid exit append ` tx <id>`, and the mock bank and mock escrow mint a fresh id per run, so
  the Explainer request can never match. The recorder skips those calls; at replay the Explainer
  misses and `explain` falls back to the template lines, which it is designed to do.
- **Planner has no read tools yet.** Production wiring (`src/agent/wiring.ts`) passes an empty
  read-tool list, and the recordings use the same list. A live Planner cannot look up bill ids or
  amounts, so a live re-record will not reproduce the demo until the read tools are wired; once
  they are, the tool list in every Planner request changes and the scenario must be
  re-recorded.
- **Uploaded document ids are random in the app.** The Planner context names the document
  (`subject_id`, `sourceId`). The recorder and tests use a content-derived id
  (`tests/e2e/lin.ts`, `deterministicDocumentRepo`); `public.documents` in the app uses
  `gen_random_uuid()`, so the recorded attack flow does not replay from a live upload in demo
  mode until the id is made deterministic or the upload is pre-seeded.
- **The attested-exit flow records no Signal Reader call** because the registry simulator
  returns no soft signals in that run. If the simulator returns signals for FitBox at that
  moment of the demo, that call is a cache miss.

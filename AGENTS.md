# Reins: Agent Instructions

Shared rules for every coding agent in this repo (Claude Code, Codex, etc.). `CLAUDE.md` points here.

Reins is an AI finance agent that manages bills, subscriptions and prepaid packages, and acts only inside a user-signed mandate. Source of truth: `docs/PRD_Reins_v2.0.md` (requirements), `docs/architecture.md` (implementation), `roles.md` (owners), `task.md` (R0 checklist).

## Commit convention

Conventional Commits: `type(scope): message`

- Header: imperative, lowercase, no trailing period, 72 characters max.
- **Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`, `revert`.
- **Scope** is the area touched. Suggested: `gate`, `executor`, `approvals`, `agent`, `reader`, `planner`, `mandate`, `detectors`, `fx`, `api`, `db`, `mockbank`, `contracts`, `chain`, `sim`, `ui`, `evals`, `docs`. Omit the scope only when a change spans the whole repo.
- Breaking change: add `!` after the scope (`feat(mandate)!: ...`) and explain it in the body.
- Body (optional): explain why, not what. Wrap at 72 characters.
- One logical change per commit. Do not mix unrelated files.
- Commit after every small change. Do not batch work into large commits.
- Never `git push` unless the user explicitly says to push.
- **Do not add `Co-Authored-By` or any other attribution trailer.**
- Never commit secrets, `.env*` files, private keys or real personal data.

Examples:

```
feat(agent): add Signal Reader subgraph
fix(gate): deny stale FX rates older than 2 days
test(executor): cover double resume executing once
docs: update task checklist
chore(db): add prepaid tables migration
```

## Guarantees (never weaken)

- **G1** No money moves unless the deterministic Policy Gate returns `allow` for that exact action at execution time.
- **G2** Untrusted values (documents, emails, notifications, CSV, web text) can inform a proposal but never authorize or route money.
- **G3** An approval authorizes exactly one action (hash-bound), once, before it expires.
- **G4** Cumulative caps hold under concurrency.
- **G5** Every side effect executes at most once.
- **G6** The LLM never edits mandates, creates payees, or computes the numbers users see.
- **G7** Every decision is explainable from an append-only, hash-chained audit log.
- **G9/G10** Escrowed prepaid money can only go to the merchant (one unit per two-signature session) or back to the plan owner. Release keys never reach the server.

## Never

- Never import a settlement adapter outside `src/server/executor/**`.
- Never put work before `interrupt()` in the same node.
- Never read approval status from a resume payload or checkpoint.
- Never add an account-number or recipient parameter to a tool.
- Never use `service_role` in request code, and never weaken RLS.
- Never change a shared interface (`roles.md` §4) without its owner.
- Never edit a migration that is already applied; add a new one.
- Never add admin, upgrade, pause, sweep or recipient parameters to the escrow contract.
- Never let the agent key call anything except `exitWithAttestation`.
- Never send the consumer key to the server or log it.
- Never read chain private keys outside their modules (`architecture.md` §5.1).
- Never move security logic into prompts; it belongs in code and Postgres.

## Module rules

Imports are enforced by ESLint (`architecture.md` §5.1).

- `src/core/**` is pure TypeScript: no I/O, no clock, no randomness.
- `src/agent/**` may import `src/core/**`, read repositories, and the executor (from the `execute` node only).
- `app/api/**` must not import settlement adapters.
- `src/sim/**` acts as an outside party and imports no executor, agent or adapter code.

## Working rules

- Short-lived feature branches, PR into `main`, one reviewer. The human owner reads every diff before opening a PR.
- One agent session per task, on its own branch or worktree.
- Run `pnpm lint && pnpm test` before a PR (`forge test` when `contracts/**` changes).
- Never change tests to make them pass: no edited expectations, `.skip` or lowered thresholds.
- Do not add dependencies without asking. Pin exact versions; LangGraph and LangChain release weekly.
- Check LangGraph.js, Supabase, viem and OpenZeppelin APIs against the pinned version. OpenZeppelin 4 and 5 differ.
- Give the relevant section of `docs/architecture.md` or the PRD as context instead of working from memory.
- Second human reviewer is required for the paths in `roles.md` §6.1 (CODEOWNERS).

## Commands

Node 22, pnpm 11. Copy `.env.example` to `.env.local` first.

| Command | Does |
|---|---|
| `pnpm install` | Install dependencies (exact versions, lockfile committed) |
| `pnpm dev` | Next.js dev server |
| `pnpm lint` | ESLint, including the module-boundary rules |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm test` | Vitest (`src/**/*.test.ts`, `tests/**/*.test.ts`) |
| `forge test` | Contract tests, from `contracts/` |

Local Supabase and the eval runner are added when they land.

## Next.js 16

This Next.js version has breaking changes from older training data. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices. `cacheComponents` is on in `next.config.ts`. Route handlers run on Node by default. Do not add `export const runtime`: Cache Components does not support the runtime segment config, even `"nodejs"`. The Edge runtime is deprecated and not used.

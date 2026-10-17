# Contributing to Reins

Rules for everyone who changes this repo, human or agent. Commit message format and the architecture guarantees are in `AGENTS.md`; owners and paths are in `roles.md`.

## 1. Branch first, for every task

**Never work on `main`.** Before you change anything for a task, create a new branch from the latest `main`:

```bash
git fetch origin
git switch -c <branch-name> origin/main
```

- One task, one branch. Do not stack unrelated work on a branch that already has a PR.
- Start from `origin/main`, not from another feature branch. If you depend on unmerged work, say so in the PR and name the PR.
- Commit to your branch, push your branch, open a PR into `main`. Nobody pushes to `main` directly.
- After the PR is merged, delete the branch (remote and local) and start the next task on a fresh branch.
- If you notice an unrelated problem while working, finish or commit what you have, then open a separate branch for it.

AI agents follow the same rule: create the branch before the first edit, and do not push unless the user says to.

## 2. Branch names

Format: `<type>/<short-description>`

- **type:** the same word as the commit type: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.
- **short-description:** lowercase words joined with hyphens, 2 to 5 words, what the branch does (not who or when). Letters, digits and hyphens only.
- Optional task id after the type, when the work comes from `task.md`: `<type>/<task-id>-<short-description>`, with the id in lowercase (`r1-12`, `r3-02`).
- Keep the whole name under 50 characters.

| Good | Why |
|---|---|
| `feat/prepaid-risk-trigger` | type + what it does |
| `feat/r1-12-risk-trigger` | with the `task.md` id |
| `fix/replan-duplicate-action-idx` | names the bug |
| `docs/contribute-guide` | docs only |
| `test/harness-double-resume` | tests only |
| `chore/bump-langgraph` | maintenance |

| Bad | Why |
|---|---|
| `main2`, `my-branch`, `test` | no type, says nothing |
| `feat/Fix_Stuff` | uppercase, underscore, vague |
| `hitch/work` | a person's name instead of the task |
| `feat/everything-for-r1` | more than one task |
| `fix/issue` | no description |

Throwaway experiments can use `spike/<short-description>`; do not merge them, copy what you need into a proper branch.

## 3. Pull requests

- Title: the same format as a commit header, `type(scope): message`.
- One reviewer minimum. Paths in `roles.md` §6.1 need the named second reviewer.
- The author reads every diff before opening the PR, including agent-written code.
- Before opening: `pnpm lint && pnpm typecheck && pnpm test` (and `forge test` if `contracts/**` changed). Tests that need the database run with local Supabase and `.env.local` loaded (see `AGENTS.md` Commands).
- Keep the PR to the one task. Mention anything you built that belongs to another owner (see the "Owner" header in the file) so they can review it.
- `main` must always run the demo path end to end.

## 4. Commits

Small and often, one logical change each, `type(scope): message`, no `Co-Authored-By` trailer. Details in `AGENTS.md`.

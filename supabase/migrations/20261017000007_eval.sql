-- Owner: R3 (roles.md), format owned by R2. Minimal version by R1; extend, don't duplicate.
-- Eval cases and runs (PRD §13, architecture §18.2).

create table eval.eval_cases (
  id            text primary key,
  suite         text not null check (suite in ('attack','benign','ambiguity')),
  category      text not null,
  input_json    jsonb not null,
  expected_json jsonb not null
);

create table eval.eval_runs (
  id         uuid primary key default gen_random_uuid(),
  case_id    text not null references eval.eval_cases(id),
  arm        text not null check (arm in ('with_gate','without_gate')),
  outcome    text not null,
  latency_ms int,
  cost_usd   numeric(10, 6),
  details    jsonb,
  created_at timestamptz not null default now()
);

revoke all on all tables in schema eval from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema eval to reins_server;

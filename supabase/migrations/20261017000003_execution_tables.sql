-- Owner: R3 (roles.md), execution tables co-designed with R2. Minimal version by R1; extend, don't duplicate.
-- Mandates, plans, actions, approvals, caps, audit log, kill switch, job runs
-- (architecture §8.3, §12.2; PRD §10.4–10.7).

create table public.mandates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  version       int not null check (version > 0),
  policy_json   jsonb not null,
  policy_hash   text not null check (policy_hash ~ '^[0-9a-f]{64}$'),
  prev_version  int,
  signed_at     timestamptz not null,
  credential_id text,                                   -- [R1] passkey
  assertion     jsonb,                                  -- [R1]
  status        text not null check (status in ('active','superseded','revoked')),
  created_via   text not null check (created_via in ('nl','template','edit')),
  created_at    timestamptz not null default now(),
  unique (user_id, version)
);
create unique index one_active_mandate on public.mandates(user_id) where status = 'active';

create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  trigger       text not null check (trigger in ('chat','due_date','payday','renewal','trial','detector','digest','prepaid_risk','chain_event','user_action')),
  subject_id    text,
  planner_model text,
  status        text not null check (status in ('running','paused','done','failed')),
  created_at    timestamptz not null default now()
);
-- One active plan per (user, trigger, subject) (architecture §11.2). NULLS NOT DISTINCT so
-- subject-less triggers also collide.
create unique index one_running_plan on public.plans(user_id, trigger, subject_id) nulls not distinct
  where status in ('running','paused');

create table public.actions (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.plans(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  idx              int not null,
  tool             text not null check (tool in ('pay_bill','cancel_subscription','sweep_to_savings',
                     'prepaid_purchase','prepaid_redeem','prepaid_exit','prepaid_exit_voluntary')),
  actor            text not null default 'agent' check (actor in ('agent','user')),
  args_json        jsonb not null,
  args_hash        text not null check (args_hash ~ '^[0-9a-f]{64}$'),  -- sha256(tool + canonical(args))
  mandate_version  int not null,
  idempotency_key  text not null unique,
  status           text not null default 'planned' check (status in ('planned','ready','awaiting_approval','denied','rejected',
                     'expired','executing','succeeded','failed','unknown','cancelled_replan')),
  tier             text,
  preview_decision text check (preview_decision in ('allow','require_confirm','deny')),
  decision         text check (decision in ('allow','require_confirm','deny')),
  rule_ids         text[],
  gate_json        jsonb,                                -- last GateResult (with trace)
  result_json      jsonb,
  created_at       timestamptz not null default now(),
  executed_at      timestamptz,
  unique (plan_id, idx)
);
create index actions_user_status on public.actions(user_id, status);

-- Approval tokens (architecture §8.3). The row is the only source of truth for approval.
create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  action_id       uuid not null references public.actions(id) on delete cascade,
  action_hash     text not null,
  mandate_version int not null,
  expires_at      timestamptz not null,
  credential_id   text,                                 -- null in R0
  assertion       jsonb,                                -- WebAuthn assertion over action_hash [R1]
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','consumed','expired')),
  reason          text,
  decided_at      timestamptz,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create unique index approvals_one_open_per_hash on public.approvals(action_hash)
  where status in ('pending','approved');
create index approvals_user_status on public.approvals(user_id, status);

-- Cumulative caps (PRD §10.4). The executor locks this row FOR UPDATE per (user, day).
create table public.daily_limits (
  user_id uuid not null references public.users(id) on delete cascade,
  day     date not null,
  used    bigint not null default 0 check (used >= 0),
  primary key (user_id, day)
);

create table public.cap_reservations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  day        date not null,
  action_id  uuid not null unique references public.actions(id) on delete cascade,
  payee_id   text,
  amount     bigint not null check (amount > 0),
  status     text not null check (status in ('reserved','committed','released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index cap_reservations_user_day on public.cap_reservations(user_id, day);

-- Append-only, per-user hash chain (PRD §15.8): hash = sha256(prev_hash || canonical(event)).
create table public.audit_log (
  seq        bigint generated always as identity primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  prev_hash  text not null,
  hash       text not null unique,
  actor      text not null check (actor in ('agent','user','gate','system')),
  event_type text not null,
  event_json jsonb not null,
  created_at timestamptz not null default now()
);
create index audit_log_user_seq on public.audit_log(user_id, seq);

create table public.kill_switch (
  user_id    uuid primary key references public.users(id) on delete cascade,
  enabled    boolean not null default false,
  changed_at timestamptz not null default now()
);

-- System table (cron bookkeeping); not user-scoped.
create table public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running','succeeded','failed')),
  stats_json  jsonb,
  error       text
);
create index job_runs_job_started on public.job_runs(job, started_at desc);

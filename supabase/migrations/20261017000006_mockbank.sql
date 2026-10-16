-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- Mock bank (PRD §14.1) and mock escrow (architecture §24.13). Only reins_mockbank may touch
-- this schema; the app reaches it over HTTP (/mockbank/*), never through SQL.
-- Bank customers are keyed by the app user's id so that sync can map rows 1:1.

create table mockbank.accounts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  name        text not null,
  type        text not null check (type in ('checking','savings')),
  currency    text not null,
  balance     numeric(14, 2) not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index mb_accounts_one_default on mockbank.accounts(customer_id) where is_default;

create table mockbank.transactions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references mockbank.accounts(id),
  posted_at         timestamptz not null,
  amount            numeric(14, 2) not null,             -- negative = outflow
  currency          text not null,
  descriptor        text not null,
  original_amount   numeric(14, 2),
  original_currency text,
  payment_id        uuid
);
create index mb_transactions_account_posted on mockbank.transactions(account_id, posted_at);

-- The bank's own payee registry: resolves biller_id -> destination account (PRD FR4.5).
create table mockbank.billers (
  id          text primary key,
  name        text not null,
  category    text not null,
  account_ref text not null
);

create table mockbank.bills (
  id          uuid primary key,                          -- same id as public.bills
  customer_id uuid not null,
  biller_id   text not null references mockbank.billers(id),
  amount      bigint not null check (amount > 0),
  currency    text not null,
  due_date    date not null,
  period      text not null,
  status      text not null default 'unpaid' check (status in ('unpaid','paid')),
  created_at  timestamptz not null default now()
);

create table mockbank.subscriptions (
  id            uuid primary key,                        -- same id as public.subscriptions
  customer_id   uuid not null,
  merchant_name text not null,
  amount        numeric(14, 2) not null,
  currency      text not null,
  cycle_days    int not null,
  next_renewal  date,
  status        text not null check (status in ('active','trial','cancelled')),
  trial_end     timestamptz,
  cancelled_at  timestamptz
);

create table mockbank.payments (
  id                     uuid primary key default gen_random_uuid(),
  idempotency_key        text not null unique,
  customer_id            uuid not null,
  bill_id                uuid not null references mockbank.bills(id),
  biller_id              text not null references mockbank.billers(id),
  amount                 bigint not null,
  account_id             uuid not null references mockbank.accounts(id),
  destination_account_ref text not null,
  status                 text not null check (status in ('succeeded','failed')),
  response_json          jsonb not null,
  created_at             timestamptz not null default now()
);

-- Idempotency for other side-effecting calls (cancel, escrow exits).
create table mockbank.operations (
  idempotency_key text primary key,
  kind            text not null,
  status_code     int not null,
  response_json   jsonb not null,
  created_at      timestamptz not null default now()
);

create table mockbank.events (
  seq         bigint generated always as identity primary key,
  customer_id uuid not null,
  type        text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

create table mockbank.call_log (
  id            bigint generated always as identity primary key,
  method        text not null,
  path          text not null,
  query         text,
  request_json  jsonb,
  status        int not null,
  response_json jsonb,
  latency_ms    int not null,
  created_at    timestamptz not null default now()
);

-- Mock escrow (architecture §24.13): same state machine as PrepaidEscrow, ids `mock:<uuid>`.
create table mockbank.escrow_plans (
  chain_plan_id  numeric(78, 0) primary key,
  owner          text not null,
  merchant       text not null,
  agent          text,
  unit_price     bigint not null,                        -- fen
  units_total    int not null,
  units_redeemed int not null default 0,
  cancel_fee_bps int not null,
  status         text not null check (status in ('active','completed','exited_attested','exited_voluntary')),
  balance        bigint not null,                        -- fen held
  created_at     timestamptz not null default now(),
  check (units_redeemed <= units_total)
);

create table mockbank.escrow_sessions (
  chain_plan_id numeric(78, 0) not null references mockbank.escrow_plans(chain_plan_id),
  session_no    int not null,
  tx_id         text not null,
  redeemed_at   timestamptz not null default now(),
  primary key (chain_plan_id, session_no)
);

revoke all on all tables in schema mockbank from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema mockbank to reins_mockbank;
grant usage on all sequences in schema mockbank to reins_mockbank;

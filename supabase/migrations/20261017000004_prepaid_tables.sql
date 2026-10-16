-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- Prepaid escrow tables (architecture §24.8). prepaid_merchants/offers, attestations and
-- risk_signals are reference tables; wallets, prepaid_plans/sessions and chain_txs are user-scoped.
-- Money columns here are in fen (minor units), matching the token's 2 decimals.

create table public.wallets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  address    text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  kind       text not null check (kind in ('consumer_browser')),
  created_at timestamptz not null default now(),
  unique (user_id, kind),
  unique (address)
);

create table public.prepaid_merchants (
  id               text primary key,                    -- e.g. FITBOX_FUTIAN
  merchant_id      uuid references public.merchants(id),
  name             text not null,
  chain_address    text not null check (chain_address ~ '^0x[0-9a-fA-F]{40}$'),
  escrow_supported boolean not null default true,
  risk_level       text not null default 'none' check (risk_level in ('none','watch','elevated')),
  updated_at       timestamptz not null default now()
);

create table public.prepaid_offers (
  id                  uuid primary key default gen_random_uuid(),
  merchant_id         text not null references public.prepaid_merchants(id),
  unit_price          bigint not null check (unit_price > 0),       -- fen
  units               int not null check (units > 0),
  cancel_fee_bps      int not null check (cancel_fee_bps between 0 and 2000),
  pay_per_visit_price bigint check (pay_per_visit_price > 0),        -- fen, for the advisor
  expires_at          timestamptz not null,
  offer_json          jsonb not null,
  merchant_sig        text not null
);

create table public.prepaid_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  chain_plan_id     numeric(78, 0) not null unique,
  merchant_id       text not null references public.prepaid_merchants(id),
  unit_price        bigint not null,                                  -- fen
  units_total       int not null,
  units_redeemed    int not null default 0 check (units_redeemed <= units_total),
  cancel_fee_bps    int not null,
  agent_address     text,
  status            text not null check (status in ('active','completed','exited_attested','exited_voluntary')),
  purchase_tx       text not null,
  origin            text not null default 'chain' check (origin = 'chain'),
  last_synced_block bigint not null
);

create table public.prepaid_sessions (
  plan_id     uuid not null references public.prepaid_plans(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  session_no  int not null,
  tx_hash     text not null,
  redeemed_at timestamptz not null,
  primary key (plan_id, session_no)
);

create table public.attestations (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   text not null references public.prepaid_merchants(id),
  kind          text not null check (kind in ('court_enforcement','closure_notice')),
  case_ref_hash text not null,
  issued_at     timestamptz not null,
  expires_at    timestamptz not null,
  signer        text not null,
  signature     text not null,
  sig_valid     boolean not null,                        -- UI cache only; the Gate re-verifies
  raw_json      jsonb not null,
  received_at   timestamptz not null default now(),
  unique (merchant_id, kind, case_ref_hash)
);

create table public.risk_signals (
  id          uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.prepaid_merchants(id),
  kind        text not null check (kind in ('complaints','news')),
  level       text not null check (level in ('none','watch','elevated')),
  summary     text,
  source_ids  text[] not null default '{}',
  origin      text not null check (origin in ('web','simulated')),
  simulated   boolean not null,
  observed_at timestamptz not null
);

create table public.chain_txs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  action_id     uuid not null unique references public.actions(id) on delete cascade,
  sender        text not null check (sender in ('relayer','agent')),
  method        text not null,
  raw_tx        text not null,
  tx_hash       text not null unique,
  nonce         bigint not null,
  status        text not null check (status in ('signed','broadcast','confirmed','reverted')),
  block_number  bigint,
  revert_reason text,
  submitted_at  timestamptz,
  confirmed_at  timestamptz,
  unique (sender, nonce)
);

-- System table (indexer cursor); not user-scoped.
create table public.chain_cursors (
  contract   text primary key,
  last_block bigint not null
);

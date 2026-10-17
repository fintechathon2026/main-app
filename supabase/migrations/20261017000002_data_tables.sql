-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- User profile, reference data and ingested financial data (PRD §13, architecture §10.2).
-- Amounts: bills and caps are integers in whole base-currency units (PRD §9.1); transactions
-- and subscription prices keep 2 decimals because FX-converted charges are fractional.
-- Every value that can reach the Gate keeps `origin` (and `source_id` where it has one).

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  locale        text not null default 'zh-CN',
  timezone      text not null default 'Asia/Shanghai',
  base_currency text not null default 'CNY' check (base_currency in ('CNY', 'IDR')),
  created_at    timestamptz not null default now()
);

-- Reference: merchants (normalized names, PRD §15.3)
create table public.merchants (
  id             uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  category       text not null,
  aliases        text[] not null default '{}',
  cancel_method  text,
  manage_url     text
);

-- Reference: FX rates from the trusted provider only (PRD §10.3)
create table public.fx_rates (
  date       date not null,
  base       text not null,
  quote      text not null,
  rate       numeric(20, 10) not null check (rate > 0),
  source     text not null default 'fx_provider' check (source = 'fx_provider'),
  provider   text not null default 'frankfurter',
  fetched_at timestamptz not null default now(),
  primary key (date, base, quote)
);

create table public.data_sources (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  type           text not null check (type in ('mock_bank','estatement','email_forward','gmail','aggregator','notification','csv_wechat','csv_alipay')),
  status         text not null default 'active' check (status in ('active','paused','revoked')),
  last_synced_at timestamptz,
  created_at     timestamptz not null default now()
);

create table public.accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  data_source_id uuid references public.data_sources(id),
  provider       text not null,
  type           text not null check (type in ('checking','savings','credit','ewallet')),
  name           text,
  currency       text not null,
  balance        numeric(14, 2) not null default 0,
  origin         text not null default 'mock_bank',
  source_id      text,
  updated_at     timestamptz not null default now()
);

create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  posted_at         timestamptz not null,
  amount            numeric(14, 2) not null,           -- negative = outflow, in account currency
  currency          text not null,
  raw_descriptor    text not null,
  original_amount   numeric(14, 2),
  original_currency text,
  fx_rate           numeric(20, 10),
  fx_rate_date      date,
  merchant_id       uuid references public.merchants(id),
  category          text,
  source_id         text not null,
  origin            text not null check (origin in ('mock_bank','aggregator','csv','document','email','user','simulated')),
  content_hash      text,
  created_at        timestamptz not null default now(),
  unique (account_id, source_id)
);
create index transactions_user_posted on public.transactions(user_id, posted_at desc);

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  type            text not null check (type in ('bill_pdf','estatement','email','csv','other')),
  storage_ref     text not null,
  sha256          text not null,
  suspicious_text boolean not null default false,
  received_at     timestamptz not null default now(),
  retention_until timestamptz,
  unique (user_id, sha256)
);

-- Payee registry (architecture §12.2). payee_account_ref is a registry value, never from documents.
create table public.billers (
  id                text not null,                      -- e.g. SZ_POWER, CHINA_MOBILE
  user_id           uuid not null references public.users(id) on delete cascade,
  name              text not null,
  merchant_id       uuid references public.merchants(id),
  payee_account_ref text not null,
  verified_at       timestamptz,
  verified_via      text check (verified_via in ('user_ui','mock_bank')),
  created_at        timestamptz not null default now(),
  primary key (id, user_id)
);

create table public.bills (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  biller_id             text not null,
  amount                bigint not null check (amount > 0),
  currency              text not null,
  amount_origin         text not null check (amount_origin in ('mock_bank','aggregator','document','email','csv','user')),
  due_date              date not null,
  period                text not null,                  -- e.g. 2026-09
  document_id           uuid references public.documents(id),
  extracted_fields_json jsonb,
  status                text not null default 'unpaid' check (status in ('unpaid','paid','scheduled','cancelled')),
  source_id             text,
  created_at            timestamptz not null default now(),
  foreign key (biller_id, user_id) references public.billers(id, user_id)
);
create index bills_user_biller_due on public.bills(user_id, biller_id, due_date desc);

create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  merchant_id         uuid not null references public.merchants(id),
  cycle_days          int not null check (cycle_days > 0),
  amount              numeric(14, 2) not null,          -- in base currency (converted for FX subs)
  currency            text not null,                    -- base currency
  billing_currency    text not null,                    -- what the merchant charges in
  original_amount     numeric(14, 2) not null,          -- in billing currency
  next_renewal        date,
  status              text not null check (status in ('active','inactive','cancelled','trial')),
  first_seen          date,
  last_charged        date,
  confidence          numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  detection_source    text not null check (detection_source in ('mock_bank','manual','email','csv')),
  trial_end           timestamptz,
  trial_status_origin text check (trial_status_origin in ('mock_bank','email','document','user','notification','csv','web')),
  keep_flag           boolean not null default false,
  notice_sent         boolean not null default false,
  source_id           text,
  created_at          timestamptz not null default now()
);

create table public.usage_signals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  merchant_id     uuid references public.merchants(id),
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  source          text not null,
  metric          text not null,
  value           numeric not null,
  period_start    date not null,
  period_end      date not null,
  origin          text not null,
  simulated       boolean not null default false,
  created_at      timestamptz not null default now()
);

create table public.recommendations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  score           numeric not null,
  signals_json    jsonb not null default '[]',
  status          text not null default 'open' check (status in ('open','accepted','dismissed')),
  created_at      timestamptz not null default now()
);

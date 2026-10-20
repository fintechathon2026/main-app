-- Owner: R3 (roles.md).
-- Mock bank internal transfers (PRD §14.1 /transfers/internal, /transfers/:id/reverse; FR11.2
-- 24h undo) and a customer column on the call log so the export can be filtered per customer.
-- Only reins_mockbank may touch this schema.

create table mockbank.transfers (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  customer_id      uuid not null,
  from_account_id  uuid not null references mockbank.accounts(id),
  to_account_id    uuid not null references mockbank.accounts(id),
  amount           numeric(14, 2) not null check (amount > 0),
  currency         text not null,
  status           text not null check (status in ('succeeded','reversed')),
  reversible_until timestamptz not null,
  reversed_at      timestamptz,
  created_at       timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index mb_transfers_customer_created on mockbank.transfers(customer_id, created_at);

-- Nullable: older rows and calls without a customer (e.g. /billers) have none.
alter table mockbank.call_log add column customer_id uuid;
create index mb_call_log_customer_id on mockbank.call_log(customer_id, id);

revoke all on mockbank.transfers from public, anon, authenticated;
grant select, insert, update, delete on mockbank.transfers to reins_mockbank;

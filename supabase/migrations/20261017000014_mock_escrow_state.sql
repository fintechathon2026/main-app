-- Owner: R3 (roles.md).
-- Mock escrow state that mirrors PrepaidEscrow (architecture §24.3, §24.13): plan ids for new
-- purchases, the purchase-authorization replay store (contract authUsed), and a payout ledger
-- so every unit of money that leaves a plan is traceable to the merchant or the owner (G9/G10).
-- Only reins_mockbank may touch this schema.

-- The seed uses plan 1; new mock purchases start well above it.
create sequence mockbank.escrow_plan_id_seq start 1000;

alter table mockbank.escrow_plans
  add column offer_hash  text,
  add column purchase_tx text;

-- A plan never holds negative money (seed balance is 480000, valid).
alter table mockbank.escrow_plans
  add constraint escrow_plans_balance_nonnegative check (balance >= 0);

-- Each purchase authorization digest is usable once.
create table mockbank.escrow_auth_used (
  digest        text primary key,
  chain_plan_id numeric(78, 0) not null references mockbank.escrow_plans(chain_plan_id),
  used_at       timestamptz not null default now()
);

-- Money out of a plan: merchant (redeem) or consumer/owner (exits). Never anyone else.
create table mockbank.escrow_payouts (
  id            bigint generated always as identity primary key,
  chain_plan_id numeric(78, 0) not null references mockbank.escrow_plans(chain_plan_id),
  to_address    text not null,
  role          text not null check (role in ('merchant','consumer')),
  amount        bigint not null check (amount >= 0),          -- fen
  reason        text not null check (reason in ('redeem','exit_attested','exit_voluntary_refund','exit_voluntary_fee')),
  tx_id         text not null,
  created_at    timestamptz not null default now()
);
create index mb_escrow_payouts_plan on mockbank.escrow_payouts(chain_plan_id, id);

revoke all on mockbank.escrow_auth_used, mockbank.escrow_payouts from public, anon, authenticated;
revoke all on sequence mockbank.escrow_plan_id_seq from public, anon, authenticated;
grant select, insert, update, delete on mockbank.escrow_auth_used, mockbank.escrow_payouts to reins_mockbank;
grant usage, select on sequence mockbank.escrow_plan_id_seq to reins_mockbank;
grant usage on sequence mockbank.escrow_payouts_id_seq to reins_mockbank;

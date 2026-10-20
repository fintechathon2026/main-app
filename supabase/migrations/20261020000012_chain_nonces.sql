-- Owner: R3 (roles.md).
-- Nonce allocation for the server's chain senders (relayer, agent), PRD_PrepaidEscrow_Contract §6
-- and §7.4. chain_txs is user-scoped under RLS, so one user's transaction cannot see the nonces
-- another user's actions used from the same sender; a row lock here serializes allocation for
-- all users. System table: reins_server only, like chain_cursors.

create table public.chain_nonces (
  sender     text primary key check (sender ~ '^0x[0-9a-f]{40}$'),  -- lowercase address
  next_nonce bigint not null check (next_nonce >= 0),
  updated_at timestamptz not null default now()
);

alter table public.chain_nonces enable row level security;
alter table public.chain_nonces force row level security;
revoke all on public.chain_nonces from public, anon, authenticated, reins_server;
grant select, insert, update on public.chain_nonces to reins_server;
create policy chain_nonces_server on public.chain_nonces for all to reins_server using (true) with check (true);

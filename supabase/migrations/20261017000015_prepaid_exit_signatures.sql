-- Owner: R3 (roles.md).
-- The owner's EIP-712 VoluntaryExit(uint256 planId,uint64 deadline) signature for one
-- prepaid_exit action (architecture §24.3, §24.5). Kept out of the action args, so the agent
-- can never supply or change it (G2, G6) and the action hash stays the same. Only the
-- signature and its deadline are stored; the consumer key never reaches the server (G9/G10).
-- RLS as for every user-scoped table in migration 005.

create table public.prepaid_exit_signatures (
  action_id    uuid primary key references public.actions(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  deadline     bigint not null check (deadline > 0),
  consumer_sig text not null check (consumer_sig ~ '^0x[0-9a-fA-F]{130}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.prepaid_exit_signatures enable row level security;
alter table public.prepaid_exit_signatures force row level security;
revoke all on public.prepaid_exit_signatures from public, anon, authenticated, reins_server;
grant select on public.prepaid_exit_signatures to authenticated;
grant select, insert, update, delete on public.prepaid_exit_signatures to reins_server;

create policy prepaid_exit_signatures_owner_read on public.prepaid_exit_signatures
  for select to authenticated, reins_server using (user_id = public.request_user_id());
create policy prepaid_exit_signatures_server_write on public.prepaid_exit_signatures
  for all to reins_server using (user_id = public.app_user_id()) with check (user_id = public.app_user_id());

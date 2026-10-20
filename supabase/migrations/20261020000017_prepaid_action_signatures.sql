-- Owner: R3 (roles.md). Second review: R2.
-- Signed EIP-712 payloads for user-initiated prepaid actions (architecture §8.2, §24.3):
-- prepaid_purchase (offer + merchant sig + PurchaseAuth + consumer sig + permit), prepaid_redeem
-- (Redeem + both sigs) and prepaid_exit_voluntary (VoluntaryExit deadline + consumer sig).
-- Like prepaid_exit_signatures (migration 015): kept out of the action args, so the agent can
-- never supply or change them (G2, G6) and the action hash is not affected. Only signatures and
-- the signed messages are stored; the consumer key never reaches the server (G9/G10).
-- The executor re-verifies every signature before it may influence a decision or reach the escrow.

create table public.prepaid_action_signatures (
  action_id  uuid primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  tool       text not null check (tool in ('prepaid_purchase', 'prepaid_redeem', 'prepaid_exit_voluntary')),
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (action_id, user_id) references public.actions (id, user_id) on delete cascade
);

alter table public.prepaid_action_signatures enable row level security;
alter table public.prepaid_action_signatures force row level security;
revoke all on public.prepaid_action_signatures from public, anon, authenticated, reins_server;
grant select on public.prepaid_action_signatures to authenticated;
grant select, insert, update, delete on public.prepaid_action_signatures to reins_server;

create policy prepaid_action_signatures_owner_read on public.prepaid_action_signatures
  for select to authenticated, reins_server using (user_id = public.request_user_id());
create policy prepaid_action_signatures_server_write on public.prepaid_action_signatures
  for all to reins_server using (user_id = public.app_user_id()) with check (user_id = public.app_user_id());

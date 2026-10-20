-- Owner: R3 (roles.md).
-- System reads for cron jobs (architecture §11.1, §12.3).
-- reins_server has no BYPASSRLS and RLS shows it only the rows of the user in app.user_id, so a
-- job cannot list "all users" or "all active plans" on its own. These functions are security
-- definer (owned by the migration role, which has BYPASSRLS in Supabase) so that the job can
-- enumerate work, then do every per-user read and write in withUserTx under RLS as usual.
-- They return ids only, no financial data. Only reins_server may execute them.

-- Active prepaid plans across users, for the risk job (src/server/risk/repo.ts).
create or replace function public.risk_active_prepaid_plans()
returns table (user_id uuid, plan_id uuid, merchant_id text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.id, p.merchant_id
    from public.prepaid_plans p
   where p.status = 'active'
   order by p.user_id, p.id
$$;

-- Users with an active mandate, for the detect and cleanup jobs.
create or replace function public.cron_user_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select u.id
    from public.users u
   where exists (select 1 from public.mandates m where m.user_id = u.id and m.status = 'active')
   order by u.id
$$;

revoke all on function public.risk_active_prepaid_plans() from public, anon, authenticated;
revoke all on function public.cron_user_ids() from public, anon, authenticated;
grant execute on function public.risk_active_prepaid_plans() to reins_server;
grant execute on function public.cron_user_ids() to reins_server;

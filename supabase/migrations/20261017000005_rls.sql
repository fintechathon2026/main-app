-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- Grants and Row Level Security (architecture §12.1, §12.3).
-- User-scoped tables: owners read (auth.uid() or app.user_id); reins_server writes only rows of
-- the user set in app.user_id for the current transaction. Reference tables: readable by
-- authenticated, writable by reins_server. System tables: reins_server only.

do $$
declare
  t text;
  user_tables text[] := array[
    'data_sources','accounts','transactions','documents','billers','bills','subscriptions',
    'usage_signals','recommendations','mandates','plans','actions','approvals','daily_limits',
    'cap_reservations','audit_log','kill_switch','wallets','prepaid_plans','prepaid_sessions','chain_txs'];
  reference_tables text[] := array[
    'merchants','fx_rates','prepaid_merchants','prepaid_offers','attestations','risk_signals'];
  system_tables text[] := array['job_runs','chain_cursors'];
begin
  foreach t in array user_tables || reference_tables || system_tables || array['users'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, reins_server', t);
  end loop;

  foreach t in array user_tables loop
    execute format('grant select on public.%I to authenticated', t);
    if t = 'audit_log' then
      execute format('grant select, insert on public.%I to reins_server', t);  -- append-only
    else
      execute format('grant select, insert, update, delete on public.%I to reins_server', t);
    end if;
    execute format(
      'create policy %I on public.%I for select to authenticated, reins_server using (user_id = public.request_user_id())',
      t || '_owner_read', t);
    execute format(
      'create policy %I on public.%I for all to reins_server using (user_id = public.app_user_id()) with check (user_id = public.app_user_id())',
      t || '_server_write', t);
  end loop;

  foreach t in array reference_tables loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to reins_server', t);
    execute format('create policy %I on public.%I for select to authenticated, reins_server using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to reins_server using (true) with check (true)', t || '_server_write', t);
  end loop;

  foreach t in array system_tables loop
    execute format('grant select, insert, update, delete on public.%I to reins_server', t);
    execute format('create policy %I on public.%I for all to reins_server using (true) with check (true)', t || '_server', t);
  end loop;
end
$$;

-- users: keyed by id instead of user_id.
grant select on public.users to authenticated;
grant select, insert, update on public.users to reins_server;
create policy users_owner_read on public.users for select to authenticated, reins_server
  using (id = public.request_user_id());
create policy users_server_write on public.users for all to reins_server
  using (id = public.app_user_id()) with check (id = public.app_user_id());

grant usage on all sequences in schema public to reins_server;

-- Audit log is append-only for everyone, including table owners (defense in depth for G7).
revoke update, delete, truncate on public.audit_log from public, anon, authenticated, reins_server;

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end
$$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

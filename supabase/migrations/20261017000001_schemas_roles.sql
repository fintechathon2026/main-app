-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- Schemas and roles (architecture §12.1).
--   public    app tables: authenticated reads via RLS; reins_server writes (RLS, no BYPASSRLS)
--   langgraph checkpoints: reins_server only; not exposed through PostgREST
--   mockbank  mock bank state: reins_mockbank only
--   eval      eval cases and runs: reins_server
-- Roles are created NOLOGIN here. Local login passwords are set in supabase/seed.sql only;
-- production credentials are set out of band, never in a migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'reins_server') then
    create role reins_server nologin nobypassrls noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'reins_mockbank') then
    create role reins_mockbank nologin nobypassrls noinherit;
  end if;
end
$$;

-- Defensive: these roles must never bypass RLS.
alter role reins_server nobypassrls;
alter role reins_mockbank nobypassrls;

create schema if not exists langgraph;
create schema if not exists mockbank;
create schema if not exists eval;

revoke all on schema langgraph, mockbank, eval from public;
revoke all on schema langgraph, mockbank, eval from anon, authenticated;

grant usage on schema public to reins_server;
grant usage, create on schema langgraph to reins_server; -- checkpointer setup() creates its tables
grant usage on schema eval to reins_server;
grant usage on schema mockbank to reins_mockbank;

-- Supabase grants anon/authenticated everything on new public tables by default. Reins writes
-- only through reins_server, so strip those defaults; each table grants exactly what it needs.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- The user a request acts for: the Supabase JWT user, else the server-set app.user_id
-- (architecture §12.3). Security definer only so that reins_server need not be granted the
-- auth schema; it reads nothing but request settings.
create or replace function public.request_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.uid(), nullif(current_setting('app.user_id', true), '')::uuid)
$$;

-- The user the server transaction acts for (reins_server write policies).
create or replace function public.app_user_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

revoke all on function public.request_user_id() from public;
revoke all on function public.app_user_id() from public;
grant execute on function public.request_user_id() to authenticated, reins_server;
grant execute on function public.app_user_id() to reins_server;

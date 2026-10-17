-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
--
-- 1. New plan trigger "document": a plan started for a newly uploaded bill document
--    (src/server/ingest/on-document.ts). Previously reused "detector", which gave the Planner
--    the subscription-detector task text.
-- 2. LangGraph checkpoint tables are created by `pnpm db:checkpointer` over the admin/direct
--    connection (setup() needs database-level CREATE, which reins_server lacks). Grant the app
--    role table access, now and for tables created later.

alter table public.plans drop constraint if exists plans_trigger_check;
alter table public.plans add constraint plans_trigger_check
  check (trigger in ('chat','document','due_date','payday','renewal','trial','detector','digest','prepaid_risk','chain_event','user_action'));

grant select, insert, update, delete on all tables in schema langgraph to reins_server;
grant usage, select on all sequences in schema langgraph to reins_server;
alter default privileges in schema langgraph grant select, insert, update, delete on tables to reins_server;
alter default privileges in schema langgraph grant usage, select on sequences to reins_server;

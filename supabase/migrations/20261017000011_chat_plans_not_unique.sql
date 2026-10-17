-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- one_running_plan (architecture §11.2) with NULLS NOT DISTINCT made every subject-less chat plan
-- collide: one chat plan paused at an approval blocked all further chat for that user. A chat
-- message is its own plan, so chat is excluded; every other trigger keeps one running or paused
-- plan per (user, trigger, subject).

drop index if exists public.one_running_plan;
create unique index one_running_plan on public.plans(user_id, trigger, subject_id) nulls not distinct
  where status in ('running','paused') and trigger <> 'chat';

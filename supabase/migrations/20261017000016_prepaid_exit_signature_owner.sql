-- Owner: R3 (roles.md).
-- A stored VoluntaryExit signature belongs to the action's owner.
-- Migration 015 tied action_id to actions and user_id to users separately, so only
-- application code kept them equal. The composite FK makes the database enforce it.
-- Additive: the 015 FK, RLS (enabled + forced), policies and grants are unchanged.
-- No backfill: the seed has no rows here, and the only writer
-- (recordVoluntaryExitSignature) uses the action's own user id. A mismatched row would
-- make this migration fail, on purpose.

-- FK target. Trivially true since id is the primary key.
alter table public.actions
  add constraint actions_id_user_id_key unique (id, user_id);

alter table public.prepaid_exit_signatures
  add constraint prepaid_exit_signatures_action_owner_fkey
  foreign key (action_id, user_id) references public.actions (id, user_id) on delete cascade;

-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- One open approval per ACTION, not per action hash (architecture §8.3). A re-plan (PRD §10.6,
-- H9) can propose an action with the same args hash as the one it cancelled; the global
-- per-hash index then refused the new approval. Approvals are consumed by (action_id,
-- action_hash), so scoping the index per action keeps G3 (one action, once). Open approvals of
-- actions that end without executing are expired by the app (src/server/approvals).

drop index if exists public.approvals_one_open_per_hash;
create unique index approvals_one_open_per_action on public.approvals(action_id)
  where status in ('pending','approved');

-- Approvals still open for actions that already ended without executing.
update public.approvals ap set status = 'expired'
  from public.actions a
 where a.id = ap.action_id
   and ap.status in ('pending','approved')
   and a.status in ('denied','rejected','expired','cancelled_replan');

-- Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
-- Document processing status for the Reader pipeline (upload -> stored -> parsed | needs_review).
-- Column naming follows PRD §13: documents(sha256), unique (user_id, sha256).

alter table public.documents
  add column status text not null default 'stored'
  check (status in ('stored', 'needs_review', 'parsed'));

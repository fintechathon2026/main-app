-- Owner: R3 (roles.md).
-- Pin the search_path of the audit_log trigger function (Supabase security advisor 0011,
-- function_search_path_mutable). The function references no objects, so an empty path changes
-- nothing; it only removes the advisor warning on the hosted project. Migration 005 is applied,
-- so this is a new file instead of an edit.

alter function public.audit_log_immutable() set search_path = '';

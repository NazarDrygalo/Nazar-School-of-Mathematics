-- Close unintended function-execution grants and add covering foreign-key indexes.
-- Run after 20260820120000_google_calendar_sync.sql.

-- Trigger helpers need a fixed catalog-only lookup path and are never browser RPCs.
alter function public.set_updated_at() set search_path = pg_catalog;
alter function public.set_user_role_updated_at() set search_path = pg_catalog;
alter function public.set_portal_invitation_updated_at() set search_path = pg_catalog;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_user_role_updated_at() from public, anon, authenticated;
revoke execute on function public.set_portal_invitation_updated_at() from public, anon, authenticated;

-- These helpers must never be callable without authentication. The signed-in
-- grants remain because RLS policies and constraints evaluate them as the caller.
revoke execute on function public.is_student() from public, anon;
revoke execute on function public.is_tutor() from public, anon;
revoke execute on function public.session_note_tutor_matches_session(uuid, uuid) from public, anon;

-- Event-trigger infrastructure is invoked by Postgres, not through the Data API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Require every future public RPC to opt into its intended roles explicitly.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- PostgreSQL does not automatically index the referencing side of foreign keys.
create index if not exists assignments_tutor_id_idx
  on public.assignments(tutor_id);
create index if not exists google_calendar_oauth_states_tutor_id_idx
  on public.google_calendar_oauth_states(tutor_id);
create index if not exists notification_deliveries_change_request_id_idx
  on public.notification_deliveries(change_request_id);
create index if not exists portal_invitations_auth_user_id_idx
  on public.portal_invitations(auth_user_id);
create index if not exists portal_invitations_invited_by_idx
  on public.portal_invitations(invited_by);
create index if not exists session_change_requests_requested_by_idx
  on public.session_change_requests(requested_by);
create index if not exists session_change_requests_reviewed_by_idx
  on public.session_change_requests(reviewed_by);
create index if not exists session_notes_tutor_id_idx
  on public.session_notes(tutor_id);
create index if not exists session_parent_summaries_tutor_id_idx
  on public.session_parent_summaries(tutor_id);
create index if not exists student_progress_tutor_id_idx
  on public.student_progress(tutor_id);
create index if not exists student_tutor_assignments_assigned_by_idx
  on public.student_tutor_assignments(assigned_by);

comment on function public.rls_auto_enable() is
  'Internal event-trigger helper. Direct execution is revoked from browser roles.';

-- Keep privileged implementations outside the exposed Data API schema while
-- preserving the existing public RPC names through invoker-rights wrappers.
-- Run after 20260820133000_rls_policy_performance.sql.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon;

-- Moving functions preserves policy, constraint, and function dependencies.
alter function public.is_admin() set schema private;
alter function public.is_student() set schema private;
alter function public.is_tutor() set schema private;
alter function public.session_note_tutor_matches_session(uuid, uuid) set schema private;
alter function public.onboard_accepted_application(uuid, uuid) set schema private;
alter function public.save_tutoring_session_note(uuid, text, text) set schema private;

revoke all on function private.is_admin() from public, anon;
revoke all on function private.is_student() from public, anon;
revoke all on function private.is_tutor() from public, anon;
revoke all on function private.session_note_tutor_matches_session(uuid, uuid) from public, anon;
revoke all on function private.onboard_accepted_application(uuid, uuid) from public, anon;
revoke all on function private.save_tutoring_session_note(uuid, text, text) from public, anon;

grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.is_student() to authenticated, service_role;
grant execute on function private.is_tutor() to authenticated, service_role;
grant execute on function private.session_note_tutor_matches_session(uuid, uuid) to authenticated, service_role;
grant execute on function private.onboard_accepted_application(uuid, uuid) to authenticated, service_role;
grant execute on function private.save_tutoring_session_note(uuid, text, text) to authenticated, service_role;

-- Public compatibility functions have invoker rights, so the exposed function
-- itself cannot bypass RLS. The private implementation repeats authorization.
create function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_admin(); $$;

create function public.is_student()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_student(); $$;

create function public.is_tutor()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_tutor(); $$;

create function public.onboard_accepted_application(
  application_id uuid,
  assigned_tutor_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.onboard_accepted_application($1, $2); $$;

create function public.save_tutoring_session_note(
  note_session_id uuid,
  private_content text,
  family_summary text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.save_tutoring_session_note($1, $2, $3); $$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_student() from public, anon;
revoke all on function public.is_tutor() from public, anon;
revoke all on function public.onboard_accepted_application(uuid, uuid) from public, anon;
revoke all on function public.save_tutoring_session_note(uuid, text, text) from public, anon;

grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_student() to authenticated, service_role;
grant execute on function public.is_tutor() to authenticated, service_role;
grant execute on function public.onboard_accepted_application(uuid, uuid) to authenticated, service_role;
grant execute on function public.save_tutoring_session_note(uuid, text, text) to authenticated, service_role;

comment on schema private is
  'Non-exposed implementations for privileged database helpers and RPC workflows.';
comment on function public.onboard_accepted_application(uuid, uuid) is
  'Invoker-rights public entry point; authorization and writes occur in the private implementation.';
comment on function public.save_tutoring_session_note(uuid, text, text) is
  'Invoker-rights public entry point; tutor assignment checks and writes occur in the private implementation.';

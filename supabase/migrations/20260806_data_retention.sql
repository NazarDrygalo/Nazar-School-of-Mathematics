-- Enforces the school's one-week retention policy for applications and
-- historical portal activity. Run after 20260805_secure_scheduling.sql.
--
-- Active parent/student/tutor profiles, active tutor assignments, and future
-- sessions are preserved so current tutoring is not interrupted. Historical
-- notes, progress, assignments, ended sessions, and applications expire after
-- seven days. Unlinked inactive profiles are then removed when orphaned.

create or replace function public.purge_expired_tutoring_data(retention_interval interval default interval '7 days')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - retention_interval;
  deleted_notes integer := 0;
  deleted_change_requests integer := 0;
  deleted_progress integer := 0;
  deleted_assignments integer := 0;
  deleted_sessions integer := 0;
  deleted_applications integer := 0;
  deleted_students integer := 0;
  deleted_parents integer := 0;
  deleted_tutors integer := 0;
begin
  if retention_interval < interval '1 day' then
    raise exception 'Retention interval must be at least one day.';
  end if;

  delete from public.session_notes where created_at < cutoff;
  get diagnostics deleted_notes = row_count;

  delete from public.session_change_requests where created_at < cutoff;
  get diagnostics deleted_change_requests = row_count;

  delete from public.student_progress where recorded_at < cutoff;
  get diagnostics deleted_progress = row_count;

  delete from public.assignments where created_at < cutoff;
  get diagnostics deleted_assignments = row_count;

  delete from public.tutoring_sessions
  where ends_at < cutoff
     or (status = 'cancelled' and updated_at < cutoff);
  get diagnostics deleted_sessions = row_count;

  delete from public.applications where created_at < cutoff;
  get diagnostics deleted_applications = row_count;

  delete from public.students s
  where not s.active
    and s.auth_user_id is null
    and s.updated_at < cutoff
    and not exists (select 1 from public.applications a where a.student_id = s.id)
    and not exists (select 1 from public.tutoring_sessions ts where ts.student_id = s.id)
    and not exists (select 1 from public.assignments a where a.student_id = s.id)
    and not exists (select 1 from public.student_progress sp where sp.student_id = s.id)
    and not exists (select 1 from public.student_tutor_assignments sta where sta.student_id = s.id and sta.active);
  get diagnostics deleted_students = row_count;

  delete from public.parents p
  where p.auth_user_id is null
    and p.updated_at < cutoff
    and not exists (select 1 from public.students s where s.parent_id = p.id)
    and not exists (select 1 from public.applications a where a.parent_id = p.id);
  get diagnostics deleted_parents = row_count;

  delete from public.tutors t
  where not t.active
    and t.auth_user_id is null
    and t.updated_at < cutoff
    and not exists (select 1 from public.tutoring_sessions ts where ts.tutor_id = t.id)
    and not exists (select 1 from public.assignments a where a.tutor_id = t.id)
    and not exists (select 1 from public.student_progress sp where sp.tutor_id = t.id)
    and not exists (select 1 from public.student_tutor_assignments sta where sta.tutor_id = t.id and sta.active);
  get diagnostics deleted_tutors = row_count;

  return jsonb_build_object(
    'cutoff', cutoff,
    'session_notes', deleted_notes,
    'session_change_requests', deleted_change_requests,
    'progress_entries', deleted_progress,
    'assignments', deleted_assignments,
    'sessions', deleted_sessions,
    'applications', deleted_applications,
    'students', deleted_students,
    'parents', deleted_parents,
    'tutors', deleted_tutors
  );
end;
$$;

revoke all on function public.purge_expired_tutoring_data(interval) from public, anon, authenticated;
grant execute on function public.purge_expired_tutoring_data(interval) to service_role;

comment on function public.purge_expired_tutoring_data(interval) is
  'Deletes tutoring application and historical portal data older than the supplied interval; defaults to seven days.';

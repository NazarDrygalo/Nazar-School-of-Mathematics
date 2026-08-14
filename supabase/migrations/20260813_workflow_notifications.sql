-- Delivery tracking and atomic server-side resolution for tutoring workflow emails.
-- Run after 20260806_data_retention.sql.

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('session_created', 'session_updated', 'change_requested', 'change_resolved')),
  session_id uuid references public.tutoring_sessions(id) on delete cascade,
  change_request_id uuid references public.session_change_requests(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('administrator', 'parent', 'tutor')),
  recipient_email text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_deliveries_status_idx on public.notification_deliveries(status, attempted_at desc);
create index if not exists notification_deliveries_session_idx on public.notification_deliveries(session_id, attempted_at desc);

drop trigger if exists notification_deliveries_set_updated_at on public.notification_deliveries;
create trigger notification_deliveries_set_updated_at
before update on public.notification_deliveries
for each row execute function public.set_updated_at();

alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant select on public.notification_deliveries to authenticated;

drop policy if exists "admins read notification deliveries" on public.notification_deliveries;
create policy "admins read notification deliveries" on public.notification_deliveries
for select to authenticated using (public.is_admin());

create or replace function public.resolve_session_change_request_server(
  change_request_id uuid,
  resolution text,
  reviewer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  change_request public.session_change_requests%rowtype;
  session_duration interval;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access is required.'; end if;
  if resolution not in ('approved', 'declined') then raise exception 'Resolution must be approved or declined.'; end if;

  select * into change_request
  from public.session_change_requests
  where id = change_request_id and status = 'pending'
  for update;

  if change_request.id is null then raise exception 'A pending session change request was not found.'; end if;

  if resolution = 'approved' then
    if change_request.request_type = 'cancel' then
      update public.tutoring_sessions set status = 'cancelled' where id = change_request.session_id;
    else
      select ends_at - starts_at into session_duration
      from public.tutoring_sessions where id = change_request.session_id for update;
      update public.tutoring_sessions
      set starts_at = change_request.requested_starts_at,
          ends_at = change_request.requested_starts_at + session_duration,
          status = 'scheduled'
      where id = change_request.session_id;
    end if;
  end if;

  update public.session_change_requests
  set status = resolution, reviewed_by = reviewer_id, reviewed_at = now()
  where id = change_request.id;
end;
$$;

revoke all on function public.resolve_session_change_request_server(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_session_change_request_server(uuid, text, uuid) to service_role;

-- Include notification history in the existing one-week retention function
-- without changing the signature used by Supabase Cron and manual checks.
create or replace function public.purge_expired_tutoring_data(retention_interval interval default interval '7 days')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - retention_interval;
  deleted_notifications integer := 0;
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
  if retention_interval < interval '1 day' then raise exception 'Retention interval must be at least one day.'; end if;

  delete from public.notification_deliveries where created_at < cutoff;
  get diagnostics deleted_notifications = row_count;
  delete from public.session_notes where created_at < cutoff;
  get diagnostics deleted_notes = row_count;
  delete from public.session_change_requests where created_at < cutoff;
  get diagnostics deleted_change_requests = row_count;
  delete from public.student_progress where recorded_at < cutoff;
  get diagnostics deleted_progress = row_count;
  delete from public.assignments where created_at < cutoff;
  get diagnostics deleted_assignments = row_count;
  delete from public.tutoring_sessions where ends_at < cutoff or (status = 'cancelled' and updated_at < cutoff);
  get diagnostics deleted_sessions = row_count;
  delete from public.applications where created_at < cutoff;
  get diagnostics deleted_applications = row_count;

  delete from public.students s
  where not s.active and s.auth_user_id is null and s.updated_at < cutoff
    and not exists (select 1 from public.applications a where a.student_id = s.id)
    and not exists (select 1 from public.tutoring_sessions ts where ts.student_id = s.id)
    and not exists (select 1 from public.assignments a where a.student_id = s.id)
    and not exists (select 1 from public.student_progress sp where sp.student_id = s.id)
    and not exists (select 1 from public.student_tutor_assignments sta where sta.student_id = s.id and sta.active);
  get diagnostics deleted_students = row_count;

  delete from public.parents p
  where p.auth_user_id is null and p.updated_at < cutoff
    and not exists (select 1 from public.students s where s.parent_id = p.id)
    and not exists (select 1 from public.applications a where a.parent_id = p.id);
  get diagnostics deleted_parents = row_count;

  delete from public.tutors t
  where not t.active and t.auth_user_id is null and t.updated_at < cutoff
    and not exists (select 1 from public.tutoring_sessions ts where ts.tutor_id = t.id)
    and not exists (select 1 from public.assignments a where a.tutor_id = t.id)
    and not exists (select 1 from public.student_progress sp where sp.tutor_id = t.id)
    and not exists (select 1 from public.student_tutor_assignments sta where sta.tutor_id = t.id and sta.active);
  get diagnostics deleted_tutors = row_count;

  return jsonb_build_object(
    'cutoff', cutoff,
    'notification_deliveries', deleted_notifications,
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
  'Deletes tutoring application, notification, and historical portal data older than the supplied interval; defaults to seven days.';

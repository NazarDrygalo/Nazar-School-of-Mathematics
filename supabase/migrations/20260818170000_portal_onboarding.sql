-- Secure, idempotent portal-account invitations and Auth-user linking.
-- Run after 20260818_admin_mfa.sql and deploy the matching server/UI code immediately.

alter table public.students add column if not exists email text;
create unique index if not exists students_email_unique_idx
  on public.students (lower(email)) where email is not null;

create table if not exists public.portal_invitations (
  id uuid primary key default gen_random_uuid(),
  target_role text not null check (target_role in ('parent', 'student', 'tutor')),
  target_id uuid not null,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'linked', 'failed')),
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid references auth.users(id) on delete set null,
  last_request_id uuid,
  attempts integer not null default 0 check (attempts >= 0),
  invitation_sent_at timestamptz,
  linked_at timestamptz,
  last_attempt_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_role, target_id)
);

create or replace function public.set_portal_invitation_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists portal_invitations_set_updated_at on public.portal_invitations;
create trigger portal_invitations_set_updated_at before update on public.portal_invitations
for each row execute function public.set_portal_invitation_updated_at();

alter table public.portal_invitations enable row level security;
revoke all on public.portal_invitations from public, anon, authenticated;
grant select on public.portal_invitations to authenticated;

drop policy if exists "admins read portal invitations" on public.portal_invitations;
create policy "admins read portal invitations" on public.portal_invitations
for select to authenticated using (public.is_admin());

create or replace function public.claim_portal_invitation(
  p_target_role text,
  p_target_id uuid,
  p_invitation_email text,
  p_request_id uuid,
  p_invited_by uuid
)
returns table (invitation_id uuid, claimed boolean, current_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.portal_invitations%rowtype;
begin
  if p_target_role not in ('parent', 'student', 'tutor') or nullif(trim(p_invitation_email), '') is null then
    raise exception 'A valid portal invitation target is required.';
  end if;

  select * into invitation from public.portal_invitations
  where portal_invitations.target_role = p_target_role
    and portal_invitations.target_id = p_target_id
  for update;

  if found and invitation.last_request_id = p_request_id then
    return query select invitation.id, false, invitation.status;
    return;
  end if;

  if found then
    update public.portal_invitations set
      email = lower(trim(p_invitation_email)),
      status = 'pending',
      invited_by = p_invited_by,
      last_request_id = p_request_id,
      attempts = portal_invitations.attempts + 1,
      last_attempt_at = now(),
      error = null
    where id = invitation.id
    returning * into invitation;
  else
    insert into public.portal_invitations (
      target_role, target_id, email, invited_by, last_request_id, attempts, last_attempt_at
    ) values (
      p_target_role, p_target_id, lower(trim(p_invitation_email)), p_invited_by, p_request_id, 1, now()
    ) returning * into invitation;
  end if;

  return query select invitation.id, true, invitation.status;
end;
$$;

revoke all on function public.claim_portal_invitation(text, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_portal_invitation(text, uuid, text, uuid, uuid) to service_role;

-- Only the server-side service-role client may attach Auth users. The function
-- verifies the operational record, prevents cross-record/cross-role reuse, and
-- writes the profile link and role in one database transaction.
create or replace function public.link_portal_auth_user(
  p_target_role text,
  p_target_id uuid,
  p_auth_user_id uuid,
  p_student_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_auth_user_id uuid;
  existing_role text;
  expected_email text;
  auth_email text;
  eligible boolean := false;
begin
  if p_target_role not in ('parent', 'student', 'tutor') then
    raise exception 'Select a valid portal role.';
  end if;

  if p_target_role = 'parent' then
    select p.auth_user_id, lower(p.email), true into existing_auth_user_id, expected_email, eligible
    from public.parents p
    where p.id = p_target_id
      and exists (select 1 from public.applications a where a.parent_id = p.id and a.status = 'accepted');
  elsif p_target_role = 'student' then
    select s.auth_user_id, lower(trim(p_student_email)), true into existing_auth_user_id, expected_email, eligible
    from public.students s
    where s.id = p_target_id and s.active
      and exists (select 1 from public.applications a where a.student_id = s.id and a.status = 'accepted');
    if nullif(trim(p_student_email), '') is null then
      raise exception 'A student email address is required.';
    end if;
  else
    select t.auth_user_id, lower(t.email), true into existing_auth_user_id, expected_email, eligible
    from public.tutors t where t.id = p_target_id and t.active;
  end if;

  if not eligible then
    raise exception 'The portal record is not eligible for an invitation.';
  end if;
  select lower(email) into auth_email from auth.users where id = p_auth_user_id;
  if auth_email is null or auth_email <> expected_email then
    raise exception 'The Auth user email does not match the portal record.';
  end if;
  if existing_auth_user_id is not null and existing_auth_user_id <> p_auth_user_id then
    raise exception 'This portal record is already linked to another Auth user.';
  end if;
  if exists (select 1 from public.parents where auth_user_id = p_auth_user_id and not (p_target_role = 'parent' and id = p_target_id))
    or exists (select 1 from public.students where auth_user_id = p_auth_user_id and not (p_target_role = 'student' and id = p_target_id))
    or exists (select 1 from public.tutors where auth_user_id = p_auth_user_id and not (p_target_role = 'tutor' and id = p_target_id)) then
    raise exception 'This Auth user is already linked to another portal record.';
  end if;

  select role into existing_role from public.user_roles where user_id = p_auth_user_id;
  if existing_role is not null and existing_role <> p_target_role then
    raise exception 'This Auth user already has another portal role.';
  end if;

  if p_target_role = 'parent' then
    update public.parents set auth_user_id = p_auth_user_id where id = p_target_id;
  elsif p_target_role = 'student' then
    update public.students set
      auth_user_id = p_auth_user_id,
      email = lower(trim(p_student_email))
    where id = p_target_id;
  else
    update public.tutors set auth_user_id = p_auth_user_id where id = p_target_id;
  end if;

  insert into public.user_roles (user_id, role)
  values (p_auth_user_id, p_target_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;

revoke all on function public.link_portal_auth_user(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.link_portal_auth_user(text, uuid, uuid, text) to service_role;

comment on function public.link_portal_auth_user(text, uuid, uuid, text) is
  'Service-role-only atomic portal profile and user-role linking for eligible parents, students, and tutors.';

-- Portal invitation attempts are operational activity and follow the same
-- seven-day retention window as notification and workflow-delivery records.
create or replace function public.purge_expired_tutoring_data(retention_interval interval default interval '7 days')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - retention_interval;
  deleted_portal_invitations integer := 0;
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

  delete from public.portal_invitations where updated_at < cutoff;
  get diagnostics deleted_portal_invitations = row_count;
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
    'portal_invitations', deleted_portal_invitations,
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
  'Deletes tutoring application, invitation, notification, and historical portal data older than the supplied interval; defaults to seven days.';

-- Secure tutor/student assignments, tutor scheduling, and acceptance-email state.
-- Run after 20260805_role_portals.sql and before deploying the matching code.

alter table public.applications
  add column if not exists accepted_email_status text not null default 'not_sent',
  add column if not exists accepted_email_sent_at timestamptz,
  add column if not exists accepted_email_error text;

alter table public.applications drop constraint if exists applications_accepted_email_status_check;
alter table public.applications add constraint applications_accepted_email_status_check
  check (accepted_email_status in ('not_sent', 'sending', 'sent', 'failed'));

create table if not exists public.student_tutor_assignments (
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  active boolean not null default true,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, tutor_id)
);

create index if not exists student_tutor_assignments_tutor_idx
  on public.student_tutor_assignments(tutor_id, active);
create unique index if not exists student_tutor_assignments_one_active_tutor_idx
  on public.student_tutor_assignments(student_id) where active;

drop trigger if exists student_tutor_assignments_set_updated_at on public.student_tutor_assignments;
create trigger student_tutor_assignments_set_updated_at
before update on public.student_tutor_assignments
for each row execute function public.set_updated_at();

alter table public.student_tutor_assignments enable row level security;
revoke all on public.student_tutor_assignments from anon;
grant select, insert, update, delete on public.student_tutor_assignments to authenticated;
grant update on public.students to authenticated;

drop policy if exists "admins read tutors" on public.tutors;
create policy "admins read tutors" on public.tutors
for select to authenticated using (public.is_admin());

drop policy if exists "admins update students" on public.students;
create policy "admins update students" on public.students
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage tutor assignments" on public.student_tutor_assignments;
create policy "admins manage tutor assignments" on public.student_tutor_assignments
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "tutors read their student assignments" on public.student_tutor_assignments;
create policy "tutors read their student assignments" on public.student_tutor_assignments
for select to authenticated using (
  exists (
    select 1 from public.tutors t
    where t.id = student_tutor_assignments.tutor_id
      and t.auth_user_id = auth.uid()
      and t.active
  )
);

drop policy if exists "tutors read assigned students" on public.students;
create policy "tutors read assigned students" on public.students
for select to authenticated using (
  exists (
    select 1
    from public.student_tutor_assignments sta
    join public.tutors t on t.id = sta.tutor_id
    where sta.student_id = students.id
      and sta.active
      and t.active
      and t.auth_user_id = auth.uid()
  )
);

-- One administrator action converts an accepted application into an active
-- student/tutor relationship. The transaction rolls back if any step fails.
create or replace function public.onboard_accepted_application(application_id uuid, assigned_tutor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_student_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.';
  end if;

  select student_id into accepted_student_id
  from public.applications
  where id = application_id and status = 'accepted';

  if accepted_student_id is null then
    raise exception 'Only an accepted application can be onboarded.';
  end if;
  if not exists (select 1 from public.tutors where id = assigned_tutor_id and active) then
    raise exception 'Select an active tutor.';
  end if;

  update public.students set active = true where id = accepted_student_id;
  update public.student_tutor_assignments set active = false
    where student_id = accepted_student_id and tutor_id <> assigned_tutor_id and active;
  insert into public.student_tutor_assignments (student_id, tutor_id, active, assigned_by)
  values (accepted_student_id, assigned_tutor_id, true, auth.uid())
  on conflict (student_id, tutor_id) do update set
    active = true,
    assigned_by = excluded.assigned_by;
end;
$$;
revoke all on function public.onboard_accepted_application(uuid, uuid) from public, anon;
grant execute on function public.onboard_accepted_application(uuid, uuid) to authenticated;

-- Replace the earlier tutor write policies. Tutor ownership alone is not enough:
-- every student-scoped write must also have an active assignment.
drop policy if exists "tutors create their sessions" on public.tutoring_sessions;
create policy "tutors create sessions for assigned students" on public.tutoring_sessions
for insert to authenticated with check (
  exists (
    select 1
    from public.tutors t
    join public.student_tutor_assignments sta on sta.tutor_id = t.id
    where t.id = tutoring_sessions.tutor_id
      and t.auth_user_id = auth.uid()
      and t.active
      and sta.student_id = tutoring_sessions.student_id
      and sta.active
  )
);

drop policy if exists "tutors update their sessions" on public.tutoring_sessions;
create policy "tutors update sessions for assigned students" on public.tutoring_sessions
for update to authenticated
using (
  exists (select 1 from public.tutors t where t.id = tutoring_sessions.tutor_id and t.auth_user_id = auth.uid() and t.active)
)
with check (
  exists (
    select 1
    from public.tutors t
    join public.student_tutor_assignments sta on sta.tutor_id = t.id
    where t.id = tutoring_sessions.tutor_id
      and t.auth_user_id = auth.uid()
      and t.active
      and sta.student_id = tutoring_sessions.student_id
      and sta.active
  )
);

drop policy if exists "tutors create assignments" on public.assignments;
create policy "tutors create assignments for assigned students" on public.assignments
for insert to authenticated with check (
  exists (
    select 1 from public.tutors t
    join public.student_tutor_assignments sta on sta.tutor_id = t.id
    where t.id = assignments.tutor_id and t.auth_user_id = auth.uid() and t.active
      and sta.student_id = assignments.student_id and sta.active
  )
);

drop policy if exists "tutors update assignments" on public.assignments;
create policy "tutors update assignments for assigned students" on public.assignments
for update to authenticated
using (exists (select 1 from public.tutors t where t.id = assignments.tutor_id and t.auth_user_id = auth.uid() and t.active))
with check (
  exists (
    select 1 from public.tutors t
    join public.student_tutor_assignments sta on sta.tutor_id = t.id
    where t.id = assignments.tutor_id and t.auth_user_id = auth.uid() and t.active
      and sta.student_id = assignments.student_id and sta.active
  )
);

drop policy if exists "tutors create progress" on public.student_progress;
create policy "tutors create progress for assigned students" on public.student_progress
for insert to authenticated with check (
  exists (
    select 1 from public.tutors t
    join public.student_tutor_assignments sta on sta.tutor_id = t.id
    where t.id = student_progress.tutor_id and t.auth_user_id = auth.uid() and t.active
      and sta.student_id = student_progress.student_id and sta.active
  )
);

drop policy if exists "tutors update progress" on public.student_progress;
create policy "tutors update progress for assigned students" on public.student_progress
for update to authenticated
using (exists (select 1 from public.tutors t where t.id = student_progress.tutor_id and t.auth_user_id = auth.uid() and t.active))
with check (
  exists (
    select 1 from public.tutors t
    join public.student_tutor_assignments sta on sta.tutor_id = t.id
    where t.id = student_progress.tutor_id and t.auth_user_id = auth.uid() and t.active
      and sta.student_id = student_progress.student_id and sta.active
  )
);

-- Existing session-note policies remain safe because the note references a unique
-- session already owned by the tutor; this closes a separate integrity gap.
alter table public.session_notes drop constraint if exists session_notes_tutor_matches_session;
create or replace function public.session_note_tutor_matches_session(note_session_id uuid, note_tutor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tutoring_sessions
    where id = note_session_id and tutor_id = note_tutor_id
  );
$$;
revoke all on function public.session_note_tutor_matches_session(uuid, uuid) from public;
grant execute on function public.session_note_tutor_matches_session(uuid, uuid) to authenticated;
alter table public.session_notes add constraint session_notes_tutor_matches_session
  check (public.session_note_tutor_matches_session(session_id, tutor_id));

-- Post-launch parent, student, and tutor portal access.
alter table public.students add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
grant insert, update on public.tutoring_sessions, public.assignments, public.session_notes, public.student_progress to authenticated;

create or replace function public.is_tutor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tutors where auth_user_id = auth.uid());
$$;
create or replace function public.is_student()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students where auth_user_id = auth.uid());
$$;
revoke all on function public.is_tutor() from public;
revoke all on function public.is_student() from public;
grant execute on function public.is_tutor(), public.is_student() to authenticated;

create policy "students read their profile" on public.students for select to authenticated using (auth_user_id = auth.uid());
create policy "admins read sessions" on public.tutoring_sessions for select to authenticated using (public.is_admin());
create policy "admins read notes" on public.session_notes for select to authenticated using (public.is_admin());
create policy "admins read assignments" on public.assignments for select to authenticated using (public.is_admin());
create policy "admins read progress" on public.student_progress for select to authenticated using (public.is_admin());

create policy "tutors read their sessions" on public.tutoring_sessions for select to authenticated using (exists (select 1 from public.tutors where tutors.id = tutoring_sessions.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors create their sessions" on public.tutoring_sessions for insert to authenticated with check (exists (select 1 from public.tutors where tutors.id = tutoring_sessions.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors update their sessions" on public.tutoring_sessions for update to authenticated using (exists (select 1 from public.tutors where tutors.id = tutoring_sessions.tutor_id and tutors.auth_user_id = auth.uid())) with check (exists (select 1 from public.tutors where tutors.id = tutoring_sessions.tutor_id and tutors.auth_user_id = auth.uid()));

create policy "tutors read their assignments" on public.assignments for select to authenticated using (exists (select 1 from public.tutors where tutors.id = assignments.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors create assignments" on public.assignments for insert to authenticated with check (exists (select 1 from public.tutors where tutors.id = assignments.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors update assignments" on public.assignments for update to authenticated using (exists (select 1 from public.tutors where tutors.id = assignments.tutor_id and tutors.auth_user_id = auth.uid())) with check (exists (select 1 from public.tutors where tutors.id = assignments.tutor_id and tutors.auth_user_id = auth.uid()));

create policy "tutors read progress" on public.student_progress for select to authenticated using (exists (select 1 from public.tutors where tutors.id = student_progress.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors create progress" on public.student_progress for insert to authenticated with check (exists (select 1 from public.tutors where tutors.id = student_progress.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors update progress" on public.student_progress for update to authenticated using (exists (select 1 from public.tutors where tutors.id = student_progress.tutor_id and tutors.auth_user_id = auth.uid())) with check (exists (select 1 from public.tutors where tutors.id = student_progress.tutor_id and tutors.auth_user_id = auth.uid()));

create policy "tutors read their notes" on public.session_notes for select to authenticated using (exists (select 1 from public.tutors where tutors.id = session_notes.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors create notes" on public.session_notes for insert to authenticated with check (exists (select 1 from public.tutors where tutors.id = session_notes.tutor_id and tutors.auth_user_id = auth.uid()));
create policy "tutors update notes" on public.session_notes for update to authenticated using (exists (select 1 from public.tutors where tutors.id = session_notes.tutor_id and tutors.auth_user_id = auth.uid())) with check (exists (select 1 from public.tutors where tutors.id = session_notes.tutor_id and tutors.auth_user_id = auth.uid()));

create policy "students read sessions" on public.tutoring_sessions for select to authenticated using (exists (select 1 from public.students where students.id = tutoring_sessions.student_id and students.auth_user_id = auth.uid()));
create policy "students read assignments" on public.assignments for select to authenticated using (exists (select 1 from public.students where students.id = assignments.student_id and students.auth_user_id = auth.uid()));
create policy "students read progress" on public.student_progress for select to authenticated using (exists (select 1 from public.students where students.id = student_progress.student_id and students.auth_user_id = auth.uid()));

-- Link portal Auth users to existing records after inviting them through Supabase Auth:
-- update public.parents set auth_user_id = 'PARENT_AUTH_UUID' where email = 'parent@example.com';
-- update public.tutors set auth_user_id = 'TUTOR_AUTH_UUID' where email = 'tutor@example.com';
-- update public.students set auth_user_id = 'STUDENT_AUTH_UUID' where id = 'STUDENT_RECORD_UUID';
-- insert into public.user_roles (user_id, role) values ('AUTH_UUID', 'parent') on conflict (user_id) do update set role = excluded.role;

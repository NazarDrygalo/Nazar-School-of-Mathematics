-- Nazar's School of Mathematics: initial secure tutoring-platform foundation.
-- Run this migration in the Supabase SQL Editor or through the Supabase CLI.

create extension if not exists pgcrypto;

create table if not exists public.parents (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text,
  preferred_contact_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutors (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  bio text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  age smallint check (age between 5 and 22),
  gender text,
  grade text,
  school text,
  current_course text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  parent_id uuid not null references public.parents(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  help_areas text not null,
  academic_goals text not null,
  additional_student_info text,
  additional_contact_info text,
  preferred_days text not null,
  preferred_times text not null,
  timezone text not null,
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'accepted', 'declined', 'withdrawn')),
  notification_status text not null default 'pending' check (notification_status in ('pending', 'sent', 'failed')),
  notification_attempted_at timestamptz,
  notification_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutoring_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  meeting_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.session_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.tutoring_sessions(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  content text not null,
  parent_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  title text not null,
  instructions text,
  due_at timestamptz,
  status text not null default 'assigned' check (status in ('assigned', 'submitted', 'reviewed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  tutor_id uuid references public.tutors(id) on delete set null,
  recorded_at timestamptz not null default now(),
  area text not null,
  mastery_level smallint check (mastery_level between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists students_parent_id_idx on public.students(parent_id);
create index if not exists applications_parent_id_idx on public.applications(parent_id);
create index if not exists applications_student_id_idx on public.applications(student_id);
create index if not exists tutoring_sessions_student_starts_at_idx on public.tutoring_sessions(student_id, starts_at);
create index if not exists tutoring_sessions_tutor_starts_at_idx on public.tutoring_sessions(tutor_id, starts_at);
create index if not exists assignments_student_id_idx on public.assignments(student_id);
create index if not exists student_progress_student_id_idx on public.student_progress(student_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create or replace trigger parents_set_updated_at before update on public.parents for each row execute function public.set_updated_at();
create or replace trigger tutors_set_updated_at before update on public.tutors for each row execute function public.set_updated_at();
create or replace trigger students_set_updated_at before update on public.students for each row execute function public.set_updated_at();
create or replace trigger applications_set_updated_at before update on public.applications for each row execute function public.set_updated_at();
create or replace trigger tutoring_sessions_set_updated_at before update on public.tutoring_sessions for each row execute function public.set_updated_at();
create or replace trigger session_notes_set_updated_at before update on public.session_notes for each row execute function public.set_updated_at();
create or replace trigger assignments_set_updated_at before update on public.assignments for each row execute function public.set_updated_at();
create or replace trigger student_progress_set_updated_at before update on public.student_progress for each row execute function public.set_updated_at();

-- The server calls this function with the service-role key. It creates the
-- parent, student, and application in one transaction and de-duplicates retries.
create or replace function public.submit_tutoring_application(application jsonb)
returns table(application_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  new_parent_id uuid;
  new_student_id uuid;
  new_application_id uuid;
  submission uuid := (application->>'submission_id')::uuid;
  parent_email text := lower(trim(application->>'email'));
begin
  if submission is null or parent_email is null or parent_email = '' then
    raise exception 'A submission ID and parent email are required.';
  end if;

  select id into existing_id from public.applications where submission_id = submission;
  if existing_id is not null then
    return query select existing_id, false;
    return;
  end if;

  insert into public.parents (first_name, last_name, email, phone, preferred_contact_method)
  values (trim(application->>'parent_first_name'), trim(application->>'parent_last_name'), parent_email, nullif(trim(application->>'phone'), ''), nullif(trim(application->>'contact_method'), ''))
  on conflict (email) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    phone = excluded.phone,
    preferred_contact_method = excluded.preferred_contact_method
  returning id into new_parent_id;

  insert into public.students (parent_id, first_name, last_name, age, gender, grade, school, current_course)
  values (new_parent_id, trim(application->>'student_first_name'), trim(application->>'student_last_name'), (application->>'age')::smallint, nullif(trim(application->>'gender'), ''), trim(application->>'grade'), trim(application->>'school'), trim(application->>'current_course'))
  returning id into new_student_id;

  insert into public.applications (submission_id, parent_id, student_id, help_areas, academic_goals, additional_student_info, additional_contact_info, preferred_days, preferred_times, timezone)
  values (submission, new_parent_id, new_student_id, trim(application->>'help_areas'), trim(application->>'academic_goals'), nullif(trim(application->>'additional_student_info'), ''), nullif(trim(application->>'additional_contact_info'), ''), trim(application->>'days'), trim(application->>'times'), trim(application->>'timezone'))
  returning id into new_application_id;

  return query select new_application_id, true;
end;
$$;

-- Enable RLS everywhere. No anonymous role is granted access to student or parent data.
alter table public.parents enable row level security;
alter table public.students enable row level security;
alter table public.applications enable row level security;
alter table public.tutors enable row level security;
alter table public.tutoring_sessions enable row level security;
alter table public.session_notes enable row level security;
alter table public.assignments enable row level security;
alter table public.student_progress enable row level security;

revoke all on all tables in schema public from anon;
grant select on public.parents, public.students, public.applications, public.tutors, public.tutoring_sessions, public.session_notes, public.assignments, public.student_progress to authenticated;

create policy "parents read their profile" on public.parents for select to authenticated using (auth_user_id = auth.uid());
create policy "parents update their profile" on public.parents for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy "parents read their students" on public.students for select to authenticated using (exists (select 1 from public.parents p where p.id = students.parent_id and p.auth_user_id = auth.uid()));
create policy "parents read their applications" on public.applications for select to authenticated using (exists (select 1 from public.parents p where p.id = applications.parent_id and p.auth_user_id = auth.uid()));
create policy "tutors read their profile" on public.tutors for select to authenticated using (auth_user_id = auth.uid());
create policy "session participants read sessions" on public.tutoring_sessions for select to authenticated using (exists (select 1 from public.tutors t where t.id = tutoring_sessions.tutor_id and t.auth_user_id = auth.uid()) or exists (select 1 from public.students s join public.parents p on p.id = s.parent_id where s.id = tutoring_sessions.student_id and p.auth_user_id = auth.uid()));
create policy "session participants read notes" on public.session_notes for select to authenticated using (exists (select 1 from public.tutoring_sessions ts join public.tutors t on t.id = ts.tutor_id where ts.id = session_notes.session_id and t.auth_user_id = auth.uid()) or exists (select 1 from public.tutoring_sessions ts join public.students s on s.id = ts.student_id join public.parents p on p.id = s.parent_id where ts.id = session_notes.session_id and p.auth_user_id = auth.uid()));
create policy "assignment participants read assignments" on public.assignments for select to authenticated using (exists (select 1 from public.tutors t where t.id = assignments.tutor_id and t.auth_user_id = auth.uid()) or exists (select 1 from public.students s join public.parents p on p.id = s.parent_id where s.id = assignments.student_id and p.auth_user_id = auth.uid()));
create policy "progress participants read progress" on public.student_progress for select to authenticated using (exists (select 1 from public.tutors t where t.id = student_progress.tutor_id and t.auth_user_id = auth.uid()) or exists (select 1 from public.students s join public.parents p on p.id = s.parent_id where s.id = student_progress.student_id and p.auth_user_id = auth.uid()));

revoke execute on function public.submit_tutoring_application(jsonb) from public, anon, authenticated;
grant execute on function public.submit_tutoring_application(jsonb) to service_role;

-- Adds the tutoring-area choice used by the public application form.
-- Run this migration in the Supabase SQL Editor after deploying the code change.

alter table public.applications add column if not exists service_area text;
update public.applications set service_area = 'Math' where service_area is null;
alter table public.applications alter column service_area set not null;
alter table public.applications drop constraint if exists applications_service_area_check;
alter table public.applications add constraint applications_service_area_check check (service_area in ('Math', 'Science', 'Essay Writing'));

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
  requested_service_area text := trim(application->>'service_area');
begin
  if submission is null or parent_email is null or parent_email = '' then
    raise exception 'A submission ID and parent email are required.';
  end if;

  if requested_service_area is null or requested_service_area not in ('Math', 'Science', 'Essay Writing') then
    raise exception 'A valid tutoring area is required.';
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

  insert into public.applications (submission_id, parent_id, student_id, service_area, help_areas, academic_goals, additional_student_info, additional_contact_info, preferred_days, preferred_times, timezone)
  values (submission, new_parent_id, new_student_id, requested_service_area, trim(application->>'help_areas'), trim(application->>'academic_goals'), nullif(trim(application->>'additional_student_info'), ''), nullif(trim(application->>'additional_contact_info'), ''), trim(application->>'days'), trim(application->>'times'), trim(application->>'timezone'))
  returning id into new_application_id;

  return query select new_application_id, true;
end;
$$;

revoke execute on function public.submit_tutoring_application(jsonb) from public, anon, authenticated;
grant execute on function public.submit_tutoring_application(jsonb) to service_role;

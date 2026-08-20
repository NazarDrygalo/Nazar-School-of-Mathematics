-- Add an auditable student submission and tutor review workflow without
-- granting students direct UPDATE access to assignment rows.
-- Run after 20260820140000_private_privileged_functions.sql.

alter table public.assignments
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz;

update public.assignments
set submitted_at = coalesce(submitted_at, updated_at)
where status in ('submitted', 'reviewed')
  and submitted_at is null;

update public.assignments
set reviewed_at = coalesce(reviewed_at, updated_at)
where status = 'reviewed'
  and reviewed_at is null;

-- Tutors retain content editing through their existing RLS policy, but all
-- status changes go through the narrow transition function below.
revoke update on public.assignments from authenticated;
grant update (title, instructions, due_at) on public.assignments to authenticated;

create or replace function private.transition_assignment_status(
  target_assignment_id uuid,
  next_status text
)
returns public.assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_assignment public.assignments;
  updated_assignment public.assignments;
  caller_student_id uuid;
  caller_tutor_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if next_status not in ('assigned', 'submitted', 'reviewed') then
    raise exception 'Select a valid assignment status.';
  end if;

  select a.*
  into current_assignment
  from public.assignments a
  where a.id = target_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found.';
  end if;

  select s.id
  into caller_student_id
  from public.students s
  where s.auth_user_id = (select auth.uid())
    and s.active;

  if caller_student_id = current_assignment.student_id then
    if current_assignment.status <> 'assigned' or next_status <> 'submitted' then
      raise exception 'Students may submit only an assigned assignment.';
    end if;

    update public.assignments
    set status = 'submitted',
        submitted_at = now(),
        reviewed_at = null
    where id = target_assignment_id
    returning * into updated_assignment;

    return updated_assignment;
  end if;

  select t.id
  into caller_tutor_id
  from public.tutors t
  join public.student_tutor_assignments sta
    on sta.tutor_id = t.id
   and sta.student_id = current_assignment.student_id
   and sta.active
  where t.id = current_assignment.tutor_id
    and t.auth_user_id = (select auth.uid())
    and t.active;

  if caller_tutor_id is null then
    raise exception 'Only the assigned student or active tutor may change this assignment status.';
  end if;

  if current_assignment.status = 'submitted' and next_status = 'reviewed' then
    update public.assignments
    set status = 'reviewed',
        reviewed_at = now()
    where id = target_assignment_id
    returning * into updated_assignment;
  elsif current_assignment.status in ('submitted', 'reviewed') and next_status = 'assigned' then
    update public.assignments
    set status = 'assigned',
        submitted_at = null,
        reviewed_at = null
    where id = target_assignment_id
    returning * into updated_assignment;
  else
    raise exception 'That assignment status transition is not allowed.';
  end if;

  return updated_assignment;
end;
$$;

revoke all on function private.transition_assignment_status(uuid, text)
  from public, anon;
grant execute on function private.transition_assignment_status(uuid, text)
  to authenticated, service_role;

create or replace function public.transition_assignment_status(
  target_assignment_id uuid,
  next_status text
)
returns public.assignments
language sql
security invoker
set search_path = ''
as $$
  select private.transition_assignment_status($1, $2);
$$;

revoke all on function public.transition_assignment_status(uuid, text)
  from public, anon;
grant execute on function public.transition_assignment_status(uuid, text)
  to authenticated, service_role;

comment on function public.transition_assignment_status(uuid, text) is
  'Invoker-rights entry point for student submission and active-tutor review transitions.';

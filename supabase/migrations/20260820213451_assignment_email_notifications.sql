-- Idempotent assignment workflow notifications and server-only mutations.
-- Run after 20260820203358_assignment_completion_workflow.sql.

alter table public.notification_deliveries
  add column if not exists assignment_id uuid references public.assignments(id) on delete cascade;

create index if not exists notification_deliveries_assignment_id_idx
  on public.notification_deliveries(assignment_id);

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_event_type_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_event_type_check
  check (event_type in (
    'session_created',
    'session_updated',
    'session_reminder',
    'change_requested',
    'change_resolved',
    'assignment_created',
    'assignment_submitted',
    'assignment_reviewed',
    'assignment_revision_requested'
  ));

alter table public.assignments
  add column if not exists status_changed_at timestamptz,
  add column if not exists last_transition_id uuid;

update public.assignments
set status_changed_at = coalesce(reviewed_at, submitted_at, updated_at, created_at)
where status_changed_at is null;

alter table public.assignments
  alter column status_changed_at set default now(),
  alter column status_changed_at set not null;

-- Assignment writes now pass through authenticated server endpoints so the
-- matching delivery record cannot be skipped by direct browser mutations.
revoke insert on public.assignments from authenticated;
revoke execute on function public.transition_assignment_status(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.create_assignment_server(
  p_assignment_id uuid,
  p_student_id uuid,
  p_tutor_id uuid,
  p_title text,
  p_instructions text,
  p_due_at timestamptz,
  p_actor_user_id uuid
)
returns public.assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_assignment public.assignments;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service-role access is required.';
  end if;

  if p_assignment_id is null or p_student_id is null or p_tutor_id is null
     or p_actor_user_id is null or nullif(trim(p_title), '') is null then
    raise exception 'Complete the required assignment fields.';
  end if;

  if length(trim(p_title)) > 200 or length(coalesce(p_instructions, '')) > 5000 then
    raise exception 'The assignment content is too long.';
  end if;

  if not exists (
    select 1
    from public.tutors t
    join public.student_tutor_assignments sta
      on sta.tutor_id = t.id
     and sta.student_id = p_student_id
     and sta.active
    where t.id = p_tutor_id
      and t.auth_user_id = p_actor_user_id
      and t.active
  ) then
    raise exception 'The student is not actively assigned to this tutor.';
  end if;

  insert into public.assignments (
    id, student_id, tutor_id, title, instructions, due_at, status, status_changed_at
  ) values (
    p_assignment_id, p_student_id, p_tutor_id, trim(p_title),
    nullif(trim(coalesce(p_instructions, '')), ''), p_due_at, 'assigned', now()
  )
  on conflict (id) do nothing;

  select a.* into saved_assignment
  from public.assignments a
  where a.id = p_assignment_id
    and a.student_id = p_student_id
    and a.tutor_id = p_tutor_id;

  if saved_assignment.id is null then
    raise exception 'The assignment ID is already in use.';
  end if;

  return saved_assignment;
end;
$$;

revoke all on function private.create_assignment_server(uuid, uuid, uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.create_assignment_server(uuid, uuid, uuid, text, text, timestamptz, uuid)
  to service_role;

create or replace function public.create_assignment_server(
  p_assignment_id uuid,
  p_student_id uuid,
  p_tutor_id uuid,
  p_title text,
  p_instructions text,
  p_due_at timestamptz,
  p_actor_user_id uuid
)
returns public.assignments
language sql
security invoker
set search_path = ''
as $$
  select private.create_assignment_server($1, $2, $3, $4, $5, $6, $7);
$$;

revoke all on function public.create_assignment_server(uuid, uuid, uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.create_assignment_server(uuid, uuid, uuid, text, text, timestamptz, uuid)
  to service_role;

create or replace function private.transition_assignment_status_server(
  p_assignment_id uuid,
  p_next_status text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_transition_id uuid
)
returns public.assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_assignment public.assignments;
  saved_assignment public.assignments;
  actor_student_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service-role access is required.';
  end if;

  if p_actor_role not in ('student', 'tutor') or p_actor_user_id is null
     or p_transition_id is null then
    raise exception 'A valid assignment actor is required.';
  end if;

  select a.* into current_assignment
  from public.assignments a
  where a.id = p_assignment_id
  for update;

  if current_assignment.id is null then
    raise exception 'The assignment was not found.';
  end if;

  if p_actor_role = 'student' then
    select s.id into actor_student_id
    from public.students s
    where s.auth_user_id = p_actor_user_id and s.active;

    if actor_student_id is distinct from current_assignment.student_id then
      raise exception 'This assignment does not belong to the signed-in student.';
    end if;

    if current_assignment.status = 'submitted' and p_next_status = 'submitted'
       and current_assignment.last_transition_id = p_transition_id then
      return current_assignment;
    end if;

    if current_assignment.status <> 'assigned' or p_next_status <> 'submitted' then
      raise exception 'Students may submit only an assigned assignment.';
    end if;

    update public.assignments
    set status = 'submitted', submitted_at = now(), reviewed_at = null,
        status_changed_at = now(), last_transition_id = p_transition_id
    where id = current_assignment.id
    returning * into saved_assignment;
  else
    if not exists (
      select 1
      from public.tutors t
      join public.student_tutor_assignments sta
        on sta.tutor_id = t.id
       and sta.student_id = current_assignment.student_id
       and sta.active
      where t.id = current_assignment.tutor_id
        and t.auth_user_id = p_actor_user_id
        and t.active
    ) then
      raise exception 'Only the active assigned tutor may review this assignment.';
    end if;

    if current_assignment.status = p_next_status
       and current_assignment.last_transition_id = p_transition_id
       and p_next_status in ('assigned', 'reviewed') then
      return current_assignment;
    end if;

    if current_assignment.status = 'submitted' and p_next_status = 'reviewed' then
      update public.assignments
      set status = 'reviewed', reviewed_at = now(), status_changed_at = now(),
          last_transition_id = p_transition_id
      where id = current_assignment.id
      returning * into saved_assignment;
    elsif current_assignment.status in ('submitted', 'reviewed') and p_next_status = 'assigned' then
      update public.assignments
      set status = 'assigned', submitted_at = null, reviewed_at = null,
          status_changed_at = now(), last_transition_id = p_transition_id
      where id = current_assignment.id
      returning * into saved_assignment;
    else
      raise exception 'That assignment status transition is not allowed.';
    end if;
  end if;

  return saved_assignment;
end;
$$;

revoke all on function private.transition_assignment_status_server(uuid, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.transition_assignment_status_server(uuid, text, uuid, text, uuid)
  to service_role;

create or replace function public.transition_assignment_status_server(
  p_assignment_id uuid,
  p_next_status text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_transition_id uuid
)
returns public.assignments
language sql
security invoker
set search_path = ''
as $$
  select private.transition_assignment_status_server($1, $2, $3, $4, $5);
$$;

revoke all on function public.transition_assignment_status_server(uuid, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.transition_assignment_status_server(uuid, text, uuid, text, uuid)
  to service_role;

comment on function public.create_assignment_server(uuid, uuid, uuid, text, text, timestamptz, uuid) is
  'Invoker-rights service-role entry point for idempotent tutor assignment creation.';
comment on function public.transition_assignment_status_server(uuid, text, uuid, text, uuid) is
  'Invoker-rights service-role entry point for authorized assignment workflow transitions.';

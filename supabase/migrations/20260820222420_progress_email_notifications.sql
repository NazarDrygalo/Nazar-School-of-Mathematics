-- Idempotent family email delivery for tutor-recorded progress updates.
-- Run after 20260820213451_assignment_email_notifications.sql.

alter table public.notification_deliveries
  add column if not exists progress_id uuid references public.student_progress(id) on delete cascade;

create index if not exists notification_deliveries_progress_id_idx
  on public.notification_deliveries(progress_id);

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
    'assignment_revision_requested',
    'progress_recorded'
  ));

-- Progress writes pass through the authenticated server workflow so browser
-- clients cannot save a family-visible update without its delivery record.
revoke insert, update, delete on public.student_progress from authenticated;

create or replace function private.create_student_progress_server(
  p_progress_id uuid,
  p_student_id uuid,
  p_tutor_id uuid,
  p_area text,
  p_mastery_level smallint,
  p_notes text,
  p_actor_user_id uuid
)
returns public.student_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_progress public.student_progress;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service-role access is required.';
  end if;

  if p_progress_id is null or p_student_id is null or p_tutor_id is null
     or p_actor_user_id is null or nullif(trim(p_area), '') is null then
    raise exception 'Complete the required progress fields.';
  end if;

  if length(trim(p_area)) > 200 or length(coalesce(p_notes, '')) > 5000 then
    raise exception 'The progress update is too long.';
  end if;

  if p_mastery_level is null or p_mastery_level not between 1 and 5 then
    raise exception 'Mastery must be between one and five.';
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

  insert into public.student_progress (
    id, student_id, tutor_id, area, mastery_level, notes, recorded_at
  ) values (
    p_progress_id, p_student_id, p_tutor_id, trim(p_area), p_mastery_level,
    nullif(trim(coalesce(p_notes, '')), ''), now()
  )
  on conflict (id) do nothing;

  select sp.* into saved_progress
  from public.student_progress sp
  where sp.id = p_progress_id
    and sp.student_id = p_student_id
    and sp.tutor_id = p_tutor_id;

  if saved_progress.id is null then
    raise exception 'The progress update ID is already in use.';
  end if;

  return saved_progress;
end;
$$;

revoke all on function private.create_student_progress_server(uuid, uuid, uuid, text, smallint, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.create_student_progress_server(uuid, uuid, uuid, text, smallint, text, uuid)
  to service_role;

create or replace function public.create_student_progress_server(
  p_progress_id uuid,
  p_student_id uuid,
  p_tutor_id uuid,
  p_area text,
  p_mastery_level smallint,
  p_notes text,
  p_actor_user_id uuid
)
returns public.student_progress
language sql
security invoker
set search_path = ''
as $$
  select private.create_student_progress_server($1, $2, $3, $4, $5, $6, $7);
$$;

revoke all on function public.create_student_progress_server(uuid, uuid, uuid, text, smallint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_student_progress_server(uuid, uuid, uuid, text, smallint, text, uuid)
  to service_role;

comment on function public.create_student_progress_server(uuid, uuid, uuid, text, smallint, text, uuid) is
  'Invoker-rights service-role entry point for idempotent tutor progress updates.';

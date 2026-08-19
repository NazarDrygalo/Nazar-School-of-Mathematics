-- Tutor availability, one-off unavailable blocks, and atomic conflict-aware scheduling.

create table if not exists public.tutor_availability_rules (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (tutor_id, weekday, start_time, end_time)
);

create table if not exists public.tutor_unavailable_blocks (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists tutor_availability_rules_tutor_weekday_idx
  on public.tutor_availability_rules(tutor_id, weekday, start_time);
create index if not exists tutor_unavailable_blocks_tutor_starts_idx
  on public.tutor_unavailable_blocks(tutor_id, starts_at);

create or replace function public.validate_tutor_availability_timezone()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'A valid IANA time zone is required.';
  end if;
  return new;
end;
$$;

drop trigger if exists tutor_availability_rules_validate_timezone on public.tutor_availability_rules;
create trigger tutor_availability_rules_validate_timezone
before insert or update of timezone on public.tutor_availability_rules
for each row execute function public.validate_tutor_availability_timezone();

revoke all on function public.validate_tutor_availability_timezone() from public, anon, authenticated;

alter table public.tutor_availability_rules enable row level security;
alter table public.tutor_unavailable_blocks enable row level security;
revoke all on public.tutor_availability_rules, public.tutor_unavailable_blocks from public, anon;
grant select, insert, update, delete on public.tutor_availability_rules, public.tutor_unavailable_blocks to authenticated;

drop policy if exists "tutors manage their availability rules" on public.tutor_availability_rules;
create policy "tutors manage their availability rules" on public.tutor_availability_rules
  for all to authenticated
  using (exists (
    select 1 from public.tutors t
    where t.id = tutor_availability_rules.tutor_id and t.auth_user_id = auth.uid() and t.active
  ))
  with check (exists (
    select 1 from public.tutors t
    where t.id = tutor_availability_rules.tutor_id and t.auth_user_id = auth.uid() and t.active
  ));

drop policy if exists "tutors manage their unavailable blocks" on public.tutor_unavailable_blocks;
create policy "tutors manage their unavailable blocks" on public.tutor_unavailable_blocks
  for all to authenticated
  using (exists (
    select 1 from public.tutors t
    where t.id = tutor_unavailable_blocks.tutor_id and t.auth_user_id = auth.uid() and t.active
  ))
  with check (exists (
    select 1 from public.tutors t
    where t.id = tutor_unavailable_blocks.tutor_id and t.auth_user_id = auth.uid() and t.active
  ));

drop policy if exists "admins read tutor availability rules" on public.tutor_availability_rules;
create policy "admins read tutor availability rules" on public.tutor_availability_rules
  for select to authenticated using (public.is_admin());
drop policy if exists "admins read tutor unavailable blocks" on public.tutor_unavailable_blocks;
create policy "admins read tutor unavailable blocks" on public.tutor_unavailable_blocks
  for select to authenticated using (public.is_admin());

create or replace function public.assert_tutor_session_available(
  checked_session_id uuid,
  checked_tutor_id uuid,
  checked_starts_at timestamptz,
  checked_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access is required.'; end if;
  if checked_ends_at <= checked_starts_at then
    raise exception 'The session end time must be after its start time.';
  end if;

  -- Serializes scheduling decisions for one tutor to prevent concurrent double-booking.
  perform pg_advisory_xact_lock(hashtextextended(checked_tutor_id::text, 0));

  if exists (
    select 1 from public.tutoring_sessions ts
    where ts.tutor_id = checked_tutor_id
      and ts.status = 'scheduled'
      and ts.id <> coalesce(checked_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(ts.starts_at, ts.ends_at, '[)') && tstzrange(checked_starts_at, checked_ends_at, '[)')
  ) then
    raise exception 'This time overlaps another scheduled session.';
  end if;

  if exists (select 1 from public.tutor_availability_rules where tutor_id = checked_tutor_id)
    and not exists (
      select 1 from public.tutor_availability_rules availability
      where availability.tutor_id = checked_tutor_id
        and extract(dow from checked_starts_at at time zone availability.timezone)::smallint = availability.weekday
        and (checked_starts_at at time zone availability.timezone)::date = (checked_ends_at at time zone availability.timezone)::date
        and (checked_starts_at at time zone availability.timezone)::time >= availability.start_time
        and (checked_ends_at at time zone availability.timezone)::time <= availability.end_time
    ) then
    raise exception 'This session is outside the tutor''s recurring availability.';
  end if;

  if exists (
    select 1 from public.tutor_unavailable_blocks block
    where block.tutor_id = checked_tutor_id
      and tstzrange(block.starts_at, block.ends_at, '[)') && tstzrange(checked_starts_at, checked_ends_at, '[)')
  ) then
    raise exception 'This time is blocked as unavailable.';
  end if;
end;
$$;

revoke all on function public.assert_tutor_session_available(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.assert_tutor_session_available(uuid, uuid, timestamptz, timestamptz) to service_role;

create or replace function public.save_tutoring_session_server(
  p_session_id uuid,
  p_student_id uuid,
  p_tutor_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_status text,
  p_meeting_url text
)
returns public.tutoring_sessions
language plpgsql
security definer
set search_path = public
as $$
declare saved public.tutoring_sessions;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access is required.'; end if;
  if p_status not in ('scheduled', 'completed', 'cancelled', 'no_show') then
    raise exception 'A valid session status is required.';
  end if;
  if not exists (
    select 1 from public.student_tutor_assignments sta
    join public.tutors t on t.id = sta.tutor_id and t.active
    join public.students s on s.id = sta.student_id and s.active
    where sta.student_id = p_student_id and sta.tutor_id = p_tutor_id and sta.active
  ) then
    raise exception 'The student is not actively assigned to this tutor.';
  end if;
  if p_status = 'scheduled' then
    perform public.assert_tutor_session_available(p_session_id, p_tutor_id, p_starts_at, p_ends_at);
  end if;

  insert into public.tutoring_sessions (id, student_id, tutor_id, starts_at, ends_at, status, meeting_url)
  values (p_session_id, p_student_id, p_tutor_id, p_starts_at, p_ends_at, p_status, nullif(trim(p_meeting_url), ''))
  on conflict (id) do update set
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    status = excluded.status,
    meeting_url = excluded.meeting_url
  where tutoring_sessions.tutor_id = excluded.tutor_id
    and tutoring_sessions.student_id = excluded.student_id
  returning * into saved;

  if saved.id is null then raise exception 'The session could not be saved for this tutor and student.'; end if;
  return saved;
end;
$$;

revoke all on function public.save_tutoring_session_server(uuid, uuid, uuid, timestamptz, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.save_tutoring_session_server(uuid, uuid, uuid, timestamptz, timestamptz, text, text) to service_role;

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
  current_session public.tutoring_sessions%rowtype;
  session_duration interval;
  requested_end timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access is required.'; end if;
  if resolution not in ('approved', 'declined') then raise exception 'Resolution must be approved or declined.'; end if;
  select * into change_request from public.session_change_requests scr where scr.id = $1 and scr.status = 'pending' for update;
  if change_request.id is null then raise exception 'A pending session change request was not found.'; end if;

  if resolution = 'approved' then
    select * into current_session from public.tutoring_sessions where id = change_request.session_id for update;
    if change_request.request_type = 'cancel' then
      update public.tutoring_sessions set status = 'cancelled' where id = change_request.session_id;
    else
      session_duration := current_session.ends_at - current_session.starts_at;
      requested_end := change_request.requested_starts_at + session_duration;
      perform public.assert_tutor_session_available(current_session.id, current_session.tutor_id, change_request.requested_starts_at, requested_end);
      update public.tutoring_sessions
      set starts_at = change_request.requested_starts_at, ends_at = requested_end, status = 'scheduled'
      where id = change_request.session_id;
    end if;
  end if;

  update public.session_change_requests
  set status = resolution, reviewed_by = reviewer_id, reviewed_at = now(), updated_at = now()
  where id = change_request_id;
end;
$$;

revoke all on function public.resolve_session_change_request_server(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_session_change_request_server(uuid, text, uuid) to service_role;

comment on table public.tutor_availability_rules is 'Recurring weekly windows in which a tutor accepts sessions.';
comment on table public.tutor_unavailable_blocks is 'One-off time ranges that override recurring tutor availability.';

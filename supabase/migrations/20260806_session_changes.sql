-- Parent cancellation/rescheduling requests and administrator resolution.
-- Run after 20260805_secure_scheduling.sql and before the retention migration.

create table if not exists public.session_change_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (request_type in ('cancel', 'reschedule')),
  requested_starts_at timestamptz,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (request_type = 'cancel' and requested_starts_at is null)
    or (request_type = 'reschedule' and requested_starts_at is not null)
  )
);

create index if not exists session_change_requests_session_idx
  on public.session_change_requests(session_id, created_at desc);
create unique index if not exists session_change_requests_one_pending_idx
  on public.session_change_requests(session_id) where status = 'pending';

drop trigger if exists session_change_requests_set_updated_at on public.session_change_requests;
create trigger session_change_requests_set_updated_at
before update on public.session_change_requests
for each row execute function public.set_updated_at();

alter table public.session_change_requests enable row level security;
revoke all on public.session_change_requests from anon;
grant select, insert, update on public.session_change_requests to authenticated;

drop policy if exists "parents read their session requests" on public.session_change_requests;
create policy "parents read their session requests" on public.session_change_requests
for select to authenticated using (
  requested_by = auth.uid()
  and exists (
    select 1
    from public.tutoring_sessions ts
    join public.students s on s.id = ts.student_id
    join public.parents p on p.id = s.parent_id
    where ts.id = session_change_requests.session_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "parents request eligible session changes" on public.session_change_requests;
create policy "parents request eligible session changes" on public.session_change_requests
for insert to authenticated with check (
  requested_by = auth.uid()
  and status = 'pending'
  and exists (
    select 1
    from public.tutoring_sessions ts
    join public.students s on s.id = ts.student_id
    join public.parents p on p.id = s.parent_id
    where ts.id = session_change_requests.session_id
      and p.auth_user_id = auth.uid()
      and ts.status = 'scheduled'
      and ts.starts_at >= now() + interval '3 days'
  )
  and (
    request_type = 'cancel'
    or requested_starts_at >= now() + interval '3 days'
  )
);

drop policy if exists "admins manage session requests" on public.session_change_requests;
create policy "admins manage session requests" on public.session_change_requests
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.resolve_session_change_request(change_request_id uuid, resolution text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  change_request public.session_change_requests%rowtype;
  session_duration interval;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.';
  end if;
  if resolution not in ('approved', 'declined') then
    raise exception 'Resolution must be approved or declined.';
  end if;

  select * into change_request
  from public.session_change_requests
  where id = change_request_id and status = 'pending'
  for update;

  if change_request.id is null then
    raise exception 'A pending session change request was not found.';
  end if;

  if resolution = 'approved' then
    if change_request.request_type = 'cancel' then
      update public.tutoring_sessions
      set status = 'cancelled'
      where id = change_request.session_id;
    else
      select ends_at - starts_at into session_duration
      from public.tutoring_sessions
      where id = change_request.session_id
      for update;

      update public.tutoring_sessions
      set starts_at = change_request.requested_starts_at,
          ends_at = change_request.requested_starts_at + session_duration,
          status = 'scheduled'
      where id = change_request.session_id;
    end if;
  end if;

  update public.session_change_requests
  set status = resolution,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = change_request.id;
end;
$$;

revoke all on function public.resolve_session_change_request(uuid, text) from public, anon;
grant execute on function public.resolve_session_change_request(uuid, text) to authenticated;

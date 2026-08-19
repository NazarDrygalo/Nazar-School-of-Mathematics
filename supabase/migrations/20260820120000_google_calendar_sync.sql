-- Per-tutor Google Calendar connections and auditable session synchronization.
-- OAuth refresh tokens remain server-only and are encrypted before storage.

create table if not exists public.google_calendar_connections (
  tutor_id uuid primary key references public.tutors(id) on delete cascade,
  encrypted_refresh_token text not null,
  calendar_id text not null default 'primary',
  scope text not null,
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);

create table if not exists public.google_calendar_events (
  session_id uuid primary key references public.tutoring_sessions(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id) on delete cascade,
  google_event_id text not null,
  status text not null default 'pending' check (status in ('pending', 'synced', 'deleted', 'failed')),
  last_attempted_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tutor_id, google_event_id)
);

create index if not exists google_calendar_oauth_states_expiry_idx on public.google_calendar_oauth_states(expires_at);
create index if not exists google_calendar_events_tutor_status_idx on public.google_calendar_events(tutor_id, status, last_attempted_at desc);

drop trigger if exists google_calendar_connections_set_updated_at on public.google_calendar_connections;
create trigger google_calendar_connections_set_updated_at before update on public.google_calendar_connections for each row execute function public.set_updated_at();
drop trigger if exists google_calendar_events_set_updated_at on public.google_calendar_events;
create trigger google_calendar_events_set_updated_at before update on public.google_calendar_events for each row execute function public.set_updated_at();

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_events enable row level security;

revoke all on public.google_calendar_connections, public.google_calendar_oauth_states, public.google_calendar_events from public, anon, authenticated;
grant select on public.google_calendar_events to authenticated;

drop policy if exists "tutors read their calendar sync status" on public.google_calendar_events;
create policy "tutors read their calendar sync status" on public.google_calendar_events
  for select to authenticated using (exists (
    select 1 from public.tutors t where t.id = google_calendar_events.tutor_id and t.auth_user_id = auth.uid()
  ));

drop policy if exists "admins read calendar sync status" on public.google_calendar_events;
create policy "admins read calendar sync status" on public.google_calendar_events
  for select to authenticated using (public.is_admin());

create or replace function public.claim_google_calendar_oauth_state(p_state_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare claimed_tutor_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access is required.'; end if;
  update public.google_calendar_oauth_states
  set used_at = now()
  where state_hash = p_state_hash and used_at is null and expires_at > now()
  returning tutor_id into claimed_tutor_id;
  if claimed_tutor_id is null then raise exception 'The calendar authorization request is invalid or expired.'; end if;
  return claimed_tutor_id;
end;
$$;

revoke all on function public.claim_google_calendar_oauth_state(text) from public, anon, authenticated;
grant execute on function public.claim_google_calendar_oauth_state(text) to service_role;

-- Extend the existing cleanup without changing the Cron function signature.
create or replace function public.purge_expired_google_calendar_oauth_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service-role access is required.'; end if;
  delete from public.google_calendar_oauth_states where expires_at < now() or used_at is not null;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_google_calendar_oauth_states() from public, anon, authenticated;
grant execute on function public.purge_expired_google_calendar_oauth_states() to service_role;

comment on table public.google_calendar_connections is 'Server-only encrypted Google OAuth refresh tokens for tutor calendar synchronization.';
comment on table public.google_calendar_events is 'Non-sensitive audit state for tutoring-session to Google Calendar synchronization.';

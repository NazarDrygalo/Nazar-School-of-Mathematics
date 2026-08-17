-- Security hardening: keep private tutoring notes private, enforce audited
-- workflow mutations, and rate-limit the public application endpoint.

create table if not exists public.session_parent_summaries (
  session_id uuid primary key references public.tutoring_sessions(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  summary text not null check (char_length(summary) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.session_parent_summaries (session_id, tutor_id, summary, created_at, updated_at)
select session_id, tutor_id, parent_summary, created_at, updated_at
from public.session_notes
where nullif(trim(parent_summary), '') is not null
on conflict (session_id) do update
set tutor_id = excluded.tutor_id,
    summary = excluded.summary,
    updated_at = excluded.updated_at;

update public.session_notes set parent_summary = null where parent_summary is not null;

drop trigger if exists session_parent_summaries_set_updated_at on public.session_parent_summaries;
create trigger session_parent_summaries_set_updated_at
before update on public.session_parent_summaries
for each row execute function public.set_updated_at();

alter table public.session_parent_summaries enable row level security;
revoke all on public.session_parent_summaries from public, anon;
grant select on public.session_parent_summaries to authenticated;

drop policy if exists "session participants read notes" on public.session_notes;

drop policy if exists "admins read parent summaries" on public.session_parent_summaries;
create policy "admins read parent summaries" on public.session_parent_summaries
for select to authenticated using (public.is_admin());

drop policy if exists "tutors read their parent summaries" on public.session_parent_summaries;
create policy "tutors read their parent summaries" on public.session_parent_summaries
for select to authenticated using (
  exists (
    select 1 from public.tutors t
    where t.id = session_parent_summaries.tutor_id
      and t.auth_user_id = auth.uid()
  )
);

drop policy if exists "parents read their session summaries" on public.session_parent_summaries;
create policy "parents read their session summaries" on public.session_parent_summaries
for select to authenticated using (
  exists (
    select 1
    from public.tutoring_sessions ts
    join public.students s on s.id = ts.student_id
    join public.parents p on p.id = s.parent_id
    where ts.id = session_parent_summaries.session_id
      and p.auth_user_id = auth.uid()
  )
);

create or replace function public.save_tutoring_session_note(
  note_session_id uuid,
  private_content text,
  family_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_tutor_id uuid;
  note_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if nullif(trim(private_content), '') is null then raise exception 'A private note is required.'; end if;
  if char_length(private_content) > 10000 then raise exception 'The private note is too long.'; end if;
  if char_length(coalesce(family_summary, '')) > 4000 then raise exception 'The family summary is too long.'; end if;

  select ts.tutor_id into current_tutor_id
  from public.tutoring_sessions ts
  join public.tutors t on t.id = ts.tutor_id
  join public.student_tutor_assignments sta
    on sta.tutor_id = ts.tutor_id and sta.student_id = ts.student_id and sta.active
  where ts.id = note_session_id
    and t.auth_user_id = auth.uid()
    and t.active;

  if current_tutor_id is null then raise exception 'This session is not assigned to the signed-in tutor.'; end if;

  insert into public.session_notes (session_id, tutor_id, content)
  values (note_session_id, current_tutor_id, private_content)
  on conflict (session_id) do update
  set tutor_id = excluded.tutor_id,
      content = excluded.content,
      updated_at = now()
  returning id into note_id;

  if nullif(trim(family_summary), '') is null then
    delete from public.session_parent_summaries where session_id = note_session_id;
  else
    insert into public.session_parent_summaries (session_id, tutor_id, summary)
    values (note_session_id, current_tutor_id, trim(family_summary))
    on conflict (session_id) do update
    set tutor_id = excluded.tutor_id,
        summary = excluded.summary,
        updated_at = now();
  end if;

  return note_id;
end;
$$;

revoke all on function public.save_tutoring_session_note(uuid, text, text) from public, anon;
grant execute on function public.save_tutoring_session_note(uuid, text, text) to authenticated;

-- These changes must go through the server endpoints or the note RPC so that
-- role validation, idempotency, audit records, and notification delivery run.
revoke insert, update on public.tutoring_sessions from authenticated;
revoke insert, update on public.session_change_requests from authenticated;
revoke update on public.applications from authenticated;
revoke insert, update on public.session_notes from authenticated;
revoke execute on function public.resolve_session_change_request(uuid, text) from authenticated;

create table if not exists public.application_submission_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists application_submission_rate_limits_updated_idx
  on public.application_submission_rate_limits(updated_at);

alter table public.application_submission_rate_limits enable row level security;
revoke all on public.application_submission_rate_limits from public, anon, authenticated;

create or replace function public.claim_application_submission_rate_limit(
  rate_key text,
  max_requests integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.application_submission_rate_limits%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service-role access is required.'; end if;
  if rate_key is null or char_length(rate_key) <> 64 then raise exception 'Invalid rate-limit key.'; end if;
  if max_requests < 1 or max_requests > 100 or window_seconds < 60 or window_seconds > 604800 then
    raise exception 'Invalid rate-limit configuration.';
  end if;

  delete from public.application_submission_rate_limits
  where updated_at < now() - interval '7 days';

  insert into public.application_submission_rate_limits (rate_key, request_count)
  values (rate_key, 0)
  on conflict (rate_key) do nothing;

  select * into current_row
  from public.application_submission_rate_limits
  where application_submission_rate_limits.rate_key = claim_application_submission_rate_limit.rate_key
  for update;

  if current_row.window_started_at <= now() - make_interval(secs => window_seconds) then
    update public.application_submission_rate_limits
    set window_started_at = now(), request_count = 1, updated_at = now()
    where application_submission_rate_limits.rate_key = claim_application_submission_rate_limit.rate_key;
    return true;
  end if;

  if current_row.request_count >= max_requests then return false; end if;

  update public.application_submission_rate_limits
  set request_count = request_count + 1, updated_at = now()
  where application_submission_rate_limits.rate_key = claim_application_submission_rate_limit.rate_key;
  return true;
end;
$$;

revoke all on function public.claim_application_submission_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_application_submission_rate_limit(text, integer, integer) to service_role;

comment on table public.session_parent_summaries is
  'Family-visible session summaries, deliberately separated from private tutor notes.';
comment on table public.application_submission_rate_limits is
  'Short-lived HMAC hashes used to limit public application abuse without retaining raw IP or email values.';

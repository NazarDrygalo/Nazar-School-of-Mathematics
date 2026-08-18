# Supabase RLS verification

Run these checks in a non-production Supabase project after applying every migration. Replace all placeholder UUIDs with records created specifically for testing. Keep each block inside its transaction so writes are rolled back.

## Tutor isolation

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'TUTOR_AUTH_UUID', true);

-- Must return only the signed-in tutor's active assignments.
select * from public.student_tutor_assignments;

-- Must fail: session changes must use the authenticated server endpoint so
-- notification and idempotency records cannot be bypassed.
insert into public.tutoring_sessions (student_id, tutor_id, starts_at, ends_at, meeting_url)
values ('ASSIGNED_STUDENT_UUID', 'TUTOR_RECORD_UUID', now() + interval '5 days', now() + interval '5 days 1 hour', 'https://example.com/test');

-- Must succeed for a session owned by this active tutor. The private note is
-- stored separately from the family-visible summary.
select public.save_tutoring_session_note('OWN_SESSION_UUID', 'Private test note', 'Family-visible test summary');

-- Must return the tutor's private note and family summary.
select * from public.session_notes;
select * from public.session_parent_summaries;
rollback;
```

## Parent isolation and request window

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'PARENT_AUTH_UUID', true);

-- Must return only this parent's family sessions.
select * from public.tutoring_sessions;

-- Must fail: requests must use the authenticated server endpoint.
insert into public.session_change_requests (session_id, requested_by, request_type, reason)
values ('OWN_SESSION_UUID', 'PARENT_AUTH_UUID', 'cancel', 'RLS verification');

-- Must return summaries for this family only.
select * from public.session_parent_summaries;

-- Must return no rows: private tutor notes are never parent-readable.
select * from public.session_notes;
rollback;
```

## Administrator functions

```sql
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'ADMIN_AUTH_UUID', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select public.is_admin(); -- Must return true.
select * from public.session_change_requests; -- Must return all test requests.

-- Must fail: resolution is service-role-only and must use the administrator
-- server endpoint so notification records cannot be bypassed.
select public.resolve_session_change_request('PENDING_REQUEST_UUID', 'approved');
rollback;
```

Repeat the administrator function call as a parent or tutor and confirm it fails with `Administrator access is required.` Never use production family records for RLS tests.

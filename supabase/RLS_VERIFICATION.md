# Supabase RLS verification

Run these checks in a non-production Supabase project after applying every migration. Replace all placeholder UUIDs with records created specifically for testing. Keep each block inside its transaction so writes are rolled back.

## Tutor isolation

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'TUTOR_AUTH_UUID', true);

-- Must return only the signed-in tutor's active assignments.
select * from public.student_tutor_assignments;

-- Must succeed for ASSIGNED_STUDENT_UUID.
insert into public.tutoring_sessions (student_id, tutor_id, starts_at, ends_at, meeting_url)
values ('ASSIGNED_STUDENT_UUID', 'TUTOR_RECORD_UUID', now() + interval '5 days', now() + interval '5 days 1 hour', 'https://example.com/test');

-- Must fail with an RLS violation for UNASSIGNED_STUDENT_UUID.
insert into public.tutoring_sessions (student_id, tutor_id, starts_at, ends_at)
values ('UNASSIGNED_STUDENT_UUID', 'TUTOR_RECORD_UUID', now() + interval '6 days', now() + interval '6 days 1 hour');
rollback;
```

## Parent isolation and request window

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'PARENT_AUTH_UUID', true);

-- Must return only this parent's family sessions.
select * from public.tutoring_sessions;

-- Must succeed when OWN_SESSION_UUID starts at least three days from now.
insert into public.session_change_requests (session_id, requested_by, request_type, reason)
values ('OWN_SESSION_UUID', 'PARENT_AUTH_UUID', 'cancel', 'RLS verification');

-- Must fail for ANOTHER_FAMILY_SESSION_UUID.
insert into public.session_change_requests (session_id, requested_by, request_type)
values ('ANOTHER_FAMILY_SESSION_UUID', 'PARENT_AUTH_UUID', 'cancel');
rollback;
```

## Administrator functions

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_AUTH_UUID', true);

select public.is_admin(); -- Must return true.
select * from public.session_change_requests; -- Must return all test requests.

-- Use a pending test request. The transaction rollback restores it.
select public.resolve_session_change_request('PENDING_REQUEST_UUID', 'approved');
rollback;
```

Repeat the administrator function call as a parent or tutor and confirm it fails with `Administrator access is required.` Never use production family records for RLS tests.


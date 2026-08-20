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

## Tutor availability isolation

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'TUTOR_AUTH_UUID', true);

-- Must succeed only when TUTOR_RECORD_UUID belongs to this active tutor.
insert into public.tutor_availability_rules (tutor_id, weekday, start_time, end_time, timezone)
values ('TUTOR_RECORD_UUID', 1, '15:00', '19:00', 'America/New_York');

insert into public.tutor_unavailable_blocks (tutor_id, starts_at, ends_at, reason)
values ('TUTOR_RECORD_UUID', now() + interval '10 days', now() + interval '10 days 1 hour', 'RLS test');

-- Must return only this tutor's availability records.
select * from public.tutor_availability_rules;
select * from public.tutor_unavailable_blocks;

-- Must fail because the atomic scheduling function is server-only.
select public.save_tutoring_session_server(gen_random_uuid(), 'ASSIGNED_STUDENT_UUID', 'TUTOR_RECORD_UUID', now() + interval '8 days', now() + interval '8 days 1 hour', 'scheduled', null);
rollback;
```

Repeat the availability reads and writes with a different tutor JWT and confirm no other tutor's rows are visible or mutable. Use the tutor portal smoke test to confirm scheduled overlaps, unavailable blocks, and times outside configured weekly hours are rejected.

## Google Calendar credential isolation

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'TUTOR_AUTH_UUID', true);

-- All must fail: OAuth state and encrypted refresh tokens are server-only.
select * from public.google_calendar_connections;
select * from public.google_calendar_oauth_states;
insert into public.google_calendar_connections (tutor_id, encrypted_refresh_token, scope)
values ('TUTOR_RECORD_UUID', 'not-a-real-token', 'calendar');
select public.claim_google_calendar_oauth_state('not-a-real-state');

-- Must show only this tutor's non-sensitive event synchronization records.
select * from public.google_calendar_events;
rollback;
```

Repeat the event-status query with another tutor JWT and confirm it cannot see the first tutor's rows. An MFA-authenticated administrator may read synchronization status but must not be able to select from either credential table.

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

## Session reminder delivery isolation

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'PARENT_AUTH_UUID', true);

-- Must return no rows: delivery history is administrator-only.
select * from public.notification_deliveries;

-- Must fail: only the server role may create reminder delivery claims.
insert into public.notification_deliveries (
  event_key, event_type, session_id, recipient_role, recipient_email
) values (
  'rls-test-reminder', 'session_reminder', 'OWN_SESSION_UUID', 'parent', 'parent@example.com'
);
rollback;
```

Repeat the read and insert as a student and tutor. Neither role may read or write delivery history. An MFA-authenticated administrator may read failures but must still be unable to insert or update them directly.

## Internal function execution grants

Run after `20260820130000_database_security_cleanup.sql`:

```sql
select
  has_function_privilege('anon', 'public.is_student()', 'execute') as anon_is_student,
  has_function_privilege('anon', 'public.is_tutor()', 'execute') as anon_is_tutor,
  has_function_privilege('anon', 'public.session_note_tutor_matches_session(uuid,uuid)', 'execute') as anon_note_helper,
  has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') as authenticated_event_trigger,
  has_function_privilege('authenticated', 'public.set_updated_at()', 'execute') as authenticated_trigger_helper,
  has_function_privilege('authenticated', 'public.onboard_accepted_application(uuid,uuid)', 'execute') as authenticated_onboarding,
  has_function_privilege('authenticated', 'public.save_tutoring_session_note(uuid,text,text)', 'execute') as authenticated_note_save;
```

The first five values must be `false`. The final two must remain `true`: those are intentional signed-in RPCs that validate administrator MFA or the tutor/session assignment inside the function.

After `20260820140000_private_privileged_functions.sql`, verify that no exposed wrapper retains definer rights:

```sql
select
  n.nspname as schema_name,
  p.proname,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in (
  'is_admin',
  'is_student',
  'is_tutor',
  'onboard_accepted_application',
  'save_tutoring_session_note',
  'session_note_tutor_matches_session'
)
order by n.nspname, p.proname;
```

Every `public` row must show `security_definer = false`. The privileged implementations belong in `private`, which is not exposed through the Data API, and remain responsible for the existing identity, MFA, and assignment checks.

## Portal invitation isolation

```sql
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'ADMIN_AUTH_UUID', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select * from public.portal_invitations; -- Must be readable by the MFA-authenticated administrator.

-- Both must fail: invitation claims and Auth linking are server-only actions.
select public.claim_portal_invitation('parent', 'PARENT_RECORD_UUID', 'parent@example.com', gen_random_uuid(), 'ADMIN_AUTH_UUID');
select public.link_portal_auth_user('parent', 'PARENT_RECORD_UUID', 'PARENT_AUTH_UUID', null);
rollback;
```

Repeat the `portal_invitations` query with an `aal1` administrator JWT and with parent, student, and tutor JWTs. Each query must return no rows or fail, and direct inserts or updates must be denied.

## Assignment submission and review isolation

Run after `20260820203358_assignment_completion_workflow.sql` with a disposable assignment:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ASSIGNED_STUDENT_AUTH_UUID', true);

-- Must succeed only while this student's assignment status is assigned.
select (public.transition_assignment_status('OWN_ASSIGNMENT_UUID', 'submitted')).status;

-- Must fail: a student cannot review an assignment.
select public.transition_assignment_status('OWN_ASSIGNMENT_UUID', 'reviewed');
rollback;
```

Repeat with the active assigned tutor. The tutor may change `submitted` to `reviewed` and may return `submitted` or `reviewed` to `assigned`. A different student, an inactive tutor, and an unassigned tutor must all fail. Confirm that a failed call leaves the assignment row and timestamps unchanged.

After `20260820213451_assignment_email_notifications.sql`, direct browser assignment creation and calls to `public.transition_assignment_status` must fail for `authenticated`. Repeat assignment creation, submission, review, and revision through the matching `/api/tutor/assignments` and `/api/{student|tutor}/assignments/:id/status` endpoints. Confirm each operation creates only the expected `notification_deliveries` rows, while parent, student, and tutor roles still cannot read or write delivery history.

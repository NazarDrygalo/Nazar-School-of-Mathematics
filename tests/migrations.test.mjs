import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')

test('secure scheduling scopes tutor writes to active assignments', async () => {
  const sql = await migration('20260805_secure_scheduling.sql')
  assert.match(sql, /student_tutor_assignments_one_active_tutor_idx/)
  assert.match(sql, /tutors create sessions for assigned students/)
  assert.match(sql, /sta\.student_id = tutoring_sessions\.student_id[\s\S]*sta\.active/)
})

test('session requests enforce parent ownership and the three-day policy', async () => {
  const sql = await migration('20260806_session_changes.sql')
  assert.match(sql, /p\.auth_user_id = auth\.uid\(\)/)
  assert.match(sql, /ts\.starts_at >= now\(\) \+ interval '3 days'/)
  assert.match(sql, /public\.is_admin\(\)/)
})

test('retention cleanup is not callable by browser roles', async () => {
  const sql = await migration('20260806_data_retention.sql')
  assert.match(sql, /default interval '7 days'/)
  assert.match(sql, /revoke all on function public\.purge_expired_tutoring_data\(interval\) from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.purge_expired_tutoring_data\(interval\) to service_role/)
})

test('workflow notifications are tracked, admin-readable, and idempotent', async () => {
  const sql = await migration('20260813_workflow_notifications.sql')
  assert.match(sql, /create table if not exists public\.notification_deliveries/)
  assert.match(sql, /event_key text not null unique/)
  assert.match(sql, /admins read notification deliveries/)
  assert.match(sql, /resolve_session_change_request_server/)
  assert.match(sql, /grant execute on function public\.resolve_session_change_request_server\(uuid, text, uuid\) to service_role/)
  assert.match(sql, /'notification_deliveries', deleted_notifications/)
})

test('security hardening separates family summaries from private tutor notes', async () => {
  const sql = await migration('20260817_security_hardening.sql')
  assert.match(sql, /create table if not exists public\.session_parent_summaries/)
  assert.match(sql, /drop policy if exists "session participants read notes"/)
  assert.match(sql, /parents read their session summaries/)
  assert.match(sql, /save_tutoring_session_note/)
  assert.match(sql, /revoke insert, update on public\.session_notes from authenticated/)
})

test('security hardening rate-limits applications and blocks direct workflow bypasses', async () => {
  const sql = await migration('20260817_security_hardening.sql')
  assert.match(sql, /application_submission_rate_limits/)
  assert.match(sql, /claim_application_submission_rate_limit/)
  assert.match(sql, /grant execute on function public\.claim_application_submission_rate_limit\(text, integer, integer\) to service_role/)
  assert.match(sql, /revoke insert, update on public\.tutoring_sessions from authenticated/)
  assert.match(sql, /revoke insert, update on public\.session_change_requests from authenticated/)
  assert.match(sql, /revoke update on public\.applications from authenticated/)
})

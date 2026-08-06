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


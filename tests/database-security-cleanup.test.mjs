import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationPath = new URL('../supabase/migrations/20260820130000_database_security_cleanup.sql', import.meta.url)

test('database security cleanup closes public function execution', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /set_updated_at\(\) set search_path = pg_catalog/i)
  assert.match(sql, /set_user_role_updated_at\(\) set search_path = pg_catalog/i)
  assert.match(sql, /set_portal_invitation_updated_at\(\) set search_path = pg_catalog/i)
  assert.match(sql, /rls_auto_enable\(\) from public, anon, authenticated/i)
  assert.match(sql, /is_student\(\) from public, anon/i)
  assert.match(sql, /is_tutor\(\) from public, anon/i)
  assert.match(sql, /alter default privileges for role postgres in schema public/i)
  assert.doesNotMatch(sql, /drop extension/i)
})

test('database security cleanup covers every advisor-reported foreign key', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  const expectedIndexes = [
    'assignments_tutor_id_idx',
    'google_calendar_oauth_states_tutor_id_idx',
    'notification_deliveries_change_request_id_idx',
    'portal_invitations_auth_user_id_idx',
    'portal_invitations_invited_by_idx',
    'session_change_requests_requested_by_idx',
    'session_change_requests_reviewed_by_idx',
    'session_notes_tutor_id_idx',
    'session_parent_summaries_tutor_id_idx',
    'student_progress_tutor_id_idx',
    'student_tutor_assignments_assigned_by_idx'
  ]
  for (const index of expectedIndexes) assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'))
})

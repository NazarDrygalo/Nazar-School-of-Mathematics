import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('assignment notification migration makes writes server-only and tracks deliveries', async () => {
  const sql = await read('supabase/migrations/20260820213451_assignment_email_notifications.sql')
  assert.match(sql, /add column if not exists assignment_id uuid references public\.assignments/i)
  assert.match(sql, /'assignment_created'/)
  assert.match(sql, /'assignment_submitted'/)
  assert.match(sql, /'assignment_reviewed'/)
  assert.match(sql, /'assignment_revision_requested'/)
  assert.match(sql, /revoke insert on public\.assignments from authenticated/i)
  assert.match(sql, /add column if not exists last_transition_id uuid/i)
  assert.match(sql, /revoke execute on function public\.transition_assignment_status\(uuid, text\)/i)
  assert.match(sql, /create or replace function private\.create_assignment_server/i)
  assert.match(sql, /create or replace function private\.transition_assignment_status_server/i)
  assert.match(sql, /coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/i)
  assert.match(sql, /security invoker/i)
  assert.match(sql, /grant execute on function public\.transition_assignment_status_server\(uuid, text, uuid, text, uuid\)\s+to service_role/i)
  assert.match(sql, /current_assignment\.last_transition_id = p_transition_id/i)
})

test('assignment emails reuse delivery claims and stable workflow event keys', async () => {
  const workflow = await read('server/workflow-notifications.mjs')
  assert.match(workflow, /assignment_id: message\.assignmentId \|\| null/)
  assert.match(workflow, /export async function createTutorAssignment/)
  assert.match(workflow, /export async function changeAssignmentStatus/)
  assert.match(workflow, /assignment:\$\{assignment\.id\}:\$\{eventType\}:\$\{version\}:\$\{target\.role\}/)
  assert.match(workflow, /assignment_submitted:\$\{assignment\.last_transition_id\}:tutor/)
  assert.match(workflow, /sendTrackedEmail/)
})

test('assignment browser actions use authenticated server endpoints', async () => {
  const [server, dashboard] = await Promise.all([read('server.mjs'), read('src/Dashboards.tsx')])
  assert.match(server, /\/api\/tutor\/assignments/)
  assert.match(server, /const assignmentStatusMatch = requestPath\?\.match/)
  assert.match(server, /student\|tutor/)
  assert.match(dashboard, /portalRequest\(`\/api\/student\/assignments\/\$\{id\}\/status`/)
  assert.match(dashboard, /portalRequest\('\/api\/tutor\/assignments', 'POST'/)
  assert.match(dashboard, /portalRequest\(`\/api\/tutor\/assignments\/\$\{id\}\/status`/)
  assert.doesNotMatch(dashboard, /rpc\('transition_assignment_status'/)
})

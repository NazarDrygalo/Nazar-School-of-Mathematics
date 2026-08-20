import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('progress notification migration makes writes server-only and indexed', async () => {
  const sql = await read('supabase/migrations/20260820222420_progress_email_notifications.sql')
  assert.match(sql, /add column if not exists progress_id uuid references public\.student_progress/i)
  assert.match(sql, /create index if not exists notification_deliveries_progress_id_idx/i)
  assert.match(sql, /'progress_recorded'/)
  assert.match(sql, /revoke insert, update, delete on public\.student_progress from authenticated/i)
  assert.match(sql, /create or replace function private\.create_student_progress_server/i)
  assert.match(sql, /coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/i)
  assert.match(sql, /join public\.student_tutor_assignments sta[\s\S]*sta\.active/i)
  assert.match(sql, /security invoker/i)
  assert.match(sql, /grant execute on function public\.create_student_progress_server\(uuid, uuid, uuid, text, smallint, text, uuid\)\s+to service_role/i)
})

test('progress creation uses the tracked server email workflow', async () => {
  const [workflow, server, dashboard] = await Promise.all([
    read('server/workflow-notifications.mjs'),
    read('server.mjs'),
    read('src/Dashboards.tsx')
  ])
  assert.match(workflow, /progress_id: message\.progressId \|\| null/)
  assert.match(workflow, /export async function createTutorProgress/)
  assert.match(workflow, /progress:\$\{progress\.id\}:recorded:\$\{target\.role\}/)
  assert.match(workflow, /eventType: 'progress_recorded'/)
  assert.match(server, /requestPath === '\/api\/tutor\/progress'/)
  assert.match(dashboard, /portalRequest\('\/api\/tutor\/progress', 'POST'/)
  assert.match(dashboard, /else if \(kind === 'progress'\)[\s\S]*\/api\/tutor\/progress/)
})

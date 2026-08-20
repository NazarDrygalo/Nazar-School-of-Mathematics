import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const readProjectFile = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('assignment status transitions authorize the assigned student and active tutor', async () => {
  const sql = await readProjectFile('supabase/migrations/20260820203358_assignment_completion_workflow.sql')

  assert.match(sql, /add column if not exists submitted_at timestamptz/)
  assert.match(sql, /add column if not exists reviewed_at timestamptz/)
  assert.match(sql, /revoke update on public\.assignments from authenticated/)
  assert.match(sql, /grant update \(title, instructions, due_at\) on public\.assignments to authenticated/)
  assert.match(sql, /create or replace function private\.transition_assignment_status/)
  assert.match(sql, /security definer[\s\S]*set search_path = ''/)
  assert.match(sql, /s\.auth_user_id = \(select auth\.uid\(\)\)[\s\S]*s\.active/)
  assert.match(sql, /sta\.student_id = current_assignment\.student_id[\s\S]*sta\.active/)
  assert.match(sql, /current_assignment\.status <> 'assigned' or next_status <> 'submitted'/)
  assert.match(sql, /current_assignment\.status = 'submitted' and next_status = 'reviewed'/)
  assert.match(sql, /revoke all on function public\.transition_assignment_status\(uuid, text\)[\s\S]*from public, anon/)
  assert.match(sql, /grant execute on function public\.transition_assignment_status\(uuid, text\)[\s\S]*to authenticated, service_role/)
})

test('student and tutor dashboards expose the assignment completion workflow', async () => {
  const dashboard = await readProjectFile('src/Dashboards.tsx')

  assert.match(dashboard, /target_assignment_id: id, next_status: 'submitted'/)
  assert.match(dashboard, />Mark complete</)
  assert.match(dashboard, />Mark reviewed</)
  assert.match(dashboard, />Return for revisions</)
  assert.match(dashboard, /submitted_at,reviewed_at/)
})

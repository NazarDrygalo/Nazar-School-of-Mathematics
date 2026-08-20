import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationPath = new URL('../supabase/migrations/20260820140000_private_privileged_functions.sql', import.meta.url)

test('privileged implementations move to an unexposed private schema', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /create schema if not exists private/i)
  assert.match(sql, /revoke all on schema private from public, anon/i)
  assert.match(sql, /alter function public\.is_admin\(\) set schema private/i)
  assert.match(sql, /alter function public\.session_note_tutor_matches_session\(uuid, uuid\) set schema private/i)
  assert.match(sql, /alter function public\.onboard_accepted_application\(uuid, uuid\) set schema private/i)
  assert.match(sql, /alter function public\.save_tutoring_session_note\(uuid, text, text\) set schema private/i)
})

test('public compatibility RPCs use invoker rights and retain narrow grants', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  const publicSection = sql.slice(sql.indexOf('create function public.is_admin()'))
  assert.match(publicSection, /security invoker/g)
  assert.doesNotMatch(publicSection, /security definer/i)
  assert.match(publicSection, /select private\.onboard_accepted_application\(\$1, \$2\)/i)
  assert.match(publicSection, /select private\.save_tutoring_session_note\(\$1, \$2, \$3\)/i)
  assert.match(publicSection, /grant execute on function public\.onboard_accepted_application\(uuid, uuid\) to authenticated, service_role/i)
})

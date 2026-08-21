import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('email preferences migration uses owner-only RLS and least-privilege grants', async () => {
  const sql = await read('supabase/migrations/20260820230855_email_notification_preferences.sql')
  assert.match(sql, /user_id uuid primary key references auth\.users\(id\) on delete cascade/i)
  assert.match(sql, /alter table public\.email_notification_preferences enable row level security/i)
  assert.match(sql, /revoke all on table public\.email_notification_preferences from public, anon, authenticated/i)
  assert.match(sql, /grant select, insert, update on table public\.email_notification_preferences to authenticated/i)
  assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id\)/i)
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = user_id\)/i)
  assert.doesNotMatch(sql, /grant delete[^;]*authenticated/i)
})

test('portal exposes role-aware, mobile-friendly email controls', async () => {
  const [dashboard, css] = await Promise.all([read('src/Dashboards.tsx'), read('src/styles.css')])
  assert.match(dashboard, /function EmailPreferences/)
  assert.match(dashboard, /from\('email_notification_preferences'\)\.upsert/)
  assert.match(dashboard, /<EmailPreferences role="parent"/)
  assert.match(dashboard, /<EmailPreferences role="student"/)
  assert.match(dashboard, /<EmailPreferences role="tutor"/)
  assert.match(dashboard, /Account recovery and security messages always remain enabled/)
  assert.match(css, /@media\(max-width:760px\)\{\.email-preferences/)
})

test('optional workflow emails enforce the recipient preference on the server', async () => {
  const [workflow, reminders, digests] = await Promise.all([
    read('server/workflow-notifications.mjs'),
    read('server/session-reminders.mjs'),
    read('server/weekly-family-digests.mjs')
  ])
  assert.match(workflow, /emailPreferenceKeys = new Set/)
  assert.match(workflow, /preferences\?\.\[message\.preferenceKey\] === false/)
  for (const key of ['session_updates', 'assignment_updates', 'progress_updates']) assert.match(workflow, new RegExp(`preferenceKey: '${key}'`))
  assert.match(reminders, /preferenceKey: 'session_reminders'/)
  assert.match(digests, /preferenceKey: 'weekly_digest'/)
  assert.match(reminders, /delivery\.status === 'skipped'/)
  assert.match(digests, /delivery\.status === 'skipped'/)
})

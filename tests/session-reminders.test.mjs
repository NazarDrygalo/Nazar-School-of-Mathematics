import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { buildSessionReminderEmail } from '../server/session-reminders.mjs'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('reminder migration extends delivery tracking without exposing browser writes', async () => {
  const migration = await read('supabase/migrations/20260819152015_session_reminders.sql')
  assert.match(migration, /'session_reminder'/)
  assert.match(migration, /'student'/)
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete).*authenticated/i)
})

test('reminder worker uses an upcoming window and idempotent event keys', async () => {
  const [worker, notifications] = await Promise.all([
    read('server/session-reminders.mjs'),
    read('server/workflow-notifications.mjs')
  ])
  assert.match(worker, /\.eq\('status', 'scheduled'\)/)
  assert.match(worker, /25 \* 60 \* 60_000/)
  assert.match(worker, /session:\$\{session\.id\}:reminder:\$\{session\.starts_at\}:\$\{recipient\.role\}/)
  assert.match(notifications, /Date\.now\(\) - 10 \* 60_000/)
  assert.match(notifications, /AbortSignal\.timeout\(8000\)/)
  assert.match(notifications, /'Idempotency-Key': String\(message\.eventKey\)\.slice\(0, 256\)/)
})

test('reminder email limits the student surname and escapes meeting links', () => {
  const email = buildSessionReminderEmail({
    session: { starts_at: '2026-08-21T17:00:00.000Z', meeting_url: 'https://meet.example/?a=1&b=2' },
    student: { first_name: 'Student', last_name: 'Lastname' },
    tutor: { first_name: 'Nazar', last_name: 'Tutor' },
    recipientRole: 'parent',
    recipientFirstName: 'Parent'
  })
  assert.match(email.subject, /Student L\./)
  assert.doesNotMatch(email.subject, /Lastname/)
  assert.match(email.html, /a=1&amp;b=2/)
  assert.match(email.text, /parent portal/)
})

test('server protects the reminder endpoint with a constant-time secret check', async () => {
  const server = await read('server.mjs')
  assert.match(server, /timingSafeEqual/)
  assert.match(server, /REMINDER_CRON_SECRET/)
  assert.match(server, /\/api\/cron\/session-reminders/)
})

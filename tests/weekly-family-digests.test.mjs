import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildWeeklyFamilyDigestEmail, weeklyDigestWindow } from '../server/weekly-family-digests.mjs'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('weekly digest migration extends only server-controlled delivery tracking', async () => {
  const sql = await read('supabase/migrations/20260820224411_weekly_family_digests.sql')
  assert.match(sql, /'weekly_family_digest'/)
  assert.match(sql, /drop constraint if exists notification_deliveries_event_type_check/i)
  assert.match(sql, /Browser roles cannot write this table/i)
})

test('weekly digest window is stable across retries on the same Monday', () => {
  const first = weeklyDigestWindow(new Date('2026-08-24T13:00:00.000Z'))
  const retry = weeklyDigestWindow(new Date('2026-08-24T20:00:00.000Z'))
  assert.equal(first.periodKey, '2026-08-17')
  assert.equal(retry.periodKey, first.periodKey)
  assert.equal(first.periodEnd.toISOString(), '2026-08-24T00:00:00.000Z')
})

test('weekly digest escapes tutoring content and limits long sections', () => {
  const email = buildWeeklyFamilyDigestEmail({
    student: { first_name: 'Ava', last_name: '<Student>' },
    progress: Array.from({ length: 10 }, (_, index) => ({ area: `Algebra ${index}`, mastery_level: 4, notes: index === 0 ? '<script>alert(1)</script>' : '' })),
    assignments: [{ title: 'Functions', status: 'reviewed', due_at: '2026-08-20T12:00:00.000Z' }],
    sessions: [{ starts_at: '2026-08-19T15:00:00.000Z', status: 'completed' }],
    periodStart: new Date('2026-08-17T00:00:00.000Z'),
    periodEnd: new Date('2026-08-24T00:00:00.000Z'),
    recipientFirstName: 'Pat'
  })
  assert.match(email.subject, /Weekly tutoring summary/)
  assert.match(email.text, /\+ 2 more/)
  assert.doesNotMatch(email.html, /<script>/)
  assert.match(email.html, /&lt;script&gt;/)
})

test('weekly digest worker uses one idempotent event key per student period and recipient', async () => {
  const [worker, server] = await Promise.all([read('server/weekly-family-digests.mjs'), read('server.mjs')])
  assert.match(worker, /weekly-digest:\$\{student\.id\}:\$\{periodKey\}:\$\{target\.role\}/)
  assert.match(worker, /eventType: 'weekly_family_digest'/)
  assert.match(worker, /if \(!progress\.length && !assignments\.length && !sessions\.length\)/)
  assert.match(server, /\/api\/cron\/weekly-family-digests/)
  assert.match(server, /validCronAuthorization\(req\)/)
})

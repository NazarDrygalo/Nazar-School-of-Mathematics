import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Google Calendar OAuth uses offline access, least privilege, and encrypted refresh tokens', async () => {
  const calendar = await read('server/google-calendar.mjs')
  assert.match(calendar, /calendar\.events\.owned/)
  assert.match(calendar, /access_type: 'offline'/)
  assert.match(calendar, /prompt: 'consent'/)
  assert.match(calendar, /aes-256-gcm/)
  assert.match(calendar, /claim_google_calendar_oauth_state/)
  assert.match(calendar, /sendUpdates=none/)
  assert.doesNotMatch(calendar, /VITE_GOOGLE/)
})

test('session mutations and approved reschedules synchronize without rolling back tutoring data', async () => {
  const workflow = await read('server/workflow-notifications.mjs')
  const calendar = await read('server/google-calendar.mjs')
  assert.match(workflow, /syncSessionToGoogleCalendar\(supabase, session\)/)
  assert.match(workflow, /resolution === 'approved'/)
  assert.match(calendar, /status: 'failed', warning: 'The tutoring session was saved/)
  assert.match(calendar, /response\.status === 409/)
})

test('tutor dashboard provides responsive connect and disconnect controls', async () => {
  const dashboard = await read('src/Dashboards.tsx')
  const styles = await read('src/styles.css')
  assert.match(dashboard, /Connect Google Calendar/)
  assert.match(dashboard, /\/api\/tutor\/google-calendar\/authorize/)
  assert.match(dashboard, /\/api\/tutor\/google-calendar\/disconnect/)
  assert.match(styles, /@media\(max-width:600px\).*\.calendar-connection/s)
})

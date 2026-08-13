import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('administrator dashboard exposes operational counters and filters', async () => {
  const portal = await read('src/Portal.tsx')

  for (const label of ['Needs review', 'Onboarding needed', 'Pending requests', 'Delivery issues', 'No portal access']) {
    assert.match(portal, new RegExp(`label="${label}"`))
  }

  assert.match(portal, /placeholder="Student, parent, email, or course"/)
  assert.match(portal, /<option value="delivery">Email delivery issue<\/option>/)
  assert.match(portal, /<option value="onboarding">Onboarding incomplete<\/option>/)
  assert.match(portal, /<option value="unlinked">No portal access<\/option>/)
})

test('administrator dashboard retrieves and displays delivery and portal-link state', async () => {
  const portal = await read('src/Portal.tsx')

  assert.match(portal, /notification_error, accepted_email_status, accepted_email_sent_at, accepted_email_error/)
  assert.match(portal, /label="School notification"/)
  assert.match(portal, /label="Acceptance email"/)
  assert.match(portal, /label="Parent portal"/)
  assert.match(portal, /label="Student portal"/)
})

test('administrator dashboard controls collapse for mobile screens', async () => {
  const styles = await read('src/styles.css')

  assert.match(styles, /@media\(max-width:600px\).*\.admin-filters\{grid-template-columns:1fr\}/)
  assert.match(styles, /@media\(max-width:600px\).*\.delivery-grid,\.onboarding-checks\{grid-template-columns:1fr\}/)
})

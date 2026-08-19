import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('tutor dashboard manages recurring availability and unavailable blocks', async () => {
  const dashboard = await read('src/Dashboards.tsx')
  assert.match(dashboard, /Your availability/)
  assert.match(dashboard, /from\('tutor_availability_rules'\)/)
  assert.match(dashboard, /from\('tutor_unavailable_blocks'\)/)
  assert.match(dashboard, /Block unavailable time/)
  assert.match(dashboard, /removeAvailability/)
})

test('session server uses the conflict-aware database workflow', async () => {
  const workflow = await read('server/workflow-notifications.mjs')
  assert.match(workflow, /rpc\('save_tutoring_session_server'/)
  assert.match(workflow, /overlaps another scheduled session/)
  assert.match(workflow, /blocked as unavailable/)
})

test('availability controls collapse to one column on mobile', async () => {
  const styles = await read('src/styles.css')
  assert.match(styles, /@media\(max-width:760px\).*\.availability-grid\{grid-template-columns:1fr\}/s)
})

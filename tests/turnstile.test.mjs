import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('application form uses explicit Turnstile rendering and sends only the public token', async () => {
  const [widget, main, env] = await Promise.all([read('src/Turnstile.tsx'), read('src/main.tsx'), read('.env.example')])
  assert.match(widget, /api\.js\?render=explicit/)
  assert.match(widget, /action: 'application'/)
  assert.match(widget, /VITE_TURNSTILE_SITE_KEY/)
  assert.match(main, /JSON\.stringify\(\{ \.\.\.data, turnstileToken \}\)/)
  assert.match(main, /disabled=\{status === 'sending' \|\| !turnstileToken\}/)
  assert.match(env, /TURNSTILE_SECRET_KEY=/)
  assert.doesNotMatch(widget, /TURNSTILE_SECRET_KEY/)
})

test('server requires Siteverify before saving an application', async () => {
  const server = await read('server.mjs')
  const verificationIndex = server.indexOf('await verifyTurnstile(')
  const saveIndex = server.indexOf('stored = await saveApplication(')
  assert.ok(verificationIndex > 0)
  assert.ok(saveIndex > verificationIndex)
  assert.match(server, /turnstile\/v0\/siteverify/)
  assert.match(server, /result\.hostname/)
  assert.match(server, /result\.action !== 'application'/)
})

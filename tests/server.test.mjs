import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'

process.env.RESEND_API_KEY = 'placeholder'
process.env.SUPABASE_URL = 'https://placeholder.example.com'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder'

const { renderIndexHtml, requestHandler } = await import('../server.mjs')

function request({ method = 'GET', url = '/', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [body] : [])
    Object.assign(req, { method, url, headers })
    const chunks = []
    const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
    res.writeHead = (status, responseHeaders = {}) => { res.statusCode = status; res.headers = responseHeaders; return res }
    const originalEnd = res.end.bind(res)
    res.end = chunk => {
      if (chunk) chunks.push(Buffer.from(chunk))
      originalEnd()
      const text = Buffer.concat(chunks).toString('utf8')
      resolve({ status: res.statusCode, headers: res.headers || {}, body: text ? JSON.parse(text) : null })
      return res
    }
    Promise.resolve(requestHandler(req, res)).catch(reject)
  })
}

test('application endpoint rejects unsupported methods', async () => {
  const response = await request({ url: '/api/application' })
  assert.equal(response.status, 405)
  assert.equal(response.body.error, 'Method not allowed.')
})

test('application endpoint rejects invalid JSON', async () => {
  const response = await request({ method: 'POST', url: '/api/application', headers: { 'content-type': 'application/json' }, body: '{' })
  assert.equal(response.status, 400)
  assert.match(response.body.error, /valid JSON/i)
})

test('application endpoint validates required fields before external services', async () => {
  const response = await request({ method: 'POST', url: '/api/application', headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID() }, body: JSON.stringify({ serviceArea: 'Math' }) })
  assert.equal(response.status, 400)
  assert.match(response.body.error, /required field/i)
})

test('administrator endpoint refuses to operate when secure server configuration is absent', async () => {
  const response = await request({ method: 'PATCH', url: '/api/admin/applications/00000000-0000-4000-8000-000000000000/status', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'accepted' }) })
  assert.equal(response.status, 503)
  assert.match(response.body.error, /not configured/i)
})

test('application endpoint requires JSON and rejects unauthorized browser origins', async () => {
  const wrongType = await request({ method: 'POST', url: '/api/application', headers: { 'content-type': 'text/plain' }, body: '{}' })
  const wrongOrigin = await request({ method: 'POST', url: '/api/application', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' }, body: '{}' })
  assert.equal(wrongType.status, 415)
  assert.equal(wrongOrigin.status, 403)
})

test('malformed URL encoding returns a controlled error', async () => {
  const response = await request({ url: '/%E0%A4%A' })
  assert.equal(response.status, 400)
  assert.match(response.body.error, /malformed/i)
})

test('responses include browser security headers', async () => {
  const response = await request({ url: '/api/unknown' })
  assert.match(response.headers['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.equal(response.headers['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains')
  assert.match(response.headers['Permissions-Policy'], /camera=\(\)/)
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
})

test('workflow mutation endpoints reject unsupported methods', async () => {
  const tutor = await request({ url: '/api/tutor/sessions' })
  const parent = await request({ url: '/api/parent/session-change-requests' })
  const admin = await request({ method: 'POST', url: '/api/admin/session-change-requests/00000000-0000-4000-8000-000000000000' })
  assert.equal(tutor.status, 405)
  assert.equal(parent.status, 405)
  assert.equal(admin.status, 405)
})

test('workflow mutation endpoints require secure server configuration', async () => {
  const response = await request({ method: 'POST', url: '/api/parent/session-change-requests', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), session_id: crypto.randomUUID(), request_type: 'cancel' }) })
  assert.equal(response.status, 503)
  assert.match(response.body.error, /not configured/i)
})

test('clean routes receive route-specific canonical and indexing metadata', () => {
  const source = '<title>Home</title><meta name="description" content="Home" /><meta name="robots" content="index, follow" /><link rel="canonical" href="https://nazarschoolofmath.com/" /><meta property="og:title" content="Home" /><meta property="og:description" content="Home" /><meta property="og:url" content="https://nazarschoolofmath.com/" /><meta name="twitter:title" content="Home" /><meta name="twitter:description" content="Home" />'
  const publicPage = renderIndexHtml(source, '/resources')
  const privatePage = renderIndexHtml(source, '/parent')
  assert.match(publicPage, /Student and Parent Resources/)
  assert.match(publicPage, /canonical" href="https:\/\/nazarschoolofmath\.com\/resources"/)
  assert.match(publicPage, /robots" content="index, follow"/)
  assert.match(privatePage, /robots" content="noindex, nofollow"/)
})

test('structured data receives the CSP nonce used for rendered HTML', () => {
  const rendered = renderIndexHtml('<script type="application/ld+json">{}</script>', '/', 'test-nonce')
  assert.match(rendered, /type="application\/ld\+json" nonce="test-nonce"/)
})

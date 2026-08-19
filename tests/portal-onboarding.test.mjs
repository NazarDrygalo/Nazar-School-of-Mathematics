import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('portal onboarding migration tracks attempts and limits linking to the service role', async () => {
  const sql = await read('supabase/migrations/20260818170000_portal_onboarding.sql')

  assert.match(sql, /create table if not exists public\.portal_invitations/)
  assert.match(sql, /unique \(target_role, target_id\)/)
  assert.match(sql, /create or replace function public\.claim_portal_invitation/)
  assert.match(sql, /last_request_id = p_request_id/)
  assert.match(sql, /create or replace function public\.link_portal_auth_user/)
  assert.match(sql, /a\.status = 'accepted'/)
  assert.match(sql, /from public\.tutors t where t\.id = p_target_id and t\.active/)
  assert.match(sql, /already linked to another portal record/)
  assert.match(sql, /already has another portal role/)
  assert.match(sql, /Auth user email does not match the portal record/)
  assert.match(sql, /revoke all on function public\.link_portal_auth_user\(text, uuid, uuid, text\) from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.link_portal_auth_user\(text, uuid, uuid, text\) to service_role/)
  assert.match(sql, /admins read portal invitations/)
  assert.match(sql, /'portal_invitations', deleted_portal_invitations/)
})

test('server creates one-time setup links, sends them privately, and links users atomically', async () => {
  const server = await read('server/portal-onboarding.mjs')
  const router = await read('server.mjs')

  assert.match(server, /requireRole\(req, 'admin'\)/)
  assert.match(server, /auth\.admin\.listUsers/)
  assert.match(server, /auth\.admin\.generateLink/)
  assert.match(server, /type = user \? 'recovery' : 'invite'/)
  assert.match(server, /rpc\('claim_portal_invitation'/)
  assert.match(server, /rpc\('link_portal_auth_user'/)
  assert.match(server, /student_tutor_assignments/)
  assert.match(server, /https:\/\/api\.resend\.com\/emails/)
  assert.match(server, /status: 'failed'/)
  assert.match(router, /portal-invitations/)
  assert.match(router, /portal-invitation/)
})

test('administrator UI confirms recipients and supports parent, student, and tutor invitations', async () => {
  const portal = await read('src/Portal.tsx')
  const styles = await read('src/styles.css')

  assert.match(portal, /window\.confirm\(`Send secure portal account setup/)
  assert.match(portal, /Student email address/)
  assert.match(portal, /Send portal setup email/)
  assert.match(portal, /Send password reset/)
  assert.match(portal, /type=\(recovery\|invite\)/)
  assert.match(portal, /from\('portal_invitations'\)/)
  assert.match(styles, /\.portal-invite-box/)
  assert.match(styles, /@media\(max-width:600px\).*\.portal-invite-box/s)
})

test('password recovery returns directly to the portal password form', async () => {
  const portal = await read('src/Portal.tsx')
  const routes = await read('src/routes.ts')
  assert.match(portal, /resetPasswordForEmail\(email, \{ redirectTo: `\$\{location\.origin\}\/portal` \}\)/)
  assert.match(portal, /PASSWORD_RECOVERY/)
  assert.match(routes, /location\.hash\.includes\('type=recovery'\).*return 'portal'/s)
})

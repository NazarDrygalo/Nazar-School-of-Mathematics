import { requireRole } from './workflow-notifications.mjs'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const validEmail = value => /^\S+@\S+\.\S+$/.test(value) && value.length <= 320
const siteOrigin = () => (process.env.PUBLIC_SITE_ORIGIN || 'https://nazarschoolofmath.com').replace(/\/+$/, '')
const fromAddress = () => process.env.FROM_EMAIL || "Nazar's School of Mathematics <onboarding@resend.dev>"
const replyTo = () => process.env.APPLICATION_RECIPIENT || 'nazar.drygalo@gmail.com'

async function findAuthUserByEmail(supabase, email) {
  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw Object.assign(new Error('Existing portal accounts could not be checked.'), { status: 502 })
    const user = data.users.find(item => item.email?.toLowerCase() === email)
    if (user) return user
    if (data.users.length < 200) return null
  }
  throw Object.assign(new Error('The Auth user directory is too large to search safely.'), { status: 503 })
}

async function claimInvitation(supabase, { role, targetId, email, requestId, adminId }) {
  const { data, error } = await supabase.rpc('claim_portal_invitation', {
    p_target_role: role,
    p_target_id: targetId,
    p_invitation_email: email,
    p_request_id: requestId,
    p_invited_by: adminId
  })
  if (error || !data?.[0]?.invitation_id) {
    throw Object.assign(new Error('Invitation tracking is unavailable. Run the portal-onboarding migration first.'), { status: 503 })
  }
  return { id: data[0].invitation_id, claimed: Boolean(data[0].claimed), status: data[0].current_status }
}

async function markInvitation(supabase, invitationId, values) {
  const { error } = await supabase.from('portal_invitations').update(values).eq('id', invitationId)
  if (error) throw Object.assign(new Error('The invitation result could not be recorded.'), { status: 502 })
}

async function generateSetupLink(supabase, email, role, targetId) {
  let user = await findAuthUserByEmail(supabase, email)
  let type = user ? 'recovery' : 'invite'
  let result = await supabase.auth.admin.generateLink({
    type,
    email,
    options: { redirectTo: `${siteOrigin()}/portal`, data: { portal_role: role, portal_record_id: targetId } }
  })

  if (result.error && type === 'invite') {
    user = await findAuthUserByEmail(supabase, email)
    if (user) {
      type = 'recovery'
      result = await supabase.auth.admin.generateLink({ type, email, options: { redirectTo: `${siteOrigin()}/portal` } })
    }
  }
  if (result.error || !result.data?.properties?.action_link || !result.data.user) {
    throw Object.assign(new Error('Supabase could not create a secure account-setup link.'), { status: 502 })
  }
  return { user: result.data.user, actionLink: result.data.properties.action_link, existing: type === 'recovery' }
}

async function sendSetupEmail({ email, role, name, actionLink, existing }) {
  if (!process.env.RESEND_API_KEY) throw Object.assign(new Error('Resend is not configured for portal invitations.'), { status: 503 })
  const roleName = role === 'parent' ? 'parent' : role === 'student' ? 'student' : 'tutor'
  const greeting = clean(name, 200) || 'Portal user'
  const action = existing ? 'Reset password and open portal' : 'Set up portal account'
  const text = `Hello ${greeting},\n\nYour ${roleName} portal access for Nazar's School of Mathematics is ready. Use the secure link below to ${existing ? 'choose a new password' : 'create your password'} and sign in.\n\n${actionLink}\n\nIf you were not expecting this message, contact the school and do not use the link.\n\nNazar's School of Mathematics\nnazarschoolofmath.com`
  const html = `<p>Hello ${escapeHtml(greeting)},</p><p>Your <strong>${roleName} portal</strong> access for Nazar's School of Mathematics is ready.</p><p><a href="${escapeHtml(actionLink)}">${action}</a></p><p>This secure link expires according to the school's Supabase Authentication settings. If you were not expecting this message, contact the school and do not use the link.</p><p>Nazar's School of Mathematics<br><a href="https://nazarschoolofmath.com">nazarschoolofmath.com</a></p>`
  let response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress(), to: [email], reply_to: replyTo(), subject: `Set up your ${roleName} portal | Nazar's School of Mathematics`, html, text })
    })
  } catch {
    throw Object.assign(new Error('The invitation email provider could not be reached.'), { status: 502 })
  }
  if (!response.ok) throw Object.assign(new Error(`The invitation email provider returned HTTP ${response.status}.`), { status: 502 })
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character])

async function invitePortalUser(supabase, adminId, { role, targetId, email, name, requestId }) {
  const normalizedEmail = clean(email, 320).toLowerCase()
  if (!uuidPattern.test(targetId) || !uuidPattern.test(requestId) || !validEmail(normalizedEmail)) {
    throw Object.assign(new Error('A valid portal record, email address, and request ID are required.'), { status: 400 })
  }
  const invitation = await claimInvitation(supabase, { role, targetId, email: normalizedEmail, requestId, adminId })
  if (!invitation.claimed) return { role, status: invitation.status === 'linked' ? 'already_processed' : 'processing' }

  try {
    const setup = await generateSetupLink(supabase, normalizedEmail, role, targetId)
    const { error: linkError } = await supabase.rpc('link_portal_auth_user', {
      p_target_role: role,
      p_target_id: targetId,
      p_auth_user_id: setup.user.id,
      p_student_email: role === 'student' ? normalizedEmail : null
    })
    if (linkError) throw Object.assign(new Error(linkError.message || 'The Auth user could not be linked to the portal record.'), { status: 409 })
    await sendSetupEmail({ email: normalizedEmail, role, name, actionLink: setup.actionLink, existing: setup.existing })
    const timestamp = new Date().toISOString()
    await markInvitation(supabase, invitation.id, { status: 'linked', auth_user_id: setup.user.id, invitation_sent_at: timestamp, linked_at: timestamp, error: null })
    return { role, status: setup.existing ? 'existing_account_linked' : 'invited' }
  } catch (error) {
    await markInvitation(supabase, invitation.id, { status: 'failed', error: clean(error.message, 1000) }).catch(() => {})
    throw error
  }
}

export async function inviteAcceptedFamily(req, applicationId, body) {
  if (!uuidPattern.test(applicationId)) throw Object.assign(new Error('A valid application ID is required.'), { status: 400 })
  const { supabase, user } = await requireRole(req, 'admin')
  const requestId = clean(body?.request_id, 40)
  const roles = Array.isArray(body?.roles) ? [...new Set(body.roles.map(value => clean(value, 20)))] : []
  if (!uuidPattern.test(requestId) || !roles.length || roles.some(role => !['parent', 'student'].includes(role))) {
    throw Object.assign(new Error('Select at least one valid family portal account.'), { status: 400 })
  }

  const { data: application, error } = await supabase.from('applications')
    .select('id,status,parents(id,auth_user_id,first_name,last_name,email),students(id,auth_user_id,active,first_name,last_name,email)')
    .eq('id', applicationId).maybeSingle()
  if (error || !application) throw Object.assign(new Error('The accepted application could not be loaded.'), { status: 404 })
  if (application.status !== 'accepted') throw Object.assign(new Error('Only accepted applications can receive portal invitations.'), { status: 409 })
  if (!application.students?.active) throw Object.assign(new Error('Activate the student and assign a tutor before sending portal invitations.'), { status: 409 })
  const { data: assignment, error: assignmentError } = await supabase.from('student_tutor_assignments').select('student_id').eq('student_id', application.students.id).eq('active', true).maybeSingle()
  if (assignmentError || !assignment) throw Object.assign(new Error('Assign an active tutor before sending portal invitations.'), { status: 409 })

  const targets = roles.map(role => {
    const target = role === 'parent' ? application.parents : application.students
    const email = clean(role === 'student' ? clean(body?.student_email, 320) || application.students?.email : application.parents?.email, 320).toLowerCase()
    if (!target || !email) throw Object.assign(new Error(role === 'student' ? 'Enter the student email address.' : 'The parent record has no email address.'), { status: 400 })
    if (!validEmail(email)) throw Object.assign(new Error(`Enter a valid ${role} email address.`), { status: 400 })
    return { role, targetId: target.id, email, name: `${target.first_name} ${target.last_name}`, requestId }
  })
  if (new Set(targets.map(target => target.email)).size !== targets.length) {
    throw Object.assign(new Error('Parent and student portal accounts must use different email addresses.'), { status: 400 })
  }

  const results = []
  for (const target of targets) {
    results.push(await invitePortalUser(supabase, user.id, target))
  }
  return { ok: true, results }
}

export async function inviteTutor(req, tutorId, body) {
  if (!uuidPattern.test(tutorId)) throw Object.assign(new Error('A valid tutor ID is required.'), { status: 400 })
  const { supabase, user } = await requireRole(req, 'admin')
  const requestId = clean(body?.request_id, 40)
  const { data: tutor, error } = await supabase.from('tutors').select('id,auth_user_id,first_name,last_name,email,active').eq('id', tutorId).maybeSingle()
  if (error || !tutor) throw Object.assign(new Error('The tutor record could not be loaded.'), { status: 404 })
  if (!tutor.active) throw Object.assign(new Error('Only active tutors can receive portal invitations.'), { status: 409 })
  const result = await invitePortalUser(supabase, user.id, { role: 'tutor', targetId: tutor.id, email: tutor.email, name: `${tutor.first_name} ${tutor.last_name}`, requestId })
  return { ok: true, results: [result] }
}

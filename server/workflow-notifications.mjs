import { createSupabaseAdminClient, isSupabaseConfigured } from './supabase.mjs'
import { syncSessionToGoogleCalendar } from './google-calendar.mjs'

const recipient = () => process.env.APPLICATION_RECIPIENT || 'nazar.drygalo@gmail.com'
const fromAddress = () => process.env.FROM_EMAIL || "Nazar's School of Mathematics <onboarding@resend.dev>"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character])
const sessionTime = value => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) + ' Eastern Time'

export async function requireRole(req, expectedRole) {
  if (!isSupabaseConfigured()) throw Object.assign(new Error('The secure workflow API is not configured.'), { status: 503 })
  const token = clean(req.headers.authorization, 10_000).match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw Object.assign(new Error('Portal sign-in is required.'), { status: 401 })
  const supabase = createSupabaseAdminClient()
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) throw Object.assign(new Error('Your session is invalid or has expired. Please sign in again.'), { status: 401 })
  const { data: role, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', authData.user.id).maybeSingle()
  if (roleError) throw Object.assign(new Error('Your portal role could not be verified.'), { status: 503 })
  if (role?.role !== expectedRole) throw Object.assign(new Error(`${expectedRole[0].toUpperCase() + expectedRole.slice(1)} access is required.`), { status: 403 })
  if (expectedRole === 'admin') {
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(token)
    if (assuranceError) throw Object.assign(new Error('Multi-factor authentication could not be verified.'), { status: 503 })
    if (assurance.currentLevel !== 'aal2') throw Object.assign(new Error('Administrator multi-factor authentication is required.'), { status: 403 })
  }
  return { supabase, user: authData.user }
}

export async function sendTrackedEmail(supabase, message) {
  let delivery
  const { data: inserted, error: insertError } = await supabase.from('notification_deliveries').insert({
    event_key: message.eventKey,
    event_type: message.eventType,
    session_id: message.sessionId || null,
    change_request_id: message.changeRequestId || null,
    recipient_role: message.recipientRole,
    recipient_email: message.to,
    status: 'sending'
  }).select('id,status').single()
  if (insertError?.code === '23505') {
    const { data: existing } = await supabase.from('notification_deliveries').select('id,status,attempted_at').eq('event_key', message.eventKey).maybeSingle()
    if (!existing) throw Object.assign(new Error('The existing email-delivery claim could not be loaded.'), { status: 503 })
    if (existing?.status === 'sent') return { status: 'already_sent' }
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString()
    if (existing?.status === 'sending' && existing.attempted_at >= staleBefore) return { status: 'processing' }
    let claim = supabase.from('notification_deliveries').update({ status: 'sending', attempted_at: new Date().toISOString(), error: null }).eq('id', existing?.id)
    claim = existing?.status === 'failed' ? claim.eq('status', 'failed') : claim.eq('status', 'sending').lt('attempted_at', staleBefore)
    const { data: claimed } = await claim.select('id,status').maybeSingle()
    if (!claimed) return { status: 'processing' }
    delivery = claimed
  } else if (insertError) {
    throw Object.assign(new Error('Email delivery tracking is unavailable. Confirm the workflow-notifications migration has been run.'), { status: 503 })
  } else delivery = inserted

  if (!process.env.RESEND_API_KEY) {
    await supabase.from('notification_deliveries').update({ status: 'failed', attempted_at: new Date().toISOString(), error: 'Resend is not configured on the server.' }).eq('id', delivery.id)
    return { status: 'failed', warning: 'The workflow was saved, but its email could not be sent because Resend is not configured.' }
  }

  let response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': String(message.eventKey).slice(0, 256) },
      body: JSON.stringify({ from: fromAddress(), to: [message.to], reply_to: recipient(), subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    await supabase.from('notification_deliveries').update({ status: 'failed', attempted_at: new Date().toISOString(), error: 'The Resend request could not be completed.' }).eq('id', delivery.id)
    return { status: 'failed', warning: 'The workflow was saved, but the email provider could not be reached.' }
  }
  if (!response.ok) {
    await supabase.from('notification_deliveries').update({ status: 'failed', attempted_at: new Date().toISOString(), error: `Resend returned HTTP ${response.status}.` }).eq('id', delivery.id)
    return { status: 'failed', warning: 'The workflow was saved, but the email provider rejected delivery.' }
  }
  await supabase.from('notification_deliveries').update({ status: 'sent', attempted_at: new Date().toISOString(), sent_at: new Date().toISOString(), error: null }).eq('id', delivery.id)
  return { status: 'sent' }
}

async function familyForStudent(supabase, studentId) {
  const { data: student, error } = await supabase.from('students').select('id,first_name,last_name,parent_id').eq('id', studentId).maybeSingle()
  if (error || !student) throw Object.assign(new Error('The student record could not be loaded.'), { status: 404 })
  const { data: parent } = await supabase.from('parents').select('id,auth_user_id,first_name,last_name,email').eq('id', student.parent_id).maybeSingle()
  if (!parent) throw Object.assign(new Error('The family record could not be loaded.'), { status: 404 })
  return { student, parent }
}

async function tutorForUser(supabase, userId) {
  const { data: tutor } = await supabase.from('tutors').select('id,first_name,last_name,email,active').eq('auth_user_id', userId).maybeSingle()
  if (!tutor?.active) throw Object.assign(new Error('An active tutor record is required.'), { status: 403 })
  return tutor
}

function validateSession(body) {
  const startsAt = new Date(body?.starts_at)
  const endsAt = new Date(body?.ends_at)
  const status = clean(body?.status, 30)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return 'Enter a valid session start and end time.'
  const duration = endsAt.getTime() - startsAt.getTime()
  if (duration < 15 * 60_000 || duration > 4 * 60 * 60_000) return 'Session duration must be between 15 minutes and 4 hours.'
  if (!['scheduled', 'completed', 'cancelled', 'no_show'].includes(status)) return 'Select a valid session status.'
  const meetingUrl = clean(body?.meeting_url)
  if (meetingUrl) { try { const url = new URL(meetingUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error() } catch { return 'Enter a valid meeting link.' } }
  return null
}

function familySessionEmail({ action, session, student, tutor }) {
  const studentName = `${student.first_name} ${student.last_name}`
  const tutorName = `${tutor.first_name} ${tutor.last_name}`
  const when = sessionTime(session.starts_at)
  const actionText = action === 'created' ? 'scheduled' : 'updated'
  const meeting = session.meeting_url ? `\nMeeting link: ${session.meeting_url}` : ''
  return {
    subject: `Tutoring session ${actionText} | ${studentName}`,
    text: `Hello,\n\nA tutoring session for ${studentName} has been ${actionText}.\n\nTime: ${when}\nTutor: ${tutorName}\nStatus: ${session.status}${meeting}\n\nPlease use the parent portal to review the current schedule.\n\nNazar's School of Mathematics`,
    html: `<p>Hello,</p><p>A tutoring session for <strong>${escapeHtml(studentName)}</strong> has been ${actionText}.</p><p><strong>Time:</strong> ${escapeHtml(when)}<br><strong>Tutor:</strong> ${escapeHtml(tutorName)}<br><strong>Status:</strong> ${escapeHtml(session.status)}${session.meeting_url ? `<br><strong>Meeting link:</strong> <a href="${escapeHtml(session.meeting_url)}">Open meeting</a>` : ''}</p><p>Please use the parent portal to review the current schedule.</p><p>Nazar's School of Mathematics</p>`
  }
}

export async function saveTutorSession(req, body, sessionId = null) {
  const { supabase, user } = await requireRole(req, 'tutor')
  const validationError = validateSession(body)
  if (validationError) throw Object.assign(new Error(validationError), { status: 400 })
  const mutationId = clean(body?.mutation_id, 40)
  if (!uuidPattern.test(mutationId)) throw Object.assign(new Error('A valid mutation ID is required.'), { status: 400 })
  const tutor = await tutorForUser(supabase, user.id)
  let studentId = clean(body?.student_id, 40)
  let previous
  if (sessionId) {
    if (!uuidPattern.test(sessionId)) throw Object.assign(new Error('A valid session ID is required.'), { status: 400 })
    const { data } = await supabase.from('tutoring_sessions').select('id,student_id,tutor_id,starts_at,ends_at,status,meeting_url').eq('id', sessionId).eq('tutor_id', tutor.id).maybeSingle()
    if (!data) throw Object.assign(new Error('The session was not found for this tutor.'), { status: 404 })
    previous = data; studentId = data.student_id
  } else if (!uuidPattern.test(studentId)) throw Object.assign(new Error('Select an assigned student.'), { status: 400 })
  const { data: assignment } = await supabase.from('student_tutor_assignments').select('student_id').eq('student_id', studentId).eq('tutor_id', tutor.id).eq('active', true).maybeSingle()
  if (!assignment) throw Object.assign(new Error('The student is not actively assigned to this tutor.'), { status: 403 })
  const values = { starts_at: new Date(body.starts_at).toISOString(), ends_at: new Date(body.ends_at).toISOString(), meeting_url: clean(body.meeting_url) || null, status: clean(body.status, 30) }
  const saveId = sessionId || mutationId
  const { data: session, error: saveError } = await supabase.rpc('save_tutoring_session_server', {
    p_session_id: saveId,
    p_student_id: studentId,
    p_tutor_id: tutor.id,
    p_starts_at: values.starts_at,
    p_ends_at: values.ends_at,
    p_status: values.status,
    p_meeting_url: values.meeting_url
  })
  if (saveError) {
    const expected = ['overlaps another scheduled session', 'outside the tutor', 'blocked as unavailable', 'not actively assigned']
    const safeMessage = expected.some(message => saveError.message?.toLowerCase().includes(message))
      ? saveError.message
      : 'The session could not be saved. Confirm the tutor-availability migration has been run.'
    throw Object.assign(new Error(safeMessage), { status: safeMessage === saveError.message ? 409 : 502 })
  }
  const { student, parent } = await familyForStudent(supabase, studentId)
  const action = sessionId ? 'updated' : 'created'
  const email = familySessionEmail({ action, session, student, tutor })
  const delivery = await sendTrackedEmail(supabase, { eventKey: `session:${session.id}:${action}:${mutationId}:parent`, eventType: `session_${action}`, sessionId: session.id, recipientRole: 'parent', to: parent.email, ...email })
  const calendar = await syncSessionToGoogleCalendar(supabase, session)
  const warnings = [delivery.warning, calendar.warning].filter(Boolean)
  return { ok: true, session, email: delivery.status, calendar: calendar.status, warning: warnings.join(' ') || undefined, changed: !previous || JSON.stringify(previous) !== JSON.stringify(session) }
}

export async function createSessionChangeRequest(req, body) {
  const { supabase, user } = await requireRole(req, 'parent')
  const requestId = clean(body?.request_id, 40)
  const sessionId = clean(body?.session_id, 40)
  const requestType = clean(body?.request_type, 20)
  if (!uuidPattern.test(requestId) || !uuidPattern.test(sessionId)) throw Object.assign(new Error('Valid request and session IDs are required.'), { status: 400 })
  if (!['cancel', 'reschedule'].includes(requestType)) throw Object.assign(new Error('Select cancellation or a new time.'), { status: 400 })
  const requestedStart = requestType === 'reschedule' ? new Date(body?.requested_starts_at) : null
  if (requestedStart && (Number.isNaN(requestedStart.getTime()) || requestedStart.getTime() < Date.now() + 3 * 24 * 60 * 60 * 1000)) throw Object.assign(new Error('The requested time must be at least three days away.'), { status: 400 })
  const { data: parent } = await supabase.from('parents').select('id,first_name,last_name,email').eq('auth_user_id', user.id).maybeSingle()
  if (!parent) throw Object.assign(new Error('A linked parent record is required.'), { status: 403 })
  const { data: session } = await supabase.from('tutoring_sessions').select('id,student_id,tutor_id,starts_at,ends_at,status').eq('id', sessionId).maybeSingle()
  if (!session || session.status !== 'scheduled' || new Date(session.starts_at).getTime() < Date.now() + 3 * 24 * 60 * 60 * 1000) throw Object.assign(new Error('This session is not eligible for a change request.'), { status: 400 })
  const { student } = await familyForStudent(supabase, session.student_id)
  if (student.parent_id !== parent.id) throw Object.assign(new Error('This session does not belong to your family.'), { status: 403 })
  let changeRequest
  const payload = { id: requestId, session_id: sessionId, requested_by: user.id, request_type: requestType, requested_starts_at: requestedStart?.toISOString() || null, reason: clean(body?.reason) || null }
  const { data, error } = await supabase.from('session_change_requests').insert(payload).select('id,session_id,request_type,requested_starts_at,reason,status').single()
  if (error?.code === '23505') {
    const { data: existing } = await supabase.from('session_change_requests').select('id,session_id,request_type,requested_starts_at,reason,status').eq('id', requestId).eq('requested_by', user.id).maybeSingle()
    if (!existing) throw Object.assign(new Error('Only one request may be pending for this session.'), { status: 409 })
    changeRequest = existing
  } else if (error) throw Object.assign(new Error('The request could not be saved. Only one request may be pending per eligible session.'), { status: 409 })
  else changeRequest = data
  const requestedText = requestType === 'cancel' ? 'Cancellation requested' : `Requested new time: ${sessionTime(changeRequest.requested_starts_at)}`
  const delivery = await sendTrackedEmail(supabase, {
    eventKey: `request:${changeRequest.id}:administrator`, eventType: 'change_requested', sessionId, changeRequestId: changeRequest.id, recipientRole: 'administrator', to: recipient(),
    subject: `Session ${requestType === 'cancel' ? 'cancellation' : 'reschedule'} request | ${student.first_name} ${student.last_name}`,
    text: `A parent submitted a session change request.\n\nStudent: ${student.first_name} ${student.last_name}\nCurrent session: ${sessionTime(session.starts_at)}\n${requestedText}\nParent: ${parent.first_name} ${parent.last_name}\nNote: ${changeRequest.reason || 'None'}\n\nSign in to the administrator portal to review it.`,
    html: `<h1>Session change request</h1><p><strong>Student:</strong> ${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}<br><strong>Current session:</strong> ${escapeHtml(sessionTime(session.starts_at))}<br><strong>Request:</strong> ${escapeHtml(requestedText)}<br><strong>Parent:</strong> ${escapeHtml(parent.first_name)} ${escapeHtml(parent.last_name)}<br><strong>Note:</strong> ${escapeHtml(changeRequest.reason || 'None')}</p><p>Sign in to the administrator portal to review it.</p>`
  })
  return { ok: true, request: changeRequest, email: delivery.status, warning: delivery.warning }
}

export async function resolveSessionChangeRequest(req, requestId, body) {
  const { supabase, user } = await requireRole(req, 'admin')
  const resolution = clean(body?.resolution, 20)
  if (!uuidPattern.test(requestId)) throw Object.assign(new Error('A valid request ID is required.'), { status: 400 })
  if (!['approved', 'declined'].includes(resolution)) throw Object.assign(new Error('Select approved or declined.'), { status: 400 })
  const { data: changeRequest } = await supabase.from('session_change_requests').select('id,session_id,request_type,requested_starts_at,status').eq('id', requestId).maybeSingle()
  if (!changeRequest) throw Object.assign(new Error('The session request was not found.'), { status: 404 })
  if (changeRequest.status === 'pending') {
    const { error } = await supabase.rpc('resolve_session_change_request_server', { change_request_id: requestId, resolution, reviewer_id: user.id })
    if (error) throw Object.assign(new Error('The session request could not be resolved. Confirm the workflow-notifications migration has been run.'), { status: 502 })
  } else if (changeRequest.status !== resolution) throw Object.assign(new Error(`This request was already ${changeRequest.status}.`), { status: 409 })
  const { data: session } = await supabase.from('tutoring_sessions').select('id,student_id,tutor_id,starts_at,ends_at,status,meeting_url').eq('id', changeRequest.session_id).single()
  const [{ student, parent }, tutorResult] = await Promise.all([familyForStudent(supabase, session.student_id), supabase.from('tutors').select('first_name,last_name,email').eq('id', session.tutor_id).single()])
  const tutor = tutorResult.data
  const requestLabel = changeRequest.request_type === 'cancel' ? 'cancellation request' : 'new-time request'
  const outcome = resolution === 'approved' ? `approved. The session is now ${session.status}${session.status === 'scheduled' ? ` for ${sessionTime(session.starts_at)}` : ''}.` : 'declined. The existing session remains unchanged.'
  const base = { eventType: 'change_resolved', sessionId: session.id, changeRequestId: requestId, subject: `Session request ${resolution} | ${student.first_name} ${student.last_name}` }
  const familyDelivery = await sendTrackedEmail(supabase, { ...base, eventKey: `request:${requestId}:resolved:${resolution}:parent`, recipientRole: 'parent', to: parent.email, text: `Hello,\n\nYour ${requestLabel} for ${student.first_name} was ${outcome}\n\nPlease review the parent portal for the current schedule.\n\nNazar's School of Mathematics`, html: `<p>Hello,</p><p>Your ${escapeHtml(requestLabel)} for <strong>${escapeHtml(student.first_name)}</strong> was ${escapeHtml(outcome)}</p><p>Please review the parent portal for the current schedule.</p><p>Nazar's School of Mathematics</p>` })
  const tutorDelivery = tutor?.email ? await sendTrackedEmail(supabase, { ...base, eventKey: `request:${requestId}:resolved:${resolution}:tutor`, recipientRole: 'tutor', to: tutor.email, text: `Hello ${tutor.first_name},\n\nThe ${requestLabel} for ${student.first_name} ${student.last_name} was ${outcome}\n\nPlease review the tutor portal for the current schedule.`, html: `<p>Hello ${escapeHtml(tutor.first_name)},</p><p>The ${escapeHtml(requestLabel)} for <strong>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</strong> was ${escapeHtml(outcome)}</p><p>Please review the tutor portal for the current schedule.</p>` }) : { status: 'failed', warning: 'The tutor has no delivery email.' }
  const calendar = resolution === 'approved' ? await syncSessionToGoogleCalendar(supabase, session) : { status: 'unchanged' }
  const warnings = [familyDelivery.warning, tutorDelivery.warning, calendar.warning].filter(Boolean)
  return { ok: true, resolution, emails: { parent: familyDelivery.status, tutor: tutorDelivery.status }, calendar: calendar.status, warning: warnings.join(' ') || undefined }
}

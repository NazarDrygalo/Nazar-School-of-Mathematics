import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { createSupabaseAdminClient, isSupabaseConfigured } from './server/supabase.mjs'

// Local convenience only; hosted platforms should provide these through their environment.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

const port = Number(process.env.PORT || 3000)
const dist = join(process.cwd(), 'dist')
const recentRequests = new Map()
const recipient = process.env.APPLICATION_RECIPIENT || 'nazar.drygalo@gmail.com'
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
const routeSeo = {
  '/': { title: 'Nazar’s School of Mathematics | Online Tutoring for Middle School–11th Grade', description: 'Personalized online mathematics tutoring for students in middle school through 11th grade.' },
  '/math': { title: 'Tutoring Information | Nazar’s School of Mathematics', description: 'Learn how online, one-to-one mathematics tutoring works for middle school through 11th grade.' },
  '/science-and-essay-writing': { title: 'Science and Essay Writing | Nazar’s School of Mathematics', description: 'Online science tutoring for middle school through 11th grade and individualized essay-writing support with Ariana.' },
  '/resources': { title: 'Student and Parent Resources | Nazar’s School of Mathematics', description: 'Free, reputable math, science, essay-writing, and parent-support resources.' },
  '/apply': { title: 'Apply for Tutoring | Nazar’s School of Mathematics', description: 'Submit an application for math, science, or essay-writing tutoring.' },
  '/contact': { title: 'Contact | Nazar’s School of Mathematics', description: 'Contact Nazar’s School of Mathematics with questions about online tutoring.' },
  '/privacy': { title: 'Privacy Notice | Nazar’s School of Mathematics', description: 'Privacy notice for Nazar’s School of Mathematics.' },
  '/terms': { title: 'Terms of Use | Nazar’s School of Mathematics', description: 'Terms of use for Nazar’s School of Mathematics.' },
  '/portal': { title: 'Portal Login | Nazar’s School of Mathematics', description: 'Secure portal access for Nazar’s School of Mathematics.', private: true },
  '/admin': { title: 'Administrator Portal | Nazar’s School of Mathematics', description: 'Secure application review portal.', private: true },
  '/parent': { title: 'Parent Dashboard | Nazar’s School of Mathematics', description: 'Secure parent portal.', private: true },
  '/student': { title: 'Student Dashboard | Nazar’s School of Mathematics', description: 'Secure student portal.', private: true },
  '/tutor': { title: 'Tutor Dashboard | Nazar’s School of Mathematics', description: 'Secure tutor portal.', private: true }
}

export function renderIndexHtml(source, requestPath = '/') {
  const normalizedPath = requestPath.replace(/\/+$/, '') || '/'
  const seoPath = routeSeo[normalizedPath] ? normalizedPath : '/'
  const details = routeSeo[seoPath]
  const canonicalUrl = `https://nazarschoolofmath.com${seoPath === '/' ? '/' : seoPath}`
  const replacements = [
    [/(<title>)[\s\S]*?(<\/title>)/, details.title],
    [/(<meta name="description" content=")[^"]*(" \/>)/, details.description],
    [/(<meta name="robots" content=")[^"]*(" \/>)/, details.private ? 'noindex, nofollow' : 'index, follow'],
    [/(<link rel="canonical" href=")[^"]*(" \/>)/, canonicalUrl],
    [/(<meta property="og:title" content=")[^"]*(" \/>)/, details.title],
    [/(<meta property="og:description" content=")[^"]*(" \/>)/, details.description],
    [/(<meta property="og:url" content=")[^"]*(" \/>)/, canonicalUrl],
    [/(<meta name="twitter:title" content=")[^"]*(" \/>)/, details.title],
    [/(<meta name="twitter:description" content=")[^"]*(" \/>)/, details.description]
  ]
  return replacements.reduce((html, [pattern, value]) => html.replace(pattern, `$1${escapeHtml(value)}$2`), source)
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' })
  res.end(JSON.stringify(body))
}
function clean(value, max = 2000) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]) }
function isValidApplication(data) {
  const required = ['serviceArea', 'studentFirstName', 'studentLastName', 'age', 'gender', 'grade', 'currentCourse', 'parentFirstName', 'parentLastName', 'email']
  if (required.some((key) => !clean(data[key]))) return 'Please complete every required field.'
  if (!/^\S+@\S+\.\S+$/.test(clean(data.email))) return 'Please enter a valid email address.'
  if (!['Math', 'Science', 'Essay Writing'].includes(clean(data.serviceArea))) return 'Please select Math, Science, or Essay Writing.'
  if (!['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11'].includes(clean(data.grade))) return 'Please select a grade from 6 through 11.'
  if (clean(data.gender) && !['Female', 'Male'].includes(clean(data.gender))) return 'Please select Female or Male for gender.'
  if (!/^([1-9]|1[0-9]|20)$/.test(clean(data.age))) return 'Please enter a valid student age.'
  return null
}
function buildEmail(data) {
  const rows = [
    ['Tutoring area', clean(data.serviceArea)],
    ['Student name', `${clean(data.studentFirstName)} ${clean(data.studentLastName)}`], ['Age', clean(data.age)], ['Gender', clean(data.gender)], ['Current grade', clean(data.grade)],
    ['Current subject', clean(data.currentCourse)],
    ['Parent / guardian', `${clean(data.parentFirstName)} ${clean(data.parentLastName)}`], ['Email', clean(data.email)]
  ]
  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n\n')
  const html = `<h1>New Tutoring Application</h1><table style="border-collapse:collapse;width:100%;max-width:720px">${rows.map(([label, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #d9e2ec;width:34%;color:#243b53">${escapeHtml(label)}</th><td style="padding:10px;border-bottom:1px solid #d9e2ec;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join('')}</table>`
  return { text, html }
}
function applicationPayload(data, submissionId) {
  return {
    submission_id: submissionId,
    service_area: clean(data.serviceArea), student_first_name: clean(data.studentFirstName), student_last_name: clean(data.studentLastName), age: clean(data.age), gender: clean(data.gender), grade: clean(data.grade), school: '', current_course: clean(data.currentCourse),
    help_areas: 'Not provided', academic_goals: 'Not provided', additional_student_info: '',
    parent_first_name: clean(data.parentFirstName), parent_last_name: clean(data.parentLastName), email: clean(data.email).toLowerCase(), phone: '', contact_method: '', additional_contact_info: '',
    days: 'Not provided', times: 'Not provided', timezone: 'Not provided'
  }
}
async function saveApplication(data, submissionId) {
  const supabase = createSupabaseAdminClient()
  const { data: result, error } = await supabase.rpc('submit_tutoring_application', { application: applicationPayload(data, submissionId) })
  if (error || !result?.[0]?.application_id) throw error || new Error('Supabase did not return an application ID.')
  return { supabase, applicationId: result[0].application_id }
}
async function recordNotificationStatus(supabase, applicationId, status, error = null) {
  const { error: updateError } = await supabase.from('applications').update({ notification_status: status, notification_attempted_at: new Date().toISOString(), notification_error: error }).eq('id', applicationId)
  if (updateError) console.error('Could not update application notification status:', updateError.message)
}

function readJsonBody(req, maxBytes = 100_000) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > maxBytes) reject(Object.assign(new Error('Request body is too large.'), { status: 413 }))
    })
    req.on('aborted', () => reject(Object.assign(new Error('The request was interrupted.'), { status: 400 })))
    req.on('error', () => reject(Object.assign(new Error('The request could not be read.'), { status: 400 })))
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) }
      catch { reject(Object.assign(new Error('The request must contain valid JSON.'), { status: 400 })) }
    })
  })
}

async function requireAdmin(req) {
  if (!isSupabaseConfigured()) throw Object.assign(new Error('The secure administrator API is not configured.'), { status: 503 })
  const token = clean(req.headers.authorization, 10_000).match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw Object.assign(new Error('Administrator sign-in is required.'), { status: 401 })
  const supabase = createSupabaseAdminClient()
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) throw Object.assign(new Error('Your session is invalid or has expired. Please sign in again.'), { status: 401 })
  const { data: role, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', authData.user.id).maybeSingle()
  if (roleError) throw Object.assign(new Error('The administrator role could not be verified.'), { status: 503 })
  if (role?.role !== 'admin') throw Object.assign(new Error('Administrator access is required.'), { status: 403 })
  return { supabase, user: authData.user }
}

function buildAcceptanceEmail(application) {
  const parentName = clean(application.parents?.first_name) || 'Parent or guardian'
  const studentName = [clean(application.students?.first_name), clean(application.students?.last_name)].filter(Boolean).join(' ') || 'your student'
  const serviceArea = clean(application.service_area) || 'tutoring'
  const text = `Hello ${parentName},\n\nWe are pleased to let you know that ${studentName}'s application for ${serviceArea} has been accepted.\n\nPlease reply to this email so we can discuss the student’s needs, confirm the tutor, and agree on a lesson schedule. Session length is decided with each family and is commonly one hour.\n\nNazar’s School of Mathematics\nnazarschoolofmath.com\n+1 408-460-3643`
  const html = `<p>Hello ${escapeHtml(parentName)},</p><p>We are pleased to let you know that <strong>${escapeHtml(studentName)}'s application for ${escapeHtml(serviceArea)}</strong> has been accepted.</p><p>Please reply to this email so we can discuss the student’s needs, confirm the tutor, and agree on a lesson schedule. Session length is decided with each family and is commonly one hour.</p><p>Nazar’s School of Mathematics<br><a href="https://nazarschoolofmath.com">nazarschoolofmath.com</a><br><a href="tel:+14084603643">+1 408-460-3643</a></p>`
  return { parentName, studentName, text, html }
}

async function changeApplicationStatus(req, res, applicationId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) return sendJson(res, 400, { error: 'A valid application ID is required.' })
  try {
    const { supabase } = await requireAdmin(req)
    const body = await readJsonBody(req)
    const nextStatus = clean(body?.status, 40)
    if (!['submitted', 'reviewing', 'accepted', 'declined', 'withdrawn'].includes(nextStatus)) return sendJson(res, 400, { error: 'Select a valid application status.' })

    const { data: application, error: loadError } = await supabase.from('applications').select('id,status,service_area,accepted_email_status,accepted_email_sent_at,parents(first_name,last_name,email),students(first_name,last_name)').eq('id', applicationId).maybeSingle()
    if (loadError) throw Object.assign(new Error('The application could not be loaded. Confirm the secure scheduling migration has been run.'), { status: 502 })
    if (!application) return sendJson(res, 404, { error: 'Application not found.' })

    const { error: updateError } = await supabase.from('applications').update({ status: nextStatus }).eq('id', applicationId)
    if (updateError) throw Object.assign(new Error('The application status could not be updated.'), { status: 502 })
    if (nextStatus !== 'accepted' || application.accepted_email_sent_at) return sendJson(res, 200, { ok: true, status: nextStatus, acceptanceEmail: application.accepted_email_sent_at ? 'already_sent' : 'not_applicable' })

    const { data: claim, error: claimError } = await supabase.from('applications').update({ accepted_email_status: 'sending', accepted_email_error: null }).eq('id', applicationId).is('accepted_email_sent_at', null).in('accepted_email_status', ['not_sent', 'failed']).select('id').maybeSingle()
    if (claimError) throw Object.assign(new Error('The application was accepted, but email delivery could not be prepared.'), { status: 502, statusUpdated: true })
    if (!claim) return sendJson(res, 409, { error: 'The application was accepted and its acceptance email is already being processed.', statusUpdated: true })
    if (!process.env.RESEND_API_KEY) {
      await supabase.from('applications').update({ accepted_email_status: 'failed', accepted_email_error: 'Resend is not configured on the server.' }).eq('id', applicationId)
      return sendJson(res, 503, { error: 'The application was accepted, but the acceptance email could not be sent because Resend is not configured.', statusUpdated: true })
    }

    const email = buildAcceptanceEmail(application)
    let response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.FROM_EMAIL || "Nazar's School of Mathematics <onboarding@resend.dev>", to: [clean(application.parents?.email).toLowerCase()], reply_to: recipient, subject: `Application Accepted | ${email.studentName}`, html: email.html, text: email.text })
      })
    } catch (error) {
      await supabase.from('applications').update({ accepted_email_status: 'failed', accepted_email_error: 'The Resend request could not be completed.' }).eq('id', applicationId)
      throw Object.assign(new Error('The application was accepted, but the acceptance email could not be delivered. You can retry by selecting accepted again.'), { status: 502, statusUpdated: true })
    }
    if (!response.ok) {
      await supabase.from('applications').update({ accepted_email_status: 'failed', accepted_email_error: `Resend returned HTTP ${response.status}.` }).eq('id', applicationId)
      throw Object.assign(new Error('The application was accepted, but the acceptance email provider rejected delivery. Check Resend and retry by selecting accepted again.'), { status: 502, statusUpdated: true })
    }
    const sentAt = new Date().toISOString()
    const { error: trackingError } = await supabase.from('applications').update({ accepted_email_status: 'sent', accepted_email_sent_at: sentAt, accepted_email_error: null }).eq('id', applicationId)
    if (trackingError) throw Object.assign(new Error('The acceptance email was delivered, but its delivery record could not be saved. Check Resend before retrying.'), { status: 502, statusUpdated: true })
    return sendJson(res, 200, { ok: true, status: nextStatus, acceptanceEmail: 'sent', acceptedEmailSentAt: sentAt })
  } catch (error) {
    console.error('Administrator status update failed:', error.message)
    return sendJson(res, error.status || 500, { error: error.message || 'The application status could not be changed.', statusUpdated: Boolean(error.statusUpdated) })
  }
}

export async function requestHandler(req, res) {
  const adminStatusMatch = req.url?.split('?')[0].match(/^\/api\/admin\/applications\/([0-9a-f-]+)\/status$/i)
  if (adminStatusMatch) {
    if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed.' })
    return changeApplicationStatus(req, res, adminStatusMatch[1])
  }
  if (req.url === '/api/application' && req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' })
  if (req.method === 'POST' && req.url === '/api/application') {
    let raw = ''
    let bodyTooLarge = false
    req.on('data', (chunk) => {
      if (bodyTooLarge) return
      raw += chunk
      if (raw.length > 100_000) { bodyTooLarge = true; raw = '' }
    })
    req.on('aborted', () => sendJson(res, 400, { error: 'The application request was interrupted. Please try again.' }))
    req.on('error', () => sendJson(res, 400, { error: 'We could not read the application request. Please try again.' }))
    req.on('end', async () => {
      if (bodyTooLarge) return sendJson(res, 413, { error: 'The application request is too large.' })
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        return sendJson(res, 400, { error: 'The application request must contain valid JSON.' })
      }
      try {
        if (clean(data.website)) return sendJson(res, 400, { error: 'Unable to submit this application.' })
        const error = isValidApplication(data)
        if (error) return sendJson(res, 400, { error })
        const requestId = clean(req.headers['x-request-id'], 100)
        if (requestId && recentRequests.has(requestId)) return sendJson(res, 409, { error: 'This application was already submitted. Please wait for a response.' })
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return sendJson(res, 400, { error: 'Please refresh the page and try submitting again.' })
        if (!isSupabaseConfigured()) return sendJson(res, 503, { error: 'Applications are not configured for secure submission yet. Please contact the school directly by email.' })
        let stored
        try {
          stored = await saveApplication(data, requestId)
        } catch (saveError) {
          console.error('Supabase application save failed:', saveError.message)
          return sendJson(res, 502, { error: 'We could not securely save your application. Please try again or contact the school directly.' })
        }
        if (requestId) { recentRequests.set(requestId, Date.now()); setTimeout(() => recentRequests.delete(requestId), 10 * 60 * 1000).unref() }
        if (!process.env.RESEND_API_KEY) {
          await recordNotificationStatus(stored.supabase, stored.applicationId, 'failed', 'Resend is not configured on the server.')
          return sendJson(res, 202, { ok: true, emailSent: false, warning: 'Your application was received, but the school notification could not be sent. Please contact the school directly if you do not hear back.' })
        }
        try {
          const email = buildEmail(data)
          const from = process.env.FROM_EMAIL || "Nazar's School of Mathematics <onboarding@resend.dev>"
          const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [recipient], reply_to: clean(data.email), subject: `New Tutoring Application: ${clean(data.studentFirstName)} ${clean(data.studentLastName)}`, html: email.html, text: email.text }) })
          if (!response.ok) {
            console.error('Email provider error:', response.status)
            const message = !process.env.FROM_EMAIL && response.status === 403
              ? 'Testing delivery is limited to the email address on the Resend account. Add a verified domain to receive applications at other addresses.'
              : 'Your application was received, but the school notification could not be sent. Please contact the school directly if you do not hear back.'
            await recordNotificationStatus(stored.supabase, stored.applicationId, 'failed', `Resend returned HTTP ${response.status}.`)
            return sendJson(res, 202, { ok: true, emailSent: false, warning: message })
          }
          await recordNotificationStatus(stored.supabase, stored.applicationId, 'sent')
          const parentReceipt = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [clean(data.email)], subject: 'Application Received | Nazar’s School of Mathematics', html: `<p>Hello ${escapeHtml(clean(data.parentFirstName))},</p><p>Thank you for submitting an application for ${escapeHtml(clean(data.studentFirstName))}. It has been received and will be reviewed. We will contact you at this email address if the application is accepted.</p><p>Nazar’s School of Mathematics</p>`, text: `Hello ${clean(data.parentFirstName)},\n\nThank you for submitting an application for ${clean(data.studentFirstName)}. It has been received and will be reviewed. We will contact you at this email address if the application is accepted.\n\nNazar’s School of Mathematics` }) })
          if (!parentReceipt.ok) console.error('Parent application receipt could not be sent:', parentReceipt.status)
          return sendJson(res, 201, { ok: true, emailSent: true })
        } catch (emailError) {
          console.error('Email delivery failed after application save:', emailError.message)
          await recordNotificationStatus(stored.supabase, stored.applicationId, 'failed', 'The Resend request could not be completed.')
          return sendJson(res, 202, { ok: true, emailSent: false, warning: 'Your application was received, but the school notification could not be sent. Please contact the school directly if you do not hear back.' })
        }
      } catch (unexpectedError) {
        console.error('Unexpected application API error:', unexpectedError.message)
        return sendJson(res, 500, { error: 'We could not process this application. Please try again or contact the school directly.' })
      }
    })
    return
  }
  if (req.url?.startsWith('/api/')) return sendJson(res, 404, { error: 'API endpoint not found.' })
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
  const requestedPath = decodeURIComponent(req.url.split('?')[0])
  const requested = req.url === '/' ? '/index.html' : requestedPath
  const candidate = normalize(join(dist, requested))
  const safePath = !relative(dist, candidate).startsWith('..') && !isAbsolute(relative(dist, candidate)) ? candidate : join(dist, 'index.html')
  const file = existsSync(safePath) ? safePath : join(dist, 'index.html')
  if (file === join(dist, 'index.html')) {
    const html = renderIndexHtml(readFileSync(file, 'utf8'), requestedPath)
    res.writeHead(200, { 'Content-Type': contentTypes['.html'], 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' })
    return res.end(req.method === 'HEAD' ? undefined : html)
  }
  res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

export function startServer(listenPort = port) {
  return createServer(requestHandler).listen(listenPort, () => console.log(`Nazar's School of Mathematics is running at http://localhost:${listenPort}`))
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/server.mjs')) startServer()

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { requireRole } from './workflow-notifications.mjs'

const calendarScope = 'https://www.googleapis.com/auth/calendar.events.owned'
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const eventIdForSession = sessionId => `nsm${sessionId.replaceAll('-', '').toLowerCase()}`
const stateHash = value => createHash('sha256').update(value).digest('hex')
const siteOrigin = () => process.env.PUBLIC_SITE_ORIGIN || 'https://nazarschoolofmath.com'
const redirectUri = () => process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${siteOrigin()}/api/integrations/google-calendar/callback`

function oauthConfig() {
  const clientId = clean(process.env.GOOGLE_CALENDAR_CLIENT_ID, 1000)
  const clientSecret = clean(process.env.GOOGLE_CALENDAR_CLIENT_SECRET, 1000)
  const encodedKey = clean(process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY, 1000)
  let encryptionKey
  try { encryptionKey = Buffer.from(encodedKey, 'base64') } catch { encryptionKey = null }
  if (!clientId || !clientSecret || encryptionKey?.length !== 32) {
    throw Object.assign(new Error('Google Calendar is not configured on the server.'), { status: 503 })
  }
  return { clientId, clientSecret, encryptionKey }
}

function encryptToken(token) {
  const { encryptionKey } = oauthConfig()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`
}

function decryptToken(payload) {
  const { encryptionKey } = oauthConfig()
  const [iv, tag, encrypted] = String(payload).split('.').map(value => Buffer.from(value, 'base64'))
  if (!iv?.length || !tag?.length || !encrypted?.length) throw new Error('The stored Google Calendar credential is invalid.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

async function googleToken(parameters) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters)
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.access_token) throw new Error(result.error_description || 'Google did not issue a usable access token.')
  return result
}

async function accessTokenForConnection(connection) {
  const { clientId, clientSecret } = oauthConfig()
  return googleToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decryptToken(connection.encrypted_refresh_token),
    grant_type: 'refresh_token'
  })
}

async function tutorForUser(supabase, userId) {
  const { data: tutor } = await supabase.from('tutors').select('id,first_name,last_name,email,active').eq('auth_user_id', userId).maybeSingle()
  if (!tutor?.active) throw Object.assign(new Error('An active tutor record is required.'), { status: 403 })
  return tutor
}

export async function beginGoogleCalendarAuthorization(req) {
  const { supabase, user } = await requireRole(req, 'tutor')
  const tutor = await tutorForUser(supabase, user.id)
  const { clientId } = oauthConfig()
  const state = randomBytes(32).toString('base64url')
  await supabase.rpc('purge_expired_google_calendar_oauth_states')
  const { error } = await supabase.from('google_calendar_oauth_states').insert({
    state_hash: stateHash(state), tutor_id: tutor.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
  })
  if (error) throw Object.assign(new Error('The Google Calendar authorization request could not be started. Confirm the calendar migration has been run.'), { status: 502 })
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: calendarScope,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  }).toString()
  return { ok: true, authorization_url: authorization.toString() }
}

export async function completeGoogleCalendarAuthorization(query) {
  const state = clean(query.get('state'), 500)
  const code = clean(query.get('code'), 5000)
  if (!state || !code || query.get('error')) throw Object.assign(new Error('Google Calendar authorization was cancelled or invalid.'), { status: 400 })
  const { clientId, clientSecret } = oauthConfig()
  const { createSupabaseAdminClient } = await import('./supabase.mjs')
  const supabase = createSupabaseAdminClient()
  const { data: tutorId, error: stateError } = await supabase.rpc('claim_google_calendar_oauth_state', { p_state_hash: stateHash(state) })
  if (stateError || !tutorId) throw Object.assign(new Error('The calendar authorization request is invalid or expired.'), { status: 400 })
  const token = await googleToken({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri() })
  if (!String(token.scope || '').split(' ').includes(calendarScope)) throw Object.assign(new Error('Google Calendar event access was not granted.'), { status: 400 })
  const { data: existing } = await supabase.from('google_calendar_connections').select('encrypted_refresh_token').eq('tutor_id', tutorId).maybeSingle()
  const encryptedRefreshToken = token.refresh_token ? encryptToken(token.refresh_token) : existing?.encrypted_refresh_token
  if (!encryptedRefreshToken) throw Object.assign(new Error('Google did not provide offline calendar access. Reconnect and approve access.'), { status: 400 })
  const { error: saveError } = await supabase.from('google_calendar_connections').upsert({
    tutor_id: tutorId,
    encrypted_refresh_token: encryptedRefreshToken,
    calendar_id: 'primary',
    scope: token.scope || calendarScope,
    status: 'connected',
    last_error: null,
    connected_at: new Date().toISOString()
  })
  if (saveError) throw Object.assign(new Error('The Google Calendar connection could not be saved.'), { status: 502 })

  const { data: sessions } = await supabase.from('tutoring_sessions').select('id,student_id,tutor_id,starts_at,ends_at,status,meeting_url').eq('tutor_id', tutorId).eq('status', 'scheduled').gte('ends_at', new Date().toISOString()).order('starts_at').limit(100)
  const connection = { tutor_id: tutorId, encrypted_refresh_token: encryptedRefreshToken, calendar_id: 'primary', status: 'connected' }
  for (const session of sessions || []) await syncSessionToGoogleCalendar(supabase, session, { connection, accessToken: token.access_token })
  return { redirect: `${siteOrigin()}/tutor?calendar=connected` }
}

export async function getGoogleCalendarStatus(req) {
  const { supabase, user } = await requireRole(req, 'tutor')
  const tutor = await tutorForUser(supabase, user.id)
  const [connectionResult, eventResult] = await Promise.all([
    supabase.from('google_calendar_connections').select('status,last_synced_at,last_error,connected_at').eq('tutor_id', tutor.id).maybeSingle(),
    supabase.from('google_calendar_events').select('status,last_error,last_attempted_at').eq('tutor_id', tutor.id).eq('status', 'failed').order('last_attempted_at', { ascending: false }).limit(5)
  ])
  if (connectionResult.error || eventResult.error) throw Object.assign(new Error('Google Calendar status is unavailable. Confirm the calendar migration has been run.'), { status: 503 })
  let configured = true
  try { oauthConfig() } catch { configured = false }
  return { ok: true, configured, connected: Boolean(connectionResult.data), connection: connectionResult.data, failed_events: eventResult.data || [] }
}

export async function disconnectGoogleCalendar(req) {
  const { supabase, user } = await requireRole(req, 'tutor')
  const tutor = await tutorForUser(supabase, user.id)
  const { data: connection } = await supabase.from('google_calendar_connections').select('encrypted_refresh_token').eq('tutor_id', tutor.id).maybeSingle()
  if (connection) {
    try {
      const token = decryptToken(connection.encrypted_refresh_token)
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) })
    } catch { /* Local disconnect must still complete if Google is unavailable. */ }
  }
  const [{ error: connectionError }, { error: eventError }] = await Promise.all([
    supabase.from('google_calendar_connections').delete().eq('tutor_id', tutor.id),
    supabase.from('google_calendar_events').delete().eq('tutor_id', tutor.id)
  ])
  if (connectionError || eventError) throw Object.assign(new Error('The local Google Calendar connection could not be removed.'), { status: 502 })
  return { ok: true }
}

export async function syncSessionToGoogleCalendar(supabase, session, options = {}) {
  const connectionResult = options.connection ? { data: options.connection } : await supabase.from('google_calendar_connections').select('tutor_id,encrypted_refresh_token,calendar_id,status').eq('tutor_id', session.tutor_id).maybeSingle()
  const connection = connectionResult.data
  if (!connection) return { status: 'not_connected' }
  const eventId = eventIdForSession(session.id)
  const attemptedAt = new Date().toISOString()
  await supabase.from('google_calendar_events').upsert({ session_id: session.id, tutor_id: session.tutor_id, google_event_id: eventId, status: 'pending', last_attempted_at: attemptedAt, last_error: null })
  try {
    const token = options.accessToken ? { access_token: options.accessToken } : await accessTokenForConnection(connection)
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events`
    if (session.status !== 'scheduled') {
      const deletion = await fetch(`${baseUrl}/${eventId}?sendUpdates=none`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.access_token}` } })
      if (!deletion.ok && deletion.status !== 404 && deletion.status !== 410) throw new Error(`Google Calendar returned HTTP ${deletion.status}.`)
      await supabase.from('google_calendar_events').update({ status: 'deleted', last_synced_at: new Date().toISOString(), last_error: null }).eq('session_id', session.id)
      return { status: 'deleted' }
    }
    const [{ data: student }, { data: tutor }] = await Promise.all([
      supabase.from('students').select('first_name,last_name').eq('id', session.student_id).single(),
      supabase.from('tutors').select('first_name,last_name').eq('id', session.tutor_id).single()
    ])
    const resource = {
      id: eventId,
      summary: `Math tutoring — ${student?.first_name || 'Student'} ${student?.last_name?.[0] || ''}.`,
      description: `Nazar's School of Mathematics session with ${tutor?.first_name || 'Tutor'}. Manage changes through the tutoring portal.`,
      start: { dateTime: session.starts_at },
      end: { dateTime: session.ends_at },
      visibility: 'private',
      extendedProperties: { private: { tutoringSessionId: session.id } },
      ...(session.meeting_url ? { location: session.meeting_url } : {})
    }
    let response = await fetch(`${baseUrl}?sendUpdates=none`, { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(resource) })
    if (response.status === 409) response = await fetch(`${baseUrl}/${eventId}?sendUpdates=none`, { method: 'PUT', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(resource) })
    if (!response.ok) throw new Error(`Google Calendar returned HTTP ${response.status}.`)
    const syncedAt = new Date().toISOString()
    await Promise.all([
      supabase.from('google_calendar_events').update({ status: 'synced', last_synced_at: syncedAt, last_error: null }).eq('session_id', session.id),
      supabase.from('google_calendar_connections').update({ status: 'connected', last_synced_at: syncedAt, last_error: null }).eq('tutor_id', session.tutor_id)
    ])
    return { status: 'synced' }
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : 'Calendar synchronization failed.', 500)
    await Promise.all([
      supabase.from('google_calendar_events').update({ status: 'failed', last_error: message }).eq('session_id', session.id),
      supabase.from('google_calendar_connections').update({ status: 'error', last_error: message }).eq('tutor_id', session.tutor_id)
    ])
    return { status: 'failed', warning: 'The tutoring session was saved, but Google Calendar could not be updated.' }
  }
}

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from './lib/supabase'
import { navigateTo } from './routes'

type RecordItem = Record<string, any>
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const displayDate = (value?: string) => value ? new Date(value).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Not scheduled'
const displaySessionTime = (start?: string, end?: string) => start ? `${displayDate(start)}${end ? `–${new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}` : ''}` : 'Not scheduled'
const toLocalInput = (value?: string) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return <section className="dashboard"><header className="dashboard-header"><div><p className="eyebrow">Secure portal</p><h1>{title}</h1><p>Information is visible only to the account associated with this portal.</p></div><button className="text-button" onClick={async () => { await supabase?.auth.signOut(); navigateTo('portal') }}>Sign out</button></header>{children}</section>
}
function Notice({ children }: { children: ReactNode }) { return <p className="dashboard-message">{children}</p> }
function List({ title, items, render }: { title: string; items: RecordItem[]; render: (item: RecordItem) => ReactNode }) { return <section className="portal-panel"><h2>{title}</h2>{items.length ? <div className="portal-list">{items.map(render)}</div> : <p className="empty-state">Nothing has been added yet.</p>}</section> }
async function hasPortalRole(expectedRole: 'parent' | 'student' | 'tutor') {
  if (!supabase) return false
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return false
  const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', session.session.user.id).maybeSingle()
  return role?.role === expectedRole
}
async function portalRequest(path: string, method: 'GET' | 'POST' | 'PATCH', body: RecordItem = {}) {
  if (!supabase) throw new Error('Portal access is not configured.')
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Your session has expired. Please sign in again.')
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${data.session.access_token}`, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
  const result = await response.json().catch(() => ({ error: `The server returned an invalid response (HTTP ${response.status}).` }))
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.')
  return result
}

export function ParentDashboard() {
  const [data, setData] = useState<RecordItem>({ students: [], sessions: [], assignments: [], progress: [], summaries: [], requests: [] })
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const [changeRequest, setChangeRequest] = useState({ session_id: '', request_type: 'reschedule', requested_starts_at: '', reason: '' })
  async function load() {
    if (!supabase) return setError('Portal access is not configured.')
    if (!await hasPortalRole('parent')) { setError('A parent portal account is required.'); return }
    const [profile, students, sessions, assignments, progress, summaries, requests] = await Promise.all([
      supabase.from('parents').select('first_name,last_name').maybeSingle(),
      supabase.from('students').select('id,first_name,last_name,grade,current_course').order('first_name'),
      supabase.from('tutoring_sessions').select('id,starts_at,ends_at,status,meeting_url,students(first_name,last_name),tutors(first_name,last_name)').order('starts_at'),
      supabase.from('assignments').select('id,title,instructions,due_at,status,students(first_name,last_name)').order('due_at'),
      supabase.from('student_progress').select('id,area,mastery_level,notes,recorded_at,students(first_name,last_name)').order('recorded_at', { ascending: false }),
      supabase.from('session_parent_summaries').select('session_id,summary,updated_at,tutoring_sessions(starts_at,students(first_name,last_name))').order('updated_at', { ascending: false }),
      supabase.from('session_change_requests').select('id,session_id,request_type,requested_starts_at,status,created_at,tutoring_sessions(starts_at,students(first_name,last_name))').order('created_at', { ascending: false })
    ])
    const failed = [profile, students, sessions, assignments, progress, summaries, requests].find(result => result.error)
    if (failed?.error) return setError('We could not load this portal. Confirm the session-change migration has been run, then try again.')
    setData({ profile: profile.data, students: students.data || [], sessions: sessions.data || [], assignments: assignments.data || [], progress: progress.data || [], summaries: summaries.data || [], requests: requests.data || [] })
  }
  useEffect(() => { void load() }, [])
  async function requestChange(event: FormEvent) {
    event.preventDefault(); if (!supabase || busy) return
    setBusy(true); setError(''); setMessage('')
    const requestedStart = changeRequest.request_type === 'reschedule' ? new Date(changeRequest.requested_starts_at) : null
    if (requestedStart && Number.isNaN(requestedStart.getTime())) { setBusy(false); setError('Enter a valid requested date and time.'); return }
    try {
      const result = await portalRequest('/api/parent/session-change-requests', 'POST', { request_id: crypto.randomUUID(), ...changeRequest, requested_starts_at: requestedStart?.toISOString() || null })
      setChangeRequest({ session_id: '', request_type: 'reschedule', requested_starts_at: '', reason: '' })
      setMessage(result.warning ? `Your request was saved. ${result.warning}` : 'Your session change request was submitted and the administrator was notified.')
      await load()
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The request could not be saved.') }
    finally { setBusy(false) }
  }
  const eligibleSessions = data.sessions.filter((session: RecordItem) => session.status === 'scheduled' && new Date(session.starts_at).getTime() >= Date.now() + 3 * 24 * 60 * 60 * 1000 && !data.requests.some((request: RecordItem) => request.session_id === session.id && request.status === 'pending'))
  return <Shell title={`Parent Dashboard${data.profile ? ` — ${data.profile.first_name}` : ''}`}>
    {error && <Notice>{error}</Notice>}{message && <Notice>{message}</Notice>}
    <div className="portal-grid">
      <List title="Students" items={data.students} render={student => <article key={student.id}><b>{student.first_name} {student.last_name}</b><span>{student.grade || 'Grade not listed'} · {student.current_course || 'Current subject not listed'}</span></article>} />
      <List title="Upcoming sessions" items={data.sessions} render={session => <article key={session.id}><b>{displaySessionTime(session.starts_at, session.ends_at)}</b><span>{session.students?.first_name} {session.students?.last_name} · {session.status}</span>{session.meeting_url && <a href={session.meeting_url} target="_blank" rel="noreferrer">Join online session</a>}</article>} />
      <List title="Assignments" items={data.assignments} render={assignment => <article key={assignment.id}><b>{assignment.title}</b><span>{assignment.students?.first_name} {assignment.students?.last_name} · {assignment.status}</span><small>{assignment.instructions || 'No additional instructions.'}</small></article>} />
      <List title="Progress updates" items={data.progress} render={entry => <article key={entry.id}><b>{entry.area}</b><span>{entry.students?.first_name} {entry.students?.last_name} · Mastery {entry.mastery_level || '—'}/5</span><small>{entry.notes || 'No notes provided.'}</small></article>} />
      <List title="Tutor summaries" items={data.summaries} render={summary => <article key={summary.session_id}><b>{summary.tutoring_sessions?.students?.first_name} {summary.tutoring_sessions?.students?.last_name}</b><span>{displayDate(summary.tutoring_sessions?.starts_at)}</span><small>{summary.summary}</small></article>} />
    </div>
    <div className="session-tools">
      <ToolForm title="Request a cancellation or new time" onSubmit={requestChange} busy={busy}><p className="policy-note">Please submit requests at least three days before the scheduled lesson. Requests remain pending until reviewed.</p><label>Session<select required value={changeRequest.session_id} onChange={event => setChangeRequest({ ...changeRequest, session_id: event.target.value })}><option value="">Select an eligible session</option>{eligibleSessions.map((session: RecordItem) => <option key={session.id} value={session.id}>{session.students?.first_name} — {displayDate(session.starts_at)}</option>)}</select></label><label>Request type<select value={changeRequest.request_type} onChange={event => setChangeRequest({ ...changeRequest, request_type: event.target.value, requested_starts_at: '' })}><option value="reschedule">Request a new time</option><option value="cancel">Request cancellation</option></select></label>{changeRequest.request_type === 'reschedule' && <label>Requested date and time <small>Shown in {browserTimeZone}</small><input required type="datetime-local" value={changeRequest.requested_starts_at} onChange={event => setChangeRequest({ ...changeRequest, requested_starts_at: event.target.value })} /></label>}<label>Optional note<textarea value={changeRequest.reason} onChange={event => setChangeRequest({ ...changeRequest, reason: event.target.value })} /></label></ToolForm>
      <List title="Change requests" items={data.requests} render={request => <article key={request.id}><b>{request.request_type === 'cancel' ? 'Cancellation request' : 'New-time request'}</b><span>{request.tutoring_sessions?.students?.first_name} · {request.status}</span><small>{request.requested_starts_at ? `Requested: ${displayDate(request.requested_starts_at)}` : `Session: ${displayDate(request.tutoring_sessions?.starts_at)}`}</small></article>} />
    </div>
  </Shell>
}

export function StudentDashboard() {
  const [data, setData] = useState<RecordItem>({ sessions: [], assignments: [], progress: [] }); const [error, setError] = useState('')
  useEffect(() => { void (async () => { if (!supabase) return setError('Portal access is not configured.'); if (!await hasPortalRole('student')) return setError('A student portal account is required.'); const [student, sessions, assignments, progress] = await Promise.all([supabase.from('students').select('first_name,last_name,grade,current_course').maybeSingle(), supabase.from('tutoring_sessions').select('id,starts_at,ends_at,status,meeting_url,tutors(first_name,last_name)').order('starts_at'), supabase.from('assignments').select('id,title,instructions,due_at,status').order('due_at'), supabase.from('student_progress').select('id,area,mastery_level,notes,recorded_at').order('recorded_at', { ascending: false })]); const failed = [student, sessions, assignments, progress].find(result => result.error); if (failed?.error) return setError('We could not load this portal. Please try again.'); setData({ student: student.data, sessions: sessions.data || [], assignments: assignments.data || [], progress: progress.data || [] }) })() }, [])
  return <Shell title={`Student Dashboard${data.student ? ` — ${data.student.first_name}` : ''}`}>{error && <Notice>{error}</Notice>}<div className="portal-grid"><List title="Sessions" items={data.sessions} render={session => <article key={session.id}><b>{displaySessionTime(session.starts_at, session.ends_at)}</b><span>{session.tutors?.first_name} {session.tutors?.last_name} · {session.status}</span>{session.meeting_url && <a href={session.meeting_url} target="_blank" rel="noreferrer">Join online session</a>}</article>} /><List title="Assignments" items={data.assignments} render={assignment => <article key={assignment.id}><b>{assignment.title}</b><span>{assignment.status} · {assignment.due_at ? `Due ${displayDate(assignment.due_at)}` : 'No due date'}</span><small>{assignment.instructions || 'No additional instructions.'}</small></article>} /><List title="Progress" items={data.progress} render={entry => <article key={entry.id}><b>{entry.area}</b><span>Mastery {entry.mastery_level || '—'}/5</span><small>{entry.notes || 'No notes provided.'}</small></article>} /></div></Shell>
}

export function TutorDashboard() {
  const [data, setData] = useState<RecordItem>({ students: [], sessions: [], assignments: [], progress: [], availability: [], blocks: [] })
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const [session, setSession] = useState({ student_id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' })
  const [sessionEdit, setSessionEdit] = useState({ id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' })
  const [assignment, setAssignment] = useState({ student_id: '', title: '', instructions: '', due_at: '' })
  const [progress, setProgress] = useState({ student_id: '', area: '', mastery_level: '3', notes: '' })
  const [note, setNote] = useState({ session_id: '', content: '', parent_summary: '' })
  const [availability, setAvailability] = useState({ weekday: '1', start_time: '15:00', end_time: '19:00', timezone: browserTimeZone })
  const [block, setBlock] = useState({ starts_at: '', ends_at: '', reason: '' })
  const [calendar, setCalendar] = useState<RecordItem>({ configured: false, connected: false, connection: null, failed_events: [] })

  async function load() {
    if (!supabase) return setError('Portal access is not configured.')
    if (!await hasPortalRole('tutor')) { setError('A tutor portal account is required.'); return }
    const [tutor, studentAssignments, sessions, assignments, progress, availabilityRules, unavailableBlocks] = await Promise.all([
      supabase.from('tutors').select('id,first_name,last_name').maybeSingle(),
      supabase.from('student_tutor_assignments').select('student_id,students(id,first_name,last_name,grade,current_course)').eq('active', true),
      supabase.from('tutoring_sessions').select('id,student_id,starts_at,ends_at,status,meeting_url,students(first_name,last_name)').order('starts_at'),
      supabase.from('assignments').select('id,title,instructions,due_at,status,students(first_name,last_name)').order('created_at', { ascending: false }),
      supabase.from('student_progress').select('id,area,mastery_level,notes,recorded_at,students(first_name,last_name)').order('recorded_at', { ascending: false }),
      supabase.from('tutor_availability_rules').select('id,weekday,start_time,end_time,timezone').order('weekday').order('start_time'),
      supabase.from('tutor_unavailable_blocks').select('id,starts_at,ends_at,reason').gte('ends_at', new Date().toISOString()).order('starts_at')
    ])
    const failed = [tutor, studentAssignments, sessions, assignments, progress, availabilityRules, unavailableBlocks].find(result => result.error)
    if (failed?.error) return setError('We could not load this portal. Confirm the tutor-availability migration has been run, then try again.')
    const students = (studentAssignments.data || []).map((item: RecordItem) => ({ id: item.student_id, ...(item.students || {}) }))
    setData({ tutor: tutor.data, students, sessions: sessions.data || [], assignments: assignments.data || [], progress: progress.data || [], availability: availabilityRules.data || [], blocks: unavailableBlocks.data || [] })
    try { setCalendar(await portalRequest('/api/tutor/google-calendar/status', 'GET')) }
    catch { setCalendar({ configured: false, connected: false, connection: null, failed_events: [] }) }
  }
  useEffect(() => {
    const calendarResult = new URLSearchParams(window.location.search).get('calendar')
    if (calendarResult === 'connected') setMessage('Google Calendar connected. Future scheduled sessions were synchronized.')
    if (calendarResult === 'error') setError('Google Calendar could not be connected. Confirm the Google Cloud configuration and try again.')
    if (calendarResult) window.history.replaceState({}, '', '/tutor')
    void load()
  }, [])

  function chooseSessionToEdit(id: string) {
    const selected = data.sessions.find((item: RecordItem) => item.id === id)
    if (!selected) { setSessionEdit({ id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' }); return }
    const duration = Math.max(15, Math.round((new Date(selected.ends_at).getTime() - new Date(selected.starts_at).getTime()) / 60_000))
    setSessionEdit({ id: selected.id, starts_at: toLocalInput(selected.starts_at), duration_minutes: String(duration), meeting_url: selected.meeting_url || '', status: selected.status })
  }

  async function submit(kind: 'session' | 'session_update' | 'assignment' | 'progress' | 'note' | 'availability' | 'block', event: FormEvent) {
    event.preventDefault()
    if (!supabase || !data.tutor || busy) return
    setBusy(true); setError(''); setMessage('')
    let table = 'assignments'; let payload: RecordItem
    if (kind === 'session' || kind === 'session_update') {
      const sessionValues = kind === 'session' ? session : sessionEdit
      const startsAt = new Date(sessionValues.starts_at)
      const duration = Number(sessionValues.duration_minutes)
      if (Number.isNaN(startsAt.getTime()) || duration < 15 || duration > 240) { setBusy(false); setError('Enter a valid start time and a duration between 15 minutes and 4 hours.'); return }
      table = 'tutoring_sessions'
      payload = { starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + duration * 60_000).toISOString(), meeting_url: sessionValues.meeting_url || null, status: sessionValues.status }
      if (kind === 'session') payload = { ...payload, student_id: session.student_id, tutor_id: data.tutor.id }
    } else if (kind === 'availability') {
      table = 'tutor_availability_rules'; payload = { ...availability, weekday: Number(availability.weekday), tutor_id: data.tutor.id }
      if (availability.end_time <= availability.start_time) { setBusy(false); setError('Availability must end after it starts.'); return }
    } else if (kind === 'block') {
      table = 'tutor_unavailable_blocks'
      const startsAt = new Date(block.starts_at); const endsAt = new Date(block.ends_at)
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) { setBusy(false); setError('Enter a valid unavailable start and end time.'); return }
      payload = { tutor_id: data.tutor.id, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), reason: block.reason || null }
    } else if (kind === 'assignment') payload = { ...assignment, tutor_id: data.tutor.id, due_at: assignment.due_at ? new Date(assignment.due_at).toISOString() : null }
    else if (kind === 'progress') { table = 'student_progress'; payload = { ...progress, tutor_id: data.tutor.id, mastery_level: Number(progress.mastery_level) } }
    else { table = 'session_notes'; payload = note }
    let warning = ''
    try {
      if (kind === 'session' || kind === 'session_update') {
        const result = await portalRequest(kind === 'session' ? '/api/tutor/sessions' : `/api/tutor/sessions/${sessionEdit.id}`, kind === 'session' ? 'POST' : 'PATCH', { ...payload, mutation_id: crypto.randomUUID() })
        warning = result.warning || ''
      } else if (kind === 'note') {
        const saveResult = await supabase.rpc('save_tutoring_session_note', { note_session_id: note.session_id, private_content: note.content, family_summary: note.parent_summary || null })
        if (saveResult.error) throw new Error('The session note could not be saved. Confirm the security hardening migration has been run and try again.')
      } else {
        const saveResult = await supabase.from(table).insert(payload)
        if (saveResult.error) throw new Error('The record could not be saved. Confirm the student is actively assigned to you and try again.')
      }
    } catch (saveError) { setBusy(false); setError(saveError instanceof Error ? saveError.message : 'The record could not be saved.'); return }
    setBusy(false)
    const savedLabel = kind === 'note' ? 'Session note' : kind === 'session_update' ? 'Session changes' : kind[0].toUpperCase() + kind.slice(1)
    setMessage(warning ? `${savedLabel} saved. ${warning}` : `${savedLabel} saved${kind === 'session' || kind === 'session_update' ? ' and the family was notified' : ''}.`)
    if (kind === 'session') setSession({ student_id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' })
    if (kind === 'session_update') setSessionEdit({ id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' })
    if (kind === 'assignment') setAssignment({ student_id: '', title: '', instructions: '', due_at: '' })
    if (kind === 'progress') setProgress({ student_id: '', area: '', mastery_level: '3', notes: '' })
    if (kind === 'note') setNote({ session_id: '', content: '', parent_summary: '' })
    if (kind === 'block') setBlock({ starts_at: '', ends_at: '', reason: '' })
    await load()
  }

  async function removeAvailability(table: 'tutor_availability_rules' | 'tutor_unavailable_blocks', id: string) {
    if (!supabase || busy) return
    setBusy(true); setError(''); setMessage('')
    const result = await supabase.from(table).delete().eq('id', id)
    setBusy(false)
    if (result.error) return setError('The availability entry could not be removed.')
    setMessage('Availability updated.')
    await load()
  }

  async function connectCalendar() {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await portalRequest('/api/tutor/google-calendar/authorize', 'POST')
      window.location.assign(result.authorization_url)
    } catch (calendarError) { setBusy(false); setError(calendarError instanceof Error ? calendarError.message : 'Google Calendar authorization could not be started.') }
  }

  async function disconnectCalendar() {
    if (busy || !window.confirm('Disconnect Google Calendar? Future tutoring changes will no longer synchronize.')) return
    setBusy(true); setError(''); setMessage('')
    try {
      await portalRequest('/api/tutor/google-calendar/disconnect', 'POST')
      setMessage('Google Calendar disconnected. Existing calendar events were left unchanged.')
      await load()
    } catch (calendarError) { setError(calendarError instanceof Error ? calendarError.message : 'Google Calendar could not be disconnected.') }
    finally { setBusy(false) }
  }

  return <Shell title={`Tutor Dashboard${data.tutor ? ` — ${data.tutor.first_name}` : ''}`}>
    {error && <Notice>{error}</Notice>}{message && <Notice>{message}</Notice>}
    <div className="portal-grid">
      <List title="Sessions" items={data.sessions} render={item => <article key={item.id}><b>{displaySessionTime(item.starts_at, item.ends_at)}</b><span>{item.students?.first_name} {item.students?.last_name} · {item.status}</span>{item.meeting_url && <a href={item.meeting_url} target="_blank" rel="noreferrer">Meeting link</a>}</article>} />
      <List title="Assigned students" items={data.students} render={student => <article key={student.id}><b>{student.first_name} {student.last_name}</b><span>{student.grade || 'Grade not listed'} · {student.current_course || 'Course not listed'}</span></article>} />
    </div>
    <section className="availability-section">
      <div className="section-title"><p className="eyebrow">Calendar controls</p><h2>Your availability</h2><p>Add each weekly window when sessions may be scheduled. One-off unavailable blocks override those windows.</p></div>
      <div className="calendar-connection">
        <div><b>Google Calendar</b><span>{calendar.connected ? calendar.connection?.status === 'error' ? 'Connected · synchronization needs attention' : 'Connected · sessions synchronize automatically' : calendar.configured ? 'Not connected' : 'Available after server configuration'}</span>{calendar.connection?.last_synced_at && <small>Last synchronized {displayDate(calendar.connection.last_synced_at)}</small>}{calendar.connection?.last_error && <small className="calendar-error">{calendar.connection.last_error}</small>}</div>
        <div className="calendar-actions">{calendar.connected && calendar.connection?.status === 'error' && <button type="button" className="button" disabled={busy} onClick={() => void connectCalendar()}>Reconnect</button>}{calendar.connected ? <button type="button" className="remove-button" disabled={busy} onClick={() => void disconnectCalendar()}>Disconnect</button> : <button type="button" className="button" disabled={busy || !calendar.configured} onClick={() => void connectCalendar()}>Connect Google Calendar</button>}</div>
      </div>
      <div className="availability-grid">
        <ToolForm title="Add weekly hours" onSubmit={event => void submit('availability', event)} busy={busy}>
          <label>Day<select value={availability.weekday} onChange={event => setAvailability({ ...availability, weekday: event.target.value })}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          <label>Start time<input required type="time" value={availability.start_time} onChange={event => setAvailability({ ...availability, start_time: event.target.value })} /></label>
          <label>End time<input required type="time" value={availability.end_time} onChange={event => setAvailability({ ...availability, end_time: event.target.value })} /></label>
          <label>Time zone<input required readOnly value={availability.timezone} /></label>
        </ToolForm>
        <List title="Weekly hours" items={data.availability} render={item => <article key={item.id} className="availability-row"><div><b>{weekdays[item.weekday]}</b><span>{String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)} · {item.timezone}</span></div><button type="button" className="remove-button" disabled={busy} onClick={() => void removeAvailability('tutor_availability_rules', item.id)}>Remove</button></article>} />
        <ToolForm title="Block unavailable time" onSubmit={event => void submit('block', event)} busy={busy}>
          <label>Starts <small>Shown in {browserTimeZone}</small><input required type="datetime-local" value={block.starts_at} onChange={event => setBlock({ ...block, starts_at: event.target.value })} /></label>
          <label>Ends<input required type="datetime-local" value={block.ends_at} onChange={event => setBlock({ ...block, ends_at: event.target.value })} /></label>
          <label>Reason (optional)<input value={block.reason} maxLength={200} onChange={event => setBlock({ ...block, reason: event.target.value })} /></label>
        </ToolForm>
        <List title="Upcoming unavailable times" items={data.blocks} render={item => <article key={item.id} className="availability-row"><div><b>{displaySessionTime(item.starts_at, item.ends_at)}</b><span>{item.reason || 'Unavailable'}</span></div><button type="button" className="remove-button" disabled={busy} onClick={() => void removeAvailability('tutor_unavailable_blocks', item.id)}>Remove</button></article>} />
      </div>
    </section>
    <div className="session-tools">
      <ToolForm title="Schedule a session" onSubmit={event => void submit('session', event)} busy={busy}><p className="policy-note"><b>Scheduling policy:</b> Scheduled sessions must fit your weekly hours, avoid unavailable blocks, and not overlap another lesson.</p><StudentSelect students={data.students} value={session.student_id} onChange={value => setSession({ ...session, student_id: value })}/><label>Start date and time <small>Shown in {browserTimeZone}</small><input required type="datetime-local" value={session.starts_at} onChange={e => setSession({ ...session, starts_at: e.target.value })}/></label><label>Expected duration<select value={session.duration_minutes} onChange={e => setSession({ ...session, duration_minutes: e.target.value })}>{[30,45,60,75,90,120].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label><label>Meeting link<input type="url" placeholder="https://…" value={session.meeting_url} onChange={e => setSession({ ...session, meeting_url: e.target.value })}/></label><label>Session status<select value={session.status} onChange={e => setSession({ ...session, status: e.target.value })}>{['scheduled','completed','cancelled','no_show'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label></ToolForm>
      <ToolForm title="Edit a session" onSubmit={event => void submit('session_update', event)} busy={busy}><label>Session<select required value={sessionEdit.id} onChange={event => chooseSessionToEdit(event.target.value)}><option value="">Select one of your sessions</option>{data.sessions.map((item: RecordItem) => <option key={item.id} value={item.id}>{item.students?.first_name} — {displayDate(item.starts_at)}</option>)}</select></label><label>Start date and time <small>Shown in {browserTimeZone}</small><input required type="datetime-local" value={sessionEdit.starts_at} onChange={event => setSessionEdit({ ...sessionEdit, starts_at: event.target.value })} /></label><label>Expected duration<input required type="number" min="15" max="240" value={sessionEdit.duration_minutes} onChange={event => setSessionEdit({ ...sessionEdit, duration_minutes: event.target.value })} /></label><label>Meeting link<input type="url" value={sessionEdit.meeting_url} onChange={event => setSessionEdit({ ...sessionEdit, meeting_url: event.target.value })} /></label><label>Status<select value={sessionEdit.status} onChange={event => setSessionEdit({ ...sessionEdit, status: event.target.value })}>{['scheduled','completed','cancelled','no_show'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label></ToolForm>
    </div>
    <div className="tutor-tools"><ToolForm title="Add assignment" onSubmit={event => void submit('assignment', event)} busy={busy}><StudentSelect students={data.students} value={assignment.student_id} onChange={value => setAssignment({ ...assignment, student_id: value })}/><input required placeholder="Assignment title" value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })}/><textarea placeholder="Instructions" value={assignment.instructions} onChange={e => setAssignment({ ...assignment, instructions: e.target.value })}/><input type="datetime-local" value={assignment.due_at} onChange={e => setAssignment({ ...assignment, due_at: e.target.value })}/></ToolForm><ToolForm title="Record progress" onSubmit={event => void submit('progress', event)} busy={busy}><StudentSelect students={data.students} value={progress.student_id} onChange={value => setProgress({ ...progress, student_id: value })}/><input required placeholder="Area of study" value={progress.area} onChange={e => setProgress({ ...progress, area: e.target.value })}/><select value={progress.mastery_level} onChange={e => setProgress({ ...progress, mastery_level: e.target.value })}>{[1,2,3,4,5].map(value => <option key={value} value={value}>Mastery {value}/5</option>)}</select><textarea placeholder="Progress notes" value={progress.notes} onChange={e => setProgress({ ...progress, notes: e.target.value })}/></ToolForm><ToolForm title="Add session note" onSubmit={event => void submit('note', event)} busy={busy}><select required value={note.session_id} onChange={e => setNote({ ...note, session_id: e.target.value })}><option value="">Select a session</option>{data.sessions.map((item: RecordItem) => <option key={item.id} value={item.id}>{item.students?.first_name} {item.students?.last_name} — {displayDate(item.starts_at)}</option>)}</select><textarea required placeholder="Private tutoring note" value={note.content} onChange={e => setNote({ ...note, content: e.target.value })}/><textarea placeholder="Optional parent summary" value={note.parent_summary} onChange={e => setNote({ ...note, parent_summary: e.target.value })}/></ToolForm></div>
  </Shell>
}
function ToolForm({ title, onSubmit, busy, children }: { title: string; onSubmit: (event: FormEvent) => void; busy: boolean; children: ReactNode }) { return <form className="portal-panel tool-form" onSubmit={onSubmit}><h2>{title}</h2>{children}<button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></form> }
function StudentSelect({ students, value, onChange }: { students: RecordItem[]; value: string; onChange: (value: string) => void }) { return <label>Student<select required value={value} onChange={e => onChange(e.target.value)}><option value="">Select an assigned student</option>{students.map(student => <option key={student.id} value={student.id}>{student.first_name} {student.last_name}</option>)}</select></label> }

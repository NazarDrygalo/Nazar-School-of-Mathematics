import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from './lib/supabase'
import { navigateTo } from './routes'

type RecordItem = Record<string, any>
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time zone'
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
async function portalRequest(path: string, method: 'POST' | 'PATCH', body: RecordItem) {
  if (!supabase) throw new Error('Portal access is not configured.')
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Your session has expired. Please sign in again.')
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({ error: `The server returned an invalid response (HTTP ${response.status}).` }))
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.')
  return result
}

export function ParentDashboard() {
  const [data, setData] = useState<RecordItem>({ students: [], sessions: [], assignments: [], progress: [], requests: [] })
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const [changeRequest, setChangeRequest] = useState({ session_id: '', request_type: 'reschedule', requested_starts_at: '', reason: '' })
  async function load() {
    if (!supabase) return setError('Portal access is not configured.')
    if (!await hasPortalRole('parent')) { setError('A parent portal account is required.'); return }
    const [profile, students, sessions, assignments, progress, requests] = await Promise.all([
      supabase.from('parents').select('first_name,last_name').maybeSingle(),
      supabase.from('students').select('id,first_name,last_name,grade,current_course').order('first_name'),
      supabase.from('tutoring_sessions').select('id,starts_at,ends_at,status,meeting_url,students(first_name,last_name),tutors(first_name,last_name)').order('starts_at'),
      supabase.from('assignments').select('id,title,instructions,due_at,status,students(first_name,last_name)').order('due_at'),
      supabase.from('student_progress').select('id,area,mastery_level,notes,recorded_at,students(first_name,last_name)').order('recorded_at', { ascending: false }),
      supabase.from('session_change_requests').select('id,session_id,request_type,requested_starts_at,status,created_at,tutoring_sessions(starts_at,students(first_name,last_name))').order('created_at', { ascending: false })
    ])
    const failed = [profile, students, sessions, assignments, progress, requests].find(result => result.error)
    if (failed?.error) return setError('We could not load this portal. Confirm the session-change migration has been run, then try again.')
    setData({ profile: profile.data, students: students.data || [], sessions: sessions.data || [], assignments: assignments.data || [], progress: progress.data || [], requests: requests.data || [] })
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
  return <Shell title={`Parent Dashboard${data.profile ? ` — ${data.profile.first_name}` : ''}`}>{error && <Notice>{error}</Notice>}{message && <Notice>{message}</Notice>}<div className="portal-grid"><List title="Students" items={data.students} render={student => <article key={student.id}><b>{student.first_name} {student.last_name}</b><span>{student.grade || 'Grade not listed'} · {student.current_course || 'Current subject not listed'}</span></article>} /><List title="Upcoming sessions" items={data.sessions} render={session => <article key={session.id}><b>{displaySessionTime(session.starts_at, session.ends_at)}</b><span>{session.students?.first_name} {session.students?.last_name} · {session.status}</span>{session.meeting_url && <a href={session.meeting_url} target="_blank" rel="noreferrer">Join online session</a>}</article>} /><List title="Assignments" items={data.assignments} render={assignment => <article key={assignment.id}><b>{assignment.title}</b><span>{assignment.students?.first_name} {assignment.students?.last_name} · {assignment.status}</span><small>{assignment.instructions || 'No additional instructions.'}</small></article>} /><List title="Progress updates" items={data.progress} render={entry => <article key={entry.id}><b>{entry.area}</b><span>{entry.students?.first_name} {entry.students?.last_name} · Mastery {entry.mastery_level || '—'}/5</span><small>{entry.notes || 'No notes provided.'}</small></article>} /></div><div className="session-tools"><ToolForm title="Request a cancellation or new time" onSubmit={requestChange} busy={busy}><p className="policy-note">Please submit requests at least three days before the scheduled lesson. Requests remain pending until reviewed.</p><label>Session<select required value={changeRequest.session_id} onChange={event => setChangeRequest({ ...changeRequest, session_id: event.target.value })}><option value="">Select an eligible session</option>{eligibleSessions.map((session: RecordItem) => <option key={session.id} value={session.id}>{session.students?.first_name} — {displayDate(session.starts_at)}</option>)}</select></label><label>Request type<select value={changeRequest.request_type} onChange={event => setChangeRequest({ ...changeRequest, request_type: event.target.value, requested_starts_at: '' })}><option value="reschedule">Request a new time</option><option value="cancel">Request cancellation</option></select></label>{changeRequest.request_type === 'reschedule' && <label>Requested date and time <small>Shown in {browserTimeZone}</small><input required type="datetime-local" value={changeRequest.requested_starts_at} onChange={event => setChangeRequest({ ...changeRequest, requested_starts_at: event.target.value })} /></label>}<label>Optional note<textarea value={changeRequest.reason} onChange={event => setChangeRequest({ ...changeRequest, reason: event.target.value })} /></label></ToolForm><List title="Change requests" items={data.requests} render={request => <article key={request.id}><b>{request.request_type === 'cancel' ? 'Cancellation request' : 'New-time request'}</b><span>{request.tutoring_sessions?.students?.first_name} · {request.status}</span><small>{request.requested_starts_at ? `Requested: ${displayDate(request.requested_starts_at)}` : `Session: ${displayDate(request.tutoring_sessions?.starts_at)}`}</small></article>} /></div></Shell>
}

export function StudentDashboard() {
  const [data, setData] = useState<RecordItem>({ sessions: [], assignments: [], progress: [] }); const [error, setError] = useState('')
  useEffect(() => { void (async () => { if (!supabase) return setError('Portal access is not configured.'); if (!await hasPortalRole('student')) return setError('A student portal account is required.'); const [student, sessions, assignments, progress] = await Promise.all([supabase.from('students').select('first_name,last_name,grade,current_course').maybeSingle(), supabase.from('tutoring_sessions').select('id,starts_at,ends_at,status,meeting_url,tutors(first_name,last_name)').order('starts_at'), supabase.from('assignments').select('id,title,instructions,due_at,status').order('due_at'), supabase.from('student_progress').select('id,area,mastery_level,notes,recorded_at').order('recorded_at', { ascending: false })]); const failed = [student, sessions, assignments, progress].find(result => result.error); if (failed?.error) return setError('We could not load this portal. Please try again.'); setData({ student: student.data, sessions: sessions.data || [], assignments: assignments.data || [], progress: progress.data || [] }) })() }, [])
  return <Shell title={`Student Dashboard${data.student ? ` — ${data.student.first_name}` : ''}`}>{error && <Notice>{error}</Notice>}<div className="portal-grid"><List title="Sessions" items={data.sessions} render={session => <article key={session.id}><b>{displaySessionTime(session.starts_at, session.ends_at)}</b><span>{session.tutors?.first_name} {session.tutors?.last_name} · {session.status}</span>{session.meeting_url && <a href={session.meeting_url} target="_blank" rel="noreferrer">Join online session</a>}</article>} /><List title="Assignments" items={data.assignments} render={assignment => <article key={assignment.id}><b>{assignment.title}</b><span>{assignment.status} · {assignment.due_at ? `Due ${displayDate(assignment.due_at)}` : 'No due date'}</span><small>{assignment.instructions || 'No additional instructions.'}</small></article>} /><List title="Progress" items={data.progress} render={entry => <article key={entry.id}><b>{entry.area}</b><span>Mastery {entry.mastery_level || '—'}/5</span><small>{entry.notes || 'No notes provided.'}</small></article>} /></div></Shell>
}

export function TutorDashboard() {
  const [data, setData] = useState<RecordItem>({ students: [], sessions: [], assignments: [], progress: [] })
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const [session, setSession] = useState({ student_id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' })
  const [sessionEdit, setSessionEdit] = useState({ id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' })
  const [assignment, setAssignment] = useState({ student_id: '', title: '', instructions: '', due_at: '' })
  const [progress, setProgress] = useState({ student_id: '', area: '', mastery_level: '3', notes: '' })
  const [note, setNote] = useState({ session_id: '', content: '', parent_summary: '' })

  async function load() {
    if (!supabase) return setError('Portal access is not configured.')
    if (!await hasPortalRole('tutor')) { setError('A tutor portal account is required.'); return }
    const [tutor, studentAssignments, sessions, assignments, progress] = await Promise.all([
      supabase.from('tutors').select('id,first_name,last_name').maybeSingle(),
      supabase.from('student_tutor_assignments').select('student_id,students(id,first_name,last_name,grade,current_course)').eq('active', true),
      supabase.from('tutoring_sessions').select('id,student_id,starts_at,ends_at,status,meeting_url,students(first_name,last_name)').order('starts_at'),
      supabase.from('assignments').select('id,title,instructions,due_at,status,students(first_name,last_name)').order('created_at', { ascending: false }),
      supabase.from('student_progress').select('id,area,mastery_level,notes,recorded_at,students(first_name,last_name)').order('recorded_at', { ascending: false })
    ])
    const failed = [tutor, studentAssignments, sessions, assignments, progress].find(result => result.error)
    if (failed?.error) return setError('We could not load this portal. Confirm the secure scheduling migration has been run, then try again.')
    const students = (studentAssignments.data || []).map((item: RecordItem) => ({ id: item.student_id, ...(item.students || {}) }))
    setData({ tutor: tutor.data, students, sessions: sessions.data || [], assignments: assignments.data || [], progress: progress.data || [] })
  }
  useEffect(() => { void load() }, [])

  function chooseSessionToEdit(id: string) {
    const selected = data.sessions.find((item: RecordItem) => item.id === id)
    if (!selected) { setSessionEdit({ id: '', starts_at: '', duration_minutes: '60', meeting_url: '', status: 'scheduled' }); return }
    const duration = Math.max(15, Math.round((new Date(selected.ends_at).getTime() - new Date(selected.starts_at).getTime()) / 60_000))
    setSessionEdit({ id: selected.id, starts_at: toLocalInput(selected.starts_at), duration_minutes: String(duration), meeting_url: selected.meeting_url || '', status: selected.status })
  }

  async function submit(kind: 'session' | 'session_update' | 'assignment' | 'progress' | 'note', event: FormEvent) {
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
    } else if (kind === 'assignment') payload = { ...assignment, tutor_id: data.tutor.id, due_at: assignment.due_at ? new Date(assignment.due_at).toISOString() : null }
    else if (kind === 'progress') { table = 'student_progress'; payload = { ...progress, tutor_id: data.tutor.id, mastery_level: Number(progress.mastery_level) } }
    else { table = 'session_notes'; payload = { ...note, tutor_id: data.tutor.id, parent_summary: note.parent_summary || null } }
    let warning = ''
    try {
      if (kind === 'session' || kind === 'session_update') {
        const result = await portalRequest(kind === 'session' ? '/api/tutor/sessions' : `/api/tutor/sessions/${sessionEdit.id}`, kind === 'session' ? 'POST' : 'PATCH', { ...payload, mutation_id: crypto.randomUUID() })
        warning = result.warning || ''
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
    await load()
  }

  return <Shell title={`Tutor Dashboard${data.tutor ? ` — ${data.tutor.first_name}` : ''}`}>{error && <Notice>{error}</Notice>}{message && <Notice>{message}</Notice>}<div className="portal-grid"><List title="Sessions" items={data.sessions} render={item => <article key={item.id}><b>{displaySessionTime(item.starts_at, item.ends_at)}</b><span>{item.students?.first_name} {item.students?.last_name} · {item.status}</span>{item.meeting_url && <a href={item.meeting_url} target="_blank" rel="noreferrer">Meeting link</a>}</article>} /><List title="Assigned students" items={data.students} render={student => <article key={student.id}><b>{student.first_name} {student.last_name}</b><span>{student.grade || 'Grade not listed'} · {student.current_course || 'Course not listed'}</span></article>} /></div><div className="session-tools"><ToolForm title="Schedule a session" onSubmit={event => void submit('session', event)} busy={busy}><p className="policy-note"><b>Scheduling policy:</b> Parents should cancel or request a new time at least three days before the lesson. Session length is agreed with the parent and is commonly one hour.</p><StudentSelect students={data.students} value={session.student_id} onChange={value => setSession({ ...session, student_id: value })}/><label>Start date and time <small>Shown in {browserTimeZone}</small><input required type="datetime-local" value={session.starts_at} onChange={e => setSession({ ...session, starts_at: e.target.value })}/></label><label>Expected duration<select value={session.duration_minutes} onChange={e => setSession({ ...session, duration_minutes: e.target.value })}>{[30,45,60,75,90,120].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label><label>Meeting link<input type="url" placeholder="https://…" value={session.meeting_url} onChange={e => setSession({ ...session, meeting_url: e.target.value })}/></label><label>Session status<select value={session.status} onChange={e => setSession({ ...session, status: e.target.value })}>{['scheduled','completed','cancelled','no_show'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label></ToolForm><ToolForm title="Edit a session" onSubmit={event => void submit('session_update', event)} busy={busy}><label>Session<select required value={sessionEdit.id} onChange={event => chooseSessionToEdit(event.target.value)}><option value="">Select one of your sessions</option>{data.sessions.map((item: RecordItem) => <option key={item.id} value={item.id}>{item.students?.first_name} — {displayDate(item.starts_at)}</option>)}</select></label><label>Start date and time <small>Shown in {browserTimeZone}</small><input required type="datetime-local" value={sessionEdit.starts_at} onChange={event => setSessionEdit({ ...sessionEdit, starts_at: event.target.value })} /></label><label>Expected duration<input required type="number" min="15" max="240" value={sessionEdit.duration_minutes} onChange={event => setSessionEdit({ ...sessionEdit, duration_minutes: event.target.value })} /></label><label>Meeting link<input type="url" value={sessionEdit.meeting_url} onChange={event => setSessionEdit({ ...sessionEdit, meeting_url: event.target.value })} /></label><label>Status<select value={sessionEdit.status} onChange={event => setSessionEdit({ ...sessionEdit, status: event.target.value })}>{['scheduled','completed','cancelled','no_show'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label></ToolForm></div><div className="tutor-tools"><ToolForm title="Add assignment" onSubmit={event => void submit('assignment', event)} busy={busy}><StudentSelect students={data.students} value={assignment.student_id} onChange={value => setAssignment({ ...assignment, student_id: value })}/><input required placeholder="Assignment title" value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })}/><textarea placeholder="Instructions" value={assignment.instructions} onChange={e => setAssignment({ ...assignment, instructions: e.target.value })}/><input type="datetime-local" value={assignment.due_at} onChange={e => setAssignment({ ...assignment, due_at: e.target.value })}/></ToolForm><ToolForm title="Record progress" onSubmit={event => void submit('progress', event)} busy={busy}><StudentSelect students={data.students} value={progress.student_id} onChange={value => setProgress({ ...progress, student_id: value })}/><input required placeholder="Area of study" value={progress.area} onChange={e => setProgress({ ...progress, area: e.target.value })}/><select value={progress.mastery_level} onChange={e => setProgress({ ...progress, mastery_level: e.target.value })}>{[1,2,3,4,5].map(value => <option key={value} value={value}>Mastery {value}/5</option>)}</select><textarea placeholder="Progress notes" value={progress.notes} onChange={e => setProgress({ ...progress, notes: e.target.value })}/></ToolForm><ToolForm title="Add session note" onSubmit={event => void submit('note', event)} busy={busy}><select required value={note.session_id} onChange={e => setNote({ ...note, session_id: e.target.value })}><option value="">Select a session</option>{data.sessions.map((item: RecordItem) => <option key={item.id} value={item.id}>{item.students?.first_name} {item.students?.last_name} — {displayDate(item.starts_at)}</option>)}</select><textarea required placeholder="Private tutoring note" value={note.content} onChange={e => setNote({ ...note, content: e.target.value })}/><textarea placeholder="Optional parent summary" value={note.parent_summary} onChange={e => setNote({ ...note, parent_summary: e.target.value })}/></ToolForm></div></Shell>
}
function ToolForm({ title, onSubmit, busy, children }: { title: string; onSubmit: (event: FormEvent) => void; busy: boolean; children: ReactNode }) { return <form className="portal-panel tool-form" onSubmit={onSubmit}><h2>{title}</h2>{children}<button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></form> }
function StudentSelect({ students, value, onChange }: { students: RecordItem[]; value: string; onChange: (value: string) => void }) { return <label>Student<select required value={value} onChange={e => onChange(e.target.value)}><option value="">Select an assigned student</option>{students.map(student => <option key={student.id} value={student.id}>{student.first_name} {student.last_name}</option>)}</select></label> }

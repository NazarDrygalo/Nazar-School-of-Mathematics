import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from './lib/supabase'

type Application = {
  id: string
  created_at: string
  status: string
  notification_status: string
  accepted_email_status: string
  accepted_email_sent_at: string | null
  service_area: string
  help_areas: string
  academic_goals: string
  preferred_days: string
  preferred_times: string
  timezone: string
  parents: { id: string; auth_user_id: string | null; first_name: string; last_name: string; email: string; phone: string | null } | null
  students: { id: string; auth_user_id: string | null; active: boolean; first_name: string; last_name: string; grade: string; school: string; current_course: string } | null
}
type Tutor = { id: string; first_name: string; last_name: string; email: string; active: boolean; auth_user_id: string | null }
type TutorAssignment = { student_id: string; tutor_id: string; active: boolean }

function SetupNotice() {
  return <p className="portal-note">Portal login needs the browser-safe Supabase variables and the portal migrations. See <code>README.md</code> for the setup steps.</p>
}

export function PortalLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) { setError('Portal login is not configured yet. Add the browser-safe Supabase URL and publishable key.'); return }
    setBusy(true); setError('')
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError || !data.user) { setBusy(false); setError('We could not sign you in. Please check your email address and password.'); return }
    const { data: role, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', data.user.id).maybeSingle()
    setBusy(false)
    if (roleError || !role) { await supabase.auth.signOut(); setError('Your account is not assigned to a portal yet. Please contact the school.'); return }
    if (['admin', 'parent', 'student', 'tutor'].includes(role.role)) { location.hash = `#/${role.role}`; return }
    await supabase.auth.signOut()
    setError('Your account is not assigned to a portal yet. Please contact the school.')
  }

  return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Portal Login</h1><p>Private access for administrators, parents, students, and tutors of Nazar’s School of Mathematics.</p></div><form className="login-form" onSubmit={submit}><h2>Sign in</h2>{!supabase && <SetupNotice />}{error && <div className="form-error" role="alert">{error}</div>}<label htmlFor="portal-email">Email address</label><input id="portal-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><label htmlFor="portal-password">Password</label><input id="portal-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><button className="button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></section>
}

export function AdminDashboard() {
  const [applications, setApplications] = useState<Application[]>([])
  const [tutors, setTutors] = useState<Tutor[]>([])
  const [assignments, setAssignments] = useState<TutorAssignment[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Application | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(selectedId?: string) {
    if (!supabase) { setStatus('error'); setMessage('The administrator portal is not configured yet.'); return }
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setStatus('unauthorized'); return }
    const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', session.session.user.id).maybeSingle()
    if (role?.role !== 'admin') { await supabase.auth.signOut(); setStatus('unauthorized'); return }
    const [applicationResult, tutorResult, assignmentResult] = await Promise.all([
      supabase.from('applications').select('id, created_at, status, notification_status, accepted_email_status, accepted_email_sent_at, service_area, help_areas, academic_goals, preferred_days, preferred_times, timezone, parents(id,auth_user_id,first_name,last_name,email,phone), students(id,auth_user_id,active,first_name,last_name,grade,school,current_course)').order('created_at', { ascending: false }),
      supabase.from('tutors').select('id,first_name,last_name,email,active,auth_user_id').order('first_name'),
      supabase.from('student_tutor_assignments').select('student_id,tutor_id,active')
    ])
    const failed = [applicationResult, tutorResult, assignmentResult].find(result => result.error)
    if (failed?.error) { setStatus('error'); setMessage('Portal data could not be loaded. Confirm every migration in README.md has been run in order.'); return }
    const nextApplications = (applicationResult.data || []) as unknown as Application[]
    setApplications(nextApplications)
    setTutors((tutorResult.data || []) as Tutor[])
    setAssignments((assignmentResult.data || []) as TutorAssignment[])
    if (selectedId) setSelected(nextApplications.find(item => item.id === selectedId) || null)
    setStatus('ready')
  }
  useEffect(() => { void load() }, [])

  async function setApplicationStatus(application: Application, nextStatus: string) {
    if (!supabase || busy) return
    setBusy(true); setMessage('')
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setBusy(false); setStatus('unauthorized'); return }
    try {
      const response = await fetch(`/api/admin/applications/${application.id}/status`, { method: 'PATCH', headers: { Authorization: `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) })
      const result = await response.json().catch(() => ({ error: `The server returned an invalid response (HTTP ${response.status}).` }))
      await load(application.id)
      if (!response.ok) { setMessage(result.error || 'Status could not be updated. Please try again.'); return }
      setMessage(result.acceptanceEmail === 'sent' ? 'Application accepted and the parent acceptance email was sent.' : result.acceptanceEmail === 'already_sent' ? 'Application status updated. The acceptance email had already been sent.' : 'Application status updated.')
    } catch {
      setMessage('The status request could not reach the server. Please try again.')
    } finally { setBusy(false) }
  }

  async function activateAndAssign(application: Application, tutorId: string) {
    if (!supabase || !application.students || !tutorId || busy) return
    setBusy(true); setMessage('')
    const { error: assignmentError } = await supabase.rpc('onboard_accepted_application', { application_id: application.id, assigned_tutor_id: tutorId })
    setBusy(false)
    if (assignmentError) { setMessage('The tutor assignment could not be saved.'); return }
    await load(application.id)
    setMessage('Student activated and tutor assignment saved. Portal Auth accounts were not created.')
  }

  async function signOut() { await supabase?.auth.signOut(); location.hash = '#/portal' }
  if (status === 'loading') return <section className="portal-page"><p>Loading secure portal…</p></section>
  if (status === 'unauthorized') return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Sign in required</h1><p>Please sign in with an administrator account to review applications.</p><a className="button" href="#/portal">Portal Login</a></div></section>
  if (status === 'error') return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Portal unavailable</h1><p>{message}</p><a className="button" href="#/">Return home</a></div></section>
  return <section className="dashboard"><header className="dashboard-header"><div><p className="eyebrow">Administrator portal</p><h1>Applications</h1><p>Review applications, send acceptance notices, and prepare accepted students for tutoring.</p></div><button className="text-button" onClick={signOut}>Sign out</button></header>{message && <p className="dashboard-message" role="status">{message}</p>}<div className="application-layout"><div className="application-list">{applications.length === 0 ? <p className="empty-state">No applications have been received yet.</p> : applications.map(application => <button key={application.id} className={`application-row ${selected?.id === application.id ? 'selected' : ''}`} onClick={() => setSelected(application)}><span><b>{application.students?.first_name} {application.students?.last_name}</b><small>{application.service_area} · {application.students?.grade} · {application.students?.current_course}</small></span><span className={`status status-${application.status}`}>{application.status}</span><small>{new Date(application.created_at).toLocaleDateString()}</small></button>)}</div><ApplicationDetail key={selected?.id || 'empty'} application={selected} tutors={tutors.filter(tutor => tutor.active)} assignments={assignments} busy={busy} onStatus={setApplicationStatus} onOnboard={activateAndAssign} /></div></section>
}

function ApplicationDetail({ application, tutors, assignments, busy, onStatus, onOnboard }: { application: Application | null; tutors: Tutor[]; assignments: TutorAssignment[]; busy: boolean; onStatus: (application: Application, nextStatus: string) => Promise<void>; onOnboard: (application: Application, tutorId: string) => Promise<void> }) {
  const [tutorId, setTutorId] = useState('')
  if (!application) return <aside className="application-detail empty-state">Select an application to view its details.</aside>
  const student = application.students; const parent = application.parents
  const currentAssignment = assignments.find(item => item.student_id === student?.id && item.active)
  const currentTutor = tutors.find(tutor => tutor.id === currentAssignment?.tutor_id)
  return <aside className="application-detail"><div className="detail-top"><div><p className="eyebrow">Application detail</p><h2>{student?.first_name} {student?.last_name}</h2></div><label>Application status<select disabled={busy} value={application.status} onChange={event => void onStatus(application, event.target.value)}>{['submitted','reviewing','accepted','declined','withdrawn'].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="detail-grid"><Detail label="Tutoring area">{application.service_area}</Detail><Detail label="Student">{student?.grade}<br />{student?.school}<br />{student?.current_course}</Detail><Detail label="Parent / guardian">{parent?.first_name} {parent?.last_name}<br /><a href={`mailto:${parent?.email}`}>{parent?.email}</a><br />{parent?.phone || 'No phone provided'}</Detail><Detail label="Areas needing help">{application.help_areas}</Detail><Detail label="Academic goals">{application.academic_goals}</Detail><Detail label="Availability">{application.preferred_days}<br />{application.preferred_times}<br />{application.timezone}</Detail><Detail label="Application receipt">{application.notification_status}</Detail><Detail label="Acceptance email">{application.accepted_email_sent_at ? `Sent ${new Date(application.accepted_email_sent_at).toLocaleString()}` : application.accepted_email_status.replace('_', ' ')}</Detail></div>{application.status === 'accepted' && <section className="onboarding-panel"><h3>Accepted-family onboarding</h3><p>Activating a student and assigning a tutor makes the student available in that tutor’s scheduling tools. It does not create an Auth account.</p><p className="onboarding-state"><b>Student:</b> {student?.active ? 'Active' : 'Not active'} · <b>Tutor:</b> {currentTutor ? `${currentTutor.first_name} ${currentTutor.last_name}` : 'Not assigned'}</p><label htmlFor="onboarding-tutor">Assigned tutor</label><select id="onboarding-tutor" value={tutorId || currentAssignment?.tutor_id || ''} onChange={event => setTutorId(event.target.value)}><option value="">Select an active tutor</option>{tutors.map(tutor => <option key={tutor.id} value={tutor.id}>{tutor.first_name} {tutor.last_name}</option>)}</select><button className="button" disabled={busy || !(tutorId || currentAssignment?.tutor_id)} onClick={() => void onOnboard(application, tutorId || currentAssignment?.tutor_id || '')}>{busy ? 'Saving…' : 'Activate and assign tutor'}</button><div className="manual-steps"><b>Portal account checklist</b><ol><li>Invite only the accepted parent and/or student from Supabase Authentication.</li><li>Link the Auth UUID to the parent or student record.</li><li>Add the matching <code>user_roles</code> row using the SQL pattern in README.md.</li></ol><small>Parent Auth: {parent?.auth_user_id ? 'linked' : 'not linked'} · Student Auth: {student?.auth_user_id ? 'linked' : 'not linked'}</small></div></section>}</aside>
}
function Detail({ label, children }: { label: string; children: ReactNode }) { return <div><b>{label}</b><p>{children}</p></div> }

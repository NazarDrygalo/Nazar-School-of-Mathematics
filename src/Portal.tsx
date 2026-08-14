import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from './lib/supabase'
import { navigateTo, type Page } from './routes'

type Application = {
  id: string
  created_at: string
  status: string
  notification_status: string
  notification_error: string | null
  accepted_email_status: string
  accepted_email_sent_at: string | null
  accepted_email_error: string | null
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
type SessionItem = { id: string; starts_at: string; ends_at: string; status: string; meeting_url: string | null; students: { first_name: string; last_name: string } | null; tutors: { first_name: string; last_name: string } | null }
type ChangeRequest = { id: string; request_type: string; requested_starts_at: string | null; reason: string | null; status: string; created_at: string; tutoring_sessions: { starts_at: string; students: { first_name: string; last_name: string } | null; tutors: { first_name: string; last_name: string } | null } | null }
type NotificationDelivery = { id: string; event_type: string; recipient_role: string; recipient_email: string; status: string; attempted_at: string; sent_at: string | null; error: string | null }
type AdminFilters = { search: string; status: string; service: string; attention: 'all' | 'delivery' | 'onboarding' | 'unlinked' }
const portalDate = (value: string) => new Date(value).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

function hasDeliveryIssue(application: Application) {
  return application.notification_status === 'failed' || application.accepted_email_status === 'failed'
}

function hasActiveAssignment(application: Application, assignments: TutorAssignment[]) {
  return Boolean(application.students && assignments.some(item => item.student_id === application.students?.id && item.active))
}

function needsOnboarding(application: Application, assignments: TutorAssignment[]) {
  return application.status === 'accepted' && (!application.students?.active || !hasActiveAssignment(application, assignments))
}

function lacksPortalAccess(application: Application) {
  return application.status === 'accepted' && !application.parents?.auth_user_id && !application.students?.auth_user_id
}

function SetupNotice() {
  return <p className="portal-note">Portal login needs the browser-safe Supabase variables and the portal migrations. See <code>README.md</code> for the setup steps.</p>
}

export function PortalLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'signin' | 'reset-request' | 'update-password'>(() => location.hash.includes('type=recovery') ? 'update-password' : 'signin')

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') setMode('update-password') })
    return () => data.subscription.unsubscribe()
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) { setError('Portal login is not configured yet. Add the browser-safe Supabase URL and publishable key.'); return }
    setBusy(true); setError(''); setMessage('')
    if (mode === 'reset-request') {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` })
      setBusy(false)
      if (resetError) { setError('We could not send a password-reset email. Confirm the address and try again.'); return }
      setMessage('If this email belongs to a portal account, a password-reset link has been sent.'); return
    }
    if (mode === 'update-password') {
      if (password.length < 10 || password !== confirmPassword) { setBusy(false); setError('Use at least 10 characters and make sure both password entries match.'); return }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      setBusy(false)
      if (updateError) { setError('The password could not be updated. Request a new reset link and try again.'); return }
      await supabase.auth.signOut(); setPassword(''); setConfirmPassword(''); setMode('signin'); setMessage('Password updated. Sign in with your new password.'); navigateTo('portal'); return
    }
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError || !data.user) { setBusy(false); setError('We could not sign you in. Please check your email address and password.'); return }
    const { data: role, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', data.user.id).maybeSingle()
    setBusy(false)
    if (roleError || !role) { await supabase.auth.signOut(); setError('Your account is not assigned to a portal yet. Please contact the school.'); return }
    if (['admin', 'parent', 'student', 'tutor'].includes(role.role)) { navigateTo(role.role as Page); return }
    await supabase.auth.signOut()
    setError('Your account is not assigned to a portal yet. Please contact the school.')
  }

  const title = mode === 'signin' ? 'Sign in' : mode === 'reset-request' ? 'Reset your password' : 'Choose a new password'
  return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Portal Login</h1><p>Private access for administrators, parents, students, and tutors of Nazar’s School of Mathematics.</p></div><form className="login-form" onSubmit={submit}><h2>{title}</h2>{!supabase && <SetupNotice />}{error && <div className="form-error" role="alert">{error}</div>}{message && <p className="dashboard-message" role="status">{message}</p>}{mode !== 'update-password' && <><label htmlFor="portal-email">Email address</label><input id="portal-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></>}{mode !== 'reset-request' && <><label htmlFor="portal-password">{mode === 'signin' ? 'Password' : 'New password'}</label><input id="portal-password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signin' ? undefined : 10} required value={password} onChange={e => setPassword(e.target.value)} /></>}{mode === 'update-password' && <><label htmlFor="portal-password-confirm">Confirm new password</label><input id="portal-password-confirm" type="password" autoComplete="new-password" minLength={10} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></>}<button className="button" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'reset-request' ? 'Send reset link' : 'Update password'}</button>{mode === 'signin' ? <button type="button" className="text-button" onClick={() => { setMode('reset-request'); setError(''); setMessage('') }}>Forgot your password?</button> : mode === 'reset-request' && <button type="button" className="text-button" onClick={() => { setMode('signin'); setError(''); setMessage('') }}>Return to sign in</button>}</form></section>
}

export function AdminDashboard() {
  const [applications, setApplications] = useState<Application[]>([])
  const [tutors, setTutors] = useState<Tutor[]>([])
  const [assignments, setAssignments] = useState<TutorAssignment[]>([])
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([])
  const [notificationDeliveries, setNotificationDeliveries] = useState<NotificationDelivery[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Application | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTutor, setNewTutor] = useState({ first_name: '', last_name: '', email: '' })
  const [filters, setFilters] = useState<AdminFilters>({ search: '', status: 'all', service: 'all', attention: 'all' })

  async function load(selectedId?: string) {
    if (!supabase) { setStatus('error'); setMessage('The administrator portal is not configured yet.'); return }
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setStatus('unauthorized'); return }
    const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', session.session.user.id).maybeSingle()
    if (role?.role !== 'admin') { await supabase.auth.signOut(); setStatus('unauthorized'); return }
    const [applicationResult, tutorResult, assignmentResult, sessionResult, requestResult, deliveryResult] = await Promise.all([
      supabase.from('applications').select('id, created_at, status, notification_status, notification_error, accepted_email_status, accepted_email_sent_at, accepted_email_error, service_area, help_areas, academic_goals, preferred_days, preferred_times, timezone, parents(id,auth_user_id,first_name,last_name,email,phone), students(id,auth_user_id,active,first_name,last_name,grade,school,current_course)').order('created_at', { ascending: false }),
      supabase.from('tutors').select('id,first_name,last_name,email,active,auth_user_id').order('first_name'),
      supabase.from('student_tutor_assignments').select('student_id,tutor_id,active'),
      supabase.from('tutoring_sessions').select('id,starts_at,ends_at,status,meeting_url,students(first_name,last_name),tutors(first_name,last_name)').order('starts_at'),
      supabase.from('session_change_requests').select('id,request_type,requested_starts_at,reason,status,created_at,tutoring_sessions(starts_at,students(first_name,last_name),tutors(first_name,last_name))').order('created_at', { ascending: false }),
      supabase.from('notification_deliveries').select('id,event_type,recipient_role,recipient_email,status,attempted_at,sent_at,error').eq('status', 'failed').order('attempted_at', { ascending: false })
    ])
    const failed = [applicationResult, tutorResult, assignmentResult, sessionResult, requestResult, deliveryResult].find(result => result.error)
    if (failed?.error) { setStatus('error'); setMessage('Portal data could not be loaded. Confirm every migration in README.md has been run in order.'); return }
    const nextApplications = (applicationResult.data || []) as unknown as Application[]
    setApplications(nextApplications)
    setTutors((tutorResult.data || []) as Tutor[])
    setAssignments((assignmentResult.data || []) as TutorAssignment[])
    setSessions((sessionResult.data || []) as unknown as SessionItem[])
    setChangeRequests((requestResult.data || []) as unknown as ChangeRequest[])
    setNotificationDeliveries((deliveryResult.data || []) as NotificationDelivery[])
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

  async function resolveChangeRequest(requestId: string, resolution: 'approved' | 'declined') {
    if (!supabase || busy) return
    setBusy(true); setMessage('')
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setBusy(false); setStatus('unauthorized'); return }
    try {
      const response = await fetch(`/api/admin/session-change-requests/${requestId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution }) })
      const result = await response.json().catch(() => ({ error: `The server returned an invalid response (HTTP ${response.status}).` }))
      if (!response.ok) { setMessage(result.error || 'The session request could not be resolved.'); return }
      await load(selected?.id)
      setMessage(result.warning ? `Session change request ${resolution}. ${result.warning}` : `Session change request ${resolution}; the family and tutor were notified.`)
    } catch { setMessage('The session request could not reach the server. Please try again.') }
    finally { setBusy(false) }
  }

  async function createTutor(event: FormEvent) {
    event.preventDefault(); if (!supabase || busy) return
    setBusy(true); setMessage('')
    const { error } = await supabase.from('tutors').insert({ first_name: newTutor.first_name.trim(), last_name: newTutor.last_name.trim(), email: newTutor.email.trim().toLowerCase(), active: true })
    setBusy(false)
    if (error) { setMessage('The tutor record could not be created. Confirm the email is unique and the tutor-management migration has been run.'); return }
    setNewTutor({ first_name: '', last_name: '', email: '' }); await load(selected?.id); setMessage('Active tutor record created. No Auth invitation was sent.')
  }

  async function setTutorActive(tutor: Tutor, active: boolean) {
    if (!supabase || busy) return
    setBusy(true); setMessage('')
    const { error } = await supabase.from('tutors').update({ active }).eq('id', tutor.id)
    setBusy(false)
    if (error) { setMessage('The tutor status could not be updated.'); return }
    await load(selected?.id); setMessage(`Tutor marked ${active ? 'active' : 'inactive'}.`)
  }

  async function signOut() { await supabase?.auth.signOut(); navigateTo('portal') }
  const pendingRequests = changeRequests.filter(request => request.status === 'pending').length
  const applicationDeliveryIssues = applications.filter(hasDeliveryIssue).length
  const workflowDeliveryIssues = notificationDeliveries.filter(delivery => delivery.status === 'failed').length
  const deliveryIssues = applicationDeliveryIssues + workflowDeliveryIssues
  const onboardingNeeded = applications.filter(application => needsOnboarding(application, assignments)).length
  const unlinkedFamilies = applications.filter(lacksPortalAccess).length
  const reviewNeeded = applications.filter(application => ['submitted', 'reviewing'].includes(application.status)).length
  const services = [...new Set(applications.map(application => application.service_area))].sort()
  const query = filters.search.trim().toLowerCase()
  const filteredApplications = applications.filter(application => {
    const searchable = [application.students?.first_name, application.students?.last_name, application.parents?.first_name, application.parents?.last_name, application.parents?.email, application.students?.grade, application.students?.current_course, application.service_area].filter(Boolean).join(' ').toLowerCase()
    if (query && !searchable.includes(query)) return false
    if (filters.status !== 'all' && application.status !== filters.status) return false
    if (filters.service !== 'all' && application.service_area !== filters.service) return false
    if (filters.attention === 'delivery' && !hasDeliveryIssue(application)) return false
    if (filters.attention === 'onboarding' && !needsOnboarding(application, assignments)) return false
    if (filters.attention === 'unlinked' && !lacksPortalAccess(application)) return false
    return true
  })
  const visibleSelection = selected && filteredApplications.some(application => application.id === selected.id) ? selected : null
  const hasFilters = Boolean(filters.search || filters.status !== 'all' || filters.service !== 'all' || filters.attention !== 'all')
  if (status === 'loading') return <section className="portal-page"><p>Loading secure portal…</p></section>
  if (status === 'unauthorized') return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Sign in required</h1><p>Please sign in with an administrator account to review applications.</p><a className="button" href="/portal">Portal Login</a></div></section>
  if (status === 'error') return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Portal unavailable</h1><p>{message}</p><a className="button" href="/">Return home</a></div></section>
  return <section className="dashboard"><header className="dashboard-header"><div><p className="eyebrow">Administrator portal</p><h1>Operations overview</h1><p>Review applications, resolve family requests, and prepare accepted students for tutoring.</p></div><button className="text-button" onClick={signOut}>Sign out</button></header>{message && <p className="dashboard-message" role="status">{message}</p>}<section className="admin-summary" aria-label="Administrator action summary"><SummaryCard label="Needs review" value={reviewNeeded} detail="Submitted or under review" /><SummaryCard label="Onboarding needed" value={onboardingNeeded} detail="Accepted but not fully assigned" tone={onboardingNeeded ? 'attention' : 'default'} /><SummaryCard label="Pending requests" value={pendingRequests} detail="Cancellation or new-time requests" tone={pendingRequests ? 'attention' : 'default'} /><SummaryCard label="Delivery issues" value={deliveryIssues} detail="Application and workflow emails" tone={deliveryIssues ? 'danger' : 'default'} /><SummaryCard label="No portal access" value={unlinkedFamilies} detail="Accepted families with no linked login" tone={unlinkedFamilies ? 'attention' : 'default'} /></section>{deliveryIssues > 0 && <div className="admin-alert" role="alert"><div><b>Email delivery needs attention</b><span>{deliveryIssues} email delivery record{deliveryIssues === 1 ? '' : 's'} failed. Details appear below and on affected applications.</span></div>{applicationDeliveryIssues > 0 && <button onClick={() => setFilters(current => ({ ...current, attention: 'delivery' }))}>Show affected applications</button>}</div>}<NotificationDeliveryPanel deliveries={notificationDeliveries} /><section className="application-workspace"><div className="section-title"><p className="eyebrow">Application management</p><h2>Find and review applications</h2></div><div className="admin-filters"><label>Search<input type="search" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} placeholder="Student, parent, email, or course" /></label><label>Status<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="all">All statuses</option>{['submitted','reviewing','accepted','declined','withdrawn'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Subject<select value={filters.service} onChange={event => setFilters({ ...filters, service: event.target.value })}><option value="all">All subjects</option>{services.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Needs attention<select value={filters.attention} onChange={event => setFilters({ ...filters, attention: event.target.value as AdminFilters['attention'] })}><option value="all">All applications</option><option value="delivery">Email delivery issue</option><option value="onboarding">Onboarding incomplete</option><option value="unlinked">No portal access</option></select></label>{hasFilters && <button className="filter-clear" onClick={() => setFilters({ search: '', status: 'all', service: 'all', attention: 'all' })}>Clear filters</button>}</div><p className="filter-result" role="status">Showing {filteredApplications.length} of {applications.length} applications</p><div className="application-layout"><div className="application-list">{applications.length === 0 ? <p className="empty-state">No applications have been received yet.</p> : filteredApplications.length === 0 ? <p className="empty-state">No applications match these filters.</p> : filteredApplications.map(application => <button key={application.id} className={`application-row ${visibleSelection?.id === application.id ? 'selected' : ''}`} onClick={() => setSelected(application)}><span><b>{application.students?.first_name} {application.students?.last_name}</b><small>{application.parents?.first_name} {application.parents?.last_name} · {application.parents?.email}</small><small>{application.service_area} · {application.students?.grade} · {application.students?.current_course}</small></span><span className={`status status-${application.status}`}>{application.status}</span><small>{new Date(application.created_at).toLocaleDateString()}</small>{hasDeliveryIssue(application) && <small className="row-alert">Email issue</small>}{needsOnboarding(application, assignments) && <small className="row-alert row-alert-neutral">Onboarding</small>}</button>)}</div><ApplicationDetail key={visibleSelection?.id || 'empty'} application={visibleSelection} tutors={tutors.filter(tutor => tutor.active)} assignments={assignments} busy={busy} onStatus={setApplicationStatus} onOnboard={activateAndAssign} /></div></section><SessionAdministration sessions={sessions} requests={changeRequests} busy={busy} onResolve={resolveChangeRequest} /><TutorAdministration tutors={tutors} newTutor={newTutor} setNewTutor={setNewTutor} busy={busy} onCreate={createTutor} onSetActive={setTutorActive} /></section>
}

function SummaryCard({ label, value, detail, tone = 'default' }: { label: string; value: number; detail: string; tone?: 'default' | 'attention' | 'danger' }) {
  return <article className={`summary-card summary-${tone}`}><span>{label}</span><b>{value}</b><small>{detail}</small></article>
}

function NotificationDeliveryPanel({ deliveries }: { deliveries: NotificationDelivery[] }) {
  const failed = deliveries.filter(delivery => delivery.status === 'failed')
  if (!failed.length) return null
  return <section className="delivery-issues-panel"><div><p className="eyebrow">Workflow email delivery</p><h2>Messages requiring attention</h2></div><div className="delivery-issue-list">{failed.map(delivery => <article key={delivery.id}><div><b>{delivery.event_type.replace(/_/g, ' ')}</b><span>{delivery.recipient_role} · {delivery.recipient_email}</span></div><div><small>{new Date(delivery.attempted_at).toLocaleString()}</small><small>{delivery.error || 'Delivery failed without a provider message.'}</small></div></article>)}</div></section>
}

function ApplicationDetail({ application, tutors, assignments, busy, onStatus, onOnboard }: { application: Application | null; tutors: Tutor[]; assignments: TutorAssignment[]; busy: boolean; onStatus: (application: Application, nextStatus: string) => Promise<void>; onOnboard: (application: Application, tutorId: string) => Promise<void> }) {
  const [tutorId, setTutorId] = useState('')
  if (!application) return <aside className="application-detail empty-state">Select an application to view its details.</aside>
  const student = application.students; const parent = application.parents
  const currentAssignment = assignments.find(item => item.student_id === student?.id && item.active)
  const currentTutor = tutors.find(tutor => tutor.id === currentAssignment?.tutor_id)
  return <aside className="application-detail"><div className="detail-top"><div><p className="eyebrow">Application detail</p><h2>{student?.first_name} {student?.last_name}</h2></div><label>Application status<select disabled={busy} value={application.status} onChange={event => void onStatus(application, event.target.value)}>{['submitted','reviewing','accepted','declined','withdrawn'].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="detail-grid"><Detail label="Tutoring area">{application.service_area}</Detail><Detail label="Student">{student?.grade}<br />{student?.school}<br />{student?.current_course}</Detail><Detail label="Parent / guardian">{parent?.first_name} {parent?.last_name}<br /><a href={`mailto:${parent?.email}`}>{parent?.email}</a><br />{parent?.phone || 'No phone provided'}</Detail><Detail label="Areas needing help">{application.help_areas}</Detail><Detail label="Academic goals">{application.academic_goals}</Detail><Detail label="Availability">{application.preferred_days}<br />{application.preferred_times}<br />{application.timezone}</Detail></div><section className="delivery-panel"><h3>Delivery and account status</h3><div className="delivery-grid"><StatusLine label="School notification" state={application.notification_status} detail={application.notification_error} /><StatusLine label="Acceptance email" state={application.accepted_email_sent_at ? 'sent' : application.accepted_email_status} detail={application.accepted_email_sent_at ? `Sent ${new Date(application.accepted_email_sent_at).toLocaleString()}` : application.accepted_email_error} /><StatusLine label="Parent portal" state={parent?.auth_user_id ? 'linked' : 'not linked'} /><StatusLine label="Student portal" state={student?.auth_user_id ? 'linked' : 'not linked'} /></div></section>{application.status === 'accepted' && <section className="onboarding-panel"><h3>Accepted-family onboarding</h3><p>Activating a student and assigning a tutor makes the student available in that tutor’s scheduling tools. It does not create an Auth account.</p><div className="onboarding-checks"><StatusLine label="Student record" state={student?.active ? 'active' : 'not active'} /><StatusLine label="Tutor assignment" state={currentTutor ? `${currentTutor.first_name} ${currentTutor.last_name}` : 'not assigned'} /></div><label htmlFor="onboarding-tutor">Assigned tutor</label><select id="onboarding-tutor" value={tutorId || currentAssignment?.tutor_id || ''} onChange={event => setTutorId(event.target.value)}><option value="">Select an active tutor</option>{tutors.map(tutor => <option key={tutor.id} value={tutor.id}>{tutor.first_name} {tutor.last_name}</option>)}</select><button className="button" disabled={busy || !(tutorId || currentAssignment?.tutor_id)} onClick={() => void onOnboard(application, tutorId || currentAssignment?.tutor_id || '')}>{busy ? 'Saving…' : 'Activate and assign tutor'}</button><div className="manual-steps"><b>Portal account checklist</b><ol><li>Invite only the accepted parent and/or student from Supabase Authentication.</li><li>Link the Auth UUID to the parent or student record.</li><li>Add the matching <code>user_roles</code> row using the SQL pattern in README.md.</li></ol><small>A student login is optional when only the parent needs portal access.</small></div></section>}</aside>
}
function Detail({ label, children }: { label: string; children: ReactNode }) { return <div><b>{label}</b><p>{children}</p></div> }
function StatusLine({ label, state, detail }: { label: string; state: string; detail?: string | null }) {
  const normalized = state.toLowerCase().replace(/_/g, ' ')
  const good = ['sent', 'linked', 'active'].includes(normalized) || (!normalized.startsWith('not ') && !['failed', 'pending', 'sending'].includes(normalized))
  const danger = normalized === 'failed'
  return <div className="status-line"><span>{label}</span><b className={`state-pill ${danger ? 'state-danger' : good ? 'state-good' : 'state-neutral'}`}>{normalized}</b>{detail && <small>{detail}</small>}</div>
}

function SessionAdministration({ sessions, requests, busy, onResolve }: { sessions: SessionItem[]; requests: ChangeRequest[]; busy: boolean; onResolve: (id: string, resolution: 'approved' | 'declined') => Promise<void> }) {
  return <section className="admin-sessions"><div className="section-title"><p className="eyebrow">Scheduling</p><h2>Sessions and family requests</h2></div><div className="session-tools"><section className="portal-panel"><h3>All sessions</h3><div className="portal-list">{sessions.length ? sessions.map(session => <article key={session.id}><b>{portalDate(session.starts_at)}</b><span>{session.students?.first_name} {session.students?.last_name} · {session.tutors?.first_name} {session.tutors?.last_name}</span><small>{session.status}</small></article>) : <p className="empty-state">No sessions have been scheduled.</p>}</div></section><section className="portal-panel"><h3>Change requests</h3><div className="portal-list">{requests.length ? requests.map(request => <article key={request.id}><b>{request.request_type === 'cancel' ? 'Cancellation' : 'New-time request'} · {request.status}</b><span>{request.tutoring_sessions?.students?.first_name} {request.tutoring_sessions?.students?.last_name} · {portalDate(request.tutoring_sessions?.starts_at || request.created_at)}</span>{request.requested_starts_at && <small>Requested: {portalDate(request.requested_starts_at)}</small>}{request.reason && <small>{request.reason}</small>}{request.status === 'pending' && <span className="request-actions"><button disabled={busy} onClick={() => void onResolve(request.id, 'approved')}>Approve</button><button disabled={busy} onClick={() => void onResolve(request.id, 'declined')}>Decline</button></span>}</article>) : <p className="empty-state">No session changes have been requested.</p>}</div></section></div></section>
}

function TutorAdministration({ tutors, newTutor, setNewTutor, busy, onCreate, onSetActive }: { tutors: Tutor[]; newTutor: { first_name: string; last_name: string; email: string }; setNewTutor: (value: { first_name: string; last_name: string; email: string }) => void; busy: boolean; onCreate: (event: FormEvent) => Promise<void>; onSetActive: (tutor: Tutor, active: boolean) => Promise<void> }) {
  return <section className="admin-sessions"><div className="section-title"><p className="eyebrow">Tutor administration</p><h2>Operational tutor records</h2><p>Create records only for active tutors. Supabase Auth invitations and UUID linking remain separate, deliberate steps.</p></div><div className="session-tools"><form className="portal-panel tool-form" onSubmit={event => void onCreate(event)}><h3>Add an active tutor</h3><label>First name<input required value={newTutor.first_name} onChange={event => setNewTutor({ ...newTutor, first_name: event.target.value })} /></label><label>Last name<input required value={newTutor.last_name} onChange={event => setNewTutor({ ...newTutor, last_name: event.target.value })} /></label><label>Email address<input required type="email" value={newTutor.email} onChange={event => setNewTutor({ ...newTutor, email: event.target.value })} /></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Create tutor record'}</button></form><section className="portal-panel"><h3>Existing tutors</h3><div className="portal-list">{tutors.length ? tutors.map(tutor => <article key={tutor.id}><b>{tutor.first_name} {tutor.last_name}</b><span>{tutor.email}</span><small>{tutor.active ? 'Active' : 'Inactive'} · Auth {tutor.auth_user_id ? 'linked' : 'not linked'}</small><span className="request-actions"><button disabled={busy || tutor.active} onClick={() => void onSetActive(tutor, true)}>Activate</button><button disabled={busy || !tutor.active} onClick={() => void onSetActive(tutor, false)}>Deactivate</button></span></article>) : <p className="empty-state">No tutors have been created.</p>}</div></section></div></section>
}

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from './lib/supabase'

type Application = {
  id: string
  created_at: string
  status: string
  notification_status: string
  help_areas: string
  academic_goals: string
  preferred_days: string
  preferred_times: string
  timezone: string
  parents: { first_name: string; last_name: string; email: string; phone: string | null } | null
  students: { first_name: string; last_name: string; grade: string; school: string; current_course: string } | null
}

function SetupNotice() {
  return <p className="portal-note">Portal login needs the browser-safe Supabase variables and the admin portal migration. See <code>README.md</code> for the setup steps.</p>
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
    if (role.role === 'admin') { location.hash = '#/admin'; return }
    await supabase.auth.signOut()
    setError(`The ${role.role} portal is planned for after launch. This account cannot access the administrator portal.`)
  }

  return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Portal Login</h1><p>Administrative access for Nazar’s School of Mathematics. Parent, student, and tutor portals will be introduced as the service grows.</p></div><form className="login-form" onSubmit={submit}><h2>Sign in</h2>{!supabase && <SetupNotice />}{error && <div className="form-error" role="alert">{error}</div>}<label htmlFor="portal-email">Email address</label><input id="portal-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><label htmlFor="portal-password">Password</label><input id="portal-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><button className="button" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button></form></section>
}

export function AdminDashboard() {
  const [applications, setApplications] = useState<Application[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Application | null>(null)

  async function load() {
    if (!supabase) { setStatus('error'); setMessage('The administrator portal is not configured yet.'); return }
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setStatus('unauthorized'); return }
    const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', session.session.user.id).maybeSingle()
    if (role?.role !== 'admin') { await supabase.auth.signOut(); setStatus('unauthorized'); return }
    const { data, error } = await supabase.from('applications').select('id, created_at, status, notification_status, help_areas, academic_goals, preferred_days, preferred_times, timezone, parents(first_name,last_name,email,phone), students(first_name,last_name,grade,school,current_course)').order('created_at', { ascending: false })
    if (error) { setStatus('error'); setMessage('Applications could not be loaded. Confirm the admin portal migration has been run.'); return }
    setApplications((data || []) as unknown as Application[]); setStatus('ready')
  }
  useEffect(() => { void load() }, [])
  async function setApplicationStatus(application: Application, nextStatus: string) {
    if (!supabase) return
    const { error } = await supabase.from('applications').update({ status: nextStatus }).eq('id', application.id)
    if (error) { setMessage('Status could not be updated. Please try again.'); return }
    const updated = { ...application, status: nextStatus }
    setApplications(items => items.map(item => item.id === updated.id ? updated : item)); setSelected(updated); setMessage('Application status updated.')
  }
  async function signOut() { await supabase?.auth.signOut(); location.hash = '#/portal' }

  if (status === 'loading') return <section className="portal-page"><p>Loading secure portal...</p></section>
  if (status === 'unauthorized') return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Sign in required</h1><p>Please sign in with an administrator account to review applications.</p><a className="button" href="#/portal">Portal Login</a></div></section>
  if (status === 'error') return <section className="portal-page"><div className="portal-intro"><p className="eyebrow">Secure portal</p><h1>Portal unavailable</h1><p>{message}</p><a className="button" href="#/">Return home</a></div></section>
  return <section className="dashboard"><header className="dashboard-header"><div><p className="eyebrow">Administrator portal</p><h1>Applications</h1><p>Review incoming tutoring applications and keep their status current.</p></div><button className="text-button" onClick={signOut}>Sign out</button></header>{message && <p className="dashboard-message" role="status">{message}</p>}<div className="application-layout"><div className="application-list">{applications.length === 0 ? <p className="empty-state">No applications have been received yet.</p> : applications.map(application => <button key={application.id} className={`application-row ${selected?.id === application.id ? 'selected' : ''}`} onClick={() => setSelected(application)}><span><b>{application.students?.first_name} {application.students?.last_name}</b><small>{application.students?.grade} · {application.students?.current_course}</small></span><span className={`status status-${application.status}`}>{application.status}</span><small>{new Date(application.created_at).toLocaleDateString()}</small></button>)}</div><ApplicationDetail application={selected} onStatus={setApplicationStatus} /></div></section>
}

function ApplicationDetail({ application, onStatus }: { application: Application | null; onStatus: (application: Application, nextStatus: string) => void }) {
  if (!application) return <aside className="application-detail empty-state">Select an application to view its details.</aside>
  const student = application.students; const parent = application.parents
  return <aside className="application-detail"><div className="detail-top"><div><p className="eyebrow">Application detail</p><h2>{student?.first_name} {student?.last_name}</h2></div><label>Application status<select value={application.status} onChange={event => onStatus(application, event.target.value)}>{['submitted','reviewing','accepted','declined','withdrawn'].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="detail-grid"><Detail label="Student">{student?.grade}<br />{student?.school}<br />{student?.current_course}</Detail><Detail label="Parent / guardian">{parent?.first_name} {parent?.last_name}<br /><a href={`mailto:${parent?.email}`}>{parent?.email}</a><br />{parent?.phone || 'No phone provided'}</Detail><Detail label="Areas needing help">{application.help_areas}</Detail><Detail label="Academic goals">{application.academic_goals}</Detail><Detail label="Availability">{application.preferred_days}<br />{application.preferred_times}<br />{application.timezone}</Detail><Detail label="Notification">{application.notification_status}</Detail></div></aside>
}
function Detail({ label, children }: { label: string; children: ReactNode }) { return <div><b>{label}</b><p>{children}</p></div> }

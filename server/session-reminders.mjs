import { createSupabaseAdminClient, isSupabaseConfigured } from './supabase.mjs'
import { sendTrackedEmail } from './workflow-notifications.mjs'

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character])
const sessionTime = value => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) + ' Eastern Time'
const relation = value => Array.isArray(value) ? value[0] : value

export function buildSessionReminderEmail({ session, student, tutor, recipientRole, recipientFirstName }) {
  const studentName = `${student.first_name} ${String(student.last_name || '').slice(0, 1)}.`
  const tutorName = `${tutor.first_name} ${tutor.last_name}`
  const when = sessionTime(session.starts_at)
  const portal = recipientRole === 'parent' ? 'parent' : recipientRole === 'student' ? 'student' : 'tutor'
  const meetingText = session.meeting_url ? `\nMeeting link: ${session.meeting_url}` : ''
  const meetingHtml = session.meeting_url ? `<br><strong>Meeting link:</strong> <a href="${escapeHtml(session.meeting_url)}">Open meeting</a>` : ''
  return {
    subject: `Tutoring session reminder | ${studentName}`,
    text: `Hello ${recipientFirstName},\n\nThis is a reminder that the tutoring session for ${studentName} is scheduled for approximately one day from now.\n\nTime: ${when}\nTutor: ${tutorName}${meetingText}\n\nPlease review the ${portal} portal for the current schedule.\n\nNazar's School of Mathematics`,
    html: `<p>Hello ${escapeHtml(recipientFirstName)},</p><p>This is a reminder that the tutoring session for <strong>${escapeHtml(studentName)}</strong> is scheduled for approximately one day from now.</p><p><strong>Time:</strong> ${escapeHtml(when)}<br><strong>Tutor:</strong> ${escapeHtml(tutorName)}${meetingHtml}</p><p>Please review the ${escapeHtml(portal)} portal for the current schedule.</p><p>Nazar's School of Mathematics</p>`
  }
}

export async function sendDueSessionReminders(now = new Date()) {
  if (!isSupabaseConfigured()) throw Object.assign(new Error('Session reminders are not configured.'), { status: 503 })
  const supabase = createSupabaseAdminClient()
  const startsAfter = now.toISOString()
  const startsBefore = new Date(now.getTime() + 25 * 60 * 60_000).toISOString()
  const { data: sessions, error } = await supabase.from('tutoring_sessions')
    .select('id,starts_at,ends_at,status,meeting_url,students(first_name,last_name,email,parents(first_name,email)),tutors(first_name,last_name,email)')
    .eq('status', 'scheduled')
    .gt('starts_at', startsAfter)
    .lte('starts_at', startsBefore)
    .order('starts_at')
    .limit(500)
  if (error) throw Object.assign(new Error('Upcoming sessions could not be loaded. Confirm the session-reminders migration has been run.'), { status: 503 })

  const summary = { sessions: sessions?.length || 0, sent: 0, alreadySent: 0, processing: 0, failed: 0, skipped: 0, truncated: (sessions?.length || 0) === 500 }
  for (const session of sessions || []) {
    const student = relation(session.students)
    const parent = relation(student?.parents)
    const tutor = relation(session.tutors)
    if (!student || !parent || !tutor) { summary.skipped += 1; continue }
    const recipients = [
      { role: 'parent', email: parent.email, firstName: parent.first_name },
      { role: 'student', email: student.email, firstName: student.first_name },
      { role: 'tutor', email: tutor.email, firstName: tutor.first_name }
    ].filter(item => item.email)
    const seenEmails = new Set()
    for (const recipient of recipients) {
      const email = String(recipient.email).trim().toLowerCase()
      if (!email || seenEmails.has(email)) continue
      seenEmails.add(email)
      const reminder = buildSessionReminderEmail({ session, student, tutor, recipientRole: recipient.role, recipientFirstName: recipient.firstName || 'there' })
      const delivery = await sendTrackedEmail(supabase, {
        eventKey: `session:${session.id}:reminder:${session.starts_at}:${recipient.role}`,
        eventType: 'session_reminder',
        sessionId: session.id,
        recipientRole: recipient.role,
        to: email,
        ...reminder
      })
      if (delivery.status === 'sent') summary.sent += 1
      else if (delivery.status === 'already_sent') summary.alreadySent += 1
      else if (delivery.status === 'processing') summary.processing += 1
      else summary.failed += 1
    }
  }
  return summary
}

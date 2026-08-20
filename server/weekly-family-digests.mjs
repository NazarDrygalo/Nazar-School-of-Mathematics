import { createSupabaseAdminClient, isSupabaseConfigured } from './supabase.mjs'
import { sendTrackedEmail } from './workflow-notifications.mjs'

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character])
const relation = value => Array.isArray(value) ? value[0] : value
const dateOnly = value => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' }).format(new Date(value))
const periodDate = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(value))
const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())

export function weeklyDigestWindow(now = new Date()) {
  const periodEnd = new Date(now)
  periodEnd.setUTCHours(0, 0, 0, 0)
  const daysSinceMonday = (periodEnd.getUTCDay() + 6) % 7
  periodEnd.setUTCDate(periodEnd.getUTCDate() - daysSinceMonday)
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60_000)
  return { periodStart, periodEnd, periodKey: periodStart.toISOString().slice(0, 10) }
}

function limited(items, render, maximum = 8) {
  const visible = items.slice(0, maximum).map(render)
  if (items.length > maximum) visible.push(`+ ${items.length - maximum} more`)
  return visible
}

export function buildWeeklyFamilyDigestEmail({ student, progress, assignments, sessions, periodStart, periodEnd, recipientFirstName }) {
  const studentName = `${student.first_name} ${student.last_name}`
  const progressLines = limited(progress, item => `${item.area}: mastery ${item.mastery_level || 'not rated'}/5${item.notes ? ` — ${item.notes}` : ''}`)
  const assignmentLines = limited(assignments, item => `${item.title}: ${titleCase(item.status)}${item.due_at ? ` (due ${dateOnly(item.due_at)})` : ''}`)
  const sessionLines = limited(sessions, item => `${dateOnly(item.starts_at)}: ${titleCase(item.status)}`)
  const sections = [
    ['Progress updates', progressLines],
    ['Assignment activity', assignmentLines],
    ['Tutoring sessions', sessionLines]
  ].filter(([, lines]) => lines.length)
  const textSections = sections.map(([heading, lines]) => `${heading}:\n${lines.map(line => `- ${line}`).join('\n')}`).join('\n\n')
  const htmlSections = sections.map(([heading, lines]) => `<h2>${escapeHtml(heading)}</h2><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`).join('')
  const period = `${periodDate(periodStart)}–${periodDate(new Date(periodEnd.getTime() - 1))}`
  return {
    subject: `Weekly tutoring summary | ${studentName}`,
    text: `Hello ${recipientFirstName},\n\nHere is the weekly tutoring summary for ${studentName}, covering ${period}.\n\n${textSections}\n\nSign in to the portal for complete details and the current schedule.\n\nNazar's School of Mathematics`,
    html: `<p>Hello ${escapeHtml(recipientFirstName)},</p><p>Here is the weekly tutoring summary for <strong>${escapeHtml(studentName)}</strong>, covering ${escapeHtml(period)}.</p>${htmlSections}<p>Sign in to the portal for complete details and the current schedule.</p><p>Nazar's School of Mathematics</p>`
  }
}

function groupByStudent(rows) {
  const grouped = new Map()
  for (const row of rows || []) {
    const existing = grouped.get(row.student_id) || []
    existing.push(row)
    grouped.set(row.student_id, existing)
  }
  return grouped
}

export async function sendWeeklyFamilyDigests(now = new Date()) {
  if (!isSupabaseConfigured()) throw Object.assign(new Error('Weekly family digests are not configured.'), { status: 503 })
  const supabase = createSupabaseAdminClient()
  const { periodStart, periodEnd, periodKey } = weeklyDigestWindow(now)
  const start = periodStart.toISOString()
  const end = periodEnd.toISOString()
  const [studentsResult, progressResult, assignmentsResult, sessionsResult] = await Promise.all([
    supabase.from('students').select('id,first_name,last_name,email,parents(first_name,email)').eq('active', true).order('id').limit(1000),
    supabase.from('student_progress').select('student_id,area,mastery_level,notes,recorded_at').gte('recorded_at', start).lt('recorded_at', end).order('recorded_at').limit(1000),
    supabase.from('assignments').select('student_id,title,status,due_at,updated_at').gte('updated_at', start).lt('updated_at', end).order('updated_at').limit(1000),
    supabase.from('tutoring_sessions').select('student_id,starts_at,status').gte('starts_at', start).lt('starts_at', end).order('starts_at').limit(1000)
  ])
  const failed = [studentsResult, progressResult, assignmentsResult, sessionsResult].find(result => result.error)
  if (failed?.error) throw Object.assign(new Error('Weekly tutoring activity could not be loaded.'), { status: 503 })

  const progressByStudent = groupByStudent(progressResult.data)
  const assignmentsByStudent = groupByStudent(assignmentsResult.data)
  const sessionsByStudent = groupByStudent(sessionsResult.data)
  const summary = {
    students: studentsResult.data?.length || 0,
    digests: 0,
    sent: 0,
    alreadySent: 0,
    processing: 0,
    failed: 0,
    skipped: 0,
    truncated: [studentsResult.data, progressResult.data, assignmentsResult.data, sessionsResult.data].some(rows => (rows?.length || 0) === 1000)
  }

  for (const student of studentsResult.data || []) {
    const progress = progressByStudent.get(student.id) || []
    const assignments = assignmentsByStudent.get(student.id) || []
    const sessions = sessionsByStudent.get(student.id) || []
    if (!progress.length && !assignments.length && !sessions.length) { summary.skipped += 1; continue }
    const parent = relation(student.parents)
    if (!parent?.email) { summary.skipped += 1; continue }
    summary.digests += 1
    const recipients = [
      { role: 'parent', email: parent.email, firstName: parent.first_name },
      { role: 'student', email: student.email, firstName: student.first_name }
    ].filter(item => item.email)
    const seenEmails = new Set()
    for (const target of recipients) {
      const email = String(target.email).trim().toLowerCase()
      if (!email || seenEmails.has(email)) continue
      seenEmails.add(email)
      const digest = buildWeeklyFamilyDigestEmail({ student, progress, assignments, sessions, periodStart, periodEnd, recipientFirstName: target.firstName || 'there' })
      const delivery = await sendTrackedEmail(supabase, {
        eventKey: `weekly-digest:${student.id}:${periodKey}:${target.role}`,
        eventType: 'weekly_family_digest',
        recipientRole: target.role,
        to: email,
        ...digest
      })
      if (delivery.status === 'sent') summary.sent += 1
      else if (delivery.status === 'already_sent') summary.alreadySent += 1
      else if (delivery.status === 'processing') summary.processing += 1
      else summary.failed += 1
    }
  }
  return summary
}

# Platform Workflow Guide

This guide explains how Nazar's School of Mathematics operates from a family's first application through ongoing tutoring. It is intended for administrators, tutors, and future developers who need a clear overview of the system.

## 1. System overview

The platform has four main parts:

- **Public website:** Presents the school's services, resources, policies, and application form.
- **Secure portals:** Provide separate dashboards for administrators, parents, students, and tutors.
- **Supabase:** Stores application and tutoring data, authenticates portal users, and enforces role-based access.
- **Resend:** Delivers application notifications, parent receipts, and acceptance emails.

The production application is hosted on Render. The public domain is managed through Cloudflare. Render receives code from the repository's `main` branch and runs the Node server, which also serves the built React application.

## 2. Complete family workflow

### Step 1: A parent submits an application

The parent completes the public application form for Math, Science, or Essay Writing.

The server:

1. Validates all required fields.
2. Rejects malformed or duplicate submissions.
3. Saves the parent, student, and application records atomically in Supabase.
4. Sends the school an application notification through Resend.
5. Sends the parent an application-received email.

If email delivery fails after the application is saved, the application remains available in the administrator portal and the delivery failure is recorded. The site does not claim successful email delivery when Resend rejects the message.

### Step 2: The administrator reviews the application

The administrator signs in through the Portal Login and opens the application in the administrator dashboard.

An application may have one of these statuses:

- `submitted`
- `reviewing`
- `accepted`
- `declined`
- `withdrawn`

Changing an application to `accepted` sends one acceptance email to the parent. The delivery state and timestamp are saved so repeatedly selecting `accepted` does not send duplicate acceptance emails.

Declined, withdrawn, and reviewing status changes do not send parent emails.

### Step 3: The administrator prepares the accepted student

After accepting the application, the administrator:

1. Confirms that an active tutor operational record exists.
2. Selects that tutor in the accepted-family onboarding panel.
3. Chooses **Activate and assign tutor**.

This action activates the student and creates an active tutor/student assignment. Only one tutor assignment may be active for a student at a time.

This action deliberately does not create Authentication users or send account invitations.

### Step 4: Portal accounts are created deliberately

Only accepted families and active tutors should receive portal accounts.

For each person who needs access:

1. Create or invite the person under **Supabase Authentication -> Users**.
2. Link the resulting Auth UUID to the correct `parents`, `students`, or `tutors` record.
3. Add the matching `parent`, `student`, or `tutor` row to `public.user_roles`.

Parents and students must use different Authentication accounts. A student account is optional when only the parent needs portal access.

The exact linking patterns are documented in `README.md`. After linking, verify that the operational record has an `auth_user_id` and that the same UUID has the correct `user_roles` entry.

### Step 5: The user signs in

All roles use the same Portal Login. After authentication, the application reads the user's role and routes the user to the appropriate dashboard:

- Administrator -> `/admin`
- Parent -> `/parent`
- Student -> `/student`
- Tutor -> `/tutor`

An authenticated user without a valid role is signed out and is not given portal access.

## 3. Portal responsibilities

### Administrator

The administrator can:

- See action counters for applications needing review, incomplete onboarding, pending family requests, email-delivery issues, and accepted families without portal access.
- Search applications by student, parent, email, course, grade, or subject, then narrow the list by status, subject, or required action.
- Review applications and change their status.
- Inspect school-notification and acceptance-email delivery states, including recorded failure details.
- Verify whether the parent and student Authentication accounts are linked to their operational records.
- Activate accepted students and assign active tutors.
- Create tutor operational records.
- Activate or deactivate tutors.
- View all scheduled sessions.
- Review parent cancellation and rescheduling requests.
- Approve or decline session-change requests.

Creating a tutor operational record does not create the tutor's Auth account. Authentication setup remains a separate step.

### Parent

A parent can view only records associated with their family, including:

- Linked students.
- Upcoming and historical sessions.
- Assignments.
- Progress updates.
- Submitted cancellation or rescheduling requests.

Parents may request a cancellation or a different session time when the scheduled lesson is at least three days away. Only one request may be pending for a session. The request remains pending until an administrator approves or declines it.

When an administrator approves a rescheduling request, the session's duration is preserved while its start and end times are moved. When a cancellation request is approved, the session is marked cancelled.

### Student

A student can view only their own:

- Sessions and meeting links.
- Assignments and due dates.
- Progress updates.

The student portal is read-only for tutoring records.

### Tutor

An active tutor can work only with students currently assigned to that tutor. The tutor can:

- View assigned students.
- Schedule sessions.
- Edit session times, duration, meeting links, and status.
- Create assignments.
- Record progress updates.
- Add a private session note and an optional family summary. These are stored separately: parents can read only the family summary, never the private tutor note.

Database policies require both an active tutor and an active tutor/student assignment before student-specific records can be created or changed.

## 4. Scheduling rules

Session times are saved as UTC timestamps. Each portal displays them in the viewer's local time zone.

Session durations must be between 15 minutes and four hours. The interface provides common duration choices, including 30, 45, 60, 75, 90, and 120 minutes.

Available session statuses are:

- `scheduled`
- `completed`
- `cancelled`
- `no_show`

Parents must submit cancellation or rescheduling requests at least three days before the lesson. This rule is enforced in both the interface and the database, so it cannot be bypassed by sending a direct browser request.

## 5. Authentication and password recovery

Supabase Authentication manages email/password sign-in and password recovery.

If a user forgets a password:

1. The user selects **Forgot your password?** on the Portal Login.
2. Supabase sends a password-reset link.
3. The link returns the user to the approved site URL.
4. The user chooses a new password of at least 10 characters.
5. The user is signed out and signs in again with the new password.

Production and local recovery URLs must be listed in the Supabase Authentication redirect settings before recovery is tested.

## 6. Security model

Security is enforced at multiple levels:

- **Authentication:** Supabase verifies the user's identity.
- **Role routing:** The frontend sends each user to the dashboard assigned in `user_roles`.
- **Row Level Security:** Supabase policies restrict which database rows each user can read or change.
- **Assignment checks:** Tutors can write student data only when an active assignment connects the tutor and student.
- **Administrator API checks:** Sensitive status changes require a valid access token and the `admin` role.
- **Server-only credentials:** The Supabase service-role key and Resend API key remain on the server and are never exposed through `VITE_` variables.
- **Security headers:** The Node server sets CSP, HSTS, clickjacking protection, browser-permission restrictions, and related headers for API and static responses.
- **Application abuse protection:** Public applications require JSON, validate the browser origin, and use persistent HMAC-based IP and email rate limits without storing raw IP or email values in the rate-limit table.
- **Workflow enforcement:** Session scheduling, change requests, resolutions, and session notes use narrow server endpoints or database functions; direct browser mutations that could bypass audit or notification behavior are revoked.

Frontend controls improve usability, but database policies are the authoritative access boundary.

## 7. Email behavior

The platform sends only the workflow messages currently required:

- A new-application notification to the school.
- An application-received confirmation to the parent.
- One acceptance email when an administrator accepts the application.
- A session-created or session-updated email to the linked parent.
- A session-change-request email to the administrator.
- A request-resolution email to the linked parent and tutor.

The platform does not currently send lesson reminders, assignment notifications, progress emails, or general marketing messages.

Workflow changes are saved before email delivery is attempted. Each attempt has a unique event key, delivery state, recipient, timestamp, and error detail in `notification_deliveries`. Retrying the same operation does not resend an already delivered message. Administrators can inspect failed workflow messages in the operations dashboard.

Resend delivery depends on a valid API key and sender configuration. The Resend testing sender has recipient restrictions; production delivery should use a verified sending domain and the configured `FROM_EMAIL` value.

## 8. Data retention

The platform follows a one-week retention policy for applications and historical tutoring activity.

The `public.purge_expired_tutoring_data()` function removes eligible records older than seven days, including:

- Applications.
- Historical session notes.
- Session-change requests.
- Workflow email-delivery records.
- Progress entries.
- Assignments.
- Ended sessions and old cancelled sessions.
- Old inactive, unlinked, orphaned parent, student, or tutor records.

The cleanup preserves active profiles, active tutor assignments, and future sessions so current tutoring is not interrupted.

Supabase Cron runs the cleanup every day at 03:17 UTC. Cron history should be checked periodically to confirm that the job continues to complete successfully. Cleanup counts can be reviewed manually with:

```sql
select public.purge_expired_tutoring_data();
```

This command permanently deletes eligible data. Preview it inside a transaction followed by `rollback` when counts need to be inspected without retaining the deletions.

## 9. Local testing

Create a local `.env` file with the required browser-safe and server-only credentials. Never commit `.env`.

Run the full local verification sequence:

```powershell
npm test
npm run build
npm start
```

Then open `http://localhost:3000` and test each role with separate disposable accounts. Always sign out fully before switching roles.

The minimum workflow smoke test is:

1. Submit an application.
2. Confirm the school notification and parent receipt.
3. Accept the application and confirm one acceptance email.
4. Activate the student and assign an active tutor.
5. Link disposable parent, student, and tutor Auth accounts.
6. Schedule and edit a future session as the tutor.
7. Confirm the parent and student can see the correct session.
8. Submit a valid parent rescheduling request.
9. Approve it as administrator and verify the updated time.
10. Confirm that each role cannot see records belonging to unrelated users.
11. Test password recovery.

Use `supabase/RLS_VERIFICATION.md` for database-policy checks and `RELEASE_CHECKLIST.md` for the complete release process.

## 10. Deployment workflow

Before deploying:

1. Apply all required Supabase migrations in order.
2. Confirm the daily retention Cron job is active.
3. Run the test suite and production build.
4. Complete the workflow smoke test.
5. Confirm required environment variables exist in Render.
6. Commit the verified changes and push them to `main`.

Render automatically deploys the `main` branch. After deployment, verify the production site, application submission, role routing, password recovery, and browser console. Cloudflare should continue to provide the public domain and HTTPS connection.

## 11. Environment variables

The production server requires:

```env
RESEND_API_KEY=...
FROM_EMAIL=...
APPLICATION_RECIPIENT=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
PUBLIC_SITE_ORIGIN=https://nazarschoolofmath.com
RATE_LIMIT_SECRET=...
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are browser-safe. `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` are private server credentials and must never use the `VITE_` prefix.

## 12. Current scope

The platform currently supports applications, role-based portals, tutor assignments, scheduling, assignments, progress tracking, session notes, family change requests, password recovery, email delivery, and automated data retention.

Payments, invoicing, and external calendar integrations are intentionally outside the current scope. They should be added only after the relevant providers, pricing, refund rules, and scheduling policies have been formally selected.

# Nazar’s School of Mathematics

Professional landing site and parent application form for online tutoring for students in middle school through 11th grade.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set the Resend and Supabase credentials described below.
4. Run `npm run build`.
5. Run `npm start` and open `http://localhost:3000`.

`npm run dev` builds the app and starts the complete local server, including `/api/application`. Use this when testing the form. `npm run dev:client` starts Vite only for visual work; it deliberately does not provide the application API.

## Application email delivery

The server sends applications through [Resend](https://resend.com). It does not simulate delivery.

Required variables:

```env
RESEND_API_KEY=re_...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_browser_safe_publishable_key
```

Optional variables:

```env
APPLICATION_RECIPIENT=nazar.drygalo@gmail.com
PORT=3000
```

Without `FROM_EMAIL`, the site uses Resend’s `onboarding@resend.dev` testing sender. Resend only permits that sender to deliver to the email address associated with the Resend account, so this is suitable while the school recipient email is that account email. To accept applications at any other address, add a verified domain and set `FROM_EMAIL` to an address at that domain. The local server reads `.env` for convenience; production hosts should configure the same values in their environment settings. Until the required variables are supplied, the application endpoint returns a clear configuration error instead of claiming a submission was delivered.

## Supabase foundation

Before testing submissions, run `supabase/migrations/20260731_initial_tutoring_platform.sql` in the Supabase SQL Editor. It creates the tutoring-platform tables, indexes, an atomic server-only application submission function, and Row Level Security policies. The public form never reads or writes Supabase directly; `server.mjs` uses `SUPABASE_SERVICE_ROLE_KEY` only on the server to save a validated application before sending the existing Resend notification.

## Administrator portal

Run `supabase/migrations/20260804_admin_portal.sql` after the initial migration. In Supabase Authentication, create Nazar's email/password user, then use the commented SQL at the bottom of that migration to assign that user the `admin` role. The public Portal Login can then securely route Nazar to `#/admin`, where applications can be reviewed and their status changed.

The portal also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are browser-safe values from Supabase’s Connect panel. Do not substitute the server key for the publishable key.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or use a `VITE_` prefix for it. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` contain only browser-safe values.

Application status changes use the server-only `PATCH /api/admin/applications/:id/status` endpoint. The endpoint validates the caller's Supabase access token and admin role before using the service-role client. Selecting `accepted` sends the parent acceptance email through Resend and records its delivery state; selecting it again does not resend an email that was already recorded as sent.

## Parent, student, and tutor portals

Run `supabase/migrations/20260805_role_portals.sql` after the earlier migrations, then run `supabase/migrations/20260805_secure_scheduling.sql`. The first adds role policies and the student Auth-user link. The second adds secure tutor/student assignments, acceptance-email delivery fields, and assignment-scoped tutor write policies.

Create or invite each person in Supabase Authentication, then link their Auth UUID to the appropriate `parents`, `students`, or `tutors` record and add the matching `user_roles` row. The comments at the bottom of the migration include the exact SQL patterns. Only create portal accounts for accepted families and active tutors.

Parents can view their students, sessions, assignments, and progress. Students can view their own sessions, assignments, and progress. Administrators can activate an accepted student and assign one active tutor from the application detail panel. Tutors can then schedule sessions and create assignments and progress updates only for actively assigned students. Session times are saved as UTC instants and displayed in each viewer's local time zone.

The onboarding panel intentionally does not create Auth accounts. After accepting a family, invite only the parent and/or student who should receive portal access, then link the Auth UUID and role:

```sql
update public.parents set auth_user_id = 'PARENT_AUTH_UUID' where email = 'parent@example.com';
update public.students set auth_user_id = 'STUDENT_AUTH_UUID' where id = 'STUDENT_RECORD_UUID';
insert into public.user_roles (user_id, role) values ('PARENT_AUTH_UUID', 'parent')
on conflict (user_id) do update set role = excluded.role;
insert into public.user_roles (user_id, role) values ('STUDENT_AUTH_UUID', 'student')
on conflict (user_id) do update set role = excluded.role;
```

For an active tutor, first create the `public.tutors` record if needed, invite the tutor in Supabase Authentication, link `tutors.auth_user_id`, and add a `tutor` row in `user_roles`. Do not create accounts for unaccepted applicants or inactive tutors.

Payments, invoicing, and external calendar integrations are intentionally not included yet; they need their own provider accounts, pricing, refund, and scheduling policies before they should be enabled.

## Editing business content

Update `src/content.ts` to change the business name, email, phone number, grade range, available subjects, and FAQ answers.

## Deployment

Build with `npm run build`, then deploy the repository to any Node 20+ host using `npm start`. Set the environment variables in the host configuration and do not commit `.env`.

# Nazar’s School of Mathematics

Professional landing site and parent application form for online tutoring for students in middle school through 11th grade.

For a plain-language explanation of the complete application, onboarding, portal, tutoring, retention, testing, and deployment process, see [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md).

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set the Resend and Supabase credentials described below.
4. Run `npm run build`.
5. Run `npm start` and open `http://localhost:3000`.

`npm run dev` builds the app and starts the complete local server, including `/api/application`. Use this when testing the form. `npm run dev:client` starts Vite only for visual work; it deliberately does not provide the application API.

Run `npm test` for local server-validation and migration-security checks. After applying migrations to a non-production Supabase project, follow `supabase/RLS_VERIFICATION.md` to exercise the policies with test users.

## Search visibility and clean URLs

Public pages use crawlable paths such as `/math`, `/science-and-essay-writing`, `/resources`, `/apply`, and `/contact`. Older `#/...` bookmarks are normalized to their clean equivalents. The Node server returns route-specific titles, descriptions, canonical URLs, Open Graph tags, and indexing directives in the initial HTML; private portal routes are marked `noindex, nofollow`.

Vite copies `public/robots.txt` and `public/sitemap.xml` into the production build. After deployment, add `https://nazarschoolofmath.com` to Google Search Console, submit `https://nazarschoolofmath.com/sitemap.xml`, and use URL Inspection on the home page and each principal public route.

## Application email delivery

The server sends applications through [Resend](https://resend.com). It does not simulate delivery.

Required variables:

```env
RESEND_API_KEY=re_...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_browser_safe_publishable_key
VITE_TURNSTILE_SITE_KEY=your_browser_safe_turnstile_site_key
TURNSTILE_SECRET_KEY=your_server_only_turnstile_secret_key
REMINDER_CRON_SECRET=your_server_only_random_reminder_secret
```

Optional variables:

```env
APPLICATION_RECIPIENT=nazar.drygalo@gmail.com
PUBLIC_SITE_ORIGIN=https://nazarschoolofmath.com
RATE_LIMIT_SECRET=generate-a-long-random-value
PORT=3000
```

`RATE_LIMIT_SECRET` is used only to create irreversible application rate-limit keys. If omitted, the server-only Supabase service-role key is used instead. The server rejects non-JSON application requests and browser submissions from origins other than `PUBLIC_SITE_ORIGIN`.

## Application bot protection

The public application form uses Cloudflare Turnstile. In the Cloudflare dashboard, create a managed Turnstile widget restricted to `nazarschoolofmath.com`. Put its public site key in `VITE_TURNSTILE_SITE_KEY` and its private secret in `TURNSTILE_SECRET_KEY`. Never add a `VITE_` prefix to the secret.

The browser widget alone is not trusted. Every application token is validated by `server.mjs` through Cloudflare Siteverify, including its hostname and `application` action, before the application is saved. Tokens are single-use and are reset after an unsuccessful submission.

For local development only, use Cloudflare's documented always-pass test pair:

```env
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

Without `FROM_EMAIL`, the site uses Resend’s `onboarding@resend.dev` testing sender. Resend only permits that sender to deliver to the email address associated with the Resend account, so this is suitable while the school recipient email is that account email. To accept applications at any other address, add a verified domain and set `FROM_EMAIL` to an address at that domain. The local server reads `.env` for convenience; production hosts should configure the same values in their environment settings. Until the required variables are supplied, the application endpoint returns a clear configuration error instead of claiming a submission was delivered.

## Supabase foundation

Before testing submissions, run `supabase/migrations/20260731_initial_tutoring_platform.sql` in the Supabase SQL Editor. It creates the tutoring-platform tables, indexes, an atomic server-only application submission function, and Row Level Security policies. The public form never reads or writes Supabase directly; `server.mjs` uses `SUPABASE_SERVICE_ROLE_KEY` only on the server to save a validated application before sending the existing Resend notification.

## Administrator portal

Run `supabase/migrations/20260804_admin_portal.sql` after the initial migration. In Supabase Authentication, create Nazar's email/password user, then use the commented SQL at the bottom of that migration to assign that user the `admin` role. The public Portal Login can then securely route Nazar to `/admin`, where applications can be reviewed and their status changed.

The portal also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are browser-safe values from Supabase’s Connect panel. Do not substitute the server key for the publishable key.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or use a `VITE_` prefix for it. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` contain only browser-safe values.

Application status changes use the server-only `PATCH /api/admin/applications/:id/status` endpoint. The endpoint validates the caller's Supabase access token and admin role before using the service-role client. Selecting `accepted` sends the parent acceptance email through Resend and records its delivery state; selecting it again does not resend an email that was already recorded as sent.

## Parent, student, and tutor portals

Run `supabase/migrations/20260805_role_portals.sql` after the earlier migrations, then run `supabase/migrations/20260805_secure_scheduling.sql`. The first adds role policies and the student Auth-user link. The second adds secure tutor/student assignments, acceptance-email delivery fields, and assignment-scoped tutor write policies.

Run `supabase/migrations/20260806_session_changes.sql` next. It adds parent cancellation/rescheduling requests, enforces the three-day request window with RLS, and provides an atomic administrator approval function.

Run `supabase/migrations/20260806_tutor_management.sql` after that. It lets administrators create and activate/deactivate tutor operational records. It does not create Auth users or send invitations.

Run `supabase/migrations/20260806_data_retention.sql` after that. It adds a service-role-only cleanup function that deletes applications and historical portal activity after seven days while preserving active profiles, active tutor assignments, and future sessions.

Run [`supabase/migrations/20260813_workflow_notifications.sql`](supabase/migrations/20260813_workflow_notifications.sql) next. It adds idempotent email-delivery tracking, administrator-only visibility into failures, and an atomic service-role function for resolving session-change requests. Tutor session creation/updates, parent change requests, and administrator resolutions then use authenticated server endpoints so workflow emails cannot be triggered anonymously or sent directly from browser code.

Then run [`supabase/migrations/20260817_security_hardening.sql`](supabase/migrations/20260817_security_hardening.sql). It separates family-visible session summaries from private tutor notes, prevents browser clients from bypassing notification-producing server workflows, and adds persistent HMAC-based rate limiting for public applications. Deploy the matching application code immediately after running this migration because direct session and request mutations are intentionally revoked.

Then run [`supabase/migrations/20260818_admin_mfa.sql`](supabase/migrations/20260818_admin_mfa.sql) and deploy the matching application code immediately afterward. This requires every administrator database query and server API call to use an MFA-authenticated `aal2` session. Parent, student, and tutor accounts continue to use their existing sign-in flow.

Then run [`supabase/migrations/20260818170000_portal_onboarding.sql`](supabase/migrations/20260818170000_portal_onboarding.sql). It adds service-role-only, atomic Auth-user linking; idempotent invitation tracking; optional student email storage; administrator-only audit visibility; duplicate record/role protection; and seven-day cleanup of invitation activity. Apply this migration before deploying the matching onboarding UI because the dashboard reads `portal_invitations` immediately.

Next, run [`supabase/migrations/20260819120000_tutor_availability.sql`](supabase/migrations/20260819120000_tutor_availability.sql). It adds recurring weekly tutor hours, one-off unavailable blocks, and an atomic scheduling function that prevents overlaps and out-of-hours sessions. Apply this migration before deploying the matching tutor dashboard because it reads the new availability tables immediately.

Then run [`supabase/migrations/20260819152015_session_reminders.sql`](supabase/migrations/20260819152015_session_reminders.sql). It extends the server-only delivery history for idempotent parent, optional student, and tutor reminder emails. Apply it before enabling the reminder Cron job.

Then run [`supabase/migrations/20260820120000_google_calendar_sync.sql`](supabase/migrations/20260820120000_google_calendar_sync.sql). It adds server-only encrypted Google Calendar connections, single-use OAuth state, and non-sensitive synchronization audit records. Apply it before deploying the calendar controls.

Finally, run [`supabase/migrations/20260820130000_database_security_cleanup.sql`](supabase/migrations/20260820130000_database_security_cleanup.sql). It removes unintended browser execution grants from internal database helpers, fixes mutable trigger-function search paths, prevents future public RPC auto-grants, and adds covering indexes for every foreign key reported by the Supabase advisor.

Then run [`supabase/migrations/20260820133000_rls_policy_performance.sql`](supabase/migrations/20260820133000_rls_policy_performance.sql). It preserves the existing RLS access rules while caching `auth.uid()` once per statement, eliminating repeated per-row authentication lookups reported by the Supabase performance advisor.

Then run [`supabase/migrations/20260820140000_private_privileged_functions.sql`](supabase/migrations/20260820140000_private_privileged_functions.sql). It moves privileged database implementations into a non-exposed `private` schema and retains invoker-rights public wrappers for the existing portal RPC names.

In Supabase Authentication, confirm TOTP multi-factor verification is enabled. The next administrator sign-in displays a QR code and setup key; scan either one with an authenticator app and enter the current six-digit code. Later administrator sign-ins request a fresh six-digit code after the password. If the authenticator device is lost, recover the account through the Supabase administrator console only after verifying the account owner's identity, remove the lost factor, and enroll a new one at the next sign-in.

To enforce the policy automatically, enable Supabase Cron in the dashboard and schedule the cleanup once per day from the SQL Editor:

```sql
select cron.schedule(
  'daily-tutoring-data-retention',
  '17 3 * * *',
  $$select public.purge_expired_tutoring_data();$$
);
```

The example runs daily at 03:17 UTC. Confirm the job under Supabase Dashboard → Integrations → Cron. To test manually, run `select public.purge_expired_tutoring_data();` from the SQL Editor and review the returned deletion counts. Do not shorten the interval below one day.

### Scheduled session reminders

The server sends one reminder to the parent, tutor, and optional student email when a scheduled session first enters the next 25 hours. A session-time-specific event key prevents duplicate delivery when Cron retries. If the session is later rescheduled, the new time receives its own reminder. Cancelled sessions are excluded.

Generate a dedicated secret once:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Add the result to Render as `REMINDER_CRON_SECRET` without a `VITE_` prefix. After Render redeploys, store the endpoint and the same secret in Supabase Vault, enable `pg_net`, and create the 15-minute job:

```sql
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://nazarschoolofmath.com/api/cron/session-reminders',
  'session_reminder_url'
);

select vault.create_secret(
  '<PASTE_THE_SAME_REMINDER_CRON_SECRET>',
  'session_reminder_cron_secret'
);

select cron.schedule(
  'send-tutoring-session-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'session_reminder_url' order by created_at desc limit 1),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'session_reminder_cron_secret' order by created_at desc limit 1)
    ),
    body := jsonb_build_object('scheduled_at', now()),
    timeout_milliseconds := 10000
  );
  $$
);
```

Confirm the job under Supabase Dashboard → Integrations → Cron. Keep the secret server-only. The endpoint rejects non-POST requests and missing or incorrect credentials without querying tutoring data.

Add `https://nazarschoolofmath.com/portal` to the Supabase Authentication allowed redirect URLs. The administrator portal creates secure one-time setup links only for accepted families and active tutors. The server creates or finds the Auth user, atomically links exactly one operational record and role, then sends the setup link through Resend. Existing users receive a password-reset link rather than a duplicate account.

Parents can view their students, sessions, assignments, and progress. Students can view their own sessions, assignments, and progress. Administrators can activate an accepted student and assign one active tutor from the application detail panel. Tutors can define weekly availability, block one-off unavailable times, schedule sessions, and create assignments and progress updates only for actively assigned students. Session times are saved as UTC instants and displayed in each viewer's local time zone. Once a tutor adds any weekly hours, scheduled sessions must fit one complete window; overlapping sessions and unavailable blocks are always rejected.

Workflow email behavior:

- A tutor scheduling or editing a session emails the linked parent.
- A parent requesting cancellation or a new time emails the administrator.
- Approving or declining a request emails both the linked parent and tutor.
- Supabase Cron sends an approximately one-day reminder to the parent, tutor, and optional student email.
- Every delivery attempt is recorded in `notification_deliveries`; unique event keys prevent retries from producing duplicate messages.
- The operational change remains saved if Resend fails, and the administrator dashboard displays the failure details.

After accepting a family, activate the student and assign an active tutor. The accepted-family panel then lets the administrator send a parent setup email, an optional student setup email, or both. A student email is entered only when a separate student login is desired. Invitation attempts, errors, and successful linking are displayed in the dashboard and can be safely retried.

For tutors, create and activate the operational tutor record first, then use **Send setup email** in Tutor Administration. Inactive tutors are rejected by both the UI and server. Manual Auth UUID linking is retained only as an emergency recovery procedure; routine onboarding should use the administrator workflow so eligibility, role uniqueness, audit status, and email delivery are enforced together.

## Google Calendar synchronization

Each active tutor can connect a Google Account from the tutor dashboard. Future scheduled sessions are backfilled at connection time. Later session creation, edits, cancellations, status changes, and approved family rescheduling requests update the tutor's primary Google Calendar automatically. Events are private, use a deterministic ID to prevent duplicates, and include only the student's first name and last initial. Calendar failure never reverses a tutoring workflow; it is recorded and shown in the connection status instead.

Google Cloud setup:

1. Create or select a Google Cloud project and enable the **Google Calendar API**.
2. Configure the Google Auth Platform branding, audience, privacy-policy URL, terms URL, and data-access scope.
3. Request only `https://www.googleapis.com/auth/calendar.events.owned`.
4. Create an OAuth client with application type **Web application**.
5. Add `https://nazarschoolofmath.com/api/integrations/google-calendar/callback` as an authorized redirect URI. It must match exactly.
6. Add each tutor's Google Account as a test user while the OAuth application is in Testing.
7. Add the four server-only variables below to Render, apply the migration, deploy, and connect from `/tutor`.

```env
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=...
GOOGLE_CALENDAR_REDIRECT_URI=https://nazarschoolofmath.com/api/integrations/google-calendar/callback
```

Generate the encryption key once with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Store it permanently in Render and never rotate or remove it without first disconnecting every calendar, because existing refresh tokens cannot be decrypted with a different key. Never prefix any of these variables with `VITE_`.

An External OAuth application left in Google's Testing status issues Calendar refresh tokens that expire after seven days. This is acceptable for initial testing, but tutors must reconnect weekly until the application is published or otherwise moved to an appropriate production configuration. The integration handles revoked or expired tokens as a visible synchronization error and never exposes them to browser code.

Payments and invoicing are intentionally not included; the school handles them through direct personal arrangements.

## Editing business content

Update `src/content.ts` to change the business name, email, phone number, grade range, available subjects, and FAQ answers.

## Deployment

Build with `npm run build`, then deploy the repository to any Node 20+ host using `npm start`. Set the environment variables in the host configuration and do not commit `.env`.

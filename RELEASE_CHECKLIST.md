# Release checklist

Use a non-production Supabase project for RLS testing first. Do not deploy code that queries a new table until its migration has been applied successfully.

## 1. Database migrations

Existing projects that already have the first five migrations should run the remaining migrations in this order:

1. [`supabase/migrations/20260806_session_changes.sql`](supabase/migrations/20260806_session_changes.sql)
2. [`supabase/migrations/20260806_tutor_management.sql`](supabase/migrations/20260806_tutor_management.sql)
3. [`supabase/migrations/20260806_data_retention.sql`](supabase/migrations/20260806_data_retention.sql)
4. [`supabase/migrations/20260813_workflow_notifications.sql`](supabase/migrations/20260813_workflow_notifications.sql)
5. [`supabase/migrations/20260817_security_hardening.sql`](supabase/migrations/20260817_security_hardening.sql)
6. [`supabase/migrations/20260818_admin_mfa.sql`](supabase/migrations/20260818_admin_mfa.sql)
7. [`supabase/migrations/20260818170000_portal_onboarding.sql`](supabase/migrations/20260818170000_portal_onboarding.sql)
8. [`supabase/migrations/20260819120000_tutor_availability.sql`](supabase/migrations/20260819120000_tutor_availability.sql)
9. [`supabase/migrations/20260819152015_session_reminders.sql`](supabase/migrations/20260819152015_session_reminders.sql)
10. [`supabase/migrations/20260820120000_google_calendar_sync.sql`](supabase/migrations/20260820120000_google_calendar_sync.sql)
11. [`supabase/migrations/20260820130000_database_security_cleanup.sql`](supabase/migrations/20260820130000_database_security_cleanup.sql)
12. [`supabase/migrations/20260820133000_rls_policy_performance.sql`](supabase/migrations/20260820133000_rls_policy_performance.sql)
13. [`supabase/migrations/20260820140000_private_privileged_functions.sql`](supabase/migrations/20260820140000_private_privileged_functions.sql)
14. [`supabase/migrations/20260820203358_assignment_completion_workflow.sql`](supabase/migrations/20260820203358_assignment_completion_workflow.sql)
15. [`supabase/migrations/20260820213451_assignment_email_notifications.sql`](supabase/migrations/20260820213451_assignment_email_notifications.sql)
16. [`supabase/migrations/20260820222420_progress_email_notifications.sql`](supabase/migrations/20260820222420_progress_email_notifications.sql)
17. [`supabase/migrations/20260820224411_weekly_family_digests.sql`](supabase/migrations/20260820224411_weekly_family_digests.sql)

For a new Supabase project, run the complete order:

1. `20260731_initial_tutoring_platform.sql`
2. `20260804_admin_portal.sql`
3. `20260804_application_service_area.sql`
4. `20260805_role_portals.sql`
5. `20260805_secure_scheduling.sql`
6. `20260806_session_changes.sql`
7. `20260806_tutor_management.sql`
8. `20260806_data_retention.sql`
9. `20260813_workflow_notifications.sql`
10. `20260817_security_hardening.sql`
11. `20260818_admin_mfa.sql`
12. `20260818170000_portal_onboarding.sql`
13. `20260819120000_tutor_availability.sql`
14. `20260819152015_session_reminders.sql`
15. `20260820120000_google_calendar_sync.sql`
16. `20260820130000_database_security_cleanup.sql`
17. `20260820133000_rls_policy_performance.sql`
18. `20260820140000_private_privileged_functions.sql`
19. `20260820203358_assignment_completion_workflow.sql`
20. `20260820213451_assignment_email_notifications.sql`
21. `20260820222420_progress_email_notifications.sql`
22. `20260820224411_weekly_family_digests.sql`

Afterward, run the checks in `supabase/RLS_VERIFICATION.md` with disposable test records.

## 2. Data retention schedule

Enable Supabase Cron and create the daily job documented in `README.md`. Run `select public.purge_expired_tutoring_data();` once manually and inspect the returned counts before relying on the schedule.

## 2a. Session reminder schedule

Generate and add `REMINDER_CRON_SECRET` in Render, deploy, store the endpoint and matching secret in Supabase Vault, and create the 15-minute HTTP Cron job documented in `README.md`. Never use a `VITE_` prefix for this secret.

## 2b. Weekly family digest schedule

Reuse `REMINDER_CRON_SECRET`, store the weekly digest endpoint in Supabase Vault, and create the Monday HTTP Cron job documented in `README.md`. Confirm the existing Vault secret named `session_reminder_cron_secret` still contains the same current Render value.

## 3. Supabase Authentication

- Confirm the production Site URL is `https://nazarschoolofmath.com`.
- Add `https://nazarschoolofmath.com/portal` to allowed redirect URLs for password recovery and portal setup invitations.
- Add `http://localhost:3000/` only when local password-recovery testing is needed.
- Confirm Nazar's Auth UUID has the `admin` role.
- Confirm TOTP multi-factor verification is enabled, enroll the administrator account, sign out, and confirm the next sign-in requires a six-digit authenticator code.
- Confirm an administrator password-only (`aal1`) session cannot read administrator data or call an administrator server endpoint.
- Use the administrator portal to create Auth users only for accepted families and active tutors.
- Confirm every Auth UUID is linked to exactly one appropriate parent, student, or tutor record and has the matching `user_roles` row.

## 4. Render environment

Confirm these values exist in Render and are not exposed through `VITE_` variables:

- `RESEND_API_KEY`
- `FROM_EMAIL`
- `APPLICATION_RECIPIENT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `REMINDER_CRON_SECRET`

Also set `PUBLIC_SITE_ORIGIN=https://nazarschoolofmath.com`. `RATE_LIMIT_SECRET` is optional; when omitted, the server uses the server-only Supabase service-role key to create irreversible rate-limit hashes.

Use `npm run build` as the build command and `npm start` as the start command.

## 5. Local verification

```powershell
npm test
npm run build
npm start
```

Check desktop and mobile layouts at minimum on Home, Resources, Apply, Portal Login, and every role dashboard.

## 6. Workflow smoke tests

- Submit one application and confirm it is stored once.
- Confirm the application button remains disabled until Turnstile succeeds, an expired token resets, and a server request without a valid token is rejected.
- Confirm the administrator and parent receipt emails are delivered.
- Accept it and confirm exactly one acceptance email is delivered.
- Create or activate a tutor record; confirm this does not send an invitation.
- Activate the accepted student and assign the tutor.
- Send parent and student portal setup emails from the accepted-family panel; confirm each recipient can create a password and reaches only the correct portal.
- Retry one setup email and confirm the existing Auth user is linked instead of duplicated.
- Send an active tutor's setup email from Tutor Administration and confirm an inactive tutor cannot be invited.
- Add at least one weekly availability window and one future unavailable block as the tutor.
- Connect the tutor's Google Calendar and confirm the dashboard reports it as connected.
- Schedule and edit a session inside availability, then confirm overlapping, blocked, and out-of-hours sessions are rejected.
- Confirm the scheduled event appears once in the tutor's primary Google Calendar, edits move it, and cancellation removes it.
- Confirm the session appears with correct local time for parent and student.
- Create a disposable session between 24 and 25 hours away, invoke the secured reminder endpoint, and confirm one reminder reaches the parent and tutor plus the student when a separate student email exists.
- Invoke the endpoint again and confirm no recipient receives a duplicate reminder.
- Confirm a cancelled session in the same window sends no reminder.
- Create an assignment as the tutor, mark it complete as the linked student, and confirm the tutor sees it as submitted.
- Confirm assignment creation emails the parent and optional student address exactly once, then confirm submission emails the assigned tutor exactly once.
- Mark the assignment reviewed, then return it for revisions and confirm the student and parent see each status change and receive each matching email exactly once.
- Confirm a different student and an unassigned tutor cannot change the assignment status.
- Record a progress update as the tutor; confirm the parent and optional student address receive it exactly once and an unassigned tutor cannot create one.
- Invoke the weekly digest endpoint with the Cron credential; confirm active students with recent activity receive one digest per distinct family/student address, inactive students and students without activity are skipped, and a repeated invocation sends no duplicates.
- Submit a parent rescheduling request more than three days before the lesson.
- Confirm a request inside three days is rejected.
- Approve the valid request as admin and confirm the session time changes without changing its duration.
- Confirm an administrator cannot approve a requested time that conflicts with the tutor's availability.
- Approve a valid requested time and confirm the existing Google event moves instead of creating a duplicate.
- Test password recovery with a disposable portal account.
- Confirm each role cannot access another family's or tutor's records.

## 7. Deployment and production checks

After all earlier checks pass, commit and push to `main` to trigger Render. Then verify:

- `https://nazarschoolofmath.com` uses HTTPS and loads the new Resources page.
- Clean public URLs such as `/math`, `/resources`, `/apply`, and `/contact` load directly and after a browser refresh.
- `/robots.txt` and `/sitemap.xml` return successfully, and the sitemap has been submitted in Google Search Console.
- Application submission reaches Supabase and Resend.
- Portal login routes admin, parent, student, and tutor correctly.
- Password-reset links return to the production site.
- No browser console errors or failed API requests appear.
- Supabase Cron shows successful `send-tutoring-session-reminders` runs and reminder delivery failures, if any, appear in the administrator dashboard.
- Supabase Cron shows successful `send-weekly-family-digests` runs and digest delivery failures, if any, appear in the administrator dashboard.

Record the test application IDs and delete disposable records after verification.

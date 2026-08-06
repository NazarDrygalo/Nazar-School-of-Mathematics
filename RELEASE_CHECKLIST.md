# Release checklist

Use a non-production Supabase project for RLS testing first. Do not deploy code that queries a new table until its migration has been applied successfully.

## 1. Database migrations

Existing projects that already have the first five migrations should run only the final three, in this order:

1. `supabase/migrations/20260806_session_changes.sql`
2. `supabase/migrations/20260806_tutor_management.sql`
3. `supabase/migrations/20260806_data_retention.sql`

For a new Supabase project, run the complete order:

1. `20260731_initial_tutoring_platform.sql`
2. `20260804_admin_portal.sql`
3. `20260804_application_service_area.sql`
4. `20260805_role_portals.sql`
5. `20260805_secure_scheduling.sql`
6. `20260806_session_changes.sql`
7. `20260806_tutor_management.sql`
8. `20260806_data_retention.sql`

Afterward, run the checks in `supabase/RLS_VERIFICATION.md` with disposable test records.

## 2. Data retention schedule

Enable Supabase Cron and create the daily job documented in `README.md`. Run `select public.purge_expired_tutoring_data();` once manually and inspect the returned counts before relying on the schedule.

## 3. Supabase Authentication

- Confirm the production Site URL is `https://nazarschoolofmath.com`.
- Add `https://nazarschoolofmath.com/` to allowed redirect URLs for password recovery.
- Add `http://localhost:3000/` only when local password-recovery testing is needed.
- Confirm Nazar's Auth UUID has the `admin` role.
- Create Auth users only for accepted families and active tutors.
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
- Confirm the administrator and parent receipt emails are delivered.
- Accept it and confirm exactly one acceptance email is delivered.
- Create or activate a tutor record; confirm this does not send an invitation.
- Activate the accepted student and assign the tutor.
- Schedule and edit a session as the tutor.
- Confirm the session appears with correct local time for parent and student.
- Submit a parent rescheduling request more than three days before the lesson.
- Confirm a request inside three days is rejected.
- Approve the valid request as admin and confirm the session time changes without changing its duration.
- Test password recovery with a disposable portal account.
- Confirm each role cannot access another family's or tutor's records.

## 7. Deployment and production checks

After all earlier checks pass, commit and push to `main` to trigger Render. Then verify:

- `https://nazarschoolofmath.com` uses HTTPS and loads the new Resources page.
- Application submission reaches Supabase and Resend.
- Portal login routes admin, parent, student, and tutor correctly.
- Password-reset links return to the production site.
- No browser console errors or failed API requests appear.

Record the test application IDs and delete disposable records after verification.


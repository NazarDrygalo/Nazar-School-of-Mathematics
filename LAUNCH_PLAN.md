# Nazar’s School of Mathematics — Launch Plan

## Before launch

1. Maintain the public website: Home, Information, Apply, and Contact pages.
2. Verify application submission on desktop and mobile:
   - Valid applications are stored in Supabase.
   - Nazar receives the Resend notification at the Resend account email.
   - Validation and failure messages are clear.
3. Configure the production environment with `RESEND_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
4. Run both Supabase migrations, then create Nazar’s Auth user and assign the `admin` role.
5. Use the Portal Login to review applications and update their status.
6. Before publishing, replace the phone placeholder and complete a final end-to-end form test.

## After launch

1. Build the parent portal: child schedule, tutoring updates, and contact information.
2. Build the tutor portal: assigned students, sessions, availability, and notes.
3. Build the student portal: sessions, resources, assignments, and goals.
4. Add only the operational features that real families need: scheduling, attendance, notifications, resources, and progress tracking.

## Product principle

The public website remains focused on trust and applications. Private data and operations stay behind authenticated, role-based dashboards protected by Supabase Row Level Security.

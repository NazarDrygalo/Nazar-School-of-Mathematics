# Nazar’s School of Mathematics

Professional landing site and parent application form for online mathematics tutoring for grades 5–12.

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

## Editing business content

Update `src/content.ts` to change the business name, email, phone number, grade range, available subjects, and FAQ answers.

## Deployment

Build with `npm run build`, then deploy the repository to any Node 20+ host using `npm start`. Set the environment variables in the host configuration and do not commit `.env`.

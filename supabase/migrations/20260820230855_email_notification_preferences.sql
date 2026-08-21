create table if not exists public.email_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_updates boolean not null default true,
  session_reminders boolean not null default true,
  assignment_updates boolean not null default true,
  progress_updates boolean not null default true,
  weekly_digest boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.email_notification_preferences enable row level security;

revoke all on table public.email_notification_preferences from public, anon, authenticated;
grant select, insert, update on table public.email_notification_preferences to authenticated;
grant select, insert, update, delete on table public.email_notification_preferences to service_role;

create policy "Users can view their email preferences"
on public.email_notification_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their email preferences"
on public.email_notification_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their email preferences"
on public.email_notification_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop trigger if exists set_email_notification_preferences_updated_at on public.email_notification_preferences;
create trigger set_email_notification_preferences_updated_at
before update on public.email_notification_preferences
for each row execute function public.set_updated_at();

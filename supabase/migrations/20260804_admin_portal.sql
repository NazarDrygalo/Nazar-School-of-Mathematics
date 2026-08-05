-- Secure administrator portal. Run after 20260731_initial_tutoring_platform.sql.

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'parent', 'student', 'tutor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_user_role_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists user_roles_set_updated_at on public.user_roles;
create trigger user_roles_set_updated_at before update on public.user_roles
for each row execute function public.set_user_role_updated_at();

-- Security-definer function prevents policy recursion and never exposes role rows.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon;
grant select on public.user_roles to authenticated;

drop policy if exists "users read their own role" on public.user_roles;
create policy "users read their own role" on public.user_roles
for select to authenticated using (user_id = auth.uid());

drop policy if exists "admins read roles" on public.user_roles;
create policy "admins read roles" on public.user_roles
for select to authenticated using (public.is_admin());

-- The admin portal can review and update applications, and read associated records.
drop policy if exists "admins read parents" on public.parents;
create policy "admins read parents" on public.parents
for select to authenticated using (public.is_admin());

drop policy if exists "admins read students" on public.students;
create policy "admins read students" on public.students
for select to authenticated using (public.is_admin());

drop policy if exists "admins read applications" on public.applications;
create policy "admins read applications" on public.applications
for select to authenticated using (public.is_admin());

drop policy if exists "admins update applications" on public.applications;
create policy "admins update applications" on public.applications
for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- After creating Nazar’s user in Authentication > Users, run this once,
-- replacing the UUID with that user’s ID:
-- insert into public.user_roles (user_id, role) values ('YOUR_AUTH_USER_UUID', 'admin')
-- on conflict (user_id) do update set role = excluded.role;

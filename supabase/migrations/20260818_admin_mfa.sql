-- Require an AAL2 (multi-factor authenticated) JWT for every administrator
-- database policy that relies on public.is_admin().
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    and exists (
      select 1
      from public.user_roles
      where user_id = auth.uid() and role = 'admin'
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

comment on function public.is_admin() is
  'Returns true only for administrator users whose current session has completed MFA (AAL2).';

-- Administrator management for tutor operational records.
-- Auth invitations remain a separate deliberate Supabase Authentication step.

grant insert, update on public.tutors to authenticated;

drop policy if exists "admins create tutors" on public.tutors;
create policy "admins create tutors" on public.tutors
for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update tutors" on public.tutors;
create policy "admins update tutors" on public.tutors
for update to authenticated using (public.is_admin()) with check (public.is_admin());


-- Cache auth.uid() once per statement in existing RLS policies instead of
-- evaluating it for every candidate row. Access behavior remains unchanged.
-- Run after 20260820130000_database_security_cleanup.sql.

do $$
declare
  policy_record record;
  altered_qual text;
  altered_check text;
  statement text;
begin
  for policy_record in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%auth.uid()%'
      )
  loop
    altered_qual := replace(policy_record.qual, 'auth.uid()', '(select auth.uid())');
    altered_check := replace(policy_record.with_check, 'auth.uid()', '(select auth.uid())');
    statement := format(
      'alter policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    if altered_qual is not null then
      statement := statement || ' using (' || altered_qual || ')';
    end if;
    if altered_check is not null then
      statement := statement || ' with check (' || altered_check || ')';
    end if;

    execute statement;
  end loop;
end;
$$;

comment on schema public is
  'Application tables are protected by role-specific RLS policies; auth lookups are cached once per statement.';

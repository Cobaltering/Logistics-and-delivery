-- Promote an existing Auth account to Administrator.
-- 1. Create/sign up an account first in Supabase Authentication > Users.
-- 2. Replace the email below with that account's exact email address.
-- 3. Run this SQL only after applying sql/03_existing_schema_update.sql.
-- The query returns the updated profile. No password or service-role key belongs here.

update public.users
set role_id = (
      select role_id
      from public.roles
      where role_name = 'Administrator'
    ),
    status = 'active'
where lower(email) = lower('replace-with-your-admin-email@example.com')
returning user_id, full_name, email, status;

-- If the query returns no rows, this email has not been registered in Supabase Auth yet,
-- or the signup trigger has not created its public.users profile.

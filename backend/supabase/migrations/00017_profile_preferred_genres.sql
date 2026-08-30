-- 00017_profile_preferred_genres.sql
--
-- `feed` selects `profiles.onboarding_purpose, preferred_genres` and uses the
-- second to weight personalised sections. The column was never created, so
-- PostgREST answered 42703 and every authenticated call to the feed function
-- returned HTTP 500. The Home tab has been broken for as long as `feed` has
-- existed; it went unnoticed because `feed` had never been deployed.
--
-- Additive and nullable-with-default, so it is safe to apply to a live table.

alter table public.profiles
  add column if not exists preferred_genres text[] not null default '{}';

comment on column public.profiles.preferred_genres is
  'Genre slugs chosen during onboarding; read by the feed function to weight personalised sections. Empty array means no preference expressed.';

-- The feed reads this column for the requesting user through the service role,
-- but the owner must also be able to read and write their own preferences once
-- the onboarding flow lands. `profiles` already grants the row to its owner via
-- RLS; this only widens the column-level UPDATE grant to include the new column.
do $$
begin
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'profiles'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ) then
    grant update (preferred_genres) on public.profiles to authenticated;
  end if;
end $$;

-- Restrict public profile reads to display-safe fields and improve title search.
-- This forward migration supersedes broad grants introduced with the initial RLS setup.

revoke select on public.profiles from anon, authenticated;
grant select (id, username, avatar_url)
    on public.profiles to anon, authenticated;

create or replace view public.public_profiles
with (security_invoker = true, security_barrier = true)
as
select id, username, avatar_url
from public.profiles;

revoke all on public.public_profiles from public;
grant select on public.public_profiles to anon, authenticated;

revoke update (status) on public.stories from authenticated;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_stories_title_trgm
    on public.stories
    using gin (title extensions.gin_trgm_ops);

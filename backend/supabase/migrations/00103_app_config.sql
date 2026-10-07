-- Migration 00103: the remote app-version switch.
--
-- One row per store platform, read by the app at launch (and on returning to
-- the foreground) to decide whether the installed build may keep running:
--
--   installed <  minimum_supported_version  -> a blocking "Update required"
--                                              screen with a link to the store
--   installed <  latest_version             -> a dismissable "New version" prompt
--   otherwise                               -> nothing
--
-- WHY A TABLE AND NOT A BUILD SETTING. The point is to force users onto a
-- newer build WITHOUT shipping one: changing `minimum_supported_version` here
-- (table editor or one SQL update) takes effect on every installed app at its
-- next launch, with no deploy and no store review. Store updates themselves
-- stay the stores' job: the app never downloads or installs a binary.
--
-- READ BY ANYONE, WRITTEN BY NOBODY BUT THE SERVICE ROLE. The app reads it with
-- the public anon key before anyone has signed in, so `select` is granted to
-- anon and authenticated under an always-true RLS policy. There is nothing
-- private in it. Writes are service-role only (the dashboard and SQL editor
-- run as an owner role, which bypasses RLS).
--
-- Versions are dotted numeric strings ("1.10.0"), compared NUMERICALLY by the
-- client (`expo/src/lib/app-version.ts`), never as text. The check constraint
-- keeps a typo from shipping a value the client would have to guess about.

create table if not exists public.app_config (
    platform text primary key check (platform in ('android', 'ios')),
    minimum_supported_version text not null
        check (minimum_supported_version ~ '^\d+(\.\d+){0,3}$'),
    latest_version text not null
        check (latest_version ~ '^\d+(\.\d+){0,3}$'),
    store_url text not null check (store_url ~ '^https://'),
    updated_at timestamptz not null default now()
);

comment on table public.app_config is
    'Remote app-version switch (00103). Raise minimum_supported_version to force an update; raise latest_version to offer one. Read by the app with the anon key.';

alter table public.app_config enable row level security;

drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config
    for select to anon, authenticated using (true);

revoke all on table public.app_config from public, anon, authenticated;
grant select on table public.app_config to anon, authenticated;
grant select, insert, update, delete on table public.app_config to service_role;

create or replace function public.touch_app_config_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := pg_catalog.now();
    return new;
end;
$$;

drop trigger if exists app_config_touch_updated_at on public.app_config;
create trigger app_config_touch_updated_at
    before update on public.app_config
    for each row execute function public.touch_app_config_updated_at();

-- The first build anyone installs is 1.0.1 (versionCode 4). Nothing is forced
-- or offered until these are raised.
insert into public.app_config (platform, minimum_supported_version, latest_version, store_url)
values
    ('android', '1.0.1', '1.0.1',
     'https://play.google.com/store/apps/details?id=ai.katha.createstories')
on conflict (platform) do nothing;

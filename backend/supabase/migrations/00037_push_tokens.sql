-- Migration 00037: push notification tokens
--
-- Generation is asynchronous and takes real time, so "we will tell you when it
-- is ready" is the one honest reason to ask for the permission. This is where
-- the resulting token lives.
--
-- One row per device token, not per user: a user with a phone and a tablet must
-- receive the notification on both, and a reinstall issues a fresh token that
-- must not orphan the old row forever. `expo_token` is the primary key so a
-- token that migrates between accounts lands on one row rather than two.

create table if not exists public.push_tokens (
    expo_token text primary key
        check (expo_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
    user_id uuid not null references auth.users (id) on delete cascade,
    platform text not null check (platform in ('ios', 'android')),
    device_id text,
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now()
);

create index if not exists push_tokens_user_id_idx
    on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- A user may see and remove their own tokens; only the service role writes
-- them, because registration happens through an edge function that also has to
-- reconcile the token against a different account.
create policy push_tokens_select_own on public.push_tokens
    for select to authenticated
    using ((select auth.uid()) = user_id);

create policy push_tokens_delete_own on public.push_tokens
    for delete to authenticated
    using ((select auth.uid()) = user_id);

revoke all on table public.push_tokens from public, anon;
grant select, delete on table public.push_tokens to authenticated;

-- Upsert on the token, not on (user_id, token). A device handed to another
-- person keeps its Expo token, and the row must follow the account that
-- registered it last or the previous owner keeps receiving the notifications.
create or replace function public.register_push_token(
    p_user_id uuid,
    p_expo_token text,
    p_platform text,
    p_device_id text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.push_tokens (user_id, expo_token, platform, device_id)
    values (p_user_id, p_expo_token, p_platform, p_device_id)
    on conflict (expo_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        device_id = coalesce(excluded.device_id, public.push_tokens.device_id),
        updated_at = pg_catalog.now();
end;
$$;

revoke all on function public.register_push_token(uuid, text, text, text)
    from public, anon, authenticated;
grant execute on function public.register_push_token(uuid, text, text, text)
    to service_role;

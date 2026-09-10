-- Migration 00074: a deleted account must stay deleted, and a calendar is not
-- readable just because you can name a UUID.
--
-- Both found by review on PR #88, and both are the same mistake in different
-- places: a check that was applied where the feature was ADDED and not where
-- the data was already reachable.
--
-- 1. THE TOMBSTONE CAN BE WRITTEN BACK TO LIFE.
--
-- `delete_account` (00070) scrubs the profile and sets `deleted_at`, and the
-- edge function then deletes the `auth.users` row so nobody can sign in. That
-- second step is a separate call and can fail -- the function reports it and
-- carries on, because the private data is already gone by then.
--
-- But if it fails, the account can still authenticate, and every profile
-- writer would happily accept its edits: `set_display_name`, `set_profile_bio`
-- and `set_avatar` update by id with no notion of a tombstone, and
-- `claim_username` would let it take a handle again. A deleted person could
-- put their name back on the byline of stories that were supposed to have
-- stopped being theirs.
--
-- So the refusal moves to where it cannot be skipped. `public_profile`
-- already ignores tombstones (00072); now nothing can write to one either.
--
-- 2. ANY UUID BUYS ANY CALENDAR.
--
-- `activity_calendar` (00072) was opened up to take an author id so the public
-- profile could draw somebody else's grid, which is the GitHub convention and
-- was the intent. What it actually did was let any authenticated caller name
-- any account and receive the days that person was active -- including someone
-- who has never published anything and has no public profile at all. "When is
-- this person usually online" is not a fact a private reader offers to
-- strangers by existing.
--
-- The rule is now the one the rest of the public surface uses: the calendar is
-- yours, or it belongs to somebody with a public profile. `p_viewer_id` makes
-- the caller explicit rather than implied.

create or replace function public.set_display_name(
    p_user_id uuid,
    p_display_name text
) returns table(display_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    v_name := nullif(pg_catalog.btrim(coalesce(p_display_name, '')), '');
    if pg_catalog.length(coalesce(v_name, '')) > 60 then
        raise exception 'display name is too long';
    end if;

    update public.profiles
    set display_name = v_name
    where id = p_user_id
      and deleted_at is null;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select v_name;
end;
$$;

create or replace function public.set_profile_bio(
    p_user_id uuid,
    p_bio text
) returns table(bio text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_bio text;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    v_bio := nullif(pg_catalog.btrim(coalesce(p_bio, '')), '');
    if pg_catalog.length(coalesce(v_bio, '')) > 200 then
        raise exception 'bio is too long';
    end if;

    update public.profiles
    set bio = v_bio
    where id = p_user_id
      and deleted_at is null;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select v_bio;
end;
$$;

/**
 * The days somebody was active, if they are somebody you may look at.
 *
 * Your own calendar always. Somebody else's only when they have a public
 * profile -- the same `deleted_at is null` plus published-work predicate the
 * rest of the public surface uses. An account nobody can visit has no grid to
 * show, which is the honest answer rather than an empty one.
 */
create or replace function public.activity_calendar(
    p_user_id uuid,
    p_days integer default 365,
    p_viewer_id uuid default null
) returns table(day date)
language sql
stable
security definer
set search_path = ''
as $$
    select a.day
    from public.activity_days a
    where a.user_id = p_user_id
      and (
        -- Yours.
        (p_viewer_id is not null and p_viewer_id = p_user_id)
        -- Or a person with a page a stranger could already open.
        or exists (
            select 1
            from public.profiles p
            where p.id = p_user_id
              and p.deleted_at is null
              and exists (
                    select 1 from public.stories st
                    where st.author_id = p.id
                      and st.is_public = true
                      and st.status = 'complete'
                      and st.entity_gate_reason is null
                      and coalesce(st.content_rating, '') <> 'explicit'
                )
        )
      )
      and a.day > ((now() at time zone 'UTC')::date
                   - least(greatest(coalesce(p_days, 365), 1), 400))
    order by a.day desc;
$$;

drop function if exists public.activity_calendar(uuid, integer);

revoke all on function public.activity_calendar(uuid, integer, uuid)
    from public, anon, authenticated;
grant execute on function public.activity_calendar(uuid, integer, uuid)
    to service_role;

revoke all on function public.set_display_name(uuid, text)
    from public, anon, authenticated;
grant execute on function public.set_display_name(uuid, text) to service_role;

revoke all on function public.set_profile_bio(uuid, text)
    from public, anon, authenticated;
grant execute on function public.set_profile_bio(uuid, text) to service_role;

-- 3. THE SAME GUARD ON THE OTHER TWO WRITERS.
--
-- `set_avatar` and `claim_username` are the remaining ways a profile row can
-- be given something identifying. Both now refuse a tombstone, for the reason
-- above: the deletion is not finished until nothing can undo it.

create or replace function public.set_avatar(
    p_user_id uuid,
    p_storage_path text,
    p_public_url text
) returns table(avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_user_id is null or p_storage_path is null or p_public_url is null then
        raise exception 'user_id, storage_path and public_url are required';
    end if;

    if p_storage_path !~ ('^' || p_user_id::text || '/[A-Za-z0-9._-]+$') then
        raise exception 'storage_path must live under the owner''s folder';
    end if;

    if pg_catalog.strpos(p_public_url, p_storage_path) = 0 then
        raise exception 'public_url must address storage_path';
    end if;

    update public.profiles
    set avatar_url = p_public_url
    where id = p_user_id
      and deleted_at is null;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select p_public_url;
end;
$$;

create or replace function public.claim_username(
    p_user_id uuid,
    p_username text
) returns table(ok boolean, reason text, username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate text;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    v_candidate := lower(pg_catalog.btrim(coalesce(p_username, '')));

    if v_candidate !~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$' then
        return query select false, 'invalid'::text, null::text;
        return;
    end if;

    -- Already theirs: claiming your own handle is a no-op success, not a
    -- collision. Without this the owner re-saving an unchanged form would be
    -- told their own name is taken.
    -- A tombstone is not a person and may not take a handle. Without this a
    -- deleted account whose auth row outlived the deletion could put its name
    -- back on bylines that had stopped being its own.
    if exists (
        select 1 from public.profiles
        where id = p_user_id and deleted_at is not null
    ) then
        return query select false, 'invalid'::text, null::text;
        return;
    end if;

    if exists (
        select 1 from public.profiles
        where id = p_user_id and profiles.username = v_candidate
    ) then
        return query select true, null::text, v_candidate;
        return;
    end if;

    begin
        update public.profiles
        set username = v_candidate
        where id = p_user_id;

        if not found then
            return query select false, 'invalid'::text, null::text;
            return;
        end if;
    exception
        when unique_violation then
            return query select false, 'taken'::text, null::text;
            return;
        when check_violation then
            -- The reserved-name constraint is the only check this statement
            -- can trip that the regex above has not already caught.
            return query select false, 'reserved'::text, null::text;
            return;
    end;

    return query select true, null::text, v_candidate;
end;
$$;

revoke all on function public.set_avatar(uuid, text, text)
    from public, anon, authenticated;
grant execute on function public.set_avatar(uuid, text, text) to service_role;

revoke all on function public.claim_username(uuid, text)
    from public, anon, authenticated;
grant execute on function public.claim_username(uuid, text) to service_role;

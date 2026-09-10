-- Migration 00060: profile identity, avatars, and the numbers a profile may show
--
-- Three things land here, and they belong together because they are all the
-- same surface: the profile a reader can finally edit and the profile a
-- stranger can finally look at.
--
--   1. A handle that is genuinely reserved. `profiles.username` has been
--      `text unique` since 00001 and nothing has ever written it. Before it
--      becomes user-editable it needs a shape, a case-insensitive reservation,
--      and a single write path.
--   2. An avatar the owner picks. `profiles.avatar_url` has existed just as
--      long and was equally unused; the bytes need somewhere to live.
--   3. Two read functions that answer "what may this profile show?" once, in
--      one place, so the private/public boundary is not re-derived by every
--      caller that wants a number.
--
-- Nothing here backfills or renames an existing handle. Every profile in the
-- database has `username = null` today, so the constraints below are satisfied
-- trivially by every existing row.

-- ---------------------------------------------------------------------------
-- 1. The handle
-- ---------------------------------------------------------------------------

-- The shape. Lowercase because a handle that differs from another only by case
-- is a phishing primitive, not a feature; 3-20 because shorter is not a name
-- and longer does not fit a byline. Interior underscores only, so a handle
-- cannot be padded with invisible-looking edges to imitate another one.
alter table public.profiles
  drop constraint if exists profiles_username_shape;
alter table public.profiles
  add constraint profiles_username_shape
  check (
    username is null
    or username ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$'
  )
  not valid;

-- Reserved handles, enforced where they cannot be argued with.
--
-- A reserved list that lives only in application code is not a reservation: it
-- is a convention that the next writer of the table has no way of knowing
-- about. These are the names that would let an account impersonate the product
-- or a staff channel, so they are a CHECK constraint on the column itself and
-- every write path -- RPC, service role, a psql session -- is bound by it.
--
-- Every entry is at least three characters. The shape constraint above already
-- refuses anything shorter, so a two-letter word listed here would be refused
-- as "invalid" rather than "reserved" -- two rules disagreeing about the same
-- refusal, and a message that tells the user the wrong thing to try next.
alter table public.profiles
  drop constraint if exists profiles_username_not_reserved;
alter table public.profiles
  add constraint profiles_username_not_reserved
  check (
    username is null
    or username not in (
      'katha', 'kathaai', 'katha_ai', 'admin', 'administrator', 'root',
      'support', 'help', 'staff', 'team', 'official', 'moderator', 'mod',
      'system', 'security', 'billing', 'about', 'settings', 'login',
      'signup', 'you', 'null', 'undefined', 'anonymous', 'guest'
    )
  )
  not valid;

-- Both constraints are trivially true of every existing row (all null), so
-- they are validated immediately rather than left NOT VALID indefinitely.
alter table public.profiles validate constraint profiles_username_shape;
alter table public.profiles validate constraint profiles_username_not_reserved;

-- The reservation itself.
--
-- The column-level `unique` from 00001 is case-sensitive, which the shape
-- constraint above makes redundant rather than sufficient: it is the index
-- that has to be the authority, because it is what turns a lost race into a
-- 23505 instead of two people holding the same handle. Kept alongside the
-- original unique so neither has to be dropped on a live table.
create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(username))
  where username is not null;

-- A short line about the person, shown on their public profile.
alter table public.profiles
  add column if not exists bio text;

alter table public.profiles
  drop constraint if exists profiles_bio_length;
alter table public.profiles
  add constraint profiles_bio_length
  check (bio is null or length(bio) <= 200);

comment on column public.profiles.bio is
  'Owner-written line shown on their public profile. Never longer than 200 characters; null means the profile shows no bio rather than an empty one.';

-- The single write path.
--
-- 00038 granted `authenticated` UPDATE on (username, avatar_url,
-- onboarding_purpose, preferred_genres). Two of those four are now
-- server-derived and must leave that list:
--
--   * `username` is claimed through `claim_username` below, which normalizes,
--     validates and reports a lost race honestly. A client that could UPDATE
--     the column directly would simply route around all three.
--   * `avatar_url` must point at an object in our own `avatars` bucket that
--     belongs to the person it is on. A client that can write the column can
--     point their avatar at any URL on the internet -- someone else's avatar,
--     a tracking pixel served to everyone who opens their profile -- and the
--     upload endpoint is what makes that impossible.
--
-- `bio` joins the grant: it is genuinely the owner's text, capped by the
-- constraint above, and needs no server derivation.
revoke update on public.profiles from authenticated;
grant update (
    onboarding_purpose,
    preferred_genres,
    bio
) on public.profiles to authenticated;

/**
 * Claim a handle, or say honestly why it could not be claimed.
 *
 * Returns `(ok, reason, username)`. `reason` is one of 'taken', 'invalid',
 * 'reserved' or null.
 *
 * WHY THE INSERT IS TRIED RATHER THAN THE AVAILABILITY CHECKED. A
 * "is this free?" query answers about a moment that has already passed by the
 * time the UPDATE runs. Two people typing the same handle at the same time
 * both see it free and one of them gets a raw 23505 out of PostgREST, which
 * the client has no way to tell apart from any other write failure. So the
 * write is attempted and the unique violation is *caught* and named. The
 * pre-check exists only to give a fast, friendly answer in the common case;
 * the exception handler is what makes the answer true.
 */
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

/**
 * Point a profile at an avatar we stored ourselves.
 *
 * Takes a storage *path*, not a URL, and refuses any path that is not under
 * the caller's own folder. The endpoint builds the public URL from the path it
 * just uploaded to; this function is the second lock, so a bug in the endpoint
 * cannot put an arbitrary URL on a profile.
 */
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
    where id = p_user_id;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select p_public_url;
end;
$$;

/**
 * Set the owner's bio.
 *
 * `bio` is in the `authenticated` UPDATE grant above, so this is not the only
 * way to write it -- it exists so the profile endpoint, which already holds
 * the service role for the rest of its work, does not need a second
 * user-scoped client just for one column. Trimming and the empty-string-to-null
 * collapse live here so the column never holds an empty string that renders as
 * a blank line under someone's name.
 */
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

    v_bio := pg_catalog.nullif(pg_catalog.btrim(coalesce(p_bio, '')), '');
    if pg_catalog.length(coalesce(v_bio, '')) > 200 then
        raise exception 'bio is too long';
    end if;

    update public.profiles
    set bio = v_bio
    where id = p_user_id;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select v_bio;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The numbers
-- ---------------------------------------------------------------------------

/**
 * Everything the owner's own profile shows, counted rather than estimated.
 *
 * One function because the alternative is eight round trips from the endpoint,
 * each of which is a place for a number to be counted a slightly different way
 * from the one next to it. Every value here is a count or a sum over a row
 * that exists; nothing is derived from an assumption.
 *
 * Streak values come from `streaks`, which `touch_streak` (00046) maintains.
 * A reader who has never had a streak row gets zeros, which is the truth:
 * zero days, not "unknown".
 */
create or replace function public.profile_overview(
    p_user_id uuid
) returns table(
    username text,
    avatar_url text,
    bio text,
    member_since timestamptz,
    current_streak integer,
    longest_streak integer,
    last_activity_date date,
    stories_written integer,
    chapters_written integer,
    total_reads integer,
    total_likes integer,
    phrases_saved integer,
    followers integer,
    following integer
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        p.username,
        p.avatar_url,
        p.bio,
        coalesce(p.account_created_at, p.created_at),
        coalesce(s.current_streak, 0),
        coalesce(s.longest_streak, 0),
        s.last_activity_date,
        coalesce((
            select count(*)::integer from public.stories st
            where st.author_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer
            from public.chapters ch
            join public.stories st on st.id = ch.story_id
            where st.author_id = p.id
        ), 0),
        coalesce((
            select sum(coalesce(st.read_count, 0))::integer
            from public.stories st where st.author_id = p.id
        ), 0),
        coalesce((
            select sum(coalesce(st.like_count, 0))::integer
            from public.stories st where st.author_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer from public.saved_phrases sp
            where sp.user_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer from public.user_followers uf
            where uf.author_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer from public.user_followers uf
            where uf.follower_id = p.id
        ), 0)
    from public.profiles p
    left join public.streaks s on s.user_id = p.id
    where p.id = p_user_id;
$$;

/**
 * What a stranger may see, and nothing else.
 *
 * The `is_public and status = 'complete' and entity_gate_reason is null and
 * content_rating <> 'explicit'` predicate is repeated deliberately in every
 * subquery below, and it is the same predicate the list endpoint uses to
 * choose which stories to show. That is the point: the count and the list are
 * the same set, so a visitor never reads "12 stories" above a list of nine and
 * wonders what the other three are.
 *
 * `entity_gate_reason is null` is redundant today -- 00050's
 * `stories_entity_gate_forces_private` already makes a gated story private --
 * and it stays anyway. A story kept private because it names a real living
 * person is the single worst thing that could leak from this function, and it
 * should not depend on a constraint in another file staying exactly as it is.
 *
 * Deliberately absent, and deliberately not computed anywhere in this
 * function: credits, drafts, private and gated stories, saved phrases,
 * streaks, reading history, and who they follow. Every one of those is the
 * owner's own business and none of it is flattering enough to be worth the
 * exposure.
 */
create or replace function public.public_profile(
    p_author_id uuid,
    p_viewer_id uuid default null
) returns table(
    author_id uuid,
    username text,
    avatar_url text,
    bio text,
    member_since timestamptz,
    first_published_at timestamptz,
    stories_published integer,
    total_reads integer,
    total_likes integer,
    followers integer,
    is_following boolean
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        p.id,
        p.username,
        p.avatar_url,
        p.bio,
        coalesce(p.account_created_at, p.created_at),
        (
            select min(st.created_at) from public.stories st
            where st.author_id = p.id
              and st.is_public = true
              and st.status = 'complete'
              and st.entity_gate_reason is null
              and coalesce(st.content_rating, '') <> 'explicit'
        ),
        coalesce((
            select count(*)::integer from public.stories st
            where st.author_id = p.id
              and st.is_public = true
              and st.status = 'complete'
              and st.entity_gate_reason is null
              and coalesce(st.content_rating, '') <> 'explicit'
        ), 0),
        coalesce((
            select sum(coalesce(st.read_count, 0))::integer
            from public.stories st
            where st.author_id = p.id
              and st.is_public = true
              and st.status = 'complete'
              and st.entity_gate_reason is null
              and coalesce(st.content_rating, '') <> 'explicit'
        ), 0),
        coalesce((
            select sum(coalesce(st.like_count, 0))::integer
            from public.stories st
            where st.author_id = p.id
              and st.is_public = true
              and st.status = 'complete'
              and st.entity_gate_reason is null
              and coalesce(st.content_rating, '') <> 'explicit'
        ), 0),
        coalesce((
            select count(*)::integer from public.user_followers uf
            where uf.author_id = p.id
        ), 0),
        case
            when p_viewer_id is null then false
            else exists (
                select 1 from public.user_followers uf
                where uf.author_id = p.id and uf.follower_id = p_viewer_id
            )
        end
    from public.profiles p
    where p.id = p_author_id;
$$;

-- Every one of these is service-role only, the same posture 00046 gives the
-- engagement RPCs: the endpoint holds the service key and has already
-- established who is calling. A user JWT reaching these directly would be
-- passing its own `p_user_id`, which is exactly the parameter that must not be
-- attacker-controlled.
revoke all on function public.claim_username(uuid, text) from public;
revoke all on function public.set_avatar(uuid, text, text) from public;
revoke all on function public.set_profile_bio(uuid, text) from public;
revoke all on function public.profile_overview(uuid) from public;
revoke all on function public.public_profile(uuid, uuid) from public;

grant execute on function public.claim_username(uuid, text) to service_role;
grant execute on function public.set_avatar(uuid, text, text) to service_role;
grant execute on function public.set_profile_bio(uuid, text) to service_role;
grant execute on function public.profile_overview(uuid) to service_role;
grant execute on function public.public_profile(uuid, uuid) to service_role;

-- Counting an author's stories is now a per-request operation on two surfaces.
create index if not exists idx_stories_author_public
  on public.stories (author_id, created_at desc)
  where is_public = true and status = 'complete';

-- ---------------------------------------------------------------------------
-- 3. The avatar bucket
-- ---------------------------------------------------------------------------
--
-- Guarded, because `storage.buckets` is part of the Supabase platform schema
-- and does not exist in the PGlite harness every migration test in this
-- directory runs against. On a real project this creates the bucket and its
-- policies; in a test database it is a no-op and the rest of the migration
-- still applies. `backend/build-log.md` records what to check by hand.
--
-- Public read, because an avatar appears next to a byline on a story anyone
-- can read, and a signed URL per byline per feed page is a lot of round trips
-- for a picture that is already public by intent.
--
-- Owner-only write, by folder: the object key is `<user id>/<file>`, and the
-- policies below compare the first path segment to `auth.uid()`. Uploads go
-- through the service role today, so these policies are the floor rather than
-- the path in use -- which is the right way round. If a direct-from-client
-- upload is ever added it is already safe, and until then nothing holding a
-- user JWT can write into anyone's folder, their own included.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent; skipping avatars bucket (test harness)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars',
    'avatars',
    true,
    2097152,
    array['image/jpeg', 'image/png', 'image/webp']
  )
  on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  execute $policy$
    drop policy if exists "Avatars are publicly readable" on storage.objects
  $policy$;
  execute $policy$
    create policy "Avatars are publicly readable"
      on storage.objects for select
      using (bucket_id = 'avatars')
  $policy$;

  execute $policy$
    drop policy if exists "Owners write their own avatar" on storage.objects
  $policy$;
  execute $policy$
    create policy "Owners write their own avatar"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $policy$;

  execute $policy$
    drop policy if exists "Owners replace their own avatar" on storage.objects
  $policy$;
  execute $policy$
    create policy "Owners replace their own avatar"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $policy$;

  execute $policy$
    drop policy if exists "Owners delete their own avatar" on storage.objects
  $policy$;
  execute $policy$
    create policy "Owners delete their own avatar"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $policy$;
end $$;

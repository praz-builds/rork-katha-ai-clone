-- Migration 00072: what the two profiles need to show.
--
-- The owner's profile stops being a wall of numbers and becomes three things
-- in order -- Premium, Credits, Your journey -- with everything else below.
-- The public profile becomes what a stranger sees: an activity calendar,
-- follower counts, and the comments this person has left around the app.
--
-- Four changes, all additive:
--
-- 1. `profile_overview` returns `display_name` (00069) and `following_count`
--    is joined by `deleted_at`, so the client can tell a live account from a
--    tombstone without a second query.
--
-- 2. `activity_calendar` -- the day-by-day grid, from `activity_days` (00069).
--
-- 3. `profile_comments` -- what somebody has said, for their public page.
--
-- 4. `public_profile` refuses a tombstone. A deleted account keeps its row so
--    its stories still resolve; it must not keep a page.

drop function if exists public.profile_overview(uuid);

create or replace function public.profile_overview(
    p_user_id uuid
) returns table(
    username text,
    display_name text,
    avatar_url text,
    bio text,
    member_since timestamptz,
    deleted_at timestamptz,
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
        p.display_name,
        p.avatar_url,
        p.bio,
        coalesce(p.account_created_at, p.created_at),
        p.deleted_at,
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
 * The days this person was active, most recent first.
 *
 * `p_days` bounds the window the way the grid does -- a year of squares is
 * 365 rows, which is small enough to send whole and large enough that an
 * unbounded version would eventually be a mistake.
 *
 * Own-calendar only in effect: the endpoint passes the caller's own id for
 * their journey screen, and a viewer's id is checked against the subject
 * before this is called for a public page. There is nothing sensitive in a
 * date, but "when is this person usually online" is a pattern, and it is not
 * one to hand out by author id to anybody who asks.
 */
create or replace function public.activity_calendar(
    p_user_id uuid,
    p_days integer default 365
) returns table(day date)
language sql
stable
security definer
set search_path = ''
as $$
    select a.day
    from public.activity_days a
    where a.user_id = p_user_id
      and a.day > ((now() at time zone 'UTC')::date
                   - least(greatest(coalesce(p_days, 365), 1), 400))
    order by a.day desc;
$$;

/**
 * Comments this person has left, for their public profile.
 *
 * Visibility is the story's, not the comment's. A comment on a private or
 * gated story is not public just because its author is: the same predicate
 * `public_profile` uses for story counts is applied here, so a profile can
 * never become a way to read around the visibility of the thing being
 * discussed. Soft-deleted comments (00043 scrubs the content and keeps the
 * row so threads survive) are excluded -- there is nothing left to show.
 */
create or replace function public.profile_comments(
    p_author_id uuid,
    p_limit integer default 20
) returns table(
    comment_id uuid,
    story_id uuid,
    story_title text,
    chapter_number integer,
    content text,
    score integer,
    created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        c.id,
        st.id,
        st.title,
        ch.chapter_number,
        c.content,
        coalesce(c.score, 0),
        c.created_at
    from public.comments c
    join public.stories st on st.id = c.story_id
    left join public.chapters ch on ch.id = c.chapter_id
    where c.user_id = p_author_id
      and c.deleted_at is null
      and st.is_public = true
      and st.status = 'complete'
      and st.entity_gate_reason is null
      and coalesce(st.content_rating, '') <> 'explicit'
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- A tombstone keeps its stories and loses its page. Without this the public
-- profile of a deleted account is a real page with a blank name, no avatar and
-- a live follow button.
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
    where p.id = p_author_id
      and p.deleted_at is null;
$$;


/**
 * Set what this person is called.
 *
 * A sibling of `set_profile_bio` rather than a direct column write, for the
 * same reason: the trim-and-collapse rule lives in one place, so the column
 * can never hold an empty string that renders as a blank greeting. Length is
 * the only other rule -- a name is not a handle, and this function has no
 * business rejecting apostrophes, accents or scripts.
 */
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
    where id = p_user_id;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select v_name;
end;
$$;

revoke all on function public.set_display_name(uuid, text)
    from public, anon, authenticated;
grant execute on function public.set_display_name(uuid, text) to service_role;

revoke all on function public.profile_overview(uuid)
    from public, anon, authenticated;
grant execute on function public.profile_overview(uuid) to service_role;

revoke all on function public.activity_calendar(uuid, integer)
    from public, anon, authenticated;
grant execute on function public.activity_calendar(uuid, integer) to service_role;

revoke all on function public.profile_comments(uuid, integer)
    from public, anon, authenticated;
grant execute on function public.profile_comments(uuid, integer) to service_role;

revoke all on function public.public_profile(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.public_profile(uuid, uuid) to service_role;

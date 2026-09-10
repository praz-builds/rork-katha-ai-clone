-- Migration 00073: the public profile counts both directions.
--
-- `public_profile` returned `followers` and not `following`, because the page
-- it fed showed four numbers -- published, reads, likes, followers -- and a
-- follower count was the only relationship among them.
--
-- The page has changed. Reads and likes are gone from it: they are a
-- scoreboard, and a profile is a person rather than a performance. What is
-- left is the pair that describes how somebody sits among other people, and a
-- page that shows one half of a reciprocal relationship and not the other is
-- oddly one-sided -- it says who is interested in them and hides who they are
-- interested in.
--
-- Body otherwise unchanged from 00072, including the `deleted_at is null`
-- guard that keeps a tombstone from having a page at all.

drop function if exists public.public_profile(uuid, uuid);

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
    following integer,
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
        coalesce((
            select count(*)::integer from public.user_followers uf
            where uf.follower_id = p.id
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

revoke all on function public.public_profile(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.public_profile(uuid, uuid) to service_role;

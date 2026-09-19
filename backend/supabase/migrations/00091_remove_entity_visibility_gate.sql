-- Migration 00091: the entity visibility gate is removed.
--
-- Product decision from the owner, 2026-09-18: remove the privacy gating
-- completely for the MVP. A writer's publish toggle is honoured.
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
-- Migration 00050 made a story whose idea named a `living_public_figure` or a
-- `private_individual` private for good: the edge functions wrote the class to
-- `stories.entity_gate_reason`, and `stories_entity_gate_forces_private` made a
-- public row with a reason set invalid. On paper that was a narrow rule. In
-- practice every name on a character sheet is classified `private_individual`
-- -- `entity-classify.ts` forces it, because the writer's own sheet is the sole
-- authority on who a character is -- so every story with a named cast, which
-- is nearly every story, could never be published. The switch in the brief
-- said "public" and the story stayed private. That is the product lying to
-- the person using it, and the owner chose the toggle over the gate.
--
-- The classification itself stays. It still fills `grounding_entities`
-- (00045) and `entity_classification_status` (00058), it still keeps a cast
-- member's name out of every search query, and nothing about it is a
-- permission any more.
--
-- ---------------------------------------------------------------------------
-- What this does
-- ---------------------------------------------------------------------------
--   1. Drops both 00050 constraints: the one that forced a gated row private,
--      and the one that limited the column to the two gating classes. The
--      second has nothing left to protect once nothing reads the column, and
--      keeping it would only mean a lagging edge function deploy could still
--      fail a write over a value nobody uses.
--   2. Clears `entity_gate_reason` on every row. The column is left in place,
--      nullable and unused, so an older client build that still selects it
--      gets `null` rather than a PostgREST error on an unknown column.
--   3. Re-issues the three profile functions whose predicates carried an
--      `entity_gate_reason is null` clause -- `public_profile` (latest body
--      00073), `profile_comments` (00072) and `activity_calendar` (00074) --
--      with that clause removed and every other line unchanged. After step 2
--      the clause is always true, so this changes no result today; it is done
--      so that nothing in the schema still gates on a column nothing writes,
--      and so the byline predicate stays character-for-character the one
--      `_shared/profile.ts`'s `readPublicStories` uses (it lost the same
--      clause in the same commit).
--
-- What this deliberately does NOT do: drop the column (older clients read
-- it), or touch `fork_story` (00057). A fork copies every column generically,
-- so it now copies a null; it never needed the gate's name to do that.
--
-- Nothing is made public by this migration. A story the gate kept private is
-- still `is_public = false` afterwards; its writer can now publish it.

alter table public.stories
  drop constraint if exists stories_entity_gate_forces_private;
alter table public.stories
  drop constraint if exists stories_entity_gate_reason_is_valid;

update public.stories
   set entity_gate_reason = null
 where entity_gate_reason is not null;

comment on column public.stories.entity_gate_reason is
  'UNUSED since migration 00091 (2026-09-18). Was the entity visibility gate''s reason (00050); the gate was removed and every value cleared. Kept, always null, only so older clients that still select it do not break. Do not write to it and do not read it.';

comment on column public.stories.entity_classification_status is
  'Did the server''s entity classification produce a verdict for this story? ''ok'' = it ran and grounding_entities holds its answer (an empty list then genuinely means "names nobody"). ''unavailable'' = provider failure, deadline, unparseable output or a refused rate-limit claim. null = generated before migration 00058. Since 00091 this is a record only: it no longer affects whether a story may be published.';

-- ---------------------------------------------------------------------------
-- public_profile: 00073's body, minus the entity-gate clause.
-- ---------------------------------------------------------------------------
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
              and coalesce(st.content_rating, '') <> 'explicit'
        ),
        coalesce((
            select count(*)::integer from public.stories st
            where st.author_id = p.id
              and st.is_public = true
              and st.status = 'complete'
              and coalesce(st.content_rating, '') <> 'explicit'
        ), 0),
        coalesce((
            select sum(coalesce(st.read_count, 0))::integer
            from public.stories st
            where st.author_id = p.id
              and st.is_public = true
              and st.status = 'complete'
              and coalesce(st.content_rating, '') <> 'explicit'
        ), 0),
        coalesce((
            select sum(coalesce(st.like_count, 0))::integer
            from public.stories st
            where st.author_id = p.id
              and st.is_public = true
              and st.status = 'complete'
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

-- ---------------------------------------------------------------------------
-- profile_comments: 00072's body, minus the entity-gate clause. Visibility is
-- still the story's, not the comment's.
-- ---------------------------------------------------------------------------
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
      and coalesce(st.content_rating, '') <> 'explicit'
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.profile_comments(uuid, integer)
    from public, anon, authenticated;
grant execute on function public.profile_comments(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- activity_calendar: 00074's body, minus the entity-gate clause.
-- ---------------------------------------------------------------------------
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
                      and coalesce(st.content_rating, '') <> 'explicit'
                )
        )
      )
      and a.day > ((now() at time zone 'UTC')::date
                   - least(greatest(coalesce(p_days, 365), 1), 400))
    order by a.day desc;
$$;

revoke all on function public.activity_calendar(uuid, integer, uuid)
    from public, anon, authenticated;
grant execute on function public.activity_calendar(uuid, integer, uuid)
    to service_role;

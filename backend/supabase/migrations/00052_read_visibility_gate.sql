-- Migration 00051: record_story_read only counts a read the caller could
-- actually read.
--
-- `record_story_read` (00046) accepted any existing story and chapter from
-- any authenticated caller: it checked the chapter belonged to the story,
-- but never checked the caller could read either one. Reads are engagement
-- data that is meant to eventually inform ranking and earnings, so any
-- authenticated user could inflate `stories.read_count` on a story that was
-- private to them -- draft, unpublished, someone else's unlisted work, all
-- of it -- simply by knowing (or guessing) its id.
--
-- `save_phrase` (00047) already draws the correct line for "can this caller
-- see this story": `is_public = true or is_curated = true or
-- author_id = p_user_id`, folded straight into the row lookup so a private
-- story a non-author asks about looks exactly like one that does not exist
-- -- no separate "exists but you can't see it" signal leaks out. This
-- migration gives `record_story_read` that same predicate, plus the
-- narration path's existing rule (`canReadChapter` in
-- `_shared/narration-audio.ts`) that a non-author additionally needs the
-- specific chapter to be published, since a public story can still have
-- unpublished draft chapters sitting on it.
--
-- The author's own path is untouched: `author_id = p_user_id` in the same
-- predicate means an author reading their own story -- published or not,
-- public or not -- still records a read, still with
-- `counts_for_earnings = false`, exactly as 00046 already had it.
create or replace function public.record_story_read(
    p_user_id uuid,
    p_story_id uuid,
    p_chapter_id uuid,
    p_duration_seconds integer,
    p_device_id text,
    p_ip_hash text
) returns table(
    recorded boolean,
    counted boolean,
    count integer,
    read_id uuid,
    is_own_story boolean,
    counts_for_earnings boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_author_id uuid;
    v_read_id uuid;
    v_is_own_story boolean;
    v_counts_for_earnings boolean;
    v_count integer;
    v_chapter_published boolean;
begin
    if p_user_id is null or p_story_id is null then
        raise exception 'user_id and story_id are required';
    end if;

    if p_duration_seconds is not null and
       (p_duration_seconds < 0 or p_duration_seconds > 86400) then
        raise exception 'duration_seconds is out of range';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'story_read:' || p_user_id::text || ':' ||
            coalesce(p_chapter_id::text, p_story_id::text),
            0
        )
    );

    -- A private, unpublished or someone-else's-unlisted story a non-author
    -- asks about is filtered out by this predicate exactly the way a story
    -- that does not exist at all would be -- both raise the same
    -- 'Story not found' below, so the error message cannot be used to probe
    -- for the existence of a story the caller cannot see.
    select author_id, read_count into v_author_id, v_count
    from public.stories
    where id = p_story_id
      and (is_public = true or is_curated = true or author_id = p_user_id)
    for update;

    if not found then
        raise exception 'Story not found';
    end if;

    if p_chapter_id is not null then
        select is_published into v_chapter_published
        from public.chapters
        where id = p_chapter_id and story_id = p_story_id;

        if not found then
            raise exception 'Chapter does not belong to story';
        end if;

        -- The story-level check above allows a public/curated story through
        -- regardless of which of its chapters are published yet; a
        -- non-author still needs the specific chapter to be readable.
        -- The author's own draft chapters are exempt, same as everywhere
        -- else chapter readability is decided.
        -- `is distinct from`, not `<>`. A null `author_id` makes `<>` evaluate to
        -- NULL rather than true, so the `if` never fires and an unpublished
        -- chapter is accepted for a non-author -- the exact case this guard
        -- exists to refuse. Three-valued logic turns a security check into a
        -- no-op precisely when the data is unusual.
        if v_author_id is distinct from p_user_id
           and not coalesce(v_chapter_published, false) then
            raise exception 'Story not found';
        end if;
    end if;

    select sr.id, sr.is_own_story, sr.counts_for_earnings
    into v_read_id, v_is_own_story, v_counts_for_earnings
    from public.story_reads sr
    where sr.user_id = p_user_id
      and sr.story_id = p_story_id
      and (
          (p_chapter_id is null and sr.chapter_id is null)
          or sr.chapter_id = p_chapter_id
      )
      and sr.read_at > now() - interval '24 hours'
    order by sr.read_at desc
    limit 1;

    if v_read_id is not null then
        return query select
            false,
            false,
            coalesce(v_count, 0),
            v_read_id,
            v_is_own_story,
            v_counts_for_earnings;
        return;
    end if;

    v_is_own_story := (v_author_id = p_user_id);
    v_counts_for_earnings := not v_is_own_story;

    insert into public.story_reads (
        story_id,
        chapter_id,
        user_id,
        device_id,
        ip_hash,
        duration_seconds,
        is_own_story,
        counts_for_earnings
    ) values (
        p_story_id,
        p_chapter_id,
        p_user_id,
        nullif(pg_catalog.btrim(p_device_id), ''),
        nullif(pg_catalog.btrim(p_ip_hash), ''),
        p_duration_seconds,
        v_is_own_story,
        v_counts_for_earnings
    )
    returning id into v_read_id;

    if v_counts_for_earnings then
        update public.stories
        set read_count = coalesce(read_count, 0) + 1
        where id = p_story_id
        returning read_count into v_count;
    end if;

    return query select
        true,
        v_counts_for_earnings,
        coalesce(v_count, 0),
        v_read_id,
        v_is_own_story,
        v_counts_for_earnings;
end;
$$;

revoke all on function public.record_story_read(uuid, uuid, uuid, integer, text, text) from public;
grant execute on function public.record_story_read(uuid, uuid, uuid, integer, text, text) to service_role;

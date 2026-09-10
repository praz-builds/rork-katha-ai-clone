-- Migration 00064: the column the Library has been asking for and the
-- sequential scan every bookmark tap has been paying for.
--
-- `stories.bookmark_count` does not exist. `like_count`, `read_count`,
-- `comment_count`, `share_count` and `follower_count` were all added together
-- in 00003; the bookmark counterpart was not, and 00057 later wrote a
-- `bookmark_count` key into a `jsonb_build_object` that `jsonb_populate_record`
-- silently discards, which is as close as it ever came to existing.
--
-- The client asks for it by name in two places, and both fail with
-- 42703 on production today:
--
--   * `SHELF_STORY_COLUMNS` (expo/src/lib/api.ts), used by `fetchOwnShelf`
--     and `fetchStarredShelf`. PostgREST rejects the whole select, both
--     functions return `{ ok: false }`, and the Library's "Created" and
--     "Starred" shelves are empty for every user -- including a writer
--     looking for the story they just finished.
--
--   * `STORY_COLUMNS` (expo/src/lib/search.ts), used by `searchStories`,
--     which catches the error and falls back to the bundled seed catalogue.
--     Search has therefore never once searched real stories; it has been
--     answering from fixtures, convincingly, since the day it shipped.
--
-- Adding the column rather than deleting the two references, because the
-- product asks for the number (`Story.bookmarks`) and because the read that
-- stands in for it today is the more expensive half of this file.
--
-- `toggle_bookmark` (00046) ends with `select count(*) from bookmarks where
-- story_id = ...`. `bookmarks` is keyed `(user_id, story_id)` and 00003 gave
-- it only `idx_bookmarks_user`, so nothing indexes `story_id` -- the sibling
-- `story_likes` got `idx_story_likes_story` in the same migration and
-- `bookmarks` was missed. That count is a sequential scan of the entire
-- bookmarks table on EVERY bookmark tap by EVERY user, and the same missing
-- index makes the delete cascade scan it again whenever a story is removed.
--
-- So: the counter is maintained incrementally, exactly as `toggle_story_follow`
-- already does, under the advisory lock and the `for update` on the story row
-- that the function already takes; and the index is created anyway, because
-- the cascade still needs it and a counter can drift while a scan cannot.
--
-- Non-concurrent CREATE INDEX is deliberate here: `bookmarks` is empty on this
-- project today, and `db push` wraps a migration file in a transaction, where
-- CONCURRENTLY is not permitted.

alter table public.stories
    add column if not exists bookmark_count integer not null default 0;

comment on column public.stories.bookmark_count is
    'Number of readers who have this story saved. Maintained incrementally by toggle_bookmark under the story advisory lock, the same way follower_count is; never recomputed on the read path. Added in 00064, four migrations of client code after the client began selecting it.';

create index if not exists idx_bookmarks_story
    on public.bookmarks (story_id);

-- Backfill before the function starts trusting the column. One scan, once,
-- while the table is small.
update public.stories s
   set bookmark_count = coalesce(b.total, 0)
  from (
        select story_id, count(*)::integer as total
          from public.bookmarks
         group by story_id
       ) b
 where b.story_id = s.id
   and s.bookmark_count is distinct from b.total;

create or replace function public.toggle_bookmark(
    p_user_id uuid,
    p_story_id uuid,
    p_on boolean
) returns table("on" boolean, count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rows integer;
    v_count integer;
begin
    if p_user_id is null or p_story_id is null or p_on is null then
        raise exception 'user_id, story_id and on are required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('story_engagement:' || p_story_id::text, 0)
    );

    -- Same shape as toggle_story_follow: read the counter under the row lock
    -- that already serialises this story's engagement writes, so the
    -- increment below cannot race another tap.
    select bookmark_count into v_count
    from public.stories
    where id = p_story_id
    for update;

    if not found then
        raise exception 'Story not found';
    end if;

    v_count := coalesce(v_count, 0);

    if p_on then
        insert into public.bookmarks(user_id, story_id)
        values (p_user_id, p_story_id)
        on conflict do nothing;
        get diagnostics v_rows = row_count;

        -- `on conflict do nothing` means a second tap from the same reader
        -- inserts no row. Counting only real inserts is what keeps the
        -- counter honest when a client retries.
        if v_rows > 0 then
            v_count := v_count + 1;
            update public.stories
               set bookmark_count = v_count
             where id = p_story_id;
        end if;
    else
        delete from public.bookmarks
        where user_id = p_user_id and story_id = p_story_id;
        get diagnostics v_rows = row_count;

        if v_rows > 0 then
            -- greatest(...) so a counter that has drifted below the truth for
            -- any reason cannot go negative and show a reader "-1 saved".
            -- `greatest` is a parser construct, not a schema-qualified function, so it
            -- resolves under `search_path = ''''` exactly like `coalesce` does.
            v_count := greatest(v_count - 1, 0);
            update public.stories
               set bookmark_count = v_count
             where id = p_story_id;
        end if;
    end if;

    return query select p_on, v_count;
end;
$$;

revoke all on function public.toggle_bookmark(uuid, uuid, boolean)
    from public, anon, authenticated;
grant execute on function public.toggle_bookmark(uuid, uuid, boolean)
    to service_role;

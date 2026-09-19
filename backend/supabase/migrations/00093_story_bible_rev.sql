-- The story bible gains a revision counter, so a merge cannot silently lose a
-- chapter's facts to a concurrent one.
--
-- `story_bible` is written by a read-modify-write: `continue-story` reads the
-- story row when the request arrives, and writes the merged bible from inside
-- `EdgeRuntime.waitUntil` after the chapter has been delivered. Between those
-- two points sits an entire generation -- forty to sixty seconds -- and with
-- `story_flow: "auto"` the next chapter starts as soon as the previous one is
-- done. So chapter N+1 could read the bible before chapter N's deferred write
-- landed, and then overwrite it. Nothing failed; chapter N's facts simply
-- stopped existing, which is the one thing an append-only record must never
-- do.
--
-- The counter is what makes the write conditional: a caller updates only while
-- the revision it merged against is still the current one, and re-reads and
-- re-merges when it is not. `0` for every existing row, and for the stories
-- written before 00092 whose bible is still NULL.
alter table public.stories
  add column if not exists story_bible_rev integer not null default 0;

comment on column public.stories.story_bible_rev is
  'Revision counter for story_bible, incremented by every accepted merge. Read it with the bible and write back only while it is unchanged (compare-and-swap); a mismatch means another chapter merged first and this merge must be recomputed against the newer bible. Never sent to a client.';

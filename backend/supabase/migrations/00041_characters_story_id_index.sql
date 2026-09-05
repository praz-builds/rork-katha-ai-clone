-- Migration 00041: index characters.story_id
--
-- Postgres indexes the referenced side of a foreign key automatically and the
-- referencing side never. `characters.story_id` has been unindexed since 00001,
-- while the cast is read by story id on every read of a story, every publish,
-- and every cast regeneration -- three sequential scans of the whole table per
-- story opened.
--
-- Plain CREATE INDEX, not CONCURRENTLY: a concurrent build cannot run inside a
-- transaction block, and `characters` is small enough today that the brief
-- lock costs less than splitting this into its own out-of-band step.

create index if not exists characters_story_id_idx
    on public.characters (story_id);

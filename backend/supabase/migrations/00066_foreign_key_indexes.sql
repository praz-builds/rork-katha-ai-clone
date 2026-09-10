-- Migration 00066: the indexes Postgres does not create for you.
--
-- 00041 stated the rule -- "a foreign key does not create an index on the
-- referencing side" -- and then applied it to exactly one column,
-- `characters.story_id`. Every other FK added since 00001 is still bare. That
-- is invisible on this project today, where the largest table has tens of
-- rows, and it is invisible right up until it is not: an unindexed FK turns
-- every parent delete into a sequential scan of the child table, and turns
-- any query that filters or joins on that column into the same.
--
-- These are the ones on the paths that will actually be walked:
--
--   * `comments.chapter_id` / `comments.user_id` -- both FKs are RESTRICT
--     (no ON DELETE clause), so each one is scanned in full before a chapter
--     or a profile can be deleted. `comments.user_id` has only a partial
--     index `(user_id, request_id) where request_id is not null`, which the
--     planner cannot use for the constraint check.
--   * `story_reads.chapter_id` -- covered only as the second column of
--     `(user_id, chapter_id, read_at)`, useless for a chapter cascade.
--   * `saved_phrases.story_id` / `.chapter_id` / `.phrase_id` and
--     `phrase_practice.saved_phrase_id` -- four cascades, no indexes.
--   * `content_reports.reporter_id` -- cascade on profile delete.
--   * `generation_operations.story_id` / `.result_chapter_id` -- indexed only
--     by the partial unique on reserved rows, so a story cascade scans the
--     whole operations table, which grows by one row per paid action forever.
--   * `user_characters.source_story_id` and `characters.saved_character_id`
--     -- both SET NULL, both scanned.
--   * `error_events.user_id` -- no FK at all, but 00025's erasure trigger and
--     `prune_error_event_user_ids` both filter on it, and the table is
--     append-only and unbounded. This is the one that would time out first.
--
-- `bookmarks.story_id` is not here; 00064 adds it alongside the counter that
-- needed it.
--
-- All non-concurrent, because `db push` runs each migration file inside a
-- transaction and CONCURRENTLY is not permitted there. That is safe now, at
-- this size, and this is the last comfortable moment to do it: the same
-- statements against a live table with real volume take an ACCESS SHARE lock
-- that blocks writes for the duration of the build, and would need to be run
-- by hand, outside a migration, one at a time.

create index if not exists idx_comments_chapter
    on public.comments (chapter_id);

create index if not exists idx_comments_user
    on public.comments (user_id);

create index if not exists idx_story_reads_chapter
    on public.story_reads (chapter_id);

create index if not exists idx_saved_phrases_story
    on public.saved_phrases (story_id);

create index if not exists idx_saved_phrases_chapter
    on public.saved_phrases (chapter_id);

create index if not exists idx_saved_phrases_phrase
    on public.saved_phrases (phrase_id);

create index if not exists idx_phrase_practice_saved_phrase
    on public.phrase_practice (saved_phrase_id);

create index if not exists idx_content_reports_reporter
    on public.content_reports (reporter_id);

create index if not exists idx_generation_operations_story
    on public.generation_operations (story_id);

create index if not exists idx_generation_operations_result_chapter
    on public.generation_operations (result_chapter_id);

create index if not exists idx_user_characters_source_story
    on public.user_characters (source_story_id);

create index if not exists idx_characters_saved_character
    on public.characters (saved_character_id);

create index if not exists idx_error_events_user
    on public.error_events (user_id);

-- Migration 00011: Validate the series-state CHECK constraints added in 00010
--
-- 00010 adds stories_story_mode_check, chapters_chapter_role_check, and
-- chapters_hook_type_check as NOT VALID, which takes only a brief
-- ACCESS EXCLUSIVE lock and skips the table scan.
--
-- Validation is split into this separate migration on purpose. supabase db push
-- runs each migration file in a single transaction, so validating inside 00010
-- would hold that migration's ACCESS EXCLUSIVE lock until commit and provide no
-- concurrency benefit. Because 00010 commits first, the scans below run under
-- their own SHARE UPDATE EXCLUSIVE lock, which does not block concurrent reads
-- or writes.
--
-- VALIDATE CONSTRAINT is idempotent: revalidating an already-valid constraint
-- is a no-op.

ALTER TABLE public.stories
  VALIDATE CONSTRAINT stories_story_mode_check;

ALTER TABLE public.chapters
  VALIDATE CONSTRAINT chapters_chapter_role_check;

ALTER TABLE public.chapters
  VALIDATE CONSTRAINT chapters_hook_type_check;

-- Migration 00028: validate the NOT VALID constraint added in 00027
--
-- Split out for the same reason 00011 was split from 00010: `supabase db push`
-- runs each migration file in a single transaction, so validating inside 00027
-- would hold that migration's ACCESS EXCLUSIVE lock for the duration of the
-- scan and provide no concurrency benefit. Because 00027 commits first, the
-- scan below runs under its own SHARE UPDATE EXCLUSIVE lock, which does not
-- block concurrent reads or writes.
--
-- VALIDATE CONSTRAINT is idempotent: revalidating an already-valid constraint
-- is a no-op.
--
-- This is expected to succeed trivially. planned_chapter_count was added in
-- 00003 and has never been written by any code path, so every existing row
-- holds NULL, which the constraint admits.

ALTER TABLE public.stories
  VALIDATE CONSTRAINT stories_planned_chapter_count_check;

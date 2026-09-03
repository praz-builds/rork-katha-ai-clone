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
-- ⚠ PRECONDITION, not a consequence.
--
-- The two constraints being validated here are not alike:
--
--   generation_operations_kind_check is a WIDENING - it adds 'cover',
--   'chapter_art' and 'characters' to a set that already held every existing
--   row's value. Validation cannot fail.
--
--   stories_planned_chapter_count_check is RESTRICTING - a column that was a
--   free integer may now only hold NULL, 3, 7 or 15. Validation CAN fail.
--
-- planned_chapter_count was added in migration 00003 and is written by no code
-- path in this repository, so every row is expected to hold NULL. That
-- expectation was not verified against the live database. Check it first:
--
--   select count(*) from public.stories
--   where planned_chapter_count is not null
--     and planned_chapter_count not in (3, 7, 15);
--
-- A non-zero result must be reconciled before this migration runs, or it will
-- abort partway and leave the kind constraint unvalidated.

-- Fail loudly and specifically, rather than letting VALIDATE CONSTRAINT abort
-- with a generic message that does not say which column or how many rows.
DO $$
DECLARE
    v_bad bigint;
BEGIN
    SELECT pg_catalog.count(*) INTO v_bad
    FROM public.stories
    WHERE planned_chapter_count IS NOT NULL
      AND planned_chapter_count NOT IN (3, 7, 15);

    IF v_bad > 0 THEN
        RAISE EXCEPTION
            'Cannot validate stories_planned_chapter_count_check: % row(s) hold a planned_chapter_count outside (3, 7, 15). Reconcile them first; see migration 00027.',
            v_bad;
    END IF;
END
$$;

ALTER TABLE public.stories
  VALIDATE CONSTRAINT stories_planned_chapter_count_check;

-- Both constraints from 00027. generation_operations_kind_check is a widening,
-- so this cannot fail; it is validated here rather than in 00027 so the scan
-- does not hold that migration's ACCESS EXCLUSIVE lock on a table every
-- generation writes to.
ALTER TABLE public.generation_operations
  VALIDATE CONSTRAINT generation_operations_kind_check;

-- Migration 00014: Re-apply the migration 00008 story taxonomy columns
--
-- 00008 is recorded in supabase_migrations.schema_migrations as applied, but
-- none of its eight columns exist on public.stories. The drift is isolated to
-- 00008: every other migration's columns are present, including 00009's
-- story_mode/series_state on stories and chapter_role/hook_type on chapters.
--
-- The effect was that generate-story returned HTTP 500 on every request. Its
-- first write inserts audience_mode, primary_genre, spice_level, identity_lenses
-- and trope_modules, which failed with 42703 "column does not exist" and was
-- swallowed by the handler's catch-all. complete_story_generation would have
-- failed the same way on content_rating, first_line and previously_summary.
--
-- This migration re-applies 00008 steps 1-10 verbatim. Every statement is
-- idempotent, so it is a no-op on any database where 00008 did land. Step 11 of
-- 00008 replaced complete_story_generation; that is deliberately not repeated
-- here because 00010 already supersedes it.

-- Step 1: Add the taxonomy columns
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS primary_genre text,
  ADD COLUMN IF NOT EXISTS audience_mode text NOT NULL DEFAULT 'adult'
    CHECK (audience_mode IN ('adult', 'kids')),
  ADD COLUMN IF NOT EXISTS identity_lenses text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trope_modules text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS spice_level text NOT NULL DEFAULT 'sweet'
    CHECK (spice_level IN ('sweet', 'steamy', 'explicit')),
  ADD COLUMN IF NOT EXISTS content_rating text NOT NULL DEFAULT 'sweet'
    CHECK (content_rating IN ('sweet', 'steamy', 'explicit', 'kids')),
  ADD COLUMN IF NOT EXISTS first_line text,
  ADD COLUMN IF NOT EXISTS previously_summary text;

-- Step 2: Backfill primary_genre from genre[1]
UPDATE public.stories SET primary_genre = genre[1]
  WHERE primary_genre IS NULL
    AND genre IS NOT NULL
    AND array_length(genre, 1) > 0;

-- Step 3: Remap deprecated genres
UPDATE public.stories SET primary_genre = 'contemporary'
  WHERE primary_genre IN ('drama', 'sliceOfLife', 'sliceoflife', 'darkAcademia', 'darkacademia', 'lgbtq', 'motivational', 'spirituality');

UPDATE public.stories SET primary_genre = 'fantasy'
  WHERE primary_genre IN ('mythology');

UPDATE public.stories SET primary_genre = 'adventure'
  WHERE primary_genre IN ('kids', 'bedtime');

UPDATE public.stories SET primary_genre = 'contemporary'
  WHERE primary_genre IS NOT NULL
    AND primary_genre NOT IN (
      'romance','romantasy','darkRomance','cozyFantasy','paranormalRomance',
      'fantasy','scifi','thriller','mystery','horror',
      'contemporary','historical','adventure','comedy','poetry'
    );

-- Step 4: audience_mode for kids/bedtime stories
UPDATE public.stories SET audience_mode = 'kids'
  WHERE 'kids' = ANY(genre) OR 'bedtime' = ANY(genre);

-- Step 5: content_rating for kids stories
UPDATE public.stories SET content_rating = 'kids'
  WHERE audience_mode = 'kids';

-- Step 6: Migrate the LGBTQ+ identity lens
--
-- 00008 assigned ARRAY['queer'] outright. Replaying that on a database that
-- already carries taxonomy data would drop every other lens from any story
-- still holding the legacy 'lgbtq' genre, and validation.ts supports multiple
-- lenses. Merge instead, and skip rows that already have it.
UPDATE public.stories
SET identity_lenses = (
  SELECT ARRAY(
    SELECT DISTINCT unnest(COALESCE(identity_lenses, '{}') || ARRAY['queer'])
  )
)
WHERE 'lgbtq' = ANY(genre)
  AND NOT ('queer' = ANY(COALESCE(identity_lenses, '{}')));

-- Step 7: Default any remaining NULL primary_genre
UPDATE public.stories SET primary_genre = 'contemporary'
  WHERE primary_genre IS NULL;

-- Step 8: primary_genre becomes NOT NULL (runs after the backfill above)
ALTER TABLE public.stories ALTER COLUMN primary_genre SET NOT NULL;

-- Step 9: Genre CHECK constraint, added NOT VALID then validated separately
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stories_primary_genre_check'
  ) THEN
    ALTER TABLE public.stories ADD CONSTRAINT stories_primary_genre_check
      CHECK (primary_genre IN (
        'romance','romantasy','darkRomance','cozyFantasy','paranormalRomance',
        'fantasy','scifi','thriller','mystery','horror',
        'contemporary','historical','adventure','comedy','poetry'
      )) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.stories VALIDATE CONSTRAINT stories_primary_genre_check;

-- Step 10: Indexes
CREATE INDEX IF NOT EXISTS idx_stories_primary_genre ON public.stories(primary_genre, status);
CREATE INDEX IF NOT EXISTS idx_stories_content_rating ON public.stories(content_rating) WHERE content_rating != 'sweet';

-- Ask PostgREST to reload its schema cache so the new columns are queryable
-- immediately rather than after the next DDL event.
NOTIFY pgrst, 'reload schema';

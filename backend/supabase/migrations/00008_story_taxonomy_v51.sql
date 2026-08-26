-- Migration 00008: Story taxonomy v5.1
--
-- Adds primary_genre, audience_mode, identity_lenses, trope_modules,
-- spice_level, content_rating, first_line, previously_summary columns.
-- Backfills from existing genre[] column and migration map.
-- Replaces complete_story_generation RPC with extended signature.

-- Step 1: Add new columns
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

-- Step 3: Remap deprecated genres (case-sensitive and lowercase variants)
UPDATE public.stories SET primary_genre = 'contemporary'
  WHERE primary_genre IN ('drama', 'sliceOfLife', 'sliceoflife', 'darkAcademia', 'darkacademia', 'lgbtq', 'motivational', 'spirituality');

UPDATE public.stories SET primary_genre = 'fantasy'
  WHERE primary_genre IN ('mythology');

UPDATE public.stories SET primary_genre = 'adventure'
  WHERE primary_genre IN ('kids', 'bedtime');

-- Catch any remaining values not in the allowed set
UPDATE public.stories SET primary_genre = 'contemporary'
  WHERE primary_genre NOT IN (
    'romance','romantasy','darkRomance','cozyFantasy','paranormalRomance',
    'fantasy','scifi','thriller','mystery','horror',
    'contemporary','historical','adventure','comedy','poetry'
  );

-- Step 4: Set audience_mode for kids/bedtime stories
UPDATE public.stories SET audience_mode = 'kids'
  WHERE 'kids' = ANY(genre) OR 'bedtime' = ANY(genre);

-- Step 5: Set content_rating for kids stories
UPDATE public.stories SET content_rating = 'kids'
  WHERE audience_mode = 'kids';

-- Step 6: Migrate LGBTQ+ identity lens
UPDATE public.stories SET identity_lenses = ARRAY['queer']
  WHERE 'lgbtq' = ANY(genre);

-- Step 7: Default remaining NULL primary_genre
UPDATE public.stories SET primary_genre = 'contemporary'
  WHERE primary_genre IS NULL;

-- Step 8: Make primary_genre NOT NULL
ALTER TABLE public.stories ALTER COLUMN primary_genre SET NOT NULL;

-- Step 9: Add CHECK constraint for valid genres (NOT VALID for reduced locking, then validate)
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

-- Step 10: Add indexes
CREATE INDEX IF NOT EXISTS idx_stories_primary_genre ON public.stories(primary_genre, status);
CREATE INDEX IF NOT EXISTS idx_stories_content_rating ON public.stories(content_rating) WHERE content_rating != 'sweet';

-- Step 11: Replace complete_story_generation with extended signature
-- Drop old function first to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.complete_story_generation(uuid, uuid, uuid, text, text, integer);

CREATE FUNCTION public.complete_story_generation(
    p_operation_id uuid,
    p_story_id uuid,
    p_author_id uuid,
    p_title text,
    p_content text,
    p_word_count integer,
    p_themes text[] DEFAULT '{}',
    p_first_line text DEFAULT NULL,
    p_previously_summary text DEFAULT NULL,
    p_content_rating text DEFAULT 'sweet'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_chapter public.chapters;
BEGIN
    PERFORM 1
    FROM public.generation_operations
    WHERE id = p_operation_id
      AND user_id = p_author_id
      AND story_id = p_story_id
      AND chapter_number = 1
      AND kind = 'story'
      AND status = 'reserved'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserved story operation not found';
    END IF;

    IF p_title IS NULL OR pg_catalog.btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Story title is required';
    END IF;

    IF p_content IS NULL OR pg_catalog.btrim(p_content) = '' THEN
        RAISE EXCEPTION 'Story content is required';
    END IF;

    UPDATE public.stories
    SET title = p_title,
        word_count = p_word_count,
        themes = COALESCE(p_themes, '{}'),
        first_line = p_first_line,
        content_rating = COALESCE(p_content_rating, 'sweet'),
        status = 'complete'
    WHERE id = p_story_id
      AND author_id = p_author_id
      AND status = 'generating';

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            errcode = 'KTH03',
            message = 'Generating story not found';
    END IF;

    INSERT INTO public.chapters (
        story_id,
        chapter_number,
        title,
        content,
        word_count,
        is_published,
        published_at
    ) VALUES (
        p_story_id,
        1,
        'Chapter 1',
        p_content,
        p_word_count,
        false,
        NULL
    ) RETURNING * INTO v_chapter;

    UPDATE public.generation_operations
    SET status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;

    RETURN pg_catalog.to_jsonb(v_chapter);
END;
$$;

-- Step 12: Revoke and grant
REVOKE ALL ON FUNCTION public.complete_story_generation(uuid, uuid, uuid, text, text, integer, text[], text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_story_generation(uuid, uuid, uuid, text, text, integer, text[], text, text, text) TO service_role;

-- Step 13: Comment
COMMENT ON FUNCTION public.complete_story_generation(uuid, uuid, uuid, text, text, integer, text[], text, text, text)
    IS 'Service-only atomic story completion with v5.1 taxonomy fields.';

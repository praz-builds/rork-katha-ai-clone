-- Migration 00010: Harden the series state schema shipped in 00009
--
-- 00009 is already applied to the linked project, so these corrections ship as
-- a follow-up rather than an edit to an applied migration. Every statement is
-- idempotent and safe to re-run.
--
-- 1. Named table-level CHECK constraints for story_mode, chapter_role, and
--    hook_type. 00009 declared them inline on ADD COLUMN IF NOT EXISTS, which
--    silently skips the constraint whenever the column already exists.
-- 2. Corrects the 00009 chapter_role backfill, which evaluated the finale
--    branch before confirming the parent story is a series.
-- 3. Rebuilds both completion RPCs so an invalid hook_type raises like the
--    other enum parameters, and so an absent series_state preserves the stored
--    continuity instead of erasing it.

-- ---------------------------------------------------------------------------
-- 1. Enforce the allowed values regardless of when the columns were created
-- ---------------------------------------------------------------------------

ALTER TABLE public.stories
  DROP CONSTRAINT IF EXISTS stories_story_mode_check;
ALTER TABLE public.stories
  ADD CONSTRAINT stories_story_mode_check
  CHECK (story_mode IN ('standalone', 'series'));

ALTER TABLE public.chapters
  DROP CONSTRAINT IF EXISTS chapters_chapter_role_check;
ALTER TABLE public.chapters
  ADD CONSTRAINT chapters_chapter_role_check
  CHECK (chapter_role IN ('standalone', 'series_opening', 'mid_series', 'finale'));

ALTER TABLE public.chapters
  DROP CONSTRAINT IF EXISTS chapters_hook_type_check;
ALTER TABLE public.chapters
  ADD CONSTRAINT chapters_hook_type_check
  CHECK (hook_type IN (
    'none',
    'revelation',
    'reversal',
    'decision',
    'arrival',
    'betrayal',
    'danger',
    'unanswered_question',
    'emotional_rupture'
  ));

-- ---------------------------------------------------------------------------
-- 2. Repair chapters that the 00009 backfill labelled 'finale' on a
--    non-series story purely because chapter_number >= 7
-- ---------------------------------------------------------------------------

UPDATE public.chapters
SET chapter_role = 'standalone'
WHERE chapter_role = 'finale'
  AND NOT EXISTS (
    SELECT 1
    FROM public.stories s
    WHERE s.id = chapters.story_id
      AND s.story_mode = 'series'
  );

-- ---------------------------------------------------------------------------
-- 3. Rebuild the completion RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_story_generation(
    p_operation_id uuid,
    p_story_id uuid,
    p_author_id uuid,
    p_title text,
    p_content text,
    p_word_count integer,
    p_themes text[] DEFAULT '{}',
    p_first_line text DEFAULT NULL,
    p_previously_summary text DEFAULT NULL,
    p_content_rating text DEFAULT 'sweet',
    p_chapter_title text DEFAULT 'Chapter 1',
    p_story_mode text DEFAULT 'standalone',
    p_chapter_role text DEFAULT 'standalone',
    p_series_state jsonb DEFAULT '{}'::jsonb,
    p_hook_type text DEFAULT 'none',
    p_hook_text text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_chapter public.chapters;
    v_story_mode text := COALESCE(p_story_mode, 'standalone');
    v_chapter_role text := COALESCE(p_chapter_role, 'standalone');
    v_hook_type text := COALESCE(p_hook_type, 'none');
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

    IF v_story_mode NOT IN ('standalone', 'series') THEN
        RAISE EXCEPTION 'Invalid story mode';
    END IF;

    IF v_chapter_role NOT IN ('standalone', 'series_opening', 'mid_series', 'finale') THEN
        RAISE EXCEPTION 'Invalid chapter role';
    END IF;

    -- Reject invalid hook types instead of silently downgrading to 'none',
    -- matching how story mode and chapter role are validated above.
    IF v_hook_type NOT IN (
      'none',
      'revelation',
      'reversal',
      'decision',
      'arrival',
      'betrayal',
      'danger',
      'unanswered_question',
      'emotional_rupture'
    ) THEN
        RAISE EXCEPTION 'Invalid hook type';
    END IF;

    UPDATE public.stories
    SET title = p_title,
        word_count = p_word_count,
        themes = COALESCE(p_themes, '{}'),
        first_line = p_first_line,
        previously_summary = p_previously_summary,
        content_rating = COALESCE(p_content_rating, 'sweet'),
        story_mode = v_story_mode,
        series_state = CASE
          WHEN v_story_mode = 'series' THEN COALESCE(p_series_state, '{}'::jsonb)
          ELSE '{}'::jsonb
        END,
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
        published_at,
        chapter_role,
        first_line,
        previously_summary,
        hook_type,
        hook_text
    ) VALUES (
        p_story_id,
        1,
        COALESCE(NULLIF(pg_catalog.btrim(p_chapter_title), ''), 'Chapter 1'),
        p_content,
        p_word_count,
        false,
        NULL,
        v_chapter_role,
        p_first_line,
        p_previously_summary,
        v_hook_type,
        p_hook_text
    ) RETURNING * INTO v_chapter;

    UPDATE public.generation_operations
    SET status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;

    RETURN pg_catalog.to_jsonb(v_chapter);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_continuation_generation(
    p_operation_id uuid,
    p_user_id uuid,
    p_title text,
    p_content text,
    p_word_count integer,
    p_chapter_role text DEFAULT 'mid_series',
    p_first_line text DEFAULT NULL,
    p_previously_summary text DEFAULT NULL,
    p_series_state jsonb DEFAULT '{}'::jsonb,
    p_hook_type text DEFAULT 'none',
    p_hook_text text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operation public.generation_operations;
    v_chapter public.chapters;
    v_chapter_role text := COALESCE(p_chapter_role, 'mid_series');
    v_hook_type text := COALESCE(p_hook_type, 'none');
BEGIN
    SELECT *
    INTO v_operation
    FROM public.generation_operations
    WHERE id = p_operation_id
      AND user_id = p_user_id
      AND kind = 'continuation'
      AND status = 'reserved'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserved continuation operation not found';
    END IF;

    IF p_content IS NULL OR pg_catalog.btrim(p_content) = '' THEN
        RAISE EXCEPTION 'Chapter content is required';
    END IF;

    IF v_chapter_role NOT IN ('mid_series', 'finale') THEN
        RAISE EXCEPTION 'Invalid continuation chapter role';
    END IF;

    IF v_hook_type NOT IN (
      'none',
      'revelation',
      'reversal',
      'decision',
      'arrival',
      'betrayal',
      'danger',
      'unanswered_question',
      'emotional_rupture'
    ) THEN
        RAISE EXCEPTION 'Invalid hook type';
    END IF;

    INSERT INTO public.chapters (
        story_id,
        chapter_number,
        title,
        content,
        word_count,
        is_published,
        published_at,
        chapter_role,
        first_line,
        previously_summary,
        hook_type,
        hook_text
    ) VALUES (
        v_operation.story_id,
        v_operation.chapter_number,
        COALESCE(NULLIF(pg_catalog.btrim(p_title), ''), 'Chapter ' || v_operation.chapter_number::text),
        p_content,
        p_word_count,
        false,
        NULL,
        v_chapter_role,
        p_first_line,
        p_previously_summary,
        v_hook_type,
        p_hook_text
    ) RETURNING * INTO v_chapter;

    -- An absent or empty series_state must never wipe accumulated continuity.
    UPDATE public.stories
    SET story_mode = 'series',
        series_state = CASE
          WHEN p_series_state IS NULL
            OR p_series_state = '{}'::jsonb
            THEN series_state
          ELSE p_series_state
        END,
        previously_summary = COALESCE(p_previously_summary, previously_summary),
        word_count = COALESCE(word_count, 0) + p_word_count
    WHERE id = v_operation.story_id;

    UPDATE public.generation_operations
    SET status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;

    RETURN pg_catalog.to_jsonb(v_chapter);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Re-assert service-only access on the rebuilt functions
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.complete_story_generation(
  uuid, uuid, uuid, text, text, integer, text[], text, text, text, text, text, text, jsonb, text, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_story_generation(
  uuid, uuid, uuid, text, text, integer, text[], text, text, text, text, text, text, jsonb, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.complete_continuation_generation(
  uuid, uuid, text, text, integer, text, text, text, jsonb, text, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_continuation_generation(
  uuid, uuid, text, text, integer, text, text, text, jsonb, text, text
) TO service_role;

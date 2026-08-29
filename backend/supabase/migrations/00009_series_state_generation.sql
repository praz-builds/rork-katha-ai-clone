-- Migration 00009: Production series state for story generation
--
-- Adds story/chapter mode metadata and a durable series_state JSON object.
-- Extends completion RPCs so generation and continuation update that state
-- atomically under the existing generation operation locks.

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS story_mode text NOT NULL DEFAULT 'standalone'
    CHECK (story_mode IN ('standalone', 'series')),
  ADD COLUMN IF NOT EXISTS series_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS chapter_role text NOT NULL DEFAULT 'standalone'
    CHECK (chapter_role IN ('standalone', 'series_opening', 'mid_series', 'finale')),
  ADD COLUMN IF NOT EXISTS first_line text,
  ADD COLUMN IF NOT EXISTS previously_summary text,
  ADD COLUMN IF NOT EXISTS hook_type text NOT NULL DEFAULT 'none'
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
    )),
  ADD COLUMN IF NOT EXISTS hook_text text;

CREATE INDEX IF NOT EXISTS idx_stories_story_mode
  ON public.stories(story_mode, status);

CREATE INDEX IF NOT EXISTS idx_chapters_story_role
  ON public.chapters(story_id, chapter_role, chapter_number);

UPDATE public.stories
SET story_mode = 'series'
WHERE id IN (
  SELECT story_id
  FROM public.chapters
  GROUP BY story_id
  HAVING count(*) > 1
);

UPDATE public.chapters
SET chapter_role = CASE
  WHEN chapter_number = 1 AND EXISTS (
    SELECT 1
    FROM public.stories s
    WHERE s.id = chapters.story_id
      AND s.story_mode = 'series'
  ) THEN 'series_opening'
  WHEN chapter_number >= 7 THEN 'finale'
  WHEN EXISTS (
    SELECT 1
    FROM public.stories s
    WHERE s.id = chapters.story_id
      AND s.story_mode = 'series'
  ) THEN 'mid_series'
  ELSE 'standalone'
END
WHERE chapter_role = 'standalone';

DROP FUNCTION IF EXISTS public.complete_story_generation(
  uuid, uuid, uuid, text, text, integer, text[], text, text, text
);

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
        v_hook_type := 'none';
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

DROP FUNCTION IF EXISTS public.complete_continuation_generation(
  uuid, uuid, text, text, integer
);

CREATE FUNCTION public.complete_continuation_generation(
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
        v_hook_type := 'none';
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

    UPDATE public.stories
    SET story_mode = 'series',
        series_state = COALESCE(p_series_state, '{}'::jsonb),
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

COMMENT ON FUNCTION public.complete_story_generation(
  uuid, uuid, uuid, text, text, integer, text[], text, text, text, text, text, text, jsonb, text, text
) IS 'Service-only atomic story completion with v5.1 series mode and series state.';

COMMENT ON FUNCTION public.complete_continuation_generation(
  uuid, uuid, text, text, integer, text, text, text, jsonb, text, text
) IS 'Service-only atomic continuation completion that persists chapter hooks and series state.';

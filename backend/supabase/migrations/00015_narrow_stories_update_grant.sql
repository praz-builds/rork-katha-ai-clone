-- Migration 00015: Narrow the authenticated UPDATE grant on public.stories
--
-- 00012 issued a table-level GRANT UPDATE ON public.stories TO authenticated and
-- then re-asserted 00006's REVOKE UPDATE (status). That does not work: in
-- PostgreSQL a column-level REVOKE cannot subtract a column from a table-level
-- grant. The table-level privilege covers every column, so the revoke was a
-- no-op and story owners could set stories.status themselves - exactly what
-- 00006 set out to prevent.
--
-- The Expo client never writes to public.stories directly; every write goes
-- through an edge function using the service role. The owner-update policy from
-- 00002 only needs to cover the fields a story owner edits about their own
-- story, so this grants those columns explicitly and nothing else.
--
-- Server-derived columns are deliberately excluded: status, word_count,
-- author_id, is_curated, credits_earned, and the whole generated taxonomy
-- (primary_genre, audience_mode, identity_lenses, trope_modules, spice_level,
-- content_rating, story_mode, series_state, first_line, previously_summary).

REVOKE UPDATE ON public.stories FROM authenticated;

GRANT UPDATE (
  title,
  topic,
  cover_image_url,
  is_public
) ON public.stories TO authenticated;

-- Re-assert INSERT/SELECT, which the blanket REVOKE above does not touch but
-- which must remain intact for the 00002 policies to function.
GRANT SELECT, INSERT ON public.stories TO authenticated;

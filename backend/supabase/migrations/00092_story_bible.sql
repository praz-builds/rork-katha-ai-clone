-- 00092: the story bible.
--
-- One nullable jsonb column on `stories`, holding the facts a multi-chapter
-- story is not allowed to change: names, ages, counts, dates, who owns what,
-- the clock, the truth, and the scenes already on the page.
--
-- WHY A COLUMN AND NOT A FIELD IN `series_state`.
--
-- `series_state` is a field inside the generation output schema: the model
-- rewrites it in full at the end of every chapter. That is correct for
-- narrative state and is exactly wrong for canonical fact -- a model asked to
-- re-emit a number twelve times paraphrases it twelve times, and a paraphrase
-- of a number is a different number. The 2026-09-18 review of 83 generated
-- stories recorded 289 major issues, most of them a fact that changed between
-- chapters. Putting canon inside a structure the model rewrites would have
-- written that bug into its own fix.
--
-- So the bible is SERVER-OWNED and APPEND-ONLY. The model proposes through a
-- narrow extraction call; `mergeStoryBible` in
-- `functions/_shared/story-bible.ts` appends what is new, ignores what agrees,
-- and REFUSES what conflicts -- a refusal being a detected contradiction rather
-- than a write. Nothing in the database enforces that, and nothing should: it
-- is a merge rule over a document, not a constraint over rows, and expressing
-- it in SQL would put half the rule in a trigger where no test can reach it.
--
-- NULL is a first-class value and means "written before this migration", which
-- every existing story is. It reads as an empty bible (`parseStoryBible`) and
-- such a story generates byte-identically to how it did yesterday.
--
-- The column is never selected by the client. `library`, the feed and the
-- `done` payload all select explicit column lists and none of them names it, so
-- a 5-10 KB document per story costs a reader's device nothing. Service-role
-- reads and writes it; the existing `stories` RLS policies are unchanged and
-- already govern the row.

alter table public.stories
  add column if not exists story_bible jsonb;

comment on column public.stories.story_bible is
  'Append-only, server-owned record of this story''s settled facts: canonical facts, the in-story clock, the fixed truth, and the scenes already shown. Written only by mergeStoryBible in functions/_shared/story-bible.ts; the model proposes and never writes. NULL means the story predates migration 00092 and reads as an empty bible. Never sent to a client.';

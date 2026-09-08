-- Migration 00049: the v7 genre taxonomy adds four genres, removes none
--
-- Product decision (2026-09-08): the creation UI now shows Adventure, Comedy,
-- Educational, Fanfiction, Folktale, Historical, Sci-Fi, Fantasy, Mystery,
-- Horror, Slice of Life, Romance -- in that order, Romance deliberately last.
-- Four of those (Educational, Fanfiction, Folktale, Slice of Life) are new.
-- Seven previously-shown genres (Romantasy, Dark Romance, Paranormal Romance,
-- Cozy Fantasy, Poetry, Thriller, Contemporary) are removed from the UI.
--
-- This migration ONLY WIDENS `stories_primary_genre_check`. It adds the four
-- new values and keeps every one of the fifteen existing values, including
-- the seven now hidden from the UI: stories already carry those values, and
-- narrowing the constraint would break reading, the feed, and continuation of
-- a live series for every story written in one of them. Client-side genre
-- selection is the only place the removal is enforced; `_shared/types.ts`'s
-- `GENRE_MIGRATION_MAP` normalizes a NEW submission of a removed genre to its
-- documented replacement (thriller -> mystery, contemporary -> sliceOfLife,
-- poetry -> folktale, romantasy/darkRomance/paranormalRomance -> romance,
-- cozyFantasy -> fantasy) without touching any stored row.
--
-- A widened CHECK constraint can never fail VALIDATE CONSTRAINT against
-- existing data -- every value a stored row can hold today is a member of the
-- new, larger set -- so this is safe to add-and-validate in one migration,
-- following 00014's precedent for this exact constraint.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stories_primary_genre_check'
  ) THEN
    ALTER TABLE public.stories DROP CONSTRAINT stories_primary_genre_check;
  END IF;

  ALTER TABLE public.stories ADD CONSTRAINT stories_primary_genre_check
    CHECK (primary_genre IN (
      'romance','romantasy','darkRomance','cozyFantasy','paranormalRomance',
      'fantasy','scifi','thriller','mystery','horror',
      'contemporary','historical','adventure','comedy','poetry',
      'educational','fanfiction','folktale','sliceOfLife'
    )) NOT VALID;
END $$;

ALTER TABLE public.stories VALIDATE CONSTRAINT stories_primary_genre_check;

-- Ask PostgREST to reload its schema cache so the new columns are queryable
-- immediately rather than after the next DDL event. This migration adds no
-- columns, but the pattern is followed for consistency with the migrations
-- that share this file's constraint.
NOTIFY pgrst, 'reload schema';

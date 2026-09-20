import {
  CREATION_LANGUAGES,
  UI_GENRES,
  type CreationLanguage,
  type Genre,
  type Story,
} from "@/types/domain";
import type { StudioDraft } from "@/screens/CreateStudioScreen";

/**
 * The brief a reader starts from when they reimagine somebody else's story.
 *
 * WHY THIS IS A SEEDED CREATE AND NOT A REWRITE.
 *
 * Reimagining used to fork the story and rewrite a chapter of the copy. That
 * shape cannot deliver what the button promises. A fork inherits the original's
 * cover and chapter art, so a story reimagined with new people ships with
 * pictures of the old ones; a rename cannot touch pronouns (see
 * `_shared/character-substitution.ts`, which says so in as many words) or any
 * of the prose that describes who somebody is; and the copy carries the
 * original author's id, so the reader's own story did not count as theirs.
 *
 * So the reader does not get a mutated copy. They get a NEW story, written for
 * their characters from the first word, with the original's premise already in
 * the box and every word of it theirs to change. Nothing is forked, nothing is
 * substituted, and the original is untouched because it is never written to.
 *
 * WHAT TRAVELS, AND WHAT DELIBERATELY DOES NOT.
 *
 * What travels is the SHAPE of the story: its premise, its genre, who it was
 * written for, how long it runs. That is the "cultural context" a reader is
 * reaching for when they tap Reimagine on a story they just finished.
 *
 * What does not travel:
 *
 *   * the cast -- the entire point is that the reader brings their own, and a
 *     pre-filled roster of somebody else's characters is the thing they would
 *     have to clear before they could start;
 *   * `beats` and `grounding` -- those are the ORIGINAL's plan and the
 *     original's resolved facts. Carrying them would write the same story
 *     again, and grounding resolved for one premise is wrong for an edited
 *     one. Generation re-derives both, which is what it is for;
 *   * visibility -- the create flow's own default decides, so a reader does
 *     not silently inherit a stranger's choice to be public.
 *
 * The premise travels VERBATIM. It is the writer's own seed off
 * `stories.topic`, and showing it as it was written is the honest version:
 * the reader can read exactly what produced the story they liked, and edit it
 * character by character before spending anything.
 */
export function seedDraftFromStory(story: Story): Partial<StudioDraft> {
  const draft: Partial<StudioDraft> = {};

  const seed = story.synopsis?.trim();
  if (seed) draft.seed = seed;

  // `primaryGenre` is the modern column and `genre` the legacy one; a story
  // written before the split has only the second. Taking either keeps an older
  // library story from opening the brief on the picker's default instead of on
  // the genre the reader just chose to read.
  const genre = asGenre(story.primaryGenre) ?? asGenre(story.genre);
  if (genre) draft.primaryGenre = genre;

  if (story.audienceMode) draft.audienceMode = story.audienceMode;
  if (story.spiceLevel) draft.spiceLevel = story.spiceLevel;

  // Only a language the picker still offers. `CreationLanguage` admits
  // Portuguese so existing rows keep resolving, but it cannot be chosen any
  // more -- seeding it would open the brief on a language with no control to
  // change it, and every chapter would be written in it by default.
  const language = story.language as CreationLanguage;
  if (CREATION_LANGUAGES.includes(language)) draft.language = language;

  // A standalone stays a standalone and a series stays a series, because the
  // length is part of what the reader is asking for more of. `storyMode` is
  // the explicit signal; the chapter count is the fallback for rows written
  // before it existed.
  if (story.storyMode === "standalone") {
    draft.isSeries = false;
  } else if (story.storyMode === "series") {
    draft.isSeries = true;
    if (isOfferedChapterCount(story.plannedChapterCount)) {
      draft.plannedChapterCount = story.plannedChapterCount;
    }
  }

  return draft;
}

/** The chapter counts the Create flow actually offers. */
const OFFERED_CHAPTER_COUNTS = [3, 7, 15] as const;

function isOfferedChapterCount(
  value: number | undefined,
): value is StudioDraft["plannedChapterCount"] & number {
  return typeof value === "number" &&
    (OFFERED_CHAPTER_COUNTS as readonly number[]).includes(value);
}

/**
 * A genre is only worth seeding when the picker can show it as chosen.
 *
 * Matched against `UI_GENRES` rather than `GENRES` on purpose. `GENRES` keeps
 * every retired value typed forever so old stories still render, but a brief
 * opened on one of them would show a genre row with nothing selected -- a
 * draft holding a value the picker cannot display is worse than the default,
 * because the writer cannot see what they are about to generate. A retired
 * genre therefore falls through and the brief opens on its own default.
 */
function asGenre(value: Genre | undefined): Genre | undefined {
  if (!value) return undefined;
  // Widened deliberately: `UI_GENRES` is the narrower offered subset, so it
  // cannot take a `Genre` without it. The whole point of the check is to ask
  // whether this wider value is one of the narrower ones.
  return (UI_GENRES as readonly Genre[]).includes(value) ? value : undefined;
}

/**
 * Request validation for v6 story generation.
 *
 * Normalizes genres via migration map, enforces genre/spice/audience
 * constraints, and derives server-side content ratings.
 */

import { validateGroundingCards } from "./grounding-card.ts";
import { validateEntityMentions } from "./grounding-pipeline.ts";
import type { GroundingCard } from "./grounding-types.ts";
import {
  AUDIENCE_MODES,
  type AudienceMode,
  CHAPTER_LENGTHS,
  type ChapterLength,
  type CharacterInput,
  DEFAULT_CHAPTER_LENGTH,
  DEFAULT_PLANNED_CHAPTER_COUNT,
  GENRE_ALLOWED_SPICE,
  GENRE_DEFAULT_SPICE,
  GENRE_MIGRATION_BY_NORMALIZED_KEY,
  GENRE_MIGRATION_MAP,
  IDENTITY_LENSES,
  type IdentityLens,
  MAX_BEAT_LENGTH,
  MAX_BRIEF_FIELD_LENGTH,
  MAX_CAST_SIZE,
  MAX_MOMENTS,
  MAX_STORY_GENRES,
  PLANNED_CHAPTER_COUNT_SET,
  type PlannedChapterCount,
  PRIMARY_GENRES,
  type PrimaryGenre,
  RETIRED_SPICE_LEVELS,
  SPICE_LEVELS,
  type SpiceLevel,
  type StoredSpiceLevel,
  STORY_MODES,
  type StoryMode,
  type ValidatedGenerationParams,
} from "./types.ts";
import { parseRequestId } from "./operations.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateGenerationRequest(
  value: unknown,
): ValidatedGenerationParams | { error: string; status?: number } {
  if (!value || typeof value !== "object") return { error: "Invalid request" };
  const body = value as Record<string, unknown>;

  // --- Genre ---
  // `primary_genre` routes the genre and cover modules. `genres` retains the
  // creator-visible secondary chips, with primary first, for tags and prompt
  // context. Older clients only send primary_genre or genre and remain valid.
  let rawGenre: string;
  if (typeof body.primary_genre === "string" && body.primary_genre.trim()) {
    rawGenre = body.primary_genre.trim();
  } else if (
    Array.isArray(body.genre) && typeof body.genre[0] === "string" &&
    body.genre[0].trim()
  ) {
    rawGenre = body.genre[0].trim();
  } else if (typeof body.genre === "string" && body.genre.trim()) {
    rawGenre = body.genre.trim();
  } else {
    return { error: "primary_genre is required" };
  }

  const primaryGenre = normalizeGenre(rawGenre);
  const suppliedGenres = Array.isArray(body.genres)
    ? body.genres
    : (Array.isArray(body.genre) ? body.genre : []);
  const genres = [primaryGenre];
  // Raw, pre-migration secondary genre strings, kept only for the kids-mode
  // safety check below — see `kidsBlockedLabel`.
  const rawSecondaryGenres: string[] = [];
  for (const candidate of suppliedGenres) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    rawSecondaryGenres.push(candidate.trim());
    const genre = normalizeGenre(candidate);
    if (!genres.includes(genre) && genres.length < MAX_STORY_GENRES) {
      genres.push(genre);
    }
  }

  // --- Story Mode ---
  let storyMode: StoryMode = "standalone";
  if (typeof body.story_mode === "string" && body.story_mode.trim()) {
    const mode = body.story_mode.trim();
    if (!STORY_MODES.has(mode)) {
      return { error: "story_mode must be 'standalone' or 'series'" };
    }
    storyMode = mode as StoryMode;
  } else if (body.is_series === true) {
    storyMode = "series";
  }

  // --- Audience Mode ---
  let audienceMode: AudienceMode = "adult";
  if (typeof body.audience_mode === "string") {
    const am = body.audience_mode.trim();
    if (am && !AUDIENCE_MODES.has(am)) {
      return { error: "audience_mode must be 'adult' or 'kids'" };
    }
    audienceMode = (am || "adult") as AudienceMode;
  }

  // Kids mode removes, it does not default (section 3, decisions 23 and 26).
  //
  // The client filters the genre row, but the client is not the enforcement
  // point: a stale build, a replayed request or a direct call to the function
  // would otherwise generate horror for a child. This used to reject
  // `darkRomance` alone, leaving the other three genres the spec removes from
  // the kids interface fully generatable server-side.
  //
  // Checked against the RAW genre string, before `normalizeGenre`'s v7
  // migration — see `kidsBlockedLabel`.
  if (audienceMode === "kids") {
    const blockedLabel = kidsBlockedLabel(rawGenre) ??
      rawSecondaryGenres.map(kidsBlockedLabel).find((label) =>
        label !== undefined
      );
    if (blockedLabel) {
      return { error: `${blockedLabel} is not available in kids mode` };
    }
  }

  // --- Spice Level ---
  let spiceLevel: SpiceLevel;
  if (audienceMode === "kids") {
    spiceLevel = "sweet";
  } else if (typeof body.spice_level === "string" && body.spice_level.trim()) {
    const sl = normalizeSpiceLevel(body.spice_level);
    // A retired tier normalizes rather than rejects, so `normalizeSpiceLevel`
    // returning undefined means the value was never a tier at all. This used to
    // 403 on `explicit`, which was correct while the tier was merely
    // feature-flagged and wrong now that it is retired: a client on a stale
    // build, or a request replayed from before the retirement, would fail a
    // generation the user already paid attention to instead of getting the
    // story one notch cooler.
    if (!sl) {
      return { error: "spice_level must be 'sweet' or 'steamy'" };
    }
    spiceLevel = sl;
  } else {
    spiceLevel = GENRE_DEFAULT_SPICE[primaryGenre] ?? "sweet";
  }

  // Validate spice against genre constraints — only clamp downward, never escalate
  const allowedSpice = GENRE_ALLOWED_SPICE[primaryGenre];
  if (allowedSpice && !allowedSpice.has(spiceLevel)) {
    spiceLevel = "sweet";
  }

  // --- Identity Lenses ---
  let identityLenses: IdentityLens[] = [];
  if (audienceMode !== "kids" && Array.isArray(body.identity_lenses)) {
    identityLenses = body.identity_lenses.filter(
      (l: unknown) => typeof l === "string" && IDENTITY_LENSES.has(l),
    ) as IdentityLens[];
  }

  // --- Seed ---
  // The 40-character minimum is removed. It taught padding rather than
  // structure, and source-of-truth/STORY_GENERATION_FLOW.md section 2 replaces
  // it with the slot-based brief-strength meter, in which a one-line idea is a
  // legitimate choice rather than a failure. One non-whitespace character is
  // the floor; the 1000-character ceiling is unchanged.
  const rawSeed = body.topic ?? body.seed;
  if (typeof rawSeed !== "string") {
    return { error: "Tell Katha what your story is about" };
  }
  const seed = rawSeed.trim();
  if (seed.length < 1) {
    return { error: "Tell Katha what your story is about" };
  }
  if (seed.length > 1000) {
    return { error: "Story seed must be 1000 characters or fewer" };
  }

  // --- Characters ---
  const characters: CharacterInput[] = [];
  const rawCharacters = body.characters;
  if (rawCharacters !== undefined) {
    if (!Array.isArray(rawCharacters) || rawCharacters.length > MAX_CAST_SIZE) {
      return {
        error: `A story can have at most ${MAX_CAST_SIZE} characters`,
      };
    }
    for (const character of rawCharacters) {
      if (!character || typeof character !== "object") {
        return { error: "Each character must be an object" };
      }
      const item = character as Record<string, unknown>;
      if (
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name.length > 100
      ) {
        return {
          error: "Each character needs a name of 100 characters or fewer",
        };
      }
      for (
        const field of ["description", "background", "appearance"] as const
      ) {
        if (
          item[field] !== undefined &&
          (typeof item[field] !== "string" ||
            (item[field] as string).length > 500)
        ) {
          return {
            error: `Character ${field} must be 500 characters or fewer`,
          };
        }
      }
      if (item.isHero !== undefined && typeof item.isHero !== "boolean") {
        return { error: "Character isHero must be boolean" };
      }
      if (
        item.portrait_url !== undefined &&
        (typeof item.portrait_url !== "string" ||
          item.portrait_url.length > 2000)
      ) {
        return { error: "Character portrait_url must be a URL string" };
      }
      characters.push({
        name: item.name.trim(),
        description: typeof item.description === "string"
          ? item.description.trim()
          : undefined,
        background: typeof item.background === "string"
          ? item.background.trim()
          : undefined,
        appearance: typeof item.appearance === "string"
          ? item.appearance.trim()
          : undefined,
        portraitUrl: typeof item.portrait_url === "string"
          ? item.portrait_url.trim()
          : undefined,
        isHero: item.isHero === true,
      });
    }
    if (characters.length) {
      const leadIndex = characters.findIndex((character) => character.isHero);
      const normalizedLeadIndex = leadIndex >= 0 ? leadIndex : 0;
      characters.forEach((character, index) => {
        character.isHero = index === normalizedLeadIndex;
      });
    }
  }

  // --- Request ID ---
  const requestId = parseRequestId(body.request_id);
  if (!requestId) return { error: "Invalid request_id" };

  // --- Language ---
  let language: string | undefined;
  if (typeof body.language === "string") {
    const raw = body.language.trim();
    if (raw && !["English", "Portuguese"].includes(raw)) {
      return { error: "language must be English or Portuguese" };
    }
    if (raw) {
      language = raw;
    }
  }

  // --- The brief ---
  const whereAndWhen = optionalText(body.where_and_when);
  if (whereAndWhen === TOO_LONG) {
    return {
      error:
        `Where and when must be ${MAX_BRIEF_FIELD_LENGTH} characters or fewer`,
    };
  }

  const avoid = optionalText(body.avoid);
  if (avoid === TOO_LONG) {
    return {
      error: `Avoid must be ${MAX_BRIEF_FIELD_LENGTH} characters or fewer`,
    };
  }

  const rawStyle = optionalText(body.writing_style);
  if (rawStyle === TOO_LONG) {
    return {
      error:
        `Writing style must be ${MAX_BRIEF_FIELD_LENGTH} characters or fewer`,
    };
  }
  const writingStyle = sanitizeWritingStyle(rawStyle);

  // Moments are clamped rather than rejected. A user who pins a seventh beat
  // has not made an error worth an error message; the cap exists because past
  // roughly five the model returns a checklist instead of a story.
  const moments = stringList(body.moments).slice(0, MAX_MOMENTS);

  // Values are a kids-mode chip slot and have no meaning in adult mode.
  const storyValues = audienceMode === "kids"
    ? stringList(body.story_values ?? body.values).slice(0, MAX_MOMENTS)
    : [];

  let chapterLength: ChapterLength = DEFAULT_CHAPTER_LENGTH;
  if (typeof body.chapter_length === "string" && body.chapter_length.trim()) {
    const cl = body.chapter_length.trim();
    if (!CHAPTER_LENGTHS.has(cl)) {
      return { error: "chapter_length must be 'short', 'standard', or 'long'" };
    }
    chapterLength = cl as ChapterLength;
  }

  let plannedChapterCount: PlannedChapterCount = DEFAULT_PLANNED_CHAPTER_COUNT;
  if (body.planned_chapter_count !== undefined) {
    const n = body.planned_chapter_count;
    if (typeof n !== "number" || !PLANNED_CHAPTER_COUNT_SET.has(n)) {
      return { error: "planned_chapter_count must be 3, 7, or 15" };
    }
    plannedChapterCount = n as PlannedChapterCount;
  }

  // The plan is clamped to the planned length rather than rejected. A plan
  // longer than the story would promise beats no chapter can reach, and a plan
  // shorter than it simply leaves the tail unbriefed, which is legal - the
  // model paces those chapters itself, exactly as it does with no plan at all.
  const beats = stringList(body.beats, MAX_BEAT_LENGTH).slice(
    0,
    plannedChapterCount,
  );

  // Client-submitted fact cards, re-validated rather than trusted.
  //
  // Grounding is resolved during shaping, which is a free pre-generation call,
  // so the cards reach this request through the client. That is deliberate and
  // safe: a tampered card only degrades the tamperer's own story, and card
  // content is fenced in the prompt exactly like the idea text the user could
  // have typed anyway. What is NOT safe is an unbounded payload, since every
  // card byte becomes prompt tokens somebody pays for - so `validateGroundingCards`
  // caps the count, the field lengths and the list sizes here, at the boundary.
  const grounding = validateGroundingCards(body.grounding);
  // The classification record, kept for the publish decision described in
  // validateEntityMentions. Never used to build a prompt, so a tampered entry
  // mislabels only the tamperer's own story.
  const groundingEntities = validateEntityMentions(body.grounding_entities);

  const illustrateChapters = body.illustrate_chapters === true;
  // Opt-in, and a literal `true` only. The onboarding notify screen is a soft
  // pre-prompt, so a push must never be sent to somebody who has not accepted
  // it, and a truthy-ish value is not acceptance.
  const notifyOnReady = body.notify_on_ready === true;

  return {
    primaryGenre,
    genres,
    storyMode,
    audienceMode,
    identityLenses,
    spiceLevel,
    seed,
    characters,
    requestId,
    language,
    whereAndWhen,
    moments,
    beats,
    storyValues,
    writingStyle,
    avoid,
    chapterLength,
    plannedChapterCount,
    illustrateChapters,
    notifyOnReady,
    grounding,
    groundingEntities,
  };
}

/**
 * Map any spice value — live or retired — onto a live tier.
 *
 * The one place the retirement of `explicit` is applied, so a read path, a
 * replayed request and a continuation all land the same way. Returns undefined
 * only for a value that was never a tier, which is a client bug worth an error;
 * a retired tier is a history fact and is mapped down instead.
 */
export function normalizeSpiceLevel(
  raw: unknown,
): SpiceLevel | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (SPICE_LEVELS.has(value)) return value as SpiceLevel;
  return RETIRED_SPICE_LEVELS[value];
}

/**
 * Derive a content rating from audience mode and spice level.
 * The content rating is set server-side and stored on the story.
 *
 * The `explicit` branch survives the tier's retirement on purpose. It can no
 * longer be reached from a generation — `SpiceLevel` has no such member and
 * `normalizeSpiceLevel` maps it down before this is called — but the parameter
 * is widened to `StoredSpiceLevel` so a caller re-deriving a rating from a row
 * written before 2026-09-07 gets `"explicit"` back rather than a silent
 * downgrade to `"steamy"`. `feed` and `library` both exclude that rating from
 * public surfaces; quietly relabelling an old row would publish it.
 */
export function deriveContentRating(
  audienceMode: AudienceMode,
  spiceLevel: StoredSpiceLevel,
): string {
  if (audienceMode === "kids") return "kids";
  if (spiceLevel === "explicit") return "explicit";
  if (spiceLevel === "steamy") return "steamy";
  return "sweet";
}

// ---------------------------------------------------------------------------
// Crude-language floor: post-generation check
// ---------------------------------------------------------------------------

// Terms whose every casing is crude in prose. Built once; rebuilding a RegExp
// per generated chapter is waste on a path that already runs per request.
//
// Narrower than the list the prompt states, and deliberately so. The prompt can
// afford "cock", "prick", "screw", "bang" and "ride" because it is instructing a
// writer who understands context; a regex cannot tell "he cocked the rifle",
// "the prick of a needle", "screwed the lid back on" or "rode north until dawn"
// from the crude sense, and a check that fires on ordinary thriller and western
// prose would be ignored within a week. Those terms stay banned in the prompt
// and unscanned here. This is the same trade `sanitizeWritingStyle` makes in the
// other direction: pick the error you can live with and write it down.
const CRUDE_ANYCASE_RE =
  /\b(?:pussy|cunts?|twats?|tits|titties|clits?|clitoris|blow ?jobs?|hand ?jobs?|rim ?jobs?|deep ?throat(?:ing|ed)?|jizz|cocksuck\w*|boners?|hard-ons?|jerk(?:ing|ed)? off|cum(?:ming|med|shot)?)\b/gi;

// Terms that are crude in lower case and something else entirely capitalised:
// "Dick" is a person, "Willy" is a person. Case-sensitive matching is what keeps
// a character named Dick out of the report — the same reason STYLE_NAME_RE above
// is not built with the `i` flag.
const CRUDE_LOWERCASE_RE = /\b(?:dicks?|willy)\b/g;

/**
 * Report crude sexual vocabulary in generated prose.
 *
 * Defence in depth behind the prompt-layer floor in `story-prompts.ts`, on the
 * precedent of the imitation-stripping regex above: the prompt is the control,
 * this is the measurement that tells us when the prompt failed. It is a detector
 * and not a rewriter on purpose. The streamed path has already shown the reader
 * every word by the time a chapter is complete, so a silent substitution would
 * change prose that is on screen; and splicing a word out of a sentence leaves a
 * sentence that no longer parses, which is a worse artefact than the word.
 *
 * Non-fatal by contract. It returns what it found, lower-cased and deduplicated,
 * and never throws — a caller decides whether that means telemetry, a
 * regeneration on the buffered path, or nothing. An empty array is the normal
 * result.
 *
 * **Known false positives, accepted:** "cum laude", and any surname or place
 * name colliding with a scanned term. They are rare enough in story prose to be
 * worth the terms that carry them, and the consequence of a false positive is
 * one noisy telemetry row rather than a rejected story.
 */
export function scanCrudeLexicon(text: unknown): string[] {
  if (typeof text !== "string" || !text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(CRUDE_ANYCASE_RE)) {
    found.add(match[0].toLowerCase());
  }
  for (const match of text.matchAll(CRUDE_LOWERCASE_RE)) {
    found.add(match[0]);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Brief helpers
// ---------------------------------------------------------------------------

/** Sentinel for "present but over the limit", distinct from "absent". */
const TOO_LONG = Symbol("too-long");

function optionalText(value: unknown): string | undefined | typeof TOO_LONG {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_BRIEF_FIELD_LENGTH) return TOO_LONG;
  return trimmed;
}

function stringList(
  value: unknown,
  maxLength = MAX_BRIEF_FIELD_LENGTH,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed.slice(0, maxLength));
  }
  return out;
}

// Built once. These are constant, and rebuilding two RegExp objects on every
// request is pure waste on a hot validation path.
//
// A name token, in two shapes because scripts differ:
//
//   1. Cased scripts - an uppercase letter then name characters. Covers
//      "Tolkien", a bare initial "K" or "J.", and accented names like
//      "Garcia" that an ASCII [A-Z]/\w pattern truncates at the accent.
//   2. Uncased scripts - \p{Lo}, "Letter, other", which is what Han, Kana,
//      Arabic, Hebrew and Devanagari letters are. These have no uppercase, so
//      rule 1 can never match them and such a name would pass through.
//
// \p{Lo} is deliberately narrow: Latin lowercase is \p{Ll}, not \p{Lo}, so
// admitting uncased scripts cannot resurrect the bug where ordinary lowercase
// prose after a trigger was read as a name.
const STYLE_NAME = "(?:\\p{Lu}[\\p{L}\\p{M}'\u2019.-]*|[\\p{Lo}\\p{M}]+)";

// Lowercase connectives that sit inside a surname. Without these the pattern
// stops mid-name and leaks the remainder: "Ngugi wa Thiong'o" left
// "wa Thiong'o" behind before "wa" was listed.
const STYLE_PARTICLE =
  "de|del|della|da|das|dos|do|di|du|van|von|der|den|ter|ten|" +
  "la|le|el|al|bin|bint|ibn|ben|abu|wa|mac|mc|st|y|af|av|op|te";

const STYLE_TRIGGER =
  "like|in the style of|in the voice of|styled after|modelled after|modeled after|" +
  "written by|channelling|channeling|imitate|imitating|mimic|mimicking|copy|copying|" +
  "sound(?:s|ing)? like|read(?:s|ing)? like";

// The trigger is matched case-insensitively; the name is not. These have to be
// two regexes rather than one with the `i` flag, because `i` would also apply
// to \p{Lu} and make it match lowercase - so "like the sea at dusk" would be
// read as a name and the craft direction destroyed.
const STYLE_TRIGGER_RE = new RegExp(
  `\\b(?:${STYLE_TRIGGER})\\s+`,
  "giu",
);
const STYLE_NAME_RE = new RegExp(
  `^(?:${STYLE_NAME})(?:\\s+(?:${STYLE_NAME}|${STYLE_PARTICLE}))*`,
  "u",
);

/**
 * Strip requests to imitate a named writer.
 *
 * The prompt spec is explicit that author touchstones stay in documentation and
 * never reach a runtime prompt: naming a living author invites both a
 * style-imitation complaint and the model's flattest pastiche of that author.
 * A user typing "like Colleen Hoover" wants the craft, so the phrase is removed
 * and the rest of their direction survives rather than the whole field being
 * rejected. What is left - "hardboiled", "poetic", "short sentences" - is
 * exactly what the writing-style layer is for.
 *
 * Name tokens allow bare initials ("Ursula K Le Guin", "J. R. R. Tolkien"),
 * which an earlier version of this pattern stopped at, leaking the surname.
 *
 * **Known over-match, accepted deliberately:** a capitalised phrase that is not
 * a person is stripped too, so "in the style of Gothic Horror" loses its
 * subject. A regex cannot tell "Le Guin" from "Gothic Horror", and dropping a
 * little craft direction is the cheaper error. This is defence in depth, not
 * the only defence - the prompt layer states the craft-traits-not-imitation
 * rule as well.
 */
function sanitizeWritingStyle(
  value: string | undefined | typeof TOO_LONG,
): string | undefined {
  if (typeof value !== "string") return undefined;

  // Collect the spans to drop first, then splice, so removing one does not
  // shift the offsets of the next. matchAll copies the regex internally, so
  // the shared STYLE_TRIGGER_RE's lastIndex is never mutated across calls.
  const spans: [number, number][] = [];
  for (const m of value.matchAll(STYLE_TRIGGER_RE)) {
    const triggerStart = m.index ?? 0;
    const afterTrigger = triggerStart + m[0].length;
    const name = STYLE_NAME_RE.exec(value.slice(afterTrigger));
    // No capitalised name after the trigger means this is ordinary prose
    // ("like the sea at dusk"), and the user's words are left alone.
    if (!name) continue;
    spans.push([triggerStart, afterTrigger + name[0].length]);
  }

  let cleaned = value;
  for (let i = spans.length - 1; i >= 0; i--) {
    cleaned = cleaned.slice(0, spans[i][0]) + cleaned.slice(spans[i][1]);
  }

  cleaned = cleaned
    // Removing a name from the middle of a list leaves its separators behind:
    // "dreamlike, like <name>, in short scenes" becomes "dreamlike, , in short
    // scenes". Collapse any run of separators into the first one.
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();

  return cleaned.length ? cleaned : undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a raw genre string to the genre a NEW submission generates as.
 *
 * The migration map is checked before the already-valid-genre shortcut, on
 * purpose: several `PrimaryGenre` members (`romantasy`, `darkRomance`,
 * `paranormalRomance`, `cozyFantasy`, `poetry`, `thriller`, `contemporary`)
 * were removed from the UI in the v7 taxonomy change but stay valid so
 * existing stories keep reading and continuing. If the old precedence (exact
 * `PRIMARY_GENRES` match first) survived, none of those seven would ever
 * migrate — they would just pass straight through, because they are still
 * members of the type union. Checking the map first is what makes "removed
 * from the UI" also mean "normalises for new submissions", per
 * `GENRE_MIGRATION_MAP`'s own contract comment in types.ts.
 *
 * This function is NOT the same lookup used when a *stored* row is loaded for
 * continuation: `story-prompts.ts` has its own `normalizeGenre` that checks
 * its supported-genre set first, so a story already carrying `darkRomance`
 * keeps writing in the darkRomance voice module rather than jumping to
 * romance mid-series.
 */
function normalizeGenre(raw: string): PrimaryGenre {
  // Migration is checked before recognition, at BOTH precisions.
  //
  // Every retired genre is still a valid `PrimaryGenre` -- they have to be, or
  // existing stories carrying them could not be read. So "is this already
  // valid?" answers yes for exactly the genres that most need migrating, and
  // whichever check runs first wins.
  //
  // The exact-match ordering was fixed once. The case-insensitive pair was not,
  // and that left the bug fully intact for any client sending a display-cased
  // or spaced value: measured before this change, `thriller` normalised to
  // `mystery` while `Thriller` normalised to `thriller`, and `darkRomance`
  // became `romance` while `dark romance` stayed `darkRomance`. A retired genre
  // reached generation whenever it arrived capitalised.
  const migrated = GENRE_MIGRATION_MAP[raw];
  if (migrated) return migrated;

  const lower = raw.toLowerCase().replace(/[\s_-]/g, "");
  const migratedLower = GENRE_MIGRATION_BY_NORMALIZED_KEY[lower];
  if (migratedLower) return migratedLower;

  if (PRIMARY_GENRES.has(raw)) return raw as PrimaryGenre;

  for (const genre of PRIMARY_GENRES) {
    if (genre.toLowerCase() === lower) return genre as PrimaryGenre;
  }

  // The fallback is a genre the picker still offers. `contemporary` was
  // retired in v7, so defaulting to it handed unrecognised input a genre no
  // user can choose and the migration map itself sends elsewhere.
  return "sliceOfLife";
}

/**
 * Whether a raw, pre-migration genre string identifies a kids-blocked genre.
 *
 * Kept independent of `normalizeGenre`'s migration map on purpose. Several of
 * the genres this checks (`darkRomance`, `paranormalRomance`, `thriller`) are
 * exactly the ones the v7 taxonomy change migrates away for new submissions —
 * if this check ran on the migrated value instead of the raw one, an explicit
 * kids-mode request for `darkRomance` would silently become a sweet romance
 * story rather than being refused, because `primaryGenre` could never equal
 * `darkRomance` any more by the time this check ran. That is the wrong
 * failure mode for a safety gate: an old client or a direct API call
 * explicitly naming a genre the kids interface never offered should be
 * rejected, not quietly softened.
 */
function kidsBlockedLabel(raw: string): string | undefined {
  const lower = raw.toLowerCase().replace(/[\s_-]/g, "");
  for (const [genre, label] of KIDS_BLOCKED_GENRES) {
    if (genre.toLowerCase() === lower) return label;
  }
  return undefined;
}

/**
 * Genres absent from the kids-mode interface, and refused by the server.
 *
 * The value is the label used in the error, so the message names the genre the
 * user chose rather than its internal identifier.
 */
const KIDS_BLOCKED_GENRES: ReadonlyMap<string, string> = new Map([
  ["darkRomance", "Dark Romance"],
  ["paranormalRomance", "Paranormal Romance"],
  ["horror", "Horror"],
  ["thriller", "Thriller"],
]);

/**
 * Image generation for covers and character portraits.
 *
 * Two call sites, one provider chain:
 *
 * - `generateCoverImage` — chapter 1's art, which *is* the story's cover
 *   (`STORY_GENERATION_FLOW.md` §10.4, decision 38).
 * - `generateCharacterPortrait` — one portrait per cast member, prompted from
 *   `appearance` (§4, decision 54). Deliberately a separate prompt path from
 *   the cover: Appearance drives the image, Background drives the voice, and
 *   mixing them is what makes portraits generic.
 *
 * ## The provider chain
 *
 * Every position is Google's Gemini image family through OpenRouter, with
 * `gemini-2.5-flash-image` — "nano banana" — first, for covers and character
 * portraits alike. One credential (`OPENROUTER_API_KEY`) serves both.
 *
 * OpenAI `gpt-image-1` used to hold first place and is gone entirely. The key
 * was revoked (2026-09-08) and is not coming back, and a provider whose
 * credential does not exist is not a fallback — it is a position in the chain
 * that costs a branch, a timeout budget and a paragraph of explanation to skip
 * itself. Removing it also removes the shared-blast-radius problem that
 * `OPENAI_API_KEY` created between covers and story generation, because there
 * is no longer a shared key to have a blast radius.
 *
 * **There is no free image model on OpenRouter.** Every model advertising
 * `image` in `output_modalities` is priced (verified against
 * `GET https://openrouter.ai/api/v1/models`, 2026-09-03). The free tier that
 * `llm.ts` uses for prose has no equivalent here. Per generated image, at
 * Gemini's fixed 1,290 output tokens:
 *
 * | position | model                             | ≈ per image |
 * |----------|-----------------------------------|-------------|
 * | 1        | google/gemini-2.5-flash-image     | ~$0.039     |
 * | 2        | google/gemini-3.1-flash-image     | ~$0.077     |
 *
 * Nano banana leads on both cost and product decision. 3.1-flash is the
 * stronger model and stays as the fallback, so an outage or a moderation
 * refusal on the cheap model still produces art rather than a concept card —
 * at roughly twice the price, for the minority of images that need it.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildChapterArtPrompt,
  buildCoverPrompt,
  coverArtStyleClause,
  type PromptCharacter,
} from "./cover-prompts.ts";
import { characterAppearance } from "./types.ts";

/** Read lazily, never at module load — see the note at the top of `llm.ts`. */
const openRouterKey = () => Deno.env.get("OPENROUTER_API_KEY")?.trim();

/** Prompt simplification levels, applied in order on moderation rejection. */
const MAX_SAFETY_LEVELS = 3;

/**
 * Does an attached style reference survive this rung of the safety ladder?
 *
 * It does not survive the last one. Level 2 exists to be the request that
 * cannot be refused, and an attached photo is the likeliest thing in the
 * payload for a moderation filter to have objected to -- so it goes before the
 * character does, rather than letting the optional half of the request fail
 * the whole ladder.
 *
 * This is a named function with one caller pair on purpose. The image and the
 * sentence describing it must be dropped by the SAME decision: a prompt that
 * says "an attached image is provided" with no image attached is a request
 * that describes itself wrongly, and that is worse than either dropping both
 * or keeping both.
 */
function referenceSurvivesLevel(safetyLevel: number): boolean {
  return safetyLevel < MAX_SAFETY_LEVELS - 1;
}
/**
 * How long one provider request may take, and how long the whole ladder may.
 *
 * Two budgets, because the two call sites are watched by different people.
 *
 * A **cover** is background work. Nobody is staring at a spinner while it is
 * drawn -- the story is already readable behind a concept card -- so a slow
 * attempt is worth waiting out, and 60s per request inside a 150s chain is the
 * shape that has always been here.
 *
 * A **portrait** is the opposite: onboarding's W6 holds the user on a loading
 * card with a caption promising a number of seconds. Measured 2026-09-12
 * (`backend/scripts/measure-portrait-latency.ts`, 3+ runs per shape), a
 * successful `gemini-2.5-flash-image` portrait lands at a p50 of about 7.8s
 * and a worst observed 10.3s; `gemini-3.1-flash-image` is a full four seconds
 * behind it at 12.2s, which is why the ladder is ordered the way it is. A
 * request still running at 25s is therefore not slow, it is stuck -- and
 * waiting the other 35s of a 60s timeout buys nothing except a caption that
 * lied by six times. Cutting the attempt short and falling through to the
 * second model costs about 12s more and usually produces a face; waiting does
 * not. The chain budget is sized to fit that: two models at 25s, with room for
 * one simplification rung, and still inside the platform's own limit.
 */
const REQUEST_TIMEOUT_MS: Record<ImageAspect, number> = {
  cover: 60_000,
  portrait: 25_000,
};
/**
 * The whole chain is bounded, not just each request.
 *
 * Without this a provider that stalls at just under its own timeout, three
 * safety levels deep, keeps the Edge Function alive past the platform's own
 * limit and the caller gets a dropped connection rather than a null and a
 * concept cover.
 */
const CHAIN_DEADLINE_MS: Record<ImageAspect, number> = {
  cover: 150_000,
  portrait: 80_000,
};

interface ImageProvider {
  name: string;
  model: string;
  /** Absent credential means skip, not fail — same contract as `llm.ts`. */
  key: () => string | undefined;
  generate: (
    prompt: string,
    apiKey: string,
    aspect: ImageAspect,
    deadline: number,
    /** Optional style reference, as a `data:` URL. See `STYLE_REFERENCE_CLAUSE`. */
    referenceImage?: string,
  ) => Promise<Uint8Array>;
}

const PROVIDERS: readonly ImageProvider[] = [
  {
    name: "openrouter",
    // "Nano banana". First for covers and portraits both, by product
    // decision and by price.
    model: "google/gemini-2.5-flash-image",
    key: openRouterKey,
    generate: (p, k, a, d, ref) =>
      generateWithOpenRouter("google/gemini-2.5-flash-image", p, k, a, d, ref),
  },
  {
    name: "openrouter",
    model: "google/gemini-3.1-flash-image",
    key: openRouterKey,
    generate: (p, k, a, d, ref) =>
      generateWithOpenRouter("google/gemini-3.1-flash-image", p, k, a, d, ref),
  },
];

export type ImageAspect = "cover" | "portrait";

/**
 * Both are portrait-orientation; the cover is taller.
 *
 * `ratio` is the real parameter and `words` is the prompt saying the same
 * thing. Gemini through OpenRouter *does* take a size parameter --
 * `image_config.aspect_ratio`, verified live 2026-09-12 -- and the note that
 * used to sit here saying it does not was the reason every image on this chain
 * came back 1024x1024 square. A square source displayed in the 270x338 Meet
 * card under `resizeMode="cover"` loses about a fifth of its width, which on a
 * full-body portrait is the arms. Asking for 4:5 (896x1152) returns the frame
 * the card actually draws, at a measured cost of nothing: across three runs
 * each, square, 2:3 and 4:5 were all inside the same 7-9s band.
 *
 * The two must agree. A prompt that asks for one ratio while the parameter
 * asks for another is a request that argues with itself, and the model has no
 * way to tell which half was meant.
 *
 * | aspect ratio | pixels Gemini returns |
 * |--------------|-----------------------|
 * | 1:1 (default)| 1024 x 1024           |
 * | 4:5          | 896 x 1152            |
 * | 3:4          | 864 x 1184            |
 * | 2:3          | 832 x 1248            |
 *
 * `image_size` is NOT set. Its only values are 0.5K / 1K / 2K / 4K, 0.5K is
 * rejected by every model in this chain, and 1K is what these ratios already
 * are -- so it would be a parameter that either fails or does nothing. The
 * portrait needs 810x1014 to be sharp at 3x on the Meet card, and 896x1152 is
 * the smallest supported output that clears it.
 */
const ASPECT: Record<ImageAspect, { words: string; ratio: string }> = {
  cover: { words: "portrait orientation, 2:3 aspect ratio", ratio: "2:3" },
  portrait: {
    words: "full-body portrait orientation, 4:5 aspect ratio",
    ratio: "4:5",
  },
};

export interface ImageResult {
  url: string;
  storagePath: string;
  /** Which provider and model actually produced it — for telemetry. */
  provider: string;
  model: string;
  /**
   * The prompt the surviving attempt actually sent.
   *
   * Not necessarily the one the caller would have built: the safety ladder
   * rebuilds the prompt on a moderation rejection, so the image on disk may
   * have come from level 1 or level 2. Regeneration stores this in
   * `stories.cover_prompt` and varies from it, and storing the prompt we
   * *meant* to send instead would tell the next attempt to differ from a cover
   * that was never made.
   */
  prompt: string;
}

// ---------------------------------------------------------------------------
// Covers
// ---------------------------------------------------------------------------

/**
 * Generate a story's cover and upload it to the `covers` bucket.
 *
 * Returns null rather than throwing on total failure: a story without a cover
 * still has the typographic concept card (§10.4, decision 39), so a failed
 * image must never block generation or publishing, and must never cost the
 * user the story they paid for.
 */
export async function generateCoverImage(input: {
  storyId: string;
  genre: string;
  title: string;
  themes: string[];
  characters?: PromptCharacter[];
  /** The where-and-when chip. What stops the cover being genre stock art. */
  whereAndWhen?: string;
  /** The brief's *Avoid* field. Bounds the art the way it bounds the prose. */
  avoid?: string;
  /**
   * A regeneration steer, threaded through to `buildCoverPrompt` at every
   * safety level so a simplified retry is still a *different* cover.
   */
  variation?: string;
  /**
   * Distinguishes this attempt's storage key from the cover it replaces.
   *
   * The original cover is written to `covers/<story>/cover.png` with
   * `upsert: true`, and its public URL contains no version. Overwriting those
   * bytes leaves every CDN edge and every client image cache holding the old
   * picture behind the URL the row still points at, so the user pays for a
   * regeneration and keeps seeing the cover they rejected. A distinct key per
   * regeneration is the whole fix: the row's URL changes, so nothing is cached
   * under it yet.
   */
  storageSuffix?: string;
  /**
   * The writer's *Image style* pick: `auto`, `anime`, `cinematic`, `comic` or
   * `watercolor`. `auto` (and anything unrecognised) uses the genre's own look.
   */
  artStyle?: string;
}): Promise<ImageResult | null> {
  const suffix = input.storageSuffix
    ? `-${input.storageSuffix.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}`
    : "";
  const storagePath = `covers/${input.storyId}/cover${suffix}.png`;
  return await runImageChain({
    label: `cover ${input.storyId}`,
    bucket: "covers",
    storagePath,
    aspect: "cover",
    promptFor: (safetyLevel) => buildCoverPromptForLevel(safetyLevel, input),
  });
}

/**
 * Generate the illustration for one chapter and upload it to `covers`.
 *
 * Chapter 1's art is the story's cover and comes from `generateCoverImage`;
 * this is chapters 2..N, the ones the writer paid an extra credit each for
 * (`source-of-truth/CREDITS_AND_PRICING.md` §1). Same bucket and same chain —
 * only the subject and the storage key differ.
 *
 * Keyed on the chapter number rather than the chapter id so a reimagined
 * chapter's art replaces the art of the chapter it rewrote, instead of leaving
 * an orphan behind a URL nothing points at.
 *
 * Returns null on total failure, exactly as a cover does: decision 39 makes an
 * unillustrated chapter a legitimate look, and the caller refunds the art
 * credit rather than failing the chapter the reader already has.
 */
export async function generateChapterImage(input: {
  storyId: string;
  chapterNumber: number;
  genre: string;
  storyTitle: string;
  chapterTitle?: string;
  moment?: string;
  themes?: string[];
  characters?: PromptCharacter[];
  whereAndWhen?: string;
  avoid?: string;
  artStyle?: string;
}): Promise<ImageResult | null> {
  return await runImageChain({
    label: `chapter art ${input.storyId}#${input.chapterNumber}`,
    bucket: "covers",
    storagePath: `covers/${input.storyId}/chapters/${input.chapterNumber}.png`,
    aspect: "cover",
    promptFor: (safetyLevel) =>
      buildChapterArtPromptForLevel(safetyLevel, input),
  });
}

/**
 * Prompt simplification ladder for chapter art.
 *
 * The same shape as the cover's, and simplified in the same order for the same
 * reason: the cast is by far the likeliest part of an image prompt to trip a
 * content filter, and the chapter's own moment — a sentence out of generated
 * prose — is the second, since it is the only part of this prompt that
 * describes an event rather than a look. Level 2 is what the chain has left
 * when everything else has been refused, so it keeps nothing but the genre,
 * the story's name and the chapter number.
 *
 * The *Avoid* exclusion and the writer's `artStyle` survive every rung, for
 * the reasons stated on the cover's ladder: a negative constraint cannot be
 * what a filter objected to, and a style name is a fixed string from our own
 * table, never user text.
 */
function buildChapterArtPromptForLevel(
  safetyLevel: number,
  input: {
    storyId: string;
    chapterNumber: number;
    genre: string;
    storyTitle: string;
    chapterTitle?: string;
    moment?: string;
    themes?: string[];
    characters?: PromptCharacter[];
    whereAndWhen?: string;
    avoid?: string;
    artStyle?: string;
  },
): string {
  const base = {
    genre: input.genre,
    storyTitle: input.storyTitle,
    chapterNumber: input.chapterNumber,
    avoid: input.avoid,
    artStyle: input.artStyle,
  };
  if (safetyLevel === 0) {
    return buildChapterArtPrompt({
      ...base,
      chapterTitle: input.chapterTitle,
      moment: input.moment,
      themes: input.themes,
      characters: usableCharacters(input.characters),
      whereAndWhen: input.whereAndWhen,
    });
  }
  if (safetyLevel === 1) {
    return buildChapterArtPrompt({
      ...base,
      chapterTitle: input.chapterTitle,
      themes: input.themes?.slice(0, 2),
      whereAndWhen: input.whereAndWhen,
    });
  }
  return buildChapterArtPrompt(base);
}

/**
 * Prompt simplification ladder for a cover.
 *
 * Level 0 is the full prompt. Level 1 drops the cast and trims the themes -
 * a character's appearance is by far the likeliest part of a cover prompt to
 * trip a content filter. Level 2 is genre and title only.
 *
 * The *Avoid* exclusion is carried at every level, including the last. Each
 * rung of this ladder exists to get *past* a content filter, so the rung most
 * likely to be reached is the one where an unconstrained cover would be most
 * embarrassing - and unlike the cast or the themes, an exclusion cannot be the
 * thing the filter objected to.
 */
function buildCoverPromptForLevel(
  safetyLevel: number,
  input: {
    genre: string;
    title: string;
    themes: string[];
    characters?: PromptCharacter[];
    whereAndWhen?: string;
    avoid?: string;
    variation?: string;
    artStyle?: string;
  },
): string {
  const {
    genre,
    title,
    themes,
    characters,
    whereAndWhen,
    avoid,
    variation,
    artStyle,
  } = input;
  if (safetyLevel === 0) {
    return buildCoverPrompt(
      genre,
      title,
      themes,
      usableCharacters(characters),
      whereAndWhen,
      avoid,
      variation,
      artStyle,
    );
  }
  if (safetyLevel === 1) {
    // The setting survives the first simplification: it is a place, not a
    // person, and it is the part of the prompt least likely to have been what
    // a content filter objected to - while being the part that most stops the
    // fallback cover from reading as stock art.
    return buildCoverPrompt(
      genre,
      title,
      themes.slice(0, 2),
      undefined,
      whereAndWhen,
      avoid,
      variation,
      artStyle,
    );
  }
  // The last rung drops the steer, and it is the one place the steer must be
  // dropped. Level 2 exists to be the prompt that *cannot* be refused - it is
  // what every provider falls back to and what the chain has left when
  // everything else has been rejected. The steer is the only part of a
  // regeneration prompt that is per-request caller-supplied text, so leaving it
  // here means a note crafted to trip a content filter trips every rung of
  // every provider and the ladder has no floor. Bounded work per attempt is
  // what makes the per-story attempt ceiling a real bound rather than a
  // multiplier.
  //
  // The exclusion still survives, per the note above: it is a *negative*
  // constraint, so it cannot be the thing a filter objected to.
  return buildCoverPrompt(
    genre,
    title,
    [],
    undefined,
    undefined,
    avoid,
    undefined,
    artStyle,
  );
}

/**
 * Drop characters that cannot contribute to an image prompt.
 *
 * `buildCoverPrompt` interpolates the hero's look directly, so a character
 * saved with a name and nothing else - which the Craft character sheet permits,
 * since only Name is required - produced the literal string
 * "a distant silhouetted figure suggesting undefined" in the prompt. Filtering
 * here is what makes the zero-usable-characters case degrade to the genre cover
 * rather than to a corrupted one.
 *
 * The look is resolved through `characterAppearance`, so a caller handing over
 * rows from a story written before Description was retired still gets a cast.
 * The result carries `appearance` only: nothing downstream should have to make
 * the same decision twice.
 */
function usableCharacters(
  characters?: PromptCharacter[],
): { name: string; appearance: string; isHero?: boolean }[] | undefined {
  if (!characters?.length) return undefined;
  const usable = characters
    .map((c) => ({
      name: c.name,
      appearance: sanitizeForPrompt(characterAppearance(c)),
      // Carried through, not dropped. `media.ts` reads `is_hero` from the
      // database and maps it to `isHero`; rebuilding the object without it
      // meant `buildCoverPrompt` could never select the story's actual
      // protagonist and always fell back to the first described character —
      // so the cover featured whoever happened to be listed first.
      isHero: c.isHero,
    }))
    // After sanitizing, not before: a value that is nothing but delimiters
    // survives a `.trim()` check on the raw field and reaches the prompt empty.
    .filter((c) => c.appearance);
  return usable.length > 0 ? usable : undefined;
}

// ---------------------------------------------------------------------------
// Character portraits
// ---------------------------------------------------------------------------

/**
 * Generate one cast member's portrait and upload it to the `covers` bucket.
 *
 * Prompted from Appearance, per §4: Appearance exists to drive the image. A
 * character with nothing to draw returns null - a genre-generic portrait
 * attached to a named character is worse than no portrait at all.
 */
export async function generateCharacterPortrait(
  storyId: string,
  characterId: string,
  character: { name: string; appearance?: string; description?: string },
  /**
   * The story's *Image style* pick. A cast drawn in the house style beside a
   * cover the writer asked to be anime is the failure this argument exists to
   * stop -- one pick, one book.
   */
  artStyle?: string,
): Promise<ImageResult | null> {
  const appearance = sanitizeForPrompt(characterAppearance(character));
  if (!appearance) {
    console.warn(
      `[portrait] ${characterId} has no appearance — skipping`,
    );
    return null;
  }

  const storagePath = `covers/${storyId}/characters/${characterId}.png`;
  return await runImageChain({
    label: `portrait ${characterId}`,
    bucket: "covers",
    storagePath,
    aspect: "portrait",
    promptFor: (safetyLevel) =>
      buildPortraitPrompt(appearance, safetyLevel, false, artStyle),
  });
}

/**
 * Generate a draft character portrait before the story exists.
 *
 * The Craft character sheet now has its own image action, so the storage key
 * cannot depend on a persisted story id or character row yet. The final story
 * call carries this URL back with the character draft; persistence can attach
 * it to `characters.portrait_url` when the story row is created.
 */
export async function generateDraftCharacterPortrait(
  userId: string,
  requestId: string,
  character: {
    name: string;
    appearance?: string;
    /** Retired. Read only through `characterAppearance`. */
    description?: string;
    /**
     * A photo the writer attached to steer the LOOK of this character, as a
     * `data:` URL. It is a style reference, never a likeness target -- see
     * `STYLE_REFERENCE_CLAUSE` for what the model is told, and note that the
     * prompt is the weakest of the three layers holding that line.
     */
    referenceImage?: string;
  },
  /**
   * The style the Create brief is currently set to. A draft portrait is drawn
   * before any story row exists, so this is the only place the pick can come
   * from -- and the writer is comparing it against a cover that will use it.
   */
  artStyle?: string,
): Promise<ImageResult | null> {
  const appearance = sanitizeForPrompt(characterAppearance(character));
  if (!appearance) {
    console.warn(
      `[portrait] draft ${requestId} has no appearance — skipping`,
    );
    return null;
  }

  const storagePath = `draft-characters/${safePathSegment(userId)}/${
    safePathSegment(requestId)
  }.png`;
  const referenceImage = character.referenceImage;
  return await runImageChain({
    label: `draft portrait ${requestId}`,
    bucket: "covers",
    storagePath,
    aspect: "portrait",
    referenceImage,
    promptFor: (safetyLevel) =>
      buildPortraitPrompt(
        appearance,
        safetyLevel,
        // Same predicate the chain uses to decide whether to send the image,
        // so the prompt can never describe an attachment that is not there.
        Boolean(referenceImage) && referenceSurvivesLevel(safetyLevel),
        artStyle,
      ),
  });
}

/**
 * What a character is wearing when nothing said what they are wearing.
 *
 * The same clause, and the same reason, as `WARDROBE_CLAUSE` on the cover: the
 * model's untouched prior dresses a character read as Indian in traditional
 * attire and a character read as Western in a shirt, and a portrait is where
 * that is most visible because the whole frame is the person. Appearance text
 * that DOES specify dress still wins — it is earlier in the prompt and it is
 * specific, and "unless the character description specifies otherwise" says so.
 */
const PORTRAIT_WARDROBE_CLAUSE =
  "Wardrobe: ordinary everyday clothing appropriate to the setting and era, the same register of dress for every character regardless of ethnicity, unless the character description specifies otherwise. No ceremonial, festival, folk or traditional national dress unless asked for.";

/**
 * What an attached reference image is allowed to do, said to the model directly.
 *
 * The product decision (2026-09-08) is that a writer may attach a photo to steer
 * a character's LOOK -- build, hair, posture, palette, wardrobe -- and that the
 * output is an original illustration of a fictional character. What it is not
 * allowed to be is a portrait of the person in the photo. That distinction is
 * the whole basis on which the feature is allowed to exist, so it is stated to
 * the model in the prompt rather than left to the model's own judgement.
 *
 * This does not stand alone. The base Safety Rules in `story-prompts.ts` already
 * forbid real people, and naming a real person in a character sheet routes
 * through `entity-classify.ts`, which forcibly reclassifies that name as
 * `private_individual` so it never becomes a search query. (It also used to
 * lock the story private - migration 00050 - until the owner removed that
 * gate on 2026-09-18, 00091.) Prompt text is the weakest of these layers and
 * is treated as such: it is the one that shapes the output, not the one that
 * enforces the rule.
 */
const STYLE_REFERENCE_CLAUSE =
  "An attached image is provided as a STYLE AND APPEARANCE REFERENCE ONLY. " +
  "Take general build, hair, posture, colour palette and wardrobe from it. " +
  "Do NOT reproduce the face or likeness of any real person, and do not " +
  "attempt a recognisable portrait of anyone in the reference. The result " +
  "must be an original illustrated character, not a depiction of a real " +
  "individual.";

/**
 * The subject line at one rung of the safety ladder.
 *
 * There is one free-text field now, so the ladder shortens it rather than
 * dropping one of two. Detail is what a content filter objects to and it
 * accumulates left to right in how people write a look, so each rung keeps
 * less of the tail: everything, then the first sentence, then the first
 * clause.
 *
 * `appearance` is non-empty by the time it reaches here -- both callers return
 * null before generating when there is nothing to draw -- and every rung falls
 * back to "a person" anyway. A rung that produced "" would ask the provider to
 * illustrate the empty string, which is how a name-only character used to get
 * drawn as a stranger.
 */
function portraitSubjectForLevel(
  appearance: string,
  safetyLevel: number,
): string {
  if (safetyLevel === 0) return appearance || "a person";
  if (safetyLevel === 1) {
    return appearance.split(/(?<=\.)\s/)[0]?.trim() || appearance ||
      "a person";
  }
  return appearance.split(/[,.]/)[0]?.trim() || "a person";
}

function buildPortraitPrompt(
  appearance: string,
  safetyLevel: number,
  hasReference = false,
  artStyle?: string,
): string {
  // THE APPEARANCE IS THE WHOLE SUBJECT. A `gender` clause used to lead it,
  // fed by a required row on onboarding's W4 sheet; both are gone, because an
  // appearance line says it in the person's own words whenever it matters.
  const subject = portraitSubjectForLevel(appearance, safetyLevel);

  return [
    `Character portrait illustration of ${subject}.`,
    `Full body, standing, facing the viewer, on a plain neutral background.`,
    `${
      coverArtStyleClause(artStyle) ?? "Painterly book-illustration style"
    }, soft even lighting, no background scenery.`,
    PORTRAIT_WARDROBE_CLAUSE,
    `The image must contain NO text, NO titles, NO words, NO letters, NO watermarks.`,
    `Full-body portrait orientation, subject centered in frame, high quality.`,
    ...(hasReference ? [STYLE_REFERENCE_CLAUSE] : []),
  ].join(" ");
}

/**
 * Strip the characters a user could use to redirect an image prompt.
 *
 * Character fields are free text typed by a user and are interpolated straight
 * into a provider prompt. This is not a complete defence against prompt
 * injection - nothing at the string level is - but it removes the delimiters and
 * instruction-shaped punctuation that make an override read as a new
 * instruction, and it caps the length so one field cannot dominate the prompt.
 */
function sanitizeForPrompt(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/["'`{}[\]<>|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

async function runImageChain(input: {
  label: string;
  bucket: string;
  storagePath: string;
  aspect: ImageAspect;
  promptFor: (safetyLevel: number) => string;
  /** Optional style reference, as a `data:` URL. See `STYLE_REFERENCE_CLAUSE`. */
  referenceImage?: string;
}): Promise<ImageResult | null> {
  const deadline = Date.now() + CHAIN_DEADLINE_MS[input.aspect];

  /**
   * Carried across providers, never reset — but never allowed to exhaust one.
   *
   * A prompt that one provider's filter rejected will usually be rejected by
   * the next one too, so restarting the ladder at level 0 for each provider
   * spends the whole deadline re-sending a prompt already known to be
   * unacceptable. Escalating monotonically is what makes the fallback actually
   * reach a provider with a prompt that can succeed.
   *
   * The clamp below is the other half of that, and it is not optional. Without
   * it, three rejections from the first provider push the level to
   * `MAX_SAFETY_LEVELS` and the `while` guard then skips every remaining
   * provider *without sending a single request* - the exact opposite of what a
   * fallback chain is for. The whole point of trying a second provider is that
   * its filter is a different filter. So each provider is guaranteed at least
   * one attempt, at the most conservative prompt.
   */
  let safetyLevel = 0;

  for (const provider of PROVIDERS) {
    const apiKey = provider.key();
    if (!apiKey) {
      console.warn(
        `[image] ${provider.name}/${provider.model} has no credential — skipping`,
      );
      continue;
    }

    let level = Math.min(safetyLevel, MAX_SAFETY_LEVELS - 1);

    while (level < MAX_SAFETY_LEVELS) {
      if (Date.now() >= deadline) {
        console.error(`[image] deadline exceeded for ${input.label}`);
        return null;
      }
      try {
        console.log(
          `[image] ${input.label}: ${provider.name}/${provider.model} at safety level ${level}`,
        );
        const prompt = input.promptFor(level);
        const bytes = await provider.generate(
          prompt,
          apiKey,
          input.aspect,
          deadline,
          referenceSurvivesLevel(level) ? input.referenceImage : undefined,
        );
        const url = await uploadToStorage(
          input.bucket,
          input.storagePath,
          bytes,
        );
        return {
          url,
          // The extension may have changed to match the bytes; the URL is
          // authoritative, so derive the path from it rather than from what
          // was requested.
          storagePath: new URL(url).pathname.split("/object/public/")[1] ??
            input.storagePath,
          provider: provider.name,
          model: provider.model,
          prompt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[image] ${input.label}: ${provider.name}/${provider.model} level ${level} failed: ${message}`,
        );
        if (isModerationError(message)) {
          // Simplify and retry on the same provider, and remember how far we
          // got so the next provider does not repeat a rejected prompt.
          level += 1;
          safetyLevel = Math.max(safetyLevel, level);
          continue;
        }
        // Anything else - auth, quota, 5xx, timeout, malformed - is a provider
        // problem, not a prompt problem. Move to the next provider with the
        // prompt unchanged.
        break;
      }
    }
  }

  console.error(`[image] all providers exhausted for ${input.label}`);
  return null;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * OpenRouter returns images through chat completions, not an images endpoint.
 *
 * The model is asked for image output via `modalities`, and the result arrives
 * on `choices[0].message.images[].image_url.url` as a `data:` URL.
 */
async function generateWithOpenRouter(
  model: string,
  prompt: string,
  apiKey: string,
  aspect: ImageAspect,
  deadline: number,
  referenceImage?: string,
): Promise<Uint8Array> {
  const text = `${prompt} Render as a single image, ${ASPECT[aspect].words}.`;
  // With a reference attached the content becomes the multimodal array form.
  // The text part is sent FIRST deliberately: it carries
  // `STYLE_REFERENCE_CLAUSE`, and a model that reads the image before it has
  // been told what the image is for is being invited to copy it.
  const content = referenceImage
    ? [
      { type: "text", text },
      { type: "image_url", image_url: { url: referenceImage } },
    ]
    : text;

  const payload = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
    apiKey,
    {
      model,
      modalities: ["image", "text"],
      // The framing, as a parameter rather than a hope. See `ASPECT`.
      image_config: { aspect_ratio: ASPECT[aspect].ratio },
      messages: [{ role: "user", content }],
    },
    deadline,
    REQUEST_TIMEOUT_MS[aspect],
    `OpenRouter image (${model})`,
    { "HTTP-Referer": "https://katha.ai", "X-Title": "Katha AI" },
  );

  const message = (payload as {
    choices?: {
      message?: { images?: { image_url?: { url?: string } }[] };
      finish_reason?: string;
    }[];
  })?.choices?.[0]?.message;

  const url = message?.images?.[0]?.image_url?.url;
  if (!url) {
    // A refusal comes back as a normal 200 with text and no image, so an empty
    // `images` array is the moderation signal on this provider. Say so in the
    // message: `isModerationError` reads it to decide whether to simplify.
    throw new Error(
      `OpenRouter returned no image for ${model} — content policy or unsupported modality`,
    );
  }

  const comma = url.indexOf(",");
  if (url.startsWith("data:") && comma > -1) {
    return decodeBase64(url.slice(comma + 1));
  }
  return await downloadImage(url, deadline, REQUEST_TIMEOUT_MS[aspect]);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  deadline: number,
  /** This attempt's own ceiling, from `REQUEST_TIMEOUT_MS`. */
  attemptTimeoutMs: number,
  providerLabel: string,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const budget = Math.min(attemptTimeoutMs, deadline - Date.now());
  if (budget <= 0) throw new Error(`${providerLabel}: deadline exceeded`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });

    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(
        `${providerLabel} error (${res.status}): ${
          extractProviderError(payload)
        }`,
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(
  url: string,
  deadline: number,
  attemptTimeoutMs: number,
): Promise<Uint8Array> {
  const budget = Math.min(attemptTimeoutMs, deadline - Date.now());
  if (budget <= 0) throw new Error("image download: deadline exceeded");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function decodeBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Identify the image from its magic bytes, not from what we asked for.
 *
 * Providers do not all return what the path extension claims. Verified live on
 * 2026-09-03: `gemini-3.1-flash-image` and `gemini-2.5-flash-image` return PNG,
 * but `gemini-3.1-flash-lite-image` returns **JPEG** for the identical request.
 * Uploading a JPEG under `contentType: "image/png"` stores a file whose declared
 * type is a lie — the CDN then serves it with the wrong `Content-Type`, and any
 * consumer that trusts the header rather than sniffing (an image pipeline, a
 * social-card scraper, a stricter native decoder) is entitled to reject it.
 */
function sniffImageType(
  bytes: Uint8Array,
): { contentType: string; extension: string } {
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  // WEBP at offset 8 is only half the signature: the container is RIFF, and
  // checking the tail alone would accept any 12-byte payload that happened to
  // contain those four characters in that position.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  // The `covers` bucket allows png, jpeg and webp only. An unrecognized payload
  // is far more likely to be an error body than a fourth image format, so
  // failing here keeps it out of storage rather than serving it as an image.
  throw new Error("Provider returned bytes that are not a supported image");
}

async function uploadToStorage(
  bucket: string,
  path: string,
  bytes: Uint8Array,
): Promise<string> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { contentType, extension } = sniffImageType(bytes);
  // The stored path carries the real extension, so the object, its declared
  // type and its URL all agree.
  const finalPath = path.replace(/\.png$/, `.${extension}`);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(finalPath, bytes, { contentType, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(finalPath);
  return data.publicUrl;
}

export function isModerationError(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "content policy",
    "content_policy_violation",
    "safety system",
    "moderation",
    "unsafe content",
    "blocked",
    "prohibited",
    // OpenRouter signals a refusal as a normal 200 with text and no image, so
    // this phrase is how that provider says "content policy". It is scoped to
    // the exact message `generateWithOpenRouter` throws: OpenAI's own
    // "returned no image data" is a malformed response, not a refusal, and
    // treating it as one would simplify a prompt that was never rejected.
    "openrouter returned no image",
  ].some((marker) => lower.includes(marker));
}

function extractProviderError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "invalid error body";
  const error = (payload as Record<string, unknown>).error;
  if (typeof error === "string") return error.slice(0, 500);
  if (!error || typeof error !== "object") return "unknown error";
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message.slice(0, 500) : "unknown error";
}

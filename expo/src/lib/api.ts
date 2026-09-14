import { stories } from "@/data/seed";
import {
  setCharacterImageBalance,
  observeCharacterImagesRemaining,
  setCharacterImagesRemaining,
} from "@/lib/character-image-allowance";
import { pushPermissionGranted } from "@/lib/notifications";
import { bootstrapUser } from "@/lib/session";
import { postEventStream, StreamTransportError } from "@/lib/stream";
import {
  isSupabaseConfigured,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  supabase,
} from "@/lib/supabase";
import { GENRES, MAX_PLANNED_CHAPTER_COUNT } from "@/types/domain";
import type {
  Chapter,
  ChapterRole,
  CoverStatus,
  CreateDraft,
  Genre,
  HookType,
  ImageStyle,
  SeriesState,
  Story,
  StoryMode,
} from "@/types/domain";

export type LibraryResult = {
  stories: Story[];
  source: "mock" | "supabase";
};

export type EngagementMutationResult = {
  on: boolean;
  count: number;
};

export class GenerationRequestError extends Error {
  constructor(message: string, readonly resetRequestId: boolean) {
    super(message);
    this.name = "GenerationRequestError";
  }
}

/**
 * Why a shape request produced nothing.
 *
 * `rate_limited` is the one worth naming. It is not a failure of the model or
 * of the user's idea - it is one of three capacity windows in
 * `claim_story_shape_request` refusing the claim - and retrying does not help
 * within the window. Onboarding uses it to fall back to the writer's own
 * details instead of offering a Try again that cannot succeed.
 */
const SHAPE_FAILURE_REASONS = [
  "rate_limited",
  "provider_failed",
  "unavailable",
] as const;

export type StoryShapeFailureReason = typeof SHAPE_FAILURE_REASONS[number];

export class StoryShapeRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reason: StoryShapeFailureReason = "unavailable",
  ) {
    super(message);
    this.name = "StoryShapeRequestError";
  }
}

/** Why the entity visibility gate kept a story private. Mirrors the backend enum. */
export type StoryGatingReason = "living_public_figure" | "private_individual";

/**
 * Every reason a story the writer asked to publish came back private.
 *
 * The two gate reasons are decisions: the server read the idea, found a real
 * living person in it, and applied the rule. `classification_unavailable` is
 * the absence of a decision - the check itself did not finish - and it is a
 * separate value because it means something different to the writer. The
 * gated story will never be public; the unchecked one can be published later,
 * unchanged, once the check runs.
 *
 * It exists at all because of the defect found on 2026-09-09: the check had
 * never completed in production, and "no answer" arrived at the publish
 * decision looking exactly like "nobody real in this idea". The backend now
 * fails closed on that one decision and says which it was.
 */
export type StoryPrivateReason =
  | StoryGatingReason
  | "classification_unavailable";

/**
 * The server refused to make a story public - because its idea names a real
 * living person, or because it could not finish checking - and kept the story
 * private instead. This is not a failed publish in the ordinary sense: every
 * edit was still saved, the story still exists and reads exactly as before,
 * and nothing needs to be retried. The caller's job is to explain that, not to
 * offer a retry button.
 */
export class StoryGatedPrivateError extends Error {
  constructor(readonly gatingReason: StoryPrivateReason) {
    super("This story stays private.");
    this.name = "StoryGatedPrivateError";
  }
}

export type StoryShape = {
  /** Primary first, then up to two editable secondary genre chips. */
  genres: Genre[];
  whereAndWhen?: string;
  characters: CreateDraft["characters"];
  suggestedMoments: string[];
  /**
   * The ordered chapter plan. It comes back from this same free call rather
   * than a second one, because the outline is the most persuasive thing on the
   * blueprint screen and it has to cost nothing.
   */
  beats: string[];
  /** Onboarding variant only: the title the blueprint card carries. */
  title?: string;
  /** Onboarding variant only: the opening prose the preview screen shows. */
  opening?: string;
  /**
   * Grounding resolved alongside the shape, carried opaquely.
   *
   * The client deliberately does not model the card shape. It never renders
   * these, never edits them and never reasons about them - it hands them back
   * to `generate-story`, which re-validates them at the boundary. Duplicating
   * the schema here would create a second copy to keep in step with the
   * backend for no behaviour the user can see.
   */
  grounding?: unknown[];
  groundingEntities?: unknown[];
};

export type StoryShapeBrief = {
  characters?: CreateDraft["characters"];
  moments?: string[];
  writingStyle?: string;
  avoid?: string;
  chapterLength?: CreateDraft["chapterLength"];
  plannedChapterCount?: CreateDraft["plannedChapterCount"];
};

/**
 * Free scaffolding for Screen 2. The server deliberately exposes no error
 * surface here: an unavailable convenience must never block story creation.
 */
export async function inferStoryBrief(
  idea: string,
  /**
   * The onboarding variant widens the schema to include a title and a real
   * opening. It stays one call: onboarding is budgeted at one model call in
   * total, so the extra fields are a wider response, never a second request.
   */
  variant: "create" | "onboarding" = "create",
  /**
   * The shelf the creator picked. Sent so inference shapes to their choice
   * instead of overruling it: a user who typed a haunted house and then chose
   * Romance wants a romance back.
  */
  genre?: Genre,
  brief?: StoryShapeBrief,
  options: { throwOnError?: boolean } = {},
): Promise<StoryShape | null> {
  const fail = (
    message: string,
    retryable: boolean,
    reason: StoryShapeFailureReason = "unavailable",
  ) => {
    if (options.throwOnError) {
      throw new StoryShapeRequestError(message, retryable, reason);
    }
    return null;
  };

  if (!isSupabaseConfigured || !idea.trim()) {
    return fail("Story shaping is not configured.", false);
  }

  try {
    await bootstrapUser();
  } catch {
    return fail(
      "Unable to set up your story account. Please try again.",
      true,
      "provider_failed",
    );
  }

  const { data, error } = await supabase.functions.invoke("shape-story", {
    body: {
      idea,
      variant,
      genre,
      characters: brief?.characters,
      moments: brief?.moments,
      writing_style: brief?.writingStyle,
      avoid: brief?.avoid,
      chapter_length: brief?.chapterLength,
      planned_chapter_count: brief?.plannedChapterCount,
    },
  });
  if (error) {
    const message = error.message || "Story shaping failed.";
    const rateLimited = /(rate|limit|quota|429|too many)/i.test(message);
    return fail(
      message,
      !rateLimited,
      rateLimited ? "rate_limited" : "provider_failed",
    );
  }
  if (!data?.shape || typeof data.shape !== "object") {
    /**
     * The server says why now, and the difference matters upstream.
     *
     * Every empty answer used to arrive here as one non-retryable condition
     * called "returned an empty response", including a refused rate-limit
     * claim - so a user who hit a capacity ceiling was told their idea had
     * produced nothing usable, on a screen with no way forward. `reason` comes
     * from `shape-story`, which is the only place that knows the difference.
     */
    const reason = SHAPE_FAILURE_REASONS.includes(
        data?.reason as StoryShapeFailureReason,
      )
      ? data.reason as StoryShapeFailureReason
      : "unavailable";
    return fail(
      reason === "rate_limited"
        ? "We are shaping a lot of stories right now."
        : "Story shaping returned an empty response.",
      reason === "provider_failed",
      reason,
    );
  }

  const shape = data.shape as Record<string, unknown>;
  const genres = Array.isArray(shape.genres)
    ? shape.genres.filter((genre): genre is Genre =>
      typeof genre === "string" && (GENRES as readonly string[]).includes(genre)
    )
    : [];
  const parsedCharacters = Array.isArray(shape.characters)
    ? shape.characters.filter((
      character,
    ): character is CreateDraft["characters"][number] =>
      Boolean(character) && typeof character === "object" &&
      typeof (character as { name?: unknown }).name === "string" &&
      (character as { name: string }).name.trim().length > 0
    ).map((character) => ({
      name: character.name.trim(),
      background: typeof character.background === "string"
        ? character.background
        : undefined,
      // Required on the draft, so it is a string or "". The shape endpoint no
      // longer returns a `description`; a cast is one field now, and a blank
      // here is a character the writer still has to fill in rather than a
      // second field that quietly went missing.
      appearance: typeof character.appearance === "string"
        ? character.appearance
        : "",
      isHero: character.isHero === true,
    }))
    : [];
  const leadIndex = parsedCharacters.findIndex((character) => character.isHero);
  const characters = parsedCharacters.map((character, index) => ({
    ...character,
    isHero: index === (leadIndex >= 0 ? leadIndex : 0),
  }));
  const suggestedMoments = Array.isArray(shape.suggestedMoments)
    ? shape.suggestedMoments.filter((moment): moment is string =>
      typeof moment === "string"
    )
    : [];
  const beats = Array.isArray(shape.beats)
    ? shape.beats.filter((beat): beat is string =>
      typeof beat === "string" && beat.trim().length > 0
    )
    : [];

  return {
    genres,
    whereAndWhen: typeof shape.whereAndWhen === "string"
      ? shape.whereAndWhen
      : undefined,
    characters,
    suggestedMoments,
    beats,
    title: typeof shape.title === "string" && shape.title.trim()
      ? shape.title.trim()
      : undefined,
    opening: typeof shape.opening === "string" && shape.opening.trim()
      ? shape.opening.trim()
      : undefined,
    // Read from the response root, not from `shape`: grounding is resolved by
    // a separate concurrent call on the server and is absent whenever that
    // call found nothing or failed, which is the common case.
    grounding: Array.isArray(data.grounding) ? data.grounding : undefined,
    groundingEntities: Array.isArray(data.grounding_entities)
      ? data.grounding_entities
      : undefined,
  };
}

export async function inferOnboardingStoryBrief(
  idea: string,
  genre?: Genre,
  brief?: StoryShapeBrief,
): Promise<StoryShape> {
  const shape = await inferStoryBrief(
    idea,
    "onboarding",
    genre,
    brief,
    { throwOnError: true },
  );
  if (!shape) {
    throw new StoryShapeRequestError(
      "Story shaping returned an empty response.",
      false,
      "unavailable",
    );
  }
  return shape;
}

// Retain the original name for callers that landed before the Create flow.
export const shapeStoryIdea = inferStoryBrief;

// ---------------------------------------------------------------------------
// Story engagement
// ---------------------------------------------------------------------------

const engagementEndpointsEnabled =
  process.env.EXPO_PUBLIC_ENABLE_ENGAGEMENT_ENDPOINTS === "true";
const inFlightEngagement = new Map<string, Promise<EngagementMutationResult>>();

async function setEngagementState(
  endpoint: "like" | "bookmark" | "follow-story" | "follow-user",
  idKey: "storyId" | "authorId",
  id: string,
  on: boolean,
  optimisticCount: number,
): Promise<EngagementMutationResult> {
  if (!isSupabaseConfigured || !engagementEndpointsEnabled) {
    return { on, count: optimisticCount };
  }

  const key = `${endpoint}:${id}`;
  const existing = inFlightEngagement.get(key);
  if (existing) return existing;

  const request = (async () => {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke(endpoint, {
      body: { [idKey]: id, on },
    });
    if (error || !data || typeof data !== "object") {
      throw error ?? new Error(`${endpoint} returned no result`);
    }
    const payload = data as Record<string, unknown>;
    if (typeof payload.on !== "boolean" || typeof payload.count !== "number") {
      throw new Error(`${endpoint} returned an invalid result`);
    }
    return { on: payload.on, count: payload.count };
  })();

  inFlightEngagement.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlightEngagement.get(key) === request) {
      inFlightEngagement.delete(key);
    }
  }
}

export async function setStoryLike(
  storyId: string,
  on: boolean,
  optimisticCount: number,
): Promise<EngagementMutationResult> {
  return setEngagementState("like", "storyId", storyId, on, optimisticCount);
}

export async function setStoryBookmark(
  storyId: string,
  on: boolean,
  optimisticCount: number,
): Promise<EngagementMutationResult> {
  return setEngagementState("bookmark", "storyId", storyId, on, optimisticCount);
}

export async function setStoryFollow(
  storyId: string,
  on: boolean,
  optimisticCount: number,
): Promise<EngagementMutationResult> {
  return setEngagementState("follow-story", "storyId", storyId, on, optimisticCount);
}

export async function setAuthorFollow(
  authorId: string,
  on: boolean,
  optimisticCount: number,
): Promise<EngagementMutationResult> {
  return setEngagementState("follow-user", "authorId", authorId, on, optimisticCount);
}

export type CharacterImageInput = {
  requestId: string;
  name: string;
  appearance?: string;
  /** Optional style reference as a `data:` URL. See `CreateDraft.characters`. */
  referenceImage?: string;
  /**
   * The brief's *Image style* pick, sent so the draft portrait is drawn in the
   * look the cover will use.
   *
   * The endpoint accepted no style at all, so a writer who chose Watercolour
   * got a house-style cast on the very screen where they compare the two. An
   * absent value is normalised server-side to `auto`, the genre's own look.
   */
  imageStyle?: ImageStyle;
};

/** What one character image cost, and what the account has left. */
export type CharacterImageResult = {
  url: string;
  /** 0 for one of the six, 1 once they are spent. Absent on an old deploy. */
  creditsCharged?: number;
  /** Free images left AFTER this one. Absent on an old deploy. */
  freeRemaining?: number;
  /** The ledger balance the server saw. Absent on an old deploy. */
  balance?: number;
};

/**
 * Separate character-image call used by the Craft character sheet.
 *
 * Production backend wiring is expected to expose `generate-character-image`
 * around `_shared/image.ts`. Until that endpoint is deployed, local/mock mode
 * returns a stable draft URL so the UI flow can be exercised without starting
 * story generation early.
 */
/**
 * A refused portrait claim, told apart from a portrait that failed to draw.
 *
 * Extends `GenerationRequestError` rather than replacing it, so every existing
 * `catch` that reads `.message` and `.resetRequestId` keeps working; a screen
 * that wants to say "later" rather than "again" checks `instanceof`.
 */
export class CharacterPortraitRateLimitError extends GenerationRequestError {
  constructor(message: string) {
    super(message, false);
    this.name = "CharacterPortraitRateLimitError";
  }
}

/**
 * The guest cap, told apart from both a draw that failed and a refused claim.
 *
 * 403 `{ code: "guest_portrait_cap" }` is not a wait and not a fault: it is the
 * server saying this anonymous session has had its free portraits and the way
 * past it is an account, not another press. Like the rate-limit error it
 * extends `GenerationRequestError` so existing `catch` blocks keep reading
 * `.message`, and it carries the SERVER's sentence rather than one of ours,
 * because only the server knows what the cap currently is.
 */
export class CharacterPortraitGuestCapError extends GenerationRequestError {
  constructor(message: string) {
    super(message, false);
    this.name = "CharacterPortraitGuestCapError";
  }
}

/**
 * The six free images are gone and the balance cannot buy the seventh.
 *
 * 402 `{ code: "insufficient_credits" }`, and it is the refusal a named account
 * gets where an anonymous one gets the guest cap above -- buying credits needs
 * an account, so only a signed-in caller can be told to buy. Separate from both
 * because the way out is different again: not a wait, not a sign-in, a top-up.
 */
export class CharacterPortraitInsufficientCreditsError
  extends GenerationRequestError {
  constructor(message: string) {
    super(message, false);
    this.name = "CharacterPortraitInsufficientCreditsError";
  }
}

/**
 * The JSON body of a failed edge invoke, or null when there is not one.
 *
 * The Supabase JS SDK reports a non-2xx function response as an error with no
 * parsed body; `error.context.json()` is the only way to the payload, and it
 * can only be read once, so callers that need two fields read the object.
 */
async function edgeFunctionBody(
  error: unknown,
): Promise<Record<string, unknown> | null> {
  const context = error && typeof error === "object"
    ? (error as { context?: { json?: () => Promise<unknown> } }).context
    : undefined;
  if (typeof context?.json !== "function") return null;
  try {
    const body = await context.json();
    return body && typeof body === "object"
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Onboarding shares the one portrait allowance, and that is the decision.
 *
 * `claim_character_portrait_request` (migration 00055) is 12 requests per 60
 * minutes per user, and it is the only bound on a path with no credit and no
 * idempotency key. Character onboarding spends at most three of those -- one
 * "Find them" and two reimagines -- so a first-run user is nowhere near it,
 * and a second window for onboarding would be a second counter an anonymous
 * caller could reset by minting a fresh session (00055 records that gap
 * honestly). Sharing keeps one number to reason about.
 *
 * What that costs: a user who spent the allowance in the Craft sheet and then
 * restarted onboarding hits the cap on the aha screen. That is why the refusal
 * comes back as its own error with its own sentence instead of the generic
 * "Could not create the character image" -- a cap is a wait, not a failure,
 * and a Try again that cannot succeed inside the window is worse than saying
 * so.
 */
export async function generateCharacterImage(
  input: CharacterImageInput,
): Promise<CharacterImageResult> {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return { url: `draft-character://${input.requestId}` };
  }

  try {
    await bootstrapUser();
  } catch {
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }

  const { data, error } = await supabase.functions.invoke(
    "generate-character-image",
    {
      body: {
        request_id: input.requestId,
        name: input.name,
        appearance: input.appearance,
        // "auto" when the caller names no style, which is what onboarding
        // does. `normalizeCoverArtStyle` maps anything unrecognised to the
        // same value, so this is the explicit spelling of the server default
        // rather than a second one.
        image_style: input.imageStyle ?? "auto",
        // Omitted rather than sent as null when absent: the endpoint treats a
        // present-but-unusable field as an error, which is right, and an
        // explicit null is present.
        ...(input.referenceImage
          ? { reference_image: input.referenceImage }
          : {}),
      },
    },
  );

  if (error) {
    // 429 is the rate-limit claim being refused, and it is the one failure
    // here that retrying cannot fix inside the window.
    if (edgeFunctionStatus(error) === 429) {
      throw new CharacterPortraitRateLimitError(
        "You've made a lot of characters just now. Give it a few minutes.",
      );
    }
    // 403 is the guest cap. Only the typed body says so: a 403 with any other
    // shape is an ordinary refusal and must keep the generic sentence, or a
    // permissions bug would tell people to sign in when they already are.
    if (edgeFunctionStatus(error) === 403) {
      const body = await edgeFunctionBody(error);
      if (body?.code === "guest_portrait_cap") {
        const message = typeof body.error === "string" && body.error.trim()
          ? body.error
          : "Sign in to keep making characters.";
        throw new CharacterPortraitGuestCapError(message);
      }
    }
    // 402 is the six being spent and the balance being short. Unlike the two
    // above it is not a wall: a top-up clears it, and the sheet that catches
    // this is the one that can offer that.
    if (edgeFunctionStatus(error) === 402) {
      throw new CharacterPortraitInsufficientCreditsError(
        "You're out of credits. Top up to make more characters.",
      );
    }
    throw new GenerationRequestError(
      "Could not create the character image. Please try again.",
      false,
    );
  }

  const url = typeof data?.url === "string"
    ? data.url
    : typeof data?.image_url === "string"
    ? data.image_url
    : "";
  if (!url) {
    throw new GenerationRequestError(
      "Character image returned no image.",
      false,
    );
  }

  // The authoritative count, from the response that just moved it. Every
  // surface that quotes a portrait price reads this, so they cannot disagree
  // about what the next one costs.
  // `observe`, not `set`: two requests in flight can finish out of order, and
  // the older answer must not raise a count the newer one already lowered.
  if (typeof data?.free_remaining === "number") {
    observeCharacterImagesRemaining(data.free_remaining);
  }
  if (typeof data?.balance === "number") {
    setCharacterImageBalance(data.balance);
  }

  return {
    url,
    // What the server actually charged and what is left of the six, so the
    // next quote comes from the ledger rather than from the client counting
    // its own taps. Absent on any deploy older than 00088.
    creditsCharged: typeof data?.credits_charged === "number"
      ? data.credits_charged
      : undefined,
    freeRemaining: typeof data?.free_remaining === "number"
      ? data.free_remaining
      : undefined,
    balance: typeof data?.balance === "number" ? data.balance : undefined,
  };
}

export async function getLibrary(
  query?: { q?: string; genre?: string },
): Promise<LibraryResult> {
  if (!isSupabaseConfigured) {
    return { stories: filterLocalStories(query), source: "mock" };
  }

  const params = new URLSearchParams({ page: "1", limit: "20" });
  if (query?.q) params.set("q", query.q);
  if (query?.genre) params.set("genre", query.genre);

  const { data, error } = await supabase.functions.invoke(
    `library?${params.toString()}`,
    {
      method: "GET",
    },
  );

  if (error || !data?.stories) {
    return { stories: filterLocalStories(query), source: "mock" };
  }

  return { stories: filterLocalStories(query), source: "supabase" };
}

/**
 * The caller's own stories, with their chapters, so a reload does not erase them.
 *
 * This closes a gap that cost real work: stories persisted correctly, but no
 * endpoint returned a writer's own PRIVATE ones (the library query is
 * `is_public OR is_curated`, and a fresh story is private by column default and
 * by the entity gate), and the client held its stories in a `useState` array.
 * So every story a writer made vanished from the interface on reload while the
 * rows sat safe in the database -- stories they had spent credits on.
 *
 * Failure is silent and returns `[]`. This runs on boot, and a writer opening
 * the app to a network blip should get the app, not an error about a list.
 */
export async function fetchMyStories(): Promise<Story[]> {
  const shelf = await fetchCreatedShelf();
  return shelf.ok ? shelf.stories : [];
}

/**
 * A shelf read that can say it failed.
 *
 * `fetchMyStories` swallows every failure into `[]` because it runs on boot,
 * where an error banner would be noise. Library's tabs need the other answer:
 * "we could not load this" is a different thing to show a reader than "you
 * have not written anything yet", and collapsing the two is how an interface
 * tells someone their work is gone when it is only unreachable.
 */
export type ShelfResult = { ok: true; stories: Story[] } | { ok: false };

export async function fetchCreatedShelf(): Promise<ShelfResult> {
  if (!isSupabaseConfigured) return { ok: true, stories: [] };

  let userId: string;
  try {
    const user = await bootstrapUser();
    if (!user) return { ok: true, stories: [] };
    userId = user.userId;
  } catch {
    return { ok: false };
  }

  // Read straight from PostgREST rather than through the `library` function.
  //
  // RLS already expresses exactly the right rule and has since 00002:
  // `is_public = true or is_curated = true or auth.uid() = author_id`. An
  // author can read their own stories whatever their visibility, and their own
  // chapters through the matching policy on `chapters`. Going through an edge
  // function would put a second implementation of that rule in front of the
  // one the database already enforces -- and, more practically, would make
  // this feature wait on a deploy to be usable at all.
  //
  // `author_id` is still filtered explicitly. RLS would scope the read anyway,
  // but a query that relies on a policy to be correct reads as a bug to the
  // next person, and the filter costs nothing.
  const { data, error } = await supabase
    .from("stories")
    .select(
      // `beats`, `series_state`, `story_mode`, `planned_chapter_count`,
      // `is_public` and `entity_gate_reason` are not decoration. The
      // chapter-end screen derives its "what happens next" chips from the
      // beats, the open hooks, the promised payoffs and the next-chapter
      // pressure; without them a story opened from Library or Home offers a
      // bare text box instead. That was the reload bug: the chips appeared
      // once, right after generating (where `mapGeneratedStory` reads them
      // from the response), and never again, because this query never asked
      // for the columns and `hydrateStoryRow` filled in empties.
      SHELF_STORY_COLUMNS,
    )
    .eq("author_id", userId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error || !Array.isArray(data)) return { ok: false };

  const stories = await Promise.all(data.map((row) => hydrateStoryRow(row)));
  return { ok: true, stories: stories.filter((story): story is Story => story !== null) };
}

/** The column list every shelf read selects. Kept in one place so they stay identical. */
const SHELF_STORY_COLUMNS =
  "id, title, author_id, genre, primary_genre, topic, cover_image_url, cover_status, cover_regen_count, length_type, audience_mode, spice_level, content_rating, language, is_curated, is_public, story_mode, story_flow, beats, series_state, planned_chapter_count, illustrate_chapters, entity_gate_reason, like_count, bookmark_count, read_count, created_at, auto_run_through_chapter";

/**
 * The stories this reader starred, newest star first.
 *
 * Read from `bookmarks` directly. The row is the only record of the act, and
 * Library used to fake this tab with `bookmarks > 100` on the feed - a
 * popularity filter wearing a saved-stories label, which showed a reader
 * stories they had never touched and hid every one they had.
 *
 * RLS on `bookmarks` already scopes the select to `auth.uid()`; the explicit
 * filter is there so the query reads correctly on its own.
 */
export async function fetchStarredShelf(): Promise<ShelfResult> {
  if (!isSupabaseConfigured) return { ok: true, stories: [] };

  let userId: string;
  try {
    const user = await bootstrapUser();
    if (!user) return { ok: true, stories: [] };
    userId = user.userId;
  } catch {
    return { ok: false };
  }

  const { data: bookmarkRows, error: bookmarkError } = await supabase
    .from("bookmarks")
    .select("story_id, bookmarked_at")
    .eq("user_id", userId)
    .order("bookmarked_at", { ascending: false })
    .limit(50);

  if (bookmarkError || !Array.isArray(bookmarkRows)) return { ok: false };

  const orderedIds = bookmarkRows
    .map((row) => (row as { story_id?: unknown }).story_id)
    .filter((id): id is string => typeof id === "string");
  if (orderedIds.length === 0) return { ok: true, stories: [] };

  const { data, error } = await supabase
    .from("stories")
    .select(SHELF_STORY_COLUMNS)
    .in("id", orderedIds);

  if (error || !Array.isArray(data)) return { ok: false };

  const hydrated = await Promise.all(data.map((row) => hydrateStoryRow(row)));
  const byId = new Map(
    hydrated
      .filter((story): story is Story => story !== null)
      .map((story) => [story.id, story]),
  );

  // Ordered by when it was starred, not by whatever order PostgREST returned
  // the story rows in, and every one of them is starred by definition.
  const stories = orderedIds
    .map((id) => byId.get(id))
    .filter((story): story is Story => story !== undefined)
    .map((story) => ({ ...story, viewerHasBookmarked: true }));

  return { ok: true, stories };
}

/** One library row plus its chapters, or null when the row is unusable. */
async function hydrateStoryRow(row: unknown): Promise<Story | null> {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const title = typeof record.title === "string" ? record.title : null;
  if (!id || !title) return null;

  const { data: chapterRows } = await supabase
    .from("chapters")
    .select(
      "id, story_id, chapter_number, title, content, first_line, previously_summary, hook_type, hook_text, is_published, audio_url, image_url",
    )
    .eq("story_id", id)
    .order("chapter_number", { ascending: true });

  const chapters = (chapterRows ?? []).map((chapter) => {
    const c = chapter as Record<string, unknown>;
    const content = typeof c.content === "string" ? c.content : "";
    return {
      id: typeof c.id === "string" ? c.id : `${id}-chapter`,
      storyId: id,
      title: typeof c.title === "string" && c.title.trim()
        ? c.title
        : "Chapter one",
      paragraphs: content.split(/\n\s*\n/).filter(Boolean),
      chapterNumber: typeof c.chapter_number === "number" ? c.chapter_number : 1,
      chapterRole: parseChapterRole(c.chapter_role, "standalone"),
      firstLine: stringOrUndefined(c.first_line),
      previouslySummary: stringOrUndefined(c.previously_summary),
      hookType: parseHookType(c.hook_type),
      hookText: stringOrUndefined(c.hook_text),
      isPublished: c.is_published === true,
      imageUrl: stringOrUndefined(c.image_url),
      audioUrl: typeof c.audio_url === "string" ? c.audio_url : undefined,
    };
  });

  // A story with no readable chapter is not something to put in a library: the
  // row exists but there is nothing to open. Better absent than a card that
  // leads to an empty page.
  if (chapters.length === 0) return null;

  const serverGenres = Array.isArray(record.genre) ? record.genre : [];
  const genre = isGenre(record.primary_genre)
    ? record.primary_genre
    : isGenre(serverGenres[0])
    ? serverGenres[0]
    : "adventure";

  return {
    id,
    title,
    authorId: typeof record.author_id === "string" ? record.author_id : "",
    genre,
    primaryGenre: genre,
    // The row's own `story_mode` first: a series whose second chapter has not
    // been written yet is still a series, and counting chapters called it a
    // standalone and hid the continuation UI on exactly the story that needed
    // it most.
    storyMode: isStoryMode(record.story_mode)
      ? record.story_mode
      : chapters.length > 1
      ? "series"
      : "standalone",
    plannedChapterCount: isPlannedChapterCount(record.planned_chapter_count)
      ? record.planned_chapter_count
      : undefined,
    // Read from the row, not inferred. This is the only place the reader can
    // learn it: the pick is made once in the brief and honoured at every
    // chapter end afterwards, which is a different session from the one that
    // created the story. Anything but the literal 'auto' is interactive -- the
    // mode that asks before it spends a credit.
    storyFlow: record.story_flow === "auto" ? "auto" : "interactive",
    // Read from the row for the same reason `storyFlow` is, and it is why the
    // column is on `stories` rather than held in the generation response: the
    // chapters an auto story has already paid for have to survive an app
    // restart, a cold library read and a second device. Without it a reload
    // would either stall a run the writer paid for or, worse, buy its chapters
    // a second time.
    autoRunThroughChapter: autoRunThroughChapter(
      record.auto_run_through_chapter,
    ),
    chapterLength: isChapterLength(record.length_type)
      ? record.length_type
      : undefined,
    // Parsed with the same helper `mapGeneratedStory` uses, so a story reads
    // identically whether it came from a generation response or from a row
    // after a reload. These were hardcoded `[]` and `undefined`.
    beats: Array.isArray(record.beats)
      ? record.beats.filter((beat): beat is string => typeof beat === "string")
      : [],
    seriesState: parseSeriesState(record.series_state),
    audienceMode: record.audience_mode === "kids" ? "kids" : "adult",
    spiceLevel: record.spice_level === "steamy" ? "steamy" : "sweet",
    contentRating: typeof record.content_rating === "string"
      ? record.content_rating
      : undefined,
    synopsis: typeof record.topic === "string" && record.topic.trim()
      ? record.topic.trim()
      : chapters[0].paragraphs[0]?.slice(0, 180) ?? "",
    chapters,
    likes: numberOrZero(record.like_count),
    bookmarks: numberOrZero(record.bookmark_count),
    views: numberOrZero(record.read_count),
    tags: ["draft"],
    publishedOffset: 0,
    isFeatured: record.is_curated === true,
    language: typeof record.language === "string" ? record.language : "English",
    coverImageUrl: stringOrUndefined(record.cover_image_url),
    // Absent means "this row was read from a surface that does not carry the
    // column" (the `library` edge function's field list, a seed story), not
    // "no illustrations". The reader falls back to whether the chapter itself
    // has art, which is the honest answer when the flag is unknown.
    illustrateChapters: record.illustrate_chapters === true ? true : undefined,
    coverStatus: parseCoverStatus(record.cover_status),
    coverRegenCount: numberOrZero(record.cover_regen_count),
  };
}

export async function generateStory(
  draft: CreateDraft,
  requestId: string,
): Promise<Story> {
  if (!isSupabaseConfigured) {
    return await localGeneratedStory(draft);
  }

  try {
    await bootstrapUser();
  } catch {
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }

  const notifyOnReady = await pushPermissionGranted();
  const { data, error } = await supabase.functions.invoke("generate-story", {
    body: buildGenerationRequestBody(draft, requestId, notifyOnReady),
  });

  if (error) {
    const failure = await edgeFunctionFailure(error, data);
    throw new GenerationRequestError(failure.message, failure.resetRequestId);
  }
  if (!data?.story) throw new Error("Story generation returned no story");

  return mapGeneratedStory(data, draft);
}

export interface StreamedStoryHandlers {
  /** Fired once, before any prose, with the row the credit was reserved against. */
  onMeta?: (meta: { storyId: string; balance: number }) => void;
  /** Fired at each real pipeline transition, for an honest progress display. */
  onStage?: (stage: string) => void;
  /**
   * The story's name, as soon as the server has one - which is before the
   * first paragraph, not after the last. May never fire: a naming call that
   * failed sends nothing and the title arrives with `done` as it always did.
   */
  onTitle?: (names: { title?: string; chapterTitle?: string }) => void;
  /** Fired for every chunk of prose, in order. */
  onDelta: (text: string) => void;
}

/**
 * Read a `title` event's payload, keeping only fields that are really there.
 *
 * The server omits a name it could not produce, and an omitted name must stay
 * omitted rather than becoming the empty string: `""` would overwrite a title
 * the client already has (a continuation knows its story's name) with nothing.
 */
function titleEventNames(
  payload: Record<string, unknown>,
): { title?: string; chapterTitle?: string } {
  const names: { title?: string; chapterTitle?: string } = {};
  if (typeof payload.title === "string" && payload.title.trim()) {
    names.title = payload.title.trim();
  }
  if (
    typeof payload.chapter_title === "string" && payload.chapter_title.trim()
  ) {
    names.chapterTitle = payload.chapter_title.trim();
  }
  return names;
}

/**
 * Generate a story, rendering prose as it is written.
 *
 * Measured end to end against production on 2026-09-05: first prose at 5.6s
 * against a 49.1s total, so the reader waits 5.6 seconds instead of 49. The
 * story is identical either way; only the waiting changes.
 *
 * The server remains the source of truth. The prose delivered through `onDelta`
 * is for display only - the chapter that is persisted, and the `Story` this
 * resolves with, come from the terminal `done` event, so a client that renders
 * the stream incorrectly cannot corrupt what is saved.
 *
 * On failure the caller keeps whatever prose was already shown. `partial` says
 * whether that happened: erasing text somebody has already read is worse than
 * leaving it on screen unfinished, and the credit is refunded either way.
 */
export async function generateStoryStreaming(
  draft: CreateDraft,
  requestId: string,
  handlers: StreamedStoryHandlers,
): Promise<Story> {
  if (!isSupabaseConfigured) {
    return await localGeneratedStory(draft);
  }

  // Overlapped for the same reason the continuation path overlaps them: a
  // round trip and an OS permission read, neither needing the other's answer,
  // both in front of a writer watching a loader.
  const notifyPromise = pushPermissionGranted();
  try {
    await bootstrapUser();
  } catch {
    void notifyPromise.catch(() => false);
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }

  const notifyOnReady = await notifyPromise;

  const done = await runStreamedCall({
    fn: "generate-story-stream",
    body: buildGenerationRequestBody(draft, requestId, notifyOnReady),
    onEvent: (event, payload) => {
      if (event === "delta") {
        const text = payload.text;
        if (typeof text === "string") handlers.onDelta(text);
      } else if (event === "stage") {
        handlers.onStage?.(String(payload.stage ?? ""));
      } else if (event === "title") {
        const names = titleEventNames(payload);
        if (names.title || names.chapterTitle) handlers.onTitle?.(names);
      } else if (event === "meta") {
        handlers.onMeta?.({
          storyId: String(payload.story_id ?? ""),
          balance: Number(payload.balance ?? 0),
        });
      }
    },
  });

  if (!done.story) {
    throw new GenerationRequestError(
      "The story stopped partway through. Please try again.",
      false,
    );
  }
  return mapGeneratedStory(done, draft);
}

/**
 * The chapter length generation will actually use for `draft`.
 *
 * A kids draft with no explicit choice defaults to "short" (see
 * `chooseAudience` in `CreateBriefFlow.tsx`), but the backend's own fallback
 * for an entirely absent `chapter_length` is "standard" -- a generic default
 * that knows nothing about audience mode. Sending `draft.chapterLength`
 * unmodified would let that generic default quietly override the
 * kids-specific one. This is the one place the effective value is computed;
 * both the request body below and every screen that displays "what will
 * generate" read it from here, so the two can never say different things.
 */
export function effectiveChapterLength(
  draft: Pick<CreateDraft, "chapterLength" | "audienceMode">,
): NonNullable<CreateDraft["chapterLength"]> {
  return draft.chapterLength ?? (draft.audienceMode === "kids" ? "short" : "standard");
}

/**
 * The generation request body, built once for both the buffered and the
 * streamed path.
 *
 * These two calls must send byte-identical bodies: they hit the same validator,
 * reserve the same credit, and a field that reaches one but not the other
 * produces a story that differs depending on which transport the client
 * happened to use. That is a bug nobody would think to look for, so there is
 * one builder rather than two literals.
 */
function buildGenerationRequestBody(
  draft: CreateDraft,
  requestId: string,
  notifyOnReady = false,
) {
  return {
      request_id: requestId,
      // Read from the OS, never assumed. The server sends nothing unless this
      // is a literal true, so a user who declined the notify screen cannot be
      // notified by a stale client flag.
      notify_on_ready: notifyOnReady,
      primary_genre: draft.primaryGenre,
      genres: draft.genres,
      audience_mode: draft.audienceMode,
      spice_level: draft.spiceLevel,
      identity_lenses: draft.identityLenses,
      topic: draft.seed,
      // Blank rows never leave the device.
      //
      // The create screen used to seed one empty character and send it as-is;
      // `validation.ts` rejects any supplied character without a name, so the
      // common case — a user who never opened the cast — failed with a 400 on
      // the primary path. The screen no longer seeds one, and this filter is
      // the second line of defence: a user who taps "add character" and then
      // leaves the row blank must not have their generation refused for it.
      characters: draft.characters
        .filter((c) => c.name.trim())
        .map((c) => ({
          name: c.name,
          background: c.background,
          appearance: c.appearance,
          isHero: c.isHero,
          portrait_url: c.portraitUrl,
          // The link back to the writer's saved-character library, when they
          // picked this person rather than writing them. The fields above are
          // still sent in full: the writer may have edited them for this
          // story, and a story's cast is its own.
          saved_character_id: c.savedCharacterId,
        })),
      language: draft.language,
      where_and_when: draft.whereAndWhen,
      moments: draft.moments,
      // The plan the writer approved on the blueprint screen. Without it the
      // outline they were shown and the story they receive are unrelated.
      beats: draft.beats,
      story_values: draft.storyValues,
      writing_style: draft.writingStyle,
      avoid: draft.avoid,
      chapter_length: effectiveChapterLength(draft),
      planned_chapter_count: draft.plannedChapterCount,
      illustrate_chapters: draft.illustrateChapters,
      /**
       * The look every image in this story is drawn in.
       *
       * Always sent, `auto` included, because `auto` is a choice the writer
       * can return to and not merely the absence of one -- a request that
       * omitted it would be indistinguishable from a client too old to have
       * the control, and the server could never tell "match the genre" from
       * "this client cannot say".
       */
      image_style: draft.imageStyle ?? "auto",
      /**
       * Who picks the direction between chapters.
       *
       * Always sent, for the same reason `image_style` is. Persisted on the
       * story row by migration 00076 and read back at every chapter end, which
       * is where the pick means anything and which is a different session from
       * this one. The server clamps an unrecognised value to `interactive` --
       * the mode that asks before it spends a credit.
       */
      story_flow: draft.storyFlow ?? "interactive",
      // story_mode is the current request contract. The backend still accepts
      // the legacy is_series boolean, but story_mode takes precedence there and
      // is what new callers are expected to send.
      story_mode: draft.isSeries ? "series" : "standalone",
      // Resolved during shaping and echoed back untouched. Omitted entirely
      // when absent so an ungrounded request is byte-identical to what it was
      // before grounding existed.
      ...(draft.grounding?.length ? { grounding: draft.grounding } : {}),
      ...(draft.groundingEntities?.length
        ? { grounding_entities: draft.groundingEntities }
        : {}),
  };
}

/**
 * The HTTP status behind a failed `functions.invoke`, or null.
 *
 * The Supabase JS SDK reports a non-2xx function response as an error whose
 * `context` is the `Response`, so the status is the only thing that survives
 * without reading the body. Same reach-through as `edgeFunctionFailure` below.
 */
function edgeFunctionStatus(error: unknown): number | null {
  const status = (error as { context?: { status?: number } } | null)?.context
    ?.status;
  return typeof status === "number" ? status : null;
}

async function edgeFunctionFailure(error: unknown, data: unknown) {
  const dataFailure = objectFailure(data);
  if (dataFailure) return dataFailure;

  const context = error && typeof error === "object"
    ? (error as { context?: { json?: () => Promise<unknown> } }).context
    : undefined;
  if (typeof context?.json === "function") {
    try {
      const responseFailure = objectFailure(await context.json());
      if (responseFailure) return responseFailure;
    } catch {
      // Fall through to the SDK error message when the response is not JSON.
    }
  }
  return {
    message: error instanceof Error ? error.message : "Story generation failed",
    resetRequestId: false,
  };
}

function objectFailure(
  value: unknown,
): { message: string; resetRequestId: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const message = payload.error;
  if (typeof message !== "string" || !message.trim()) return null;
  return {
    message,
    resetRequestId: payload.status === "refunded" ||
      (typeof payload.operation_id === "string" &&
        /refunded|start a new request/i.test(message)),
  };
}

/**
 * Read `publish-story`'s typed refusal out of a failed invoke, or null for
 * every other kind of failure.
 *
 * Reuses the same `error.context.json()` reach-through as `edgeFunctionFailure`
 * above - the Supabase JS SDK reports a non-2xx function response as an error
 * with no parsed body, and the body is the only place `error_code` and
 * `gating_reason` live.
 */
async function storyGatedPrivateReason(
  error: unknown,
): Promise<StoryPrivateReason | null> {
  const context = error && typeof error === "object"
    ? (error as { context?: { json?: () => Promise<unknown> } }).context
    : undefined;
  if (typeof context?.json !== "function") return null;
  try {
    const body = await context.json();
    if (!body || typeof body !== "object") return null;
    const payload = body as Record<string, unknown>;
    if (payload.error_code !== "story_gated_private") return null;
    // Matched explicitly rather than defaulted, now that there are three. The
    // old two-way ternary would have rendered "this names a real living
    // person" over a story that had simply not been checked - a claim about
    // the writer's idea that the server never made.
    if (payload.gating_reason === "private_individual") {
      return "private_individual";
    }
    if (payload.gating_reason === "classification_unavailable") {
      return "classification_unavailable";
    }
    return "living_public_figure";
  } catch {
    return null;
  }
}

/**
 * The last chapter an auto run has paid for, or undefined.
 *
 * Undefined and a number are different facts and the write-ahead branches on
 * which one it got: undefined is "this story never pre-bought anything" and
 * keeps it on the per-chapter path, while a number -- including the chapter
 * before the run began, meaning the balance bought nothing -- is a run and
 * bounds the chain exactly.
 */
function autoRunThroughChapter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function mapGeneratedStory(data: unknown, draft: CreateDraft): Story {
  if (!data || typeof data !== "object") {
    throw new Error("Story generation returned an invalid response");
  }
  const payload = data as Record<string, unknown>;
  const story = asRecord(payload.story);
  const chapter = asRecord(payload.chapter);
  const id = requiredString(story.id, "story id");
  const chapterId = requiredString(chapter.id, "chapter id");
  const content = requiredString(chapter.content, "chapter content");
  const serverPrimaryGenre = story.primary_genre;
  const serverGenres = Array.isArray(story.genre) ? story.genre : [];
  const genre = isGenre(serverPrimaryGenre)
    ? serverPrimaryGenre
    : isGenre(serverGenres[0])
    ? serverGenres[0]
    : draft.primaryGenre;
  const themes = Array.isArray(story.themes)
    ? story.themes.filter((value): value is string => typeof value === "string")
    : [];
  const storyMode = isStoryMode(story.story_mode)
    ? story.story_mode
    : draft.isSeries
    ? "series"
    : "standalone";

  return {
    id,
    title: requiredString(story.title, "story title"),
    authorId: requiredString(story.author_id, "story author"),
    genre,
    primaryGenre: genre,
    storyMode,
    plannedChapterCount: isPlannedChapterCount(story.planned_chapter_count)
      ? story.planned_chapter_count
      : draft.plannedChapterCount,
    // The row wins over the draft: the server clamps an unrecognised mode to
    // `interactive`, and a client that kept its own value would auto-continue
    // a story the database says is interactive.
    storyFlow: story.story_flow === "auto"
      ? "auto"
      : story.story_flow === "interactive"
      ? "interactive"
      : draft.storyFlow ?? "interactive",
    // Carried in the `done` payload rather than re-read off the row, because
    // the write-ahead starts the moment this lands: a client that had to fetch
    // the story first would either wait a round trip before chapter two or
    // decide it had no run and buy the chapter again.
    autoRunThroughChapter: autoRunThroughChapter(
      story.auto_run_through_chapter,
    ),
    chapterLength: isChapterLength(story.chapter_length)
      ? story.chapter_length
      : draft.chapterLength,
    beats: Array.isArray(story.beats)
      ? story.beats.filter((beat): beat is string => typeof beat === "string")
      : draft.beats,
    seriesState: parseSeriesState(story.series_state),
    audienceMode: story.audience_mode === "kids" ? "kids" : "adult",
    spiceLevel: story.spice_level === "steamy" ? "steamy" : "sweet",
    contentRating: typeof story.content_rating === "string"
      ? story.content_rating
      : undefined,
    synopsis: typeof story.topic === "string" && story.topic.trim()
      ? story.topic.trim()
      : content.replace(/\s+/g, " ").slice(0, 180),
    chapters: [{
      id: chapterId,
      storyId: id,
      title: typeof chapter.title === "string" && chapter.title.trim()
        ? chapter.title
        : "Chapter one",
      paragraphs: content.split(/\n\s*\n/).filter(Boolean),
      chapterNumber: typeof chapter.chapter_number === "number"
        ? chapter.chapter_number
        : 1,
      chapterRole: parseChapterRole(
        chapter.chapter_role,
        storyMode === "series" ? "series_opening" : "standalone",
      ),
      firstLine: stringOrUndefined(chapter.first_line),
      previouslySummary: stringOrUndefined(chapter.previously_summary),
      hookType: parseHookType(chapter.hook_type),
      hookText: stringOrUndefined(chapter.hook_text),
      isPublished: chapter.is_published === true,
      imageUrl: stringOrUndefined(chapter.image_url),
      audioUrl: typeof chapter.audio_url === "string"
        ? chapter.audio_url
        : undefined,
    }],
    likes: numberOrZero(story.like_count),
    bookmarks: numberOrZero(story.bookmark_count),
    views: numberOrZero(story.read_count),
    tags: themes.length ? themes : ["new", "draft"],
    publishedOffset: 0,
    isFeatured: story.is_curated === true,
    language: typeof story.language === "string"
      ? story.language
      : draft.language,
    // Chapter 1's art is the cover (§10.4) and it is generated on a background
    // task after this response is flushed, so what arrives here is almost
    // always `generating` with no URL behind it yet. Carrying it anyway is what
    // lets the studio show a progress line instead of guessing from a null URL,
    // which is the same value a cover that failed leaves behind.
    coverImageUrl: stringOrUndefined(story.cover_image_url),
    illustrateChapters: draft.illustrateChapters === true ? true : undefined,
    coverStatus: parseCoverStatus(story.cover_status),
    coverRegenCount: numberOrZero(story.cover_regen_count),
  };
}

const COVER_STATUSES: readonly CoverStatus[] = [
  "pending",
  "generating",
  "ready",
  "failed",
];

function parseCoverStatus(value: unknown): CoverStatus | undefined {
  return typeof value === "string" &&
      (COVER_STATUSES as readonly string[]).includes(value)
    ? value as CoverStatus
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Story generation returned an invalid response");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Story generation returned no ${field}`);
  }
  return value.trim();
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isGenre(value: unknown): value is Genre {
  return typeof value === "string" && GENRES.some((genre) => genre === value);
}

function isStoryMode(value: unknown): value is StoryMode {
  return value === "standalone" || value === "series";
}

/**
 * A stored plan is any whole number in `[1, 15]`, not one of the four the
 * picker offers.
 *
 * This used to test `value === 3 || value === 7 || value === 15`, which was
 * true while the picker was the only writer of the column. A reader extending
 * a finished story raises it one chapter at a time, so a 4-chapter story's row
 * would have failed this test, been dropped to `undefined`, and read back as a
 * story with no plan -- which `plannedChapterCountOf` then resolves to 3, and
 * the reader is told a story it has four chapters of is complete at three.
 *
 * The bound is the same one migration 00079 puts on the column.
 */
function isPlannedChapterCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= 1 && value <= MAX_PLANNED_CHAPTER_COUNT;
}

function isChapterLength(
  value: unknown,
): value is "short" | "standard" | "long" {
  return value === "short" || value === "standard" || value === "long";
}

function parseChapterRole(value: unknown, fallback: ChapterRole): ChapterRole {
  if (
    value === "standalone" ||
    value === "series_opening" ||
    value === "mid_series" ||
    value === "finale"
  ) {
    return value;
  }
  return fallback;
}

function parseHookType(value: unknown): HookType {
  if (
    value === "none" ||
    value === "revelation" ||
    value === "reversal" ||
    value === "decision" ||
    value === "arrival" ||
    value === "betrayal" ||
    value === "danger" ||
    value === "unanswered_question" ||
    value === "emotional_rupture"
  ) {
    return value;
  }
  return "none";
}

function parseSeriesState(value: unknown): SeriesState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const state = value as Record<string, unknown>;
  return {
    central_conflict: stringOrEmpty(state.central_conflict),
    protagonist_want: stringOrEmpty(state.protagonist_want),
    relationship_state: stringOrEmpty(state.relationship_state),
    open_hooks: stringList(state.open_hooks),
    resolved_hooks: stringList(state.resolved_hooks),
    promised_payoffs: stringList(state.promised_payoffs),
    world_facts: stringList(state.world_facts),
    character_changes: stringList(state.character_changes),
    next_chapter_pressure: stringOrEmpty(state.next_chapter_pressure),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
}

function filterLocalStories(query?: { q?: string; genre?: string }) {
  const normalized = query?.q?.trim().toLowerCase();
  return stories.filter((story) => {
    const matchesGenre = !query?.genre || story.genre === query.genre;
    const matchesQuery = !normalized ||
      story.title.toLowerCase().includes(normalized) ||
      story.synopsis.toLowerCase().includes(normalized) ||
      story.tags.some((tag) => tag.toLowerCase().includes(normalized));
    return matchesGenre && matchesQuery;
  });
}

function localGeneratedStory(draft: CreateDraft): Promise<Story> {
  const hero = draft.characters.find((character) => character.isHero) ??
    draft.characters[0];
  const heroName = hero?.name ?? "Mira";
  const title = generateMockTitle(draft.primaryGenre);
  const storyId = `generated-${Date.now()}`;

  // Simulate realistic generation time (3-6 seconds)
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        id: storyId,
        title,
        authorId: "me",
        genre: draft.primaryGenre,
        primaryGenre: draft.primaryGenre,
        storyMode: draft.isSeries ? "series" : "standalone",
        seriesState: draft.isSeries
          ? {
            central_conflict:
              "The first chapter opens a larger unresolved problem.",
            protagonist_want: `${heroName} wants to understand what changed.`,
            relationship_state: "Key relationships are still forming.",
            open_hooks: ["A new question remains unanswered."],
            resolved_hooks: [],
            promised_payoffs: [
              "The central mystery will be resolved by the finale.",
            ],
            world_facts: [`The story belongs to ${draft.primaryGenre}.`],
            character_changes: [`${heroName} has stepped into the conflict.`],
            next_chapter_pressure:
              "The next chapter should force a harder choice.",
          }
          : undefined,
        audienceMode: draft.audienceMode,
        spiceLevel: draft.spiceLevel,
        synopsis: `A fresh ${draft.primaryGenre} story shaped from your seed: ${
          draft.seed || "a quiet beginning"
        }.`,
        likes: 0,
        bookmarks: 0,
        views: 0,
        tags: ["new", draft.language.toLowerCase(), "draft"],
        publishedOffset: 0,
        isFeatured: false,
        language: draft.language,
        coverImage: "moonlit-train-platform.jpg",
        chapters: [
          {
            id: `chapter-${Date.now()}`,
            storyId,
            title: "Chapter one",
            chapterNumber: 1,
            chapterRole: draft.isSeries ? "series_opening" : "standalone",
            hookType: draft.isSeries ? "unanswered_question" : "none",
            hookText: draft.isSeries
              ? "A question hangs over what comes next."
              : undefined,
            isPublished: false,
            paragraphs: buildMockParagraphs(heroName, draft),
          },
        ],
      });
    }, 3500 + Math.random() * 2500);
  });
}

function buildMockParagraphs(heroName: string, draft: CreateDraft): string[] {
  // Genre-aware mock content that matches the 500-1500 word production spec.
  // Each paragraph is 60-120 words to produce ~700 words total.
  const g = draft.primaryGenre;
  const isKids = draft.audienceMode === "kids";

  const opening = g === "romance"
    ? `${heroName} had not planned on running into anyone at the flower market. It was supposed to be a quiet errand, a dozen white roses for the kitchen table, nothing more. But the vendor had already sold the last bunch to someone else, and that someone was standing right there, holding them like a question.`
    : g === "thriller"
    ? `The call came at 3:17 in the morning. ${heroName} let it ring three times before answering, a habit from the old days. The voice on the other end spoke in a measured tone, each word chosen like a tool from a drawer. There had been an incident. The kind that would not make the morning papers but would change the shape of things quietly, permanently.`
    : g === "mystery"
    ? `The letter arrived without a stamp or return address. ${heroName} found it wedged under the door of the shop, the envelope thick and cream-colored, the kind of stationery nobody used anymore. Inside was a single sheet with a hand-drawn map and seven words: "The last tenant left something for you."`
    : g === "horror"
    ? `${heroName} noticed the new sound on a Tuesday. A low hum, just below the range of comfortable hearing, like a refrigerator running in someone else's apartment. Except there was no apartment next door. The building ended at the wall behind the bed, and beyond that wall was only the hill and the old orchard nobody tended.`
    : g === "fantasy"
    ? `The map arrived folded inside a book ${heroName} had never ordered. The ink was a deep rust color, almost brown, and the parchment smelled like rain on warm stone. There were no labels, only lines that bent and curved through terrain that did not match any country. In the lower corner, someone had written a date. Tomorrow's date.`
    : g === "scifi"
    ? `${heroName} had been awake for eleven minutes when the station's gravity failed for the second time that week. Coffee lifted from the mug in a perfect sphere, wobbling in the blue light of the console. The readout blinked a message that should not have been possible: someone had opened the airlock on Deck Nine from the outside.`
    : `${heroName} stood at the edge of the familiar and looked out. The world beyond was not what anyone had described. It was quieter than expected, and stranger, and the light fell at an angle that made ordinary things look like they were keeping secrets. This was the moment before the story truly began.`;

  const rising = isKids
    ? `Something unexpected happened next. ${heroName} found a path where there should not have been one, narrow and winding, lined with stones that glowed faintly when stepped on. Each stone hummed a different note, and together they made a melody that felt like a greeting. At the end of the path stood a door, small enough that only someone brave and curious would think to open it.`
    : `What followed was not a single event but a series of small shifts, each one rearranging the landscape of what ${heroName} understood. A conversation overheard in passing. A door that had always been locked now standing open. A face in a photograph that should not have been familiar but was, deeply and disturbingly so. The seed of the story was already planted, and it was growing faster than anyone could have predicted.`;

  const middle =
    `${heroName} considered the options carefully. There were exactly two: move forward into the uncertainty, or step back and pretend none of it had happened. The second option was tempting. It was the safe choice, the one that came with clean hands and undisturbed sleep. But something had shifted inside, a gear catching, a door opening in the mind that could not be closed again. The first choice had already been made, somewhere deep, before the conscious mind caught up.`;

  const tension = isKids
    ? `The challenge was bigger than expected. ${heroName} had to solve three riddles before the sun moved behind the tallest tree. The first riddle was about water. The second was about friendship. The third was about something ${heroName} had almost forgotten, a promise made a long time ago on a rainy afternoon. Remembering it felt like finding a coin in an old coat pocket.`
    : `The tension arrived without announcement, the way real trouble always does. One moment the air was still, the next it was charged, every surface carrying a faint electric hum. ${heroName} could feel it in the space between breaths, in the way shadows moved half a second too late to match their sources. Something was coming to a head, and the only question was whether the resolution would break things or remake them.`;

  const climax =
    `And then the moment came. It was not dramatic in the way stories usually promise. There was no thunder, no sweeping revelation. Instead there was a small, clear truth, arriving like dawn, undeniable and unhurried. ${heroName} saw it for what it was. The fear did not vanish, but it stepped aside long enough for something else to take its place. A choice was made. It was the kind of choice that changes the shape of a life, not all at once, but one day at a time, in the quiet hours when nobody is watching.`;

  const resolution = isKids
    ? `When it was over, ${heroName} sat on the warm grass and looked up at a sky painted with colors that had no names. The adventure was not finished, not really. But this chapter of it was, and it ended with a feeling that was hard to put into words. Something like hope, something like courage, something like the first page of a story that was only just beginning.`
    : `Later, when the dust of the day had settled and the world had returned to something resembling normal, ${heroName} sat alone with the aftermath. It was not the ending anyone would have written in advance. It was messier than that, more honest, with loose threads that would take time to weave into anything resembling a pattern. But it was real. And for the first time in a long while, that was enough.`;

  return [opening, rising, middle, tension, climax, resolution];
}

/** Genre-aware mock titles for development. In production the LLM generates the title. */
const MOCK_TITLES: Partial<Record<Genre, string[]>> = {
  romance: [
    "The Vanilla Problem",
    "Letters Never Sent",
    "That Corner Table",
    "Almost Midnight",
  ],
  romantasy: [
    "The Sword Between Us",
    "Embers and Oaths",
    "A Crown of Thorns and Starlight",
  ],
  darkRomance: ["Debt of Roses", "The Collector's Terms", "No Safe Word"],
  fantasy: [
    "The Cartographer's Mistake",
    "Where Rivers Forget",
    "A Door Without a Room",
  ],
  scifi: ["The Eleven-Minute Gap", "Deck Nine", "Signal from Nowhere"],
  thriller: [
    "The Accountant's Daughter",
    "Three Rings",
    "No Forwarding Address",
  ],
  mystery: ["The Last Tenant", "Room 4B", "The Decimal Point"],
  horror: ["Tuesday's Hum", "The Other Orchard", "What the Mirror Kept"],
  contemporary: ["Seven Hours", "The Name in the Diary", "Small Mercies"],
  historical: ["The Silk Code", "A Clockmaker in Vienna", "The Late Letter"],
  adventure: ["The River That Isn't", "Below the Floor", "Compass South"],
  comedy: ["Worst Wizard, Best Job", "The Pageant Incident", "Neighborly"],
  poetry: [
    "The Last Payphone",
    "Weather Reports of Love",
    "What the Tide Pool Remembers",
  ],
  educational: ["What the Tide Pool Teaches", "The Apprentice's Typo", "One Afternoon Cloud"],
  fanfiction: ["The Bridge, Retold", "What the Finale Left Out", "The Best Part of the Week"],
  folktale: ["The Miller's Third Wish", "The Key Nobody Built", "The Crow's Third Winter"],
  sliceOfLife: ["The Corner Laundromat", "The Spice Rack", "The Shared Desk Lamp"],
};

function generateMockTitle(genre: Genre): string {
  const titles = MOCK_TITLES[genre] ?? MOCK_TITLES.fantasy!;
  return titles[Math.floor(Math.random() * titles.length)];
}

// ---------------------------------------------------------------------------
// Continue story (add next chapter)
// ---------------------------------------------------------------------------

/**
 * The three streamed calls differ only in their endpoint and their body.
 *
 * Auth, header assembly, event dispatch and the "closed without a terminal
 * event" check are identical, and a second copy of the last one in particular
 * is how a truncated response quietly becomes a success.
 */
async function runStreamedCall(input: {
  fn: string;
  body: unknown;
  onEvent: (event: string, payload: Record<string, unknown>) => void;
}): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new GenerationRequestError("Please sign in to continue.", false);
  }

  const outcome: {
    done: Record<string, unknown> | null;
    failure: { message: string; partial: boolean } | null;
  } = { done: null, failure: null };

  try {
    await postEventStream({
      url: `${SUPABASE_URL}/functions/v1/${input.fn}`,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      body: input.body,
      onEvent: ({ event, data }) => {
        const payload = (data ?? {}) as Record<string, unknown>;
        if (event === "done") outcome.done = payload;
        else if (event === "error") {
          outcome.failure = {
            message: typeof payload.error === "string"
              ? payload.error
              : "The request failed.",
            partial: payload.partial_prose_shown === true,
          };
        } else input.onEvent(event, payload);
      },
    });
  } catch (error) {
    if (error instanceof StreamTransportError) {
      // `resetRequestId` stays false: the call may already have reserved a
      // credit before the connection dropped, and reusing the same id is what
      // lets the replay path hand back the finished work instead of charging
      // twice.
      throw new GenerationRequestError(error.message, false);
    }
    throw error;
  }

  if (outcome.failure) {
    throw new GenerationRequestError(outcome.failure.message, false);
  }
  if (!outcome.done) {
    throw new GenerationRequestError(
      "The response stopped partway through. Please try again.",
      false,
    );
  }
  return outcome.done;
}

export interface StreamedChapterHandlers {
  onStage?: (stage: string) => void;
  /** The chapter's name, ahead of its prose. See `StreamedStoryHandlers.onTitle`. */
  onTitle?: (names: { title?: string; chapterTitle?: string }) => void;
  onDelta: (text: string) => void;
}

/**
 * Continue a story, rendering the next chapter as it is written.
 *
 * The same contract as `continueStory`, and the same server function behind it
 * - `continue-story` streams when the request asks it to. This is the bigger of
 * the two streaming wins in the reading loop: a reader deep in a series
 * triggers it repeatedly, and is less patient each time than they were on the
 * first chapter.
 */
export async function continueStoryStreaming(
  storyId: string,
  requestId: string,
  handlers: StreamedChapterHandlers,
  isFinale?: boolean,
  expectedChapterNum?: number,
  nextInstruction?: string,
  /**
   * The direction chips that were on screen, in the order they were ranked.
   *
   * Sent in BOTH modes and recorded either way. Interactive: the reader picked
   * one and it also arrives as `next_instruction`. Auto: nobody was asked, and
   * the server's direction model chooses among these rather than the client
   * taking its own top-ranked one -- a client sort is not a choice, and the
   * plan beat outranks an open hook regardless of what the last chapter did.
   *
   * Recording the offer is what makes a future "here is the path your story
   * took" surface possible: the options were derived from a story state that
   * has moved on by the time anyone could ask for them again.
   */
  directionsOffered?: readonly { id: string; prompt: string }[],
  /**
   * Grow the story one chapter past its planned ending.
   *
   * An explicit opt-in, sent by exactly one surface: a direction chip tapped
   * at the end of a finished series by its own author. The server refuses a
   * chapter past the plan without it, and that refusal is the point -- an
   * extension spends a credit on a story the writer said was finished, so it
   * takes a deliberate tap every time. Auto-continue never sends it.
   */
  extend?: boolean,
): Promise<{ chapter: Chapter; model: string }> {
  if (!isSupabaseConfigured) {
    return await localContinueStory(storyId, isFinale, expectedChapterNum ?? 2);
  }

  // Both of these used to be awaited one after the other, in front of a reader
  // who has already tapped for the next chapter: a round trip to
  // `bootstrap-user`, and then an OS permission read that needs none of its
  // answer. Overlapped, the request leaves as soon as the slower one is done.
  // `bootstrapUser` still decides whether the call happens at all, so its
  // failure is still the account error and never a push error.
  const notifyPromise = pushPermissionGranted();
  try {
    await bootstrapUser();
  } catch {
    // Not left dangling: an unhandled rejection would surface as a crash long
    // after the account error the reader actually sees.
    void notifyPromise.catch(() => false);
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }
  const notifyOnReady = await notifyPromise;

  const done = await runStreamedCall({
    fn: "continue-story",
    body: {
      story_id: storyId,
      request_id: requestId,
      is_finale: isFinale ?? false,
      next_instruction: nextInstruction,
      directions_offered: directionsOffered ?? [],
      extend: extend === true,
      notify_on_ready: notifyOnReady,
      stream: true,
    },
    onEvent: (event, payload) => {
      if (event === "delta") {
        const text = payload.text;
        if (typeof text === "string") handlers.onDelta(text);
      } else if (event === "stage") {
        handlers.onStage?.(String(payload.stage ?? ""));
      } else if (event === "title") {
        const names = titleEventNames(payload);
        if (names.title || names.chapterTitle) handlers.onTitle?.(names);
      }
    },
  });

  if (!done.chapter) throw new Error("Continuation returned no chapter");
  return mapContinuedChapter(done, storyId, expectedChapterNum, isFinale);
}

/**
 * Rewrite one chapter, showing the new prose as it is written.
 *
 * The reader's "Reimagine" sheet. It re-prompts a single chapter with an
 * instruction and, optionally, a set of character replacements; it costs the
 * same one credit a continuation costs, and it streams for the same reason a
 * continuation does - the reader is watching the chapter they already know
 * being rewritten, which is the least patient moment in the product.
 *
 * **A reader who is not the author gets a private copy.** The server forks the
 * story (`fork_story`, migration 00057) and rewrites the chapter in the copy,
 * so the original is untouched. That is why this resolves with a `storyId`
 * that may not be the one that was passed in, and why the caller must switch
 * the reader over to it rather than assuming it is still on the same story.
 * `forkedFromStoryId` is non-null exactly when that happened.
 */
export interface ReimagineReplacement {
  /** The name as it appears in the chapter today. */
  fromName: string;
  /** A character from the writer's saved library, or one typed in the sheet. */
  to:
    | { savedCharacterId: string }
    | {
      name: string;
      appearance?: string;
      background?: string;
    };
  /**
   * Rename this character in every OTHER chapter too, and in the roster and
   * continuity state that later chapters are written from.
   *
   * The other chapters are NOT regenerated - that would cost a credit each and
   * rewrite prose the reader chose to keep. They are renamed: whole words,
   * case preserved, possessives included, pronouns never touched.
   */
  applyToAllChapters?: boolean;
}

export interface ReimaginedChapter {
  chapter: Chapter;
  /** The story that was actually written to: the fork, when one was made. */
  storyId: string;
  /** Non-null when a private copy was made because the caller is not the author. */
  forkedFromStoryId: string | null;
  model: string;
  /** What `applyToAllChapters` touched, for the "renamed everywhere" notice. */
  renamed: { chapters: number; roster: number };
}

export async function reimagineChapterStreaming(
  storyId: string,
  chapterNumber: number,
  requestId: string,
  input: { prompt?: string; replacements?: ReimagineReplacement[] },
  handlers: StreamedChapterHandlers,
): Promise<ReimaginedChapter> {
  if (!isSupabaseConfigured) {
    throw new GenerationRequestError(
      "Reimagining a chapter needs a connection.",
      false,
    );
  }

  try {
    await bootstrapUser();
  } catch {
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }

  // The server's own story id arrives on the `meta` event, before any prose,
  // precisely so a reader whose story was forked knows which story they are
  // reading while it is still being written.
  let resolvedStoryId = storyId;
  let forkedFrom: string | null = null;

  const done = await runStreamedCall({
    fn: "reimagine-chapter",
    body: {
      story_id: storyId,
      chapter_number: chapterNumber,
      request_id: requestId,
      prompt: input.prompt,
      character_replacements: (input.replacements ?? []).map((replacement) => ({
        from_name: replacement.fromName,
        to: "savedCharacterId" in replacement.to
          ? { saved_character_id: replacement.to.savedCharacterId }
          : {
            name: replacement.to.name,
            appearance: replacement.to.appearance,
            background: replacement.to.background,
          },
        apply_to_all_chapters: replacement.applyToAllChapters === true,
      })),
      stream: true,
    },
    onEvent: (event, payload) => {
      if (event === "delta") {
        const text = payload.text;
        if (typeof text === "string") handlers.onDelta(text);
      } else if (event === "stage") {
        handlers.onStage?.(String(payload.stage ?? ""));
      } else if (event === "meta") {
        if (typeof payload.story_id === "string") {
          resolvedStoryId = payload.story_id;
        }
        forkedFrom = typeof payload.forked_from_story_id === "string"
          ? payload.forked_from_story_id
          : null;
      }
    },
  });

  if (!done.chapter) {
    throw new GenerationRequestError(
      "The rewrite stopped partway through. Please try again.",
      false,
    );
  }
  if (typeof done.story_id === "string") resolvedStoryId = done.story_id;
  if (typeof done.forked_from_story_id === "string") {
    forkedFrom = done.forked_from_story_id;
  }

  const { chapter, model } = mapContinuedChapter(
    done,
    resolvedStoryId,
    chapterNumber,
  );
  const renamed = asRecord(done.renamed);
  return {
    chapter: { ...chapter, chapterNumber },
    storyId: resolvedStoryId,
    forkedFromStoryId: forkedFrom,
    model,
    renamed: {
      chapters: numberOrZero(renamed.chapters),
      roster: numberOrZero(renamed.roster),
    },
  };
}

/**
 * A character the writer has saved, reusable across stories.
 *
 * Read straight from `user_characters` (migration 00057) rather than through an
 * edge function: RLS already scopes the table to its owner, so a function in
 * front of it would be a second, weaker copy of a rule Postgres enforces -- and
 * it would make the picker wait on a deploy to work at all. The same reasoning
 * as `fetchMyStories`.
 */
export interface SavedCharacter {
  id: string;
  name: string;
  background?: string;
  appearance?: string;
  portraitUrl?: string;
  createdAt?: string;
}

export async function listSavedCharacters(): Promise<SavedCharacter[]> {
  if (!isSupabaseConfigured) return [];

  let userId: string | undefined;
  try {
    userId = (await bootstrapUser())?.userId;
  } catch {
    return [];
  }
  if (!userId) return [];

  const { data, error } = await supabase
    .from("user_characters")
    .select("id, name, description, background, appearance, portrait_url, created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  // The picker opens over a create flow that is otherwise working. An empty
  // list is a recoverable disappointment; an exception is not.
  if (error || !Array.isArray(data)) return [];

  return data
    .map((row): SavedCharacter | null => {
      const record = row as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : null;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!id || !name) return null;
      return {
        id,
        name,
        background: stringOrUndefined(record.background),
        // The retired `description` column is the fallback, never a second
        // field: a character saved before Craft merged the two has its text
        // only there.
        appearance: stringOrUndefined(record.appearance) ??
          stringOrUndefined(record.description),
        portraitUrl: stringOrUndefined(record.portrait_url),
        createdAt: stringOrUndefined(record.created_at),
      };
    })
    .filter((character): character is SavedCharacter => character !== null);
}

/**
 * Remove a saved character.
 *
 * This deletes the library entry only. Stories the character already appears in
 * keep their own `characters` rows and are not touched: deleting someone from
 * the list of people you can reuse must never edit the stories you already
 * wrote them into.
 */
export async function deleteSavedCharacter(id: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    await bootstrapUser();
  } catch {
    return false;
  }
  // Ownership is enforced by RLS, not by this call.
  const { error } = await supabase.from("user_characters").delete().eq("id", id);
  return !error;
}

/**
 * Save a chapter the writer edited by hand.
 *
 * The notepad hands back the whole chapter, and the whole chapter is what is
 * stored - no paragraph indices, no model, no merge. `edit-story` recognises a
 * `chapter_body` and takes that path before any of its paragraph-edit
 * validation, so this shares the ownership check, the chapter lookup and the
 * story word-count recompute with the AI editing path rather than restating
 * them.
 *
 * Narration for the chapter is dropped server-side: the audio read the old
 * prose, and playing it over new text is worse than regenerating it.
 */
export async function saveChapterText(
  storyId: string,
  chapterId: string,
  text: string,
  chapterTitle?: string,
): Promise<Chapter> {
  if (!isSupabaseConfigured) {
    throw new Error("Saving a chapter needs a connection.");
  }

  const { data, error } = await supabase.functions.invoke("edit-story", {
    body: {
      story_id: storyId,
      chapter_id: chapterId,
      chapter_body: text,
      chapter_title: chapterTitle,
    },
  });

  if (error) {
    const failure = await edgeFunctionFailure(error, data);
    throw new Error(failure.message);
  }

  const payload = asRecord(data);
  const chapter = asRecord(payload.chapter);
  const content = requiredString(chapter.content, "chapter content");
  return {
    id: requiredString(chapter.id, "chapter id"),
    storyId,
    title: typeof chapter.title === "string" ? chapter.title : "Chapter",
    paragraphs: content.split(/\n\s*\n/).filter(Boolean),
    chapterNumber: typeof chapter.chapter_number === "number"
      ? chapter.chapter_number
      : 1,
    chapterRole: parseChapterRole(chapter.chapter_role, "standalone"),
    firstLine: stringOrUndefined(chapter.first_line),
    previouslySummary: stringOrUndefined(chapter.previously_summary),
    hookType: parseHookType(chapter.hook_type),
    hookText: stringOrUndefined(chapter.hook_text),
    isPublished: chapter.is_published === true,
    imageUrl: stringOrUndefined(chapter.image_url),
  };
}

/**
 * Rewrite a paragraph, showing the new text as it is written.
 *
 * Editing is free, so a failure part-way through costs the writer nothing but
 * the retry. It is also the place where waiting is most visible, because the
 * writer is looking directly at the paragraph being changed.
 */
export async function editParagraphStreaming(
  storyId: string,
  chapterId: string,
  paragraphIndex: number,
  instruction: EditInstruction,
  handlers: StreamedChapterHandlers,
  options?: { tone?: string; customNote?: string },
): Promise<string> {
  if (!isSupabaseConfigured) {
    return await localEditParagraph(instruction);
  }

  const done = await runStreamedCall({
    fn: "edit-story",
    body: {
      story_id: storyId,
      chapter_id: chapterId,
      paragraph_index: paragraphIndex,
      instruction,
      tone: options?.tone,
      custom_note: options?.customNote,
      stream: true,
    },
    onEvent: (event, payload) => {
      if (event === "delta") {
        const text = payload.text;
        if (typeof text === "string") handlers.onDelta(text);
      } else if (event === "stage") {
        handlers.onStage?.(String(payload.stage ?? ""));
      }
    },
  });

  const updated = done.updated_paragraph;
  if (typeof updated !== "string") {
    throw new Error("Could not apply the edit. Please try again.");
  }
  return updated;
}

export async function continueStory(
  storyId: string,
  requestId: string,
  isFinale?: boolean,
  expectedChapterNum?: number,
  nextInstruction?: string,
  /**
   * The direction chips that were on screen, in the order they were ranked.
   *
   * Sent in BOTH modes and recorded either way. Interactive: the reader picked
   * one and it also arrives as `next_instruction`. Auto: nobody was asked, and
   * the server's direction model chooses among these rather than the client
   * taking its own top-ranked one -- a client sort is not a choice, and the
   * plan beat outranks an open hook regardless of what the last chapter did.
   *
   * Recording the offer is what makes a future "here is the path your story
   * took" surface possible: the options were derived from a story state that
   * has moved on by the time anyone could ask for them again.
   */
  directionsOffered?: readonly { id: string; prompt: string }[],
  /**
   * Grow the story one chapter past its planned ending.
   *
   * An explicit opt-in, sent by exactly one surface: a direction chip tapped
   * at the end of a finished series by its own author. The server refuses a
   * chapter past the plan without it, and that refusal is the point -- an
   * extension spends a credit on a story the writer said was finished, so it
   * takes a deliberate tap every time. Auto-continue never sends it.
   */
  extend?: boolean,
): Promise<{ chapter: Chapter; model: string }> {
  if (!isSupabaseConfigured) {
    return await localContinueStory(storyId, isFinale, expectedChapterNum ?? 2);
  }

  try {
    await bootstrapUser();
  } catch {
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }

  const { data, error } = await supabase.functions.invoke("continue-story", {
    body: {
      story_id: storyId,
      request_id: requestId,
      is_finale: isFinale ?? false,
      next_instruction: nextInstruction,
      directions_offered: directionsOffered ?? [],
      extend: extend === true,
      notify_on_ready: await pushPermissionGranted(),
    },
  });

  if (error) {
    const failure = await edgeFunctionFailure(error, data);
    throw new GenerationRequestError(failure.message, failure.resetRequestId);
  }
  if (!data?.chapter) throw new Error("Continuation returned no chapter");

  return mapContinuedChapter(data, storyId, expectedChapterNum, isFinale);
}

/**
 * Map a continuation response onto a `Chapter`.
 *
 * Shared by the buffered and streamed callers, which return the same payload.
 * Two copies would let the two transports disagree about what a chapter is.
 */
function mapContinuedChapter(
  data: Record<string, unknown>,
  storyId: string,
  expectedChapterNum?: number,
  isFinale?: boolean,
): { chapter: Chapter; model: string } {
  const chapter = asRecord(data.chapter);
  const content = requiredString(chapter.content, "chapter content");
  return {
    chapter: {
      id: requiredString(chapter.id, "chapter id"),
      storyId,
      title: typeof chapter.title === "string"
        ? chapter.title
        : `Chapter ${chapter.chapter_number ?? expectedChapterNum ?? 2}`,
      paragraphs: content.split(/\n\s*\n/).filter(Boolean),
      chapterNumber: typeof chapter.chapter_number === "number"
        ? chapter.chapter_number
        : (expectedChapterNum ?? 2),
      chapterRole: parseChapterRole(
        chapter.chapter_role,
        isFinale ? "finale" : "mid_series",
      ),
      firstLine: stringOrUndefined(chapter.first_line),
      previouslySummary: stringOrUndefined(chapter.previously_summary),
      hookType: parseHookType(chapter.hook_type),
      hookText: stringOrUndefined(chapter.hook_text),
      isPublished: false,
      // Always absent on a fresh continuation: an illustrated chapter's art is
      // drawn on a background task after this response is flushed, so it
      // arrives with the next read of the story, not with the chapter.
      imageUrl: stringOrUndefined(chapter.image_url),
    },
    model: typeof data.model === "string" ? data.model : "unknown",
  };
}

/**
 * The offline walkthrough's continuation, and it is canned prose.
 *
 * This exists so the app can be walked with no backend configured. It cannot
 * honour a direction the reader typed or chose, because there is no model in
 * this path to honour it with -- so a suggested or written next step is
 * accepted by the UI and does not shape the text.
 *
 * That gap is REPORTED rather than hidden. The returned chapter is marked, and
 * `isLocalStubChapter` lets a caller say so, because silently returning prose
 * that ignores the reader's choice teaches them the feature does not work. The
 * alternative of faking direction-sensitive text would be a worse lie.
 *
 * Against a configured backend none of this runs: the instruction reaches
 * `continue-story` and does shape the chapter.
 */
async function localContinueStory(
  _storyId: string,
  isFinale?: boolean,
  chapterNum = 2,
): Promise<{ chapter: Chapter; model: string }> {
  await new Promise((resolve) =>
    setTimeout(resolve, 3000 + Math.random() * 2000)
  );
  return {
    chapter: {
      id: `chapter-${Date.now()}`,
      storyId: _storyId,
      title: isFinale ? "The final chapter" : `Chapter ${chapterNum}`,
      chapterRole: isFinale ? "finale" : "mid_series",
      hookType: isFinale ? "none" : "unanswered_question",
      hookText: isFinale
        ? undefined
        : "The next consequence has not arrived yet.",
      paragraphs: [
        "The story continued where it left off. The characters moved forward, carrying the weight of earlier decisions into new territory. Nothing felt settled yet, but the shape of things was beginning to emerge.",
        "New complications arrived without warning. A piece of information surfaced that changed the meaning of everything that came before. What had seemed like coincidence now looked deliberate, and the stakes shifted accordingly.",
        "The tension between what the characters wanted and what they feared pulled the narrative taut. Conversations became loaded, silences became heavy, and every choice carried the echo of consequences not yet realized.",
        isFinale
          ? "And then it ended, not with a bang but with the quiet satisfaction of a promise kept. Every thread found its place. The final image lingered, not because it was dramatic, but because it felt earned."
          : "The chapter ended on an unresolved note, a door half open, a question hanging in the air. The story was not finished. There was more to tell, and the next chapter would demand even more from everyone involved.",
      ],
      chapterNumber: chapterNum,
      isPublished: false,
    },
    model: LOCAL_STUB_MODEL,
  };
}

/**
 * The `model` value the offline continuation returns.
 *
 * Named rather than a bare string so a caller can recognise a stub chapter
 * instead of pattern-matching prose, and so the two places that care cannot
 * drift apart.
 */
export const LOCAL_STUB_MODEL = "mock";

/**
 * Did this chapter come from the offline stub rather than a model?
 *
 * Callers use it to tell the reader that a direction they chose was not applied,
 * which is the honest thing to say when there was no model to apply it.
 */
export function isLocalStubChapter(result: { model: string }): boolean {
  return result.model === LOCAL_STUB_MODEL;
}

// ---------------------------------------------------------------------------
// Edit paragraph (AI-powered paragraph editing)
// ---------------------------------------------------------------------------

export type EditInstruction =
  | "rewrite"
  | "expand"
  | "shorten"
  | "change_tone"
  | "custom";

export async function editParagraph(
  storyId: string,
  chapterId: string,
  paragraphIndex: number,
  instruction: EditInstruction,
  options?: { tone?: string; customNote?: string },
): Promise<string> {
  if (!isSupabaseConfigured) {
    return await localEditParagraph(instruction);
  }

  const { data, error } = await supabase.functions.invoke("edit-story", {
    body: {
      story_id: storyId,
      chapter_id: chapterId,
      paragraph_index: paragraphIndex,
      instruction,
      tone: options?.tone,
      // `custom_note`, singular. The client sent `custom_notes` and the Edge
      // Function has always read `custom_note`, so every custom paragraph edit
      // returned 400 with the note the user had just typed sitting in the
      // request body, unread.
      custom_note: options?.customNote,
    },
  });

  if (error || !data?.updated_paragraph) {
    throw new Error("Could not apply the edit. Please try again.");
  }
  return data.updated_paragraph;
}

async function localEditParagraph(
  instruction: EditInstruction,
): Promise<string> {
  // This is only used when Supabase is not configured. The mock in
  // CreateStudioScreen was the original; this centralizes it.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  // Return empty string — the caller will apply instruction-specific logic
  // (the CreateStudioScreen mock still handles the text transformation).
  return "";
}

// ---------------------------------------------------------------------------
// Publish story
// ---------------------------------------------------------------------------

/**
 * Publish a story, saving any hand edits in the same call.
 *
 * `edits` is what stops the editor being a lie. Create Studio's editor is
 * local — typing, restructuring and retitling live in React state — and this
 * function used to send nothing but a story id, so the server published the
 * text the model originally produced and every manual edit was discarded at
 * the moment the user committed to the story.
 *
 * Omitting `edits` saves exactly what is on the server, which is the right
 * thing for a story the user never opened the editor on.
 *
 * Omitting `visibility` saves the story privately. Going public is a decision
 * a caller has to make out loud; see `STORY_GENERATION_FLOW.md` §10.5.
 */
export async function publishStory(
  storyId: string,
  edits?: {
    title?: string;
    chapters?: { id: string; content: string }[];
    visibility?: "private" | "public";
  },
): Promise<void> {
  if (!isSupabaseConfigured) {
    // Simulate publish delay (cover image generation takes time)
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return;
  }

  // Always stated, never inferred.
  //
  // This used to send the field only for a guest and leave a signed-in user's
  // publish to the server's default, which was `public`. The default is now
  // `private` on both sides, but a client that says nothing is still at the
  // mercy of whichever build of the function happens to be deployed — and an
  // older one still reads silence as "publish to the world". Visibility is the
  // one field where being explicit costs nothing and guessing is unrecoverable.
  await bootstrapUser();
  const visibility = edits?.visibility ?? "private";

  const { error } = await supabase.functions.invoke("publish-story", {
    body: {
      story_id: storyId,
      ...(edits?.title ? { title: edits.title } : {}),
      ...(edits?.chapters?.length ? { chapters: edits.chapters } : {}),
      visibility,
    },
  });

  if (error) {
    const gatingReason = await storyGatedPrivateReason(error);
    if (gatingReason) throw new StoryGatedPrivateError(gatingReason);
    throw new Error("Publishing failed. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

/** What the server knows about a story's cover right now. */
export type CoverState = {
  coverImageUrl?: string;
  coverStatus: CoverStatus;
  /** 0 means the next regeneration is the free retry; above 0 it costs 1. */
  coverRegenCount: number;
};

/**
 * Read a story's cover state.
 *
 * This exists because chapter 1's art is produced on a background task *after*
 * the generation response is flushed (`media.ts`), so the studio is handed
 * `cover_status: "generating"` and then has no second moment at which it could
 * ever learn the cover arrived. `regenerate-cover` answers a GET for exactly
 * this, in the shape `audio-status` already uses for the other background media
 * job.
 *
 * Returns null rather than throwing on every failure, offline included. A cover
 * the reader cannot see yet is a missing picture, never an error dialogue in
 * front of a story that is otherwise finished.
 */
export async function fetchCoverState(
  storyId: string,
): Promise<CoverState | null> {
  if (!isSupabaseConfigured) return null;

  try {
    await bootstrapUser();
  } catch {
    return null;
  }

  const { data, error } = await supabase.functions.invoke(
    `regenerate-cover?story_id=${encodeURIComponent(storyId)}`,
    { method: "GET" },
  );
  if (error || !data || typeof data !== "object") return null;

  const payload = data as Record<string, unknown>;
  const status = parseCoverStatus(payload.cover_status);
  if (!status) return null;
  return {
    coverImageUrl: stringOrUndefined(payload.cover_image_url),
    coverStatus: status,
    coverRegenCount: numberOrZero(payload.cover_regen_count),
  };
}

/**
 * Re-roll a story's cover.
 *
 * The price is the server's to state, not this function's: the first
 * regeneration is free and every one after it is 1 credit
 * (`CREDITS_AND_PRICING.md`), and the count that decides it is read under the
 * same lock that claims the row. `charged` comes back so the caller can adjust
 * the balance it is displaying without re-deriving the rule.
 *
 * Unlike `fetchCoverState` this throws, because it is a paid action the writer
 * asked for by name and a silent no-op would look like a cover that simply
 * refused to change.
 */
export async function regenerateCover(
  storyId: string,
  requestId: string,
  promptNote?: string,
): Promise<CoverState & { charged: boolean }> {
  if (!isSupabaseConfigured) {
    // The offline shape the other generation calls use: a plausible delay and a
    // scheme-tagged URL nothing will try to fetch.
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      coverImageUrl: `cover://${storyId}/${requestId}`,
      coverStatus: "ready",
      coverRegenCount: 1,
      charged: false,
    };
  }

  try {
    await bootstrapUser();
  } catch {
    throw new GenerationRequestError(
      "Unable to set up your story account. Please try again.",
      false,
    );
  }

  const { data, error } = await supabase.functions.invoke("regenerate-cover", {
    body: {
      story_id: storyId,
      request_id: requestId,
      ...(promptNote ? { prompt_note: promptNote } : {}),
    },
  });

  if (error) {
    const failure = await edgeFunctionFailure(error, data);
    throw new GenerationRequestError(failure.message, true);
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const url = stringOrUndefined(payload.cover_image_url);
  if (!url) {
    throw new GenerationRequestError(
      "The cover could not be regenerated. Please try again.",
      true,
    );
  }
  return {
    coverImageUrl: url,
    coverStatus: parseCoverStatus(payload.cover_status) ?? "ready",
    coverRegenCount: numberOrZero(payload.cover_regen_count),
    charged: payload.charged === true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createGenerationRequestId() {
  return `generation-${Date.now().toString(36)}-${
    Math.random().toString(36).slice(2)
  }`;
}

/**
 * Hand this device's Expo push token to the server.
 *
 * Fails loudly to its caller and silently to the user: `syncPushToken` decides
 * that this is never worth an error message, and it is the only caller.
 */
export async function registerPushToken(
  expoToken: string,
  platform: "ios" | "android",
  deviceId?: string,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  await bootstrapUser();
  const { error } = await supabase.functions.invoke("register-push-token", {
    body: { expo_token: expoToken, platform, device_id: deviceId },
  });
  if (error) throw error;
}

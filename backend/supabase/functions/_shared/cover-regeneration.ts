/**
 * Re-rolling a story's cover, and charging for it correctly.
 *
 * ## Why this is a module rather than the body of `regenerate-cover/index.ts`
 *
 * The interesting part of this endpoint is not its HTTP shape, it is a
 * four-step transaction over money: claim the row, decide whether this
 * regeneration is the free retry or a paid one, spend up to two minutes inside
 * an image provider, and then either record a delivery or put everything back.
 * Every one of those steps has a failure that costs a user a credit for nothing
 * if it is written wrong, and none of them can be exercised from inside a
 * `serve()` handler holding a live Supabase client.
 *
 * So the handler is a thin translation of a request into arguments, and this is
 * the part with tests. The client is a structural interface for the same reason
 * `chapters.ts` uses one: it can be stubbed.
 *
 * ## The price, and where it is decided
 *
 * `CREDITS_AND_PRICING.md`: *Regenerate a cover you paid for — 0, 1 free retry*,
 * then 1 credit. `STORY_GENERATION_FLOW.md` §10.4 says the same thing.
 *
 * The decision is **not** made here. `claim_cover_regeneration` reads
 * `stories.cover_regen_count` and returns `requires_credit` under the same
 * advisory lock and the same `for update` that claims the row. Making it here
 * would mean reading the count in one round trip and acting on it in the next,
 * and two taps of Regenerate a few milliseconds apart would both read 0 and
 * both be free. See migration 00044.
 *
 * ## What a failure must not do
 *
 * A regeneration is a replacement, so the story usually already has a cover the
 * reader can see. If the new one misses, the old one has to still be there and
 * the row has to still say so - which is why the claim returns
 * `previous_cover_status` and why the failure path restores it rather than
 * writing 'failed'. Writing 'failed' is right for a *first* cover, where the
 * concept card is the honest fallback (`media.ts`); it is wrong here, where it
 * would report a cover that exists as missing.
 */

import { generateCoverImage, ImageResult } from "./image.ts";
import {
  MAX_COVER_STEER_NOTE_LENGTH,
  MAX_COVER_STEER_VARIATION_LENGTH,
  sanitizeExclusion,
} from "./cover-prompts.ts";
import { CoverStatusClient, setCoverStatus } from "./media.ts";
import { MAX_BRIEF_FIELD_LENGTH } from "./types.ts";

/** The user's optional note is a brief field and gets the brief field's cap. */
export const MAX_COVER_NOTE_LENGTH = MAX_BRIEF_FIELD_LENGTH;

/** Chapter 1's art is the cover, so its reservation is chapter 1's. */
const COVER_CHAPTER_NUMBER = 1;

export interface CoverRegenerationClient extends CoverStatusClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Injected so tests never reach a provider, and never need a credential. */
export type CoverImageGenerator = typeof generateCoverImage;

export interface RegenerateCoverInput {
  client: CoverRegenerationClient;
  storyId: string;
  userId: string;
  /** Idempotency key for the paid path, exactly as the other paid endpoints. */
  requestId: string;
  /** The writer's free text. Already trimmed and length-checked by the caller. */
  promptNote?: string;
  generate?: CoverImageGenerator;
}

export type RegenerateCoverResult =
  | {
    ok: true;
    coverImageUrl: string;
    coverRegenCount: number;
    /** True when this regeneration cost a credit. False for the free retry. */
    charged: boolean;
    /**
     * True when this request id had already bought this cover and the stored
     * one was handed back. Nothing was generated and nothing was charged.
     */
    replayed: boolean;
    provider?: string;
    model?: string;
  }
  | {
    ok: false;
    status: number;
    error: string;
    /** For the caller's telemetry. An enum, never prose. */
    code: RegenerateCoverFailure;
    /** Present when a reservation was made and settled one way or the other. */
    operationId?: string;
  };

export type RegenerateCoverFailure =
  | "not_found"
  | "not_owner"
  | "in_flight"
  | "attempt_limit"
  | "insufficient_credits"
  | "already_reserved"
  | "request_id_spent"
  | "generation_failed"
  | "refund_pending";

export async function regenerateCover(
  input: RegenerateCoverInput,
): Promise<RegenerateCoverResult> {
  const { client, storyId, userId, requestId } = input;
  const generate = input.generate ?? generateCoverImage;

  const { data: claimData, error: claimError } = await client.rpc(
    "claim_cover_regeneration",
    {
      p_story_id: storyId,
      p_user_id: userId,
      // The idempotency key reaches the claim, not just the reservation. The
      // free retry never touches `reserve_generation_operation`, so before this
      // a replayed free request re-ran the whole provider chain.
      p_request_id: requestId,
    },
  );
  if (claimError) throw claimError;

  const claim = asRecord(claimData);
  if (claim.claimed !== true) {
    const reason = typeof claim.reason === "string"
      ? claim.reason
      : "not_found";
    const replayedUrl = optionalString(claim.cover_image_url);
    if (reason === "replayed" && replayedUrl) {
      // This request id already bought this cover. Nothing generated, nothing
      // charged, and the row is untouched - the claim did not take it.
      return {
        ok: true,
        coverImageUrl: replayedUrl,
        coverRegenCount: numberOr(claim.cover_regen_count, 0),
        charged: false,
        replayed: true,
      };
    }
    return claimRefusal(reason);
  }

  const previousStatus = coverStatusOf(claim.previous_cover_status);
  const requiresCredit = claim.requires_credit === true;

  // Everything past this line owns the row, so every exit has to put it back.
  //
  // `restore` is the single place that happens, and the try/catch below is what
  // makes "every exit" true. It used to wrap only the provider call, so a
  // reservation RPC that threw - or a reservation that came back without an
  // operation id - escaped past the restore with the row still claimed. The
  // reader then watched a spinner over a cover that already existed and every
  // further attempt was refused as in-flight until the ten-minute staleness
  // window expired. That is the exact failure this module's header says it
  // exists to prevent, reintroduced two functions below the sentence.
  //
  // Releasing also decides whether the attempt this claim counted is given
  // back. The claim increments `cover_attempt_count` before anything else, on
  // purpose: an evicted isolate must stay counted. But four paths reach the
  // claim and then stop without calling a provider - no credits, a reservation
  // already held, a spent request id, a reservation RPC that throws - and none
  // of them costs anything to refuse. Charging them against a ceiling that
  // never resets meant a writer with an empty balance could tap Regenerate
  // twelve times, reach no provider at all, and then be permanently refused on
  // that story even after buying credits. `reachedProvider` is the fact that
  // decides it, and it is set at the single line that calls out.
  const attempt = { reachedProvider: false };
  let released = false;
  const restore = async () => {
    if (released) return;
    released = true;
    await releaseCoverClaim(client, {
      storyId,
      userId,
      previousStatus,
      refundAttempt: !attempt.reachedProvider,
    });
  };

  try {
    return await runClaimedRegeneration({
      client,
      storyId,
      userId,
      requestId,
      promptNote: input.promptNote,
      generate,
      claim,
      requiresCredit,
      restore,
      attempt,
    });
  } catch (error) {
    await restore();
    throw error;
  }
}

/**
 * Put a claimed row back, and give the attempt back when nothing was spent.
 *
 * One RPC rather than a status write here and a counter write beside it: the
 * two facts have to move together or a crash between them leaves the ceiling
 * and the status disagreeing. See `release_cover_claim` in migration 00044.
 *
 * A release that fails falls back to the plain status write. The status is the
 * part a reader can see - a story stuck on 'generating' shows a spinner over a
 * cover that already exists and refuses every retry as in-flight - and an
 * attempt that stays counted is a smaller wrong than that.
 */
async function releaseCoverClaim(
  client: CoverRegenerationClient,
  args: {
    storyId: string;
    userId: string;
    previousStatus: "generating" | "ready" | "failed";
    refundAttempt: boolean;
  },
): Promise<void> {
  try {
    const { error } = await client.rpc("release_cover_claim", {
      p_story_id: args.storyId,
      p_user_id: args.userId,
      p_previous_status: args.previousStatus,
      p_refund_attempt: args.refundAttempt,
    });
    if (!error) return;
  } catch {
    // Fall through to the status-only path below.
  }
  await setCoverStatus(client, args.storyId, args.previousStatus);
}

/**
 * Everything that happens while the row is claimed.
 *
 * Split out so the caller can wrap the whole of it in one restore, rather than
 * relying on each exit remembering to. A path added here that forgets is
 * covered by the catch; a path added beside the claim would not be.
 */
async function runClaimedRegeneration(args: {
  client: CoverRegenerationClient;
  storyId: string;
  userId: string;
  requestId: string;
  promptNote?: string;
  generate: CoverImageGenerator;
  claim: Record<string, unknown>;
  requiresCredit: boolean;
  restore: () => Promise<void>;
  /** Flipped at the provider call, so a release knows whether to refund. */
  attempt: { reachedProvider: boolean };
}): Promise<RegenerateCoverResult> {
  const {
    client,
    storyId,
    userId,
    requestId,
    generate,
    claim,
    requiresCredit,
    restore,
  } = args;

  let operationId: string | undefined;
  if (requiresCredit) {
    const reservation = await reserveCoverCredit(client, {
      storyId,
      userId,
      requestId,
    });
    if (!reservation.ok) {
      await restore();
      return reservation.failure;
    }
    operationId = reservation.operationId;
  }

  let image: ImageResult | null = null;
  try {
    // Past this line the attempt has cost money whatever happens next, so it
    // stays counted against the ceiling however this call ends.
    args.attempt.reachedProvider = true;
    image = await generate({
      storyId,
      genre: stringOr(claim.primary_genre, "contemporary"),
      title: stringOr(claim.title, "Untitled"),
      themes: stringArray(claim.themes),
      whereAndWhen: optionalString(claim.where_and_when),
      avoid: optionalString(claim.avoid),
      variation: buildVariationSteer(
        args.promptNote,
        optionalString(claim.cover_prompt),
      ),
      // A distinct key per attempt. The public cover URL carries no version, so
      // overwriting the old object would leave every CDN edge and every image
      // cache serving the picture the user just paid to replace.
      storageSuffix: `r${numberOr(claim.regen_count, 0) + 1}`,
    });
  } catch (error) {
    await restore();
    return await settleFailedAttempt(client, {
      userId,
      operationId,
      error,
      code: "generation_failed",
      message: "The cover could not be regenerated. Please try again.",
    });
  }

  if (!image) {
    // Every provider and every safety level refused. The previous cover is
    // still on the row and still correct, so this is a plain 502 and a refund.
    await restore();
    return await settleFailedAttempt(client, {
      userId,
      operationId,
      error: new Error("Cover regeneration exhausted every provider"),
      code: "generation_failed",
      message: "The cover could not be regenerated. Please try again.",
    });
  }

  const { data: finished, error: finishError } = await client.rpc(
    "finish_cover_regeneration",
    {
      p_story_id: storyId,
      p_user_id: userId,
      p_operation_id: operationId ?? null,
      p_cover_url: image.url,
      p_cover_prompt: image.prompt,
      // The replay key, written only here. The claim does not set it, so the
      // guard it feeds means "this request delivered the cover on the row" and
      // not "this request was the last to touch it" - a retry after a failed
      // regeneration re-attempts instead of replaying the old cover as a win.
      p_request_id: requestId,
    },
  );
  if (finishError) {
    // The image exists in storage and nothing recorded it. Restoring the status
    // is the honest outcome - the story keeps the cover it had - and the credit
    // goes back, because what the user paid for is a cover on their story, not
    // a file in a bucket.
    await restore();
    return await settleFailedAttempt(client, {
      userId,
      operationId,
      error: finishError,
      code: "generation_failed",
      message: "The cover was generated but could not be saved.",
    });
  }

  const result = asRecord(finished);
  return {
    ok: true,
    coverImageUrl: image.url,
    coverRegenCount: numberOr(
      result.cover_regen_count,
      numberOr(claim.regen_count, 0) + 1,
    ),
    charged: requiresCredit,
    replayed: false,
    provider: image.provider,
    model: image.model,
  };
}

// ---------------------------------------------------------------------------
// The prompt steer
// ---------------------------------------------------------------------------

/**
 * Turn "the user pressed Regenerate" into an instruction that produces a
 * *different* picture.
 *
 * Two inputs, and they do different jobs. The note is what the writer asked
 * for and is the strongest signal there is. The description of the previous
 * cover is what stops an unnoted regeneration from re-sending the request that
 * produced the cover being replaced - which is why `stories.cover_prompt` is
 * stored at all (migration 00044).
 *
 * Returns undefined when there is nothing to say, so `buildCoverPrompt` emits
 * no steer clause rather than an empty one.
 */
export function buildVariationSteer(
  promptNote: string | undefined,
  previousPrompt: string | undefined,
): string | undefined {
  const parts: string[] = [];

  // Each half is sanitized and capped on its own, before they are joined.
  //
  // Capping only the joined string is what a single cap at the prompt boundary
  // does, and it truncates from the tail: a writer who filled the 300-character
  // note lost the whole "make it clearly different" clause, so the one
  // regeneration that carried the most instruction was also the only one with
  // no instruction to vary. Budgeting here means the boundary cap has nothing
  // left to cut. See MAX_COVER_STEER_* in `cover-prompts.ts`.
  const note = sanitizeExclusion(
    promptNote,
    MAX_COVER_STEER_NOTE_LENGTH - NOTE_PREFIX.length,
  );
  if (note) parts.push(`${NOTE_PREFIX}${note}`);

  const previous = describePreviousCover(previousPrompt);
  parts.push(
    sanitizeExclusion(
      previous
        ? `${VARIATION_PREFIX}${previous}`
        : "Make it clearly different from the previous attempt in composition, palette emphasis and focal subject",
      MAX_COVER_STEER_VARIATION_LENGTH,
    ),
  );

  // Joined with a dash rather than a full stop. The sanitizer at the prompt
  // boundary collapses every sentence terminator to a comma - which is the
  // point of it - so composing this with full stops would only mean writing
  // punctuation for it to rewrite. A dash survives and reads as the pause it is.
  return parts.join(" - ");
}

const NOTE_PREFIX = "The writer asks for this cover: ";
const VARIATION_PREFIX =
  "Make it clearly different from the previous cover, which was: ";

/**
 * Recover the subject of a stored cover prompt, discarding the boilerplate.
 *
 * A stored prompt is mostly fixed scaffolding - style, palette, composition,
 * the no-text instruction - which is identical in the prompt we are about to
 * build, so quoting it back says nothing. The one part that varies is the scene
 * sentence `buildCoverPrompt` writes, which begins at a known phrase and is
 * followed by one of two known clauses.
 *
 * Deliberately forgiving: an unrecognised prompt (an older row, a hand-written
 * one, a future change to `buildCoverPrompt`) returns undefined and the caller
 * falls back to a generic steer. A regeneration that varies less than it could
 * is a worse cover; a regeneration that throws is a lost credit.
 */
export function describePreviousCover(
  previousPrompt: string | undefined,
): string | undefined {
  if (!previousPrompt) return undefined;
  const match = previousPrompt.match(
    /Inspired by the story (.*?)(?=\s(?:The writer asks for|Make it clearly different|Do not depict:|The image must contain NO text))/s,
  );
  const subject = match?.[1]?.trim();
  if (!subject) return undefined;
  // Capped short. This is background for the next prompt, not the next prompt.
  return subject.replace(/\s+/g, " ").slice(0, 180).trim() || undefined;
}

// ---------------------------------------------------------------------------
// Credit plumbing
// ---------------------------------------------------------------------------

async function reserveCoverCredit(
  client: CoverRegenerationClient,
  args: { storyId: string; userId: string; requestId: string },
): Promise<
  | { ok: true; operationId: string }
  | { ok: false; failure: Extract<RegenerateCoverResult, { ok: false }> }
> {
  const { data, error } = await client.rpc("reserve_generation_operation", {
    p_user_id: args.userId,
    p_request_id: args.requestId,
    p_story_id: args.storyId,
    p_chapter_number: COVER_CHAPTER_NUMBER,
    p_kind: "cover",
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "KTH02") {
      return {
        ok: false,
        failure: {
          ok: false,
          status: 402,
          error: "Insufficient credits",
          code: "insufficient_credits",
        },
      };
    }
    if (code === "KTH01") {
      return {
        ok: false,
        failure: {
          ok: false,
          status: 409,
          error: "A cover for this story is already being generated.",
          code: "already_reserved",
        },
      };
    }
    throw error;
  }

  const reservation = asRecord(data);
  const operationId = typeof reservation.id === "string" ? reservation.id : "";
  if (!operationId) throw new Error("Cover reservation returned no operation");

  // A replay of a request id that already finished must not silently produce a
  // second cover for one credit, and a replay of one that was refunded has no
  // reservation behind it at all. Both are the client's cue to mint a new id.
  if (reservation.replayed === true && reservation.status !== "reserved") {
    return {
      ok: false,
      failure: {
        ok: false,
        status: 409,
        error: "That regeneration has already been used. Try again.",
        code: "request_id_spent",
        operationId,
      },
    };
  }

  return { ok: true, operationId };
}

/**
 * Refund a reservation whose cover never arrived, and say what happened.
 *
 * `CREDITS_AND_PRICING.md` principle 4: a failed paid action refunds itself.
 * A refund that itself fails is reported as 503 rather than 502, because the
 * two need different handling - one is "try again", the other is "a credit is
 * outstanding and an operation id is the way to find it".
 */
async function settleFailedAttempt(
  client: CoverRegenerationClient,
  args: {
    userId: string;
    operationId?: string;
    error: unknown;
    code: RegenerateCoverFailure;
    message: string;
  },
): Promise<Extract<RegenerateCoverResult, { ok: false }>> {
  if (!args.operationId) {
    // The free retry. Nothing was charged, so nothing is owed - and the count
    // was never incremented, so the retry is still free.
    return {
      ok: false,
      status: 502,
      error: args.message,
      code: args.code,
    };
  }

  const { error: refundError } = await client.rpc(
    "refund_generation_operation",
    {
      p_operation_id: args.operationId,
      p_user_id: args.userId,
      p_error: errorText(args.error),
    },
  );

  if (refundError) {
    return {
      ok: false,
      status: 503,
      error: "The cover failed and the refund is pending retry.",
      code: "refund_pending",
      operationId: args.operationId,
    };
  }

  return {
    ok: false,
    status: 502,
    error: `${args.message} Your credit has been refunded.`,
    code: args.code,
    operationId: args.operationId,
  };
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

function claimRefusal(reason: string): Extract<
  RegenerateCoverResult,
  { ok: false }
> {
  if (reason === "not_owner") {
    // 404, not 403. Telling a stranger that a story id exists but is not theirs
    // is an enumeration oracle over every story in the table, and there is no
    // legitimate caller who needs to know the difference.
    return {
      ok: false,
      status: 404,
      error: "Story not found",
      code: "not_owner",
    };
  }
  if (reason === "attempt_limit") {
    // 429, not 402 and not 502. Nothing failed and nothing is owed: this story
    // has simply used its budget of cover attempts, and the honest thing to
    // say is that the request is being refused for rate, not for money.
    return {
      ok: false,
      status: 429,
      error:
        "This story has used its cover attempts. Publish it, or start another.",
      code: "attempt_limit",
    };
  }
  if (reason === "in_flight") {
    return {
      ok: false,
      status: 409,
      error: "This cover is already being generated.",
      code: "in_flight",
    };
  }
  return {
    ok: false,
    status: 404,
    error: "Story not found",
    code: "not_found",
  };
}

function coverStatusOf(value: unknown): "generating" | "ready" | "failed" {
  // 'pending' is not restorable through `setCoverStatus`, and it is not the
  // right answer anyway: by the time a regeneration has been claimed the cover
  // has certainly been attempted. A story whose first cover failed keeps
  // 'failed', which is what the concept-card fallback reads.
  return value === "ready" ? "ready" : "failed";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

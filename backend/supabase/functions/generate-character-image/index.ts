import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { normalizeCoverArtStyle } from "../_shared/cover-prompts.ts";
import { logError, safeErrorMessage } from "../_shared/errors.ts";
import { generateDraftCharacterPortrait } from "../_shared/image.ts";
import { parseRequestId, readJsonObject } from "../_shared/operations.ts";

const MAX_CHARACTER_FIELD_LENGTH = 500;

/**
 * Largest style-reference photo accepted, measured on the base64 text.
 *
 * 6 MB of base64 is roughly a 4.5 MB image -- comfortably above a downscaled
 * phone photo and far below anything that would push the request past the
 * platform's own body limit. The client is expected to downscale before
 * sending; this is the backstop, not the resize.
 */
const MAX_REFERENCE_IMAGE_CHARS = 6 * 1024 * 1024;

/**
 * Image types accepted as a style reference.
 *
 * An allowlist rather than a "starts with data:image/" check. The generic form
 * would admit `data:image/svg+xml`, and SVG is a document that can carry script
 * and remote references -- not something to hand to a parser or ever echo back.
 */
const REFERENCE_IMAGE_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
] as const;

/**
 * Read the optional style-reference photo, or explain why it is unusable.
 *
 * Returns `{ value }` on success (including the absent case, where `value` is
 * undefined) and `{ error }` when the field is present but wrong. A malformed
 * reference is rejected rather than silently dropped: the writer attached a
 * photo on purpose, and generating without it while reporting success would
 * hand them a portrait that ignored the one input they cared most about.
 */
export function parseReferenceImage(
  value: unknown,
): { value?: string } | { error: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string" || !value) {
    return { error: "reference_image must be a data URL string" };
  }
  if (value.length > MAX_REFERENCE_IMAGE_CHARS) {
    return { error: "reference_image is too large" };
  }
  if (!REFERENCE_IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return {
      error: "reference_image must be a JPEG, PNG or WebP data URL",
    };
  }
  return { value };
}

/**
 * THERE IS NO `gender` PARAMETER, and there was one.
 *
 * Onboarding's W4 sheet used to ask gender as a required segmented row and
 * send three of its four answers here as a prompt clause. The row is gone: an
 * appearance line already says it whenever it matters, in the person's own
 * words. The parameter went with the row rather than staying behind accepting
 * a value nothing sends, because a contract nothing exercises is one the next
 * person has to prove is dead before they can delete it. A client that sends
 * `gender` now is simply ignored, like any other unknown key.
 */

/**
 * Exported and separated from `serve` so a test can drive the handler without
 * binding a port. Importing this module used to start a listener on :8000 --
 * `publish-story` had the same bug and the same fix.
 */
export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    });

  let observedUserId: string | null = null;
  let observedRequestId: string | null = null;
  // Set only once a reservation actually exists, so the failure paths below can
  // settle it without having to re-derive what it cost. A release that runs
  // when nothing was reserved is impossible (this stays null); a release that
  // never runs costs a real person one of three lifetime images, or a credit.
  let releaseReservation: (() => Promise<void>) | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);
    observedUserId = user.id;

    const body = await readJsonObject(req);
    if (!body) return respond({ error: "Invalid JSON request body" }, 400);

    const requestId = parseRequestId(body.request_id);
    if (!requestId) return respond({ error: "request_id is required" }, 400);
    observedRequestId = requestId;

    // Bounded before anything is spent.
    //
    // One call here can become six paid provider requests (two models across
    // three safety rungs). This is the BURST bound and it runs first: a request
    // the window refuses must not also cost one of the three free images below. See migration
    // 00055 for the numbers and for the anonymous-session gap it does not close
    // -- 00088 is what closes it, for every caller rather than only for guests.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: allowed, error: limitError } = await serviceClient.rpc(
      "claim_character_portrait_request",
      { p_user_id: user.id },
    );
    // A broken limiter must not become a free pass. If the claim cannot be
    // made, refuse: the alternative is that a database blip turns the only
    // bound on this endpoint off.
    if (limitError || allowed !== true) {
      return respond(
        {
          error:
            "You have created a lot of character images recently. Try again in a little while.",
        },
        429,
      );
    }

    // The second bound, and the only one that survives a new session.
    //
    // Three free character images per user, for their whole life --
    // generations and edits alike, anonymous and named, free tier and plan --
    // and one credit each after that (migration 00088, with the number set by
    // 00096; `CREDITS_AND_PRICING.md` §3). This is
    // what replaces "charges nothing, counts nothing": character onboarding
    // makes its aha before the email is asked for, so the first thing an
    // unverified identity can do here is spend money at the image provider, and
    // a named account could do it twelve times an hour forever. Keyed on
    // `auth.users.id`, never a device identifier -- see 00084 for why that
    // residual hole is accepted rather than closed.
    const {
      data: reservationData,
      error: reservationError,
    } = await serviceClient.rpc("claim_character_image_request", {
      p_user_id: user.id,
      p_request_id: requestId,
      // An anonymous identity may use its three free images and no more. Its
      // credits are the three from `bootstrap_user`, and those are for a story -- the thing
      // that converts them -- not for portraits they would spend before ever
      // writing one.
      p_may_purchase: user.is_anonymous !== true,
    });

    if (reservationError) {
      const code = (reservationError as { code?: string }).code;
      if (code === "KTH02") {
        // Out of free images and out of credits. An anonymous caller is told to
        // sign in rather than to buy, because buying needs an account: the wall
        // is there to be converted, not waited out, and the client already
        // routes on this code.
        return user.is_anonymous === true
          ? respond({
            error: "Sign in to keep making characters.",
            code: "guest_portrait_cap",
          }, 403)
          : respond({
            error: "Insufficient credits",
            code: "insufficient_credits",
          }, 402);
      }
      if (code === "KTH01") {
        return respond({
          error: "That character image is already being made.",
          code: "already_reserved",
        }, 409);
      }
      // Fails closed, like both claims before it. If we cannot tell whether
      // they have a free image left or the credits to pay for one, we do not
      // draw: a database blip must not turn the only bound on this endpoint
      // off, and it must not hand out a free provider call either.
      console.error(
        "claim_character_image_request failed:",
        safeErrorMessage(reservationError),
      );
      return respond({
        error: "Character images are unavailable right now. Please try again.",
        code: "claim_unavailable",
      }, 503);
    }

    const reservation = asRecord(reservationData);
    const operationId = typeof reservation.operation_id === "string"
      ? reservation.operation_id
      : "";
    if (!operationId) {
      return respond({
        error: "Character images are unavailable right now. Please try again.",
        code: "claim_unavailable",
      }, 503);
    }
    const creditsCharged = typeof reservation.credits === "number"
      ? reservation.credits
      : 0;

    // The same request id arriving twice is the same tap -- a network retry, a
    // re-delivered invocation -- and the claim replays it rather than charging
    // again. But a replay of an id that already finished or was already
    // refunded is a client reusing a spent id, and drawing a second image
    // against one charge is the thing that must not happen. Same decision
    // `_shared/cover-regeneration.ts` made for covers.
    if (reservation.replayed === true && reservation.status !== "reserved") {
      return respond({
        error: "That character image has already been used. Try again.",
        code: "request_id_spent",
      }, 409);
    }

    /*
      ANOTHER DELIVERY IS ALREADY DRAWING THIS RESERVATION.

      One reservation draws once. The claim said no, which means a concurrent
      delivery of the same request id holds it -- and drawing anyway is us
      paying a provider twice for one charge. The client mints a fresh id per
      tap, so this is never a person pressing twice; it is the platform
      re-delivering an invocation.

      Nothing is released here on purpose: the reservation belongs to the
      delivery that holds the claim, and releasing it would refund a charge
      whose image is still on its way.
    */
    if (reservation.drawing === false) {
      return respond({
        error: "That character image is already being made.",
        code: "request_in_flight",
      }, 409);
    }

    releaseReservation = async () => {
      const { error } = await serviceClient.rpc(
        "release_character_image_request",
        {
          p_operation_id: operationId,
          p_user_id: user.id,
          p_error: "character image was not delivered",
        },
      );
      // Best effort. Losing the release costs one of three free images, or leaves a credit
      // outstanding against an operation id support can find; failing the
      // response because we could not give it back costs the user the error
      // message that tells them to try again.
      if (error) {
        console.error(
          "release_character_image_request failed:",
          safeErrorMessage(error),
        );
      }
    };

    // A refusal from here down happens AFTER the reservation exists, so it has
    // to settle it before it answers. Three is a small number to spend on a
    // request that never reached a provider, and a credit is worse.
    const refuse = async (body: unknown, status: number) => {
      await releaseReservation?.();
      return respond(body, status);
    };

    const name = stringField(body.name);
    const appearance = stringField(body.appearance);
    // Still read, never asked for. The Craft sheet stopped collecting
    // Description, but a client on an older build is still sending one, and
    // refusing it would take the portrait button away from every writer who
    // has not updated. `_shared/types.ts` explains why the field survives.
    const legacyDescription = stringField(body.description);

    if (!name) return await refuse({ error: "name is required" }, 400);
    if (
      name.length > 100 ||
      appearance.length > MAX_CHARACTER_FIELD_LENGTH ||
      legacyDescription.length > MAX_CHARACTER_FIELD_LENGTH
    ) {
      return await refuse(
        { error: "Character image fields are too long" },
        400,
      );
    }
    if (!appearance && !legacyDescription) {
      return await refuse(
        { error: "appearance is required" },
        400,
      );
    }

    // A photo the writer attached to steer this character's look. It is a
    // STYLE reference, never a likeness target: `_shared/image.ts` tells the
    // model so explicitly, the base Safety Rules forbid real people, and a real
    // name typed into a character sheet is reclassified `private_individual`
    // so it is never searched. Several layers, because the prompt alone is the
    // weakest of them. (The story-level privacy lock from 00050 was removed on
    // 2026-09-18, 00091.)
    const reference = parseReferenceImage(body.reference_image);
    if ("error" in reference) {
      return await refuse({ error: reference.error }, 400);
    }

    // The look every image in this story is drawn in, sent from the brief.
    //
    // This endpoint used to accept no style at all, so the writer compared a
    // house-style portrait against a cover they had asked to be watercolour
    // and concluded the setting did nothing. `normalizeCoverArtStyle` maps
    // anything it does not recognise to `auto`, which is the genre's own look
    // -- exactly what an absent field should mean.
    const artStyle = normalizeCoverArtStyle(body.image_style);

    const image = await generateDraftCharacterPortrait(user.id, requestId, {
      name,
      appearance,
      description: legacyDescription,
      referenceImage: reference.value,
    }, artStyle);
    if (!image) {
      // The chain exhausted both models across all three safety rungs. The
      // reveal screen offers a free "Try again" on exactly this response, so
      // the reservation must be settled or the third failure in a row would end
      // the onboarding flow with nothing made and the whole free allowance spent.
      return await refuse(
        { error: "Character image could not be generated" },
        502,
      );
    }

    // Delivered, so the reservation is spent and the request id with it. A
    // complete that fails is not worth failing the response over -- the image
    // exists and the user is looking at it -- but it does mean a replay of this
    // id would find a `reserved` row and draw again, so it is logged.
    const { error: completeError } = await serviceClient.rpc(
      "complete_character_image_request",
      { p_operation_id: operationId, p_user_id: user.id },
    );
    if (completeError) {
      console.error(
        "complete_character_image_request failed:",
        safeErrorMessage(completeError),
      );
    }
    // Settled. Nothing below may hand the reservation back.
    releaseReservation = null;

    return respond({
      url: image.url,
      image_url: image.url,
      storage_path: image.storagePath,
      provider: image.provider,
      model: image.model,
      // What this one cost and what is left, so the client quotes the NEXT one
      // from the server's count rather than from its own arithmetic. Additive:
      // an older client reads neither.
      credits_charged: creditsCharged,
      free_remaining: typeof reservation.free_remaining === "number"
        ? reservation.free_remaining
        : 0,
      balance: typeof reservation.balance === "number"
        ? reservation.balance
        : undefined,
    });
  } catch (error) {
    // Same reasoning as the 502: a throw means no portrait was delivered, so
    // the caller must not be one free image -- or one credit -- poorer for it.
    // `releaseReservation` is null unless a reservation exists and has not been
    // settled, and it swallows its own errors.
    await releaseReservation?.();
    console.error("generate-character-image error:", safeErrorMessage(error));
    await logError({
      bucket: "generation.cover",
      severity: "medium",
      source: "runtime",
      errorCode: "draft_character_image_failed",
      error,
      context: {
        request_id: observedRequestId,
      },
      userId: observedUserId ?? undefined,
    });
    return respond({ error: "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  serve(handleRequest);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A jsonb RPC result as an object, without trusting it to be one. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

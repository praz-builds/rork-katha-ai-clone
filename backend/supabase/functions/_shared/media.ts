/**
 * Post-generation media: the story's cover, and the cast's portraits.
 *
 * ## Why this runs after the response, not inside it
 *
 * `STORY_GENERATION_FLOW.md` decision 40 puts chapter 1's art with chapter 1
 * rather than at publish, which is what removes the ordering problem in
 * Interactive mode. Done synchronously that would mean the user waits for text
 * generation (up to 120s) *plus* up to four images before seeing a single word.
 *
 * So the text response is returned the moment the chapter is persisted, and the
 * images are produced on a background task. The story already has a face while
 * they land: the typographic concept card (decision 39) renders instantly and
 * costs nothing, and `stories.cover_status` tells the client which of "not
 * tried", "in flight", "ready" and "failed" it is looking at, so it can show the
 * concept card without pretending an image is still coming.
 *
 * ## Why a failure here is never fatal
 *
 * The user paid for a chapter and has one. An image provider being down must
 * not fail the generation, must not refund a credit that bought text that was
 * delivered, and must not block publishing. Every path in this module resolves;
 * failures land in `error_events` and in `cover_status`, never in the caller.
 */

import { notifyInBackground } from "./notify.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { generateCharacterPortrait, generateCoverImage } from "./image.ts";
import { logError, safeErrorMessage } from "./errors.ts";

export interface StoryMediaInput {
  storyId: string;
  operationId: string;
  userId: string;
  genre: string;
  title: string;
  themes: string[];
  whereAndWhen?: string;
  /**
   * Whether to tell the author the story is finished.
   *
   * Off unless the caller asks. The onboarding notify screen is a soft
   * pre-prompt, so a user who has not accepted it must never receive a push,
   * and a user still watching the chapter stream does not need one either.
   * The client decides and passes it through the generation request.
   */
  notifyOnReady?: boolean;
}

/**
 * Hand work to the platform's background task runner when there is one.
 *
 * `EdgeRuntime.waitUntil` keeps the isolate alive after the response has been
 * flushed. It does not exist under plain `deno test` or `deno run`; there this
 * degrades to a detached promise whose rejection is swallowed, **not** to
 * awaiting inline. Nothing outside an Edge Function guarantees the work
 * completes, so a caller that needs the result must await the underlying
 * promise itself rather than relying on this.
 */
export function runInBackground(work: Promise<unknown>): void {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(work.catch(() => {}));
    return;
  }
  // No background runner: swallow the rejection so an unhandled promise
  // rejection cannot take the isolate down mid-response.
  void work.catch(() => {});
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Generate the story's cover and every cast portrait, then persist the URLs.
 *
 * Ordering is deliberate: **portraits first**, per decision 20. They must stay
 * consistent across every chapter, and in Interactive mode there is no later
 * moment when the whole cast is known at once - so if the deadline only allows
 * some of this work, the portraits are the part that cannot be redone later.
 */
export async function generateStoryMedia(
  input: StoryMediaInput,
): Promise<void> {
  const supabase = serviceClient();

  // Claim the whole job up front, before the portraits.
  //
  // `generate-story` tells the client `cover_status: "generating"` in its
  // response, so the row has to say the same thing from that moment. Claiming
  // it only at the cover step left a window - four portrait chains wide, up to
  // several minutes - in which the row still read 'pending'. A client that
  // re-fetched during that window would see "never attempted", show the
  // concept card as final, and never look again.
  await setCoverStatus(supabase, input.storyId, "generating");

  const castReady = await generateCastPortraits(
    supabase,
    input.storyId,
    input.userId,
  );
  if (!castReady) await refundMissingMedia(supabase, input, "cast");

  const coverReady = await generateAndStoreCover(supabase, input);
  if (!coverReady) await refundMissingMedia(supabase, input, "cover");

  // The story is finished here, not when the chapter was persisted.
  //
  // This is the moment worth notifying: the text has been readable for a while,
  // but the cover is what makes the row look finished in Library, and this task
  // is the only place that knows the whole job is done. A cover that failed
  // still finishes the story - decision 39 treats the concept card as a
  // legitimate published look - so the notification does not depend on it.
  //
  // Failure here can never reach the story. `notifyInBackground` swallows
  // everything to a console line: a generated story must not be reported as
  // failed because a push could not be delivered.
  if (input.notifyOnReady) {
    await notifyInBackground({
      userId: input.userId,
      kind: "story_ready",
      storyId: input.storyId,
      title: input.title,
    });
  }
}

async function refundMissingMedia(
  supabase: SupabaseClient,
  input: StoryMediaInput,
  component: "cast" | "cover",
): Promise<void> {
  const { error } = await supabase.rpc("refund_story_media_component", {
    p_operation_id: input.operationId,
    p_user_id: input.userId,
    p_component: component,
  });
  if (!error) return;

  console.error(
    `[media] ${component} refund failed for ${input.storyId}:`,
    safeErrorMessage(error),
  );
  await logError({
    bucket: "credits",
    severity: "high",
    source: "runtime",
    errorCode: "story_media_refund_failed",
    error,
    context: {
      story_id: input.storyId,
      operation_id: input.operationId,
      component,
    },
    userId: input.userId,
  });
}

/**
 * How long a story may sit in `cover_status = 'generating'` before a caller
 * should treat it as abandoned.
 *
 * `EdgeRuntime.waitUntil` keeps the isolate alive on a best-effort basis. If
 * the platform reclaims it mid-job - a deploy, an eviction, a hard timeout -
 * no code of ours runs again for that story, and the row stays 'generating'
 * forever with no image behind it. Nothing can prevent that from inside the
 * isolate, so the contract is that 'generating' is only meaningful while it is
 * fresh: past this window a reader should fall back to the concept card, and a
 * retry is free to re-claim the row.
 *
 * `cover_started_at` is what makes that decidable. Without a timestamp,
 * "in flight" and "died an hour ago" are the same row.
 */
export const COVER_GENERATING_STALE_MS = 10 * 60 * 1000;

async function setCoverStatus(
  supabase: SupabaseClient,
  storyId: string,
  status: "generating" | "ready" | "failed",
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from("stories")
    .update({
      cover_status: status,
      ...(status === "generating"
        ? { cover_started_at: new Date().toISOString() }
        : {}),
      ...extra,
    })
    .eq("id", storyId);
  // Not fatal — the image itself may be fine — but not silent either.
  //
  // A failed `ready` update is the worst of these: the cover exists in storage
  // and the row still says `generating`, so the reader waits on a spinner for
  // an image that is already sitting behind a URL nothing recorded. That is
  // invisible without telemetry, and unrecoverable without knowing it
  // happened, so it is logged with the URL it failed to persist.
  if (error) {
    console.error(
      `[media] cover_status=${status} failed for ${storyId}:`,
      error.message,
    );
    await logError({
      bucket: "generation.cover",
      severity: status === "ready" ? "high" : "low",
      source: "runtime",
      errorCode: "cover_status_update_failed",
      error: new Error(`Could not set cover_status=${status}`),
      context: {
        story_id: storyId,
        attempted_status: status,
        // Identifiers and enums only — but whether a URL existed is the fact
        // that distinguishes "lost a finished cover" from "lost a failure".
        had_cover_url: Boolean(extra.cover_image_url),
      },
    });
  }
}

async function generateCastPortraits(
  supabase: SupabaseClient,
  storyId: string,
  userId: string,
): Promise<boolean> {
  const { data: cast, error } = await supabase
    .from("characters")
    .select("id, name, description, appearance")
    .eq("story_id", storyId);

  if (error) {
    console.error("[media] could not read cast:", error.message);
    return false;
  }
  if (!cast?.length) return false;

  let readyCount = 0;

  // Sequential, not parallel. Four concurrent image requests against one
  // provider is the reliable way to hit a rate limit and lose the whole cast
  // rather than three quarters of it, and nothing is waiting on the result.
  for (const character of cast) {
    try {
      const portrait = await generateCharacterPortrait(storyId, character.id, {
        name: character.name,
        description: character.description ?? undefined,
        appearance: character.appearance ?? undefined,
      });
      if (!portrait) continue;

      const { error: updateError } = await supabase
        .from("characters")
        .update({ portrait_url: portrait.url })
        .eq("id", character.id);
      if (updateError) throw updateError;
      readyCount += 1;
    } catch (error) {
      console.error(
        `[media] portrait failed for ${character.id}:`,
        safeErrorMessage(error),
      );
      await logError({
        bucket: "generation.cover",
        severity: "low",
        source: "runtime",
        errorCode: "portrait_failed",
        error,
        context: { story_id: storyId, character_id: character.id },
        userId,
      });
    }
  }
  return readyCount === cast.length;
}

async function generateAndStoreCover(
  supabase: SupabaseClient,
  input: StoryMediaInput,
): Promise<boolean> {
  // The row was already claimed in `generateStoryMedia`, before the portraits.
  try {
    const cover = await generateCoverImage({
      storyId: input.storyId,
      genre: input.genre,
      title: input.title,
      themes: input.themes,
      whereAndWhen: input.whereAndWhen,
      characters: await readCastForCover(supabase, input.storyId),
    });

    if (!cover) {
      // Every provider and every safety level was exhausted. The concept card
      // is now the story's final look, which decision 39 treats as legitimate -
      // so this is a recorded outcome, not an error the user has to see.
      await setCoverStatus(supabase, input.storyId, "failed");
      await logError({
        bucket: "generation.cover",
        severity: "medium",
        source: "runtime",
        errorCode: "cover_all_providers_failed",
        error: new Error("Cover generation exhausted every provider"),
        context: { story_id: input.storyId, genre: input.genre },
        userId: input.userId,
      });
      return false;
    }

    await setCoverStatus(supabase, input.storyId, "ready", {
      cover_image_url: cover.url,
    });

    console.log(
      `[media] cover ready for ${input.storyId} via ${cover.provider}/${cover.model}`,
    );
    return true;
  } catch (error) {
    console.error(
      `[media] cover failed for ${input.storyId}:`,
      safeErrorMessage(error),
    );
    // A storage or database failure leaves the row claimed as 'generating'
    // forever unless it is released here, and a story stuck on a spinner is a
    // worse result than one showing its concept card.
    await setCoverStatus(supabase, input.storyId, "failed");
    await logError({
      bucket: "generation.cover",
      severity: "medium",
      source: "runtime",
      errorCode: "cover_persist_failed",
      error,
      context: { story_id: input.storyId, genre: input.genre },
      userId: input.userId,
    });
    return false;
  }
}

async function readCastForCover(
  supabase: SupabaseClient,
  storyId: string,
): Promise<
  { name: string; description?: string; isHero?: boolean }[] | undefined
> {
  const { data } = await supabase
    .from("characters")
    .select("name, description, is_hero")
    .eq("story_id", storyId);
  if (!data?.length) return undefined;
  return data.map((c) => ({
    name: c.name,
    description: c.description ?? undefined,
    isHero: c.is_hero ?? false,
  }));
}

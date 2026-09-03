/**
 * Image generation for covers and character portraits.
 *
 * Two call sites, one provider chain:
 *
 * - `generateCoverImage` — chapter 1's art, which *is* the story's cover
 *   (`STORY_GENERATION_FLOW.md` §10.4, decision 38).
 * - `generateCharacterPortrait` — one portrait per cast member, prompted from
 *   `appearance` + `description` (§4, decision 54). Deliberately a separate
 *   prompt path from the cover: Appearance drives the image, Background drives
 *   the voice, and mixing them is what makes portraits generic.
 *
 * ## The provider chain
 *
 * OpenAI `gpt-image-1` stays first — it is the quality bar the covers were
 * designed against. Behind it sit OpenRouter's Gemini image models, which
 * previously did not exist as a position at all: a single OpenAI outage, quota
 * exhaustion or per-project entitlement gap took cover generation to zero with
 * no fallback, and `OPENAI_API_KEY` is shared with story generation, so the two
 * had one blast radius.
 *
 * **There is no free image model on OpenRouter.** Every model advertising
 * `image` in `output_modalities` is priced (verified against
 * `GET https://openrouter.ai/api/v1/models`, 2026-09-03). The free tier that
 * `llm.ts` uses for prose has no equivalent here, so this chain is a
 * cheaper-and-independent fallback, not a free one. Per generated image, at
 * Gemini's fixed 1,290 output tokens:
 *
 * | position | model                             | ≈ per image |
 * |----------|-----------------------------------|-------------|
 * | 1        | openai/gpt-image-1 (direct)        | $0.063      |
 * | 2        | google/gemini-3.1-flash-image      | ~$0.077     |
 * | 3        | google/gemini-2.5-flash-image      | ~$0.039     |
 *
 * 2.5-flash-image is the cheapest of the three and sits last only because
 * 3.1-flash is the stronger model; a deployment optimising for the
 * `CREDITS_AND_PRICING.md` margin constraint should reorder these two, and
 * §10.6's per-cast portrait cost hole is the reason that decision matters.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCoverPrompt } from "./cover-prompts.ts";

/** Read lazily, never at module load — see the note at the top of `llm.ts`. */
const openaiKey = () => Deno.env.get("OPENAI_API_KEY")?.trim();
const openRouterKey = () => Deno.env.get("OPENROUTER_API_KEY")?.trim();

/** Prompt simplification levels, applied in order on moderation rejection. */
const MAX_SAFETY_LEVELS = 3;
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * The whole chain is bounded, not just each request.
 *
 * Without this a provider that stalls at just under its own timeout, three
 * safety levels deep, keeps the Edge Function alive past the platform's own
 * limit and the caller gets a dropped connection rather than a null and a
 * concept cover.
 */
const CHAIN_DEADLINE_MS = 150_000;

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
  ) => Promise<Uint8Array>;
}

const PROVIDERS: readonly ImageProvider[] = [
  {
    name: "openai",
    model: "gpt-image-1",
    key: openaiKey,
    generate: generateWithOpenAI,
  },
  {
    name: "openrouter",
    model: "google/gemini-3.1-flash-image",
    key: openRouterKey,
    generate: (p, k, a, d) =>
      generateWithOpenRouter("google/gemini-3.1-flash-image", p, k, a, d),
  },
  {
    name: "openrouter",
    model: "google/gemini-2.5-flash-image",
    key: openRouterKey,
    generate: (p, k, a, d) =>
      generateWithOpenRouter("google/gemini-2.5-flash-image", p, k, a, d),
  },
];

export type ImageAspect = "cover" | "portrait";

/** Both are portrait-orientation; the cover is taller. */
const ASPECT: Record<ImageAspect, { openaiSize: string; words: string }> = {
  cover: {
    openaiSize: "1024x1536",
    words: "portrait orientation, 2:3 aspect ratio",
  },
  portrait: {
    openaiSize: "1024x1536",
    words: "full-body portrait orientation, 2:3 aspect ratio",
  },
};

export interface ImageResult {
  url: string;
  storagePath: string;
  /** Which provider and model actually produced it — for telemetry. */
  provider: string;
  model: string;
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
  characters?: { name: string; description?: string }[];
  /** The where-and-when chip. What stops the cover being genre stock art. */
  whereAndWhen?: string;
}): Promise<ImageResult | null> {
  const storagePath = `covers/${input.storyId}/cover.png`;
  return await runImageChain({
    label: `cover ${input.storyId}`,
    bucket: "covers",
    storagePath,
    aspect: "cover",
    promptFor: (safetyLevel) => buildCoverPromptForLevel(safetyLevel, input),
  });
}

/**
 * Prompt simplification ladder for a cover.
 *
 * Level 0 is the full prompt. Level 1 drops the cast and trims the themes -
 * a character description is by far the likeliest part of a cover prompt to
 * trip a content filter. Level 2 is genre and title only.
 */
function buildCoverPromptForLevel(
  safetyLevel: number,
  input: {
    genre: string;
    title: string;
    themes: string[];
    characters?: { name: string; description?: string }[];
    whereAndWhen?: string;
  },
): string {
  const { genre, title, themes, characters, whereAndWhen } = input;
  if (safetyLevel === 0) {
    return buildCoverPrompt(
      genre,
      title,
      themes,
      usableCharacters(characters),
      whereAndWhen,
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
    );
  }
  return buildCoverPrompt(genre, title, []);
}

/**
 * Drop characters that cannot contribute to an image prompt.
 *
 * `buildCoverPrompt` interpolates `hero.description` directly, so a character
 * saved with a name and nothing else - which the Craft character sheet permits,
 * since only Name is required - produced the literal string
 * "a distant silhouetted figure suggesting undefined" in the prompt. Filtering
 * here is what makes the zero-usable-characters case degrade to the genre cover
 * rather than to a corrupted one.
 */
function usableCharacters(
  characters?: { name: string; description?: string }[],
): { name: string; description: string }[] | undefined {
  if (!characters?.length) return undefined;
  const usable = characters
    .filter((c) => typeof c.description === "string" && c.description.trim())
    .map((c) => ({
      name: c.name,
      description: sanitizeForPrompt(c.description as string),
    }));
  return usable.length > 0 ? usable : undefined;
}

// ---------------------------------------------------------------------------
// Character portraits
// ---------------------------------------------------------------------------

/**
 * Generate one cast member's portrait and upload it to the `covers` bucket.
 *
 * Prompted from Appearance first and Description second, per §4: Appearance
 * exists to drive the image. A character with neither returns null - there is
 * nothing to draw, and a genre-generic portrait attached to a named character
 * is worse than no portrait at all.
 */
export async function generateCharacterPortrait(
  storyId: string,
  characterId: string,
  character: { name: string; description?: string; appearance?: string },
): Promise<ImageResult | null> {
  const appearance = sanitizeForPrompt(character.appearance ?? "");
  const description = sanitizeForPrompt(character.description ?? "");
  if (!appearance && !description) {
    console.warn(
      `[portrait] ${characterId} has neither appearance nor description — skipping`,
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
      buildPortraitPrompt(appearance, description, safetyLevel),
  });
}

function buildPortraitPrompt(
  appearance: string,
  description: string,
  safetyLevel: number,
): string {
  // The ladder drops the free-text fields in the order they are likely to have
  // caused a rejection: appearance carries the physical detail, description the
  // role. Level 2 keeps only the role, which is rarely rejectable.
  const parts = safetyLevel === 0
    ? [description, appearance]
    : safetyLevel === 1
    ? [description]
    : [description.split(/[,.]/)[0] ?? "a person"];

  const subject = parts.filter(Boolean).join(". ") || "a person";

  return [
    `Character portrait illustration of ${subject}.`,
    `Full body, standing, facing the viewer, on a plain neutral background.`,
    `Painterly book-illustration style, soft even lighting, no background scenery.`,
    `The image must contain NO text, NO titles, NO words, NO letters, NO watermarks.`,
    `Full-body portrait orientation, subject centered in frame, high quality.`,
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

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

async function runImageChain(input: {
  label: string;
  bucket: string;
  storagePath: string;
  aspect: ImageAspect;
  promptFor: (safetyLevel: number) => string;
}): Promise<ImageResult | null> {
  const deadline = Date.now() + CHAIN_DEADLINE_MS;

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
        const bytes = await provider.generate(
          input.promptFor(level),
          apiKey,
          input.aspect,
          deadline,
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

async function generateWithOpenAI(
  prompt: string,
  apiKey: string,
  aspect: ImageAspect,
  deadline: number,
): Promise<Uint8Array> {
  const payload = await postJson(
    "https://api.openai.com/v1/images/generations",
    apiKey,
    {
      model: "gpt-image-1",
      prompt,
      n: 1,
      size: ASPECT[aspect].openaiSize,
      quality: "medium",
    },
    deadline,
    "OpenAI image",
  );

  const entry = (payload as {
    data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  })?.data?.[0];

  if (entry?.revised_prompt) console.log("[image] prompt revised by OpenAI");
  if (entry?.b64_json) return decodeBase64(entry.b64_json);
  if (entry?.url) return await downloadImage(entry.url, deadline);
  throw new Error("OpenAI returned no image data");
}

/**
 * OpenRouter returns images through chat completions, not an images endpoint.
 *
 * The model is asked for image output via `modalities`, and the result arrives
 * on `choices[0].message.images[].image_url.url` as a `data:` URL — a different
 * response shape from OpenAI's `data[0].b64_json`, which is why this cannot
 * reuse the OpenAI reader.
 */
async function generateWithOpenRouter(
  model: string,
  prompt: string,
  apiKey: string,
  aspect: ImageAspect,
  deadline: number,
): Promise<Uint8Array> {
  const payload = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
    apiKey,
    {
      model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: `${prompt} Render as a single image, ${
            ASPECT[aspect].words
          }.`,
        },
      ],
    },
    deadline,
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
  return await downloadImage(url, deadline);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  deadline: number,
  providerLabel: string,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const budget = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
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
): Promise<Uint8Array> {
  const budget = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
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
 * 2026-09-04: `gemini-3.1-flash-image` and `gemini-2.5-flash-image` return PNG,
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
  if (
    bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
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
    "returned no image",
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

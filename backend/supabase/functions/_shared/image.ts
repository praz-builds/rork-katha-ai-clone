import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCoverPrompt } from "./cover-prompts.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MAX_RETRIES = 3;

interface CoverResult {
  url: string;
  storagePath: string;
}

/**
 * Generate a cover image for a story using DALL-E 3 and upload to Supabase Storage.
 *
 * Outputs a 1024x1536 portrait image. Focal-point cropping handles all display contexts.
 * On moderation rejection, retries with a simplified prompt (up to 3 attempts).
 * Falls back gracefully — returns null on total failure so publishing is never blocked.
 */
export async function generateCoverImage(
  storyId: string,
  genre: string,
  title: string,
  themes: string[],
  characters?: { name: string; description: string }[],
): Promise<CoverResult | null> {
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not set — skipping cover generation");
    return null;
  }

  const storagePath = `covers/${storyId}/cover.png`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const prompt = buildPromptForAttempt(
        attempt,
        genre,
        title,
        themes,
        characters,
      );

      console.log(
        `[cover] attempt ${attempt + 1}/${MAX_RETRIES} for story ${storyId}`,
      );

      const imageBytes = await generateImage(prompt);
      const publicUrl = await uploadToStorage(storagePath, imageBytes);

      return { url: publicUrl, storagePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[cover] attempt ${attempt + 1} failed for ${storyId}:`,
        message,
      );

      if (!isModerationError(message) || attempt === MAX_RETRIES - 1) {
        console.error("[cover] giving up on cover generation");
        return null;
      }
    }
  }

  return null;
}

function buildPromptForAttempt(
  attempt: number,
  genre: string,
  title: string,
  themes: string[],
  characters?: { name: string; description: string }[],
): string {
  if (attempt === 0) {
    return buildCoverPrompt(genre, title, themes, characters);
  }
  if (attempt === 1) {
    // Simplify: drop character details, use only genre + title
    return buildCoverPrompt(genre, title, themes.slice(0, 2));
  }
  // Most conservative: generic genre cover
  return buildCoverPrompt(genre, title, []);
}

async function generateImage(prompt: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: "1024x1536",
        quality: "medium",
      }),
    });

    const payload: unknown = await res.json();

    if (!res.ok) {
      const errMsg = extractOpenAIError(payload);
      throw new Error(`OpenAI image error (${res.status}): ${errMsg}`);
    }

    const data = payload as {
      data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
    };
    const entry = data?.data?.[0];

    if (entry?.revised_prompt) {
      console.log("[cover] prompt was revised by OpenAI");
    }

    // gpt-image-1 returns base64; fall back to URL download for older models
    if (entry?.b64_json) {
      const raw = atob(entry.b64_json);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes;
    }

    if (entry?.url) {
      return await downloadImage(entry.url);
    }

    throw new Error("OpenAI returned no image data");
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function uploadToStorage(
  path: string,
  bytes: Uint8Array,
): Promise<string> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.storage
    .from("covers")
    .upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: publicData } = supabase.storage
    .from("covers")
    .getPublicUrl(path);

  return publicData.publicUrl;
}

function isModerationError(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "content policy",
    "safety system",
    "content_policy_violation",
    "moderation",
    "unsafe content",
    "blocked",
  ].some((marker) => lower.includes(marker));
}

function extractOpenAIError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "invalid error body";
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return "unknown error";
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string"
    ? message.slice(0, 500)
    : "unknown error";
}

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
 * Outputs a 1024x1792 portrait image (DALL-E 3 native portrait).
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

      const imageUrl = await callDalle3(prompt);
      const imageBytes = await downloadImage(imageUrl);
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

async function callDalle3(prompt: string): Promise<string> {
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
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1792",
        quality: "standard",
        response_format: "url",
      }),
    });

    const payload: unknown = await res.json();

    if (!res.ok) {
      const errMsg = extractOpenAIError(payload);
      throw new Error(`DALL-E 3 error (${res.status}): ${errMsg}`);
    }

    const data = payload as {
      data?: { url?: string; revised_prompt?: string }[];
    };
    const url = data?.data?.[0]?.url;
    if (!url) throw new Error("DALL-E 3 returned no image URL");

    const revised = data?.data?.[0]?.revised_prompt;
    if (revised) {
      console.log("[cover] revised prompt:", revised.slice(0, 200));
    }

    return url;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
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

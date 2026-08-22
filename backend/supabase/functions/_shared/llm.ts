import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.1";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface GenerationResult {
  text: string;
  model: string;
}

/**
 * Generate story text with fallback chain:
 * Sonnet 4.6 (60s) -> Haiku 4.5 (30s) -> gpt-4o-mini (30s)
 */
export async function generateStoryText(
  systemPrompt: string,
  userPrompt: string,
): Promise<GenerationResult> {
  const failures: string[] = [];
  // Attempt 1: Sonnet 4.6
  try {
    const text = await generateAnthropicText(
      "claude-sonnet-4-6",
      60000,
      systemPrompt,
      userPrompt,
    );
    return { text, model: "claude-sonnet-4-6" };
  } catch (e) {
    console.error("Sonnet 4.6 failed:", e);
    failures.push(`claude-sonnet-4-6: ${failureMessage(e)}`);
  }

  // Attempt 2: Haiku 4.5
  try {
    const text = await generateAnthropicText(
      "claude-haiku-4-5-20251001",
      30000,
      systemPrompt,
      userPrompt,
    );
    return { text, model: "claude-haiku-4-5" };
  } catch (e) {
    console.error("Haiku 4.5 failed:", e);
    failures.push(`claude-haiku-4-5: ${failureMessage(e)}`);
  }

  // Attempt 3: gpt-4o-mini
  if (OPENAI_API_KEY) {
    try {
      const text = await withAbortTimeout(
        30000,
        async (signal) => {
          const res = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              signal,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
                max_tokens: 4096,
              }),
            },
          );
          const payload: unknown = await res.json();
          if (!res.ok) {
            throw new Error(
              `OpenAI request failed (${res.status}): ${
                providerError(payload)
              }`,
            );
          }
          return openAIContent(payload);
        },
      );
      return { text, model: "gpt-4o-mini" };
    } catch (e) {
      console.error("gpt-4o-mini failed:", e);
      failures.push(`gpt-4o-mini: ${failureMessage(e)}`);
    }
  } else {
    failures.push("gpt-4o-mini: OPENAI_API_KEY is not configured");
  }

  throw new Error(`All LLM providers failed. ${failures.join(" | ")}`);
}

async function generateAnthropicText(
  model: string,
  timeoutMs: number,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await withAbortTimeout(
        timeoutMs,
        (signal) =>
          client.messages.create(
            {
              model,
              max_tokens: 4096,
              system: systemPrompt,
              messages: [{
                role: "user",
                content: moderationSafePrompt(userPrompt, attempt),
              }],
            },
            { signal },
          ),
      );
      const text = response.content
        .filter((block: Anthropic.ContentBlock) => block.type === "text")
        .map((block: Anthropic.TextBlock) => block.text)
        .join("");
      if (!text.trim()) throw new Error("Anthropic returned no text content");
      return text;
    } catch (error) {
      if (!isModerationRejection(error) || attempt === 2) throw error;
      console.warn(
        `${model} moderation retry ${attempt + 1} of 2:`,
        failureMessage(error),
      );
    }
  }

  throw new Error("Anthropic moderation retries exhausted");
}

function moderationSafePrompt(userPrompt: string, attempt: number): string {
  if (attempt === 0) return userPrompt;
  if (attempt === 1) {
    return `${userPrompt}\n\nDescribe tense or sensitive scenes gently and indirectly. Avoid graphic detail while preserving the requested characters, genre, and plot.`;
  }
  return `${userPrompt}\n\nUse calm, age-appropriate language throughout. Resolve danger off-page, omit graphic or explicit detail, and preserve only the essential characters and story arc.`;
}

function isModerationRejection(error: unknown): boolean {
  const message = failureMessage(error).toLowerCase();
  return [
    "moderation",
    "content policy",
    "safety policy",
    "unsafe content",
    "content blocked",
    "content filtering",
  ].some((marker) => message.includes(marker));
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error);
}

function openAIContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("OpenAI returned an invalid response");
  }
  const choices = (payload as Record<string, unknown>).choices;
  if (
    !Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object"
  ) {
    throw new Error("OpenAI returned no choices");
  }
  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    throw new Error("OpenAI returned no message");
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI returned no content");
  }
  return content;
}

function providerError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "invalid error body";
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return "unknown provider error";
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string"
    ? message.slice(0, 500)
    : "unknown provider error";
}

async function withAbortTimeout<T>(
  ms: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${ms}ms`)),
    ms,
  );

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

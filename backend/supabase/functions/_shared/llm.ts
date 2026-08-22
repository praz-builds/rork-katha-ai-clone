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
  // Attempt 1: Sonnet 4.6
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await withAbortTimeout(
      60000,
      (signal) =>
        client.messages.create(
          {
            model: "claude-sonnet-4-6-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          },
          { signal },
        ),
    );
    const text = response.content
      .filter((b: Anthropic.ContentBlock) => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return { text, model: "claude-sonnet-4-6" };
  } catch (e) {
    console.error("Sonnet 4.6 failed:", e);
  }

  // Attempt 2: Haiku 4.5
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await withAbortTimeout(
      30000,
      (signal) =>
        client.messages.create(
          {
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          },
          { signal },
        ),
    );
    const text = response.content
      .filter((b: Anthropic.ContentBlock) => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return { text, model: "claude-haiku-4-5" };
  } catch (e) {
    console.error("Haiku 4.5 failed:", e);
  }

  // Attempt 3: gpt-4o-mini
  if (OPENAI_API_KEY) {
    try {
      const res = await withAbortTimeout(
        30000,
        (signal) =>
          fetch("https://api.openai.com/v1/chat/completions", {
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
          }),
      );
      const data = await res.json();
      return { text: data.choices[0].message.content, model: "gpt-4o-mini" };
    } catch (e) {
      console.error("gpt-4o-mini failed:", e);
    }
  }

  throw new Error("All LLM providers failed");
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

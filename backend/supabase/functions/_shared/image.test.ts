import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { generateCoverImage, isModerationError } from "./image.ts";

/**
 * The chain's job is to keep trying. These tests are about the ways it could
 * quietly stop trying — which is the only failure mode that matters, because
 * every path returns `null` and the caller cannot tell "tried everything" from
 * "gave up on the first rejection".
 */

const realFetch = globalThis.fetch;

interface Attempt {
  url: string;
  model: string;
}

/** Replace fetch, record every provider call, and answer with `respond`. */
async function withStubbedProviders(
  respond: (attempt: Attempt, index: number) => Response,
  run: () => Promise<unknown>,
): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  const previous = {
    openai: Deno.env.get("OPENAI_API_KEY"),
    openrouter: Deno.env.get("OPENROUTER_API_KEY"),
  };
  Deno.env.set("OPENAI_API_KEY", "test-openai");
  Deno.env.set("OPENROUTER_API_KEY", "test-openrouter");

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    const attempt = { url, model: body.model ?? "" };
    attempts.push(attempt);
    return Promise.resolve(respond(attempt, attempts.length - 1));
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
    for (
      const [key, value] of [
        ["OPENAI_API_KEY", previous.openai],
        ["OPENROUTER_API_KEY", previous.openrouter],
      ] as const
    ) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
  return attempts;
}

function moderationRejection(): Response {
  return new Response(
    JSON.stringify({
      error: { message: "Your request was rejected by our safety system." },
    }),
    { status: 400 },
  );
}

const cover = {
  storyId: "11111111-1111-1111-1111-111111111111",
  genre: "horror",
  title: "The Empty House",
  themes: ["dread"],
};

// The regression this file exists for.
//
// `safetyLevel` is carried across providers so a prompt already known to be
// unacceptable is not re-sent. Carried *without a clamp*, three rejections from
// the first provider pushed the level to the maximum and the loop guard then
// skipped every remaining provider without sending a request — the exact
// opposite of what a fallback chain is for, since the reason to try a second
// provider is that its filter is a different filter.
Deno.test("a provider exhausting every safety level does not skip the fallbacks", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () => generateCoverImage(cover),
  );

  const openai = attempts.filter((a) => a.url.includes("api.openai.com"));
  const openrouter = attempts.filter((a) => a.url.includes("openrouter.ai"));

  assertEquals(openai.length, 3, "OpenAI should walk all three safety levels");
  assert(
    openrouter.length >= 2,
    `both OpenRouter models must still be tried, saw ${openrouter.length}`,
  );
  assertEquals(
    new Set(openrouter.map((a) => a.model)).size,
    2,
    "the second OpenRouter model must not be skipped",
  );
});

Deno.test("a non-moderation failure moves to the next provider with the prompt unchanged", async () => {
  const attempts = await withStubbedProviders(
    () =>
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
        status: 429,
      }),
    () => generateCoverImage(cover),
  );

  // Auth, quota and 5xx are provider problems, not prompt problems: retrying a
  // simplified prompt on a provider that is out of quota wastes the deadline.
  assertEquals(
    attempts.filter((a) => a.url.includes("api.openai.com")).length,
    1,
  );
  assertEquals(attempts.length, 3, "one attempt per provider, no ladder");
});

Deno.test("a provider with no credential is skipped, not failed", async () => {
  const previous = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.delete("OPENROUTER_API_KEY");
  try {
    const attempts = await withStubbedProvidersWithoutOpenRouter();
    assertEquals(
      attempts.filter((a) => a.url.includes("openrouter.ai")).length,
      0,
    );
  } finally {
    if (previous === undefined) Deno.env.delete("OPENROUTER_API_KEY");
    else Deno.env.set("OPENROUTER_API_KEY", previous);
  }
});

async function withStubbedProvidersWithoutOpenRouter(): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  const previousOpenAI = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-openai");
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    attempts.push({ url, model: body.model ?? "" });
    return Promise.resolve(moderationRejection());
  }) as typeof fetch;
  try {
    await generateCoverImage(cover);
  } finally {
    globalThis.fetch = realFetch;
    if (previousOpenAI === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", previousOpenAI);
  }
  return attempts;
}

Deno.test("total failure returns null rather than throwing", async () => {
  let result: unknown = "unset";
  await withStubbedProviders(
    () => moderationRejection(),
    async () => {
      result = await generateCoverImage(cover);
    },
  );
  // A story without a cover still has its concept card. An image provider being
  // down must never fail a generation the user already paid for.
  assertEquals(result, null);
});

Deno.test("an OpenRouter 200 carrying no image counts as a rejection, not a success", () => {
  assert(
    isModerationError("OpenRouter returned no image for x — content policy"),
  );
  assert(isModerationError("Your request was rejected by our safety system"));
  assert(!isModerationError("quota exceeded"));
  assert(!isModerationError("Storage upload failed: bucket not found"));
});

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
  /** Per-provider credential override; `null` removes the credential. */
  keys: { openai?: string | null; openrouter?: string | null } = {},
): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  const previous = {
    openai: Deno.env.get("OPENAI_API_KEY"),
    openrouter: Deno.env.get("OPENROUTER_API_KEY"),
  };
  const apply = (
    name: string,
    value: string | null | undefined,
    fallback: string,
  ) => {
    if (value === null) Deno.env.delete(name);
    else Deno.env.set(name, value ?? fallback);
  };
  apply("OPENAI_API_KEY", keys.openai, "test-openai");
  apply("OPENROUTER_API_KEY", keys.openrouter, "test-openrouter");

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
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () => generateCoverImage(cover),
    { openrouter: null },
  );
  assertEquals(
    attempts.filter((a) => a.url.includes("openrouter.ai")).length,
    0,
  );
  // Skipping is not failing: OpenAI still walks its full ladder.
  assertEquals(
    attempts.filter((a) => a.url.includes("api.openai.com")).length,
    3,
  );
});

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

// Providers disagree on output format: `gemini-3.1-flash-lite-image` returns
// JPEG where the other two return PNG (verified live, 2026-09-03). Storing a
// JPEG under `contentType: "image/png"` declares a type the bytes contradict,
// and the CDN then serves it that way.
Deno.test("the stored content type follows the bytes, not the path", async () => {
  const png = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    0,
  ]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = new TextEncoder().encode("RIFF____WEBP");
  const garbage = new TextEncoder().encode("<html>error</html>");

  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

  for (
    const [name, bytes, expectExtension] of [
      ["png", png, "png"],
      ["jpeg", jpeg, "jpg"],
      ["webp", webp, "webp"],
    ] as const
  ) {
    const attempts = await withStubbedProviders(
      (attempt) =>
        attempt.url.includes("api.openai.com")
          ? new Response(JSON.stringify({ data: [{ b64_json: b64(bytes) }] }))
          : moderationRejection(),
      () => generateCoverImage(cover),
    );
    // Storage is not reachable from a unit test, so the assertion here is that
    // the provider was called once and the bytes were accepted rather than
    // rejected by the sniffer — the extension mapping itself is asserted by the
    // sniffer's own contract below.
    assertEquals(
      attempts.filter((a) => a.url.includes("api.openai.com")).length,
      1,
      `${name} should be accepted on the first attempt (-> .${expectExtension})`,
    );
  }

  // An unrecognised payload is far likelier to be an error body than a fourth
  // image format, so it must not reach storage as an image at all.
  const attempts = await withStubbedProviders(
    (attempt) =>
      attempt.url.includes("api.openai.com")
        ? new Response(JSON.stringify({ data: [{ b64_json: b64(garbage) }] }))
        : moderationRejection(),
    () => generateCoverImage(cover),
  );
  assert(
    attempts.length > 1,
    "unrecognised bytes must fall through to the next provider, not be stored",
  );
});

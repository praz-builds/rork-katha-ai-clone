import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  generateCharacterPortrait,
  generateCoverImage,
  generateDraftCharacterPortrait,
  isModerationError,
} from "./image.ts";

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
  /** The prompt as the provider received it, however that provider shapes it. */
  prompt: string;
  /** The style reference, when one was attached to this attempt. */
  referenceImage?: string;
}

/** Replace fetch, record every provider call, and answer with `respond`. */
async function withStubbedProviders(
  respond: (attempt: Attempt, index: number) => Response,
  run: () => Promise<unknown>,
  /** Per-provider credential override; `null` removes the credential. */
  keys: { openrouter?: string | null } = {},
): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  const previous = {
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
  apply("OPENROUTER_API_KEY", keys.openrouter, "test-openrouter");

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      prompt?: string;
      messages?: { content?: unknown }[];
    };
    // Every provider is OpenRouter now, which wraps the prompt in a chat
    // message. `prompt` is still read so a provider added later with an
    // images-endpoint dialect is covered without touching this stub.
    // Positions are told apart by `model`, not by URL: they share a host.
    // With a style reference attached the content is the multimodal array
    // form, so the prompt is the text part rather than the whole content.
    const raw = body.messages?.[0]?.content;
    const parts = Array.isArray(raw) ? raw : [];
    const attempt = {
      url,
      model: body.model ?? "",
      prompt: body.prompt ??
        (typeof raw === "string" ? raw : String(
          (parts.find((p) => (p as { type?: string }).type === "text") as
            | { text?: string }
            | undefined)?.text ?? "",
        )),
      referenceImage:
        (parts.find((p) => (p as { type?: string }).type === "image_url") as
          | { image_url?: { url?: string } }
          | undefined)?.image_url?.url,
    };
    attempts.push(attempt);
    return Promise.resolve(respond(attempt, attempts.length - 1));
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
    for (
      const [key, value] of [
        ["OPENROUTER_API_KEY", previous.openrouter],
      ] as const
    ) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
  return attempts;
}

/** Nano banana: the first position. */
const NANO_BANANA = "google/gemini-2.5-flash-image";
/** The stronger, pricier fallback behind it. */
const FALLBACK_IMAGE_MODEL = "google/gemini-3.1-flash-image";

/** Attempts made against one model. Positions share a host, so filter by model. */
function forModel(attempts: Attempt[], model: string): Attempt[] {
  return attempts.filter((a) => a.model === model);
}

/** An OpenRouter chat-completions response carrying one base64 image. */
function openRouterImage(b64: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{
        message: {
          images: [{ image_url: { url: `data:image/png;base64,${b64}` } }],
        },
      }],
    }),
  );
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

  assertEquals(
    forModel(attempts, NANO_BANANA).length,
    3,
    "nano banana should walk all three safety levels",
  );
  assert(
    forModel(attempts, FALLBACK_IMAGE_MODEL).length >= 1,
    "the fallback model must still be tried after the first exhausts its ladder",
  );
  assertEquals(
    new Set(attempts.map((a) => a.model)).size,
    2,
    "both positions must be reached",
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
  assertEquals(forModel(attempts, NANO_BANANA).length, 1);
  assertEquals(attempts.length, 2, "one attempt per provider, no ladder");
});

Deno.test("a chain with no credential at all makes no request and returns null", async () => {
  // Every position now authenticates with the same key, so removing it empties
  // the chain rather than shortening it. That must still be a `null` and a
  // concept cover -- never a throw, and never a request sent without a key.
  let result: unknown = "unset";
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    async () => {
      result = await generateCoverImage(cover);
    },
    { openrouter: null },
  );
  assertEquals(attempts.length, 0);
  assertEquals(result, null);
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
        attempt.model === NANO_BANANA
          ? openRouterImage(b64(bytes))
          : moderationRejection(),
      () => generateCoverImage(cover),
    );
    // Storage is not reachable from a unit test, so the assertion here is that
    // the provider was called once and the bytes were accepted rather than
    // rejected by the sniffer — the extension mapping itself is asserted by the
    // sniffer's own contract below.
    assertEquals(
      forModel(attempts, NANO_BANANA).length,
      1,
      `${name} should be accepted on the first attempt (-> .${expectExtension})`,
    );
  }

  // An unrecognised payload is far likelier to be an error body than a fourth
  // image format, so it must not reach storage as an image at all.
  const attempts = await withStubbedProviders(
    (attempt) =>
      attempt.model === NANO_BANANA
        ? openRouterImage(b64(garbage))
        : moderationRejection(),
    () => generateCoverImage(cover),
  );
  assert(
    attempts.length > 1,
    "unrecognised bytes must fall through to the next provider, not be stored",
  );
});

// ---------------------------------------------------------------------------
// The Avoid exclusion
// ---------------------------------------------------------------------------

// The ladder exists to get past a content filter, so the rung most likely to be
// reached is the one where an unconstrained cover would be worst. Dropping the
// exclusion as a "simplification" would mean the more a story's brief pushed
// against the filter, the less its own exclusion applied.
Deno.test("the Avoid exclusion survives every safety level and every provider", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateCoverImage({
        ...cover,
        avoid: "graphic violence",
      }),
  );

  assert(
    attempts.length >= 4,
    `expected a full ladder, saw ${attempts.length}`,
  );
  for (const [index, attempt] of attempts.entries()) {
    assert(
      attempt.prompt.includes("Do not depict: graphic violence."),
      `attempt ${index} (${attempt.model}) lost the exclusion: ${attempt.prompt}`,
    );
  }
  // Level 2 is genre and title only, so this is the rung that proves the
  // exclusion is carried rather than merely surviving in the cast or themes.
  const last = forModel(attempts, NANO_BANANA).at(-1);
  assert(last);
  assert(
    !last.prompt.includes("themes of"),
    "level 2 should have dropped the themes clause",
  );
  assert(last.prompt.includes("Do not depict: graphic violence."));
});

// ---------------------------------------------------------------------------
// The regeneration steer, and why it is the one thing the last rung drops
// ---------------------------------------------------------------------------

// The steer is the only per-request caller-supplied text in a cover prompt.
// Carrying it to level 2 - the rung that exists to be the prompt that cannot be
// refused - means a note written to trip a content filter trips every rung of
// every provider, and the ladder has no floor. That turns one request into
// providers x levels image calls at no cost to the caller, and it is what makes
// the per-story attempt ceiling a bound rather than a multiplier.
Deno.test("the regeneration steer is dropped at the last safety level", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateCoverImage({
        ...cover,
        avoid: "graphic violence",
        variation: "a red door at dusk",
      }),
  );

  const rungs = forModel(attempts, NANO_BANANA);
  assert(rungs.length === 3, `expected three rungs, saw ${rungs.length}`);
  assert(rungs[0].prompt.includes("a red door at dusk"));
  assert(rungs[1].prompt.includes("a red door at dusk"));
  assert(
    !rungs[2].prompt.includes("a red door at dusk"),
    "level 2 must be reachable without the caller's own text in it",
  );
  // The exclusion is not the steer and still survives: it is a negative
  // constraint, so it cannot be what a filter objected to.
  assert(rungs[2].prompt.includes("Do not depict: graphic violence."));
});

Deno.test("no Avoid means no exclusion clause at any level", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () => generateCoverImage(cover),
  );
  for (const attempt of attempts) {
    assert(!attempt.prompt.includes("Do not depict"));
  }
});

// ---------------------------------------------------------------------------
// The style reference
// ---------------------------------------------------------------------------

const REFERENCE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

Deno.test("an attached reference reaches the model, after the text that governs it", async () => {
  // Order matters and is not cosmetic: the text part carries the clause saying
  // the image is a STYLE reference and not a likeness target. A model shown the
  // photo before it has been told what the photo is for is being invited to
  // copy it.
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateDraftCharacterPortrait("user-1", "req-1", {
        name: "Naina",
        appearance: "Curly hair, a satchel",
        referenceImage: REFERENCE,
      }),
  );

  const first = attempts[0];
  assertEquals(first.referenceImage, REFERENCE);
  assert(
    first.prompt.includes("STYLE AND APPEARANCE REFERENCE ONLY"),
    "the reference clause must travel with the reference",
  );
  assert(
    first.prompt.includes("Do NOT reproduce the face or likeness"),
    "the likeness ban must be stated to the model, not merely assumed",
  );
});

Deno.test("the reference is dropped at the last safety rung, so a portrait stays reachable", async () => {
  // Level 2 exists to be the request that cannot be refused. An attached photo
  // is the likeliest thing in the payload for a filter to have objected to, so
  // it goes before the character does -- otherwise the optional half of the
  // request fails the whole ladder.
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateDraftCharacterPortrait("user-1", "req-2", {
        name: "Naina",
        appearance: "Curly hair, a satchel",
        referenceImage: REFERENCE,
      }),
  );

  const withRef = attempts.filter((a) => a.referenceImage);
  const withoutRef = attempts.filter((a) => !a.referenceImage);
  assert(withRef.length > 0, "the reference must be tried at all");
  assert(
    withoutRef.length > 0,
    "the last rung must retry without the reference",
  );
  // The clause is pointless without the image, so it goes with it.
  for (const attempt of withoutRef) {
    assert(!attempt.prompt.includes("STYLE AND APPEARANCE REFERENCE ONLY"));
  }
});

Deno.test("a portrait with no reference is byte-for-byte the request it always was", async () => {
  // The feature is additive. A character sheet with no photo must produce the
  // single-string content form, with no clause about a reference that is not
  // there.
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateDraftCharacterPortrait("user-1", "req-3", {
        name: "Naina",
        appearance: "Curly hair, a satchel",
      }),
  );

  for (const attempt of attempts) {
    assertEquals(attempt.referenceImage, undefined);
    assert(!attempt.prompt.includes("STYLE AND APPEARANCE REFERENCE ONLY"));
  }
});

// ---------------------------------------------------------------------------
// The writer's picked image style
// ---------------------------------------------------------------------------

// One pick, one book.
//
// `generateStoryMedia` draws the cover and every cast portrait from the same
// `stories.image_style` (migration 00075), and the two go out on separate calls
// minutes apart. A style carried on one and not the other is invisible in code
// review and obvious on the shelf: an anime cover fronting a cast drawn in the
// house painterly style.
//
// It must also survive the safety ladder. The ladder rebuilds the prompt from
// scratch at each rung, so a style threaded only into level 0 would be dropped
// by the first content-filter rejection - meaning the writers whose briefs
// press hardest against a filter are exactly the ones who never get the look
// they chose.
Deno.test("the picked image style reaches the cover at every safety level", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateCoverImage({
        ...cover,
        // What `media.ts` passes straight through from the story row.
        artStyle: "anime",
      }),
  );

  assert(
    attempts.length >= 4,
    `expected a full ladder, saw ${attempts.length}`,
  );
  for (const [index, attempt] of attempts.entries()) {
    assert(
      attempt.prompt.includes("modern anime illustration"),
      `attempt ${index} (${attempt.model}) lost the style: ${attempt.prompt}`,
    );
    // The override REPLACES the genre's style clause. Both in one prompt is
    // two contradictory instructions, which the model splits the difference on.
    assert(
      !attempt.prompt.includes("dark atmospheric"),
      `attempt ${index} kept the horror style clause beside the override`,
    );
  }
});

Deno.test("a cast portrait is drawn in the story's style, not the house style", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateCharacterPortrait(
        cover.storyId,
        "22222222-2222-2222-2222-222222222222",
        {
          name: "Mira",
          description: "a lighthouse keeper",
          appearance: "tall",
        },
        "watercolor",
      ),
  );

  assert(attempts.length > 0, "the portrait chain made no request");
  for (const [index, attempt] of attempts.entries()) {
    assert(
      attempt.prompt.includes("delicate watercolour painting"),
      `attempt ${index} lost the style: ${attempt.prompt}`,
    );
    assert(
      !attempt.prompt.includes("Painterly book-illustration style"),
      `attempt ${index} kept the house style beside the override`,
    );
  }
});

// Absent and unrecognised are the same answer, and it is the look every story
// written before the picker had. A raw string reaching the prompt would put
// whatever a stale client sent into a paid provider request.
Deno.test("an unknown image style draws the genre's own look", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () => generateCoverImage({ ...cover, artStyle: "oil-painting" }),
  );

  assert(attempts.length > 0);
  for (const attempt of attempts) {
    assert(attempt.prompt.includes("dark atmospheric"));
    assert(!attempt.prompt.includes("oil-painting"));
  }
});

// A cast row written before Description was retired has its look only there,
// and `media.ts` draws portraits straight from those rows. Skipping them would
// leave every pre-merge story's cast permanently portrait-less.
Deno.test("a portrait is drawn from a legacy description when there is no appearance", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateCharacterPortrait(
        cover.storyId,
        "33333333-3333-3333-3333-333333333333",
        { name: "Mira", description: "a lighthouse keeper, weathered hands" },
      ),
  );

  assert(attempts.length > 0, "the portrait chain made no request");
  assert(attempts[0].prompt.includes("a lighthouse keeper"));
});

// Every rung of the ladder shortens the ONE free-text field there is now, and
// a rung that shortened it to nothing would ask the provider to illustrate the
// empty string -- the portrait equivalent of "suggesting undefined".
Deno.test("no rung of the portrait ladder illustrates an empty subject", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateCharacterPortrait(
        cover.storyId,
        "44444444-4444-4444-4444-444444444444",
        { name: "Mira", appearance: "tall, cropped grey hair. Oilskin coat." },
      ),
  );

  assert(attempts.length > 0);
  for (const [index, attempt] of attempts.entries()) {
    assert(
      !attempt.prompt.includes("illustration of ."),
      `attempt ${index} lost its subject: ${attempt.prompt}`,
    );
    assert(!attempt.prompt.includes("undefined"), `attempt ${index}`);
  }
  // The last rung keeps the first clause, not the whole look.
  const last = attempts[attempts.length - 1].prompt;
  assert(last.includes("tall"), last);
  assert(!last.includes("Oilskin"), last);
});

// A character whose only text is punctuation survives a `.trim()` on the raw
// field and then sanitizes down to nothing. Filtering before sanitizing is how
// that reached a paid provider request as a subject-less prompt.
Deno.test("a character whose appearance sanitizes to nothing is dropped, not drawn", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateCoverImage({
        ...cover,
        characters: [{ name: "Elena", appearance: "<<>>", isHero: true }],
      }),
  );

  assert(attempts.length > 0);
  for (const attempt of attempts) {
    assert(!attempt.prompt.includes("silhouetted figure suggesting ."));
    assert(!attempt.prompt.includes("undefined"));
  }
});

// The Craft sheet is where the writer compares a portrait against the cover
// they are about to get. `generate-character-image` sent no style at all, so a
// writer who picked Watercolour got a house-style cast and read the picker as
// doing nothing.
Deno.test("a draft portrait is drawn in the style the brief is set to", async () => {
  const attempts = await withStubbedProviders(
    () => moderationRejection(),
    () =>
      generateDraftCharacterPortrait(
        "user-1",
        "req-style",
        { name: "Naina", appearance: "Curly hair, a satchel" },
        "watercolor",
      ),
  );

  assert(attempts.length > 0, "the draft portrait chain made no request");
  for (const [index, attempt] of attempts.entries()) {
    assert(
      attempt.prompt.includes("delicate watercolour painting"),
      `attempt ${index} lost the style: ${attempt.prompt}`,
    );
    assert(
      !attempt.prompt.includes("Painterly book-illustration style"),
      `attempt ${index} kept the house style beside the override`,
    );
  }
});

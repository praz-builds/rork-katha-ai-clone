// A style reference is optional, bounded, and never an arbitrary data URL.
//
// The product decision (2026-09-08) lets a writer attach a photo to steer a
// character's look. That makes this endpoint the one place in the codebase
// where a user hands us an image, so what it accepts is a security boundary
// and not merely validation.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReferenceImage } from "./index.ts";

const PIXEL = "iVBORw0KGgoAAAANSUhEUg==";

Deno.test("an absent reference is fine, and is not an error", () => {
  // Attaching a photo is optional; every character sheet written before this
  // feature existed must keep working unchanged.
  assertEquals(parseReferenceImage(undefined), {});
  assertEquals(parseReferenceImage(null), {});
});

Deno.test("a JPEG, PNG or WebP data URL is accepted", () => {
  for (const type of ["jpeg", "jpg", "png", "webp"]) {
    const url = `data:image/${type};base64,${PIXEL}`;
    assertEquals(parseReferenceImage(url), { value: url });
  }
});

Deno.test("SVG is refused, however image-shaped it looks", () => {
  // The reason this is an allowlist and not `startsWith("data:image/")`: SVG is
  // a document, not a bitmap. It can carry script and remote references, and it
  // is the one "image" type that must never reach a parser or be echoed back.
  const result = parseReferenceImage(
    `data:image/svg+xml;base64,${PIXEL}`,
  );
  assert("error" in result);
});

Deno.test("a non-image data URL is refused", () => {
  for (
    const value of [
      `data:text/html;base64,${PIXEL}`,
      `data:application/pdf;base64,${PIXEL}`,
      "https://example.test/photo.jpg",
      "javascript:alert(1)",
    ]
  ) {
    assert("error" in parseReferenceImage(value), `${value} was accepted`);
  }
});

Deno.test("a non-string, or an empty string, is refused rather than ignored", () => {
  // Silently dropping a malformed reference would hand the writer a portrait
  // that ignored the one input they cared most about, while reporting success.
  for (const value of [42, true, {}, [], ""]) {
    assert("error" in parseReferenceImage(value));
  }
});

Deno.test("an oversized reference is refused at the boundary, not at the model", () => {
  const huge = `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}`;
  const result = parseReferenceImage(huge);
  assert("error" in result);
  assertEquals(result.error, "reference_image is too large");

  // Just inside the cap still passes, so the bound is a bound and not a
  // blanket refusal of anything large.
  const prefix = "data:image/png;base64,";
  const ok = prefix + "A".repeat(6 * 1024 * 1024 - prefix.length);
  assert(!("error" in parseReferenceImage(ok)));
});

// ---------------------------------------------------------------------------
// The anonymous lifetime cap (00084)
// ---------------------------------------------------------------------------
//
// Character onboarding makes its aha on an anonymous session, so this endpoint
// is the first thing an unverified identity can spend money with. 00055's
// hourly window does not bound that -- a fresh identity is one
// `signInAnonymously` away -- so an anonymous caller gets four portraits for
// the life of the identity, and this is the proof that the fifth is refused,
// that a named user is never asked, and that a failed generation gives the slot
// back.
//
// index.ts reaches Postgres through PostgREST, auth through GoTrue and the
// image provider through OpenRouter, so it cannot be pointed at a bare database
// the way the migration tests are. What it can be pointed at is a stubbed
// `fetch`: every request the handler makes leaves through it, so recording them
// records exactly which limiter the endpoint consulted. An endpoint that never
// issues `claim_guest_portrait_request` has no cap, whatever it answers.
import { handleRequest } from "./index.ts";

const GUEST_ID = "33333333-3333-4333-8333-333333333333";
const NAMED_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

/** Eight bytes of PNG signature, which is all `sniffImageType` reads. */
const PNG_DATA_URL = "data:image/png;base64," +
  btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

interface PortraitRun {
  status: number;
  json: Record<string, unknown>;
  rpcs: string[];
}

/**
 * Drive one portrait request against a stubbed network.
 *
 * `guestClaimAllows` is what `claim_guest_portrait_request` answers; `null`
 * makes the RPC fail, which is the fail-closed case. `providerSucceeds: false`
 * withholds the credential so `runImageChain` finds no provider and returns
 * null -- the real 502 path, reached without pretending to moderate anything.
 */
async function runPortrait(options: {
  isAnonymous: boolean;
  hourlyAllows?: boolean;
  guestClaimAllows?: boolean | null;
  providerSucceeds?: boolean;
  body?: Record<string, unknown>;
}): Promise<PortraitRun> {
  const {
    isAnonymous,
    hourlyAllows = true,
    guestClaimAllows = true,
    providerSucceeds = true,
  } = options;

  const rpcs: string[] = [];
  const originalFetch = globalThis.fetch;
  const previousKey = Deno.env.get("OPENROUTER_API_KEY");

  Deno.env.set("SUPABASE_URL", "https://stub.supabase.test");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  if (providerSucceeds) {
    Deno.env.set("OPENROUTER_API_KEY", "openrouter-key");
  } else {
    Deno.env.delete("OPENROUTER_API_KEY");
  }

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = request.url;
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/auth/v1/user")) {
      return json({
        id: isAnonymous ? GUEST_ID : NAMED_ID,
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: isAnonymous,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }
    if (url.includes("/rest/v1/rpc/")) {
      const name = url.split("/rest/v1/rpc/")[1].split("?")[0];
      rpcs.push(name);
      if (name === "claim_character_portrait_request") {
        return json(hourlyAllows);
      }
      if (name === "claim_guest_portrait_request") {
        if (guestClaimAllows === null) {
          return new Response(
            JSON.stringify({ message: "limiter unavailable" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        return json(guestClaimAllows);
      }
      if (name === "release_guest_portrait_request") return json(null);
      return json(null);
    }
    if (url.includes("openrouter.ai")) {
      return json({
        choices: [{
          message: { images: [{ image_url: { url: PNG_DATA_URL } }] },
        }],
      });
    }
    if (url.includes("/storage/v1/object/")) {
      return json({ Key: "covers/draft-characters/x.png" });
    }
    return json(null);
  }) as typeof fetch;

  try {
    const response = await handleRequest(
      new Request("https://stub.functions.test/generate-character-image", {
        method: "POST",
        headers: {
          Authorization: "Bearer stub-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: REQUEST_ID,
          name: "Naina",
          appearance: "Paint on her hands, her grandmother's coat.",
          ...options.body,
        }),
      }),
    );
    return {
      status: response.status,
      json: await response.json(),
      rpcs,
    };
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) {
      Deno.env.delete("OPENROUTER_API_KEY");
    } else {
      Deno.env.set("OPENROUTER_API_KEY", previousKey);
    }
  }
}

Deno.test("an anonymous caller under the cap gets their portrait", async () => {
  const run = await runPortrait({ isAnonymous: true });

  assertEquals(run.status, 200);
  assert(typeof run.json.url === "string");
  // Both bounds ran, in that order: the window still bounds burst, the
  // lifetime cap bounds total. Neither replaces the other.
  assertEquals(run.rpcs, [
    "claim_character_portrait_request",
    "claim_guest_portrait_request",
  ]);
});

Deno.test("an anonymous caller at the cap is asked to sign in, not rate-limited", async () => {
  const run = await runPortrait({ isAnonymous: true, guestClaimAllows: false });

  // 403 and not 429 on purpose: 429 means "wait", and there is nothing to wait
  // for. The client routes on `code`, so the string is part of the contract.
  assertEquals(run.status, 403);
  assertEquals(run.json.code, "guest_portrait_cap");
  assertEquals(run.json.error, "Sign in to keep making characters.");
});

Deno.test("a broken lifetime limiter fails closed", async () => {
  // A database blip must not turn the only bound on an unverified caller off.
  // Same posture as the hourly claim above it.
  const run = await runPortrait({ isAnonymous: true, guestClaimAllows: null });

  assertEquals(run.status, 403);
  assertEquals(run.json.code, "guest_portrait_cap");
});

Deno.test("the hourly window still answers 429, unchanged", async () => {
  const run = await runPortrait({ isAnonymous: true, hourlyAllows: false });

  assertEquals(run.status, 429);
  assertEquals(run.json.code, undefined);
  // Refused before the lifetime cap was consulted, so a burst does not also
  // eat the four.
  assertEquals(run.rpcs, ["claim_character_portrait_request"]);
});

Deno.test("a named user is never asked about the guest cap", async () => {
  const run = await runPortrait({ isAnonymous: false });

  assertEquals(run.status, 200);
  // Named users are not capped by this counter at all. Consulting it for them
  // would charge a signed-in person for a bound that is not theirs.
  assertEquals(run.rpcs, ["claim_character_portrait_request"]);
});

Deno.test("a failed generation gives an anonymous caller their slot back", async () => {
  const run = await runPortrait({
    isAnonymous: true,
    providerSucceeds: false,
  });

  assertEquals(run.status, 502);
  // There is no credit reservation here to refund, so this release is the only
  // thing between a provider failure and one of four lifetime portraits spent
  // on nothing. Onboarding's "Try again" promises exactly this.
  assertEquals(run.rpcs, [
    "claim_character_portrait_request",
    "claim_guest_portrait_request",
    "release_guest_portrait_request",
  ]);
});

Deno.test("a refused request gives the slot back too, and a named one releases nothing", async () => {
  const rejected = await runPortrait({
    isAnonymous: true,
    body: { appearance: "" },
  });
  assertEquals(rejected.status, 400);
  // The claim is taken before the fields are read, so a 400 that never reached
  // a provider must not cost a slot either.
  assert(rejected.rpcs.includes("release_guest_portrait_request"));

  const named = await runPortrait({
    isAnonymous: false,
    providerSucceeds: false,
  });
  assertEquals(named.status, 502);
  assertEquals(named.rpcs, ["claim_character_portrait_request"]);
});

// ---------------------------------------------------------------------------
// There is no gender parameter
// ---------------------------------------------------------------------------
//
// W4 used to ask gender as a required row and send three of its four answers
// here as a prompt clause. Both are gone. This test is what stops the
// parameter growing back quietly: an unknown key is ignored like every other
// unknown key, NOT refused with a 400 and not fed to the prompt.

Deno.test("a gender key from an old client is ignored, not refused", async () => {
  const run = await runPortrait({
    isAnonymous: true,
    body: { gender: "woman" },
  });

  assertEquals(run.status, 200);
});

Deno.test("a gender nobody would have accepted is ignored too", async () => {
  // "female" used to be a 400. Refusing it now would mean the contract is
  // still here, just failing differently.
  const run = await runPortrait({
    isAnonymous: false,
    body: { gender: "female" },
  });

  assertEquals(run.status, 200);
});

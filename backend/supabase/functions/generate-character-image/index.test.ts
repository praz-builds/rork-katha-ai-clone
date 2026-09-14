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
// The lifetime allowance and the credit past it (00088)
// ---------------------------------------------------------------------------
//
// Character onboarding makes its aha on an anonymous session, so this endpoint
// is the first thing an unverified identity can spend money with -- and until
// 00088 a NAMED user could spend it twelve times an hour, forever, free.
// 00055's hourly window bounds neither: a fresh identity is one
// `signInAnonymously` away, and a window that resets is not a total.
//
// So every caller now gets six character images for their lifetime and pays a
// credit each after that, and this is the proof that the endpoint actually
// consults that ledger, that a caller who cannot pay is refused rather than
// drawn for, and that anything which fails to deliver settles the reservation
// instead of keeping it.
//
// index.ts reaches Postgres through PostgREST, auth through GoTrue and the
// image provider through OpenRouter, so it cannot be pointed at a bare database
// the way the migration tests are. What it can be pointed at is a stubbed
// `fetch`: every request the handler makes leaves through it, so recording them
// records exactly which limiter the endpoint consulted. An endpoint that never
// issues `claim_character_image_request` has no cap and no price, whatever it
// answers. The arithmetic of the six itself is exercised against real SQL in
// `supabase/migrations/00088_character_image_lifetime_credits_test.ts`.
import { handleRequest } from "./index.ts";

const GUEST_ID = "33333333-3333-4333-8333-333333333333";
const NAMED_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const OPERATION_ID = "66666666-6666-4666-8666-666666666666";

/** Eight bytes of PNG signature, which is all `sniffImageType` reads. */
const PNG_DATA_URL = "data:image/png;base64," +
  btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

interface PortraitRun {
  status: number;
  json: Record<string, unknown>;
  rpcs: string[];
}

/**
 * What `claim_character_image_request` answers.
 *
 * `credits` is what the reservation charged: 0 for one of the six, 1 past them.
 * `errorCode` stands in for the PostgREST error the RPC raises -- 'KTH02' is
 * an empty balance, and an unrecognised one is the fail-closed case.
 */
type ClaimStub = {
  credits?: number;
  freeRemaining?: number;
  status?: string;
  replayed?: boolean;
  errorCode?: string;
};

/**
 * Drive one portrait request against a stubbed network.
 *
 * `providerSucceeds: false` withholds the credential so `runImageChain` finds
 * no provider and returns null -- the real 502 path, reached without pretending
 * to moderate anything.
 */
async function runPortrait(options: {
  isAnonymous: boolean;
  hourlyAllows?: boolean;
  claim?: ClaimStub;
  providerSucceeds?: boolean;
  body?: Record<string, unknown>;
}): Promise<PortraitRun> {
  const {
    isAnonymous,
    hourlyAllows = true,
    claim = {},
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
      if (name === "claim_character_image_request") {
        if (claim.errorCode) {
          return new Response(
            JSON.stringify({
              code: claim.errorCode,
              message: "claim refused",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        return json({
          operation_id: OPERATION_ID,
          status: claim.status ?? "reserved",
          credits: claim.credits ?? 0,
          replayed: claim.replayed ?? false,
          free_remaining: claim.freeRemaining ?? 5,
          balance: 3,
        });
      }
      if (
        name === "release_character_image_request" ||
        name === "complete_character_image_request"
      ) {
        return json(null);
      }
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

Deno.test("a caller with a free image left gets their portrait", async () => {
  const run = await runPortrait({ isAnonymous: true });

  assertEquals(run.status, 200);
  assert(typeof run.json.url === "string");
  // Both bounds ran, in that order, and the reservation was then settled: the
  // window bounds burst, the ledger bounds total, and a delivered image spends
  // its request id so a replay cannot draw a second one for the same charge.
  assertEquals(run.rpcs, [
    "claim_character_portrait_request",
    "claim_character_image_request",
    "complete_character_image_request",
  ]);
  // The price of the NEXT one comes from the server, not from the client's own
  // arithmetic over a number it guessed.
  assertEquals(run.json.credits_charged, 0);
  assertEquals(run.json.free_remaining, 5);
});

Deno.test("a named caller past the six is charged, and told so", async () => {
  const run = await runPortrait({
    isAnonymous: false,
    claim: { credits: 1, freeRemaining: 0 },
  });

  assertEquals(run.status, 200);
  assertEquals(run.json.credits_charged, 1);
  assertEquals(run.json.free_remaining, 0);
  // The ledger is consulted for a named user too. Before 00088 this branch did
  // not exist: a signed-in caller was charged nothing and counted nothing.
  assert(run.rpcs.includes("claim_character_image_request"));
});

Deno.test("a named caller who cannot pay is refused, not drawn for", async () => {
  const run = await runPortrait({
    isAnonymous: false,
    claim: { errorCode: "KTH02" },
  });

  assertEquals(run.status, 402);
  assertEquals(run.json.code, "insufficient_credits");
  // Nothing was reserved, so there is nothing to settle -- and crucially the
  // provider was never called.
  assertEquals(run.rpcs, [
    "claim_character_portrait_request",
    "claim_character_image_request",
  ]);
});

Deno.test("an anonymous caller who cannot pay is asked to sign in, not to buy", async () => {
  const run = await runPortrait({
    isAnonymous: true,
    claim: { errorCode: "KTH02" },
  });

  // 403 and not 429 on purpose: 429 means "wait", and there is nothing to wait
  // for. Not 402 either: buying credits needs an account, so the honest ask of
  // an anonymous caller is the account. The client routes on `code`, so the
  // string is part of the contract.
  assertEquals(run.status, 403);
  assertEquals(run.json.code, "guest_portrait_cap");
  assertEquals(run.json.error, "Sign in to keep making characters.");
});

Deno.test("a broken ledger fails closed", async () => {
  // A database blip must not turn the only bound on this endpoint off, and it
  // must not hand out a free paid provider call either. Same posture as the
  // hourly claim above it.
  const run = await runPortrait({
    isAnonymous: false,
    claim: { errorCode: "PGRST999" },
  });

  assertEquals(run.status, 503);
  assertEquals(run.json.code, "claim_unavailable");
  assertEquals(run.rpcs, [
    "claim_character_portrait_request",
    "claim_character_image_request",
  ]);
});

Deno.test("a spent request id is refused rather than drawn a second time", async () => {
  const run = await runPortrait({
    isAnonymous: false,
    claim: { replayed: true, status: "completed", credits: 1 },
  });

  assertEquals(run.status, 409);
  assertEquals(run.json.code, "request_id_spent");
  // Not settled: the reservation was completed, and releasing it would refund a
  // credit for an image that was delivered.
  assert(!run.rpcs.includes("release_character_image_request"));
});

Deno.test("a re-delivered request that is still reserved is not refused", async () => {
  // The same tap arriving twice. The claim replays it and charges nothing, so
  // the handler must carry on and draw rather than answering 409 -- the first
  // delivery may never have reached the client.
  const run = await runPortrait({
    isAnonymous: false,
    claim: { replayed: true, status: "reserved", credits: 1 },
  });

  assertEquals(run.status, 200);
  assertEquals(run.json.credits_charged, 1);
});

Deno.test("the hourly window still answers 429, unchanged", async () => {
  const run = await runPortrait({ isAnonymous: true, hourlyAllows: false });

  assertEquals(run.status, 429);
  assertEquals(run.json.code, undefined);
  // Refused before the ledger was consulted, so a burst does not also eat one
  // of the six or a credit.
  assertEquals(run.rpcs, ["claim_character_portrait_request"]);
});

Deno.test("a failed generation settles the reservation", async () => {
  const run = await runPortrait({
    isAnonymous: true,
    providerSucceeds: false,
  });

  assertEquals(run.status, 502);
  // This release is the only thing between a provider failure and one of six
  // lifetime images -- or a credit -- spent on nothing. Onboarding's "Try
  // again" promises exactly this.
  assertEquals(run.rpcs, [
    "claim_character_portrait_request",
    "claim_character_image_request",
    "release_character_image_request",
  ]);
  assert(!run.rpcs.includes("complete_character_image_request"));
});

Deno.test("a refused request gives the reservation back too", async () => {
  const rejected = await runPortrait({
    isAnonymous: false,
    body: { appearance: "" },
  });
  assertEquals(rejected.status, 400);
  // The reservation is taken before the fields are read, so a 400 that never
  // reached a provider must not cost anything either.
  assert(rejected.rpcs.includes("release_character_image_request"));

  const named = await runPortrait({
    isAnonymous: false,
    providerSucceeds: false,
    claim: { credits: 1, freeRemaining: 0 },
  });
  assertEquals(named.status, 502);
  // A charged failure releases exactly like a free one; the RPC decides which
  // of the two it gives back.
  assert(named.rpcs.includes("release_character_image_request"));
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

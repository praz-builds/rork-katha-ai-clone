/**
 * The price of a cover regeneration, and what a failed one costs.
 *
 * Three things here are money, not UI, and none of them can be checked by a
 * type:
 *
 *   1. The first regeneration is free and the second is not. That transition is
 *      the whole of `CREDITS_AND_PRICING.md`'s "0 — 1 free retry", and the
 *      failure mode is silent in both directions: charge too early and the
 *      free retry the pricing page promises does not exist, charge too late and
 *      covers are unlimited.
 *   2. A regeneration that never produced an image refunds its credit and does
 *      not consume the free retry, per principle 4.
 *   3. Somebody else's story is not regenerable at any price.
 *
 * The client is a stub rather than a live project because the interesting cases
 * are the ones a live project will not produce on demand: a provider that
 * refuses, a refund that fails, a claim that loses a race.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildVariationSteer,
  type CoverRegenerationClient,
  describePreviousCover,
  MAX_COVER_NOTE_LENGTH,
  regenerateCover,
} from "./cover-regeneration.ts";
import { buildCoverPrompt, MAX_COVER_STEER_LENGTH } from "./cover-prompts.ts";
import type { ImageResult } from "./image.ts";

type RpcCall = { fn: string; args: Record<string, unknown> };
type StatusWrite = { table: string; values: Record<string, unknown> };

interface StubOptions {
  claim?: Record<string, unknown>;
  claimError?: unknown;
  reserveError?: unknown;
  /** A transport-level rejection, as opposed to an `{ error }` result. */
  reserveThrows?: unknown;
  reserveData?: Record<string, unknown> | null;
  refundError?: unknown;
  finishError?: unknown;
  finishData?: Record<string, unknown>;
}

function stubClient(options: StubOptions = {}) {
  const rpcCalls: RpcCall[] = [];
  const statusWrites: StatusWrite[] = [];

  const client: CoverRegenerationClient = {
    rpc(fn, args) {
      rpcCalls.push({ fn, args });
      if (fn === "claim_cover_regeneration") {
        if (options.claimError) {
          return Promise.resolve({ data: null, error: options.claimError });
        }
        return Promise.resolve({
          data: options.claim ?? {
            claimed: true,
            previous_cover_status: "ready",
            regen_count: 0,
            requires_credit: false,
            title: "The Quiet Door",
            primary_genre: "mystery",
            themes: ["doors"],
            where_and_when: "A hill town, off-season",
            avoid: "graphic violence",
            cover_prompt: null,
          },
          error: null,
        });
      }
      if (fn === "reserve_generation_operation") {
        if (options.reserveThrows) {
          return Promise.reject(options.reserveThrows);
        }
        if (options.reserveError) {
          return Promise.resolve({ data: null, error: options.reserveError });
        }
        return Promise.resolve({
          data: options.reserveData === null ? {} : options.reserveData ??
            { id: "operation-1", status: "reserved", replayed: false },
          error: null,
        });
      }
      if (fn === "refund_generation_operation") {
        return Promise.resolve({
          data: { refunded: true },
          error: options.refundError ?? null,
        });
      }
      if (fn === "finish_cover_regeneration") {
        if (options.finishError) {
          return Promise.resolve({ data: null, error: options.finishError });
        }
        return Promise.resolve({
          data: options.finishData ?? { cover_regen_count: 1 },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      return {
        update(values: Record<string, unknown>) {
          statusWrites.push({ table, values });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };

  return { client, rpcCalls, statusWrites };
}

function imageResult(overrides: Partial<ImageResult> = {}): ImageResult {
  return {
    url: "https://cdn.test/covers/story-1/cover-r1.png",
    storagePath: "covers/story-1/cover-r1.png",
    provider: "openai",
    model: "gpt-image-1",
    prompt: "Book cover illustration for a mystery story.",
    ...overrides,
  };
}

const BASE = { storyId: "story-1", userId: "user-1", requestId: "req-1" };

function rpcNames(calls: RpcCall[]): string[] {
  return calls.map((call) => call.fn);
}

/**
 * The release of a claimed row.
 *
 * One RPC rather than a `stories` update, because restoring the status and
 * giving the attempt back have to happen together - see `release_cover_claim`
 * in migration 00044.
 */
function releaseCall(calls: RpcCall[]): Record<string, unknown> | undefined {
  return calls.find((call) => call.fn === "release_cover_claim")?.args;
}

Deno.test("the first regeneration is free and reserves no credit", async () => {
  const { client, rpcCalls } = stubClient();
  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(imageResult()),
  });

  assert(result.ok);
  assertEquals(result.charged, false);
  assertEquals(result.coverRegenCount, 1);
  assertEquals(
    rpcNames(rpcCalls),
    ["claim_cover_regeneration", "finish_cover_regeneration"],
    "the free retry must not touch the credit ledger at all",
  );
});

Deno.test("the second regeneration costs one credit", async () => {
  const { client, rpcCalls } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 1,
      requires_credit: true,
      title: "The Quiet Door",
      primary_genre: "mystery",
      themes: [],
      cover_prompt: null,
    },
    finishData: { cover_regen_count: 2 },
  });

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(imageResult()),
  });

  assert(result.ok);
  assertEquals(result.charged, true);
  assertEquals(result.coverRegenCount, 2);

  const reserve = rpcCalls.find((c) => c.fn === "reserve_generation_operation");
  assert(reserve, "a paid regeneration must reserve an operation");
  // kind and chapter number are the contract migration 00027 documents: chapter
  // 1's art is the cover, so the reservation is chapter 1's.
  assertEquals(reserve.args.p_kind, "cover");
  assertEquals(reserve.args.p_chapter_number, 1);
  assertEquals(reserve.args.p_request_id, "req-1");

  // The reservation is settled by the same statement that moves the counter.
  // Left 'reserved' it holds the partial unique index and the *next*
  // regeneration comes back KTH01 forever.
  const finish = rpcCalls.find((c) => c.fn === "finish_cover_regeneration");
  assertEquals(finish?.args.p_operation_id, "operation-1");
});

Deno.test("a story the caller does not own is not regenerable", async () => {
  const { client, rpcCalls } = stubClient({
    claim: { claimed: false, reason: "not_owner" },
  });
  let generated = false;

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => {
      generated = true;
      return Promise.resolve(imageResult());
    },
  });

  assert(!result.ok);
  // 404 rather than 403: the distinction is an enumeration oracle over the
  // whole stories table and no legitimate caller needs it.
  assertEquals(result.status, 404);
  assertEquals(result.code, "not_owner");
  assertEquals(rpcNames(rpcCalls), ["claim_cover_regeneration"]);
  assertEquals(
    generated,
    false,
    "a rejected claim must never reach a provider",
  );
});

Deno.test("a cover already in flight is refused rather than raced", async () => {
  const { client } = stubClient({
    claim: { claimed: false, reason: "in_flight" },
  });
  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(imageResult()),
  });
  assert(!result.ok);
  assertEquals(result.status, 409);
  assertEquals(result.code, "in_flight");
});

Deno.test("a paid regeneration that produces no image is refunded", async () => {
  const { client, rpcCalls, statusWrites } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 1,
      requires_credit: true,
      title: "The Quiet Door",
      primary_genre: "mystery",
      themes: [],
    },
  });

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(null),
  });

  assert(!result.ok);
  assertEquals(result.status, 502);
  assertEquals(result.code, "generation_failed");
  assertStringIncludes(result.error, "refunded");

  const refund = rpcCalls.find((c) => c.fn === "refund_generation_operation");
  assert(refund, "a paid regeneration that failed must refund itself");
  assertEquals(refund.args.p_operation_id, "operation-1");

  // The story kept the cover it already had, so the row has to say 'ready'
  // again. Writing 'failed' here would report an existing cover as missing.
  const release = releaseCall(rpcCalls);
  assert(release, "a failed regeneration must release the row it claimed");
  assertEquals(release.p_previous_status, "ready");
  // The provider was reached and refused, so the attempt was real spend and
  // stays counted against the ceiling.
  assertEquals(release.p_refund_attempt, false);
  assertEquals(statusWrites.length, 0);

  // And nothing recorded a delivery, so the counter did not move.
  assertEquals(
    rpcCalls.some((c) => c.fn === "finish_cover_regeneration"),
    false,
  );
});

Deno.test("a failed free retry stays free", async () => {
  const { client, rpcCalls } = stubClient();
  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(null),
  });

  assert(!result.ok);
  assertEquals(result.status, 502);
  // Nothing to refund, and — because the counter only moves on delivery — the
  // free retry the user was promised is still unspent.
  assertEquals(
    rpcCalls.some((c) => c.fn === "refund_generation_operation"),
    false,
  );
  assertEquals(
    rpcCalls.some((c) => c.fn === "finish_cover_regeneration"),
    false,
  );
});

Deno.test("a provider that throws is refunded, not propagated", async () => {
  const { client, rpcCalls } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 2,
      requires_credit: true,
      title: "T",
      primary_genre: "mystery",
      themes: [],
    },
  });

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.reject(new Error("provider exploded")),
  });

  assert(!result.ok);
  assertEquals(result.status, 502);
  assert(rpcCalls.some((c) => c.fn === "refund_generation_operation"));
});

Deno.test("a refund that itself fails is reported as outstanding", async () => {
  const { client } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 1,
      requires_credit: true,
      title: "T",
      primary_genre: "mystery",
      themes: [],
    },
    refundError: { message: "ledger unavailable" },
  });

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(null),
  });

  assert(!result.ok);
  // 503 and an operation id, because this one needs finding again rather than
  // simply retrying.
  assertEquals(result.status, 503);
  assertEquals(result.code, "refund_pending");
  assertEquals(result.operationId, "operation-1");
});

Deno.test("insufficient credits refuses before any provider call", async () => {
  const { client, rpcCalls } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 1,
      requires_credit: true,
      title: "T",
      primary_genre: "mystery",
      themes: [],
    },
    reserveError: { code: "KTH02", message: "Insufficient credits" },
  });
  let generated = false;

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => {
      generated = true;
      return Promise.resolve(imageResult());
    },
  });

  assert(!result.ok);
  assertEquals(result.status, 402);
  assertEquals(generated, false);
  // The claim it took has to be released, or the story sits on 'generating'
  // and the writer cannot even try again.
  const release = releaseCall(rpcCalls);
  assert(release);
  assertEquals(release.p_previous_status, "ready");
  // And the attempt has to be given back. This path called no provider and
  // cost nothing, so charging it against a ceiling that never resets would let
  // a writer with an empty balance burn all twelve on refusals and stay 429'd
  // on that story after buying credits.
  assertEquals(release.p_refund_attempt, true);
});

Deno.test("a spent request id is refused rather than replayed into a second cover", async () => {
  const { client } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 1,
      requires_credit: true,
      title: "T",
      primary_genre: "mystery",
      themes: [],
    },
    reserveData: { id: "operation-1", status: "completed", replayed: true },
  });

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(imageResult()),
  });

  assert(!result.ok);
  assertEquals(result.status, 409);
  assertEquals(result.code, "request_id_spent");
});

Deno.test("the regenerated cover is generated from a different prompt", async () => {
  const previous = buildCoverPrompt(
    "mystery",
    "The Quiet Door",
    ["doors"],
    undefined,
    "A hill town, off-season",
    "graphic violence",
  );
  const { client } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 0,
      requires_credit: false,
      title: "The Quiet Door",
      primary_genre: "mystery",
      themes: ["doors"],
      where_and_when: "A hill town, off-season",
      avoid: "graphic violence",
      cover_prompt: previous,
    },
  });

  let seen: Record<string, unknown> | null = null;
  await regenerateCover({
    client,
    ...BASE,
    promptNote: "A door ajar at dusk",
    generate: (input) => {
      seen = input as unknown as Record<string, unknown>;
      return Promise.resolve(imageResult());
    },
  });

  const request = seen as unknown as {
    variation?: string;
    avoid?: string;
    storageSuffix?: string;
  };
  assert(request.variation);
  assertStringIncludes(request.variation, "A door ajar at dusk");
  assertStringIncludes(request.variation, "clearly different");
  // HEAD threaded `avoid` into the cover. A regeneration is still a cover.
  assertEquals(request.avoid, "graphic violence");
  // A new storage key, or the CDN serves the picture the writer just replaced.
  assertEquals(request.storageSuffix, "r1");

  // And the steer actually changes the prompt the provider receives.
  const next = buildCoverPrompt(
    "mystery",
    "The Quiet Door",
    ["doors"],
    undefined,
    "A hill town, off-season",
    "graphic violence",
    request.variation,
  );
  assert(next !== previous, "a regeneration must not re-send the same prompt");
  assertStringIncludes(next, "A door ajar at dusk");
});

Deno.test("the previous cover's subject is recovered, and its boilerplate is not", () => {
  const previous = buildCoverPrompt(
    "mystery",
    "The Quiet Door",
    ["doors", "grief"],
    undefined,
    "A hill town, off-season",
    "graphic violence",
  );
  const described = describePreviousCover(previous);
  assert(described);
  assertStringIncludes(described, "The Quiet Door");
  assertStringIncludes(described, "hill town");
  // The parts that are identical in the next prompt say nothing and are dropped.
  assertEquals(described.includes("Color palette"), false);
  assertEquals(described.includes("NO watermarks"), false);
});

Deno.test("an unrecognisable stored prompt degrades to a generic steer", () => {
  assertEquals(describePreviousCover("something hand-written"), undefined);
  assertEquals(describePreviousCover(undefined), undefined);
  const steer = buildVariationSteer(undefined, undefined);
  assert(steer);
  assertStringIncludes(steer, "clearly different");
});

// ---------------------------------------------------------------------------
// The spend bound
// ---------------------------------------------------------------------------
//
// The free retry is the hole these guard. Pricing counts *deliveries*, so an
// attempt that produces no image costs nothing and leaves the next one free -
// and the caller decides whether an attempt produces an image, because
// `prompt_note` is free text that reaches the provider. Without a bound on
// attempts, "regenerate, fail, repeat" is an unmetered image budget on our own
// API keys, and there is no rate limiting in front of any Edge Function.

Deno.test("a story past its attempt ceiling is refused before any spend", async () => {
  const { client, rpcCalls } = stubClient({
    claim: { claimed: false, reason: "attempt_limit" },
  });
  let generated = false;

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => {
      generated = true;
      return Promise.resolve(imageResult());
    },
  });

  assert(!result.ok);
  // 429: nothing failed and nothing is owed. The request is refused for rate.
  assertEquals(result.status, 429);
  assertEquals(result.code, "attempt_limit");
  assertEquals(generated, false, "the ceiling must precede the provider call");
  // No reservation either - the refusal is the claim itself.
  assertEquals(rpcNames(rpcCalls), ["claim_cover_regeneration"]);
});

Deno.test("the idempotency key reaches the claim, not only the reservation", async () => {
  // The free path never calls `reserve_generation_operation`, which is where
  // the other paid endpoints get their replay protection. Before this the
  // request id was validated by the handler and then unused, so a retried free
  // regeneration ran the whole provider chain again.
  const { client, rpcCalls } = stubClient();
  await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(imageResult()),
  });

  const claim = rpcCalls.find((c) => c.fn === "claim_cover_regeneration");
  assertEquals(claim?.args.p_request_id, "req-1");
});

Deno.test("a replayed request id returns the cover it already bought", async () => {
  const { client, rpcCalls } = stubClient({
    claim: {
      claimed: false,
      reason: "replayed",
      cover_image_url: "https://cdn.test/covers/story-1/cover-r1.png",
      cover_regen_count: 1,
    },
  });
  let generated = false;

  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => {
      generated = true;
      return Promise.resolve(imageResult());
    },
  });

  assert(result.ok);
  assertEquals(result.replayed, true);
  assertEquals(result.charged, false);
  assertEquals(
    result.coverImageUrl,
    "https://cdn.test/covers/story-1/cover-r1.png",
  );
  assertEquals(generated, false, "a replay must not generate a second cover");
  // And nothing was claimed, so nothing needs releasing.
  assertEquals(rpcNames(rpcCalls), ["claim_cover_regeneration"]);
});

// ---------------------------------------------------------------------------
// Releasing the claim
// ---------------------------------------------------------------------------

Deno.test("a reservation that throws still releases the claim", async () => {
  // The try/catch used to wrap only the provider call, so an RPC that rejected
  // escaped with the row still reading 'generating'. The reader then watched a
  // spinner over a cover that already existed, and every further attempt was
  // refused as in-flight until the ten-minute staleness window expired.
  const { client, rpcCalls, statusWrites } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 1,
      requires_credit: true,
      title: "T",
      primary_genre: "mystery",
      themes: [],
    },
    reserveThrows: new Error("connection reset"),
  });

  let thrown: unknown = null;
  try {
    await regenerateCover({
      client,
      ...BASE,
      generate: () => Promise.resolve(imageResult()),
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof Error);
  const release = releaseCall(rpcCalls);
  assert(release);
  assertEquals(release.p_previous_status, "ready");
  assertEquals(release.p_refund_attempt, true);
  assertEquals(statusWrites.length, 0);
});

Deno.test("a reservation with no operation id still releases the claim", async () => {
  const { client, rpcCalls, statusWrites } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 1,
      requires_credit: true,
      title: "T",
      primary_genre: "mystery",
      themes: [],
    },
    reserveData: null,
  });

  let thrown: unknown = null;
  try {
    await regenerateCover({
      client,
      ...BASE,
      generate: () => Promise.resolve(imageResult()),
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof Error);
  const release = releaseCall(rpcCalls);
  assert(release);
  assertEquals(release.p_previous_status, "ready");
  assertEquals(release.p_refund_attempt, true);
  assertEquals(statusWrites.length, 0);
});

Deno.test("a claim RPC that throws leaves nothing to release", async () => {
  // Symmetry check on the other side of the boundary: if the claim itself
  // failed, the row was never taken and restoring it would be a write over
  // whatever state somebody else legitimately holds.
  const { client, statusWrites } = stubClient({
    claimError: { message: "database unavailable" },
  });

  let thrown: unknown = null;
  try {
    await regenerateCover({
      client,
      ...BASE,
      generate: () => Promise.resolve(imageResult()),
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown);
  assertEquals(statusWrites.length, 0);
});

// ---------------------------------------------------------------------------
// Which request id owns the cover on the row
// ---------------------------------------------------------------------------
//
// The replay guard has to mean "this request id delivered the cover that is on
// the row", not "this request id was the last one to claim it". When the claim
// wrote `cover_last_request_id` those two collapsed into one column, and the
// case the guard exists for turned into a lie: request R exhausted every
// provider, the release put `cover_status` back to 'ready' because the story
// already had a cover, and the retry of R - a dropped response, the exact thing
// idempotency is for - came back 200 `replayed: true` with the *old* URL. The
// writer was told their regeneration succeeded while looking at the cover they
// had asked to replace.

Deno.test("a delivered regeneration records the request id that delivered it", async () => {
  const { client, rpcCalls } = stubClient();
  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(imageResult()),
  });

  assert(result.ok);
  const finish = rpcCalls.find((c) => c.fn === "finish_cover_regeneration");
  assertEquals(
    finish?.args.p_request_id,
    "req-1",
    "the replay key is written on delivery, so a replay hands back a cover " +
      "this id actually produced",
  );
});

Deno.test("a failed regeneration records no request id to replay", async () => {
  const { client, rpcCalls } = stubClient();
  const result = await regenerateCover({
    client,
    ...BASE,
    generate: () => Promise.resolve(null),
  });

  assert(!result.ok);
  // Nothing wrote the key, so the retry of this id reaches the claim with
  // `cover_last_request_id` still pointing at whatever last succeeded - it
  // cannot match, and the retry re-attempts instead of replaying.
  assertEquals(
    rpcCalls.some((c) => c.fn === "finish_cover_regeneration"),
    false,
  );
  const release = releaseCall(rpcCalls);
  assert(release);
  assert(
    !Object.keys(release).some((key) => key.includes("request_id")),
    "releasing a failed attempt must not write a replay key either",
  );
});

Deno.test("only the delivery writes cover_last_request_id", async () => {
  // A source check on the migration, because the column is written in SQL and
  // this is the half of the fix no stubbed client can see.
  const sql = await Deno.readTextFile(
    new URL(
      "../../migrations/00044_cover_regeneration.sql",
      import.meta.url,
    ),
  );
  const claim = sql.slice(
    sql.indexOf("create or replace function public.claim_cover_regeneration"),
    sql.indexOf("create or replace function public.finish_cover_regeneration"),
  );
  const finish = sql.slice(
    sql.indexOf("create or replace function public.finish_cover_regeneration"),
  );
  assert(claim.length > 0 && finish.length > 0);
  // The claim's own UPDATE, not the whole function: the replay guard above it
  // legitimately *reads* the column.
  const claimUpdate = claim.slice(claim.indexOf("update public.stories"));
  assert(claimUpdate.includes("cover_attempt_count = cover_attempt_count + 1"));
  assert(
    !claimUpdate.includes("cover_last_request_id ="),
    "the claim must not write the replay key: a request that then fails would " +
      "replay the cover it failed to replace",
  );
  assertStringIncludes(finish, "cover_last_request_id = coalesce(p_request_id");
});

Deno.test("the original cover stores the prompt it was made from", async () => {
  // `stories.cover_prompt` is what `describePreviousCover` reads, and the
  // *first* regeneration - the free one, the common case - is the one that
  // reads it before any regeneration has ever written it. `media.ts` discarded
  // `cover.prompt`, so the column was null for every cover until its second
  // regeneration and the steer degraded to "make it different" with no idea
  // what from.
  const media = await Deno.readTextFile(
    new URL("./media.ts", import.meta.url),
  );
  const ready = media.slice(media.indexOf('"ready", {'));
  assertStringIncludes(ready.slice(0, 200), "cover_prompt");
});

// ---------------------------------------------------------------------------
// The steer's two halves
// ---------------------------------------------------------------------------

Deno.test("a maximum-length note does not truncate the variation half away", () => {
  const note = "a".repeat(MAX_COVER_NOTE_LENGTH);
  const previous = buildCoverPrompt(
    "mystery",
    "The Quiet Door",
    ["doors", "grief"],
    undefined,
    "A hill town, off-season",
  );

  const steer = buildVariationSteer(note, previous);
  assert(steer);
  assertStringIncludes(steer, note);
  // The half that was silently lost: `"The writer asks for this cover, " + 300`
  // is already past the old 320-character cap, so the writer who said the most
  // about what they wanted got no instruction to vary at all.
  assertStringIncludes(steer, "clearly different");
  assertStringIncludes(steer, "The Quiet Door");

  // And it survives the sanitizer at the prompt boundary, which is where the
  // truncation actually happened.
  const prompt = buildCoverPrompt(
    "mystery",
    "The Quiet Door",
    ["doors"],
    undefined,
    "A hill town, off-season",
    "graphic violence",
    steer,
  );
  assertStringIncludes(prompt, note);
  assertStringIncludes(prompt, "clearly different");
  assertStringIncludes(prompt, "Do not depict: graphic violence.");
});

Deno.test("neither half of the steer can crowd the other out", () => {
  const steer = buildVariationSteer(
    "b".repeat(MAX_COVER_NOTE_LENGTH * 3),
    `Inspired by the story ${"c".repeat(2000)} The image must contain NO text`,
  );
  assert(steer);
  assert(
    steer.length <= MAX_COVER_STEER_LENGTH,
    `the steer is budgeted to ${MAX_COVER_STEER_LENGTH}, got ${steer.length}`,
  );
  assertStringIncludes(steer, "The writer asks for this cover");
  assertStringIncludes(steer, "clearly different");
});

/**
 * The style the writer picked survives a regeneration, because the claim
 * carries it.
 *
 * A regeneration builds its prompt entirely from what
 * `claim_cover_regeneration` returns -- deliberately, so it does not follow the
 * claim with a second SELECT of the same row. That is exactly why a field
 * missing from the claim is invisible here: the code compiles, the cover
 * generates, and the writer pays a credit to have their anime cover replaced
 * by one in the genre's default look with nothing anywhere saying why.
 */
Deno.test("a regeneration keeps the writer's image style", async () => {
  const { client } = stubClient({
    claim: {
      claimed: true,
      previous_cover_status: "ready",
      regen_count: 0,
      requires_credit: false,
      title: "The Quiet Door",
      primary_genre: "mystery",
      themes: ["doors"],
      where_and_when: "A hill town, off-season",
      avoid: "graphic violence",
      cover_prompt: null,
      image_style: "anime",
    },
  });

  let seen: Record<string, unknown> | null = null;
  await regenerateCover({
    client,
    ...BASE,
    generate: (input) => {
      seen = input as unknown as Record<string, unknown>;
      return Promise.resolve(imageResult());
    },
  });

  const request = seen as unknown as { artStyle?: string; genre?: string };
  assertEquals(request.artStyle, "anime");

  // And it is the style clause the provider actually receives, not merely a
  // field that was carried. The genre's own style must be gone from the
  // prompt: appending both gives the model two contradictory instructions.
  const prompt = buildCoverPrompt(
    "mystery",
    "The Quiet Door",
    ["doors"],
    undefined,
    "A hill town, off-season",
    "graphic violence",
    undefined,
    request.artStyle,
  );
  assertStringIncludes(prompt, "modern anime illustration");

  // A story with no pick reaches the generator as `auto`-equivalent (absent),
  // which is what every cover regenerated before 00075 did.
  const legacy = stubClient();
  let legacySeen: Record<string, unknown> | null = null;
  await regenerateCover({
    client: legacy.client,
    ...BASE,
    generate: (input) => {
      legacySeen = input as unknown as Record<string, unknown>;
      return Promise.resolve(imageResult());
    },
  });
  assertEquals(
    (legacySeen as unknown as { artStyle?: string }).artStyle,
    undefined,
  );
});

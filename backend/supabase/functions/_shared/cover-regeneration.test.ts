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
  regenerateCover,
} from "./cover-regeneration.ts";
import { buildCoverPrompt } from "./cover-prompts.ts";
import type { ImageResult } from "./image.ts";

type RpcCall = { fn: string; args: Record<string, unknown> };
type StatusWrite = { table: string; values: Record<string, unknown> };

interface StubOptions {
  claim?: Record<string, unknown>;
  claimError?: unknown;
  reserveError?: unknown;
  reserveData?: Record<string, unknown>;
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
        if (options.reserveError) {
          return Promise.resolve({ data: null, error: options.reserveError });
        }
        return Promise.resolve({
          data: options.reserveData ??
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
  assertEquals(statusWrites.length, 1);
  assertEquals(statusWrites[0].values.cover_status, "ready");

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
  const { client, statusWrites } = stubClient({
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
  assertEquals(statusWrites[0]?.values.cover_status, "ready");
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

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { deriveGatingReason } from "./entity-visibility-gate.ts";
import {
  CLASSIFICATION_NOT_ATTEMPTED,
  type ClassificationOutcome,
  classifyIdea,
  EMPTY_RESOLVED_GROUNDING,
  type FastStructuredGenerator,
  type GroundingCacheClient,
  groundingCardsWithin,
  reportClassificationFailure,
  resolveGrounding,
  validateEntityMentions,
} from "./grounding-pipeline.ts";

// `resolveGrounding` needs a provider to classify, and these tests run with no
// credentials configured. That is the point of the first two: the pipeline's
// contract is that a total provider failure is indistinguishable, to the
// caller, from an idea that named nothing worth grounding.

Deno.test("an empty idea resolves without calling anything", async () => {
  let calls = 0;
  const cache: GroundingCacheClient = {
    rpc() {
      calls++;
      return Promise.resolve({ data: null, error: null });
    },
  };
  assertEquals(await resolveGrounding({ idea: "   ", cache }), {
    cards: [],
    entities: [],
  });
  assertEquals(calls, 0);
});

Deno.test("a provider failure degrades to an ungrounded result", async () => {
  const result = await resolveGrounding({
    idea: "A story where I meet Shivaji Maharaj",
    deadlineMs: 1_000,
  });
  assertEquals(result, EMPTY_RESOLVED_GROUNDING);
});

Deno.test("entity mentions survive a round trip through transport", () => {
  const [entity] = validateEntityMentions([{
    surface: "Shivaji Maharaj",
    canonicalName: "Chhatrapati Shivaji Maharaj",
    entityClass: "historical_public_figure",
    confidence: 0.94,
    needsGrounding: true,
    reason: "regional detail and honorifics",
  }]);
  assertEquals(entity.canonicalName, "Chhatrapati Shivaji Maharaj");
  assertEquals(entity.entityClass, "historical_public_figure");
  assert(entity.searchable);
  assert(entity.needsGrounding);
});

Deno.test("a client cannot mark a private individual searchable", () => {
  // The whole hard rule of this system, expressed as a test: `searchable` is
  // derived from the class on read, so no payload can talk the pipeline into
  // sending a user's child to a search provider.
  const [entity] = validateEntityMentions([{
    surface: "my daughter Meera",
    canonicalName: "Meera",
    entityClass: "private_individual",
    confidence: 1,
    searchable: true,
    needsGrounding: true,
  }]);
  assertEquals(entity.entityClass, "private_individual");
  assertEquals(entity.searchable, false);
  assertEquals(entity.needsGrounding, false);
});

Deno.test("malformed and unbounded transport payloads are dropped", () => {
  assertEquals(validateEntityMentions(null), []);
  assertEquals(validateEntityMentions("Shivaji"), []);
  assertEquals(validateEntityMentions([null, 4, "x", {}]), []);
  // Unknown class is not coerced into a known one.
  assertEquals(
    validateEntityMentions([{ canonicalName: "X", entityClass: "deity" }]),
    [],
  );
  // Count is capped, so a padded payload cannot inflate the stored record.
  const many = Array.from({ length: 40 }, (_, i) => ({
    canonicalName: `Entity ${i}`,
    entityClass: "real_place",
    confidence: 0.9,
  }));
  assert(validateEntityMentions(many).length <= 6);
});

Deno.test("confidence is clamped rather than trusted", () => {
  const [high] = validateEntityMentions([{
    canonicalName: "Paris",
    entityClass: "real_place",
    confidence: 42,
  }]);
  assertEquals(high.confidence, 1);
  const [low] = validateEntityMentions([{
    canonicalName: "Paris",
    entityClass: "real_place",
    confidence: -3,
  }]);
  assertEquals(low.confidence, 0);
  const [nan] = validateEntityMentions([{
    canonicalName: "Paris",
    entityClass: "real_place",
    confidence: Number.NaN,
  }]);
  assertEquals(nan.confidence, 0);
});

Deno.test("surface falls back to the canonical name when absent", () => {
  const [mention] = validateEntityMentions([{
    canonicalName: "Leonardo da Vinci",
    entityClass: "historical_public_figure",
  }]);
  assertEquals(mention.surface, "Leonardo da Vinci");
});

/**
 * The 2026-09-09 entity-gate defect, in tests.
 *
 * The gate is fed by a classification, and until this split the classification
 * was fused to the grounding-card path: one budget, one silent `catch`, and a
 * failure that arrived at the publish decision as an empty entity list -
 * indistinguishable from an idea that names nobody. Measured on production,
 * that failure was every request ever made. These tests hold the two apart.
 */

/** A stand-in for `generateFastStructuredText` that returns a fixed body. */
function generatorReturning(body: unknown): FastStructuredGenerator {
  return () =>
    Promise.resolve({ text: JSON.stringify(body), model: "test-model" });
}

function classified(
  surface: string,
  entityClass: string,
  extra: Record<string, unknown> = {},
) {
  return {
    surface,
    canonical_name: surface,
    entity_class: entityClass,
    confidence: 0.95,
    needs_grounding: false,
    reason: "test",
    ...extra,
  };
}

Deno.test("a living public figure is classified and gates the story", async () => {
  const outcome = await classifyIdea({
    idea: "Taylor Swift moves in above a Mumbai record shop",
    generate: generatorReturning({
      entities: [
        classified("Taylor Swift", "living_public_figure"),
        classified("Mumbai", "real_place"),
      ],
    }),
  });
  assertEquals(outcome.status, "ok");
  assertEquals(deriveGatingReason(outcome.entities), "living_public_figure");
});

Deno.test("a private individual is classified and gates the story", async () => {
  const outcome = await classifyIdea({
    idea: "My sister Priya finds a door in her office",
    characterNames: ["Priya"],
    generate: generatorReturning({
      entities: [classified("Priya", "private_individual")],
    }),
  });
  assertEquals(outcome.status, "ok");
  assertEquals(deriveGatingReason(outcome.entities), "private_individual");
});

Deno.test("a historical figure, a real place and a neutral idea are NOT gated", async () => {
  // The case grounding exists to serve. A gate that caught Shivaji Maharaj
  // would be a gate on the product, not on a privacy risk.
  const historical = await classifyIdea({
    idea: "Shivaji Maharaj plans the night march",
    generate: generatorReturning({
      entities: [
        classified("Shivaji Maharaj", "historical_public_figure", {
          needs_grounding: true,
        }),
        classified("Raigad", "real_place"),
      ],
    }),
  });
  assertEquals(historical.status, "ok");
  assertEquals(deriveGatingReason(historical.entities), null);

  // "none" is the model's legal way to say the idea names nobody. It is a
  // verdict, and it must not look like a failure.
  const neutral = await classifyIdea({
    idea: "A dragon and a princess argue about rent",
    generate: generatorReturning({ entities: [classified("", "none")] }),
  });
  assertEquals(neutral.status, "ok");
  assertEquals(neutral.entities, []);
  assertEquals(deriveGatingReason(neutral.entities), null);
});

Deno.test("a classification timeout is a failure, not an empty verdict", async () => {
  // The exact confusion that published the Taylor Swift story: the provider
  // chain exhausted its deadline, the old code caught it and returned
  // `{ cards: [], entities: [] }`, and the gate read that as "names nobody".
  const outcome = await classifyIdea({
    idea: "Taylor Swift moves in above a Mumbai record shop",
    generate: () =>
      Promise.reject(
        Object.assign(new Error("All LLM providers failed"), {
          name: "AllProvidersFailedError",
          failures: [
            { provider: "openrouter", model: "a", code: "timeout" },
            { provider: "openrouter", model: "b", code: "timeout" },
          ],
        }),
      ),
  });
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.failure, "provider_failed");
  assertEquals(outcome.code, "timeout");
  assertEquals(outcome.entities, []);
});

Deno.test("unparseable output is a failure, distinguishable from a timeout", async () => {
  const outcome = await classifyIdea({
    idea: "Taylor Swift moves in above a Mumbai record shop",
    generate: () =>
      Promise.resolve({ text: "I'm afraid I can't do that", model: "m" }),
  });
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.failure, "unparseable");
});

Deno.test("a classification timeout is logged, not swallowed", async () => {
  // The root cause was not the deadline; it was that a deadline this wrong
  // produced no signal at all. `entity-classify.ts` documents "silent failure
  // is the contract for the whole grounding path" and `catch {}` honoured it.
  const rows: Record<string, unknown>[] = [];
  await reportClassificationFailure({
    outcome: {
      status: "failed",
      entities: [],
      failure: "provider_failed",
      code: "timeout",
      elapsedMs: 40_012,
    },
    feature: "entity_gate",
    storyId: "00000000-0000-4000-8000-000000000591",
    userId: "00000000-0000-4000-8000-000000000592",
    log: (input) => {
      rows.push(input as unknown as Record<string, unknown>);
    },
  });

  assertEquals(rows.length, 1);
  const row = rows[0] as unknown as {
    bucket: string;
    severity: string;
    errorCode: string;
    context: Record<string, unknown>;
  };
  assertEquals(row.bucket, "grounding");
  // High, not low. A story published without the check is not a degraded
  // convenience.
  assertEquals(row.severity, "high");
  assertEquals(row.errorCode, "entity_classification_unavailable");
  assertEquals(row.context.failure, "provider_failed");
  assertEquals(row.context.code, "timeout");
  assertEquals(row.context.elapsed_ms, 40_012);

  // The PII rule, stricter here than anywhere: the idea and the entity names
  // are this call's entire subject and none of them are written.
  const serialized = JSON.stringify(row);
  assert(!serialized.includes("Taylor"));
  assert(!serialized.includes("Swift"));
  assert(!serialized.includes("record shop"));
});

Deno.test("a successful classification logs nothing", async () => {
  let calls = 0;
  await reportClassificationFailure({
    outcome: { status: "ok", entities: [], elapsedMs: 12 },
    feature: "entity_gate",
    log: () => {
      calls++;
    },
  });
  assertEquals(calls, 0);
});

Deno.test("a rate-limited classification is a failure the gate can see", () => {
  // A refused fallback claim used to be `null`, which the gate read as an
  // empty classification. A writer over the limit still gets their story; they
  // do not get to publish on a check that was skipped to save money.
  assertEquals(CLASSIFICATION_NOT_ATTEMPTED.status, "failed");
  assertEquals(CLASSIFICATION_NOT_ATTEMPTED.failure, "not_attempted");
  assertEquals(CLASSIFICATION_NOT_ATTEMPTED.entities, []);
});

Deno.test("cards take only what lands inside the short window, and the gate waits", async () => {
  // The whole shape of the fix: the classification runs on its own clock so
  // the publish decision can have a real answer, while the prompt takes
  // whatever exists by the time it has to be built. A classification slower
  // than the card window costs the prompt its cards - the outcome every
  // unshaped generation already had - and costs the gate nothing.
  let resolve!: (value: ClassificationOutcome) => void;
  const slow = new Promise<ClassificationOutcome>((r) => {
    resolve = r;
  });
  assertEquals(await groundingCardsWithin(slow, null, 20), []);

  resolve({
    status: "ok",
    entities: [{
      surface: "Shivaji Maharaj",
      canonicalName: "Chhatrapati Shivaji Maharaj",
      entityClass: "historical_public_figure",
      confidence: 0.95,
      searchable: true,
      needsGrounding: true,
      reason: "regional detail",
    }],
    elapsedMs: 25_000,
  });
  // The gate still gets its verdict from the same promise, late and complete.
  const outcome = await slow;
  assertEquals(outcome.status, "ok");
  assertEquals(deriveGatingReason(outcome.entities), null);
});

Deno.test("a failed classification builds no cards", async () => {
  assertEquals(
    await groundingCardsWithin(
      Promise.resolve(CLASSIFICATION_NOT_ATTEMPTED),
      null,
      5_000,
    ),
    [],
  );
});

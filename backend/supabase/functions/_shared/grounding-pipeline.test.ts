import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  EMPTY_RESOLVED_GROUNDING,
  type GroundingCacheClient,
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
  const [entity] = validateEntityMentions([{
    canonicalName: "Leonardo da Vinci",
    entityClass: "historical_public_figure",
  }]);
  assertEquals(entity.surface, "Leonardo da Vinci");
});

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  boundedText,
  ENTITY_CLASSES,
  type EntityClass,
  GROUNDING_TTL_DAYS,
  groundingCacheKey,
  MAX_GROUNDING_CARDS,
  SEARCHABLE_ENTITY_CLASSES,
  stripJsonCodeFence,
} from "./grounding-types.ts";

Deno.test("a private individual is never in the searchable set", () => {
  assertEquals(SEARCHABLE_ENTITY_CLASSES.has("private_individual"), false);
  assertEquals(SEARCHABLE_ENTITY_CLASSES.has("fictional_character"), false);
  assertEquals(SEARCHABLE_ENTITY_CLASSES.has("historical_public_figure"), true);

  // Every searchable class must be a real class. A typo here would create a
  // class that is searchable and belongs to nothing, which fails open.
  for (const entityClass of SEARCHABLE_ENTITY_CLASSES) {
    assertEquals(ENTITY_CLASSES.has(entityClass), true, entityClass);
  }
});

Deno.test("every entity class has a TTL decision recorded", () => {
  for (const entityClass of ENTITY_CLASSES) {
    const ttl = GROUNDING_TTL_DAYS[entityClass as EntityClass];
    assertEquals(typeof ttl, "number", `${entityClass} has no TTL`);
  }
  // Facts that move get a shorter life than facts that do not. If this ever
  // inverts, a card about a living person outlives the situation it describes.
  assertEquals(
    GROUNDING_TTL_DAYS.living_public_figure <
      GROUNDING_TTL_DAYS.historical_public_figure,
    true,
  );
  assertEquals(GROUNDING_TTL_DAYS.private_individual, 0);
});

Deno.test("the cache key folds spelling noise but not diacritics", () => {
  assertEquals(groundingCacheKey("Shivaji Maharaj"), "shivaji maharaj");
  assertEquals(groundingCacheKey("  shivaji   MAHARAJ. "), "shivaji maharaj");
  assertEquals(groundingCacheKey("Shivaji-Maharaj"), "shivaji maharaj");

  // Deliberate: folding accents collides names that are genuinely different,
  // and a cache that returns the wrong entity is worse than a miss.
  assertEquals(
    groundingCacheKey("Malmö") === groundingCacheKey("Malmo"),
    false,
  );
});

Deno.test("bounded text trims, caps, and refuses non-strings", () => {
  assertEquals(boundedText("  hello  ", 10), "hello");
  assertEquals(boundedText("abcdef", 3), "abc");
  assertEquals(boundedText("   ", 10), undefined);
  assertEquals(boundedText(undefined, 10), undefined);
  assertEquals(boundedText(42, 10), undefined);
  // Never coerced: String({}) is "[object Object]", a field that looks
  // populated and says nothing.
  assertEquals(boundedText({}, 10), undefined);
});

Deno.test("a fenced JSON payload is unwrapped", () => {
  assertEquals(stripJsonCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
  assertEquals(stripJsonCodeFence('{"a":1}'), '{"a":1}');
  assertEquals(stripJsonCodeFence("```"), "");
});

Deno.test("the card budget is smaller than the classification budget", () => {
  // Classification is one cheap call over the whole idea; each card is its own
  // call plus a slice of every chapter's prompt for the life of the series.
  assertEquals(MAX_GROUNDING_CARDS < 6, true);
});

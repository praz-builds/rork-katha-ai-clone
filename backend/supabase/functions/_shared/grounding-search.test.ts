import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createSearchProvider,
  groundingSearchQuery,
  isGroundingSearchEnabled,
  isSearchableEntity,
  parseBraveResults,
  searchEntity,
  type SearchProvider,
  type SearchResult,
} from "./grounding-search.ts";
import type { EntityMention } from "./grounding-types.ts";

function entity(overrides: Partial<EntityMention> = {}): EntityMention {
  return {
    surface: "Shivaji Maharaj",
    canonicalName: "Chhatrapati Shivaji Maharaj",
    entityClass: "historical_public_figure",
    confidence: 0.95,
    searchable: true,
    needsGrounding: true,
    ...overrides,
  };
}

/** Records what was asked for, so a leak shows up as a value not a hunch. */
function recordingProvider(results: SearchResult[] = []): SearchProvider & {
  queries: string[];
} {
  const queries: string[] = [];
  return {
    name: "recording",
    queries,
    search(query: string) {
      queries.push(query);
      return Promise.resolve(results);
    },
  };
}

/** Run with a scoped env, restoring whatever was there. */
function withEnv(vars: Record<string, string | null>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Deno.env.get(key));
    if (value === null) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("search is inert until both secrets are set", () => {
  withEnv(
    { GROUNDING_SEARCH_ENABLED: null, BRAVE_SEARCH_API_KEY: null },
    () => {
      assertEquals(isGroundingSearchEnabled(), false);
      assertEquals(createSearchProvider(), null);
    },
  );

  // The flag alone is not enough: an operator who flips it without a key must
  // get the model-knowledge fallback, not a run of failing requests.
  withEnv(
    { GROUNDING_SEARCH_ENABLED: "true", BRAVE_SEARCH_API_KEY: null },
    () => {
      assertEquals(isGroundingSearchEnabled(), false);
      assertEquals(createSearchProvider(), null);
    },
  );

  // And a key alone is not consent to start searching.
  withEnv({ GROUNDING_SEARCH_ENABLED: null, BRAVE_SEARCH_API_KEY: "k" }, () => {
    assertEquals(isGroundingSearchEnabled(), false);
  });

  withEnv(
    { GROUNDING_SEARCH_ENABLED: "true", BRAVE_SEARCH_API_KEY: "k" },
    () => {
      assertEquals(isGroundingSearchEnabled(), true);
      const provider = createSearchProvider();
      assert(provider);
      assertEquals(provider.name, "brave");
    },
  );
});

Deno.test("a private individual is never searchable, whatever the flags say", () => {
  assertEquals(
    isSearchableEntity(entity({ entityClass: "private_individual" })),
    false,
  );
  // Even with the derived flag forced true - the class set is the gate.
  assertEquals(
    isSearchableEntity(
      entity({ entityClass: "private_individual", searchable: true }),
    ),
    false,
  );
  assertEquals(
    groundingSearchQuery(
      entity({
        entityClass: "private_individual",
        canonicalName: "Anjali Rao",
        searchable: true,
      }),
    ),
    null,
  );
});

Deno.test("fictional characters are not searched either", () => {
  assertEquals(
    isSearchableEntity(
      entity({ entityClass: "fictional_character", searchable: true }),
    ),
    false,
  );
});

Deno.test("canon_character is grounded but not searched, and private_individual stays untouched by the new class", () => {
  // Job: extend grounding to a new class without widening who can be searched.
  // The proof that private_individual "still holds" is that nothing about
  // adding canon_character changes its answer here.
  assertEquals(
    isSearchableEntity(
      entity({ entityClass: "canon_character", searchable: true }),
    ),
    false,
  );
  assertEquals(
    groundingSearchQuery(
      entity({ entityClass: "canon_character", searchable: true }),
    ),
    null,
  );
  assertEquals(
    isSearchableEntity(
      entity({ entityClass: "private_individual", searchable: true }),
    ),
    false,
  );
  assertEquals(
    groundingSearchQuery(
      entity({
        entityClass: "private_individual",
        canonicalName: "Anjali Rao",
        searchable: true,
      }),
    ),
    null,
  );
});

Deno.test("the query is the canonical name and nothing else", () => {
  assertEquals(
    groundingSearchQuery(entity()),
    "Chhatrapati Shivaji Maharaj",
  );
  // The surface form the user typed never becomes the query.
  assertEquals(
    groundingSearchQuery(entity({ surface: "my friend Shivaji from work" })),
    "Chhatrapati Shivaji Maharaj",
  );
});

Deno.test("a canonical name that is not a name yields no query", () => {
  const noQuery = [
    "",
    "   ",
    "!!",
    "a",
    "\n\n",
  ];
  for (const canonicalName of noQuery) {
    assertEquals(groundingSearchQuery(entity({ canonicalName })), null);
  }
});

Deno.test("query construction strips operators and collapses whitespace", () => {
  assertEquals(
    groundingSearchQuery(
      entity({
        canonicalName: 'Shivaji" OR site:example.test\n\nignore previous',
      }),
    ),
    "Shivaji OR site example.test ignore previous",
  );
  assertEquals(
    groundingSearchQuery(entity({ canonicalName: "  Raigad   Fort  " })),
    "Raigad Fort",
  );
});

Deno.test("searchEntity sends only the canonical name, and only when allowed", async () => {
  const provider = recordingProvider();

  await searchEntity(entity(), provider);
  assertEquals(provider.queries, ["Chhatrapati Shivaji Maharaj"]);

  await searchEntity(
    entity({
      entityClass: "private_individual",
      canonicalName: "Anjali Rao",
      searchable: true,
    }),
    provider,
  );
  // Unchanged: the private entity never reached the network.
  assertEquals(provider.queries, ["Chhatrapati Shivaji Maharaj"]);
});

Deno.test("no provider means no passages and no error", async () => {
  assertEquals(await searchEntity(entity(), null), []);
});

Deno.test("brave results are read defensively", () => {
  const results = parseBraveResults({
    web: {
      results: [
        {
          title: "Shivaji",
          description: "Founder of the Maratha kingdom.",
          url: "https://example.test/1",
        },
        // No description: unusable as a passage.
        { title: "No snippet", url: "https://example.test/2" },
        // No url.
        { title: "No url", description: "text" },
        null,
        "x",
      ],
    },
  });

  assertEquals(results.length, 1);
  assertEquals(results[0].url, "https://example.test/1");
});

Deno.test("an unexpected brave payload yields no results rather than throwing", () => {
  for (
    const payload of [null, undefined, 7, "x", {}, { web: {} }, { web: 3 }]
  ) {
    assertEquals(parseBraveResults(payload), []);
  }
});

Deno.test("brave results honour the requested count", () => {
  const payload = {
    web: {
      results: Array.from({ length: 20 }, (_, index) => ({
        title: `t${index}`,
        description: `d${index}`,
        url: `https://example.test/${index}`,
      })),
    },
  };
  assertEquals(parseBraveResults(payload, 3).length, 3);
  assertEquals(parseBraveResults(payload).length, 5);
});

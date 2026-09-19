import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyRequestedVisibility,
  parseVisibilityRequest,
  type VisibilityClient,
  type VisibilityFilter,
} from "./publish.ts";

interface Write {
  table: string;
  values: Record<string, unknown>;
  filters: [string, unknown][];
}

/** A client that records every update and answers each with a scripted error. */
function recordingClient(
  errors: Record<string, unknown> = {},
): { client: VisibilityClient; writes: Write[] } {
  const writes: Write[] = [];
  const client: VisibilityClient = {
    from(table) {
      return {
        update(values) {
          const write: Write = { table, values, filters: [] };
          writes.push(write);
          const filter: VisibilityFilter = {
            eq(column, value) {
              write.filters.push([column, value]);
              return filter;
            },
            then(onFulfilled, onRejected) {
              return Promise.resolve({ error: errors[table] ?? null }).then(
                onFulfilled,
                onRejected,
              );
            },
          };
          return filter;
        },
      };
    },
  };
  return { client, writes };
}

const STORY = "11111111-1111-4111-8111-111111111111";

Deno.test("absent visibility is private; only the two words are accepted", () => {
  assertEquals(parseVisibilityRequest(undefined), "private");
  assertEquals(parseVisibilityRequest(null), "private");
  assertEquals(parseVisibilityRequest("private"), "private");
  assertEquals(parseVisibilityRequest("public"), "public");
  assertEquals(parseVisibilityRequest("PUBLIC"), null);
  assertEquals(parseVisibilityRequest(true), null);
});

Deno.test("a private request writes nothing", async () => {
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "private",
    isAnonymous: false,
  });
  assertEquals(outcome, {
    requested: "private",
    applied: "private",
    reason: null,
  });
  assertEquals(writes, []);
});

Deno.test("a guest asking for public stays private and is told to make an account", async () => {
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: true,
  });
  assertEquals(outcome.applied, "private");
  assertEquals(outcome.reason, "account_required");
  assertEquals(writes, []);
});

Deno.test("an allowed public request writes the same columns publish-story writes, chapters first", async () => {
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
  });
  assertEquals(outcome, {
    requested: "public",
    applied: "public",
    reason: null,
  });
  assertEquals(writes.length, 2);
  assertEquals(writes[0].table, "chapters");
  assertEquals(writes[0].values.is_published, true);
  assertEquals(typeof writes[0].values.published_at, "string");
  assertEquals(writes[0].filters, [["story_id", STORY], [
    "is_published",
    false,
  ]]);
  assertEquals(writes[1].table, "stories");
  assertEquals(writes[1].values, { is_public: true });
  assertEquals(writes[1].filters, [["id", STORY]]);
});

Deno.test("a failed story flip reverts the chapters it published and reports private, never throws", async () => {
  // Both callers run this after the chapter is persisted and paid for, inside
  // the block that refunds and fails the request on a throw. A visibility
  // write must not cost the writer their chapter, and it must not leave a
  // private story with chapters marked published.
  const { client, writes } = recordingClient({ stories: { code: "42501" } });
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
  });
  assertEquals(outcome, {
    requested: "public",
    applied: "private",
    reason: "publish_failed",
  });
  assertEquals(writes.map((w) => w.table), ["chapters", "stories", "chapters"]);
  const publishedAt = writes[0].values.published_at;
  assertEquals(writes[2].values, { is_published: false, published_at: null });
  // Only the chapters this call flipped: matched by the timestamp it wrote.
  assertEquals(writes[2].filters, [["story_id", STORY], [
    "published_at",
    publishedAt,
  ]]);
});

Deno.test("a failed chapter flip reports private and never touches the story", async () => {
  const { client, writes } = recordingClient({
    chapters: { code: "42501", message: "denied" },
  });
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
  });
  assertEquals(outcome.applied, "private");
  assertEquals(outcome.reason, "publish_failed");
  assertEquals(writes.map((w) => w.table), ["chapters"]);
});

Deno.test("a named-cast story requested public IS public", async () => {
  // The 2026-09-18 decision, as a test. Every name on a character sheet is
  // classified `private_individual`, and until then that alone turned every
  // public request with a named cast into a private story. The function no
  // longer takes a classification or a gate reason at all, so there is
  // nothing a cast can do to the outcome: signed in and asked for public is
  // public, and both writes happen.
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
  });
  assertEquals(outcome, {
    requested: "public",
    applied: "public",
    reason: null,
  });
  assertEquals(writes.map((w) => w.table), ["chapters", "stories"]);
});

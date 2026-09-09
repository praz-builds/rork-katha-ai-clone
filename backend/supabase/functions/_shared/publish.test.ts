import {
  assertEquals,
  assertRejects,
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
    classificationAvailable: true,
    gateReason: null,
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
    classificationAvailable: true,
    gateReason: null,
  });
  assertEquals(outcome.applied, "private");
  assertEquals(outcome.reason, "account_required");
  assertEquals(writes, []);
});

Deno.test("a gated story stays private with the gate's own reason, before any write", async () => {
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
    classificationAvailable: true,
    gateReason: "living_public_figure",
  });
  assertEquals(outcome, {
    requested: "public",
    applied: "private",
    reason: "living_public_figure",
  });
  assertEquals(writes, []);
});

Deno.test("an allowed public request writes the same columns publish-story writes, chapters first", async () => {
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
    classificationAvailable: true,
    gateReason: null,
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

Deno.test("the database refusing the flip is reported as the constraint, not as success", async () => {
  const { client } = recordingClient({ stories: { code: "23514" } });
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
    classificationAvailable: true,
    gateReason: null,
  });
  assertEquals(outcome.applied, "private");
  assertEquals(outcome.reason, "gate_constraint");
});

Deno.test("any other database error is thrown, never swallowed into a private outcome", async () => {
  const { client } = recordingClient({
    chapters: { code: "42501", message: "denied" },
  });
  await assertRejects(() =>
    applyRequestedVisibility(client, {
      storyId: STORY,
      requested: "public",
      isAnonymous: false,
      classificationAvailable: true,
      gateReason: null,
    })
  );
});

Deno.test("a public request stays private when classification never answered", async () => {
  // The 2026-09-09 defect, as a test. Classification had a ~5s budget for a
  // ~25s call, so it failed on every request and handed the gate an empty
  // entity list - which is also what an idea naming nobody produces. The
  // Taylor Swift story went public on a real account with
  // `entity_gate_reason: null`, because "we never checked" and "we checked and
  // it was fine" were the same value.
  //
  // Grounding still fails open everywhere else: the story is written, saved
  // and readable. Only this one decision fails closed.
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
    classificationAvailable: false,
    gateReason: null,
  });
  assertEquals(outcome, {
    requested: "public",
    applied: "private",
    reason: "classification_unavailable",
  });
  // Refused before any write, like every other refusal here.
  assertEquals(writes, []);
});

Deno.test("a private request is unaffected by classification being unavailable", async () => {
  // Failing closed applies to the publish decision and to nothing else. A
  // writer who never asked to publish is not told anything went wrong,
  // because for them nothing did.
  const { client, writes } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "private",
    isAnonymous: false,
    classificationAvailable: false,
    gateReason: null,
  });
  assertEquals(outcome.reason, null);
  assertEquals(outcome.applied, "private");
  assertEquals(writes, []);
});

Deno.test("a guest is told to make an account before being told about the check", async () => {
  // Order matters for the copy the client renders: an anonymous writer's
  // problem is that they have no account, and telling them a check timed out
  // would send them to fix the wrong thing.
  const { client } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: true,
    classificationAvailable: false,
    gateReason: "living_public_figure",
  });
  assertEquals(outcome.reason, "account_required");
});

Deno.test("an unchecked story is refused for being unchecked, not for a gate reason it never got", async () => {
  // A gate reason cannot exist without a classification, so this pairing is
  // only reachable through a bug - and if it is reached, the honest answer is
  // that nothing was checked.
  const { client } = recordingClient();
  const outcome = await applyRequestedVisibility(client, {
    storyId: STORY,
    requested: "public",
    isAnonymous: false,
    classificationAvailable: false,
    gateReason: "private_individual",
  });
  assertEquals(outcome.reason, "classification_unavailable");
});

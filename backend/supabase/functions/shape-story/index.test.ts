// The two answers `shape-story` used to give without leaving a trace.
//
// Both return `{shape: null}` to the client, which renders "Where does it
// begin?" with no chips. Until 2026-09-24 neither wrote an `error_events` row,
// so an empty opening screen could not be told apart from a healthy one in the
// log. These tests drive the handler through its dependency seam -- no
// network, no database -- and pin that each one is now logged, and that a
// healthy answer still is not.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { LogErrorInput } from "../_shared/errors.ts";
import { EMPTY_RESOLVED_GROUNDING } from "../_shared/grounding-pipeline.ts";
import { handleRequest, type ShapeStoryDeps } from "./index.ts";

const VALID_SHAPE = JSON.stringify({
  genres: ["mystery"],
  whereAndWhen: "A remote island, present day",
  characters: [{
    name: "Fiona",
    background: "The keeper",
    appearance: "Weathered coat",
    isHero: true,
  }],
  suggestedMoments: ["She finds the letters"],
  beats: [
    "She finds her grandmother's letters in the lamp room.",
    "She questions the villagers about the wreck.",
    "She learns what happened to the ship.",
  ],
});

/** A response cut off mid-JSON, the commonest way a shape comes back unusable. */
const TRUNCATED = '{"genres": ["myst';

function harness(overrides: Partial<ShapeStoryDeps> = {}) {
  const logged: LogErrorInput[] = [];
  const pending: Promise<unknown>[] = [];
  const deps: ShapeStoryDeps = {
    authenticate: () => Promise.resolve("00000000-0000-4000-8000-000000000001"),
    claim: () => Promise.resolve(true),
    shape: () => Promise.resolve({ text: VALID_SHAPE, model: "test/model-1" }),
    ground: () => Promise.resolve(EMPTY_RESOLVED_GROUNDING),
    log: (input) => {
      logged.push(input);
      return Promise.resolve(true);
    },
    reportClassification: () => Promise.resolve(),
    // Collected rather than detached, so a test can wait for exactly the work
    // the handler handed to the runtime -- and a log call that bypassed
    // `background` would never be awaited and never land in `logged`.
    background: (work) => {
      pending.push(work);
    },
    ...overrides,
  };
  const settle = () => Promise.all(pending);
  return { deps, logged, settle };
}

function request(body: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/shape-story", {
    method: "POST",
    headers: {
      Authorization: "Bearer test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idea: "A lighthouse keeper finds letters about a shipwreck.",
      variant: "create",
      ...body,
    }),
  });
}

Deno.test("a healthy shape returns beats and logs nothing", async () => {
  const { deps, logged, settle } = harness();
  const response = await handleRequest(request(), deps);
  const body = await response.json();
  await settle();
  assertEquals(response.status, 200);
  assertEquals(body.shape.beats.length, 3);
  assertEquals(logged.length, 0);
});

Deno.test("a refused rate-limit claim is logged as story_shape_rate_limited", async () => {
  let shaped = false;
  const { deps, logged, settle } = harness({
    claim: () => Promise.resolve(false),
    shape: () => {
      shaped = true;
      return Promise.resolve({ text: VALID_SHAPE, model: "test/model-1" });
    },
  });
  const response = await handleRequest(request(), deps);
  const body = await response.json();
  await settle();
  assertEquals(body, { shape: null, reason: "rate_limited" });
  assertEquals(shaped, false);
  assertEquals(logged.map((row) => row.errorCode), [
    "story_shape_rate_limited",
  ]);
  assertEquals(logged[0].context?.kind, "create");
  // Our own capacity limit, not a provider's refusal.
  assertEquals(logged[0].bucket, "generation.story");
});

Deno.test("an answer that does not parse is logged as story_shape_empty", async () => {
  const { deps, logged, settle } = harness({
    shape: () => Promise.resolve({ text: TRUNCATED, model: "test/model-2" }),
  });
  const response = await handleRequest(request(), deps);
  const body = await response.json();
  await settle();
  assertEquals(body.shape, null);
  assertEquals(body.reason, "unavailable");
  assertEquals(logged.map((row) => row.errorCode), ["story_shape_empty"]);
  // Identifiers and counts only: which model, how much it said -- never what.
  assertEquals(logged[0].context, {
    feature: "story_shape",
    kind: "create",
    model: "test/model-2",
    chars: TRUNCATED.length,
  });
});

Deno.test("a provider failure is still logged as story_shape_failed", async () => {
  const { deps, logged, settle } = harness({
    shape: () => Promise.reject(new Error("all providers failed")),
  });
  const response = await handleRequest(request(), deps);
  const body = await response.json();
  assertEquals(body, { shape: null, reason: "provider_failed" });
  await settle();
  assertEquals(logged.map((row) => row.errorCode), ["story_shape_failed"]);
});

/**
 * The failure path used to AWAIT its log, so a slow `error_events` insert
 * (up to `logError`'s 1.5s timeout) sat between a failed provider and the
 * writer's fallback. A log that never finishes must not hold the response.
 */
Deno.test("a log that never finishes does not hold the response", async () => {
  const { deps } = harness({
    shape: () => Promise.reject(new Error("all providers failed")),
    log: () => new Promise(() => {}),
  });
  const response = await handleRequest(request(), deps);
  assertEquals(await response.json(), {
    shape: null,
    reason: "provider_failed",
  });
});

Deno.test("an unaccepted token is a 401 and never claims or shapes", async () => {
  let claimed = false;
  const { deps } = harness({
    authenticate: () => Promise.resolve(null),
    claim: () => {
      claimed = true;
      return Promise.resolve(true);
    },
  });
  const response = await handleRequest(request(), deps);
  await response.body?.cancel();
  assertEquals(response.status, 401);
  assertEquals(claimed, false);
});

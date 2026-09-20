// `canGenerateNarration` is the one place a caller may ask "may this request
// start fresh paid narration". The credits session replaces the body of this
// function; every other caller on the audio path must keep working unchanged
// regardless of how that answer is computed, which is exactly what these
// tests pin down: the shape of the result, and the default.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canGenerateNarration } from "./narration-entitlement.ts";

function envWith(vars: Record<string, string>): Pick<typeof Deno.env, "get"> {
  return { get: (key: string) => vars[key] };
}

Deno.test("with the flag unset, narration stays closed -- today's production behaviour", () => {
  const result = canGenerateNarration({ env: envWith({}) });
  assertEquals(result.allowed, false);
  assertEquals(result.reason, "narration_generation_disabled");
});

Deno.test("an empty or garbage flag value is treated as unset", () => {
  assertEquals(
    canGenerateNarration({ env: envWith({ NARRATION_GENERATION_ENABLED: "" }) })
      .allowed,
    false,
  );
  assertEquals(
    canGenerateNarration({
      env: envWith({ NARRATION_GENERATION_ENABLED: "nope" }),
    }).allowed,
    false,
  );
  assertEquals(
    canGenerateNarration({
      env: envWith({ NARRATION_GENERATION_ENABLED: "0" }),
    }).allowed,
    false,
  );
  assertEquals(
    canGenerateNarration({
      env: envWith({ NARRATION_GENERATION_ENABLED: "false" }),
    }).allowed,
    false,
  );
});

Deno.test("every documented truthy spelling opens the gate", () => {
  for (const value of ["1", "true", "TRUE", "yes", "On", "enabled"]) {
    const result = canGenerateNarration({
      env: envWith({ NARRATION_GENERATION_ENABLED: value }),
    });
    assertEquals(
      result.allowed,
      true,
      `expected "${value}" to enable generation`,
    );
    assertEquals(result.reason, "enabled_by_env");
  }
});

Deno.test("surrounding whitespace on the flag does not defeat it", () => {
  assertEquals(
    canGenerateNarration({
      env: envWith({ NARRATION_GENERATION_ENABLED: "  true  " }),
    }).allowed,
    true,
  );
});

Deno.test("the predicate accepts a full context without needing any of it", () => {
  const result = canGenerateNarration({
    userId: "11111111-1111-4111-8111-111111111111",
    storyId: "22222222-2222-4222-8222-222222222222",
    chapterId: "33333333-3333-4333-8333-333333333333",
    voiceId: "aria",
    purpose: "chapter",
    env: envWith({}),
  });
  assertEquals(result.allowed, false);
});

Deno.test("calling with no context at all reads real Deno.env and does not throw", () => {
  // Only asserts the call is safe to make with the process's real env, not a
  // particular outcome -- CI's env may or may not have the flag set.
  const result = canGenerateNarration();
  assertEquals(typeof result.allowed, "boolean");
  assertEquals(typeof result.reason, "string");
});

// --- Prefetch: paid synthesis nobody asked for, so it ships closed ----------
//
// A prefetch is the client deciding on its own to narrate a chapter in case
// the reader wants it. If that decision is ever wrong -- a loop, a screen that
// mounts twice, a list that prefetches every card -- the cost is real provider
// spend on a reader who never pressed Listen, and without its own flag the
// only way to stop it would be an app store release.

Deno.test("a prefetch is refused while NARRATION_PREFETCH_ENABLED is unset", () => {
  const result = canGenerateNarration({
    purpose: "prefetch",
    env: envWith({ NARRATION_GENERATION_ENABLED: "true" }),
  });
  assertEquals(result.allowed, false);
  assertEquals(result.reason, "narration_prefetch_disabled");
});

Deno.test("opening narration to readers does NOT open prefetch with it", () => {
  // The order of the two checks, asserted rather than assumed. Generation is
  // on here, which is the state production will be in; prefetch must still be
  // a separate, deliberate decision.
  for (const value of ["1", "true", "yes", "on", "enabled"]) {
    assertEquals(
      canGenerateNarration({
        purpose: "prefetch",
        env: envWith({ NARRATION_GENERATION_ENABLED: value }),
      }).allowed,
      false,
      `NARRATION_GENERATION_ENABLED=${value} must not enable prefetch`,
    );
  }
});

Deno.test("with NARRATION_PREFETCH_ENABLED set, a prefetch is allowed -- but still needs generation on", () => {
  assertEquals(
    canGenerateNarration({
      purpose: "prefetch",
      env: envWith({
        NARRATION_GENERATION_ENABLED: "true",
        NARRATION_PREFETCH_ENABLED: "true",
      }),
    }).allowed,
    true,
  );
  // The prefetch flag is an ADDITIONAL gate, not a bypass: with generation
  // closed, nothing generates, whatever it is for.
  assertEquals(
    canGenerateNarration({
      purpose: "prefetch",
      env: envWith({ NARRATION_PREFETCH_ENABLED: "true" }),
    }).allowed,
    false,
  );
});

Deno.test("the prefetch flag accepts the same spellings as the generation flag, and nothing else", () => {
  for (const value of ["1", "TRUE", "  yes  ", "On", "enabled"]) {
    assertEquals(
      canGenerateNarration({
        purpose: "prefetch",
        env: envWith({
          NARRATION_GENERATION_ENABLED: "true",
          NARRATION_PREFETCH_ENABLED: value,
        }),
      }).allowed,
      true,
      `expected "${value}" to enable prefetch`,
    );
  }
  for (const value of ["", "0", "false", "nope"]) {
    assertEquals(
      canGenerateNarration({
        purpose: "prefetch",
        env: envWith({
          NARRATION_GENERATION_ENABLED: "true",
          NARRATION_PREFETCH_ENABLED: value,
        }),
      }).allowed,
      false,
      `expected "${value}" to leave prefetch closed`,
    );
  }
});

Deno.test("a chapter or preview is unaffected by the prefetch flag either way", () => {
  for (const purpose of ["chapter", "preview"] as const) {
    assertEquals(
      canGenerateNarration({
        purpose,
        env: envWith({ NARRATION_GENERATION_ENABLED: "true" }),
      }).allowed,
      true,
    );
    assertEquals(
      canGenerateNarration({
        purpose,
        env: envWith({ NARRATION_PREFETCH_ENABLED: "true" }),
      }).allowed,
      false,
    );
  }
});

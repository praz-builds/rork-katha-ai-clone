// `_shared/sentry.ts` sits on top of `_shared/errors.ts`, so these tests
// prove the contract the observability gate cares about: a missing DSN is a
// true no-op (the SDK is never even fetched), a configured DSN sends a
// sanitized event that never carries free text, `reportError` writes the
// durable `error_events` row regardless of what Sentry does, and a Sentry
// transport failure never propagates to the caller.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captureError, reportError, resetSentryForTests } from "./sentry.ts";

const SENTRY_HOST = "sentry.katha.test";

function fakeDsn(projectId = "1234"): string {
  return `https://fakekey@${SENTRY_HOST}/${projectId}`;
}

function withEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = Deno.env.get(key);
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

/** Pulls every JSON object with a `message` field out of a Sentry envelope body. */
function eventsFromEnvelope(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of body.trim().split("\n")) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not every envelope line is a JSON object with a message; skip it.
    }
  }
  return events;
}

interface FetchLog {
  sentryEvents: Array<Record<string, unknown>>;
  sentryCalls: number;
  errorEventsInserts: Array<Record<string, unknown>>;
  unexpected: Array<string>;
}

function newLog(): FetchLog {
  return {
    sentryEvents: [],
    sentryCalls: 0,
    errorEventsInserts: [],
    unexpected: [],
  };
}

function withFetch(
  log: FetchLog,
  run: () => Promise<void>,
  options: { sentryThrows?: boolean } = {},
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.hostname === SENTRY_HOST) {
      log.sentryCalls += 1;
      if (options.sentryThrows) {
        throw new Error("simulated sentry ingest outage");
      }
      const body = typeof init?.body === "string"
        ? init.body
        : await request.text();
      log.sentryEvents.push(...eventsFromEnvelope(body));
      return new Response("{}", { status: 200 });
    }

    if (url.pathname === "/rest/v1/error_events") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      log.errorEventsInserts.push(body);
      return new Response(JSON.stringify([]), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    log.unexpected.push(`${request.method} ${request.url}`);
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;

  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const SUPABASE_ENV = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

Deno.test("captureError is a true no-op without SENTRY_DSN: no fetch, resolves false, never throws", async () => {
  resetSentryForTests();
  const log = newLog();
  await withEnv({ SENTRY_DSN: undefined }, () =>
    withFetch(log, async () => {
      const sent = await captureError({
        bucket: "generation.audio",
        severity: "high",
        errorCode: "provider_error",
        error: new Error("boom"),
      });
      assertEquals(sent, false);
    }));
  assertEquals(
    log.sentryCalls,
    0,
    "no DSN must mean the Sentry SDK is never even reached",
  );
  assertEquals(log.unexpected, []);
});

Deno.test("reportError still writes the durable error_events row when no DSN is configured", async () => {
  resetSentryForTests();
  const log = newLog();
  await withEnv(
    { ...SUPABASE_ENV, SENTRY_DSN: undefined },
    () =>
      withFetch(log, async () => {
        await reportError({
          bucket: "generation.audio",
          severity: "high",
          errorCode: "provider_error",
          error: new Error("boom"),
        });
      }),
  );
  assertEquals(log.errorEventsInserts.length, 1);
  assertEquals(log.sentryCalls, 0);
});

Deno.test("captureError sends a sanitized event once SENTRY_DSN is configured", async () => {
  resetSentryForTests();
  const log = newLog();
  await withEnv({ SENTRY_DSN: fakeDsn() }, () =>
    withFetch(log, async () => {
      const sent = await captureError({
        bucket: "generation.audio",
        severity: "critical",
        errorCode: "generation_timed_out",
        error: new Error("ignored -- see the safe-message test below"),
        userId: "11111111-1111-4111-8111-111111111111",
        context: {
          story_id: "22222222-2222-4222-8222-222222222222",
          chapter_id: "33333333-3333-4333-8333-333333333333",
          job_id: "job-abc",
        },
      });
      assertEquals(sent, true);
    }));

  assertEquals(log.sentryCalls, 1);
  assertEquals(log.sentryEvents.length, 1);
  const event = log.sentryEvents[0];
  assertEquals(event.level, "fatal");
  assertEquals(event.message, "generation_timed_out");
  const tags = event.tags as Record<string, unknown>;
  assertEquals(tags.bucket, "generation.audio");
  assertEquals(tags.severity, "critical");
  assertEquals(tags.error_code, "generation_timed_out");
  const extra = event.extra as Record<string, unknown>;
  assertEquals(extra.story_id, "22222222-2222-4222-8222-222222222222");
  assertEquals(extra.chapter_id, "33333333-3333-4333-8333-333333333333");
  assertEquals(extra.job_id, "job-abc");
  const user = event.user as Record<string, unknown>;
  assertEquals(user.id, "11111111-1111-4111-8111-111111111111");
});

Deno.test("no reported payload ever contains story prose, a seed, a prompt, or an entity name", async () => {
  resetSentryForTests();
  const log = newLog();
  const forbidden = [
    "a story about a lonely lighthouse keeper",
    "seed: two rival bakers fall in love",
    "write a romance where Elena confronts her sister",
    "Elena Marchetti",
  ];
  await withEnv({ SENTRY_DSN: fakeDsn() }, () =>
    withFetch(log, async () => {
      await captureError({
        bucket: "generation.audio",
        severity: "high",
        // A real caller would never pass free text as `errorCode` or in an
        // Error message either, but the sanitizer's job is to hold even if
        // one did -- this is what "never" has to mean.
        error: new Error(forbidden[0]),
        context: {
          story_id: "22222222-2222-4222-8222-222222222222",
          // None of these keys are in the allowlist, so a caller that
          // accidentally passed prose here must still not leak it.
          prompt: forbidden[1],
          seed: forbidden[2],
          entity_name: forbidden[3],
          title: "a title that should also never appear",
        },
      });
    }));

  assertEquals(log.sentryEvents.length, 1);
  const raw = JSON.stringify(log.sentryEvents[0]);
  for (const text of forbidden) {
    assertFalse(
      raw.includes(text),
      `reported payload must never contain: ${text}`,
    );
  }
  // And the only context key that made it through is the allowlisted one.
  const extra = log.sentryEvents[0].extra as Record<string, unknown>;
  assertEquals(Object.keys(extra), ["story_id"]);
});

Deno.test("the reported message is the safe, bounded one -- never the original error's own message", async () => {
  resetSentryForTests();
  const log = newLog();
  const secret = "full provider payload or story prose that must not persist";
  await withEnv({ SENTRY_DSN: fakeDsn() }, () =>
    withFetch(log, async () => {
      await captureError({
        bucket: "generation.audio",
        severity: "medium",
        error: new Error(secret),
      });
    }));

  assertEquals(log.sentryEvents.length, 1);
  assertEquals(log.sentryEvents[0].message, "Error");
  assertFalse(JSON.stringify(log.sentryEvents[0]).includes(secret));
});

Deno.test("a Sentry transport that throws does not propagate, and the error_events row still lands", async () => {
  resetSentryForTests();
  const log = newLog();
  let threw = false;
  await withEnv(
    { ...SUPABASE_ENV, SENTRY_DSN: fakeDsn() },
    () =>
      withFetch(log, async () => {
        try {
          await reportError({
            bucket: "generation.audio",
            severity: "high",
            errorCode: "provider_error",
            error: new Error("boom"),
          });
        } catch {
          threw = true;
        }
      }, { sentryThrows: true }),
  );

  assertFalse(
    threw,
    "reportError must never throw, even if Sentry's transport does",
  );
  assertEquals(
    log.errorEventsInserts.length,
    1,
    "the durable row must still be written when Sentry fails",
  );
});

Deno.test("captureError itself never throws when the Sentry transport throws", async () => {
  resetSentryForTests();
  const log = newLog();
  let threw = false;
  let result: boolean | undefined;
  await withEnv({ SENTRY_DSN: fakeDsn() }, () =>
    withFetch(log, async () => {
      try {
        result = await captureError({
          bucket: "generation.audio",
          severity: "high",
          error: new Error("boom"),
        });
      } catch {
        threw = true;
      }
    }, { sentryThrows: true }));

  assertFalse(threw);
  assert(result === true || result === false);
});

Deno.test("reportError fires both logError and Sentry independently for the same failure", async () => {
  resetSentryForTests();
  const log = newLog();
  await withEnv(
    { ...SUPABASE_ENV, SENTRY_DSN: fakeDsn() },
    () =>
      withFetch(log, async () => {
        await reportError({
          bucket: "generation.audio",
          severity: "high",
          errorCode: "runpod_start_failed",
          error: new Error("boom"),
          userId: "11111111-1111-4111-8111-111111111111",
          context: { story_id: "22222222-2222-4222-8222-222222222222" },
        });
      }),
  );

  assertEquals(log.errorEventsInserts.length, 1);
  assertEquals(log.errorEventsInserts[0].bucket, "generation.audio");
  assertEquals(log.errorEventsInserts[0].error_code, "runpod_start_failed");
  assertEquals(log.sentryEvents.length, 1);
  assertEquals(log.sentryEvents[0].message, "runpod_start_failed");
});

Deno.test("severity maps onto Sentry's level vocabulary without inventing a second scale", async () => {
  resetSentryForTests();
  const log = newLog();
  const cases: Array<
    ["critical" | "high" | "medium" | "low", string]
  > = [
    ["critical", "fatal"],
    ["high", "error"],
    ["medium", "warning"],
    ["low", "info"],
  ];
  await withEnv({ SENTRY_DSN: fakeDsn() }, () =>
    withFetch(log, async () => {
      for (const [severity] of cases) {
        await captureError({
          bucket: "generation.audio",
          severity,
          errorCode: `case_${severity}`,
          error: new Error("boom"),
        });
      }
    }));

  assertEquals(log.sentryEvents.length, cases.length);
  for (let i = 0; i < cases.length; i++) {
    const [, level] = cases[i];
    assertEquals(log.sentryEvents[i].level, level);
  }
});

// `audio-status` is the only function on this path allowed to poll a
// provider job, and only because the job id it polls came off a
// `chapter_audio` row the caller is already entitled to read. These tests
// prove the four outcomes a poll can produce: ready and already-uploaded,
// nothing to poll yet, a fresh ready result that gets uploaded and marked, and
// a failure that gets recorded rather than silently retried forever.
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";
import { STATIC_VOICES } from "../_shared/voices.ts";
import { resetSentryForTests } from "../_shared/sentry.ts";
import { NARRATION_JOB_STALE_MS } from "../_shared/narration-audio.ts";

const SENTRY_HOST = "sentry.katha.test";
const FAKE_SENTRY_DSN = `https://fakekey@${SENTRY_HOST}/1234`;

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
      // Not every envelope line is JSON with a message; skip it.
    }
  }
  return events;
}

function isoMsAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const STORY_ID = "33333333-3333-4333-8333-333333333333";
const CHAPTER_ID = "44444444-4444-4444-8444-444444444444";

interface ChapterAudioFixture {
  id: string;
  chapter_id: string;
  voice_id: string;
  storage_path: string | null;
  provider_job_id: string | null;
  status: "pending" | "ready" | "failed";
  error_code?: string | null;
  /** `null`/omitted means "no age at all" -- never treated as stale. */
  updated_at?: string | null;
}

interface ServerState {
  userId: string;
  story: { author_id: string; is_public: boolean; is_curated: boolean } | null;
  chapter: {
    id: string;
    story_id: string;
    content: string;
    word_count: number | null;
    audio_url: string | null;
    is_published: boolean;
  } | null;
  row: ChapterAudioFixture | null;
  runpodStatusResponse: () => {
    status: string;
    output?: Record<string, unknown>;
    error?: string;
  };
  patches: Array<Record<string, unknown>>;
  /**
   * `staleCountQueries` as it stood when each PATCH was issued.
   *
   * The severity count and the row's own failure write are ordered, and the
   * order is the whole point: this records it so a test can assert it rather
   * than infer it from a count the mock returns statically.
   */
  staleCountAtPatch: number[];
  uploads: number;
  sentryEvents: Array<Record<string, unknown>>;
  errorEventsInserts: Array<Record<string, unknown>>;
  /**
   * What `classifyTimeoutSeverity`'s count-only query reports back: how many
   * `chapter_audio` rows are stale-pending right now, this row included.
   */
  stalePendingCount: number;
  staleCountQueries: number;
}

function newState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    userId: AUTHOR_ID,
    story: { author_id: AUTHOR_ID, is_public: false, is_curated: false },
    chapter: {
      id: CHAPTER_ID,
      story_id: STORY_ID,
      content: "content",
      word_count: 10,
      audio_url: null,
      is_published: false,
    },
    row: null,
    runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
    patches: [],
    staleCountAtPatch: [],
    uploads: 0,
    sentryEvents: [],
    errorEventsInserts: [],
    stalePendingCount: 1,
    staleCountQueries: 0,
    ...overrides,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pgrst116(): Response {
  return json(
    {
      code: "PGRST116",
      message: "no rows",
      details: "Results contain 0 rows",
      hint: null,
    },
    406,
  );
}

function makeFetchStub(state: ServerState): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.pathname === "/auth/v1/user") {
      return json({
        id: state.userId,
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: false,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }

    if (url.pathname === "/rest/v1/stories") {
      return state.story ? json(state.story) : pgrst116();
    }
    if (url.pathname === "/rest/v1/chapters") {
      return state.chapter ? json(state.chapter) : pgrst116();
    }
    if (url.pathname === "/rest/v1/voices") {
      // The registry is authoritative now, and migration `00048` seeds these
      // rows, so the fixture serves them. Answering `[]` from a reachable table
      // used to be read as an outage and silently fell back to the static list.
      const requested = url.searchParams.get("id")?.replace("eq.", "");
      const rows = STATIC_VOICES.filter((voice) =>
        !requested || voice.id === requested
      );
      const wantsObject = (request.headers.get("Accept") ?? "").includes(
        "vnd.pgrst.object",
      );
      return wantsObject ? json(rows[0] ?? null) : json(rows);
    }

    if (url.pathname === "/rest/v1/chapter_audio") {
      if (request.method === "PATCH") {
        state.staleCountAtPatch.push(state.staleCountQueries);
        state.patches.push(await request.json());
        return json([]);
      }
      if (request.method === "HEAD") {
        // `classifyTimeoutSeverity`'s `select("id", { count: "exact", head:
        // true })` -- postgrest-js reads the total off `Content-Range`, not
        // the (absent) body. See `publish-story/index.test.ts` for the same
        // contract.
        state.staleCountQueries += 1;
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Range": `*/${state.stalePendingCount}`,
          },
        });
      }
      return state.row ? json([state.row]) : json([]);
    }

    if (
      url.href.startsWith(
        "https://api.runpod.ai/v2/minimax-speech-02-hd/status/",
      )
    ) {
      return json(state.runpodStatusResponse());
    }

    if (url.pathname.startsWith("/storage/v1/object/audio/")) {
      state.uploads += 1;
      return json({ Key: "audio/uploaded.mp3" });
    }

    if (url.hostname === SENTRY_HOST) {
      const body = init?.body ? String(init.body) : await request.text();
      state.sentryEvents.push(...eventsFromEnvelope(body));
      return json({});
    }

    if (url.pathname === "/rest/v1/error_events") {
      if (request.method === "POST") {
        const body = init?.body ? String(init.body) : await request.text();
        state.errorEventsInserts.push(JSON.parse(body));
      }
      return json([]);
    }

    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;
}

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  RUNPOD_API_KEY: "test-runpod-key",
};

function setTestEnv(
  extra: Record<string, string> = {},
): Record<string, string | undefined> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...extra })) {
    previous[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  }
  return previous;
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
}

async function run(
  state: ServerState,
  query: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub(state);
  try {
    const response = await handleRequest(
      new Request(`https://katha.test/audio-status?${query}`, {
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    return { status: response.status, json: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const QUERY = `story_id=${STORY_ID}&chapter_id=${CHAPTER_ID}&voice_id=aria`;

Deno.test("a ready row is reported complete without polling the provider", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: `${STORY_ID}/${CHAPTER_ID}/aria.mp3`,
        provider_job_id: null,
        status: "ready",
      },
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    assertEquals(state.uploads, 0);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a pending row with no job id yet is reported pending, not polled", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: null,
        status: "pending",
      },
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "PENDING");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a pending row whose job finished uploads the audio and marks the row ready", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: `${STORY_ID}/${CHAPTER_ID}/aria.mp3`,
        provider_job_id: "job-xyz",
        status: "pending",
      },
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: btoa("abc"), duration_seconds: 12 },
      }),
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    assertEquals(state.uploads, 1);
    assertEquals(state.patches.length, 1);
    assertEquals(state.patches[0].status, "ready");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a failed job marks the row failed", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: `${STORY_ID}/${CHAPTER_ID}/aria.mp3`,
        provider_job_id: "job-xyz",
        status: "pending",
      },
      runpodStatusResponse: () => ({ status: "FAILED", error: "gpu_oom" }),
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "FAILED");
    assertEquals(body.error_code, "gpu_oom");
    assertEquals(state.patches.length, 1);
    assertEquals(state.patches[0].status, "failed");
    assertEquals(state.patches[0].error_code, "gpu_oom");
    assertEquals(state.uploads, 0);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("an already-failed row is reported failed without polling again", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: null,
        status: "failed",
        error_code: "gpu_oom",
      },
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "FAILED");
    assertEquals(body.error_code, "gpu_oom");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("no row and no legacy audio_url reports nothing to poll", async () => {
  const env = setTestEnv();
  try {
    const state = newState({ row: null });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 404);
    assertEquals(
      body.error,
      "No narration job found for this chapter and voice",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a non-reader is refused, and the provider job is never polled on their behalf", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      userId: OTHER_USER_ID,
      story: { author_id: AUTHOR_ID, is_public: false, is_curated: false },
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: "job-xyz",
        status: "pending",
      },
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 403);
    assertEquals(body.error, "Not authorized");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("no row but a legacy audio_url on the default voice is reported complete", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      row: null,
      chapter: {
        id: CHAPTER_ID,
        story_id: STORY_ID,
        content: "content",
        word_count: 10,
        audio_url: "https://cdn.example/legacy.mp3",
        is_published: false,
      },
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    assertEquals(body.audio_url, "https://cdn.example/legacy.mp3");
  } finally {
    restoreEnv(env);
  }
});

// ---------------------------------------------------------------------------
// Sentry: a provider-reported failure, and a timed-out job.
// ---------------------------------------------------------------------------

Deno.test("a provider-reported job failure is reported to Sentry as high severity", async () => {
  resetSentryForTests();
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: `${STORY_ID}/${CHAPTER_ID}/aria.mp3`,
        provider_job_id: "job-xyz",
        status: "pending",
      },
      runpodStatusResponse: () => ({ status: "FAILED", error: "gpu_oom" }),
    });
    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "FAILED");
    assertEquals(state.errorEventsInserts.length, 1);
    assertEquals(state.sentryEvents.length, 1);
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.severity, "high");
    assertEquals(state.sentryEvents[0].message, "gpu_oom");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a job stuck pending past the stale threshold is marked timed out and reported once, not on every poll", async () => {
  resetSentryForTests();
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: `${STORY_ID}/${CHAPTER_ID}/aria.mp3`,
        provider_job_id: "job-xyz",
        status: "pending",
        updated_at: isoMsAgo(NARRATION_JOB_STALE_MS + 60_000),
      },
      // The provider still has not resolved it either -- this is what makes
      // it honestly a timeout rather than a race with a real completion.
      runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
      stalePendingCount: 1,
    });

    const first = await run(state, QUERY);
    assertEquals(first.status, 200);
    assertEquals(first.json.status, "FAILED");
    assertEquals(first.json.error_code, "generation_timed_out");
    assertEquals(state.patches.length, 1);
    assertEquals(state.patches[0].status, "failed");
    assertEquals(state.patches[0].error_code, "generation_timed_out");
    assertEquals(state.errorEventsInserts.length, 1);
    assertEquals(state.sentryEvents.length, 1);
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(
      tags.severity,
      "high",
      "exactly one stuck job must not read as systemic",
    );

    // The claiming request would have persisted the failure; reflect that in
    // the fixture and poll again, the way a client's next poll actually would.
    state.row = {
      ...state.row!,
      status: "failed",
      error_code: "generation_timed_out",
    };

    const second = await run(state, QUERY);
    assertEquals(second.status, 200);
    assertEquals(second.json.status, "FAILED");
    assertEquals(
      state.errorEventsInserts.length,
      1,
      "a second poll of an already-failed row must not log again",
    );
    assertEquals(
      state.sentryEvents.length,
      1,
      "a second poll of an already-failed row must not report to Sentry again",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("several jobs stuck at once escalate the timeout report to critical", async () => {
  resetSentryForTests();
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: "job-xyz",
        status: "pending",
        updated_at: isoMsAgo(NARRATION_JOB_STALE_MS + 60_000),
      },
      runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
      stalePendingCount: 3,
    });

    await run(state, QUERY);

    assertEquals(state.sentryEvents.length, 1);
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.severity, "critical");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a claimed row that never even started is also reported timed out once stale, without polling the provider", async () => {
  resetSentryForTests();
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: null,
        status: "pending",
        updated_at: isoMsAgo(NARRATION_JOB_STALE_MS + 60_000),
      },
    });

    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "FAILED");
    assertEquals(body.error_code, "generation_timed_out");
    assertEquals(state.sentryEvents.length, 1);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a pending job that is merely young (not yet stale) is still reported pending, untouched", async () => {
  resetSentryForTests();
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: "job-xyz",
        status: "pending",
        updated_at: isoMsAgo(1_000),
      },
      runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
    });

    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "PENDING");
    assertEquals(state.patches.length, 0);
    assertEquals(state.sentryEvents.length, 0);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("without SENTRY_DSN, a timeout is still detected and marked failed, but Sentry is never reached", async () => {
  resetSentryForTests();
  const env = setTestEnv();
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: "job-xyz",
        status: "pending",
        updated_at: isoMsAgo(NARRATION_JOB_STALE_MS + 60_000),
      },
      runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
    });

    const { status, json: body } = await run(state, QUERY);
    assertEquals(status, 200);
    assertEquals(body.status, "FAILED");
    assertEquals(body.error_code, "generation_timed_out");
    assertEquals(state.errorEventsInserts.length, 1);
    assertFalse(
      state.sentryEvents.length > 0,
      "with no DSN, Sentry must never be reached",
    );
  } finally {
    restoreEnv(env);
  }
});

// Two stuck jobs is systemic, and used to report as if it were one.
//
// `classifyTimeoutSeverity` counts stale `pending` rows and treats "more than
// one" as systemic, because this row is meant to be one of the rows it counts.
// The failure write ran first, which took this row out of the count, so every
// reading was one short: two jobs stuck at the same moment counted as one and
// reported `high`, and `critical` needed three. The exact case the split
// exists to catch -- narration broken for everyone rather than for one chapter
// -- was the case it under-reported.
Deno.test("two jobs stuck at once is critical, and the count is taken before this row is failed", async () => {
  resetSentryForTests();
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: "job-xyz",
        status: "pending",
        updated_at: isoMsAgo(NARRATION_JOB_STALE_MS + 60_000),
      },
      runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
      // This row plus one other. Under the old ordering this arrived as 1.
      stalePendingCount: 2,
    });

    await run(state, QUERY);

    assertEquals(state.sentryEvents.length, 1);
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.severity, "critical");

    // The ordering itself, not just its consequence. A mock returns a static
    // count, so the count alone cannot prove which ran first.
    assertEquals(state.patches.length, 1);
    assertEquals(
      state.staleCountAtPatch[0],
      1,
      "the stale count must be taken before the row is marked failed",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("one job stuck alone is still only high", async () => {
  // The mirror. Without it, a change that simply always reported critical
  // would pass the test above.
  resetSentryForTests();
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  try {
    const state = newState({
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: "job-xyz",
        status: "pending",
        updated_at: isoMsAgo(NARRATION_JOB_STALE_MS + 60_000),
      },
      runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
      stalePendingCount: 1,
    });

    await run(state, QUERY);

    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.severity, "high");
  } finally {
    restoreEnv(env);
  }
});

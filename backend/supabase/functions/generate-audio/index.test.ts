// `generate-audio` is where the whole lazy-generation contract has to hold at
// once: a cache hit never reaches RunPod, a closed entitlement gate reproduces
// today's exact refusal, and a claimed (chapter, voice) row means only the
// claimant starts a provider job. Every request the handler makes leaves
// through a stubbed `fetch` (the same approach `publish-story/index.test.ts`
// uses), so what actually left the process is what gets asserted, not what the
// code merely intended to do.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";
import { STATIC_VOICES } from "../_shared/voices.ts";
import { NARRATION_REFUSAL } from "../_shared/narration-audio.ts";
import { resetSentryForTests } from "../_shared/sentry.ts";

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

const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const READER_ID = "22222222-2222-4222-8222-222222222222";
const STORY_ID = "33333333-3333-4333-8333-333333333333";
const CHAPTER_ID = "44444444-4444-4444-8444-444444444444";

interface ChapterAudioFixture {
  id: string;
  chapter_id: string;
  voice_id: string;
  storage_path: string | null;
  provider_job_id: string | null;
  status: "pending" | "ready" | "failed";
  word_count?: number | null;
  error_code?: string | null;
}

interface ServerState {
  userId: string | null;
  story: { author_id: string; is_public: boolean; is_curated: boolean } | null;
  chapter: {
    id: string;
    story_id: string;
    content: string;
    word_count: number | null;
    audio_url: string | null;
    is_published: boolean;
  } | null;
  chapterAudio: Map<string, ChapterAudioFixture>;
  runpodRunStatus: number;
  runpodRunBody: () => Record<string, unknown>;
  /**
   * Fails only the `provider_job_id` write `markChapterAudioJobStarted`
   * makes, after the provider run has already been accepted -- the exact
   * failure window `generate-audio` has to reconcile.
   */
  failJobStartedPatch: boolean;
  sentryEvents: Array<Record<string, unknown>>;
  errorEventsInserts: Array<Record<string, unknown>>;
  calls: {
    rpc: number;
    runpodRun: number;
    runpodCancel: string[];
    patches: Array<{ table: string; body: Record<string, unknown> }>;
  };
}

function newState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    userId: AUTHOR_ID,
    story: { author_id: AUTHOR_ID, is_public: false, is_curated: false },
    chapter: {
      id: CHAPTER_ID,
      story_id: STORY_ID,
      content: "Once upon a time, in a quiet town, ".repeat(20),
      word_count: 140,
      audio_url: null,
      is_published: false,
    },
    chapterAudio: new Map(),
    runpodRunStatus: 200,
    runpodRunBody: () => ({ id: "job-xyz" }),
    failJobStartedPatch: false,
    sentryEvents: [],
    errorEventsInserts: [],
    calls: {
      rpc: 0,
      patches: [] as ServerState["calls"]["patches"],
      runpodRun: 0,
      runpodCancel: [] as string[],
    },
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

/** A synchronous, side-effect-computing claim -- see the concurrency test for why this matters. */
function claimRow(
  state: ServerState,
  chapterId: string,
  voiceId: string,
  storagePath: string,
  wordCount: number,
): {
  audio_id: string;
  status: string;
  storage_path: string | null;
  provider_job_id: string | null;
  claimed: boolean;
} {
  const key = `${chapterId}:${voiceId}`;
  const existing = state.chapterAudio.get(key);
  if (
    existing && (existing.status === "ready" || existing.status === "pending")
  ) {
    return {
      audio_id: existing.id,
      status: existing.status,
      storage_path: existing.storage_path,
      provider_job_id: existing.provider_job_id,
      claimed: false,
    };
  }
  const id = existing?.id ?? `audio-${state.chapterAudio.size + 1}`;
  const row: ChapterAudioFixture = {
    id,
    chapter_id: chapterId,
    voice_id: voiceId,
    status: "pending",
    storage_path: null,
    provider_job_id: null,
    word_count: wordCount,
    error_code: null,
  };
  state.chapterAudio.set(key, row);
  return {
    audio_id: id,
    status: "pending",
    storage_path: storagePath,
    provider_job_id: null,
    claimed: true,
  };
}

function makeFetchStub(state: ServerState): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.pathname === "/auth/v1/user") {
      if (!state.userId) return json({ error: "invalid token" }, 401);
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
      // Serve the registry, because the registry is now authoritative.
      //
      // This used to answer `[]` to force the static fallback, which quietly
      // encoded the bug: an empty answer from a reachable table was being read
      // as "the table is down" rather than "there are no active voices", so a
      // deactivated voice stayed usable. Migration `00048` seeds these rows, so
      // a fixture that serves them is also the more honest one.
      const requested = url.searchParams.get("id")?.replace("eq.", "");
      const rows = STATIC_VOICES.filter((voice) =>
        !requested || voice.id === requested
      );
      // `.maybeSingle()` asks for a single object, not an array.
      const wantsObject = (request.headers.get("Accept") ?? "").includes(
        "vnd.pgrst.object",
      );
      return wantsObject ? json(rows[0] ?? null) : json(rows);
    }

    if (url.pathname === "/rest/v1/chapter_audio") {
      if (request.method === "PATCH") {
        const body = await request.json() as Record<string, unknown>;
        state.calls.patches.push({ table: "chapter_audio", body });
        if (state.failJobStartedPatch && body.status === "pending") {
          return json({ message: "simulated outage" }, 500);
        }
        // Applied to the matching fixture row, the way a real `update().eq()`
        // would land, so a test can assert on the row's state afterwards
        // rather than only on which PATCH bodies were sent.
        const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");
        if (idFilter) {
          for (const [key, row] of state.chapterAudio) {
            if (row.id === idFilter) {
              state.chapterAudio.set(
                key,
                { ...row, ...body } as ChapterAudioFixture,
              );
              break;
            }
          }
        }
        return json([]);
      }
      const voiceId = url.searchParams.get("voice_id")?.replace(/^eq\./, "");
      const statusFilter = url.searchParams.get("status")?.replace(/^eq\./, "");
      const row = voiceId
        ? state.chapterAudio.get(`${CHAPTER_ID}:${voiceId}`)
        : undefined;
      if (!row) return json([]);
      if (statusFilter && row.status !== statusFilter) return json([]);
      return json([row]);
    }

    if (url.pathname === "/rest/v1/rpc/claim_chapter_audio_generation") {
      state.calls.rpc += 1;
      const body = await request.json() as {
        p_chapter_id: string;
        p_voice_id: string;
        p_storage_path: string;
        p_word_count: number;
      };
      const result = claimRow(
        state,
        body.p_chapter_id,
        body.p_voice_id,
        body.p_storage_path,
        body.p_word_count,
      );
      return json([result]);
    }

    if (
      url.href.startsWith("https://api.runpod.ai/v2/minimax-speech-02-hd/run")
    ) {
      state.calls.runpodRun += 1;
      return json(state.runpodRunBody(), state.runpodRunStatus);
    }

    if (
      url.href.startsWith(
        "https://api.runpod.ai/v2/minimax-speech-02-hd/cancel/",
      )
    ) {
      state.calls.runpodCancel.push(url.href.split("/cancel/")[1]);
      return json({ id: url.href.split("/cancel/")[1], status: "CANCELLED" });
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
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub(state);
  try {
    const response = await handleRequest(
      new Request("https://katha.test/generate-audio", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, json: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("a ready chapter_audio row is returned without touching the provider", async () => {
  const env = setTestEnv();
  try {
    const state = newState();
    state.chapterAudio.set(`${CHAPTER_ID}:aria`, {
      id: "audio-1",
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
      storage_path: `${STORY_ID}/${CHAPTER_ID}/aria.mp3`,
      provider_job_id: null,
      status: "ready",
    });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    assertEquals(body.cached, true);
    assert(
      typeof body.audio_url === "string" &&
        (body.audio_url as string).includes("aria.mp3"),
    );
    assertEquals(
      state.calls.rpc,
      0,
      "a cache hit must never reach the claim RPC",
    );
    assertEquals(
      state.calls.runpodRun,
      0,
      "a cache hit must never reach RunPod",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a miss with generation disabled returns the current refusal, unchanged", async () => {
  const env = setTestEnv({ NARRATION_GENERATION_ENABLED: "false" });
  try {
    const state = newState();
    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 503);
    assertEquals(body.error, NARRATION_REFUSAL);
    assertEquals(body.error, "Narration unlock is not available yet");
    assertEquals(state.calls.rpc, 0, "a closed gate must never claim a row");
    assertEquals(
      state.calls.runpodRun,
      0,
      "a closed gate must never reach RunPod",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("two concurrent requests for the same chapter and voice start exactly one job", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState();

    const [first, second] = await Promise.all([
      run(state, { story_id: STORY_ID, chapter_id: CHAPTER_ID }),
      run(state, { story_id: STORY_ID, chapter_id: CHAPTER_ID }),
    ]);

    assertEquals(
      state.calls.runpodRun,
      1,
      "exactly one provider job must start",
    );
    assertEquals(
      state.chapterAudio.size,
      1,
      "exactly one chapter_audio row must exist",
    );

    const statuses = [first.status, second.status].sort();
    // Both responses report the same in-flight (or completed) generation --
    // neither one is an error, and only one of them carries the job id it
    // itself started.
    assert(statuses.every((s) => s === 202 || s === 200));
    const jobStarters = [first, second].filter((r) =>
      typeof r.json.job_id === "string"
    );
    assertEquals(
      jobStarters.length,
      1,
      "only the claim winner records a job id",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a non-reader is refused before any provider or database write happens", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({
      userId: READER_ID,
      story: { author_id: AUTHOR_ID, is_public: false, is_curated: false },
      chapter: {
        id: CHAPTER_ID,
        story_id: STORY_ID,
        content: "private",
        word_count: 1,
        audio_url: null,
        is_published: false,
      },
    });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 403);
    assertEquals(body.error, "Not authorized");
    assertEquals(state.calls.rpc, 0);
    assertEquals(state.calls.runpodRun, 0);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a published public chapter is readable by any authenticated reader", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      userId: READER_ID,
      story: { author_id: AUTHOR_ID, is_public: true, is_curated: false },
      chapter: {
        id: CHAPTER_ID,
        story_id: STORY_ID,
        content: "public chapter",
        word_count: 2,
        audio_url: "https://cdn.example/legacy.mp3",
        is_published: true,
      },
    });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    assertEquals(body.audio_url, "https://cdn.example/legacy.mp3");
    assertEquals(body.cached, true);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("an unknown voice_id is rejected before any lookup", async () => {
  const env = setTestEnv();
  try {
    const state = newState();
    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "not-a-real-voice",
    });
    assertEquals(status, 400);
    assertEquals(body.error, "Unknown voice_id");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("an invalid story_id or chapter_id is rejected before touching the database", async () => {
  const env = setTestEnv();
  try {
    const state = newState();
    const { status, json: body } = await run(state, {
      story_id: "not-a-uuid",
      chapter_id: CHAPTER_ID,
    });
    assertEquals(status, 400);
    assertEquals(body.error, "Valid story_id and chapter_id are required");
  } finally {
    restoreEnv(env);
  }
});

// If RunPod has already accepted a job and the write that would remember its
// id fails, the job must not become untracked: this asserts the job gets
// cancelled and the claimed row is put back to "failed" rather than left
// stuck "pending" with no provider_job_id, which would otherwise (a) waste
// the provider spend on a job nothing can ever collect, and (b) let a retry
// reclaim the same row and start a second job racing the still-running first
// one -- defeating the one-job-per-(chapter,voice) guarantee that row exists
// to hold.
Deno.test("a provider job that cannot be recorded is cancelled, not left untracked", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ failJobStartedPatch: true });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 502);
    assertEquals(body.error, "Narration generation failed to start");
    assertEquals(state.calls.runpodRun, 1, "the provider job was started");
    assertEquals(
      state.calls.runpodCancel,
      ["job-xyz"],
      "the exact job RunPod accepted must be the one cancelled",
    );

    const row = state.chapterAudio.get(`${CHAPTER_ID}:aria`);
    assertEquals(
      row?.status,
      "failed",
      "the row must not be left stuck pending with no provider_job_id",
    );
    assertEquals(row?.provider_job_id, null);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a retry after a failed recording claims cleanly and starts one new job, not two", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ failJobStartedPatch: true });
    await run(state, { story_id: STORY_ID, chapter_id: CHAPTER_ID });

    // The failure above cancelled the first job and marked the row failed.
    // A retry, now with recording working, must claim that same row again
    // (not error as "already claimed") and start exactly one more job.
    state.failJobStartedPatch = false;
    const retry = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(retry.status, 202);
    assertEquals(
      state.calls.runpodRun,
      2,
      "one job from the failure, one from the retry",
    );
    assertEquals(
      state.calls.runpodCancel,
      ["job-xyz"],
      "only the untracked first job was cancelled",
    );
    const row = state.chapterAudio.get(`${CHAPTER_ID}:aria`);
    assertEquals(row?.status, "pending");
    assertEquals(row?.provider_job_id, "job-xyz");
  } finally {
    restoreEnv(env);
  }
});

// ---------------------------------------------------------------------------
// Sentry: a failed RunPod job reports to Sentry AND writes error_events.
// ---------------------------------------------------------------------------

Deno.test("a RunPod outage (5xx on /run) is reported to Sentry as critical, and still writes error_events", async () => {
  resetSentryForTests();
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
    SENTRY_DSN: FAKE_SENTRY_DSN,
  });
  try {
    const state = newState({
      runpodRunStatus: 500,
      runpodRunBody: () => ({ error: "internal" }),
    });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 502);
    assertEquals(body.error, "Narration generation failed to start");

    assertEquals(
      state.calls.patches.filter((p) => p.table === "chapter_audio").length,
      1,
    );
    assertEquals(
      state.calls.patches[0].body.status,
      "failed",
      "the chapter_audio row must still be marked failed",
    );
    assertEquals(
      state.errorEventsInserts.length,
      1,
      "the durable error_events row must still be written",
    );
    assertEquals(state.errorEventsInserts[0].bucket, "generation.audio");

    assertEquals(
      state.sentryEvents.length,
      1,
      "Sentry must receive exactly one event",
    );
    const event = state.sentryEvents[0];
    assertEquals(
      event.level,
      "fatal",
      "a 5xx from RunPod's own endpoint is systemic, not one job",
    );
    const tags = event.tags as Record<string, unknown>;
    assertEquals(tags.bucket, "generation.audio");
    assertEquals(tags.severity, "critical");
    // The event carries a classified code, not the thrown sentence. What
    // reaches Sentry is drawn from a fixed set this codebase controls; the
    // provider's own text stays in `error_events`.
    assertEquals(event.message, "runpod_start_5xx");
    assertEquals(tags.error_code, "runpod_start_5xx");
    const extra = event.extra as Record<string, unknown>;
    assertEquals(extra.story_id, STORY_ID);
    assertEquals(extra.chapter_id, CHAPTER_ID);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a single rejected job (4xx on /run) is reported to Sentry as high, not critical", async () => {
  resetSentryForTests();
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
    SENTRY_DSN: FAKE_SENTRY_DSN,
  });
  try {
    const state = newState({
      runpodRunStatus: 400,
      runpodRunBody: () => ({ error: "bad request" }),
    });

    const { status } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 502);
    assertEquals(state.sentryEvents.length, 1);
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(
      tags.severity,
      "high",
      "a single rejected request must not read as a systemic outage",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("without SENTRY_DSN, a start failure still writes error_events and never touches Sentry", async () => {
  resetSentryForTests();
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ runpodRunStatus: 500 });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
    });

    assertEquals(status, 502);
    assertEquals(body.error, "Narration generation failed to start");
    assertEquals(
      state.errorEventsInserts.length,
      1,
      "logError must behave exactly as before Sentry was wired in",
    );
    assertEquals(
      state.sentryEvents.length,
      0,
      "with no DSN, Sentry must never be reached",
    );
  } finally {
    restoreEnv(env);
  }
});

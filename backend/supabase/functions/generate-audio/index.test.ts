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
import {
  MAX_NARRATION_CHARS,
  NARRATION_CHUNK_CHARS,
  NARRATION_PROVIDER_CHAR_LIMIT,
} from "../_shared/narration-chunks.ts";
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
  /** Part objects left in the `audio` bucket by an earlier, abandoned attempt. */
  stagedParts: string[];
  calls: {
    rpc: number;
    edgeTts: number;
    uploads: Array<{ path: string; bytes: number }>;
    runpodRun: number;
    runpodRunPrompts: string[];
    runpodCancel: string[];
    partsRemoved: string[];
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
    stagedParts: [],
    calls: {
      rpc: 0,
      edgeTts: 0,
      uploads: [],
      patches: [] as ServerState["calls"]["patches"],
      runpodRun: 0,
      runpodRunPrompts: [] as string[],
      runpodCancel: [] as string[],
      partsRemoved: [] as string[],
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

    // Staged narration parts. `generate-audio` clears these on every fresh
    // claim so a retry rebuilds from chunk 0 rather than resuming onto the
    // debris of an abandoned attempt.
    if (url.pathname === "/storage/v1/object/list/audio") {
      const body = await request.json() as { prefix?: string };
      const prefix = body.prefix ? `${body.prefix}/` : "";
      return json(
        state.stagedParts
          .filter((path) => path.startsWith(prefix))
          .map((path) => ({ name: path.slice(prefix.length) })),
      );
    }
    if (
      url.pathname === "/storage/v1/object/audio" &&
      request.method === "DELETE"
    ) {
      const body = await request.json() as { prefixes?: string[] };
      state.calls.partsRemoved.push(...(body.prefixes ?? []));
      state.stagedParts = state.stagedParts.filter((path) =>
        !(body.prefixes ?? []).includes(path)
      );
      return json([]);
    }

    if (url.pathname.startsWith("/storage/v1/object/audio/")) {
      if (request.method !== "POST" && request.method !== "PUT") {
        return json({ message: "unsupported storage method" }, 405);
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      state.calls.uploads.push({
        path: decodeURIComponent(url.pathname.replace(
          "/storage/v1/object/audio/",
          "",
        )),
        bytes: bytes.byteLength,
      });
      return json({ Key: url.pathname });
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

    if (url.href === "https://edge-tts.test/synthesize") {
      state.calls.edgeTts += 1;
      const body = await request.json() as Record<string, unknown>;
      assertEquals(body.voice, "es-ES-ElviraNeural");
      assertEquals(body.format, "mp3");
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    }

    if (
      url.href.startsWith("https://api.runpod.ai/v2/minimax-speech-02-hd/run")
    ) {
      state.calls.runpodRun += 1;
      const runBody = await request.json().catch(() => ({})) as {
        input?: { prompt?: unknown };
      };
      if (typeof runBody?.input?.prompt === "string") {
        state.calls.runpodRunPrompts.push(runBody.input.prompt);
      }
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

Deno.test("an edge_tts voice generates synchronously, uploads audio, and never touches RunPod", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    EDGE_TTS_SERVICE_URL: "https://edge-tts.test/synthesize",
  });
  try {
    const state = newState();

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "elvira",
    });

    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    assertEquals(body.voice_id, "elvira");
    assertEquals(body.cached, false);
    assertEquals(state.calls.edgeTts, 1);
    assertEquals(state.calls.runpodRun, 0);
    assertEquals(state.calls.uploads, [{
      path: `${STORY_ID}/${CHAPTER_ID}/elvira.mp3`,
      bytes: 4,
    }]);

    const row = state.chapterAudio.get(`${CHAPTER_ID}:elvira`);
    assertEquals(row?.status, "ready");
    assertEquals(row?.storage_path, `${STORY_ID}/${CHAPTER_ID}/elvira.mp3`);
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

// --- The provider's character limit -----------------------------------------
//
// Measured on production RunPod, 2026-09-19: MiniMax `speech-02-hd` accepted
// 9,849 characters and refused 10,105. `MAX_NARRATION_CHARS` was 40,000, so
// 133 of the 354 live published chapters (37.6%, spanning 41 of 80 stories)
// were accepted here, billed at the provider, and handed back to the reader as
// "Try again" -- with no retry that could ever have succeeded.

/** Prose of a given length, shaped like a generated chapter. */
function longChapter(chars: number): string {
  const paragraph =
    "The lamp guttered and she counted the coins again, slower this time. "
      .repeat(6) + "\n\n";
  let text = "";
  while (text.length < chars) text += paragraph;
  return text.slice(0, chars);
}

function chapterOf(content: string) {
  return {
    id: CHAPTER_ID,
    story_id: STORY_ID,
    content,
    word_count: Math.round(content.length / 5.8),
    audio_url: null,
    is_published: false,
  };
}

Deno.test("a chapter the provider would refuse whole is sent as its first chunk instead", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    // 10,105 characters: the exact length production measured as a refusal.
    const content = longChapter(10_105);
    const state = newState({ chapter: chapterOf(content) });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    // Accepted and started, where it used to be accepted and doomed.
    assertEquals(status, 202);
    assertEquals(body.status, "PENDING");
    assertEquals(body.chunks, 2);

    // One provider request, carrying a prompt the provider will actually take.
    assertEquals(state.calls.runpodRun, 1);
    const sent = state.calls.runpodRunPrompts[0];
    assert(sent.length <= NARRATION_CHUNK_CHARS);
    assert(sent.length < NARRATION_PROVIDER_CHAR_LIMIT);
    // It is the START of the chapter, not a summary or a truncation: the rest
    // follows in the next request.
    assert(content.startsWith(sent));
    assert(sent.length < content.length);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a chapter the provider takes whole still costs exactly one request", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    // 9,849 characters is the longest length production ever saw succeed.
    // The 62% of the library that already worked must not start costing two
    // provider calls.
    const content = longChapter(8_900);
    const state = newState({ chapter: chapterOf(content) });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(status, 202);
    assertEquals(body.chunks, 1);
    assertEquals(state.calls.runpodRun, 1);
    assertEquals(state.calls.runpodRunPrompts[0], content);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a chapter past every ceiling is refused before a single provider call", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
    SENTRY_DSN: FAKE_SENTRY_DSN,
  });
  resetSentryForTests();
  try {
    const content = longChapter(MAX_NARRATION_CHARS + 5_000);
    const state = newState({ chapter: chapterOf(content) });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(status, 413);
    assertEquals(body.code, "chapter_too_long_to_narrate");
    // Refused BEFORE the claim and before any spend: no provider job, and the
    // (chapter, voice) row is left free for a retry after an edit.
    assertEquals(state.calls.runpodRun, 0);
    assertEquals(state.calls.rpc, 0);

    // The length is on the telemetry row as a number. Production's own rows
    // carried neither the length nor the reason, which is why this failure had
    // to be bracketed by hand against a live endpoint.
    const event = state.sentryEvents[0];
    const tags = event.tags as Record<string, unknown>;
    assertEquals(tags.error_code, "chapter_too_long_to_narrate");
    const extra = event.extra as Record<string, unknown>;
    assertEquals(extra.chars, content.length);
    assert(typeof extra.chunks === "number");
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

Deno.test("a chapter with no words is refused rather than billed as an empty job", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf("   \n\n  \t  ") });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(status, 422);
    assertEquals(body.code, "chapter_has_no_narratable_text");
    assertEquals(state.calls.runpodRun, 0);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a fresh claim clears the parts an abandoned attempt left behind", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf(longChapter(13_382)) });
    // An earlier attempt got one chunk in and then stalled. Resuming onto it
    // would splice whatever the prose said THEN onto what it says now.
    state.stagedParts = [`${STORY_ID}/${CHAPTER_ID}/parts/aria.00.mp3`];

    await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(state.calls.partsRemoved, [
      `${STORY_ID}/${CHAPTER_ID}/parts/aria.00.mp3`,
    ]);
    assertEquals(state.stagedParts, []);
    // ...and the pipeline restarts at chunk 0.
    assertEquals(state.calls.runpodRun, 1);
    assert(
      state.chapter!.content.startsWith(state.calls.runpodRunPrompts[0]),
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a cached narration of a now-oversized chapter still replays for free", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    // The length check sits after the cache lookups on purpose: a chapter that
    // was narrated and then edited longer must keep playing what it has.
    const state = newState({
      chapter: chapterOf(longChapter(MAX_NARRATION_CHARS + 10_000)),
    });
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
      voice_id: "aria",
    });

    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    assertEquals(body.cached, true);
    assertEquals(state.calls.runpodRun, 0);
  } finally {
    restoreEnv(env);
  }
});

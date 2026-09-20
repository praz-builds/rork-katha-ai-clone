// `audio-status` is the only function on this path allowed to poll a
// provider job, and only because the job id it polls came off a
// `chapter_audio` row the caller is already entitled to read. These tests
// prove the four outcomes a poll can produce: ready and already-uploaded,
// nothing to poll yet, a fresh ready result that gets uploaded and marked, and
// a failure that gets recorded rather than silently retried forever.
import {
  assert,
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

interface ChunkFixture {
  id: string;
  chapter_audio_id: string;
  chunk_index: number;
  provider_job_id: string | null;
  storage_path: string | null;
  status: "pending" | "ready" | "failed";
  duration_seconds?: number | null;
  char_count?: number | null;
  error_code?: string | null;
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
  /**
   * `chapter_audio_chunks` (migration 00095), in playback order.
   *
   * Their presence is what tells `audio-status` which pipeline it is
   * finishing: rows mean every chunk was started at once and this poll
   * reconciles them all; no rows means a single-chunk chapter or a job
   * started by the deploy before 00095, and the legacy one-chunk-per-poll
   * branch must handle it exactly as it always did.
   */
  chunkRows: ChunkFixture[];
  /** Provider status per job id; falls back to `runpodStatusResponse`. */
  runpodStatusByJob: Record<string, {
    status: string;
    output?: Record<string, unknown>;
    error?: string;
  }>;
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
  /**
   * The `audio` bucket, as an object store. The multi-request narration
   * pipeline keeps its whole state here -- the staged parts ARE the record of
   * which chunk is next -- so a fixture that only counted uploads could not
   * exercise it.
   */
  storage: Map<string, Uint8Array>;
  /** Provider jobs started from inside `audio-status`, in order. */
  runpodRuns: Array<{ prompt: string; jobId: string }>;
  runpodCancels: string[];
  /** How many jobs `/run` has handed out, so each gets a distinct id. */
  nextJobId: number;
  /** Forces `/run` to refuse, for the chunk-start failure path. */
  failNextRun: boolean;
  /** The query string of each PATCH, so a compare-and-swap filter is provable. */
  patchQueries: string[];
  /** Makes the staged-parts listing fail, the way a transient storage error does. */
  failPartsList: boolean;
  /**
   * Makes the "am I still the owner of this row" check lose, as it does when a
   * ten-minute-stale claim has been taken over by a fresh run.
   */
  ownershipLost: boolean;
  /**
   * Simulates another poll winning the final assembly: the first staged part
   * downloaded vanishes and the row is already `ready` when it is looked at.
   */
  publishRaceWinner: boolean;
  /**
   * A fresh run takes this (chapter, voice) over while the stitch is being
   * assembled -- the ten-minute re-claim of 00054, or an `edit-story` -- by
   * moving the parent row's `provider_job_id` to a job this poll never
   * started.
   *
   * `"download"` fires it while the parts are being read, so the ownership
   * check at the write is what catches it. `"after-check"` fires it in the
   * millisecond AFTER that check passes, which only the compare-and-swap on
   * the publish itself can catch.
   */
  reclaimDuringStitch: "download" | "after-check" | null;
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
    chunkRows: [],
    runpodStatusByJob: {},
    runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
    patches: [],
    staleCountAtPatch: [],
    uploads: 0,
    sentryEvents: [],
    errorEventsInserts: [],
    stalePendingCount: 1,
    staleCountQueries: 0,
    storage: new Map<string, Uint8Array>(),
    runpodRuns: [],
    runpodCancels: [],
    nextJobId: 2,
    failNextRun: false,
    patchQueries: [],
    failPartsList: false,
    ownershipLost: false,
    publishRaceWinner: false,
    reclaimDuringStitch: null,
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
        state.patchQueries.push(url.search);
        const body = await request.json() as Record<string, unknown>;
        state.patches.push(body);
        // `stillOwnsNarrationJob` is the conditional update that carries
        // nothing but a new `updated_at`. Losing it means a fresh run has
        // taken this row over.
        if (state.ownershipLost && Object.keys(body).join() === "updated_at") {
          return json([]);
        }
        if (
          state.reclaimDuringStitch === "after-check" &&
          Object.keys(body).join() === "updated_at" && state.row
        ) {
          // The check passes -- and the row changes hands immediately after,
          // which is the window a check made before the write cannot close.
          state.row = { ...state.row, provider_job_id: "job-99" };
          return json([{ id: state.row.id }]);
        }
        // `advanceNarrationJob` is a compare-and-swap: it filters on the job
        // id it expects to still be there and reads the returned rows to find
        // out whether it won. A fixture that always answered `[]` would make
        // every caller believe it lost, so the filter is honoured here.
        const expectedJob = url.searchParams.get("provider_job_id")?.replace(
          /^eq\./,
          "",
        );
        if (expectedJob && state.row?.provider_job_id !== expectedJob) {
          return json([]);
        }
        if (state.row) {
          state.row = { ...state.row, ...body } as ChapterAudioFixture;
        }
        return json(state.row ? [{ id: state.row.id }] : []);
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

    // `chapter_audio_chunks`: one row per provider request (migration 00095).
    if (url.pathname === "/rest/v1/chapter_audio_chunks") {
      if (request.method === "PATCH") {
        state.patchQueries.push(url.search);
        const body = await request.json() as Record<string, unknown>;
        state.patches.push({ table: "chapter_audio_chunks", ...body });
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const row = state.chunkRows.find((chunk) => chunk.id === id);
        if (!row) return json([]);
        // Both writers are compare-and-swaps, so the filters are honoured: a
        // fixture that always answered with a row would make every caller
        // believe it won, and two overlapping polls would both advance.
        const expectedJob = url.searchParams.get("provider_job_id");
        if (expectedJob === "is.null" && row.provider_job_id !== null) {
          return json([]);
        }
        if (
          expectedJob && expectedJob !== "is.null" &&
          row.provider_job_id !== expectedJob.replace(/^eq\./, "")
        ) {
          return json([]);
        }
        const expectedStatus = url.searchParams.get("status")?.replace(
          /^eq\./,
          "",
        );
        if (expectedStatus && row.status !== expectedStatus) return json([]);
        Object.assign(row, body);
        return json([{ id: row.id }]);
      }
      const parent = url.searchParams.get("chapter_audio_id")?.replace(
        /^eq\./,
        "",
      );
      return json(
        state.chunkRows
          .filter((chunk) => !parent || chunk.chapter_audio_id === parent)
          .slice()
          .sort((a, b) => a.chunk_index - b.chunk_index),
      );
    }

    if (
      url.href.startsWith(
        "https://api.runpod.ai/v2/minimax-speech-02-hd/status/",
      )
    ) {
      const jobId = url.href.split("/status/")[1];
      return json(
        state.runpodStatusByJob[jobId] ?? state.runpodStatusResponse(),
      );
    }

    if (
      url.href.startsWith("https://api.runpod.ai/v2/minimax-speech-02-hd/run")
    ) {
      if (state.failNextRun) return json({ error: "no capacity" }, 503);
      const body = await request.json() as { input: { prompt: string } };
      const jobId = `job-${state.nextJobId}`;
      state.nextJobId += 1;
      state.runpodRuns.push({ prompt: body.input.prompt, jobId });
      return json({ id: jobId });
    }

    if (
      url.href.startsWith(
        "https://api.runpod.ai/v2/minimax-speech-02-hd/cancel/",
      )
    ) {
      state.runpodCancels.push(url.href.split("/cancel/")[1]);
      return json({ status: "CANCELLED" });
    }

    // The `audio` bucket. `list` is a POST to its own path, so it is matched
    // before the object routes below.
    if (url.pathname === "/storage/v1/object/list/audio") {
      if (state.failPartsList) {
        return json({ message: "storage is having a moment" }, 500);
      }
      const body = await request.json() as { prefix?: string };
      const prefix = body.prefix ? `${body.prefix}/` : "";
      const names = new Set<string>();
      for (const key of state.storage.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        names.add(rest);
      }
      return json([...names].sort().map((name) => ({ name })));
    }

    if (url.pathname.startsWith("/storage/v1/object/")) {
      const objectPath = decodeURIComponent(
        url.pathname
          .replace("/storage/v1/object/", "")
          .replace(/^(authenticated|public|sign)\//, "")
          .replace(/^audio\//, ""),
      );
      if (request.method === "POST" || request.method === "PUT") {
        state.uploads += 1;
        state.storage.set(
          objectPath,
          new Uint8Array(await request.arrayBuffer()),
        );
        return json({ Key: `audio/${objectPath}` });
      }
      if (request.method === "GET") {
        if (state.reclaimDuringStitch === "download" && state.row) {
          state.row = { ...state.row, provider_job_id: "job-99" };
        }
        if (state.publishRaceWinner) {
          // The other poll assembled, published and deleted the staged parts
          // while this one was downloading them.
          state.storage.delete(objectPath);
          state.storage.set(FINAL_PATH, new Uint8Array([1]));
          if (state.row) {
            state.row = {
              ...state.row,
              status: "ready",
              storage_path: FINAL_PATH,
            };
          }
        }
        const bytes = state.storage.get(objectPath);
        if (!bytes) return json({ message: "Object not found" }, 404);
        return new Response(bytes.slice().buffer as ArrayBuffer, {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      if (request.method === "DELETE") {
        const body = await request.json() as { prefixes?: string[] };
        for (const path of body.prefixes ?? []) state.storage.delete(path);
        return json([]);
      }
      return json({ message: "unsupported storage method" }, 405);
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

// --- Multi-request narration ------------------------------------------------
//
// The reason this exists: MiniMax `speech-02-hd` accepted 9,849 characters and
// refused 10,105 on production RunPod (2026-09-19), while `MAX_NARRATION_CHARS`
// was 40,000. 133 of 354 live published chapters -- 37.6% -- were therefore
// accepted, billed, and failed in the reader's hands with no retry that could
// ever succeed. These tests cover the pipeline that makes those chapters play.

/** One MPEG1 Layer III / 128 kbps / 32 kHz / mono frame, as MiniMax emits. */
function mp3Frame(fill: number): Uint8Array {
  const bytes = new Uint8Array(576).fill(fill);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = 0x98;
  bytes[3] = 0xc4;
  return bytes;
}

/** A provider response: an ID3v2 tag, a Xing header frame, then audio. */
function providerMp3(frames: number, fill: number): Uint8Array {
  const tag = new Uint8Array(1140);
  tag[0] = 0x49;
  tag[1] = 0x44;
  tag[2] = 0x33;
  tag[3] = 0x04;
  tag[8] = (1130 >> 7) & 0x7f;
  tag[9] = 1130 & 0x7f;

  const xing = mp3Frame(0);
  xing.set([0x58, 0x69, 0x6e, 0x67], 36); // "Xing"

  const out = new Uint8Array(tag.length + 576 * (frames + 1));
  out.set(tag, 0);
  out.set(xing, tag.length);
  for (let i = 0; i < frames; i += 1) {
    out.set(mp3Frame((fill + i) & 0xff), tag.length + 576 * (i + 1));
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Prose of a given length, shaped like a generated chapter. */
function longChapter(chars: number): string {
  const paragraph =
    "The lamp guttered and she counted the coins again, slower this time. "
      .repeat(6) + "\n\n";
  let text = "";
  while (text.length < chars) text += paragraph;
  return text.slice(0, chars);
}

const PARTS_PREFIX = `${STORY_ID}/${CHAPTER_ID}/parts`;
const FINAL_PATH = `${STORY_ID}/${CHAPTER_ID}/aria.mp3`;

/** A `pending` row for the default voice, mid-pipeline on `jobId`. */
function pendingRow(jobId: string): ChapterAudioFixture {
  return {
    id: "audio-1",
    chapter_id: CHAPTER_ID,
    voice_id: "aria",
    storage_path: FINAL_PATH,
    provider_job_id: jobId,
    status: "pending",
  };
}

/** A chapter at the live library's p90 length: 13,382 characters. */
function p90Chapter() {
  return {
    id: CHAPTER_ID,
    story_id: STORY_ID,
    content: longChapter(13_382),
    word_count: 2_100,
    audio_url: null,
    is_published: false,
  };
}

Deno.test("a chapter too long for one request narrates its first part and starts the second", async () => {
  const env = setTestEnv();
  try {
    const chapter = p90Chapter();
    const state = newState({
      chapter,
      row: pendingRow("job-1"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(10, 0x10)) },
      }),
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "PENDING");
    assertEquals(result.json.chunks, 2);
    assertEquals(result.json.chunks_done, 1);

    // Part 0 is staged, and the finished file does NOT exist yet: a reader
    // must never be handed half a chapter.
    assertEquals([...state.storage.keys()], [`${PARTS_PREFIX}/aria.00.mp3`]);
    assertFalse(state.storage.has(FINAL_PATH));

    // The second provider request carries the rest of the chapter, and it is
    // under the limit that refused the whole thing.
    assertEquals(state.runpodRuns.length, 1);
    const sent = state.runpodRuns[0].prompt;
    assertEquals(sent.length < 10_000, true);
    assertEquals(chapter.content.endsWith(sent), true);

    // The row now points at the new job, and its clock was restarted so a
    // working pipeline is not declared abandoned partway through.
    const patch = state.patches.at(-1)!;
    assertEquals(patch.provider_job_id, "job-2");
    // ...and the handover is a compare-and-swap on the job that just finished,
    // so two overlapping polls cannot both start the next chunk and leave one
    // provider job running with nothing pointing at it.
    assert(state.patchQueries.at(-1)!.includes("provider_job_id=eq.job-1"));
    assertEquals(patch.status, "pending");
    assertEquals(typeof patch.updated_at, "string");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("the last part is stitched to the earlier ones and published as one playable file", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      chapter: p90Chapter(),
      row: pendingRow("job-2"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(7, 0x40)) },
      }),
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "COMPLETED");
    assertEquals(result.json.chunks, 2);

    // One file at the stable path, and the staged parts are gone.
    assertEquals([...state.storage.keys()], [FINAL_PATH]);

    // The proof this is one audio stream and not two files glued together:
    // 10 + 7 audio frames, plus the single `Info` header frame written for the
    // joined stream. Both parts' ID3 tags and both their Xing frames are gone,
    // so the file declares the WHOLE chapter's length rather than the first
    // part's -- which is what makes it scrub correctly on a phone.
    const finished = state.storage.get(FINAL_PATH)!;
    assertEquals(finished.length, (17 + 1) * 576);
    assertEquals(finished[0], 0xff);
    const declaredFrames = new DataView(
      finished.buffer,
      finished.byteOffset,
    ).getUint32(21 + 8);
    assertEquals(declaredFrames, 17);

    // ...and the duration is written from those frames. RunPod returns none,
    // so this column has been null on every narration ever made.
    const ready = state.patches.find((patch) => patch.status === "ready")!;
    assertEquals(ready.duration_seconds, (17 * 1152) / 32000);
    assertEquals(ready.storage_path, FINAL_PATH);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a lost part fails the narration rather than publishing a chapter with a hole", async () => {
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  resetSentryForTests();
  try {
    const state = newState({
      chapter: p90Chapter(),
      row: pendingRow("job-2"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(7, 0x40)) },
      }),
    });
    // Part 1 exists and part 0 does not. Assembling around the gap would hand
    // the reader a chapter with a scene missing from the middle, and nothing
    // downstream could tell.
    state.storage.set(`${PARTS_PREFIX}/aria.01.mp3`, providerMp3(3, 0x20));

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "FAILED");
    assertEquals(result.json.error_code, "narration_parts_out_of_order");
    assertFalse(state.storage.has(FINAL_PATH));

    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.bucket, "generation.audio");
    assertEquals(tags.error_code, "narration_parts_out_of_order");
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

Deno.test("a provider that will not take the next chunk fails the narration and clears the staging", async () => {
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  resetSentryForTests();
  try {
    const state = newState({
      chapter: p90Chapter(),
      row: pendingRow("job-1"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(10, 0x10)) },
      }),
      failNextRun: true,
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "FAILED");
    assertEquals(result.json.error_code, "narration_chunk_start_failed");
    // Nothing is left staged: a retry rebuilds from chunk 0 rather than
    // resuming onto parts whose prose may have changed in the meantime.
    assertEquals([...state.storage.keys()], []);

    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.error_code, "narration_chunk_start_failed");
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

Deno.test("a short chapter is still one request, and now carries a real duration", async () => {
  const env = setTestEnv();
  try {
    // 62% of the library already worked. It must keep working, unchanged, and
    // must not start costing two provider calls.
    const state = newState({
      chapter: {
        id: CHAPTER_ID,
        story_id: STORY_ID,
        content: longChapter(9_000),
        word_count: 1_500,
        audio_url: null,
        is_published: false,
      },
      row: pendingRow("job-1"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(12, 0x10)) },
      }),
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "COMPLETED");
    assertEquals(state.runpodRuns.length, 0);
    assertEquals([...state.storage.keys()], [FINAL_PATH]);
    const ready = state.patches.find((patch) => patch.status === "ready")!;
    assertEquals(ready.duration_seconds, (12 * 1152) / 32000);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("the provider's length refusal is recorded as itself, not as unclassified_error", async () => {
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  resetSentryForTests();
  try {
    const state = newState({
      chapter: p90Chapter(),
      row: pendingRow("job-1"),
      // RunPod reports this as an English sentence. `safeErrorCode` is right
      // to refuse to publish provider prose to readers, and it stays -- but
      // for five production occurrences from 2026-09-15 onwards it meant the
      // single most common narration failure was indistinguishable from an
      // unknown one.
      runpodStatusResponse: () => ({
        status: "FAILED",
        error: "Input text exceeds the maximum length of 10000 characters.",
      }),
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "FAILED");
    assertEquals(result.json.error_code, "narration_provider_char_limit");
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.error_code, "narration_provider_char_limit");
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

// --- Review findings, pinned so they cannot come back -----------------------

Deno.test("a storage listing that fails is not read as 'no parts yet'", async () => {
  const env = setTestEnv();
  try {
    // The bug this prevents: parts 0 and 1 are staged, the listing errors, and
    // an empty list is taken at face value -- so chunk 2's audio is written
    // over part 0 and the pipeline restarts from chunk 1. The finished chapter
    // repeats its opening, loses its middle, and is published `ready` with
    // nothing anywhere reporting a problem.
    const state = newState({
      chapter: p90Chapter(),
      row: pendingRow("job-2"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(7, 0x40)) },
      }),
      failPartsList: true,
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));

    const result = await run(state, QUERY);

    // Nothing is decided and nothing is touched: the provider job is still
    // COMPLETED, so the next poll simply reads it again.
    assertEquals(result.json.status, "PENDING");
    assertEquals([...state.storage.keys()], [`${PARTS_PREFIX}/aria.00.mp3`]);
    assertEquals(state.runpodRuns.length, 0);
    assertFalse(state.storage.has(FINAL_PATH));
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a poll that has lost its row to a fresh run writes nothing into its staging", async () => {
  const env = setTestEnv();
  try {
    // A claim left pending for ten minutes is re-claimable, so `generate-audio`
    // can clear the staging and restart at chunk 0 while an older poll is
    // still in flight. If that poll uploaded its part anyway, the new run
    // would count one part too many and write every later chunk one slot too
    // high -- a chapter that repeats its opening and loses its ending.
    const state = newState({
      chapter: p90Chapter(),
      row: pendingRow("job-1"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(10, 0x10)) },
      }),
      ownershipLost: true,
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "PENDING");
    assertEquals([...state.storage.keys()], []);
    assertEquals(state.runpodRuns.length, 0);

    // The ownership check is a conditional update, not a read followed by a
    // conclusion -- a reclaim cannot slip between the two.
    const query = state.patchQueries.at(-1)!;
    assert(query.includes("provider_job_id=eq.job-1"));
    assert(query.includes("status=eq.pending"));
  } finally {
    restoreEnv(env);
  }
});

Deno.test("losing the assembly race reports the narration that exists, rather than failing it", async () => {
  const env = setTestEnv();
  try {
    // Two polls both see the last chunk finish. The winner assembles,
    // publishes and deletes the staged parts; the loser is still downloading
    // those parts and gets a 404. Recording that as a failure would flip a
    // `ready` row to `failed` and take a working narration away from the
    // reader -- permanently, because the cache is shared.
    const state = newState({
      chapter: p90Chapter(),
      row: pendingRow("job-2"),
      runpodStatusResponse: () => ({
        status: "COMPLETED",
        output: { audio_base64: base64(providerMp3(7, 0x40)) },
      }),
      publishRaceWinner: true,
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "COMPLETED");
    assert(String(result.json.audio_url).includes(FINAL_PATH));
    // The row is left as the winner published it.
    assertEquals(state.row!.status, "ready");
    assertFalse(state.patches.some((patch) => patch.status === "failed"));
  } finally {
    restoreEnv(env);
  }
});

// --- Continuous narration: every chunk at once, a manifest on every poll -----
//
// The measured problem: a two-chunk chapter took 101.6s to its first second of
// audio on production (2026-09-19) and a three-chunk one ~135s, because chunks
// were synthesised one per poll and nothing was playable until the stitch.
// Every chunk now starts in the same `generate-audio` request and this
// function publishes each part as it lands, so the reader starts on chunk 0
// after roughly one chunk's ~45s whatever the chapter's length.

/** A chapter that splits into exactly three chunks. */
function threeChunkChapter() {
  return {
    id: CHAPTER_ID,
    story_id: STORY_ID,
    content: longChapter(22_000),
    word_count: 3_800,
    audio_url: null,
    is_published: false,
  };
}

function chunkFixture(
  index: number,
  opts: {
    jobId?: string | null;
    ready?: boolean;
    durationSeconds?: number | null;
    charCount?: number | null;
  } = {},
): ChunkFixture {
  return {
    id: `chunk-${index}`,
    chapter_audio_id: "audio-1",
    chunk_index: index,
    provider_job_id: opts.jobId ?? null,
    storage_path: opts.ready ? `${PARTS_PREFIX}/aria.0${index}.mp3` : null,
    status: opts.ready ? "ready" : "pending",
    duration_seconds: opts.durationSeconds ?? null,
    char_count: opts.charCount ?? 8_610,
  };
}

Deno.test("chunk 0 ready and the rest pending answers PENDING with a playable url for chunk 0", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1" }),
        chunkFixture(1, { jobId: "job-11" }),
        chunkFixture(2, { jobId: "job-12" }),
      ],
      runpodStatusByJob: {
        "job-1": {
          status: "COMPLETED",
          output: { audio_base64: base64(providerMp3(10, 0x10)) },
        },
        "job-11": { status: "IN_PROGRESS" },
        "job-12": { status: "IN_PROGRESS" },
      },
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "PENDING");
    assertEquals(result.json.chunks, 3);

    // The whole point: the reader is handed something to play while chunks 1
    // and 2 are still at the provider.
    const manifest = result.json.chunk_manifest as Array<
      Record<string, unknown>
    >;
    assertEquals(manifest.length, 3);
    assertEquals(manifest[0].index, 0);
    assertEquals(manifest[0].ready, true);
    assert(String(manifest[0].url).includes(`${PARTS_PREFIX}/aria.00.mp3`));
    // 10 audio frames at 1,152 samples / 32 kHz, measured from the file's own
    // frames -- RunPod returns no duration at all.
    assertEquals(
      manifest[0].duration_ms,
      Math.round((10 * 1152 / 32000) * 1000),
    );
    assertEquals(manifest[0].char_count, 8_610);
    // A chunk that is not ready is null, never omitted and never a
    // placeholder, so index `i` is always chunk `i`.
    assertEquals(manifest[1].url, null);
    assertEquals(manifest[1].ready, false);
    assertEquals(manifest[2].url, null);

    // Part 0 is staged; the stitched file does not exist yet.
    assertEquals([...state.storage.keys()], [`${PARTS_PREFIX}/aria.00.mp3`]);
    assertFalse(state.storage.has(FINAL_PATH));
    // Nothing was started: all three jobs were already running.
    assertEquals(state.runpodRuns.length, 0);
    // The chunk row moved to ready under a compare-and-swap, so two
    // overlapping polls cannot both advance it.
    assertEquals(state.chunkRows[0].status, "ready");
    const chunkPatch = state.patchQueries.find((query) =>
      query.includes("provider_job_id=eq.job-1") &&
      query.includes("id=eq.chunk-0")
    );
    assert(
      chunkPatch,
      "the chunk update must be a compare-and-swap on its job",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("the last chunk landing stitches once, publishes, and keeps the parts", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1", ready: true, durationSeconds: 0.36 }),
        chunkFixture(1, {
          jobId: "job-11",
          ready: true,
          durationSeconds: 0.18,
        }),
        chunkFixture(2, { jobId: "job-12" }),
      ],
      runpodStatusByJob: {
        "job-12": {
          status: "COMPLETED",
          output: { audio_base64: base64(providerMp3(7, 0x40)) },
        },
      },
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));
    state.storage.set(`${PARTS_PREFIX}/aria.01.mp3`, providerMp3(5, 0x20));

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "COMPLETED");
    assert(String(result.json.audio_url).includes(FINAL_PATH));
    assertEquals(result.json.chunks, 3);

    // One audio stream, not three files glued together: 10 + 5 + 7 audio
    // frames plus the single `Info` header frame written for the joined
    // stream. `concatenateMp3`'s frame count check is the only thing that
    // catches a lost seam, so it stays even though the reader is already
    // listening by now.
    const finished = state.storage.get(FINAL_PATH)!;
    assertEquals(finished.length, (22 + 1) * 576);
    const ready = state.patches.find((patch) =>
      patch.status === "ready" && patch.storage_path === FINAL_PATH
    )!;
    assertEquals(ready.duration_seconds, (22 * 1152) / 32000);

    // **The parts survive.** A reader who started on chunk 0 is still playing
    // those exact URLs at this instant; deleting them here would cut off the
    // person this whole change exists to serve.
    assert(state.storage.has(`${PARTS_PREFIX}/aria.00.mp3`));
    assert(state.storage.has(`${PARTS_PREFIX}/aria.01.mp3`));
    assert(state.storage.has(`${PARTS_PREFIX}/aria.02.mp3`));

    // ...and the completed answer still carries the manifest, so a client that
    // is mid-playthrough is not forced to switch sources on the same poll.
    const manifest = result.json.chunk_manifest as Array<
      Record<string, unknown>
    >;
    assertEquals(manifest.map((entry) => entry.ready), [true, true, true]);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a cached ready row with chunk rows replays with its manifest and no provider call", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      chapter: threeChunkChapter(),
      row: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: FINAL_PATH,
        provider_job_id: null,
        status: "ready",
      },
      chunkRows: [
        chunkFixture(0, { jobId: "job-1", ready: true, durationSeconds: 0.36 }),
        chunkFixture(1, {
          jobId: "job-11",
          ready: true,
          durationSeconds: 0.18,
        }),
      ],
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "COMPLETED");
    assertEquals(result.json.cached, true);
    assertEquals(state.uploads, 0);
    assertEquals(state.patches.length, 0);
    assertEquals(state.runpodRuns.length, 0);
    // The per-chunk durations come back for free on a replay, which is what
    // lets a client bound transcript drift without having been present for
    // the original generation.
    const manifest = result.json.chunk_manifest as Array<
      Record<string, unknown>
    >;
    assertEquals(manifest.length, 2);
    assertEquals(manifest[0].duration_ms, 360);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a chunk left pending with no job id is started once, here", async () => {
  const env = setTestEnv();
  try {
    // `generate-audio` got a transient 503 on this chunk and deliberately did
    // NOT fail the chapter over it: chunk 0 is the only one the reader needs
    // in the first 45 seconds.
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1" }),
        chunkFixture(1, { jobId: null }),
        chunkFixture(2, { jobId: "job-12" }),
      ],
      runpodStatusByJob: {
        "job-1": { status: "IN_PROGRESS" },
        "job-12": { status: "IN_PROGRESS" },
      },
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "PENDING");
    assertEquals(state.runpodRuns.length, 1);
    // It carries chunk 1's own text, re-derived from the stored chapter.
    assert(state.chapter!.content.includes(state.runpodRuns[0].prompt));
    assertEquals(state.chunkRows[1].provider_job_id, "job-2");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a chunk that cannot be started even on the retry fails the narration", async () => {
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  resetSentryForTests();
  try {
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1" }),
        chunkFixture(1, { jobId: null }),
        chunkFixture(2, { jobId: "job-12" }),
      ],
      failNextRun: true,
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "FAILED");
    assertEquals(result.json.error_code, "narration_chunk_start_failed");
    // Every sibling still running is spend nothing will collect now.
    assertEquals(state.runpodCancels.slice().sort(), ["job-1", "job-12"]);
    // The staged parts go on the failure path, as they always have: a retry
    // rebuilds from chunk 0 rather than resuming onto a different revision of
    // the prose.
    assertEquals([...state.storage.keys()], []);
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.error_code, "narration_chunk_start_failed");
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

Deno.test("one chunk's provider failure fails the chapter and cancels its siblings", async () => {
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  resetSentryForTests();
  try {
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1", ready: true, durationSeconds: 0.36 }),
        chunkFixture(1, { jobId: "job-11" }),
        chunkFixture(2, { jobId: "job-12" }),
      ],
      runpodStatusByJob: {
        "job-11": { status: "FAILED", error: "gpu_oom" },
        "job-12": { status: "IN_PROGRESS" },
      },
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "FAILED");
    assertEquals(result.json.error_code, "gpu_oom");
    assertEquals(state.row!.status, "failed");
    assertEquals(state.runpodCancels, ["job-12"]);
    assertFalse(state.storage.has(FINAL_PATH));
    const tags = state.sentryEvents[0].tags as Record<string, unknown>;
    assertEquals(tags.error_code, "gpu_oom");
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

Deno.test("a chunked run that goes stale cancels its siblings and clears its parts, like any other failure", async () => {
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  resetSentryForTests();
  try {
    // A timeout IS a failure, and on this path it has the same two things to
    // clean up as `failNarration` does: up to three paid jobs still at the
    // provider, and a staging prefix a retry must not resume onto. The legacy
    // single-chunk path had neither, which is why marking the row failed used
    // to be the whole of it.
    const state = newState({
      chapter: threeChunkChapter(),
      row: {
        ...pendingRow("job-1"),
        updated_at: isoMsAgo(NARRATION_JOB_STALE_MS + 60_000),
      },
      chunkRows: [
        chunkFixture(0, { jobId: "job-1", ready: true, durationSeconds: 0.36 }),
        chunkFixture(1, { jobId: "job-11" }),
        chunkFixture(2, { jobId: "job-12" }),
      ],
      runpodStatusResponse: () => ({ status: "IN_PROGRESS" }),
      stalePendingCount: 1,
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "FAILED");
    assertEquals(result.json.error_code, "generation_timed_out");
    assertEquals(
      state.runpodCancels.slice().sort(),
      ["job-11", "job-12"],
      "two jobs are still running and nothing will ever collect them",
    );
    assertEquals([...state.storage.keys()], []);
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

Deno.test("a chunk set that no longer matches the chapter's text is refused, not assembled", async () => {
  const env = setTestEnv({ SENTRY_DSN: FAKE_SENTRY_DSN });
  resetSentryForTests();
  try {
    // Two chunk rows, a three-chunk chapter: the prose changed under a
    // narration that was already running, which `edit-story`'s delete of the
    // `chapter_audio` row is supposed to make impossible. Assembling anyway
    // would publish a file spliced from two revisions.
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1", ready: true }),
        chunkFixture(1, { jobId: "job-11" }),
      ],
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "FAILED");
    assertEquals(result.json.error_code, "narration_text_changed");
    assertEquals(state.runpodRuns.length, 0);
  } finally {
    resetSentryForTests();
    restoreEnv(env);
  }
});

Deno.test("a chunked poll that has lost its row to a fresh run writes nothing", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1" }),
        chunkFixture(1, { jobId: "job-11" }),
        chunkFixture(2, { jobId: "job-12" }),
      ],
      runpodStatusByJob: {
        "job-1": {
          status: "COMPLETED",
          output: { audio_base64: base64(providerMp3(10, 0x10)) },
        },
      },
      ownershipLost: true,
    });

    const result = await run(state, QUERY);

    assertEquals(result.json.status, "PENDING");
    assertEquals([...state.storage.keys()], [], "nothing may be staged");
    assertEquals(state.chunkRows[0].status, "pending");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a poll that lost the run while stitching does not overwrite the live run's file", async () => {
  const env = setTestEnv();
  try {
    // Every chunk is already `ready`, so this poll does nothing but assemble
    // and publish -- which is precisely the path where the ownership check
    // used to be skipped entirely: it lived behind "did anything finish this
    // time", and nothing did.
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1", ready: true, durationSeconds: 0.36 }),
        chunkFixture(1, {
          jobId: "job-11",
          ready: true,
          durationSeconds: 0.18,
        }),
        chunkFixture(2, {
          jobId: "job-12",
          ready: true,
          durationSeconds: 0.25,
        }),
      ],
      reclaimDuringStitch: "download",
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));
    state.storage.set(`${PARTS_PREFIX}/aria.01.mp3`, providerMp3(5, 0x20));
    state.storage.set(`${PARTS_PREFIX}/aria.02.mp3`, providerMp3(7, 0x40));

    const result = await run(state, QUERY);

    // **Nothing was published.** The stable path is the permanent, cached URL
    // every later reader is served; writing this run's stitch there would hand
    // a reader audio from a superseded attempt, of possibly different prose,
    // under a row that says it succeeded.
    assertFalse(state.storage.has(FINAL_PATH), "the stable path is untouched");
    assertEquals(state.row!.status, "pending");

    // And it fails nothing: the row belongs to the run that took it over, and
    // that run is doing this same work.
    assertEquals(result.json.status, "PENDING");
    assertEquals(state.row!.error_code ?? null, null);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("losing the run between the ownership check and the write cannot mark somebody else's row ready", async () => {
  const env = setTestEnv();
  try {
    const state = newState({
      chapter: threeChunkChapter(),
      row: pendingRow("job-1"),
      chunkRows: [
        chunkFixture(0, { jobId: "job-1", ready: true, durationSeconds: 0.36 }),
        chunkFixture(1, {
          jobId: "job-11",
          ready: true,
          durationSeconds: 0.18,
        }),
        chunkFixture(2, {
          jobId: "job-12",
          ready: true,
          durationSeconds: 0.25,
        }),
      ],
      // The takeover lands in the instant after the check passes. Only a
      // compare-and-swap on the publish itself sees it.
      reclaimDuringStitch: "after-check",
    });
    state.storage.set(`${PARTS_PREFIX}/aria.00.mp3`, providerMp3(10, 0x10));
    state.storage.set(`${PARTS_PREFIX}/aria.01.mp3`, providerMp3(5, 0x20));
    state.storage.set(`${PARTS_PREFIX}/aria.02.mp3`, providerMp3(7, 0x40));

    const result = await run(state, QUERY);

    // The row stays pending and stays the other run's. A `ready` here is the
    // damaging half of this: a reader would be sent to the stable URL by a row
    // claiming a narration this poll no longer owns.
    assertEquals(state.row!.status, "pending");
    assertEquals(state.row!.provider_job_id, "job-99");
    assertEquals(result.json.status, "PENDING");
    // The stitched bytes did get written -- a check and a write cannot be one
    // instruction against a REST API, and closing that last millisecond would
    // need a per-run token on the row, which is a migration this change does
    // without. What the compare-and-swap guarantees is that no ROW ever
    // points a reader at them: the run that owns the claim publishes its own
    // stitch to the same path on its next poll.
    assertEquals(
      state.row!.storage_path,
      FINAL_PATH,
      "unchanged from the claim",
    );
    assertEquals(state.row!.status, "pending", "never published");
  } finally {
    restoreEnv(env);
  }
});

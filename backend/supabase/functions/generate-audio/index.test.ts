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
  EDGE_TTS_MAX_NARRATION_CHARS,
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
  /**
   * Simulate a second reader's `audio-status` poll adopting the parent row's
   * job id onto chunk 0 the moment `markChapterAudioJobStarted` writes it.
   *
   * That is the real ordering (`audio-status/index.ts`, the chunk-0 adopt
   * branch), and it is the one that makes this function's own chunk-0
   * compare-and-swap fail against an id that is ITS OWN.
   */
  adoptChunkZeroOnJobStart: boolean;
  sentryEvents: Array<Record<string, unknown>>;
  errorEventsInserts: Array<Record<string, unknown>>;
  /** Part objects left in the `audio` bucket by an earlier, abandoned attempt. */
  stagedParts: string[];
  /**
   * `chapter_audio_chunks`, keyed by chunk row id.
   *
   * The whole point of migration 00095: every chunk of a chapter now has its
   * own row and its own provider job id, because they are all started at once
   * and `chapter_audio.provider_job_id` admits exactly one.
   */
  chunkRows: Map<string, {
    id: string;
    chapter_audio_id: string;
    chunk_index: number;
    char_count: number | null;
    provider_job_id: string | null;
    status: string;
  }>;
  /**
   * Which `/run` calls refuse, by the zero-based order they are made in.
   *
   * Chunk 0 failing to start must kill the narration; a later chunk failing
   * must not, and the two are only distinguishable if the fixture can refuse
   * one particular request.
   */
  failRunsAt: number[];
  calls: {
    rpc: number;
    chunkRpc: number;
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
    adoptChunkZeroOnJobStart: false,
    sentryEvents: [],
    errorEventsInserts: [],
    stagedParts: [],
    chunkRows: new Map(),
    failRunsAt: [],
    calls: {
      rpc: 0,
      chunkRpc: 0,
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
        if (
          state.adoptChunkZeroOnJobStart &&
          typeof body.provider_job_id === "string"
        ) {
          for (const [id, chunk] of state.chunkRows) {
            if (chunk.chunk_index !== 0) continue;
            state.chunkRows.set(id, {
              ...chunk,
              provider_job_id: body.provider_job_id as string,
            });
          }
        }
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

    // `chapter_audio_chunks`: one row per provider request (migration 00095).
    if (url.pathname === "/rest/v1/chapter_audio_chunks") {
      if (request.method === "PATCH") {
        const body = await request.json() as Record<string, unknown>;
        state.calls.patches.push({ table: "chapter_audio_chunks", body });
        const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");
        const row = idFilter ? state.chunkRows.get(idFilter) : undefined;
        if (!row) return json([]);
        // `markChapterAudioChunkStarted` is a compare-and-swap on "still
        // pending, still has no job". A fixture that always answered with a
        // row would make every caller believe it won.
        if (
          url.searchParams.get("provider_job_id") === "is.null" &&
          row.provider_job_id !== null
        ) {
          return json([]);
        }
        state.chunkRows.set(idFilter!, { ...row, ...body } as typeof row);
        return json([{ id: row.id }]);
      }
      const parent = url.searchParams.get("chapter_audio_id")?.replace(
        /^eq\./,
        "",
      );
      // `chapterAudioChunkJobId` reads one row by id, which is how a lost
      // compare-and-swap finds out WHOSE job the row is holding.
      const byId = url.searchParams.get("id")?.replace(/^eq\./, "");
      return json(
        [...state.chunkRows.values()]
          .filter((row) => !byId || row.id === byId)
          .filter((row) => !parent || row.chapter_audio_id === parent)
          .sort((a, b) => a.chunk_index - b.chunk_index),
      );
    }

    if (url.pathname === "/rest/v1/rpc/claim_chapter_audio_chunks") {
      state.calls.chunkRpc += 1;
      const body = await request.json() as {
        p_audio_id: string;
        p_count: number;
        p_char_counts: number[] | null;
      };
      // A claim always restarts at chunk 0, so it replaces the set rather
      // than adding to it -- the migration deletes, and so does this.
      for (const [id, row] of [...state.chunkRows]) {
        if (row.chapter_audio_id === body.p_audio_id) {
          state.chunkRows.delete(id);
        }
      }
      const created = [];
      for (let index = 0; index < body.p_count; index += 1) {
        const id = `chunk-${body.p_audio_id}-${index}`;
        const charCount = body.p_char_counts?.[index] ?? null;
        state.chunkRows.set(id, {
          id,
          chapter_audio_id: body.p_audio_id,
          chunk_index: index,
          char_count: charCount,
          provider_job_id: null,
          status: "pending",
        });
        created.push({
          chunk_id: id,
          chunk_index: index,
          char_count: charCount,
          status: "pending",
        });
      }
      return json(created);
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
      const at = state.calls.runpodRun;
      state.calls.runpodRun += 1;
      const runBody = await request.json().catch(() => ({})) as {
        input?: { prompt?: unknown };
      };
      if (typeof runBody?.input?.prompt === "string") {
        state.calls.runpodRunPrompts.push(runBody.input.prompt);
      }
      if (state.failRunsAt.includes(at)) {
        return json({ error: "no capacity" }, 503);
      }
      // A chapter now starts several jobs in one request, so each answer
      // carries its own id -- "which job got cancelled" is otherwise
      // unanswerable. The first keeps the id the older tests assert on.
      const configured = state.runpodRunBody();
      const body = configured.id === "job-xyz" && at > 0
        ? { ...configured, id: `job-${at + 1}` }
        : configured;
      return json(body, state.runpodRunStatus);
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
    // The RETRY's job, not the cancelled one: the fixture hands out a distinct
    // id per `/run` now, because a chapter can start several in one request.
    assertEquals(row?.provider_job_id, "job-2");
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

Deno.test("a chapter the provider would refuse whole starts every chunk at once", async () => {
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
    // Additive, and always empty here: nothing can be ready in the request
    // that started it.
    assertEquals(body.chunks_ready, []);

    // BOTH chunks are at the provider when this request returns. They used to
    // go one per `audio-status` poll, which is why a two-chunk chapter took a
    // measured 101.6s to its first second of audio.
    assertEquals(state.calls.runpodRun, 2);
    assertEquals(state.calls.runpodRunPrompts.length, 2);
    for (const sent of state.calls.runpodRunPrompts) {
      assert(sent.length <= NARRATION_CHUNK_CHARS);
      assert(sent.length < NARRATION_PROVIDER_CHAR_LIMIT);
    }
    // ...and between them they are the whole chapter, in order.
    assertEquals(state.calls.runpodRunPrompts.join(""), content);

    // One chunk row per chunk, each carrying its own job id and its own
    // character count -- `chapter_audio.provider_job_id` admits exactly one
    // id, which is why these rows exist at all.
    const rows = [...state.chunkRows.values()];
    assertEquals(rows.map((row) => row.chunk_index), [0, 1]);
    assertEquals(rows.map((row) => row.provider_job_id), ["job-xyz", "job-2"]);
    assertEquals(
      rows.map((row) => row.char_count),
      state.calls.runpodRunPrompts.map((prompt) => prompt.length),
    );

    // Chunk 0's id is still what the PARENT row holds, so
    // `stillOwnsNarrationJob`, `isNarrationJobStale` and 00054's re-claim all
    // keep reading what they have always read.
    assertEquals(
      state.chapterAudio.get(`${CHAPTER_ID}:aria`)!.provider_job_id,
      "job-xyz",
    );
    assertEquals(body.job_id, "job-xyz");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a three-chunk chapter starts three jobs in ONE request and writes three rows", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    // Past two chunks and inside `MAX_NARRATION_CHARS`. This is the case the
    // old pipeline was worst at: three sequential ~45s jobs, ~135s before the
    // reader heard anything, against a 180s `NARRATION_OVERDUE_MS`.
    const content = longChapter(22_000);
    const state = newState({ chapter: chapterOf(content) });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(status, 202);
    assertEquals(body.chunks, 3);
    assertEquals(state.calls.runpodRun, 3);
    assertEquals(state.calls.chunkRpc, 1);
    assertEquals(
      [...state.chunkRows.values()].map((row) => row.chunk_index),
      [0, 1, 2],
    );
    assertEquals(
      [...state.chunkRows.values()].map((row) => row.provider_job_id),
      ["job-xyz", "job-2", "job-3"],
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a single-chunk chapter writes no chunk rows at all", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    // 62% of the library. It keeps the path it has always had -- one job, one
    // upload, straight to the stable path -- and no chunk rows, which is also
    // what keeps `audio-status`'s legacy branch handling it unchanged.
    const state = newState({ chapter: chapterOf(longChapter(8_900)) });

    const { json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(body.chunks, 1);
    assertEquals(state.calls.runpodRun, 1);
    assertEquals(state.calls.chunkRpc, 0);
    assertEquals(state.chunkRows.size, 0);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("chunk 0 failing to start kills the narration and cancels the chunks that did start", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf(longChapter(13_382)) });
    // The first `/run` refuses. Chunk 1's job is accepted and is now spend
    // with nothing pointing at it, because the claim is about to be released.
    state.failRunsAt = [0];

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(status, 502);
    assertEquals(body.error, "Narration generation failed to start");
    assertEquals(state.calls.runpodCancel, ["job-2"]);
    assertEquals(
      state.chapterAudio.get(`${CHAPTER_ID}:aria`)!.status,
      "failed",
      "the claim must be released so a retry is not blocked for ten minutes",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a concurrent poll adopting chunk 0's job id must not get that job cancelled", async () => {
  // Two readers press Listen at once. This request starts the jobs and writes
  // chunk 0's id to the PARENT row; the other reader's `audio-status` poll,
  // arriving in the window before the chunk-row swap, adopts that id onto the
  // chunk-0 row. The swap here then fails -- against our own id. Cancelling on
  // that boolean cancels the job BOTH rows point at, and the next poll reads
  // CANCELLED, fails the narration, cancels the siblings and deletes the
  // parts: two readers told "Try again", three jobs billed for nothing.
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf(longChapter(13_382)) });
    state.adoptChunkZeroOnJobStart = true;

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(status, 202);
    assertEquals(body.status, "PENDING");
    assertEquals(
      state.calls.runpodCancel,
      [],
      "chunk 0's job is the narration: it must survive its own adoption",
    );
    const rows = [...state.chunkRows.values()].sort((a, b) =>
      a.chunk_index - b.chunk_index
    );
    assertEquals(rows[0].provider_job_id, "job-xyz");
    assertEquals(rows[1].provider_job_id, "job-2");
    assertEquals(
      state.chapterAudio.get(`${CHAPTER_ID}:aria`)!.status,
      "pending",
      "the narration survives",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a LATER chunk failing to start leaves its row pending rather than failing the chapter", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf(longChapter(13_382)) });
    // Chunk 1 gets a transient 503. Chunk 0 -- the only chunk the reader needs
    // in the first 45 seconds -- went through, so killing the chapter here
    // would cost them everything to save one retry.
    state.failRunsAt = [1];

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
    });

    assertEquals(status, 202);
    assertEquals(body.status, "PENDING");
    assertEquals(body.chunks, 2);
    assertEquals(
      state.chapterAudio.get(`${CHAPTER_ID}:aria`)!.status,
      "pending",
    );

    const rows = [...state.chunkRows.values()];
    assertEquals(rows[0].provider_job_id, "job-xyz");
    // Pending with NO job id is exactly the state `audio-status` recognises as
    // "start this one, once".
    assertEquals(rows[1].provider_job_id, null);
    assertEquals(rows[1].status, "pending");
    // Nothing is cancelled: chunk 0's job is the narration.
    assertEquals(state.calls.runpodCancel, []);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a prefetch is refused with 503 before any row is claimed or job started", async () => {
  // The gate ships closed. A prefetch is paid synthesis nobody asked for, so
  // a client bug that prefetches in a loop must be stoppable with an env
  // change rather than an app store release.
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf(longChapter(13_382)) });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
      purpose: "prefetch",
    });

    assertEquals(status, 503);
    assertEquals(body.error, NARRATION_REFUSAL);
    assertEquals(state.calls.rpc, 0, "no claim");
    assertEquals(state.calls.chunkRpc, 0, "no chunk rows");
    assertEquals(state.calls.runpodRun, 0, "no provider spend");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("with NARRATION_PREFETCH_ENABLED set, a prefetch generates like any other narration", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    NARRATION_PREFETCH_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf(longChapter(13_382)) });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
      purpose: "prefetch",
    });

    assertEquals(status, 202);
    assertEquals(body.chunks, 2);
    assertEquals(state.calls.runpodRun, 2);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("an unrecognised purpose is treated as a reader pressing Listen, not as a way past the gate", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
  });
  try {
    const state = newState({ chapter: chapterOf(longChapter(8_900)) });

    const { status } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "aria",
      purpose: "something_else",
    });

    assertEquals(status, 202);
    assertEquals(state.calls.runpodRun, 1);
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
    // ...and the pipeline restarts at chunk 0, with a fresh chunk set.
    assertEquals(state.calls.runpodRun, 2);
    assert(
      state.chapter!.content.startsWith(state.calls.runpodRunPrompts[0]),
    );
    assertEquals(
      [...state.chunkRows.values()].map((row) => row.chunk_index),
      [0, 1],
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

Deno.test("an edge-tts voice keeps its own ceiling and is never chunked", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
    EDGE_TTS_SERVICE_URL: "https://edge-tts.test/synthesize",
  });
  try {
    // MiniMax's 10,000-character cap is a MiniMax fact. edge-tts takes the
    // chapter whole in one synchronous call, so applying MiniMax's ceiling to
    // it would be the same category error this change exists to correct: a
    // limit justified against the wrong provider. 30,000 characters is over
    // `MAX_NARRATION_CHARS` and under `EDGE_TTS_MAX_NARRATION_CHARS`.
    const content = longChapter(30_000);
    assert(content.length > MAX_NARRATION_CHARS);
    assert(content.length < EDGE_TTS_MAX_NARRATION_CHARS);

    const state = newState({ chapter: chapterOf(content) });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "elvira",
    });

    assertEquals(status, 200);
    assertEquals(body.status, "COMPLETED");
    // Synthesised whole, in one call, and never sent to RunPod.
    assertEquals(state.calls.edgeTts, 1);
    assertEquals(state.calls.runpodRun, 0);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("an edge-tts chapter past its own ceiling is still refused", async () => {
  const env = setTestEnv({
    NARRATION_GENERATION_ENABLED: "true",
    RUNPOD_API_KEY: "test-runpod-key",
    EDGE_TTS_SERVICE_URL: "https://edge-tts.test/synthesize",
  });
  try {
    const state = newState({
      chapter: chapterOf(longChapter(EDGE_TTS_MAX_NARRATION_CHARS + 1_000)),
    });

    const { status, json: body } = await run(state, {
      story_id: STORY_ID,
      chapter_id: CHAPTER_ID,
      voice_id: "elvira",
    });

    assertEquals(status, 413);
    assertEquals(body.error_code, "chapter_too_long_to_narrate");
    assertEquals(state.calls.edgeTts, 0);
  } finally {
    restoreEnv(env);
  }
});

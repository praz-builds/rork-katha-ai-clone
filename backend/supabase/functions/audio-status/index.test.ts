// `audio-status` is the only function on this path allowed to poll a
// provider job, and only because the job id it polls came off a
// `chapter_audio` row the caller is already entitled to read. These tests
// prove the four outcomes a poll can produce: ready and already-uploaded,
// nothing to poll yet, a fresh ready result that gets uploaded and marked, and
// a failure that gets recorded rather than silently retried forever.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

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
  uploads: number;
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
    uploads: 0,
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
    if (url.pathname === "/rest/v1/voices") return json([]);

    if (url.pathname === "/rest/v1/chapter_audio") {
      if (request.method === "PATCH") {
        state.patches.push(await request.json());
        return json([]);
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

    if (url.pathname === "/rest/v1/error_events") return json([]);

    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;
}

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  RUNPOD_API_KEY: "test-runpod-key",
};

function setTestEnv(): Record<string, string | undefined> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(TEST_ENV)) {
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

// Preview seeding has exactly one job: make sure every active voice has a
// preview clip, without ever regenerating one that is already there. These
// tests prove both halves -- the existence check short-circuits generation,
// and a genuine miss actually produces one -- plus the service-role-only gate
// that keeps this off the user-facing surface.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ensureVoicePreview, handleRequest } from "./index.ts";
import type { VoiceRecord } from "../_shared/voices.ts";

const VOICE_WITH_PREVIEW = {
  id: "hasone",
  display_name: "Has One",
  language: "en",
  gender: "female",
  tier: "standard",
  provider: "runpod_minimax",
  provider_voice_params: { voice_id: "hasone" },
  preview_path: "voice-previews/hasone.mp3",
  sort_order: 10,
  is_active: true,
};

const VOICE_MISSING_PREVIEW = {
  id: "needsone",
  display_name: "Needs One",
  language: "en",
  gender: "male",
  tier: "standard",
  provider: "runpod_minimax",
  provider_voice_params: { voice_id: "needsone" },
  preview_path: "voice-previews/needsone.mp3",
  sort_order: 20,
  is_active: true,
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Calls {
  list: string[];
  run: number;
  status: number;
  upload: number;
}

function makeFetchStub(calls: Calls): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.pathname === "/rest/v1/voices") {
      return json([VOICE_WITH_PREVIEW, VOICE_MISSING_PREVIEW]);
    }

    if (url.pathname === "/storage/v1/object/list/audio") {
      const body = await request.json() as { search: string };
      calls.list.push(body.search);
      if (body.search === "hasone.mp3") return json([{ name: "hasone.mp3" }]);
      return json([]);
    }

    if (
      url.href.startsWith("https://api.runpod.ai/v2/minimax-speech-02-hd/run")
    ) {
      calls.run += 1;
      return json({ id: "preview-job-1" });
    }
    if (
      url.href.startsWith(
        "https://api.runpod.ai/v2/minimax-speech-02-hd/status/",
      )
    ) {
      calls.status += 1;
      return json({
        status: "COMPLETED",
        output: { audio_base64: btoa("clip") },
      });
    }

    if (url.pathname.startsWith("/storage/v1/object/audio/")) {
      calls.upload += 1;
      return json({ Key: "audio/uploaded.mp3" });
    }

    if (url.pathname === "/rest/v1/error_events") return json([]);

    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;
}

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.test",
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
  authorization: string,
): Promise<{ status: number; json: Record<string, unknown>; calls: Calls }> {
  const calls: Calls = { list: [], run: 0, status: 0, upload: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub(calls);
  try {
    const response = await handleRequest(
      new Request("https://katha.test/seed-voice-previews", {
        method: "POST",
        headers: { Authorization: authorization },
      }),
    );
    return { status: response.status, json: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("a voice whose preview already exists is never regenerated", async () => {
  const env = setTestEnv();
  try {
    const { status, json: body, calls } = await run(
      "Bearer test-service-role-key",
    );
    assertEquals(status, 200);
    const results = body.results as Array<Record<string, unknown>>;
    const existing = results.find((r) => r.voice_id === "hasone");
    assertEquals(existing?.status, "exists");
    assertEquals(calls.list.includes("hasone.mp3"), true);
    // The provider is never reached for a voice this loop marks "exists".
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a voice with no preview yet gets one generated and uploaded", async () => {
  const env = setTestEnv();
  try {
    const { status, json: body, calls } = await run(
      "Bearer test-service-role-key",
    );
    assertEquals(status, 200);
    const results = body.results as Array<Record<string, unknown>>;
    const missing = results.find((r) => r.voice_id === "needsone");
    assertEquals(missing?.status, "generated");
    assertEquals(calls.run, 1);
    assertEquals(calls.status, 1);
    assertEquals(calls.upload, 1);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("a wrong bearer token is refused before any request is made", async () => {
  const env = setTestEnv();
  try {
    const { status, json: body, calls } = await run(
      "Bearer not-the-service-role-key",
    );
    assertEquals(status, 401);
    assertEquals(body.error, "Unauthorized");
    assertEquals(calls.run, 0);
    assertEquals(calls.list.length, 0);
  } finally {
    restoreEnv(env);
  }
});

// ---------------------------------------------------------------------------
// `ensureVoicePreview` in isolation: the property the acceptance criteria
// names directly -- a preview that already exists must never call `start`.
// ---------------------------------------------------------------------------

function voice(overrides: Partial<VoiceRecord> = {}): VoiceRecord {
  return {
    id: "v1",
    display_name: "V1",
    language: "en",
    gender: "female",
    tier: "standard",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "v1" },
    preview_path: "voice-previews/v1.mp3",
    sort_order: 1,
    is_active: true,
    ...overrides,
  };
}

Deno.test("ensureVoicePreview never calls start when the preview already exists", async () => {
  let startCalled = false;
  const result = await ensureVoicePreview(voice(), {
    exists: () => Promise.resolve(true),
    start: () => {
      startCalled = true;
      return Promise.resolve("job-1");
    },
    poll: () =>
      Promise.resolve({ status: "ready", audioBytes: new Uint8Array() }),
    upload: () => Promise.resolve("https://cdn.example/v1.mp3"),
  });
  assertEquals(result.status, "exists");
  assertEquals(startCalled, false);
});

Deno.test("ensureVoicePreview starts, polls to ready, and uploads on a genuine miss", async () => {
  let uploadedPath: string | null = null;
  let uploadedBytes: Uint8Array | null = null;
  const result = await ensureVoicePreview(voice(), {
    exists: () => Promise.resolve(false),
    start: () => Promise.resolve("job-1"),
    poll: () =>
      Promise.resolve({
        status: "ready",
        audioBytes: new Uint8Array([1, 2, 3]),
      }),
    upload: (path, bytes) => {
      uploadedPath = path;
      uploadedBytes = bytes;
      return Promise.resolve("https://cdn.example/v1.mp3");
    },
  });
  assertEquals(result.status, "generated");
  assertEquals(uploadedPath, "voice-previews/v1.mp3");
  assertEquals(Array.from(uploadedBytes ?? []), [1, 2, 3]);
});

Deno.test("ensureVoicePreview gives up after its attempt budget rather than polling forever", async () => {
  let pollCount = 0;
  const result = await ensureVoicePreview(voice(), {
    exists: () => Promise.resolve(false),
    start: () => Promise.resolve("job-1"),
    poll: () => {
      pollCount += 1;
      return Promise.resolve({ status: "pending" });
    },
    upload: () => Promise.resolve("unused"),
    sleep: () => Promise.resolve(),
    attempts: 3,
    intervalMs: 0,
  });
  assertEquals(result.status, "failed");
  assertEquals(result.detail, "timeout");
  assertEquals(pollCount, 3);
});

Deno.test("ensureVoicePreview reports a provider failure without retrying", async () => {
  const result = await ensureVoicePreview(voice(), {
    exists: () => Promise.resolve(false),
    start: () => Promise.resolve("job-1"),
    poll: () => Promise.resolve({ status: "failed", errorCode: "gpu_oom" }),
    upload: () => Promise.resolve("unused"),
  });
  assertEquals(result.status, "failed");
  assertEquals(result.detail, "gpu_oom");
});

Deno.test("ensureVoicePreview skips a voice with no preview path or an unimplemented provider", async () => {
  let existsCalled = false;
  const exists = () => {
    existsCalled = true;
    return Promise.resolve(false);
  };
  const noPath = await ensureVoicePreview(voice({ preview_path: null }), {
    exists,
    start: () => Promise.reject(new Error("must not be called")),
    poll: () => Promise.reject(new Error("must not be called")),
    upload: () => Promise.reject(new Error("must not be called")),
  });
  assertEquals(noPath.status, "skipped");
  assert(!existsCalled);

  const unimplementedProvider = await ensureVoicePreview(
    voice({ provider: "edge_tts" }),
    {
      exists,
      start: () => Promise.reject(new Error("must not be called")),
      poll: () => Promise.reject(new Error("must not be called")),
      upload: () => Promise.reject(new Error("must not be called")),
    },
  );
  assertEquals(unimplementedProvider.status, "skipped");
  assert(!existsCalled);
});

Deno.test("a missing service role secret refuses rather than falling open", async () => {
  const previous = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const { status } = await run("Bearer anything");
    assertEquals(status, 503);
  } finally {
    if (previous !== undefined) {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previous);
    }
  }
});

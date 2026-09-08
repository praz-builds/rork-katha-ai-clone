// Two layers: pure decision logic that needs no network, and the RunPod
// request/response shaping, proven against a stubbed `fetch` the way
// `runpod.test.ts` proves the URL-building half of the same contract. The
// database-touching helpers (`claimChapterAudioGeneration`,
// `markChapterAudio*`, `findReadyChapterAudio`, `uploadAudio`,
// `publicAudioUrl`) are exercised at the HTTP layer in
// `generate-audio/index.test.ts` and `audio-status/index.test.ts`, where a
// real `createClient()` against a stubbed `fetch` proves the actual
// PostgREST/RPC wire shape rather than a hand-typed stand-in for it.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canReadChapter,
  isNarrationJobStale,
  NARRATION_JOB_STALE_MS,
  normalizeAudioStatus,
  pollRunpodNarration,
  stableChapterAudioPath,
  stableVoicePreviewPath,
  startRunpodNarration,
  storageObjectExists,
  wordCountAtGeneration,
} from "./narration-audio.ts";
import type {
  ChapterForNarration,
  StoryForNarration,
} from "./narration-audio.ts";
import { RUNPOD_ENDPOINT } from "./runpod.ts";
import type { VoiceRecord } from "./voices.ts";

// ---------------------------------------------------------------------------
// canReadChapter
// ---------------------------------------------------------------------------

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const READER = "22222222-2222-4222-8222-222222222222";

function story(overrides: Partial<StoryForNarration> = {}): StoryForNarration {
  return {
    id: "s1",
    author_id: AUTHOR,
    is_public: false,
    is_curated: false,
    ...overrides,
  };
}

function chapter(
  overrides: Partial<ChapterForNarration> = {},
): ChapterForNarration {
  return {
    id: "c1",
    story_id: "s1",
    content: "Once upon a time.",
    word_count: 4,
    is_published: false,
    ...overrides,
  };
}

Deno.test("the author can always read their own chapter, published or not", () => {
  assertEquals(canReadChapter(AUTHOR, story(), chapter()), true);
  assertEquals(
    canReadChapter(
      AUTHOR,
      story({ is_public: false }),
      chapter({ is_published: false }),
    ),
    true,
  );
});

Deno.test("a reader needs the chapter published AND the story public or curated", () => {
  assertEquals(
    canReadChapter(
      READER,
      story({ is_public: true }),
      chapter({ is_published: true }),
    ),
    true,
  );
  assertEquals(
    canReadChapter(
      READER,
      story({ is_curated: true }),
      chapter({ is_published: true }),
    ),
    true,
  );
  assertEquals(
    canReadChapter(
      READER,
      story({ is_public: true }),
      chapter({ is_published: false }),
    ),
    false,
    "an unpublished chapter is not readable even on a public story",
  );
  assertEquals(
    canReadChapter(
      READER,
      story({ is_public: false, is_curated: false }),
      chapter({ is_published: true }),
    ),
    false,
    "a private story stays private to a non-author",
  );
});

// ---------------------------------------------------------------------------
// wordCountAtGeneration
// ---------------------------------------------------------------------------

Deno.test("wordCountAtGeneration prefers the stored count", () => {
  assertEquals(
    wordCountAtGeneration(chapter({ word_count: 812, content: "x" })),
    812,
  );
});

Deno.test("wordCountAtGeneration falls back to counting words when unset or negative", () => {
  assertEquals(
    wordCountAtGeneration(
      chapter({ word_count: null, content: "one two three" }),
    ),
    3,
  );
  assertEquals(
    wordCountAtGeneration(chapter({ word_count: -1, content: "one two" })),
    2,
  );
});

// ---------------------------------------------------------------------------
// Stable paths
// ---------------------------------------------------------------------------

Deno.test("chapter audio paths are stable and voice-scoped", () => {
  assertEquals(
    stableChapterAudioPath("story-1", "chap-1", "kai"),
    "story-1/chap-1/kai.mp3",
  );
  assertEquals(
    stableChapterAudioPath("story-1", "chap-1"),
    "story-1/chap-1/aria.mp3",
  );
});

Deno.test("voice preview paths live under one shared prefix", () => {
  assertEquals(stableVoicePreviewPath("nova"), "voice-previews/nova.mp3");
});

// ---------------------------------------------------------------------------
// isNarrationJobStale
// ---------------------------------------------------------------------------

Deno.test("a job younger than the stale threshold is not stale", () => {
  const now = Date.parse("2026-01-01T00:10:00.000Z");
  const updatedAt = new Date(now - (NARRATION_JOB_STALE_MS - 1)).toISOString();
  assertEquals(isNarrationJobStale(updatedAt, now), false);
});

Deno.test("a job older than the stale threshold is stale", () => {
  const now = Date.parse("2026-01-01T00:10:00.000Z");
  const updatedAt = new Date(now - (NARRATION_JOB_STALE_MS + 1)).toISOString();
  assertEquals(isNarrationJobStale(updatedAt, now), true);
});

Deno.test("exactly the threshold is not yet stale -- the bound is exclusive", () => {
  const now = Date.parse("2026-01-01T00:10:00.000Z");
  const updatedAt = new Date(now - NARRATION_JOB_STALE_MS).toISOString();
  assertEquals(isNarrationJobStale(updatedAt, now), false);
});

Deno.test("missing or malformed timestamps are never treated as stale", () => {
  const now = Date.parse("2026-01-01T00:10:00.000Z");
  assertEquals(isNarrationJobStale(null, now), false);
  assertEquals(isNarrationJobStale(undefined, now), false);
  assertEquals(isNarrationJobStale("not-a-timestamp", now), false);
});

// ---------------------------------------------------------------------------
// normalizeAudioStatus
// ---------------------------------------------------------------------------

Deno.test("provider status strings normalize to the three states we store", () => {
  for (const value of ["COMPLETED", "ready", "Succeeded", "SUCCESS"]) {
    assertEquals(normalizeAudioStatus(value), "ready");
  }
  for (const value of ["FAILED", "cancelled", "CANCELED", "timed_out"]) {
    assertEquals(normalizeAudioStatus(value), "failed");
  }
  for (const value of ["IN_QUEUE", "IN_PROGRESS", "", undefined, null, 42]) {
    assertEquals(normalizeAudioStatus(value), "pending");
  }
});

// ---------------------------------------------------------------------------
// RunPod I/O, against a stubbed fetch. No network, no supabase client.
// ---------------------------------------------------------------------------

const VOICE: VoiceRecord = {
  id: "aria",
  display_name: "Aria",
  language: "en",
  gender: "female",
  tier: "standard",
  provider: "runpod_minimax",
  provider_voice_params: { voice_id: "aria" },
  preview_path: "voice-previews/aria.mp3",
  sort_order: 10,
  is_active: true,
};

function withEnv(vars: Record<string, string>, run: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

function withFetch(
  handler: (request: Request) => Promise<Response> | Response,
  run: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    return Promise.resolve(handler(request));
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("startRunpodNarration posts text and the voice's provider params, and returns the job id", async () => {
  const captured: Array<{ url: string; body: unknown; auth: string | null }> =
    [];
  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      async (request) => {
        captured.push({
          url: request.url,
          body: await request.json(),
          auth: request.headers.get("Authorization"),
        });
        return new Response(JSON.stringify({ id: "job-123" }), { status: 200 });
      },
      async () => {
        const jobId = await startRunpodNarration({
          text: "Hello there.",
          voice: VOICE,
        });
        assertEquals(jobId, "job-123");
      },
    ));

  assertEquals(captured.length, 1);
  assertEquals(captured[0].url, `${RUNPOD_ENDPOINT}/run`);
  assertEquals(captured[0].auth, "Bearer test-key");
  assertEquals(captured[0].body, {
    input: { text: "Hello there.", voice_id: "aria" },
  });
});

Deno.test("startRunpodNarration refuses to run without a configured API key", async () => {
  await withEnv({}, async () => {
    Deno.env.delete("RUNPOD_API_KEY");
    let threw = false;
    try {
      await startRunpodNarration({ text: "hi", voice: VOICE });
    } catch {
      threw = true;
    }
    assert(
      threw,
      "expected startRunpodNarration to throw without RUNPOD_API_KEY",
    );
  });
});

Deno.test("startRunpodNarration throws on a non-OK response or a missing job id", async () => {
  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      async () => {
        let threw = false;
        try {
          await startRunpodNarration({ text: "hi", voice: VOICE });
        } catch {
          threw = true;
        }
        assert(threw);
      },
    ));

  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      () => new Response(JSON.stringify({}), { status: 200 }),
      async () => {
        let threw = false;
        try {
          await startRunpodNarration({ text: "hi", voice: VOICE });
        } catch {
          threw = true;
        }
        assert(
          threw,
          "a 200 with no job id must still be treated as a failure to start",
        );
      },
    ));
});

Deno.test("pollRunpodNarration decodes base64 audio on a ready job", async () => {
  const mp3Bytes = new Uint8Array([1, 2, 3, 4]);
  const base64 = btoa(String.fromCharCode(...mp3Bytes));

  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      () =>
        new Response(
          JSON.stringify({
            status: "COMPLETED",
            output: { audio_base64: base64, duration_seconds: 3.5 },
          }),
          { status: 200 },
        ),
      async () => {
        const result = await pollRunpodNarration("job-123");
        assertEquals(result.status, "ready");
        assertEquals(result.durationSeconds, 3.5);
        assertEquals(Array.from(result.audioBytes ?? []), Array.from(mp3Bytes));
      },
    ));
});

Deno.test("pollRunpodNarration fetches audio_url when no inline base64 is present", async () => {
  const mp3Bytes = new Uint8Array([9, 8, 7]);
  let audioUrlFetched = false;

  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      (request) => {
        if (request.url.includes("/status/")) {
          return new Response(
            JSON.stringify({
              status: "COMPLETED",
              output: { audio_url: "https://api.runpod.ai/v2/clip.mp3" },
            }),
            { status: 200 },
          );
        }
        audioUrlFetched = true;
        return new Response(mp3Bytes, { status: 200 });
      },
      async () => {
        const result = await pollRunpodNarration("job-123");
        assertEquals(result.status, "ready");
        assertEquals(Array.from(result.audioBytes ?? []), Array.from(mp3Bytes));
      },
    ));
  assert(audioUrlFetched);
});

Deno.test("pollRunpodNarration reports a ready job with no usable audio as failed", async () => {
  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      () =>
        new Response(JSON.stringify({ status: "COMPLETED", output: {} }), {
          status: 200,
        }),
      async () => {
        const result = await pollRunpodNarration("job-123");
        assertEquals(result.status, "failed");
        assertEquals(result.errorCode, "missing_audio_output");
      },
    ));
});

Deno.test("pollRunpodNarration passes through pending and failed provider statuses", async () => {
  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      () =>
        new Response(JSON.stringify({ status: "IN_PROGRESS" }), {
          status: 200,
        }),
      async () => {
        const result = await pollRunpodNarration("job-123");
        assertEquals(result.status, "pending");
      },
    ));

  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      () =>
        new Response(JSON.stringify({ status: "FAILED", error: "oom" }), {
          status: 200,
        }),
      async () => {
        const result = await pollRunpodNarration("job-123");
        assertEquals(result.status, "failed");
        assertEquals(result.errorCode, "oom");
      },
    ));
});

Deno.test("pollRunpodNarration refuses a job id that would steer off the status endpoint", async () => {
  const result = await pollRunpodNarration("../purge-queue");
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "invalid_job_id");
});

// ---------------------------------------------------------------------------
// storageObjectExists
// ---------------------------------------------------------------------------

function stubStorageClient(
  listResult: { data: Array<{ name: string }> | null; error: unknown },
): SupabaseClient {
  const stub = {
    storage: {
      from: (_bucket: string) => ({
        list: (_path: string, _opts?: { search?: string }) =>
          Promise.resolve(listResult),
      }),
    },
  };
  return stub as unknown as SupabaseClient;
}

Deno.test("storageObjectExists is true only when the listing names an exact match", async () => {
  const found = stubStorageClient({
    data: [{ name: "aria.mp3" }],
    error: null,
  });
  assertEquals(
    await storageObjectExists(found, "audio", "voice-previews/aria.mp3"),
    true,
  );

  const empty = stubStorageClient({ data: [], error: null });
  assertEquals(
    await storageObjectExists(empty, "audio", "voice-previews/aria.mp3"),
    false,
  );

  const errored = stubStorageClient({ data: null, error: new Error("boom") });
  assertEquals(
    await storageObjectExists(errored, "audio", "voice-previews/aria.mp3"),
    false,
  );
});

// The provider tells us where to fetch the audio from, which makes that URL
// attacker-influenced the moment the provider is compromised, spoofed, or
// simply wrong. Unchecked, it pointed this function at anything the Edge
// runtime could reach -- internal services and cloud metadata endpoints
// included -- and at a body of any size.
Deno.test("pollRunpodNarration refuses an audio_url on an unexpected host", async () => {
  let audioFetched = false;

  await withEnv({ RUNPOD_API_KEY: "test-key" }, () =>
    withFetch(
      (request) => {
        if (request.url.includes("/status/")) {
          return new Response(
            JSON.stringify({
              status: "COMPLETED",
              // The classic SSRF target.
              output: { audio_url: "http://169.254.169.254/latest/meta-data/" },
            }),
            { status: 200 },
          );
        }
        audioFetched = true;
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
      async () => {
        const result = await pollRunpodNarration("job-ssrf");
        assertEquals(audioFetched, false);
        assertEquals(result.audioBytes, undefined);
      },
    ));
});

// Two invariants that must survive every future change to the audio path,
// stated as behaviour rather than as a source-text scan: this file used to
// grep both handlers for the literal string "RUNPOD_ENDPOINT" and assert it
// was absent, which was only ever true because fresh generation was closed
// unconditionally. Migration `00048_voice_library.sql` and the lazy-generation
// rewrite made RunPod code paths a normal, reachable part of both handlers, so
// the thing worth proving now is that they are reachable only under the right
// conditions -- never merely absent from the source.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { STATIC_VOICES } from "./voices.ts";
import { handleRequest as generateAudio } from "../generate-audio/index.ts";
import { handleRequest as audioStatus } from "../audio-status/index.ts";
import { NARRATION_REFUSAL } from "./narration-audio.ts";

const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "66666666-6666-4666-8666-666666666666";
const STORY_ID = "33333333-3333-4333-8333-333333333333";
const CHAPTER_ID = "44444444-4444-4444-8444-444444444444";

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

interface Scenario {
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
  chapterAudioRow?: Record<string, unknown> | null;
}

function makeFetchStub(
  scenario: Scenario,
  runpodCalls: { count: number },
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.pathname === "/auth/v1/user") {
      return json({
        id: scenario.userId,
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: false,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }
    if (url.pathname === "/rest/v1/stories") {
      return scenario.story ? json(scenario.story) : pgrst116();
    }
    if (url.pathname === "/rest/v1/chapters") {
      return scenario.chapter ? json(scenario.chapter) : pgrst116();
    }
    if (url.pathname === "/rest/v1/voices") {
      // Serve the seeded registry: an empty answer from a reachable table now
      // means "no active voices", not "the table is down".
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
      return scenario.chapterAudioRow
        ? json([scenario.chapterAudioRow])
        : json([]);
    }
    if (url.host === "api.runpod.ai") {
      runpodCalls.count += 1;
      return json({ id: "job-should-not-happen" });
    }
    if (url.pathname === "/rest/v1/error_events") return json([]);

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

Deno.test("fresh narration cannot reach RunPod while the entitlement gate is closed", async () => {
  const env = setTestEnv({ NARRATION_GENERATION_ENABLED: "false" });
  const runpodCalls = { count: 0 };
  const originalFetch = globalThis.fetch;
  try {
    const scenario: Scenario = {
      userId: AUTHOR_ID,
      story: { author_id: AUTHOR_ID, is_public: false, is_curated: false },
      chapter: {
        id: CHAPTER_ID,
        story_id: STORY_ID,
        content: "brand new chapter, never narrated",
        word_count: 5,
        audio_url: null,
        is_published: false,
      },
    };
    globalThis.fetch = makeFetchStub(scenario, runpodCalls);
    const response = await generateAudio(
      new Request("https://katha.test/generate-audio", {
        method: "POST",
        headers: {
          Authorization: "Bearer t",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ story_id: STORY_ID, chapter_id: CHAPTER_ID }),
      }),
    );
    assertEquals(response.status, 503);
    assertEquals((await response.json()).error, NARRATION_REFUSAL);
    assertEquals(runpodCalls.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

Deno.test("audio-status never polls a provider job on behalf of someone who cannot read the chapter", async () => {
  const env = setTestEnv();
  const runpodCalls = { count: 0 };
  const originalFetch = globalThis.fetch;
  try {
    const scenario: Scenario = {
      userId: OTHER_USER_ID,
      story: { author_id: AUTHOR_ID, is_public: false, is_curated: false },
      chapter: {
        id: CHAPTER_ID,
        story_id: STORY_ID,
        content: "private",
        word_count: 1,
        audio_url: null,
        is_published: false,
      },
      chapterAudioRow: {
        id: "audio-1",
        chapter_id: CHAPTER_ID,
        voice_id: "aria",
        storage_path: null,
        provider_job_id: "job-xyz",
        status: "pending",
      },
    };
    globalThis.fetch = makeFetchStub(scenario, runpodCalls);
    const response = await audioStatus(
      new Request(
        `https://katha.test/audio-status?story_id=${STORY_ID}&chapter_id=${CHAPTER_ID}&voice_id=aria`,
        { headers: { Authorization: "Bearer t" } },
      ),
    );
    assertEquals(response.status, 403);
    assertEquals(runpodCalls.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

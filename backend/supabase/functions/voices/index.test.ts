// The voice picker's endpoint: language filtering and tier reporting, proven
// against a stubbed `voices` table rather than `STATIC_VOICES`, so a pass here
// shows the endpoint actually plumbed the database response through rather
// than silently serving the fallback.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

const DB_VOICES = [
  {
    id: "testvoice-en",
    display_name: "Test EN",
    language: "en",
    gender: "female",
    tier: "premium",
    provider: "runpod_minimax",
    provider_voice_params: { voice_id: "testvoice-en" },
    preview_path: "voice-previews/testvoice-en.mp3",
    sort_order: 5,
    is_active: true,
  },
  {
    id: "testvoice-es",
    display_name: "Test ES",
    language: "es",
    gender: "male",
    tier: "standard",
    provider: "edge_tts",
    provider_voice_params: { voice: "es-ES-TestNeural" },
    preview_path: "voice-previews/testvoice-es.mp3",
    sort_order: 6,
    is_active: true,
  },
];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchStub(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);

    if (url.pathname === "/auth/v1/user") {
      return json({
        id: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: false,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }

    if (url.pathname === "/rest/v1/voices") {
      const languageFilter = url.searchParams.get("language")?.replace(
        /^eq\./,
        "",
      );
      const rows = DB_VOICES.filter((voice) =>
        !languageFilter || voice.language === languageFilter
      );
      return json(rows);
    }

    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;
}

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
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
  query: string,
  headers: Record<string, string> = { Authorization: "Bearer test-token" },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub();
  try {
    const response = await handleRequest(
      new Request(`https://katha.test/voices?${query}`, { headers }),
    );
    return { status: response.status, json: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("filters by language and reports tier and a preview url", async () => {
  const env = setTestEnv();
  try {
    const { status, json: body } = await run("language=es");
    assertEquals(status, 200);
    const voices = body.voices as Array<Record<string, unknown>>;
    assertEquals(voices.length, 1);
    assertEquals(voices[0].id, "testvoice-es");
    assertEquals(voices[0].tier, "standard");
    assertEquals(
      voices[0].preview_url,
      "https://project.supabase.test/storage/v1/object/public/audio/voice-previews/testvoice-es.mp3",
    );
  } finally {
    restoreEnv(env);
  }
});

Deno.test("with no language filter, every active voice is returned", async () => {
  const env = setTestEnv();
  try {
    const { status, json: body } = await run("");
    assertEquals(status, 200);
    const voices = body.voices as Array<Record<string, unknown>>;
    assertEquals(voices.length, 2);
    const tiers = voices.map((v) => v.tier).sort();
    assertEquals(tiers, ["premium", "standard"]);
  } finally {
    restoreEnv(env);
  }
});

Deno.test("requires authentication", async () => {
  const env = setTestEnv();
  try {
    const { status, json: body } = await run("", {});
    assertEquals(status, 401);
    assertEquals(body.error, "Unauthorized");
  } finally {
    restoreEnv(env);
  }
});

Deno.test("rejects a malformed language filter", async () => {
  const env = setTestEnv();
  try {
    const { status } = await run("language=english");
    assertEquals(status, 400);
  } finally {
    restoreEnv(env);
  }
});

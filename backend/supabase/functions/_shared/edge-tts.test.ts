import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateWithEdgeTts } from "./edge-tts.ts";

function setEnv(
  values: Record<string, string>,
): Record<string, string | undefined> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
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

Deno.test("edge_tts requires a configured synthesis service", async () => {
  const previous = setEnv({ EDGE_TTS_TIMEOUT_MS: "1000" });
  const priorUrl = Deno.env.get("EDGE_TTS_SERVICE_URL");
  Deno.env.delete("EDGE_TTS_SERVICE_URL");
  try {
    await assertRejects(
      () => generateWithEdgeTts("Hello", "en-US-AriaNeural"),
      Error,
      "EDGE_TTS_SERVICE_URL is not configured",
    );
  } finally {
    if (priorUrl === undefined) Deno.env.delete("EDGE_TTS_SERVICE_URL");
    else Deno.env.set("EDGE_TTS_SERVICE_URL", priorUrl);
    restoreEnv(previous);
  }
});

Deno.test("edge_tts accepts raw mp3 bytes", async () => {
  const previous = setEnv({
    EDGE_TTS_SERVICE_URL: "https://edge-tts.test/synthesize",
    EDGE_TTS_TIMEOUT_MS: "1000",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init);
      const body = await request.json();
      assertEquals(request.url, "https://edge-tts.test/synthesize");
      assertEquals(body, {
        text: "Hello",
        voice: "en-US-AriaNeural",
        format: "mp3",
      });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }) as typeof fetch;
  try {
    const bytes = await generateWithEdgeTts("Hello", "en-US-AriaNeural");
    assertEquals([...bytes], [1, 2, 3]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(previous);
  }
});

Deno.test("edge_tts accepts base64 json responses", async () => {
  const previous = setEnv({
    EDGE_TTS_SERVICE_URL: "https://edge-tts.test/synthesize",
    EDGE_TTS_TIMEOUT_MS: "1000",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (async () =>
      new Response(JSON.stringify({ audio_base64: "AQID" }), {
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  try {
    const bytes = await generateWithEdgeTts("Hello", "en-US-AriaNeural");
    assertEquals([...bytes], [1, 2, 3]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(previous);
  }
});

Deno.test("edge_tts classifies provider errors by status", async () => {
  const previous = setEnv({
    EDGE_TTS_SERVICE_URL: "https://edge-tts.test/synthesize",
    EDGE_TTS_TIMEOUT_MS: "1000",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (async () => new Response("nope", { status: 503 })) as typeof fetch;
  try {
    await assertRejects(
      () => generateWithEdgeTts("Hello", "en-US-AriaNeural"),
      Error,
      "edge_tts_failed:503",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(previous);
  }
});

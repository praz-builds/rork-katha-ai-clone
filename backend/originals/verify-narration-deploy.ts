/**
 * Does the deployed narration pipeline actually do the new thing?
 *
 * Run AFTER migration 00095 and after `audio-status` and `generate-audio` are
 * deployed. It asks production three questions that a green test suite cannot
 * answer, because every one of them is about code that is running somewhere
 * else:
 *
 *   1. Does a multi-chunk chapter come back with a CHUNK MANIFEST at all? That
 *      is the whole feature. If `chunk_manifest` is absent the deployed
 *      function is the old one and the deploy did not take.
 *   2. Does chunk 0 get a playable url BEFORE the chapter is finished? That is
 *      the difference between ~45s and ~101s to first audio, and it is the
 *      only number the reader feels.
 *   3. Is prefetch still refused? It is meant to ship dark behind
 *      `NARRATION_PREFETCH_ENABLED`, and a 503 here is the PASS.
 *
 * It picks a real published chapter over `NARRATION_CHUNK_CHARS` so the
 * multi-chunk path is the one exercised, and prefers one that is NOT already
 * narrated so the cold path is measured rather than the cache.
 *
 * Per the Observability Gate in AGENTS.md, a failure is written to
 * `public.error_events` rather than only printed: a failure reported in a
 * terminal did not happen as far as the system is concerned.
 */
import { callFunction, env, houseClient, service } from "./lib.ts";

const { client } = await houseClient();

const CHUNK_CHARS = 9_000;
const POLL_INTERVAL_MS = 2_500;
const GIVE_UP_MS = 240_000;

type ManifestEntry = {
  index: number;
  url: string | null;
  duration_ms: number | null;
  char_count: number;
  ready: boolean;
};

function readyCount(manifest: ManifestEntry[]): number {
  return manifest.filter((entry) => entry.ready && entry.url).length;
}

async function logFailure(kind: string, context: Record<string, unknown>) {
  try {
    await service.from("error_events").insert({
      bucket: "generation.audio",
      severity: "high",
      error_code: kind,
      context: { ...context, source: "verify_narration_deploy" },
    });
  } catch (error) {
    console.error("could not record the failure:", error);
  }
}

/**
 * `audio-status` is a GET with query params, so `callFunction` (POST-only)
 * cannot serve it. Same auth: the house session's access token.
 */
async function pollStatus(
  storyId: string,
  chapterId: string,
): Promise<Record<string, unknown>> {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("house session lost");
  const url = new URL(`${env.SUPABASE_URL}/functions/v1/audio-status`);
  url.searchParams.set("story_id", storyId);
  url.searchParams.set("chapter_id", chapterId);
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const text = await res.text();

  // AN HTTP FAILURE IS NOT A POLL RESULT.
  //
  // Reading only the body meant a 401, a 404 or a 500 came back as an object
  // with no `status` field, which the loop below treats exactly like "still
  // pending" -- so a deploy that was refusing every request looked identical
  // to one that was working, for the full four minutes until the window ran
  // out. This script exists to tell those two apart, so it has to look.
  if (!res.ok) {
    return {
      status: "HTTP_ERROR",
      http_status: res.status,
      raw: text.slice(0, 300),
    };
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { status: "UNPARSEABLE", raw: text.slice(0, 300) };
  }
}

/** A published chapter long enough to chunk, ideally without audio already. */
async function pickChapter() {
  const { data, error } = await service
    .from("chapters")
    .select("id, story_id, chapter_number, title, content")
    .eq("is_published", true)
    .limit(400);
  if (error) throw error;

  const long = (data ?? [])
    .map((row) => ({ ...row, chars: (row.content as string ?? "").length }))
    .filter((row) => row.chars > CHUNK_CHARS)
    .sort((a, b) => a.chars - b.chars);
  if (!long.length) throw new Error("no published chapter over the chunk size");

  const { data: existing } = await service
    .from("chapter_audio")
    .select("chapter_id")
    .in("chapter_id", long.map((row) => row.id));
  const narrated = new Set((existing ?? []).map((row) => row.chapter_id));

  return long.find((row) => !narrated.has(row.id)) ?? long[0];
}

const chapter = await pickChapter();
console.log(
  `chapter ${chapter.chapter_number} of ${chapter.story_id} — ${chapter.chars} chars ` +
    `(~${Math.ceil(chapter.chars / CHUNK_CHARS)} chunks)`,
);

// 3. Prefetch must be refused. Asked first, so a gate that is open is found
//    before anything else spends a provider job.
const prefetch = await callFunction(client, "generate-audio", {
  story_id: chapter.story_id,
  chapter_id: chapter.id,
  language: "English",
  purpose: "prefetch",
});
const prefetchClosed = prefetch.status === 503;
console.log(
  `prefetch gate: ${prefetch.status} ${
    prefetchClosed ? "REFUSED (pass)" : "OPEN (FAIL)"
  }`,
);
if (!prefetchClosed) {
  await logFailure("narration_prefetch_gate_open", {
    status: prefetch.status,
    chapter_id: chapter.id,
  });
}

// 1 + 2. The real request, then poll for the manifest.
const started = Date.now();
const begin = await callFunction(client, "generate-audio", {
  story_id: chapter.story_id,
  chapter_id: chapter.id,
  language: "English",
});
console.log(
  `generate-audio: ${begin.status} ${JSON.stringify(begin.body).slice(0, 160)}`,
);
if (begin.status >= 400) {
  await logFailure("narration_start_failed", {
    status: begin.status,
    chapter_id: chapter.id,
  });
  Deno.exit(1);
}

let firstPlayableMs: number | null = null;
let sawManifest = false;
let completedMs: number | null = null;

while (Date.now() - started < GIVE_UP_MS) {
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  const body = await pollStatus(chapter.story_id, chapter.id);
  const manifest = (body.chunk_manifest ?? []) as ManifestEntry[];
  const elapsed = Date.now() - started;

  if (manifest.length) {
    sawManifest = true;
    const ready = readyCount(manifest);
    if (ready > 0 && firstPlayableMs === null) {
      firstPlayableMs = elapsed;
      console.log(
        `first playable chunk at ${
          (elapsed / 1000).toFixed(1)
        }s (${ready}/${manifest.length})`,
      );
    }
  }

  if (body.status === "COMPLETED") {
    completedMs = elapsed;
    console.log(
      `completed at ${(elapsed / 1000).toFixed(1)}s, audio_url ${
        body.audio_url ? "present" : "MISSING"
      }`,
    );
    break;
  }
  if (body.status === "HTTP_ERROR" || body.status === "UNPARSEABLE") {
    // Stop on the first one. A poll that cannot be read is not going to start
    // being readable, and waiting out the window turns a clear signal into a
    // timeout that says nothing about why.
    await logFailure("narration_status_unreadable", {
      chapter_id: chapter.id,
      http_status: body.http_status ?? null,
      elapsed_ms: elapsed,
    });
    console.error(
      `audio-status unreadable at ${(elapsed / 1000).toFixed(1)}s: ${
        JSON.stringify(body).slice(0, 220)
      }`,
    );
    Deno.exit(1);
  }
  if (body.status === "FAILED") {
    await logFailure("narration_verify_failed", {
      chapter_id: chapter.id,
      elapsed_ms: elapsed,
      error_code: body.error_code ?? null,
    });
    console.error(
      `FAILED at ${(elapsed / 1000).toFixed(1)}s: ${
        JSON.stringify(body).slice(0, 200)
      }`,
    );
    Deno.exit(1);
  }
}

console.log("\n--- result ---");
console.log(
  `manifest returned:        ${
    sawManifest ? "yes" : "NO (deploy did not take)"
  }`,
);
console.log(
  `first audio:              ${
    firstPlayableMs === null
      ? "never"
      : (firstPlayableMs / 1000).toFixed(1) + "s"
  }`,
);
console.log(
  `whole chapter:            ${
    completedMs === null
      ? "not within the window"
      : (completedMs / 1000).toFixed(1) + "s"
  }`,
);
console.log(`prefetch refused:         ${prefetchClosed ? "yes" : "NO"}`);

if (!sawManifest) {
  await logFailure("narration_manifest_absent", { chapter_id: chapter.id });
}

const ok = sawManifest && firstPlayableMs !== null && prefetchClosed;
console.log(ok ? "\nPASS" : "\nFAIL");
if (!ok) Deno.exit(1);

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EDGE_TTS_VOICES } from "./edge-tts.ts";
import {
  DEFAULT_VOICE_ID,
  getVoiceRecord,
  isValidVoiceId,
  listVoices,
  STATIC_VOICES,
  VALID_VOICE_IDS,
} from "./voices.ts";

Deno.test("voice ids are allowlisted, not merely stringified", () => {
  assertEquals(isValidVoiceId("aria"), true);
  assertEquals(isValidVoiceId("alvaro"), true);

  assertEquals(isValidVoiceId("Aria"), false);
  assertEquals(isValidVoiceId("../../etc/passwd"), false);
  assertEquals(isValidVoiceId("aria/../kai"), false);
  assertEquals(isValidVoiceId(""), false);
  assertEquals(isValidVoiceId(null), false);
  assertEquals(isValidVoiceId(undefined), false);
  assertEquals(isValidVoiceId(7), false);
  assertEquals(isValidVoiceId({ toString: () => "aria" }), false);
});

Deno.test("the default voice and the edge-tts map stay inside the allowlist", () => {
  assertEquals(VALID_VOICE_IDS.has(DEFAULT_VOICE_ID), true);
  for (const voiceId of Object.keys(EDGE_TTS_VOICES)) {
    assertEquals(
      VALID_VOICE_IDS.has(voiceId),
      true,
      `edge-tts voice "${voiceId}" is not in the shared allowlist`,
    );
  }
});

Deno.test("STATIC_VOICES has exactly 8 voices: 4 standard, 4 premium, all active", () => {
  assertEquals(STATIC_VOICES.length, 8);
  const standard = STATIC_VOICES.filter((v) => v.tier === "standard");
  const premium = STATIC_VOICES.filter((v) => v.tier === "premium");
  assertEquals(standard.length, 4);
  assertEquals(premium.length, 4);
  assertEquals(STATIC_VOICES.every((v) => v.is_active), true);
});

// ---------------------------------------------------------------------------
// listVoices / getVoiceRecord: stub client + fallback behaviour.
//
// A minimal object literal cast to `SupabaseClient` -- the full class type
// has many members these functions never touch, and every call this module
// makes is a plain `.from(...).select(...).eq(...)...` chain, so a narrow stub
// covers the real contract without instantiating a live client.
// ---------------------------------------------------------------------------

function stubClient(
  rows: Array<Record<string, unknown>> | null,
  error: unknown = null,
): SupabaseClient {
  const builder = {
    eq(_column: string, _value: unknown) {
      return builder;
    },
    order(_column: string, _opts?: { ascending?: boolean }) {
      return Promise.resolve({ data: rows, error });
    },
    maybeSingle() {
      const first = rows && rows.length > 0 ? rows[0] : null;
      return Promise.resolve({ data: error ? null : first, error });
    },
  };
  const stub = {
    from: (_table: string) => ({ select: (_columns: string) => builder }),
  };
  return stub as unknown as SupabaseClient;
}

Deno.test("listVoices returns the database rows when the read succeeds", async () => {
  const dbRow = { ...STATIC_VOICES[0], display_name: "From DB" };
  const client = stubClient([dbRow]);
  const voices = await listVoices(client);
  assertEquals(voices, [dbRow]);
});

Deno.test("listVoices falls back to STATIC_VOICES on a query error", async () => {
  const client = stubClient(null, new Error("boom"));
  const voices = await listVoices(client, "en");
  assertEquals(voices, STATIC_VOICES.filter((v) => v.language === "en"));
});

// An empty answer is an answer, not an outage.
//
// This test previously asserted the opposite, and in doing so pinned a real
// bug: falling back to the static list when a reachable table returned no rows
// re-exposed every voice an administrator had deliberately deactivated. The
// fallback exists for an unreachable table, and only for that.
Deno.test("listVoices trusts an empty result rather than resurrecting the static list", async () => {
  const client = stubClient([]);
  assertEquals(await listVoices(client), []);
});

Deno.test("listVoices falls back to STATIC_VOICES with no client at all", async () => {
  const voices = await listVoices(null, "en");
  assertEquals(voices, STATIC_VOICES.filter((v) => v.language === "en"));
});

// The registry flag says an administrator WANTS a voice offered. It cannot say
// whether the machinery behind it exists, and on 2026-09-10 the two disagreed
// on production: 00059 had reactivated the edge_tts pair for a worker that was
// never deployed, so every Spanish reader was offered Elvira, and every tap
// failed with `edge_tts_service_missing`. The runtime now has the final word.
Deno.test("a voice whose provider is not configured is never offered", async () => {
  Deno.env.delete("EDGE_TTS_SERVICE_URL");
  const spanish = STATIC_VOICES.filter((v) => v.language === "es");
  assert(spanish.length > 0, "the static list must still carry the rows");
  assert(
    spanish.every((v) => v.provider === "edge_tts"),
    "this test is only meaningful while every Spanish voice is edge_tts",
  );

  assertEquals(await listVoices(null, "es"), []);
  assertEquals(
    await listVoices(
      stubClient(spanish as unknown as Record<string, unknown>[]),
      "es",
    ),
    [],
  );
  assertEquals(await getVoiceRecord(null, "elvira"), null);
  assertEquals(
    await getVoiceRecord(
      stubClient([spanish[0]] as unknown as Record<string, unknown>[]),
      "elvira",
    ),
    null,
  );
});

// ...and it hands them back the moment the worker exists, with no migration,
// no deploy, and no third flip of `is_active`.
Deno.test("configuring the worker restores the voices on its own", async () => {
  Deno.env.set("EDGE_TTS_SERVICE_URL", "https://edge-tts.internal/synthesize");
  try {
    const spanish = STATIC_VOICES.filter((v) => v.language === "es");
    assertEquals(await listVoices(null, "es"), spanish);
    assertEquals(await getVoiceRecord(null, "elvira"), spanish[0]);
  } finally {
    Deno.env.delete("EDGE_TTS_SERVICE_URL");
  }
});

Deno.test("getVoiceRecord returns the database row when the read succeeds", async () => {
  const dbRow = { ...STATIC_VOICES[0], display_name: "From DB" };
  const client = stubClient([dbRow]);
  const record = await getVoiceRecord(client, "aria");
  assertEquals(record, dbRow);
});

// The distinction that matters: "the table said no" is not "the table did not
// answer". Only the second one falls back.
Deno.test("getVoiceRecord treats a miss as a real absence and an outage as a fallback", async () => {
  // Reachable table, no such active voice. That is a deactivated or removed
  // voice, and returning the static entry would let generation keep running on
  // stale provider parameters for a voice that was switched off on purpose.
  const missing = stubClient([]);
  assertEquals(await getVoiceRecord(missing, "aria"), null);

  // Unreachable table. Degrade rather than take narration down.
  const errored = stubClient(null, new Error("boom"));
  assertEquals(await getVoiceRecord(errored, "aria"), STATIC_VOICES[0]);

  assertEquals(await getVoiceRecord(null, "aria"), STATIC_VOICES[0]);
  assertEquals(await getVoiceRecord(null, "not-a-real-voice"), null);
});

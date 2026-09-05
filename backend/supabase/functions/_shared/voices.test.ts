import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EDGE_TTS_VOICES } from "./edge-tts.ts";
import { DEFAULT_VOICE_ID, isValidVoiceId, VALID_VOICE_IDS } from "./voices.ts";

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

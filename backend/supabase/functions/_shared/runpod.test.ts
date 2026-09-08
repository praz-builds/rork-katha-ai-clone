import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isValidRunpodJobId,
  RUNPOD_ENDPOINT,
  runpodCancelUrl,
  runpodStatusUrl,
} from "./runpod.ts";

Deno.test("runpod job ids accept the opaque token shape and nothing else", () => {
  assertEquals(isValidRunpodJobId("abc123"), true);
  assertEquals(isValidRunpodJobId("a-b_C-9"), true);
  assertEquals(isValidRunpodJobId("a".repeat(128)), true);

  assertEquals(isValidRunpodJobId(""), false);
  assertEquals(isValidRunpodJobId("a".repeat(129)), false);
  assertEquals(isValidRunpodJobId("has space"), false);
  assertEquals(isValidRunpodJobId("has/slash"), false);
  assertEquals(isValidRunpodJobId(null), false);
  assertEquals(isValidRunpodJobId(42), false);
});

Deno.test("runpod status url keeps a valid job on the status path", () => {
  const url = runpodStatusUrl("abc-123_XYZ");
  assertEquals(url, `${RUNPOD_ENDPOINT}/status/abc-123_XYZ`);
  assertStringIncludes(url!, "https://api.runpod.ai/v2/");
});

Deno.test("runpod status url refuses every path-steering job id", () => {
  // Traversal: the URL parser normalizes `..`, so this would otherwise reach
  // /v2/minimax-speech-02-hd/purge-queue with our API key attached.
  assertEquals(runpodStatusUrl("../purge-queue"), null);
  assertEquals(runpodStatusUrl("..%2F..%2Fhealth"), null);
  assertEquals(runpodStatusUrl("../../other-endpoint/run"), null);
  // Query and fragment truncate the path rather than extending it.
  assertEquals(runpodStatusUrl("abc?foo=bar"), null);
  assertEquals(runpodStatusUrl("abc#frag"), null);
  // A scheme-relative or absolute value would leave the endpoint entirely.
  assertEquals(runpodStatusUrl("//evil.example/status"), null);
  assertEquals(runpodStatusUrl("https://evil.example/status"), null);
  assertEquals(runpodStatusUrl("abc/../../../"), null);
  assertEquals(runpodStatusUrl(""), null);
  assertEquals(runpodStatusUrl(null), null);
});

Deno.test("runpod cancel url keeps a valid job on the cancel path, under the same guarantees as status", () => {
  const url = runpodCancelUrl("abc-123_XYZ");
  assertEquals(url, `${RUNPOD_ENDPOINT}/cancel/abc-123_XYZ`);
  assertStringIncludes(url!, "https://api.runpod.ai/v2/");

  assertEquals(runpodCancelUrl("../purge-queue"), null);
  assertEquals(runpodCancelUrl("abc?foo=bar"), null);
  assertEquals(runpodCancelUrl("https://evil.example/cancel"), null);
  assertEquals(runpodCancelUrl(""), null);
  assertEquals(runpodCancelUrl(null), null);
});

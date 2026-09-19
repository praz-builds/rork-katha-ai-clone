import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { SSE_KEEP_ALIVE_FRAME, sseStream } from "./sse.ts";

// ---------------------------------------------------------------------------
// The streamed-response helper every generation endpoint uses.
//
// These run with real timers and a heartbeat of a few milliseconds. Deno's test
// sanitizers fail any test that leaves an interval running, which is the
// strongest available proof that the heartbeat is cleared on each exit path:
// a leaked timer here is a leaked timer on every streamed request in
// production, keeping an isolate alive after its response is long gone.
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

Deno.test("sseStream: frames events exactly as the client parser expects", async () => {
  const text = await readAll(sseStream(async ({ send }) => {
    send("delta", { text: "The ferry" });
    send("done", { ok: true });
  }, { heartbeatMs: 10_000 }));
  assertEquals(
    text,
    'event: delta\ndata: {"text":"The ferry"}\n\n' +
      'event: done\ndata: {"ok":true}\n\n',
  );
});

Deno.test("sseStream: keep-alives fill a quiet stretch and stop at the terminal event", async () => {
  // The production failure: the metadata call and the persist run with the
  // stream open and silent. The heartbeat is what fills that silence.
  const text = await readAll(sseStream(async ({ send }) => {
    send("delta", { text: "prose" });
    await sleep(60);
    send("done", { ok: true });
  }, { heartbeatMs: 10 }));

  const beforeDone = text.slice(0, text.indexOf("event: done"));
  const keepAlives = beforeDone.split(SSE_KEEP_ALIVE_FRAME).length - 1;
  assert(keepAlives >= 2, `expected keep-alives in the gap, saw ${keepAlives}`);
  // Nothing after the terminal event: the timer died with the run.
  assert(text.endsWith('event: done\ndata: {"ok":true}\n\n'));
  // Every keep-alive is a whole comment frame, never glued to an event.
  for (const frame of text.split("\n\n").filter(Boolean)) {
    assert(
      frame === ": keep-alive" || frame.startsWith("event: "),
      `unexpected frame ${JSON.stringify(frame)}`,
    );
  }
});

Deno.test("sseStream: the heartbeat starts when the stream opens, before any event", async () => {
  // A slow first token (the TTFT budget is 20s) must not look like a dead
  // connection either.
  const text = await readAll(sseStream(async ({ send }) => {
    await sleep(35);
    send("done", {});
  }, { heartbeatMs: 10 }));
  assert(text.startsWith(SSE_KEEP_ALIVE_FRAME));
});

Deno.test("sseStream: a run that throws still closes the stream and clears the timer", async () => {
  const text = await readAll(sseStream(async ({ send }) => {
    send("delta", { text: "a" });
    await sleep(15);
    throw new Error("the error path itself failed");
  }, { heartbeatMs: 5 }));
  assertStringIncludes(text, 'event: delta\ndata: {"text":"a"}\n\n');
});

Deno.test("sseStream: a reader who hangs up does not stop the run, and sends become no-ops", async () => {
  // The client's stall watchdog hangs up on purpose and replays the request
  // id. That only works if the chapter still finishes and persists here.
  let finished = false;
  let closedSeen = false;
  let resolveRun!: () => void;
  const runDone = new Promise<void>((r) => (resolveRun = r));

  const stream = sseStream(async (channel) => {
    channel.send("delta", { text: "a" });
    await sleep(30);
    // Would throw `Invalid state` on a raw controller after a cancel.
    channel.send("delta", { text: "after the hang-up" });
    channel.send("done", {});
    closedSeen = channel.closed;
    finished = true;
    resolveRun();
  }, { heartbeatMs: 5 });

  const reader = stream.getReader();
  const first = await reader.read();
  assert(!first.done);
  await reader.cancel();
  await runDone;

  assert(finished, "the run was abandoned when the reader left");
  assert(closedSeen, "the channel did not report the hang-up");
});

Deno.test("sseStream: the client SSE parser drops the keep-alive frame", () => {
  // Mirrors `parseSseFrame` in expo/src/lib/stream.ts: a frame whose only
  // line starts with ':' is a comment and carries no message. Pinned here so a
  // change to the frame's spelling cannot quietly turn it into an event.
  const frame = SSE_KEEP_ALIVE_FRAME.replace(/\n\n$/, "");
  assert(frame.split("\n").every((line) => line.startsWith(":")));
  assert(SSE_KEEP_ALIVE_FRAME.endsWith("\n\n"));
});

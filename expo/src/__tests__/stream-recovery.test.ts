/**
 * A stream that goes quiet is a question for the server, not a failure.
 *
 * WHERE THIS CAME FROM. On production on 2026-09-18 a `continue-story` stream
 * went silent twice and the reader's spinner ran for ~25 minutes. Both times
 * the chapter had been persisted; replaying the same `request_id` returned it
 * as plain JSON. Nothing on either side noticed the silence: the server sent no
 * keep-alive and the client had no idle timeout.
 *
 * These pin the client half of the fix, under fake timers so a 45-second
 * watchdog and a three-minute replay budget run in milliseconds:
 *
 * - keep-alive comments count as life and reset the watchdog;
 * - ~45s of silence aborts and replays the SAME request id;
 * - a replay that answers with the finished JSON completes the call exactly as
 *   `done` would have, and the prose already shown is not taken back;
 * - "still in progress" is polled with backoff, and is bounded;
 * - "the previous generation failed" surfaces the ordinary failure, flagged so
 *   the retry uses a fresh id.
 */

import { continueStoryStreaming, editParagraphStreaming, GenerationRequestError } from "@/lib/api";
import { postEventStream, StreamStalledError, type SseEvent } from "@/lib/stream";
import { REPLAY_BACKOFF_MS, STREAM_STALL_TIMEOUT_MS } from "@/lib/stream-recovery";

const mockExpoFetch = jest.fn();
jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/notifications", () => ({
  pushPermissionGranted: jest.fn().mockResolvedValue(false),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: "tok" } },
      }),
    },
  },
}));

/** A response body the test writes into by hand, and can leave silent. */
function openStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

function streamResponse(body: ReadableStream<Uint8Array>) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body,
    json: async () => ({}),
  };
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    body: null,
    json: async () => payload,
  };
}

const FINISHED_CHAPTER = {
  chapter: {
    id: "c2",
    chapter_number: 2,
    title: "The Tide Table",
    content: "The ferry was late.\n\nNobody minded.",
  },
  replayed: true,
};

const IN_PROGRESS = { error: "Generation is already in progress.", status: "reserved" };
const FAILED = {
  error: "The previous generation failed. Start a new request.",
  status: "refunded",
};

/** The request body a given fetch call sent. */
function sentBody(call: number): Record<string, unknown> {
  const init = mockExpoFetch.mock.calls[call][1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

function startContinuation(onDelta: (text: string) => void = () => {}) {
  const promise = continueStoryStreaming("story-1", "req-stall", { onDelta }, false, 2);
  // Assertions below attach their own handlers; this only stops a rejection
  // that is asserted later from being reported as unhandled in between.
  promise.catch(() => {});
  return promise;
}

beforeEach(() => {
  mockExpoFetch.mockReset();
  // Microtasks stay real: the stream and every await in the client run on
  // them, and faking them would freeze the code under test, not the clock.
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the stall watchdog", () => {
  it("treats keep-alive comments as life: a long quiet chapter is not a stall", async () => {
    const stream = openStream();
    mockExpoFetch.mockResolvedValueOnce(streamResponse(stream.body));
    const events: SseEvent[] = [];
    const done = postEventStream({
      url: "https://example.test/fn",
      headers: {},
      body: {},
      stallTimeoutMs: STREAM_STALL_TIMEOUT_MS,
      onEvent: (event) => events.push(event),
    });

    stream.push('event: delta\ndata: {"text":"a"}\n\n');
    // Two minutes of metadata call and persist: nothing but heartbeats, well
    // past the watchdog's 45s, and never 45s without one.
    for (let elapsed = 0; elapsed < 120_000; elapsed += 15_000) {
      await jest.advanceTimersByTimeAsync(15_000);
      stream.push(": keep-alive\n\n");
    }
    stream.push('event: done\ndata: {"ok":true}\n\n');
    stream.end();

    await expect(done).resolves.toEqual({});
    expect(events.map((e) => e.event)).toEqual(["delta", "done"]);
  });

  it("gives up on a connection silent for the full timeout, and not before", async () => {
    const stream = openStream();
    mockExpoFetch.mockResolvedValueOnce(streamResponse(stream.body));
    let settled: unknown = "pending";
    const done = postEventStream({
      url: "https://example.test/fn",
      headers: {},
      body: {},
      stallTimeoutMs: STREAM_STALL_TIMEOUT_MS,
      onEvent: () => {},
    }).then(
      () => "resolved",
      (error: unknown) => error,
    ).then((value) => {
      settled = value;
    });

    stream.push('event: delta\ndata: {"text":"a"}\n\n');
    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS - 1_000);
    expect(settled).toBe("pending");

    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(settled).toBeInstanceOf(StreamStalledError);
  });

  it("also covers a request whose response never arrives", async () => {
    mockExpoFetch.mockReturnValueOnce(new Promise(() => {}));
    const done = postEventStream({
      url: "https://example.test/fn",
      headers: {},
      body: {},
      stallTimeoutMs: STREAM_STALL_TIMEOUT_MS,
      onEvent: () => {},
    });
    done.catch(() => {});
    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS);
    await expect(done).rejects.toBeInstanceOf(StreamStalledError);
  });
});

describe("recovering a stalled generation by replaying its request id", () => {
  it("replays the same request id when the stream goes silent, and completes on the finished JSON", async () => {
    const stream = openStream();
    mockExpoFetch
      .mockResolvedValueOnce(streamResponse(stream.body))
      .mockResolvedValueOnce(jsonResponse(200, FINISHED_CHAPTER));
    const shown: string[] = [];
    const result = startContinuation((text) => shown.push(text));

    await jest.advanceTimersByTimeAsync(0);
    stream.push('event: delta\ndata: {"text":"The ferry was late."}\n\n');
    // ...and then nothing, the production failure.
    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS);

    const { chapter } = await result;
    expect(chapter.id).toBe("c2");
    expect(chapter.paragraphs).toEqual(["The ferry was late.", "Nobody minded."]);
    // The prose already on screen was delivered and never retracted.
    expect(shown).toEqual(["The ferry was late."]);

    expect(mockExpoFetch).toHaveBeenCalledTimes(2);
    expect(sentBody(1).request_id).toBe("req-stall");
    // The replay is the same request, byte for byte: same id, same story.
    expect(sentBody(1)).toEqual(sentBody(0));
  });

  it("polls a replay that says 'in progress' with backoff, then completes", async () => {
    const stream = openStream();
    mockExpoFetch
      .mockResolvedValueOnce(streamResponse(stream.body))
      .mockResolvedValueOnce(jsonResponse(409, IN_PROGRESS))
      .mockResolvedValueOnce(jsonResponse(409, IN_PROGRESS))
      .mockResolvedValueOnce(jsonResponse(200, FINISHED_CHAPTER));
    const result = startContinuation();

    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS);
    // First replay is immediate: it answered "in progress".
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);

    // Not hammered: nothing until the first backoff has elapsed.
    await jest.advanceTimersByTimeAsync(REPLAY_BACKOFF_MS[0] - 1);
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockExpoFetch).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(REPLAY_BACKOFF_MS[1]);
    const { chapter } = await result;
    expect(chapter.id).toBe("c2");
    expect(mockExpoFetch).toHaveBeenCalledTimes(4);
    for (const call of [1, 2, 3]) {
      expect(sentBody(call).request_id).toBe("req-stall");
    }
  });

  it("surfaces a failed replay as the ordinary failure, flagged for a fresh request id", async () => {
    const stream = openStream();
    mockExpoFetch
      .mockResolvedValueOnce(streamResponse(stream.body))
      .mockResolvedValueOnce(jsonResponse(409, FAILED));
    const result = startContinuation();

    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS);

    const error = await result.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationRequestError);
    expect((error as GenerationRequestError).message).toMatch(/previous generation failed/);
    // Reusing the id would only replay the failure; the session rotates it.
    expect((error as GenerationRequestError).resetRequestId).toBe(true);
  });

  it("reads reimagine's differently worded refusal by its structured fields", async () => {
    const stream = openStream();
    mockExpoFetch
      .mockResolvedValueOnce(streamResponse(stream.body))
      .mockResolvedValueOnce(jsonResponse(409, {
        error: "This chapter is already being rewritten.",
        code: "chapter_generating",
        status: "reserved",
      }))
      .mockResolvedValueOnce(jsonResponse(409, {
        error: "The previous rewrite failed. Start a new request.",
        code: "operation_refunded",
        status: "refunded",
      }));
    const result = startContinuation();

    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS + REPLAY_BACKOFF_MS[0]);
    const error = await result.then(() => null, (e: unknown) => e);
    expect((error as GenerationRequestError).resetRequestId).toBe(true);
    expect(mockExpoFetch).toHaveBeenCalledTimes(3);
  });

  it("stops polling after about three minutes and keeps the id for the retry", async () => {
    const stream = openStream();
    mockExpoFetch
      .mockResolvedValueOnce(streamResponse(stream.body))
      .mockResolvedValue(jsonResponse(409, IN_PROGRESS));
    const result = startContinuation();

    const budget = REPLAY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    expect(budget).toBeLessThanOrEqual(185_000);
    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS + budget);

    const error = await result.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationRequestError);
    // If the chapter does land, the reader's retry must replay it, not buy it.
    expect((error as GenerationRequestError).resetRequestId).toBe(false);
    // The stream, one immediate replay, and one per backoff step.
    expect(mockExpoFetch).toHaveBeenCalledTimes(2 + REPLAY_BACKOFF_MS.length);
  });

  it("treats a stream that closes without a terminal event the same way", async () => {
    const stream = openStream();
    mockExpoFetch
      .mockResolvedValueOnce(streamResponse(stream.body))
      .mockResolvedValueOnce(jsonResponse(200, FINISHED_CHAPTER));
    const result = startContinuation();

    await jest.advanceTimersByTimeAsync(0);
    stream.push('event: delta\ndata: {"text":"truncated"}\n\n');
    stream.end();

    const { chapter } = await result;
    expect(chapter.id).toBe("c2");
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);
  });

  it("waits out a retry that lands while the first attempt is still running", async () => {
    // The reader tapped retry on the same id: the server answers 409 before
    // opening a stream. That is "in progress", not an error.
    mockExpoFetch
      .mockResolvedValueOnce(jsonResponse(409, IN_PROGRESS))
      .mockResolvedValueOnce(jsonResponse(200, FINISHED_CHAPTER));
    const result = startContinuation();

    await jest.advanceTimersByTimeAsync(0);
    const { chapter } = await result;
    expect(chapter.id).toBe("c2");
  });

  it("does not replay an edit, which has no request id: a stalled edit fails instead", async () => {
    const stream = openStream();
    mockExpoFetch.mockResolvedValueOnce(streamResponse(stream.body));
    const result = editParagraphStreaming("story-1", "c1", 0, "rewrite" as never, {
      onDelta: () => {},
    });
    result.catch(() => {});

    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS);
    await expect(result).rejects.toThrow("stopped partway");
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
  });

  it("still trusts a terminal event that arrived before the connection died", async () => {
    const stream = openStream();
    mockExpoFetch.mockResolvedValueOnce(streamResponse(stream.body));
    const result = startContinuation();

    await jest.advanceTimersByTimeAsync(0);
    stream.push(`event: done\ndata: ${JSON.stringify(FINISHED_CHAPTER)}\n\n`);
    // The close is lost; the watchdog fires on a stream that already finished.
    await jest.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS);

    const { chapter } = await result;
    expect(chapter.id).toBe("c2");
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
  });
});

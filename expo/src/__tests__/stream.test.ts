/**
 * The SSE reader.
 *
 * Frame splitting is the part worth testing hardest: a `data:` line straddling
 * two network reads is normal, and mishandling it drops prose out of the middle
 * of a story with no error anywhere.
 */

import {
  parseSseFrame,
  postEventStream,
  splitSseFrames,
  StreamTransportError,
  type SseEvent,
} from "@/lib/stream";

const mockExpoFetch = jest.fn();
jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

beforeEach(() => {
  mockExpoFetch.mockReset();
});

/** A ReadableStream that hands over each string as one network read. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

function respondWith(chunks: string[], init: { ok?: boolean; status?: number } = {}) {
  mockExpoFetch.mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body: streamOf(chunks),
    json: async () => ({}),
  });
}

async function collect(chunks: string[]): Promise<SseEvent[]> {
  respondWith(chunks);
  const events: SseEvent[] = [];
  await postEventStream({
    url: "https://example.test/fn",
    headers: {},
    body: {},
    onEvent: (e) => events.push(e),
  });
  return events;
}

describe("frame splitting", () => {
  it("keeps an incomplete trailing frame in the buffer", () => {
    const { frames, rest } = splitSseFrames(
      "event: a\ndata: 1\n\nevent: b\ndata: 2",
    );
    expect(frames).toEqual(["event: a\ndata: 1"]);
    expect(rest).toBe("event: b\ndata: 2");
  });

  it("returns no frames when nothing is complete yet", () => {
    const { frames, rest } = splitSseFrames("event: a\ndata: par");
    expect(frames).toEqual([]);
    expect(rest).toBe("event: a\ndata: par");
  });
});

describe("frame parsing", () => {
  it("reads the event name and JSON payload", () => {
    expect(parseSseFrame('event: delta\ndata: {"text":"hi"}')).toEqual({
      event: "delta",
      data: { text: "hi" },
    });
  });

  it("defaults an unnamed event to message", () => {
    expect(parseSseFrame('data: {"a":1}')).toEqual({
      event: "message",
      data: { a: 1 },
    });
  });

  it("ignores comment-only and data-less frames", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
    expect(parseSseFrame("event: ping")).toBeNull();
  });

  it("does not throw on a malformed payload", () => {
    expect(parseSseFrame("data: {not json")).toBeNull();
  });
});

describe("postEventStream", () => {
  it("delivers events in order", async () => {
    const events = await collect([
      'event: meta\ndata: {"story_id":"s1"}\n\n',
      'event: delta\ndata: {"text":"The ferry "}\n\n',
      'event: delta\ndata: {"text":"stopped."}\n\n',
      'event: done\ndata: {"story":{"id":"s1"}}\n\n',
    ]);
    expect(events.map((e) => e.event)).toEqual([
      "meta",
      "delta",
      "delta",
      "done",
    ]);
    expect(events[1].data).toEqual({ text: "The ferry " });
  });

  it("reassembles a frame split across two reads", async () => {
    // The failure this guards: parsing the first half yields no event and the
    // second half is unparseable, so a chunk of the story vanishes silently.
    const events = await collect([
      'event: delta\ndata: {"te',
      'xt":"whole word"}\n\n',
    ]);
    expect(events).toEqual([{ event: "delta", data: { text: "whole word" } }]);
  });

  it("reassembles a frame split across a payload boundary", async () => {
    const events = await collect([
      'event: delta\ndata: {"text":"one"}\n',
      '\nevent: delta\ndata: {"text":"two"}\n\n',
    ]);
    expect(events.map((e) => (e.data as { text: string }).text)).toEqual([
      "one",
      "two",
    ]);
  });

  it("delivers a final frame that has no trailing blank line", async () => {
    const events = await collect(['event: done\ndata: {"story":{"id":"s1"}}']);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("done");
  });

  it("skips keep-alive comments between real events", async () => {
    const events = await collect([
      ": keep-alive\n\n",
      'event: delta\ndata: {"text":"a"}\n\n',
    ]);
    expect(events).toHaveLength(1);
  });

  it("ignores the server's heartbeat wherever it lands, even split across reads", async () => {
    // `_shared/sse.ts` writes exactly ": keep-alive\n\n" every ~15s while a
    // chapter is generating. It must never become an event, never merge into
    // the one after it, and never be mistaken for the end of the stream.
    const events = await collect([
      'event: delta\ndata: {"text":"a"}\n\n: keep',
      "-alive\n\n: keep-alive\n\n",
      'event: done\ndata: {"ok":true}\n\n: keep-alive\n\n',
    ]);
    expect(events).toEqual([
      { event: "delta", data: { text: "a" } },
      { event: "done", data: { ok: true } },
    ]);
  });

  it("surfaces a non-2xx as a transport error carrying the server message", async () => {
    // Everything that can reject a request happens before the body opens, so
    // an error here is ordinary JSON and must not be mistaken for a stream.
    mockExpoFetch.mockResolvedValue({
      ok: false,
      status: 402,
      body: null,
      json: async () => ({ error: "Insufficient credits" }),
    });
    await expect(
      postEventStream({
        url: "https://example.test/fn",
        headers: {},
        body: {},
        onEvent: () => {},
      }),
    ).rejects.toThrow("Insufficient credits");
  });

  it("fails loudly when the transport returns no readable stream", async () => {
    // React Native's default fetch returns null here. Hanging or silently
    // returning nothing would look like a server problem forever.
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      json: async () => ({}),
    });
    await expect(
      postEventStream({
        url: "https://example.test/fn",
        headers: {},
        body: {},
        onEvent: () => {},
      }),
    ).rejects.toThrow(StreamTransportError);
  });

  it("sends the SSE Accept header and the JSON body", async () => {
    respondWith(['event: done\ndata: {"story":{}}\n\n']);
    await postEventStream({
      url: "https://example.test/fn",
      headers: { Authorization: "Bearer tok" },
      body: { request_id: "r1" },
      onEvent: () => {},
    });
    const [, init] = mockExpoFetch.mock.calls[0];
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ request_id: "r1" });
  });
});

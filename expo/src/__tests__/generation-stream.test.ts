/**
 * Incremental delivery: the transport half of what "streaming" means here.
 *
 * The endpoint being fast is not the feature. The feature is prose reaching the
 * client while it is still being written, and the failure mode this guards
 * against is the one that looks identical from the server side: a client that
 * collects every chunk and hands it all over at the end. That client passes
 * every other API test in this repo and delivers none of the benefit - page 1
 * would arrive at ~70 seconds instead of ~20, and a request that sends no bytes
 * until it is done trips Supabase's 150-second idle timeout with no refund
 * payload reaching anyone.
 *
 * What the client is then allowed to PAINT is a separate question, answered by
 * the settle rule in `chapter-reveal.test.ts` (the rule) and
 * `create-streaming-integration.test.tsx` (the screen obeying it). Nothing here
 * is an argument for a typewriter; this file only proves the chunks arrive as
 * chunks.
 *
 * WHERE THIS CAME FROM. It is the second half of `streaming-ui.test.tsx`. The
 * first half tested `StreamingProse`, the panel the Create screen used to paint
 * prose into, which the 2026-09-09 design decision deleted along with the draft
 * editor it sat above. The transport it tested did not go anywhere, so it lives
 * on its own here rather than dying with the component.
 */

import { act } from "@testing-library/react-native";
import { generateStoryStreaming } from "@/lib/api";

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

/** A stream that releases one frame per `read()`, so ordering is observable. */
function pacedStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frames[i++]));
    },
  });
}

describe("generateStoryStreaming delivers prose progressively", () => {
  const draft = {
    primaryGenre: "mystery",
    genres: ["mystery"],
    audienceMode: "adult",
    spiceLevel: "sweet",
    identityLenses: [],
    seed: "A lighthouse keeper receives letters from her future self.",
    language: "English",
    visibility: "private",
    characters: [],
    isSeries: false,
    moments: [],
    storyValues: [],
    beats: [],
    chapterLength: "standard",
    plannedChapterCount: 3,
    illustrateChapters: false,
  } as never;

  beforeEach(() => mockExpoFetch.mockReset());

  it("hands over each chunk as it arrives, not once at the end", async () => {
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: pacedStream([
        'event: meta\ndata: {"story_id":"s1","balance":9}\n\n',
        'event: stage\ndata: {"stage":"writing"}\n\n',
        'event: delta\ndata: {"text":"The ferry "}\n\n',
        'event: delta\ndata: {"text":"left on Tuesday."}\n\n',
        'event: done\ndata: {"story":{"id":"s1","title":"Tuesday","author_id":"a1","primary_genre":"mystery","story_mode":"standalone","themes":["sea"],"word_count":4,"status":"complete"},"chapter":{"id":"c1","chapter_number":1,"title":"Chapter 1","content":"The ferry left on Tuesday."}}\n\n',
      ]),
      json: async () => ({}),
    });

    // Each entry is the accumulated text at the moment a chunk was handed over.
    // If the client buffered, there would be exactly one entry.
    const seen: string[] = [];
    let accumulated = "";
    const stages: string[] = [];

    await act(async () => {
      await generateStoryStreaming(draft, "req-1", {
        onStage: (s) => stages.push(s),
        onDelta: (chunk) => {
          accumulated += chunk;
          seen.push(accumulated);
        },
      });
    });

    expect(seen).toEqual(["The ferry ", "The ferry left on Tuesday."]);
    expect(stages).toContain("writing");
  });

  it("reports meta before any prose, so the credit is known up front", async () => {
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: pacedStream([
        'event: meta\ndata: {"story_id":"s1","balance":7}\n\n',
        'event: delta\ndata: {"text":"x"}\n\n',
        'event: done\ndata: {"story":{"id":"s1","title":"T","author_id":"a1","primary_genre":"mystery","story_mode":"standalone","themes":["sea"],"word_count":1,"status":"complete"},"chapter":{"id":"c1","chapter_number":1,"title":"Chapter 1","content":"x"}}\n\n',
      ]),
      json: async () => ({}),
    });

    const order: string[] = [];
    await act(async () => {
      await generateStoryStreaming(draft, "req-2", {
        onMeta: (m) => order.push(`meta:${m.balance}`),
        onDelta: () => order.push("delta"),
      });
    });
    expect(order[0]).toBe("meta:7");
  });

  it("names the story before a word of prose arrives", async () => {
    // The title used to come out of the metadata call, which reads the
    // FINISHED chapter -- so it could not exist until 40-50s in and page one
    // painted under a blank heading. The server now names the chapter from the
    // brief and sends it on its own event; this pins that the client hands it
    // over BEFORE the first delta rather than merely handling it.
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: pacedStream([
        'event: meta\ndata: {"story_id":"s1","balance":9}\n\n',
        'event: title\ndata: {"title":"Tuesday Ferry","chapter_title":"The Crossing"}\n\n',
        'event: delta\ndata: {"text":"The ferry left."}\n\n',
        'event: done\ndata: {"story":{"id":"s1","title":"Tuesday Ferry","author_id":"a1","primary_genre":"mystery","story_mode":"standalone","themes":["sea"],"word_count":3,"status":"complete"},"chapter":{"id":"c1","chapter_number":1,"title":"The Crossing","content":"The ferry left."}}\n\n',
      ]),
      json: async () => ({}),
    });

    const order: string[] = [];
    await act(async () => {
      await generateStoryStreaming(draft, "req-title", {
        onTitle: (names) => order.push(`title:${names.title}/${names.chapterTitle}`),
        onDelta: () => order.push("delta"),
      });
    });

    expect(order).toEqual(["title:Tuesday Ferry/The Crossing", "delta"]);
  });

  it("ignores a title event that carries no usable name", async () => {
    // A naming call that failed sends nothing, but a half-filled payload must
    // not blank a name the client already holds: `""` reaching the session
    // would replace a real title with an empty heading.
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: pacedStream([
        'event: title\ndata: {"title":"   ","chapter_title":""}\n\n',
        'event: delta\ndata: {"text":"x"}\n\n',
        'event: done\ndata: {"story":{"id":"s1","title":"T","author_id":"a1","primary_genre":"mystery","story_mode":"standalone","themes":["sea"],"word_count":1,"status":"complete"},"chapter":{"id":"c1","chapter_number":1,"title":"Chapter 1","content":"x"}}\n\n',
      ]),
      json: async () => ({}),
    });

    const titles: unknown[] = [];
    await act(async () => {
      await generateStoryStreaming(draft, "req-title-2", {
        onTitle: (names) => titles.push(names),
        onDelta: () => {},
      });
    });

    expect(titles).toEqual([]);
  });

  it("still finishes for a stream that never names the story", async () => {
    // The naming call is never load-bearing: it can fail, and then the title
    // arrives with `done` exactly as it always did.
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: pacedStream([
        'event: delta\ndata: {"text":"x"}\n\n',
        'event: done\ndata: {"story":{"id":"s1","title":"Named At The End","author_id":"a1","primary_genre":"mystery","story_mode":"standalone","themes":["sea"],"word_count":1,"status":"complete"},"chapter":{"id":"c1","chapter_number":1,"title":"Chapter 1","content":"x"}}\n\n',
      ]),
      json: async () => ({}),
    });

    let fired = false;
    const story = await generateStoryStreaming(draft, "req-title-3", {
      onTitle: () => { fired = true; },
      onDelta: () => {},
    });
    expect(fired).toBe(false);
    expect(story.title).toBe("Named At The End");
  });

  it("surfaces a terminal error event rather than resolving empty", async () => {
    // A stream that reported a failure must not look like a success with no
    // story: that would silently drop a chapter the user paid for.
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: pacedStream([
        'event: delta\ndata: {"text":"partial"}\n\n',
        'event: error\ndata: {"error":"Generation failed. Credit refunded.","partial_prose_shown":true}\n\n',
      ]),
      json: async () => ({}),
    });

    await expect(
      generateStoryStreaming(draft, "req-3", { onDelta: () => {} }),
    ).rejects.toThrow("Credit refunded");
  });

  it("never treats a stream that ends with no terminal event as a success", async () => {
    // A truncated stream says nothing about how the generation ended, so the
    // client asks by replaying the request id (see `stream-recovery.test.ts`).
    // Here the server says it failed: the call fails, and asks for a new id.
    mockExpoFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: pacedStream(['event: delta\ndata: {"text":"truncated"}\n\n']),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => "application/json" },
        json: async () => ({
          error: "The previous generation failed. Start a new request.",
          status: "refunded",
        }),
      });

    const error = await generateStoryStreaming(draft, "req-4", {
      onDelta: () => {},
    }).then(() => null, (e: unknown) => e);
    expect((error as Error).message).toMatch("previous generation failed");
    expect((error as { resetRequestId?: boolean }).resetRequestId).toBe(true);
    const replay = JSON.parse(
      (mockExpoFetch.mock.calls[1][1] as { body: string }).body,
    );
    expect(replay.request_id).toBe("req-4");
  });
});

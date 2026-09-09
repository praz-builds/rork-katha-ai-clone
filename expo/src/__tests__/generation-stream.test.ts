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

  it("treats a stream that ends with no terminal event as a failure", async () => {
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: pacedStream(['event: delta\ndata: {"text":"truncated"}\n\n']),
      json: async () => ({}),
    });

    await expect(
      generateStoryStreaming(draft, "req-4", { onDelta: () => {} }),
    ).rejects.toThrow("stopped partway");
  });
});

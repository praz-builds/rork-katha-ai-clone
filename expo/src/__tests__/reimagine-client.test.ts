import {
  startReimagine,
  type RepromptRequest,
  type ReimagineResult,
} from "@/lib/reimagine-client";
import type { Chapter } from "@/types/domain";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: { auth: { getSession: jest.fn() } },
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

const chapter: Chapter = {
  id: "c1",
  storyId: "s1",
  title: "One",
  chapterNumber: 1,
  isPublished: false,
  paragraphs: [
    "Naina Mistry closed the bakery early.",
    "Aarav was waiting by the auto stand.",
  ],
};

/*
  Character replacement is gone from this client, and its tests with it.

  The sheet in front of it is the author's Re-prompt now: one instruction, no
  roster. Replacement was a find-and-replace across the prose, which could not
  touch a pronoun or anything a chapter said about who somebody was -- so the
  one thing it could not do was replace a character. A reader who wants
  somebody else in a story gets a story written for them instead
  (`lib/reimagine-seed.ts`), which is covered by `reimagine-seed.test.ts`.
*/

describe("startReimagine", () => {
  const request: RepromptRequest = {
    storyId: "s1",
    chapterNumber: 1,
    prompt: "Make it rain.",
  };

  it("accumulates prose, reports stage, and settles with the result", async () => {
    const result: ReimagineResult = {
      chapter: { ...chapter, paragraphs: ["It rained."] },
      model: "test",
      storyId: "s1",
      forked: false,
    };
    const run = startReimagine(request, async (_request, _id, handlers) => {
      handlers.onStage?.("context");
      handlers.onDelta("It ");
      handlers.onDelta("rained.");
      return result;
    });
    const seen: string[] = [];
    run.subscribe(() => seen.push(run.status));

    await expect(run.promise).resolves.toBe(result);
    expect(run.text).toBe("It rained.");
    expect(run.stage).toBe("context");
    expect(run.status).toBe("done");
    expect(run.result).toBe(result);
    expect(seen[seen.length - 1]).toBe("done");
  });

  it("holds a failure on the run without an unhandled rejection", async () => {
    const run = startReimagine(request, async () => {
      throw new Error("The rewrite failed on the server.");
    });
    await expect(run.promise).rejects.toThrow("The rewrite failed on the server.");
    expect(run.status).toBe("error");
    expect(run.error).toBe("The rewrite failed on the server.");
    expect(run.result).toBeNull();
  });

  it("carries the prompt through to the transport", async () => {
    let seen: RepromptRequest | null = null;
    const run = startReimagine(request, async (received, _id, handlers) => {
      seen = received;
      handlers.onDelta("ok");
      return {
        chapter,
        model: "test",
        storyId: "s1",
        forked: false,
      };
    });
    await run.promise;
    expect(seen).toEqual({
      storyId: "s1",
      chapterNumber: 1,
      prompt: "Make it rain.",
    });
  });
});

import {
  detectChapterCharacters,
  nameAppearsIn,
  replacementFromSaved,
  startReimagine,
  type ReimagineRequest,
  type ReimagineResult,
} from "@/lib/reimagine-client";
import type { Chapter, Story } from "@/types/domain";

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
    "Aarav was waiting by the auto stand, and Ana's banana bread was still warm.",
  ],
};

const story = {
  characters: [
    { name: "Naina Mistry", role: "A baker" },
    { name: "Aarav", role: "Her oldest friend" },
    { name: "Ana" },
    { name: "Ravi" },
    { name: "aarav" },
  ],
} as unknown as Story;

describe("nameAppearsIn", () => {
  it("matches whole words only, case-insensitively", () => {
    expect(nameAppearsIn("Ana", "Ana's banana bread")).toBe(true);
    expect(nameAppearsIn("Ana", "banana bread")).toBe(false);
    expect(nameAppearsIn("aarav", "Aarav was waiting")).toBe(true);
  });

  it("counts the first name of a multi-word roster entry", () => {
    expect(nameAppearsIn("Naina Mistry", "Naina closed the bakery.")).toBe(true);
    expect(nameAppearsIn("Naina Mistry", "Nainital was cold.")).toBe(false);
  });
});

describe("detectChapterCharacters", () => {
  it("lists roster characters whose name is on the page, once each, in roster order", () => {
    expect(detectChapterCharacters(story, chapter).map((item) => item.name)).toEqual([
      "Naina Mistry",
      "Aarav",
      "Ana",
    ]);
  });

  it("never invents a character from the prose", () => {
    expect(detectChapterCharacters({ characters: [] }, chapter)).toEqual([]);
    expect(detectChapterCharacters({}, chapter)).toEqual([]);
  });
});

describe("startReimagine", () => {
  const request: ReimagineRequest = {
    storyId: "s1",
    chapterNumber: 1,
    prompt: "Make it rain.",
    replacements: [replacementFromSaved("Aarav", {
      id: "saved-1",
      name: "Kabir",
      createdAt: "2026-09-09T00:00:00Z",
    }, true)],
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

  it("serialises a saved-character replacement with its id and the all-chapters flag", () => {
    expect(request.replacements[0]).toEqual({
      fromName: "Aarav",
      to: { savedCharacterId: "saved-1", name: "Kabir", portraitUrl: undefined },
      applyToAllChapters: true,
    });
  });

  it("walks the offline stub end to end when no backend is configured", async () => {
    const run = startReimagine(request);
    const result = await run.promise;
    expect(result.model).toBe("mock");
    expect(result.chapter.paragraphs.join(" ")).toContain("Aarav became Kabir");
    expect(run.text).toContain("Make it rain.");
  });
});

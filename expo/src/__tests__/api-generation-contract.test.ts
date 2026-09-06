/**
 * Guards the generate-story / continue-story request contract.
 *
 * story_mode is the current field; is_series is a legacy compatibility field
 * the backend still maps, but new callers must not depend on it.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockInvoke = jest.fn();
const mockBootstrapUser = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

jest.mock("@/lib/session", () => ({
  bootstrapUser: (...args: unknown[]) => mockBootstrapUser(...args),
}));

// jest.mock calls must be evaluated before these imports, so import/first
// cannot be satisfied here.
/* eslint-disable import/first */
import {
  continueStory,
  generateStory,
  inferStoryBrief,
  publishStory,
  registerPushToken,
  shapeStoryIdea,
} from "@/lib/api";
import type { CreateDraft } from "@/types/domain";
/* eslint-enable import/first */

const draft: CreateDraft = {
  primaryGenre: "fantasy",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed:
    "Two rival cartographers map the same uncharted valley and find it moves",
  language: "English",
  characters: [],
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return (call[1] as { body: Record<string, unknown> }).body;
}

function storyResponse(storyMode: "standalone" | "series") {
  return {
    data: {
      story: {
        id: "story-1",
        title: "The Moving Valley",
        author_id: "author-1",
        primary_genre: "fantasy",
        story_mode: storyMode,
        themes: ["maps"],
        word_count: 12,
        status: "complete",
      },
      chapter: {
        id: "chapter-1",
        chapter_number: 1,
        title: "Chapter 1",
        content: "The valley had moved again.",
        chapter_role: storyMode === "series" ? "series_opening" : "standalone",
      },
    },
    error: null,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockBootstrapUser.mockReset();
  mockBootstrapUser.mockResolvedValue({ isAnonymous: false, balance: 3 });
});

describe("generateStory request contract", () => {
  it('sends story_mode "series" when the draft is a series', async () => {
    mockInvoke.mockResolvedValue(storyResponse("series"));
    await generateStory({ ...draft, isSeries: true }, "req-1");

    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.story_mode).toBe("series");
  });

  it("maps the server story_mode back onto the returned story", async () => {
    mockInvoke.mockResolvedValue(storyResponse("series"));
    const story = await generateStory({ ...draft, isSeries: true }, "req-1b");

    expect(story.storyMode).toBe("series");
    expect(story.chapters[0].chapterRole).toBe("series_opening");
  });

  it('sends story_mode "standalone" when the draft is not a series', async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory({ ...draft, isSeries: false }, "req-2");

    expect(bodyOf(mockInvoke.mock.calls[0]).story_mode).toBe("standalone");
  });

  it('defaults to "standalone" when isSeries is omitted', async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory(draft, "req-3");

    expect(bodyOf(mockInvoke.mock.calls[0]).story_mode).toBe("standalone");
  });

  it("does not send the legacy is_series field", async () => {
    mockInvoke.mockResolvedValue(storyResponse("series"));
    await generateStory({ ...draft, isSeries: true }, "req-4");

    expect(bodyOf(mockInvoke.mock.calls[0])).not.toHaveProperty("is_series");
  });

  it("passes through the request id for idempotent retries", async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory(draft, "req-5");

    expect(bodyOf(mockInvoke.mock.calls[0]).request_id).toBe("req-5");
  });

  it("sends the reviewed genre chips with the primary route", async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory(
      { ...draft, genres: ["fantasy", "mystery"] },
      "req-genres",
    );

    expect(bodyOf(mockInvoke.mock.calls[0]).genres).toEqual([
      "fantasy",
      "mystery",
    ]);
  });
});

describe("continueStory request contract", () => {
  const chapterResponse = {
    data: {
      chapter: { id: "c2", chapter_number: 2, content: "Next." },
      model: "test",
    },
    error: null,
  };

  it("sends is_finale true when a finale is requested", async () => {
    mockInvoke.mockResolvedValue(chapterResponse);
    await continueStory("story-1", "req-6", true, 2);

    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.story_id).toBe("story-1");
    expect(body.is_finale).toBe(true);
  });

  it("sends is_finale false for a mid-series chapter", async () => {
    mockInvoke.mockResolvedValue(chapterResponse);
    await continueStory("story-1", "req-7", false, 2);

    expect(bodyOf(mockInvoke.mock.calls[0]).is_finale).toBe(false);
  });

  it("sends optional per-chapter reader steering", async () => {
    mockInvoke.mockResolvedValue(chapterResponse);
    await continueStory("story-1", "req-8", false, 2, "Open the locked attic.");

    expect(bodyOf(mockInvoke.mock.calls[0]).next_instruction).toBe(
      "Open the locked attic.",
    );
  });
});

describe("shapeStoryIdea", () => {
  it("drops blank inferred character rows", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        shape: {
          genres: ["romance"],
          characters: [{ name: "   ", description: "A placeholder" }],
        },
      },
      error: null,
    });

    const shape = await shapeStoryIdea("Two strangers meet in a market.");
    expect(shape?.characters).toEqual([]);
  });

  it("returns a usable shape from the free endpoint", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        shape: {
          genres: ["mystery", "horror"],
          whereAndWhen: "A hill town, off-season",
          characters: [{
            name: "Elena",
            description: "a restorer",
            isHero: true,
          }],
          suggestedMoments: ["The door is warm to the touch"],
        },
      },
      error: null,
    });

    const shape = await shapeStoryIdea(
      "A woman inherits a house with a hidden door.",
    );

    expect(bodyOf(mockInvoke.mock.calls[0]).idea).toContain("inherits a house");
    expect(shape?.genres).toEqual(["mystery", "horror"]);
    expect(shape?.characters[0].name).toBe("Elena");
  });

  it("silently returns null when shaping is unavailable", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error("offline") });
    await expect(shapeStoryIdea("A quiet mystery.")).resolves.toBeNull();
  });
});

describe("publishStory visibility contract", () => {
  it("sends private save intent with reviewed edits", async () => {
    mockInvoke.mockResolvedValue({
      data: { saved: true, published: false },
      error: null,
    });

    await publishStory("story-1", {
      title: "Reviewed title",
      visibility: "private",
      chapters: [{ id: "chapter-1", content: "Reviewed prose." }],
    });

    expect(mockInvoke.mock.calls[0][0]).toBe("publish-story");
    expect(bodyOf(mockInvoke.mock.calls[0])).toMatchObject({
      story_id: "story-1",
      title: "Reviewed title",
      visibility: "private",
    });
  });

  it("defaults a guest save to private", async () => {
    mockBootstrapUser.mockResolvedValue({ isAnonymous: true, balance: 3 });
    mockInvoke.mockResolvedValue({
      data: { saved: true, published: false },
      error: null,
    });

    await publishStory("story-1", { title: "Guest draft" });

    expect(bodyOf(mockInvoke.mock.calls[0]).visibility).toBe("private");
  });
});

describe("character payload", () => {
  // The screen used to seed one blank character row and send it verbatim.
  // `validation.ts` rejects any supplied character without a name, so every
  // user who never opened the cast — the common case — got a 400 on the
  // primary path.
  it("drops characters with no name", async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory(
      {
        ...draft,
        characters: [
          { name: "", description: "", isHero: true },
          { name: "   ", description: "ghost row", isHero: false },
          { name: "Elena", description: "a restorer", isHero: true },
        ],
      },
      "req-characters",
    );
    const characters = bodyOf(mockInvoke.mock.calls[0])
      .characters as { name: string }[];
    expect(characters).toHaveLength(1);
    expect(characters[0].name).toBe("Elena");
  });

  it("sends an empty array when the whole cast is blank", async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory(
      { ...draft, characters: [{ name: "", description: "", isHero: true }] },
      "req-blank-cast",
    );
    expect(bodyOf(mockInvoke.mock.calls[0]).characters).toEqual([]);
  });

  it("carries background, appearance, and portrait URL through to the request", async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory(
      {
        ...draft,
        characters: [{
          name: "Elena",
          description: "a restorer",
          background: "Has not spoken to her mother in six years.",
          appearance: "Dark hair pinned up, paint on her hands.",
          portraitUrl: "https://example.com/elena.png",
          isHero: true,
        }],
      },
      "req-rich-character",
    );
    const characters = bodyOf(mockInvoke.mock.calls[0])
      .characters as Record<string, unknown>[];
    expect(characters[0].background).toContain("six years");
    expect(characters[0].appearance).toContain("Dark hair");
    expect(characters[0].portrait_url).toBe("https://example.com/elena.png");
  });
});

describe("world and beats fields", () => {
  it("sends retained brief fields when set", async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory(
      {
        ...draft,
        whereAndWhen: "A hill town, off-season, present day",
        moments: ["She hears her own name through the wall"],
        storyValues: ["kindness"],
        writingStyle: "poetic, short sentences",
        avoid: "spiders",
        chapterLength: "long",
        plannedChapterCount: 7,
        illustrateChapters: true,
      },
      "req-world",
    );
    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.where_and_when).toBe("A hill town, off-season, present day");
    expect(body.moments).toEqual(["She hears her own name through the wall"]);
    expect(body.story_values).toEqual(["kindness"]);
    expect(body.writing_style).toBe("poetic, short sentences");
    expect(body.avoid).toBe("spiders");
    expect(body.chapter_length).toBe("long");
    expect(body.planned_chapter_count).toBe(7);
    expect(body.illustrate_chapters).toBe(true);
  });

  it("omits them as undefined when unset, rather than sending nulls", async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory(draft, "req-no-world");
    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.where_and_when).toBeUndefined();
    expect(body.moments).toBeUndefined();
    expect(body.beats).toBeUndefined();
    expect(body.chapter_length).toBeUndefined();
  });
});

describe("the story plan", () => {
  it("sends the approved plan with the generation request", async () => {
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory(
      {
        ...draft,
        beats: ["She finds the door", "The letters arrive", "She answers one"],
        plannedChapterCount: 3,
      },
      "req-beats",
    );
    // Without this the outline the user approved on the blueprint screen and
    // the story they are given are unrelated.
    expect(bodyOf(mockInvoke.mock.calls[0]).beats).toEqual([
      "She finds the door",
      "The letters arrive",
      "She answers one",
    ]);
  });

  it("reads the plan back out of the shape response", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        shape: {
          genres: ["mystery"],
          whereAndWhen: "A hill town",
          characters: [],
          suggestedMoments: [],
          beats: ["one", " ", "two", 7],
        },
      },
      error: null,
    });
    const shape = await shapeStoryIdea("A quiet mystery.");
    expect(shape?.beats).toEqual(["one", "two"]);
  });

  it("asks for a title and an opening only in the onboarding variant", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        shape: {
          genres: ["mystery"],
          whereAndWhen: "",
          characters: [],
          suggestedMoments: [],
          beats: [],
          title: "Bellwether House",
          opening: "The clocks began counting backward.",
        },
      },
      error: null,
    });
    const shape = await inferStoryBrief("A quiet mystery.", "onboarding");
    expect(bodyOf(mockInvoke.mock.calls[0]).variant).toBe("onboarding");
    expect(shape?.title).toBe("Bellwether House");
    expect(shape?.opening).toContain("clocks");
  });

  it("defaults to the create variant", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { shape: { genres: ["mystery"], characters: [] } },
      error: null,
    });
    await shapeStoryIdea("A quiet mystery.");
    expect(bodyOf(mockInvoke.mock.calls[0]).variant).toBe("create");
  });
});

describe("push token registration", () => {
  it("sends the token and platform", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { registered: true }, error: null });
    await registerPushToken("ExponentPushToken[abc]", "ios", "device-1");
    expect(mockInvoke.mock.calls[0][0]).toBe("register-push-token");
    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.expo_token).toBe("ExponentPushToken[abc]");
    expect(body.platform).toBe("ios");
    expect(body.device_id).toBe("device-1");
  });

  it("surfaces a failure to its caller rather than swallowing it", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("nope") });
    await expect(registerPushToken("ExponentPushToken[abc]", "android"))
      .rejects.toThrow();
  });
});

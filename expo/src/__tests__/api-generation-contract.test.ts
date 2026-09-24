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
  CharacterPortraitInsufficientCreditsError,
  continueStory,
  generateCharacterImage,
  generateStory,
  inferStoryBrief,
  publishStory,
  registerPushToken,
  shapeStoryIdea,
} from "@/lib/api";
import {
  getCharacterImageBalance,
  getCharacterImagesRemaining,
  setCharacterImagesRemaining,
} from "@/lib/character-image-allowance";
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

  it("sends the writer's title, trimmed, when the draft has one", async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory({ ...draft, title: "  The Moving Valley " }, "req-title");

    expect(bodyOf(mockInvoke.mock.calls[0]).title).toBe("The Moving Valley");
  });

  it("omits title entirely when the draft has none or a blank one", async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory(draft, "req-untitled");
    await generateStory({ ...draft, title: "   " }, "req-blank-title");

    // Absent, not blank: the server then names the story as it always has.
    expect(bodyOf(mockInvoke.mock.calls[0])).not.toHaveProperty("title");
    expect(bodyOf(mockInvoke.mock.calls[1])).not.toHaveProperty("title");
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

  /**
   * `image_style` and `story_flow` are ALWAYS sent, defaults included.
   *
   * An omitted field cannot be told apart from a client too old to have the
   * control, so the server could never distinguish "the writer chose Auto"
   * from "this client cannot say" -- and the difference decides whether the
   * genre picks the art or the request is treated as unversioned.
   */
  it("sends the image style and the story flow, defaulting them rather than omitting them", async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory(draft, "req-style-default");

    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body.image_style).toBe("auto");
    expect(body.story_flow).toBe("interactive");
  });

  it("sends the writer's chosen image style and story flow in the wire spelling", async () => {
    mockInvoke.mockResolvedValue(storyResponse("series"));
    await generateStory(
      { ...draft, imageStyle: "watercolor", storyFlow: "auto" },
      "req-style-chosen",
    );

    const body = bodyOf(mockInvoke.mock.calls[0]);
    // Lower case, and the backend's own vocabulary -- not the label the
    // dropdown shows.
    expect(body.image_style).toBe("watercolor");
    expect(body.story_flow).toBe("auto");
  });

  /**
   * The publish toggle travels with the generation request. It used to be
   * left out entirely, so the server always generated private and a public
   * story depended on a second, unattended call succeeding.
   */
  it("sends the visibility the writer chose, and private when they chose nothing", async () => {
    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory({ ...draft, visibility: "public" }, "req-vis-public");
    expect(bodyOf(mockInvoke.mock.calls[0]).visibility).toBe("public");

    mockInvoke.mockResolvedValue(storyResponse("standalone"));
    await generateStory({ ...draft, visibility: undefined }, "req-vis-absent");
    expect(bodyOf(mockInvoke.mock.calls[1]).visibility).toBe("private");
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

  /**
   * `extend` is what turns a refusal into a chapter, so it must never be sent
   * by accident. The server answers 400 to an over-plan chapter that omits it,
   * which is the behaviour that protects a writer's balance from every caller
   * except the one deliberate tap.
   */
  it("sends extend false unless the caller asked to grow the story", async () => {
    mockInvoke.mockResolvedValue(chapterResponse);
    await continueStory("story-1", "req-9", false, 2, "Open the attic.", []);

    expect(bodyOf(mockInvoke.mock.calls[0]).extend).toBe(false);
  });

  it("sends extend true when a reader grows a finished story", async () => {
    mockInvoke.mockResolvedValue(chapterResponse);
    await continueStory(
      "story-1",
      "req-10",
      false,
      2,
      "Open the attic.",
      [],
      true,
    );

    expect(bodyOf(mockInvoke.mock.calls[0]).extend).toBe(true);
  });
});

describe("shapeStoryIdea", () => {
  it("drops blank inferred character rows", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        shape: {
          genres: ["romance"],
          characters: [{ name: "   ", appearance: "A placeholder" }],
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
            appearance: "a restorer",
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

  it("states private for a signed-in user rather than leaving it to the server", async () => {
    // The field used to be omitted for signed-in users, which handed the
    // decision to whichever build of publish-story was deployed — and the old
    // one read an absent field as "public".
    mockBootstrapUser.mockResolvedValue({ isAnonymous: false, balance: 12 });
    mockInvoke.mockResolvedValue({
      data: { saved: true, published: false },
      error: null,
    });

    await publishStory("story-1", { title: "A saved story" });

    expect(bodyOf(mockInvoke.mock.calls[0]).visibility).toBe("private");
  });

  it("still publishes publicly when the user asks for it", async () => {
    mockBootstrapUser.mockResolvedValue({ isAnonymous: false, balance: 12 });
    mockInvoke.mockResolvedValue({
      data: { published: true },
      error: null,
    });

    await publishStory("story-1", { visibility: "public" });

    expect(bodyOf(mockInvoke.mock.calls[0]).visibility).toBe("public");
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
          { name: "", appearance: "", isHero: true },
          { name: "   ", appearance: "ghost row", isHero: false },
          { name: "Elena", appearance: "a restorer", isHero: true },
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
      { ...draft, characters: [{ name: "", appearance: "", isHero: true }] },
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
  });

  it("resolves an unset chapter length to the same default the setup screen displays, rather than leaving it for the backend to guess", async () => {
    // The backend's own fallback for an absent chapter_length is "standard",
    // audience-unaware -- see `effectiveChapterLength` in `lib/api.ts`. An
    // adult draft's displayed default already happens to agree with that,
    // but a kids draft's does not: the setup screen shows "Short" for a kids
    // draft with no explicit choice, and the request must say the same
    // thing, not "standard".
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory({ ...draft, audienceMode: "adult" }, "req-adult-default");
    expect(bodyOf(mockInvoke.mock.calls[0]).chapter_length).toBe("standard");

    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory({ ...draft, audienceMode: "kids" }, "req-kids-default");
    expect(bodyOf(mockInvoke.mock.calls[1]).chapter_length).toBe("short");

    // An explicit choice always wins, regardless of audience.
    mockInvoke.mockResolvedValueOnce(storyResponse("standalone"));
    await generateStory({ ...draft, audienceMode: "kids", chapterLength: "long" }, "req-kids-explicit");
    expect(bodyOf(mockInvoke.mock.calls[2]).chapter_length).toBe("long");
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

  it("sends shaping only the cast fields it reads, never the reference photo", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { shape: { genres: ["mystery"], characters: [] } },
      error: null,
    });
    await inferStoryBrief("A quiet mystery.", "create", undefined, {
      characters: [{
        name: "Naina",
        background: "Keeps recipes.",
        appearance: "Flour on her sleeves.",
        isHero: true,
        portraitUrl: "https://cdn.example.test/naina.png",
        referenceImage: "data:image/jpeg;base64,AAAA",
        referenceImageName: "IMG_2231.jpg",
      }],
    });
    const sent = bodyOf(mockInvoke.mock.calls[0]);
    expect(sent.characters).toEqual([{
      name: "Naina",
      background: "Keeps recipes.",
      appearance: "Flour on her sleeves.",
      isHero: true,
    }]);
    const raw = JSON.stringify(sent);
    expect(raw).not.toContain("base64");
    expect(raw).not.toContain("IMG_2231.jpg");
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

/**
 * The Craft-sheet portrait call.
 *
 * `generate-character-image` accepted no style, so a portrait came back in the
 * house style beside a cover the writer had asked to be something else -- on
 * the one screen where the two are compared. The style is always sent, `auto`
 * included, because `auto` is a choice the writer can return to.
 */
describe("generateCharacterImage", () => {
  it("sends the appearance and the brief's image style, and no description", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { url: "https://example.test/priya.png" },
      error: null,
    });

    await generateCharacterImage({
      requestId: "req-portrait",
      name: "Priya",
      appearance: "A baker with flour on her sleeves.",
      imageStyle: "watercolor",
    });

    const body = bodyOf(mockInvoke.mock.calls[0]);
    expect(body).toMatchObject({
      request_id: "req-portrait",
      name: "Priya",
      appearance: "A baker with flour on her sleeves.",
      image_style: "watercolor",
    });
    expect(body).not.toHaveProperty("description");
  });

  it("falls back to auto rather than omitting the style", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { url: "https://example.test/priya.png" },
      error: null,
    });

    await generateCharacterImage({
      requestId: "req-portrait-2",
      name: "Priya",
      appearance: "A baker.",
    });

    expect(bodyOf(mockInvoke.mock.calls[0]).image_style).toBe("auto");
  });

  it("records what the server says is left, so the next quote is the server's", async () => {
    // Three free images per account (migration 00096; six under 00088). The count that prices the
    // NEXT button has to come from the response that just moved it -- a client
    // counting its own taps disagrees the moment two surfaces are used in one
    // session, and the disagreement is a free-looking button that charges.
    mockInvoke.mockResolvedValueOnce({
      data: {
        url: "https://example.test/priya.png",
        credits_charged: 0,
        free_remaining: 3,
        balance: 7,
      },
      error: null,
    });

    const result = await generateCharacterImage({
      requestId: "req-portrait-3",
      name: "Priya",
      appearance: "A baker.",
    });

    expect(result.creditsCharged).toBe(0);
    expect(result.freeRemaining).toBe(3);
    expect(getCharacterImagesRemaining()).toBe(3);
    expect(getCharacterImageBalance()).toBe(7);
  });

  it("leaves the count alone when an older deploy does not send one", async () => {
    setCharacterImagesRemaining(4);
    mockInvoke.mockResolvedValueOnce({
      data: { url: "https://example.test/priya.png" },
      error: null,
    });

    await generateCharacterImage({
      requestId: "req-portrait-4",
      name: "Priya",
      appearance: "A baker.",
    });

    // Not reset to null and not decremented by one: a deploy that says nothing
    // about the allowance has not changed what we last knew about it.
    expect(getCharacterImagesRemaining()).toBe(4);
  });

  it("tells an out-of-credits refusal apart from a failure to draw", async () => {
    // 402 is the free three being spent and the balance being short. The screens route
    // on the type: a "Try again" offered on this refusal cannot succeed.
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error("failed"), {
        context: {
          status: 402,
          json: async () => ({ code: "insufficient_credits" }),
        },
      }),
    });

    await expect(
      generateCharacterImage({
        requestId: "req-portrait-5",
        name: "Priya",
        appearance: "A baker.",
      }),
    ).rejects.toBeInstanceOf(CharacterPortraitInsufficientCreditsError);
  });
});

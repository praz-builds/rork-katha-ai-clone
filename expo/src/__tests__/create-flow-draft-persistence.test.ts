jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

/* eslint-disable import/first */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-storage";
/* eslint-enable import/first */

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const completeDraft = {
  primaryGenre: "adventure",
  audienceMode: "kids",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "A child follows a map hidden in a library book.",
  language: "Portuguese",
  visibility: "private" as const,
  isSeries: true,
  characters: [{
    name: "Asha",
    description: "A curious young mapmaker",
    background: "Keeps her grandmother's old compass.",
    appearance: "Curly hair, green raincoat, red backpack.",
    isHero: true,
  }],
  whereAndWhen: "A coastal library, present day",
  moments: ["Asha finds the map", "The shelves move at midnight"],
  storyValues: ["kindness", "courage"],
  writingStyle: "Warm and playful",
  avoid: "scary imagery",
  chapterLength: "short" as const,
  plannedChapterCount: 7 as const,
  illustrateChapters: true,
};

beforeEach(() => {
  jest.restoreAllMocks();
  storage.getItem.mockReset();
  storage.setItem.mockReset();
  storage.removeItem.mockReset();
});

describe("create draft persistence", () => {
  it("round-trips every pre-generation brief field", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    await saveDraft(completeDraft as never);

    expect(storage.setItem).toHaveBeenCalledWith(
      "katha:create:draft",
      JSON.stringify({ ...completeDraft, savedAt: 1_700_000_000_000 }),
    );

    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ ...completeDraft, savedAt: 1_700_000_000_000 }),
    );
    const restored = await loadDraft();

    expect(restored).toEqual(completeDraft);
  });

  it("drops malformed and expired drafts without surfacing an error", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    storage.getItem.mockResolvedValueOnce("not json");
    await expect(loadDraft()).resolves.toBeNull();

    storage.getItem.mockResolvedValueOnce(JSON.stringify({
      ...completeDraft,
      savedAt: 1_700_000_000_000 - (8 * 24 * 60 * 60 * 1000),
    }));
    await expect(loadDraft()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith("katha:create:draft");
  });

  it("clears only the local pre-generation draft", async () => {
    await clearDraft();
    expect(storage.removeItem).toHaveBeenCalledWith("katha:create:draft");
  });

  it("normalizes legacy defaults and assigns one lead", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    storage.getItem.mockResolvedValueOnce(JSON.stringify({
      ...completeDraft,
      language: "Spanish",
      visibility: undefined,
      isSeries: undefined,
      characters: completeDraft.characters.map((character) => ({
        ...character,
        isHero: false,
      })),
      savedAt: 1_700_000_000_000,
    }));

    const restored = await loadDraft();

    expect(restored).toMatchObject({
      language: "English",
      visibility: "private",
      isSeries: true,
      characters: [expect.objectContaining({ isHero: true })],
    });
  });
});

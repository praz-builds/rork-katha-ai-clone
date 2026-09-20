import { seedDraftFromStory } from "@/lib/reimagine-seed";
import type { Story } from "@/types/domain";

const base: Story = {
  id: "s1",
  title: "Kismat Cafe Reunion",
  authorId: "someone-else",
  genre: "romance",
  primaryGenre: "romance",
  storyMode: "series",
  plannedChapterCount: 7,
  audienceMode: "adult",
  spiceLevel: "steamy",
  synopsis: "Two people who grew up over the same counter meet again at thirty.",
  chapters: [],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

it("carries the premise verbatim, because the reader is about to edit it", () => {
  const draft = seedDraftFromStory(base);
  expect(draft.seed).toBe(
    "Two people who grew up over the same counter meet again at thirty.",
  );
});

it("carries the shape of the story: genre, audience, spice, language, length", () => {
  const draft = seedDraftFromStory(base);
  expect(draft.primaryGenre).toBe("romance");
  expect(draft.audienceMode).toBe("adult");
  expect(draft.spiceLevel).toBe("steamy");
  expect(draft.language).toBe("English");
  expect(draft.isSeries).toBe(true);
  expect(draft.plannedChapterCount).toBe(7);
});

it("never carries the original's cast, plan or grounding", () => {
  // The whole point is that the reader brings their own people, and `beats`
  // and `grounding` belong to the premise that is about to be edited.
  const draft = seedDraftFromStory({
    ...base,
    characters: [{ name: "Aarav" }, { name: "Maya" }],
  } as Story);
  expect(draft.characters).toBeUndefined();
  expect(draft.beats).toBeUndefined();
  expect(draft.grounding).toBeUndefined();
  // Visibility is the create flow's own default. Inheriting a stranger's
  // choice to be public is not a choice the reader made.
  expect(draft.visibility).toBeUndefined();
});

it("keeps a standalone standalone, and does not invent a chapter count for it", () => {
  const draft = seedDraftFromStory({
    ...base,
    storyMode: "standalone",
    plannedChapterCount: undefined,
  });
  expect(draft.isSeries).toBe(false);
  expect(draft.plannedChapterCount).toBeUndefined();
});

it("drops a chapter count the Create flow does not offer", () => {
  // A story extended to 9 chapters is a real row; 9 is not a button. Seeding
  // it would open the brief on a length the picker cannot show as chosen.
  const draft = seedDraftFromStory({ ...base, plannedChapterCount: 9 });
  expect(draft.plannedChapterCount).toBeUndefined();
  expect(draft.isSeries).toBe(true);
});

it("falls back to the legacy genre field when a story predates the split", () => {
  const draft = seedDraftFromStory({
    ...base,
    primaryGenre: undefined,
    genre: "scifi",
  });
  expect(draft.primaryGenre).toBe("scifi");
});

it("leaves a language the picker no longer offers to the default", () => {
  // Portuguese is still a valid `CreationLanguage` so old rows resolve, but it
  // cannot be chosen -- a brief seeded with it would write every chapter in a
  // language with no control to change it.
  const draft = seedDraftFromStory({ ...base, language: "Portuguese" });
  expect(draft.language).toBeUndefined();
});

it("leaves the genre to the picker's default when the story's is retired", () => {
  // `thriller` stays a valid `Genre` forever so old stories keep rendering,
  // but it is not offered any more. A draft holding it would show a genre row
  // with nothing selected, which is worse than the default.
  const draft = seedDraftFromStory({
    ...base,
    primaryGenre: "thriller",
    genre: "thriller",
  });
  expect(draft.primaryGenre).toBeUndefined();
});

it("omits a premise the story does not have rather than seeding an empty box", () => {
  const draft = seedDraftFromStory({ ...base, synopsis: "   " });
  expect(draft.seed).toBeUndefined();
});

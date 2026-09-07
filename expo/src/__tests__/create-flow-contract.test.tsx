import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { Story } from "@/types/domain";

const mockGenerateStory = jest.fn();
const mockInferStoryBrief = jest.fn();
const mockGenerateCharacterImage = jest.fn();
const mockLoadDraft = jest.fn();
const mockSaveDraft = jest.fn();
const mockClearDraft = jest.fn();

jest.mock("@/lib/api", () => {
  class MockGenerationRequestError extends Error {
    resetRequestId = false;
  }

  return {
    // The Create flow generates through the streamed path. The buffered
    // `generateStory` is still exported for retries, but the screen no longer
    // calls it, and asserting against it here would pass while the user got
    // nothing on screen until the very end.
    generateStoryStreaming: (...args: unknown[]) => mockGenerateStory(...args),
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
    generateCharacterImage: (...args: unknown[]) =>
      mockGenerateCharacterImage(...args),
    continueStoryStreaming: jest.fn(),
    createGenerationRequestId: () => "create-flow-test-request",
    editParagraphStreaming: jest.fn(),
    publishStory: jest.fn(),
    GenerationRequestError: MockGenerationRequestError,
  };
});

jest.mock("@/lib/draft-storage", () => ({
  loadDraft: () => mockLoadDraft(),
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  clearDraft: () => mockClearDraft(),
}));

jest.mock("@/components/GeneratingOverlay", () => () => null);

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/KathaPrimitives", () => {
  // jest.mock factories are hoisted, so these dependencies must load here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");

  return {
    CreditPill: ({ credits }: { credits: number }) =>
      React.createElement(Text, null, `${credits} credits`),
    PrimaryButton: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
      React.createElement(
        Pressable,
        { accessibilityRole: "button", onPress },
        React.createElement(Text, null, children),
      ),
  };
});

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/* eslint-disable import/first */
import CreateStudioScreen from "@/screens/CreateStudioScreen";
/* eslint-enable import/first */

const generatedStory: Story = {
  id: "story-1",
  title: "The Quiet Door",
  authorId: "author-1",
  genre: "adventure",
  synopsis: "A generated story.",
  chapters: [{
    id: "chapter-1",
    storyId: "story-1",
    title: "Chapter one",
    paragraphs: ["The story begins."],
    chapterNumber: 1,
    isPublished: false,
  }],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

async function renderCreate(options: { isAnonymous?: boolean } = {}) {
  return await render(
    <CreateStudioScreen
      credits={12}
      isAnonymous={options.isAnonymous ?? true}
      onCreditUsed={jest.fn()}
      onPublished={jest.fn()}
      onBack={jest.fn()}
    />,
  );
}

async function fillIdea(
  view: Awaited<ReturnType<typeof render>>,
  idea = "A child finds a door in an old library that was not there yesterday.",
) {
  await fireEvent.changeText(view.getByLabelText("Story idea"), idea);
  await view.findByRole("button", { name: "Add a character" });
}

beforeEach(() => {
  mockGenerateStory.mockReset();
  mockInferStoryBrief.mockReset();
  mockGenerateCharacterImage.mockReset();
  mockLoadDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset();
  mockClearDraft.mockReset();
  mockInferStoryBrief.mockResolvedValue({
    genres: ["adventure"],
    whereAndWhen: "A quiet library, present day",
    characters: [],
    suggestedMoments: [],
  });
  mockGenerateCharacterImage.mockResolvedValue({
    url: "https://example.com/portrait.png",
  });
});

describe("approved Create flow", () => {
  it("uses a compact Kids Mode switch and only reveals Values for kids", async () => {
    const view = await renderCreate();

    await fillIdea(view);
    const kidsMode = view.getByRole("switch", { name: "Kids Mode" });
    expect(kidsMode.props.value).toBe(false);
    expect(view.queryByText("Values")).toBeNull();

    await fireEvent(kidsMode, "valueChange", true);
    expect(view.getByText("Values")).toBeTruthy();
    expect(view.getByRole("checkbox", { name: "Kindness" })).toBeTruthy();

    await fireEvent(kidsMode, "valueChange", false);
    expect(view.queryByText("Values")).toBeNull();
  });

  it("opens the character sheet, keeps the four draft fields, and caps the cast at three", async () => {
    const view = await renderCreate();
    await fillIdea(view);

    for (const name of ["Asha", "Rohan", "Minoo"]) {
      await fireEvent.press(view.getByRole("button", { name: "Add a character" }));
      expect(view.getByText("Craft character")).toBeTruthy();
      expect(view.getByText("Name")).toBeTruthy();
      expect(view.getByText("Description")).toBeTruthy();
      expect(view.getByText("Background")).toBeTruthy();
      expect(view.getByText("Appearance")).toBeTruthy();

      await fireEvent.changeText(view.getByLabelText("Name"), name);
      await fireEvent.changeText(view.getByLabelText("Description"), "A determined explorer");
      await fireEvent.changeText(view.getByLabelText("Background"), "Keeps a promise to their family.");
      await fireEvent.changeText(view.getByLabelText("Appearance"), "Curly hair and a red backpack.");
      await fireEvent.press(view.getByRole("button", { name: "Save" }));
      await view.findByRole("button", { name: `Edit ${name}` });
    }

    expect(view.queryByRole("button", { name: "Add a character" })).toBeNull();
  });

  it("offers English only in the Language control, and never Spanish or Portuguese", async () => {
    const view = await renderCreate();
    await fillIdea(view);

    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    const language = view.getByRole("button", { name: "Language" });
    expect(language.props.accessibilityValue).toEqual({ text: "English" });

    await fireEvent.press(language);
    expect(view.getByRole("button", { name: "English" })).toBeTruthy();
    expect(view.queryByText("Portuguese")).toBeNull();
    expect(view.queryByText("Spanish")).toBeNull();
  });

  it("keeps the whole generation flow on one screen and does not infer on Continue", async () => {
    mockInferStoryBrief.mockRejectedValueOnce(new Error("inference unavailable"));
    const view = await renderCreate();

    await fillIdea(view, "A lighthouse keeper receives a letter from tomorrow.");

    expect(mockInferStoryBrief).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(view.getByRole("button", { name: "Add a character" })).toBeTruthy();
    expect(view.getByRole("button", { name: "More options" })).toBeTruthy();
    expect(view.queryByText(/inference unavailable/i)).toBeNull();
    expect(view.queryByText(/could not analyze/i)).toBeNull();
  });

  it("puts audience and genre at the parent level before the prompt and opens genre vertically", async () => {
    const view = await renderCreate();

    const genre = view.getByRole("button", { name: "Genre" });

    expect(view.getByRole("switch", { name: "Kids Mode" })).toBeTruthy();
    expect(view.getByLabelText("Story idea")).toBeTruthy();

    await fireEvent.press(genre);
    expect(view.getByRole("button", { name: "Choose Romance" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Choose Mystery" })).toBeTruthy();
  });

  it("sends the reviewed Kids brief and More options to generation", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view, "A child follows a map hidden in a library book.");

    await fireEvent(view.getByRole("switch", { name: "Kids Mode" }), "valueChange", true);
    await fireEvent.press(view.getByRole("checkbox", { name: "Kindness" }));
    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.changeText(view.getByLabelText("Writing style"), "Warm, playful, and direct");
    await fireEvent.changeText(view.getByLabelText("Avoid"), "scary imagery");
    await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
    await fireEvent.press(view.getByRole("button", { name: "7 chapters" }));
    await fireEvent.press(view.getByRole("button", { name: "Chapter length" }));
    await fireEvent.press(view.getByRole("button", { name: "Long" }));
    await fireEvent(
      view.getByRole("switch", { name: "Chapter art" }),
      "valueChange",
      true,
    );
    // Language now offers English only -- see the dedicated Language test --
    // so it is left untouched here rather than switched to Portuguese.
    // The setup screen's Create button opens the pre-generation review screen;
    // its own Create button is the one that actually fires generation.
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      audienceMode: "kids",
      spiceLevel: "sweet",
      language: "English",
      storyValues: ["kindness"],
      writingStyle: "Warm, playful, and direct",
      avoid: "scary imagery",
      chapterLength: "long",
      plannedChapterCount: 7,
      illustrateChapters: true,
    });
  });

  // Onboarding resolves grounding for free while the writer edits chips, and it
  // reached this screen and was then dropped when `createDraft` was rebuilt. The
  // paid generation either re-derived it or, past its tighter fallback deadline,
  // lost it -- silently, because `api.ts` forwards these fields only when
  // present. Nothing failed; the Shivaji case was just quietly wrong again.
  it("carries onboarding grounding through to the generation payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const grounding = [{ canonicalName: "Shivaji Maharaj" }];
    const groundingEntities = [
      { name: "Shivaji Maharaj", entityClass: "historical_public_figure" },
    ];

    const view = await render(
      <CreateStudioScreen
        credits={12}
        onCreditUsed={jest.fn()}
        onPublished={jest.fn()}
        onBack={jest.fn()}
        initialDraft={{
          primaryGenre: "historical",
          audienceMode: "adult",
          spiceLevel: "sweet",
          identityLenses: [],
          seed: "A boy in Pune finds his great-grandfather's campaign journal.",
          language: "English",
          visibility: "private",
          characters: [],
          isSeries: false,
          grounding,
          groundingEntities,
        }}
      />,
    );

    // The setup screen's Create button opens the pre-generation review screen
    // (see "sends the reviewed Kids brief..." below); this pre-existing test
    // predated that screen and only ever pressed Create once, so it never
    // actually reached generation. Fixed as part of this task's baseline
    // measurement, not the dropdown work itself.
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      grounding,
      groundingEntities,
    });
  });

  it("creates character images separately before the story generation call", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view);

    await fireEvent.press(view.getByRole("button", { name: "Add a character" }));
    await fireEvent.changeText(view.getByLabelText("Name"), "Praz");
    await fireEvent.changeText(view.getByLabelText("Description"), "A young explorer");
    await fireEvent.changeText(view.getByLabelText("Appearance"), "Dark hair and travel clothes");
    await fireEvent.press(view.getByRole("button", { name: "Create image" }));

    await waitFor(() => expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1));
    expect(mockGenerateStory).not.toHaveBeenCalled();

    await fireEvent.press(view.getByRole("button", { name: "Save" }));
    await view.findByText("Image ready");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));
    expect(mockGenerateStory.mock.calls[0][0].characters[0]).toMatchObject({
      name: "Praz",
      portraitUrl: "https://example.com/portrait.png",
      portraitStatus: "ready",
    });
  });

  it.each([3, 7, 15] as const)(
    "sends a planned chapter count of %d to the generation payload",
    async (count) => {
      mockGenerateStory.mockResolvedValueOnce(generatedStory);
      const view = await renderCreate();
      await fillIdea(view);

      await fireEvent.press(view.getByRole("button", { name: "More options" }));
      await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
      await fireEvent.press(
        view.getByRole("button", { name: `${count} chapters` }),
      );
      await fireEvent.press(view.getByRole("button", { name: /create/i }));
      await view.findByText("Here is what Katha will write");
      await fireEvent.press(view.getByRole("button", { name: /create/i }));
      await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

      expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
        plannedChapterCount: count,
      });
    },
  );

  it.each(["short", "standard", "long"] as const)(
    "sends a chapter length of %s to the generation payload",
    async (length) => {
      mockGenerateStory.mockResolvedValueOnce(generatedStory);
      const view = await renderCreate();
      await fillIdea(view);

      await fireEvent.press(view.getByRole("button", { name: "More options" }));
      const label = length.charAt(0).toUpperCase() + length.slice(1);
      await fireEvent.press(view.getByRole("button", { name: "Chapter length" }));
      await fireEvent.press(view.getByRole("button", { name: label }));
      await fireEvent.press(view.getByRole("button", { name: /create/i }));
      await view.findByText("Here is what Katha will write");
      await fireEvent.press(view.getByRole("button", { name: /create/i }));
      await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

      expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
        chapterLength: length,
      });
    },
  );

  it("defaults visibility to private in the generation payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);

    expect(
      view.getByRole("switch", { name: "Kids Mode" }),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    expect(view.getByText("Private")).toBeTruthy();

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      visibility: "private",
    });
  });

  it("can be switched to Public visibility and it reaches the generation payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);

    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    const visibilitySwitch = view.getByRole("switch", {
      name: "Public visibility",
    });
    expect(visibilitySwitch.props.value).toBe(false);
    await fireEvent(visibilitySwitch, "valueChange", true);

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    expect(view.getByText("Public")).toBeTruthy();

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      visibility: "public",
    });
  });

  it("sends a character's background and appearance to the generation payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view);

    await fireEvent.press(view.getByRole("button", { name: "Add a character" }));
    await fireEvent.changeText(view.getByLabelText("Name"), "Elena");
    await fireEvent.changeText(
      view.getByLabelText("Description"),
      "A historical restorer, 34",
    );
    await fireEvent.changeText(
      view.getByLabelText("Background"),
      "Hasn't spoken to her mother in six years.",
    );
    await fireEvent.changeText(
      view.getByLabelText("Appearance"),
      "Dark hair pinned up, paint on her hands.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Save" }));

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0].characters[0]).toMatchObject({
      name: "Elena",
      description: "A historical restorer, 34",
      background: "Hasn't spoken to her mother in six years.",
      appearance: "Dark hair pinned up, paint on her hands.",
    });
  });

  it("shows every chosen value on the review screen and preserves them when going back", async () => {
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view, "A lighthouse keeper receives a letter from tomorrow.");

    await fireEvent.press(view.getByRole("button", { name: "Add a character" }));
    await fireEvent.changeText(view.getByLabelText("Name"), "Mara");
    await fireEvent.press(view.getByRole("button", { name: "Save" }));

    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.changeText(
      view.getByLabelText("Writing style"),
      "Lyrical, present tense",
    );
    await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
    await fireEvent.press(view.getByRole("button", { name: "15 chapters" }));
    await fireEvent.press(view.getByRole("button", { name: "Chapter length" }));
    await fireEvent.press(view.getByRole("button", { name: "Long" }));
    const visibilitySwitch = view.getByRole("switch", {
      name: "Public visibility",
    });
    await fireEvent(visibilitySwitch, "valueChange", true);

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");

    // Every choice made on the setup screen is restated here before anything
    // is spent.
    expect(
      view.getByText("A lighthouse keeper receives a letter from tomorrow."),
    ).toBeTruthy();
    expect(view.getByText(/Mara/)).toBeTruthy();
    expect(view.getByText("15")).toBeTruthy();
    expect(view.getByText(/Long/)).toBeTruthy();
    expect(view.getByText("Lyrical, present tense")).toBeTruthy();
    expect(view.getByText("Public")).toBeTruthy();

    // Going back does not reset anything: it is the same draft, not a copy.
    await fireEvent.press(view.getByRole("button", { name: "Back to edit" }));
    expect(view.getByLabelText("Story idea").props.value).toBe(
      "A lighthouse keeper receives a letter from tomorrow.",
    );
    expect(
      view.getByRole("switch", { name: "Public visibility" }).props.value,
    ).toBe(true);
    // The Chapters and Chapter length dropdowns reset to closed on this fresh
    // mount, so their options are not in the tree -- the committed value is
    // read from the closed trigger's announced value instead.
    expect(
      view.getByRole("button", { name: "Chapters" }).props.accessibilityValue,
    ).toEqual({ text: "15" });
    expect(
      view.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Long" });
    expect(view.getByLabelText("Writing style").props.value).toBe(
      "Lyrical, present tense",
    );

    await fireEvent.press(view.getByRole("button", { name: "Edit Mara" }));
    expect(view.getByLabelText("Name").props.value).toBe("Mara");
  });
});

describe("draft restoration across a remount", () => {
  it("restores every new brief field from a saved draft after a remount", async () => {
    const savedDraft = {
      primaryGenre: "mystery",
      audienceMode: "adult",
      spiceLevel: "sweet",
      identityLenses: [],
      seed: "A retired postman finds one undelivered letter every year.",
      language: "English",
      visibility: "public",
      isSeries: true,
      characters: [{
        name: "Iris",
        description: "A retired postman",
        background: "Delivers one final letter every winter.",
        appearance: "Grey coat, a satchel that has outlived three owners.",
        isHero: true,
      }],
      moments: [],
      storyValues: [],
      writingStyle: "Wry, first person",
      avoid: "no graphic violence",
      chapterLength: "long",
      plannedChapterCount: 15,
      illustrateChapters: false,
    };
    mockLoadDraft.mockResolvedValue(savedDraft);

    const first = await renderCreate({ isAnonymous: false });
    await waitFor(() =>
      expect(first.getByLabelText("Story idea").props.value).toBe(
        savedDraft.seed,
      ),
    );
    await act(async () => {
      first.unmount();
    });

    // A fresh mount — the studio tab being left and re-entered — reads the
    // same saved draft back rather than starting from the blank default.
    const second = await renderCreate({ isAnonymous: false });
    await waitFor(() =>
      expect(second.getByLabelText("Story idea").props.value).toBe(
        savedDraft.seed,
      ),
    );

    await fireEvent.press(second.getByRole("button", { name: "More options" }));
    expect(
      second.getByRole("switch", { name: "Public visibility" }).props.value,
    ).toBe(true);
    expect(second.getByLabelText("Writing style").props.value).toBe(
      "Wry, first person",
    );
    expect(second.getByLabelText("Avoid").props.value).toBe(
      "no graphic violence",
    );
    expect(
      second.getByRole("button", { name: "Chapters" }).props.accessibilityValue,
    ).toEqual({ text: "15" });
    expect(
      second.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Long" });

    await fireEvent.press(second.getByRole("button", { name: "Edit Iris" }));
    expect(second.getByLabelText("Background").props.value).toBe(
      "Delivers one final letter every winter.",
    );
    expect(second.getByLabelText("Appearance").props.value).toBe(
      "Grey coat, a satchel that has outlived three owners.",
    );
  });
});

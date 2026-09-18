import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { toDirection } from "@/lib/directions";
import { genreLabels } from "@/theme";
import { KIDS_UI_GENRES, UI_GENRES } from "@/types/domain";
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

  // Keeps every other real export -- `effectiveChapterLength` in particular,
  // which CreateBriefFlow calls at render time to decide what the Chapter
  // length field displays. Duplicating that logic into this mock would let
  // the display and the real request body drift apart again with nothing
  // here to catch it.
  const actual = jest.requireActual("@/lib/api");

  return {
    ...actual,
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
      onGenerationStarted={jest.fn()}
      onBack={jest.fn()}
    />,
  );
}

async function fillIdea(
  view: Awaited<ReturnType<typeof render>>,
  idea = "A child finds a door in an old library that was not there yesterday.",
) {
  await fireEvent.changeText(view.getByLabelText("Story idea"), idea);
  // "Who's in it" has two tabs since the saved-character library landed, and
  // a writer who already has saved characters opens on Saved. Every test
  // below crafts a new character, so select New and wait for its row.
  await fireEvent.press(await view.findByLabelText("New character"));
  await view.findByRole("button", { name: "Add a character" });
}

/**
 * Walk the direction step, the screen that replaced review.
 *
 * The suite's shaping mock returns no `beats`, so no opening can be derived
 * and the step degrades to its write-your-own composer with the surprise-me
 * submit -- which is the path that starts the story with no direction, and so
 * asserts the same payload the review screen's Create used to.
 */
async function startFromDirectionStep(
  view: Awaited<ReturnType<typeof render>>,
) {
  await fireEvent.press(
    await view.findByTestId("create-direction-composer-submit"),
  );
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
    expect(kidsMode.props.accessibilityState.checked).toBe(false);
    expect(view.queryByText("Values")).toBeNull();

    await fireEvent.press(kidsMode);
    expect(view.getByText("Values")).toBeTruthy();
    expect(view.getByRole("checkbox", { name: "Kindness" })).toBeTruthy();

    await fireEvent.press(kidsMode);
    expect(view.queryByText("Values")).toBeNull();
  });

  it("opens the character sheet, keeps the four draft fields, and caps the cast at three", async () => {
    const view = await renderCreate();
    await fillIdea(view);

    for (const name of ["Asha", "Rohan", "Minoo"]) {
      await fireEvent.press(view.getByRole("button", { name: "Add a character" }));
      expect(view.getByText("Craft character")).toBeTruthy();
      expect(view.getByText("Name")).toBeTruthy();
      expect(view.getByText("Background")).toBeTruthy();
      expect(view.getByText("Appearance")).toBeTruthy();
      // Description is retired: the sheet asks who they are and what they
      // look like once, in Appearance.
      expect(view.queryByText("Description")).toBeNull();

      await fireEvent.changeText(view.getByLabelText("Name"), name);
      await fireEvent.changeText(view.getByLabelText("Background"), "Keeps a promise to their family.");
      await fireEvent.changeText(view.getByLabelText("Appearance"), "A determined explorer, curly hair and a red backpack.");
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

  /**
   * The seam this whole suite exists to close: two genre pickers used to read
   * from two different arrays, so a genre added to `UI_GENRES` - the settled,
   * single source of truth - could still be missing from this menu. Asserted
   * exhaustively over the live list rather than genre by genre, so a genre
   * added to `UI_GENRES` later is covered automatically instead of needing a
   * matching line added here.
   */
  it("offers every genre in UI_GENRES, and picking each one actually selects it", async () => {
    const view = await renderCreate();
    const genreButton = view.getByRole("button", { name: "Genre" });

    for (const genre of UI_GENRES) {
      await fireEvent.press(genreButton);
      const option = view.getByRole("button", {
        name: `Choose ${genreLabels[genre]}`,
      });
      await fireEvent.press(option);
      // The dropdown closes on pick, and the control now shows this genre -
      // proof the tap changed state rather than merely existing to be tapped.
      expect(view.queryByRole("button", { name: `Choose ${genreLabels[genre]}` })).toBeNull();
      expect(view.getByText(genreLabels[genre])).toBeTruthy();

      // Reopening confirms the pick stuck: this option, and only this one,
      // now reads as selected.
      await fireEvent.press(genreButton);
      expect(
        view.getByRole("button", { name: `Choose ${genreLabels[genre]}` }).props
          .accessibilityState.selected,
      ).toBe(true);
      await fireEvent.press(genreButton);
    }
  });

  it("derives the kids-mode genre menu from the one genre list, not a second hand-kept one", async () => {
    const view = await renderCreate();
    await fireEvent.press(view.getByRole("switch", { name: "Kids Mode" }));
    await fireEvent.press(view.getByRole("button", { name: "Genre" }));

    // Every genre KIDS_UI_GENRES computes from UI_GENRES is actually offered.
    for (const genre of KIDS_UI_GENRES) {
      expect(
        view.getByRole("button", { name: `Choose ${genreLabels[genre]}` }),
      ).toBeTruthy();
    }
    // And nothing outside that computed set sneaks in - the menu is exactly
    // KIDS_UI_GENRES, not UI_GENRES with a couple of items missing by hand.
    for (const genre of UI_GENRES) {
      if ((KIDS_UI_GENRES as readonly string[]).includes(genre)) continue;
      expect(
        view.queryByRole("button", { name: `Choose ${genreLabels[genre]}` }),
      ).toBeNull();
    }
  });

  /**
   * `educational`, `fanfiction`, `folktale`, and `sliceOfLife` are the four
   * genres added to `UI_GENRES` that the writer-onboarding flow can hand back
   * as `primaryGenre` on a fresh draft. Before this fix the editor's genre
   * menu still read an older, shorter array, so a draft in one of these could
   * not be reselected once the writer reopened the control - the exact
   * finding this covers.
   */
  it.each(["educational", "fanfiction", "folktale", "sliceOfLife"] as const)(
    "represents a %s draft arriving from onboarding, and lets it be reselected",
    async (genre) => {
      const view = await render(
        <CreateStudioScreen
          credits={12}
          onGenerationStarted={jest.fn()}
          onBack={jest.fn()}
          initialDraft={{
            primaryGenre: genre,
            audienceMode: "adult",
            spiceLevel: "sweet",
            identityLenses: [],
            seed: "A story handed off from writer onboarding.",
            language: "English",
            visibility: "private",
            characters: [],
            isSeries: false,
          }}
        />,
      );

      // Represented: the control already shows this genre without the writer
      // having to open anything.
      expect(view.getByText(genreLabels[genre])).toBeTruthy();

      // Reselectable: the menu lists it, checked, right where it landed.
      await fireEvent.press(view.getByRole("button", { name: "Genre" }));
      const ownOption = view.getByRole("button", {
        name: `Choose ${genreLabels[genre]}`,
      });
      expect(ownOption.props.accessibilityState.selected).toBe(true);

      // And picking away, then picking it back, both work through the same
      // control - this genre is not a dead end the menu cannot return to.
      await fireEvent.press(view.getByRole("button", { name: "Choose Romance" }));
      await fireEvent.press(view.getByRole("button", { name: "Genre" }));
      await fireEvent.press(
        view.getByRole("button", { name: `Choose ${genreLabels[genre]}` }),
      );
      expect(view.getByText(genreLabels[genre])).toBeTruthy();
    },
  );

  it("sends the Kids brief and every dropdown to generation", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view, "A child follows a map hidden in a library book.");

    await fireEvent.press(view.getByRole("switch", { name: "Kids Mode" }));
    await fireEvent.press(view.getByRole("checkbox", { name: "Kindness" }));
    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.changeText(view.getByLabelText("Writing style"), "Warm, playful, and direct");
    await fireEvent.changeText(view.getByLabelText("Avoid"), "scary imagery");
    await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
    await fireEvent.press(view.getByRole("button", { name: "7 chapters" }));
    await fireEvent.press(view.getByRole("button", { name: "Chapter length" }));
    await fireEvent.press(view.getByRole("button", { name: "Long" }));
    // Chapter art is a dropdown now: one cover, or auto-generated art per
    // chapter. The wire field it writes is still `illustrate_chapters`.
    await fireEvent.press(view.getByRole("button", { name: "Chapter cover" }));
    await fireEvent.press(
      view.getByRole("button", { name: "Auto-generated per chapter" }),
    );
    // Language now offers English only -- see the dedicated Language test --
    // so it is left untouched here rather than switched to Portuguese.
    // The setup screen's Create button opens the pre-generation review screen;
    // its own Create button is the one that actually fires generation.
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await startFromDirectionStep(view);
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
        onGenerationStarted={jest.fn()}
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

    // This branch adds the pre-generation review, so Create now opens it and
    // the review's own Create commits. The assertion arrived from the grounding
    // branch, which predates that screen and pressed once.
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await startFromDirectionStep(view);
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
    await fireEvent.changeText(view.getByLabelText("Appearance"), "A young explorer, dark hair and travel clothes");
    await fireEvent.press(view.getByRole("button", { name: "Create image" }));

    await waitFor(() => expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(1));
    expect(mockGenerateStory).not.toHaveBeenCalled();

    await fireEvent.press(view.getByRole("button", { name: "Save" }));
    await view.findByText("Image ready");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await startFromDirectionStep(view);
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));
    expect(mockGenerateStory.mock.calls[0][0].characters[0]).toMatchObject({
      name: "Praz",
      portraitUrl: "https://example.com/portrait.png",
      portraitStatus: "ready",
    });
  });

  // 1 is on the list, and it is a SERIES of one -- see the note on
  // `PLANNED_CHAPTER_COUNT_OFFER`. A one-chapter story routed to the
  // standalone path would be the only length the reader could never extend.
  it.each([1, 3, 7, 15] as const)(
    "sends a planned chapter count of %d to the generation payload, as a series",
    async (count) => {
      mockGenerateStory.mockResolvedValueOnce(generatedStory);
      const view = await renderCreate();
      await fillIdea(view);

      await fireEvent.press(view.getByRole("button", { name: "More options" }));
      await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
      await fireEvent.press(
        view.getByRole("button", {
          name: count === 1 ? "1 chapter" : `${count} chapters`,
        }),
      );
      await fireEvent.press(view.getByRole("button", { name: /create/i }));
      await startFromDirectionStep(view);
      await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

      expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
        plannedChapterCount: count,
        isSeries: true,
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
      await startFromDirectionStep(view);
      await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

      expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
        chapterLength: length,
      });
    },
  );

  it("defaults visibility to public in the generation payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);

    expect(
      view.getByRole("switch", { name: "Kids Mode" }),
    ).toBeTruthy();
    // The control itself says so before anything is spent -- there is no
    // review screen left to restate it on.
    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    expect(
      view.getByRole("button", { name: "Who can read it" }).props
        .accessibilityValue,
    ).toEqual({ text: "Public" });

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await startFromDirectionStep(view);
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      visibility: "public",
    });
  });

  it("can be switched to Private visibility and it reaches the generation payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);

    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.press(view.getByRole("button", { name: "Who can read it" }));
    await fireEvent.press(view.getByRole("button", { name: "Private" }));
    expect(
      view.getByRole("button", { name: "Who can read it" }).props
        .accessibilityValue,
    ).toEqual({ text: "Private" });

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await startFromDirectionStep(view);
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      visibility: "private",
    });
  });

  it("sends a character's background and appearance to the generation payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view);

    await fireEvent.press(view.getByRole("button", { name: "Add a character" }));
    await fireEvent.changeText(view.getByLabelText("Name"), "Elena");
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
    await startFromDirectionStep(view);
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0].characters[0]).toMatchObject({
      name: "Elena",
      background: "Hasn't spoken to her mother in six years.",
      appearance: "Dark hair pinned up, paint on her hands.",
    });
  });

  /**
   * There is no review screen to restate the brief on any more -- Create goes
   * straight to the direction step. What still has to hold is the half of
   * review that was doing real work: leaving the brief and coming back must
   * not cost the writer a single choice.
   */
  it("keeps every choice when the direction step is backed out of", async () => {
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
    await fireEvent.press(view.getByRole("button", { name: "Who can read it" }));
    await fireEvent.press(view.getByRole("button", { name: "Public" }));

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    // The direction step, and nothing spent yet.
    await view.findByText("Where does it begin?");
    expect(mockGenerateStory).not.toHaveBeenCalled();

    // Going back does not reset anything: it is the same draft, not a copy.
    await fireEvent.press(view.getByRole("button", { name: "Back to edit" }));
    expect(view.getByLabelText("Story idea").props.value).toBe(
      "A lighthouse keeper receives a letter from tomorrow.",
    );
    expect(
      view.getByRole("button", { name: "Who can read it" }).props
        .accessibilityValue,
    ).toEqual({ text: "Public" });
    // The dropdowns reset to closed, so their options are not in the tree --
    // the committed value is read from the closed trigger's announced value.
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

/**
 * THE DIRECTION STEP, WHICH REPLACED THE REVIEW SCREEN.
 *
 * Review restated the brief and asked the writer to agree with themselves. The
 * step in its place asks the question the reader is asked between chapters,
 * with the same chips, derived from the idea the writer just typed -- so the
 * first chapter stops being the one chapter nobody gets a say in.
 *
 * There is no endpoint that produces continuation chips: at a chapter end they
 * are derived on the client from a story that already exists. `shape-story` is
 * the only call that can answer for one that does not, which is why these
 * assertions run against the shaping mock's `beats`.
 */
describe("the direction step", () => {
  const beats = [
    "Anjali finds the first letter behind the lamp housing",
    "Anjali writes back to a name she does not know",
    "The keeper's log names her mother",
  ];

  it("offers openings derived from the writer's own idea, and sends the one they pick", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    mockInferStoryBrief.mockResolvedValue({
      genres: ["mystery"],
      characters: [],
      suggestedMoments: [],
      beats,
    });
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view, "A lighthouse keeper receives a letter from tomorrow.");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));

    // Two cards, not three: the third is always the writer's own. Each is the
    // story's own sentence pointed at the model as an instruction.
    const first = await view.findByTestId("create-direction-option-0");
    expect(view.getByTestId("create-direction-option-1")).toBeTruthy();
    expect(view.queryByTestId("create-direction-option-2")).toBeNull();
    // The same converter the chapter-end chips use, asserted through it rather
    // than against a copy of its output: a beat is a statement, and a chip is
    // an instruction.
    const opening = toDirection(beats[0]);
    expect(view.getByText(String(opening))).toBeTruthy();

    await fireEvent.press(first);
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    // The chosen opening travels as chapter one's beat, and the rest of the
    // plan travels with it: `beats[n]` is the brief for chapter `n + 1`, so
    // replacing the whole plan with one line would throw away the outline the
    // same free call had already produced.
    const sent = mockGenerateStory.mock.calls[0][0];
    expect(sent.beats[0]).toBe(opening);
    expect(sent.beats.slice(1)).toEqual(beats.slice(1));
  });

  it("keeps the whole shaped plan when the writer asks for a surprise", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    mockInferStoryBrief.mockResolvedValue({
      genres: ["mystery"],
      characters: [],
      suggestedMoments: [],
      beats,
    });
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view, "A lighthouse keeper receives a letter from tomorrow.");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));

    await fireEvent.press(await view.findByTestId("create-direction-write-own"));
    await fireEvent.press(view.getByTestId("create-direction-let-katha-decide"));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    // Nothing invented, nothing overwritten: no direction was chosen, so the
    // plan is exactly what shaping returned.
    expect(mockGenerateStory.mock.calls[0][0].beats).toEqual(beats);
  });

  it("says so honestly when no opening can be derived, and still lets the writer start", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    mockInferStoryBrief.mockResolvedValue({
      genres: ["mystery"],
      characters: [],
      suggestedMoments: [],
      beats: [],
    });
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: /create/i }));

    // The composer is already open rather than behind one more tap: with
    // nothing derived, the writer's own words are the only way on.
    await view.findByTestId("create-direction-composer-input");
    expect(view.queryByTestId("create-direction-option-0")).toBeNull();
    expect(
      view.getByText(/Katha has no opening to suggest for this idea yet/),
    ).toBeTruthy();

    await fireEvent.changeText(
      view.getByTestId("create-direction-composer-input"),
      "Open on the night the lamp fails.",
    );
    await fireEvent.press(view.getByTestId("create-direction-composer-submit"));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));
    expect(mockGenerateStory.mock.calls[0][0].beats).toEqual([
      "Open on the night the lamp fails.",
    ]);
  });

  it("has no review screen left to walk through", async () => {
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: /create/i }));

    await view.findByText("Where does it begin?");
    expect(view.queryByText("Here is what Katha will write")).toBeNull();
    expect(view.queryByText("Review and create")).toBeNull();
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
        background: "Delivers one final letter every winter.",
        appearance: "A retired postman. Grey coat, a satchel that has outlived three owners.",
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

    // ...but NOT the audience. Kids Mode decides who a story is for -- it
    // shrinks the genre list, forces spice to sweet and changes the content
    // rating -- and a draft lives for seven days. Restoring it silently means
    // opening Create to find the switch on with no memory of setting it,
    // which is what the owner reported and read as the app guessing.
    expect(
      second.getByLabelText("Kids Mode").props.accessibilityState.checked,
    ).toBe(false);

    await fireEvent.press(second.getByRole("button", { name: "More options" }));
    expect(
      second.getByRole("button", { name: "Who can read it" }).props
        .accessibilityValue,
    ).toEqual({ text: "Public" });
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
      "A retired postman. Grey coat, a satchel that has outlived three owners.",
    );
  });
  it("discards what Kids Mode derived, not just the switch", async () => {
    // Turning Kids Mode on forces `spiceLevel` to sweet and `chapterLength`
    // to short, and `storyValues` exists only for kids. Resetting the switch
    // alone would leave those behind and quietly send a short, sweet,
    // values-laden brief as an adult story. A half-reverted setting is worse
    // than either state.
    mockLoadDraft.mockResolvedValue({
      primaryGenre: "adventure",
      audienceMode: "kids",
      spiceLevel: "sweet",
      chapterLength: "short",
      storyValues: ["courage"],
      identityLenses: [],
      seed: "A child follows a map hidden in a library book.",
      language: "English",
      visibility: "private",
      characters: [],
      isSeries: false,
    });

    const view = await renderCreate();
    await waitFor(() =>
      expect(view.getByLabelText("Story idea").props.value).toBe(
        "A child follows a map hidden in a library book.",
      ),
    );
    expect(
      view.getByLabelText("Kids Mode").props.accessibilityState.checked,
    ).toBe(false);

    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    // Back to the adult default, not the length kids forced.
    expect(
      view.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Standard" });
    // And the kids-only Values section is gone with the mode.
    expect(view.queryByText("Values")).toBeNull();
  });

  it("shows the same chapter length a restored draft without one will actually send", async () => {
    // The invariant: `effectiveChapterLength` in `lib/api.ts` is the ONE
    // place the default is computed, and both this display and the request
    // body (see `api-generation-contract.test.ts`) read it from there, so
    // they cannot say different things.
    //
    // This used to be posed as a restored KIDS draft, because kids and adult
    // defaults differ. That case is now unreachable: Kids Mode is no longer
    // restored from storage, and turning it on through the switch always sets
    // an explicit `chapterLength` (`chooseAudience`). So the only draft that
    // can still arrive with the field truly unset is an ordinary one saved
    // before the field existed, which is what this now uses.
    mockLoadDraft.mockResolvedValue({
      primaryGenre: "adventure",
      audienceMode: "adult",
      spiceLevel: "sweet",
      identityLenses: [],
      seed: "A child follows a map hidden in a library book.",
      language: "English",
      visibility: "private",
      characters: [],
      isSeries: false,
      // chapterLength deliberately absent.
    });

    const view = await renderCreate();
    await waitFor(() =>
      expect(view.getByLabelText("Story idea").props.value).toBe(
        "A child follows a map hidden in a library book.",
      ),
    );
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    expect(
      view.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Standard" });
  });
});

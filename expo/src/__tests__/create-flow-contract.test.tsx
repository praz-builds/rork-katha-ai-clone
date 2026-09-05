import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { Story } from "@/types/domain";

const mockGenerateStory = jest.fn();
const mockInferStoryBrief = jest.fn();
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

async function renderCreate() {
  return await render(
    <CreateStudioScreen
      credits={12}
      onCreditUsed={jest.fn()}
      onPublished={jest.fn()}
      onBack={jest.fn()}
    />,
  );
}

async function continueFromIdea(
  view: Awaited<ReturnType<typeof render>>,
  // Clears the 40-character floor, which the studio now shares with
  // onboarding: below it the shaping call has nothing to infer a world, a cast
  // or a plan from.
  idea = "A child finds a door in an old library that was not there yesterday.",
) {
  await fireEvent.changeText(view.getByLabelText("Story idea"), idea);
  await fireEvent.press(view.getByRole("button", { name: "Continue" }));
  await view.findByRole("button", { name: "Add a character" });
}

beforeEach(() => {
  mockGenerateStory.mockReset();
  mockInferStoryBrief.mockReset();
  mockLoadDraft.mockReset().mockResolvedValue(null);
  mockSaveDraft.mockReset();
  mockClearDraft.mockReset();
  mockInferStoryBrief.mockResolvedValue({
    genres: ["adventure"],
    whereAndWhen: "A quiet library, present day",
    characters: [],
    suggestedMoments: [],
  });
});

describe("approved Create flow", () => {
  it("uses an adult/kids segmented control and only reveals Values for kids", async () => {
    const view = await renderCreate();

    await continueFromIdea(view);
    const adults = view.getByRole("radio", { name: "For adults" });
    const kids = view.getByRole("radio", { name: "For kids" });
    expect(adults.props.accessibilityState).toMatchObject({ selected: true });
    expect(view.queryByText("Values")).toBeNull();

    await fireEvent.press(kids);
    expect(kids.props.accessibilityState).toMatchObject({ selected: true });
    expect(view.getByText("Values")).toBeTruthy();
    expect(view.getByRole("checkbox", { name: "Kindness" })).toBeTruthy();

    await fireEvent.press(adults);
    expect(view.queryByText("Values")).toBeNull();
  });

  it("opens the character sheet, keeps the four draft fields, and caps the cast at three", async () => {
    const view = await renderCreate();
    await continueFromIdea(view);

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
      await fireEvent.press(view.getByRole("button", { name: "Save character" }));
      await view.findByRole("button", { name: `Edit ${name}` });
    }

    expect(view.queryByRole("button", { name: "Add a character" })).toBeNull();
  });

  it("does not expose Spanish in any authoring control", async () => {
    const view = await renderCreate();
    await continueFromIdea(view);

    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.press(view.getByRole("button", { name: "Language" }));
    expect(view.getAllByText("English").length).toBeGreaterThan(0);
    expect(view.getByText("Portuguese")).toBeTruthy();
    expect(view.queryByText("Spanish")).toBeNull();
  });

  it("silently falls back to an empty Shape screen when inference fails", async () => {
    mockInferStoryBrief.mockRejectedValueOnce(new Error("inference unavailable"));
    const view = await renderCreate();

    await continueFromIdea(view, "A lighthouse keeper receives a letter from tomorrow.");

    expect(mockInferStoryBrief).toHaveBeenCalledWith(
      "A lighthouse keeper receives a letter from tomorrow.",
    );
    expect(view.queryByText(/inference unavailable/i)).toBeNull();
    expect(view.queryByText(/could not analyze/i)).toBeNull();
  });

  it("sends the reviewed Kids brief and More options to generation", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await continueFromIdea(view, "A child follows a map hidden in a library book.");

    await fireEvent.press(view.getByRole("radio", { name: "For kids" }));
    await fireEvent.press(view.getByRole("checkbox", { name: "Kindness" }));
    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.changeText(view.getByLabelText("Writing style"), "Warm, playful, and direct");
    await fireEvent.changeText(view.getByLabelText("Avoid"), "scary imagery");
    await fireEvent.press(view.getByRole("button", { name: "7 chapters" }));
    await fireEvent.press(view.getByRole("button", { name: "Long" }));
    await fireEvent(
      view.getByRole("switch", { name: "Chapter art" }),
      "valueChange",
      true,
    );
    await fireEvent.press(view.getByRole("button", { name: "Language" }));
    await fireEvent.press(view.getByText("Portuguese"));
    await fireEvent.press(view.getByRole("button", { name: "Review and start" }));
    await view.findByText("Review and start");

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      audienceMode: "kids",
      spiceLevel: "sweet",
      language: "Portuguese",
      storyValues: ["kindness"],
      writingStyle: "Warm, playful, and direct",
      avoid: "scary imagery",
      chapterLength: "long",
      plannedChapterCount: 7,
      illustrateChapters: true,
    });
  });
});

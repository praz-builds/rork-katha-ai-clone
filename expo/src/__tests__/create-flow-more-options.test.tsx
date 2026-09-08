/**
 * Smoke tests for the product-owner feedback on More options:
 *  - chapter length word counts match the backend bands
 *  - a long "moments" entry is displayed truncated but sent in full (up to
 *    the documented server cap)
 *  - the spice control is gone from the UI, and generation still succeeds
 *  - chapter art's copy names the per-chapter cover and its credit cost
 *  - every picker in the create flow is the shared Dropdown component
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
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
  // length field displays.
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    generateStoryStreaming: (...args: unknown[]) => mockGenerateStory(...args),
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
    generateCharacterImage: (...args: unknown[]) => mockGenerateCharacterImage(...args),
    continueStoryStreaming: jest.fn(),
    createGenerationRequestId: () => "more-options-test-request",
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require("react-native");
  return {
    CreditPill: ({ credits }: { credits: number }) => React.createElement(Text, null, `${credits} credits`),
    PrimaryButton: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
      React.createElement(Pressable, { accessibilityRole: "button", onPress }, React.createElement(Text, null, children)),
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
      isAnonymous={false}
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
});

describe("More options -- chapter length word counts", () => {
  it("shows word counts matching wordBandFor() in backend/supabase/functions/_shared/types.ts", async () => {
    const view = await renderCreate();
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.press(view.getByRole("button", { name: "Chapter length" }));

    // short 600-900, standard 1200-1600, long 2000-2600 -- read directly from
    // wordBandFor() while building this feature; a change to that function's
    // bands must be mirrored in CreateBriefFlow.tsx's CHAPTER_LENGTHS.
    expect(view.getByText(/600-900 words/)).toBeTruthy();
    expect(view.getByText(/1,200-1,600 words/)).toBeTruthy();
    expect(view.getByText(/2,000-2,600 words/)).toBeTruthy();
  });
});

describe("More options -- moments display cap vs. data cap", () => {
  it("truncates a long moment on screen but sends it in full up to the documented server cap", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    const longMoment = "A ".repeat(90).trim(); // 179 chars: over the 60-char display cap, under the 300-char data cap
    const composer = view.getByPlaceholderText("Add a moment");
    // The composer itself caps input at the documented server limit.
    expect(composer.props.maxLength).toBe(300);

    await fireEvent.changeText(composer, longMoment);
    await fireEvent(composer, "submitEditing");

    // Displayed: capped short and ends with an ellipsis.
    const chipText = view.getByText(/…$/);
    expect(chipText.props.children.length).toBeLessThan(longMoment.length);

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    // Sent in full -- not silently cut down to the display length.
    expect(mockGenerateStory.mock.calls[0][0].moments).toEqual([longMoment]);
  });
});

describe("More options -- spice control removed", () => {
  it("has no spice control in the UI, and generation still succeeds with a valid payload", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    expect(view.queryByText("Spice")).toBeNull();
    expect(view.queryByText("Sweet")).toBeNull();
    expect(view.queryByText("Steamy")).toBeNull();

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await view.findByText("Here is what Katha will write");
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    // The client still sends the existing safe default -- inference is a
    // server concern now, not a UI one.
    expect(mockGenerateStory.mock.calls[0][0].spiceLevel).toBe("sweet");
  });
});

describe("More options -- chapter art copy", () => {
  it("names the per-chapter cover and its credit cost from CREDITS_AND_PRICING.md", async () => {
    const view = await renderCreate();
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    // CREDITS_AND_PRICING.md: "Every chapter after that is 1 credit, or 2 if
    // you illustrate it" -- chapter art is +1 credit per illustrated chapter.
    const copy = view.getByText(/illustration to every chapter after the first/i);
    expect(String(copy.props.children)).toMatch(/1 more credit/i);
  });
});

describe("shared Dropdown adoption", () => {
  it("CreateBriefFlow uses the shared Dropdown for every picker, and no bespoke picker Modal remains", () => {
    const source = readFileSync(
      resolve(__dirname, "../components/create/CreateBriefFlow.tsx"),
      "utf8",
    );

    expect(source).toMatch(/import \{ Dropdown, DropdownGroup \} from "@\/components\/create\/Dropdown"/);

    // Genre, Chapters, Chapter length, Language -- every dropdown in the
    // create flow renders through the shared component.
    const dropdownUsages = source.match(/<Dropdown\b/g) ?? [];
    expect(dropdownUsages.length).toBeGreaterThanOrEqual(4);

    // The old bespoke open/close state for the genre and language pickers is
    // gone -- there is nothing left to have the reported bug.
    expect(source).not.toMatch(/genreOpen/);
    expect(source).not.toMatch(/languageOpen/);

    // The only <Modal> left in this file is the full-screen Craft character
    // sheet (a navigation surface, not a picker) -- every picker's own Modal
    // lives inside Dropdown.tsx, not here.
    const modalUsages = source.match(/<Modal\b/g) ?? [];
    expect(modalUsages.length).toBe(1);
  });
});

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
import { CHAPTER_ART_CREDITS, CHAPTER_TEXT_CREDITS } from "@/lib/pricing-limits";
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
  const { Text } = require("react-native");
  return {
    CreditPill: ({ credits }: { credits: number }) => React.createElement(Text, null, `${credits} credits`),
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

async function renderCreate({ isAnonymous = false } = {}) {
  return await render(
    <CreateStudioScreen
      credits={12}
      isAnonymous={isAnonymous}
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
    // The bands are explained in the "?" card, not in the menu rows.
    await fireEvent.press(view.getByRole("button", { name: "About Chapter length" }));

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
    const composer = view.getByPlaceholderText(
      "Moments to include in general or between characters",
    );
    // The composer itself caps input at the documented server limit.
    expect(composer.props.maxLength).toBe(300);

    await fireEvent.changeText(composer, longMoment);
    await fireEvent(composer, "submitEditing");

    // Displayed: capped short and ends with an ellipsis.
    const chipText = view.getByText(/…$/);
    expect(chipText.props.children.length).toBeLessThan(longMoment.length);

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    // The direction step replaced review. Shaping is mocked with no beats, so
    // no opening can be derived and the composer is already open -- submitting
    // it empty starts the story with no direction, exactly as review's Create
    // used to.
    await fireEvent.press(
      await view.findByTestId("create-direction-composer-submit"),
    );
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
    // The direction step replaced review. Shaping is mocked with no beats, so
    // no opening can be derived and the composer is already open -- submitting
    // it empty starts the story with no direction, exactly as review's Create
    // used to.
    await fireEvent.press(
      await view.findByTestId("create-direction-composer-submit"),
    );
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    // The client still sends the existing safe default -- inference is a
    // server concern now, not a UI one.
    expect(mockGenerateStory.mock.calls[0][0].spiceLevel).toBe("sweet");
  });
});

describe("chapter cover -- the dropdown that replaced the chapter-art switch", () => {
  it("prices auto-generated chapter covers from the credit constants, not a literal", async () => {
    const view = await renderCreate();
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    await fireEvent.press(view.getByRole("button", { name: "About Chapter cover" }));

    // CREDITS_AND_PRICING.md prices a 3-chapter illustrated story at 5 credits
    // = 1 (start, which bundles chapter one's art as the cover) + 2 + 2. So
    // every chapter this option actually BILLS for is text plus art, and there
    // is no chapter on it that costs one. An earlier revision of the copy said
    // "1 credit for the first, 2 from the next", which mis-numbered which
    // chapter "the first" is and quoted a price no chapter is charged.
    const copy = view.getByText(/its own art for every chapter/i);
    const text = String(copy.props.children);
    expect(text).toContain(
      `${CHAPTER_TEXT_CREDITS + CHAPTER_ART_CREDITS} credits a chapter`,
    );
    expect(text).toContain(`instead of ${CHAPTER_TEXT_CREDITS}`);
    // The bundled cover is stated, because it is the reason the number is not
    // simply "double".
    expect(text).toMatch(/cover is already included/i);
  });

  it("writes the illustrate_chapters the generation contract still sends", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate();
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    await fireEvent.press(view.getByRole("button", { name: "Chapter cover" }));
    await fireEvent.press(
      view.getByRole("button", { name: "Auto-generated per chapter" }),
    );
    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await fireEvent.press(
      await view.findByTestId("create-direction-composer-submit"),
    );
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      illustrateChapters: true,
    });
  });
});

describe("the six dropdowns", () => {
  /**
   * All six live inside More options, after Moments and Writing style / Avoid:
   * the four that shape the story (Story mode, Chapters, Chapter length,
   * Chapter cover), then Image style and Who can read it.
   */
  it("are hidden until More options opens, then sit after Moments and Writing style", async () => {
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);

    const labels = [
      "Story mode",
      "Chapters",
      "Chapter length",
      "Chapter cover",
      "Image style",
      "Who can read it",
    ];
    for (const label of labels) {
      expect(view.queryByRole("button", { name: label })).toBeNull();
    }

    await fireEvent.press(view.getByRole("button", { name: "More options" }));
    for (const label of labels) {
      expect(view.getByRole("button", { name: label })).toBeTruthy();
    }

    const source = readFileSync(
      resolve(__dirname, "../components/create/CreateBriefFlow.tsx"),
      "utf8",
    );
    const panel = source.slice(source.indexOf("function MoreOptions("));
    const order = [
      'label="Moments to include"',
      'label="Writing style"',
      'label="Avoid"',
      'label="Story mode"',
      'label="Chapter cover"',
      'label="Image style"',
      'label="Who can read it"',
      'label="Language"',
    ].map((marker) => panel.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("opens on a real value rather than on its own label", async () => {
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    expect(
      view.getByRole("button", { name: "Story mode" }).props.accessibilityValue,
    ).toEqual({ text: "Interactive" });
    expect(
      view.getByRole("button", { name: "Image style" }).props.accessibilityValue,
    ).toEqual({ text: "Auto" });
    expect(
      view.getByRole("button", { name: "Chapter cover" }).props.accessibilityValue,
    ).toEqual({ text: "Cover art only" });
  });

  it("sends the story mode and the image style the writer picked", async () => {
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    await fireEvent.press(view.getByRole("button", { name: "Story mode" }));
    await fireEvent.press(view.getByRole("button", { name: "Auto-continue" }));
    await fireEvent.press(view.getByRole("button", { name: "Image style" }));
    await fireEvent.press(view.getByRole("button", { name: "Watercolor" }));

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await fireEvent.press(
      await view.findByTestId("create-direction-composer-submit"),
    );
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      storyFlow: "auto",
      imageStyle: "watercolor",
    });
  });

  it("shows a guest the visibility choice and refuses to let them make it", async () => {
    const view = await renderCreate({ isAnonymous: true });
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    const trigger = view.getByRole("button", { name: "Who can read it" });
    // Visible, so the guest can see what they are missing, and disabled, so
    // they cannot request a public story the server would refuse anyway.
    expect(trigger.props.accessibilityState.disabled).toBe(true);
    expect(trigger.props.accessibilityValue).toEqual({ text: "Private" });
  });

  it("sends private for a guest, whatever the draft's default says", async () => {
    // The toggle defaults to Public, and a guest's trigger only DISPLAYS
    // private -- it never writes the draft back. So the request used to say
    // public while the screen said Private. The server refuses it either way
    // (`account_required`), but the client should not be asking.
    mockGenerateStory.mockResolvedValueOnce(generatedStory);
    const view = await renderCreate({ isAnonymous: true });
    await fillIdea(view);

    await fireEvent.press(view.getByRole("button", { name: /create/i }));
    await fireEvent.press(
      await view.findByTestId("create-direction-composer-submit"),
    );
    await waitFor(() => expect(mockGenerateStory).toHaveBeenCalledTimes(1));

    expect(mockGenerateStory.mock.calls[0][0]).toMatchObject({
      visibility: "private",
    });
  });
});

describe("dropdown menus and their help", () => {
  it("lists plain labels in the menu, and explains them only behind the ?", async () => {
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    await fireEvent.press(view.getByRole("button", { name: "Story mode" }));
    expect(view.getByRole("button", { name: "Auto-continue" })).toBeTruthy();
    expect(view.queryByText(/pick what happens next/i)).toBeNull();
    await fireEvent.press(view.getByRole("button", { name: "Interactive" }));

    await fireEvent.press(view.getByRole("button", { name: "About Story mode" }));
    expect(view.getByText(/pick what happens next/i)).toBeTruthy();
    expect(view.getByText(/keeps writing/i)).toBeTruthy();
  });

  it("puts a ? on the dropdowns that need one, and none on Chapters or Language", async () => {
    const view = await renderCreate({ isAnonymous: false });
    await fillIdea(view);
    await fireEvent.press(view.getByRole("button", { name: "More options" }));

    for (const label of ["Story mode", "Chapter length", "Chapter cover", "Image style", "Who can read it"]) {
      expect(view.getByRole("button", { name: `About ${label}` })).toBeTruthy();
    }
    expect(view.queryByRole("button", { name: "About Chapters" })).toBeNull();
    expect(view.queryByRole("button", { name: "About Language" })).toBeNull();
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

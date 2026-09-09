/**
 * "What's next?" end-of-chapter branching.
 *
 * `ChapterEnd` is handed a `Story` and the `Chapter` on screen and must, from
 * that alone: lead with concrete directions drawn from THIS chapter's own
 * plan and series state, keep write-your-own as a small collapsed escape
 * hatch behind it, degrade honestly when suggestions cannot be resolved,
 * refuse to offer more chapters once the story has reached its planned
 * ending, and never fire a continuation request twice for one tap-happy
 * reader.
 *
 * The hierarchy is the thing under test here. A previous version gave the
 * free-text box equal billing and threw away a lone suggestion unless it
 * could find two, so a thinly-stated story showed the box alone - which asks
 * the reader to do the work the feature exists to do for them.
 */

import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import ChapterEnd, { deriveContinuationOptions } from "@/components/reader/ChapterEnd";
import ReaderScreen from "@/screens/ReaderScreen";
import type { Chapter, SeriesState, Story } from "@/types/domain";

// `jest.mock` calls are hoisted above these imports by babel-plugin-jest-hoist
// at compile time regardless of where they appear in the file, so writing
// them after the imports (rather than before, which `import/first` forbids)
// changes nothing about when they take effect.
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/notifications", () => ({
  pushPermissionGranted: jest.fn().mockResolvedValue(false),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("expo-av", () => ({
  Audio: { Sound: { createAsync: jest.fn() } },
}));

function makeSeriesState(overrides: Partial<SeriesState> = {}): SeriesState {
  return {
    central_conflict: "A locked attic keeps its secret.",
    protagonist_want: "To hear the old fort song again.",
    relationship_state: "Aaji trusts her more each visit.",
    open_hooks: ["Follow the map fragment found under the floorboard."],
    resolved_hooks: [],
    promised_payoffs: [],
    world_facts: [],
    character_changes: [],
    next_chapter_pressure: "The storm is closing in on the fort.",
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "chapter-2",
    storyId: "story-1",
    title: "Chapter 2: The Attic",
    paragraphs: ["The attic door had not opened in years."],
    chapterNumber: 2,
    chapterRole: "mid_series",
    hookType: "unanswered_question",
    hookText: "The trunk's stuck page waited, unopened.",
    isPublished: true,
    ...overrides,
  };
}

function makeStory(overrides: Partial<Story> = {}): Story {
  const chapter1: Chapter = makeChapter({
    id: "chapter-1",
    title: "Chapter 1: Arrival",
    chapterNumber: 1,
  });
  const chapter2 = makeChapter();
  return {
    id: "story-1",
    title: "The Old Fort",
    authorId: "author-1",
    genre: "adventure",
    storyMode: "series",
    plannedChapterCount: 3,
    beats: [
      "Chapter 1 beat: arrival at the fort.",
      "Chapter 2 beat: the locked attic.",
      "Ask Aaji to open the stuck page and share the old fort song.",
    ],
    seriesState: makeSeriesState(),
    synopsis: "A child rediscovers her grandmother's fort.",
    chapters: [chapter1, chapter2],
    likes: 0,
    bookmarks: 0,
    views: 0,
    tags: [],
    publishedOffset: 0,
    isFeatured: false,
    language: "English",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("deriveContinuationOptions", () => {
  it("reads the next planned beat and the open threads off the story", () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    const options = deriveContinuationOptions(story, chapter);

    // Both of these are sentences the backend wrote about THIS story - the
    // approved beat for the next chapter and an open hook the model is
    // tracking. Nothing here is a generic line the component made up.
    //
    // Two, not three: the third card in the row is always "Write your own".
    expect(options.map((option) => option.prompt)).toEqual([
      "Ask Aaji to open the stuck page and share the old fort song.",
      "Follow the map fragment found under the floorboard.",
    ]);
  });

  /*
    THE CHIPS ARE INSTRUCTIONS, NOT QUESTIONS.

    These three hooks are the ones the product owner photographed off the
    running app, verbatim. Rendered as they arrive they read as a comprehension
    quiz about the story; the reader's job at a chapter end is to STEER it.
  */
  it("turns the model's question-shaped hooks into directions", () => {
    const story = makeStory({
      beats: undefined,
      seriesState: makeSeriesState({
        open_hooks: [
          "Who is writing the predictive linen notes",
          "What will happen if Anjali unfolds every sheet tomorrow",
        ],
        next_chapter_pressure: undefined,
      }),
    });
    const chapter = makeChapter({
      hookText: "Is the casualty girl Divya lying about having no brother",
    });

    // `MAX_OPTIONS` is two, so the chapter's own closing hook is checked on its
    // own below rather than by widening the surface for the test's benefit.
    expect(deriveContinuationOptions(story, chapter).map((o) => o.prompt)).toEqual([
      "Find out who is writing the predictive linen notes.",
      "Show what happens if Anjali unfolds every sheet tomorrow.",
    ]);

    const yesNo = deriveContinuationOptions(
      makeStory({ beats: undefined, seriesState: undefined }),
      chapter,
    );
    expect(yesNo.map((o) => o.prompt)).toEqual([
      "Find out whether the casualty girl Divya is lying about having no brother.",
    ]);
  });

  it("drops a hook it cannot turn into a direction rather than inventing one", () => {
    const story = makeStory({
      beats: undefined,
      seriesState: makeSeriesState({
        // A DO-question needs the verb conjugating to un-invert, which this
        // client has no business guessing at.
        open_hooks: ["Does Anjali know what her mother did"],
        next_chapter_pressure: undefined,
      }),
    });
    const chapter = makeChapter({ hookText: undefined });

    expect(deriveContinuationOptions(story, chapter)).toHaveLength(0);
  });

  /**
   * "Why did Aaji stop singing" is subject-auxiliary inverted, and no frame put
   * in front of it is English ("Explain why did Aaji stop singing"). Un-inverting
   * it means conjugating a verb, which this client will not guess at, so the
   * hook is dropped. "Who left the fort gate open" is not inverted and survives.
   */
  it("drops an inverted wh-question and keeps an uninverted one", () => {
    const story = makeStory({
      beats: undefined,
      seriesState: makeSeriesState({
        open_hooks: [
          "Why did Aaji stop singing?",
          "What is she hiding in the trunk?",
          "Who left the fort gate open?",
        ],
        next_chapter_pressure: undefined,
      }),
    });
    const prompts = deriveContinuationOptions(story, makeChapter({ hookText: undefined }))
      .map((option) => option.prompt);

    expect(prompts).toEqual(["Find out who left the fort gate open."]);
    prompts.forEach((prompt) => expect(prompt).not.toContain("?"));
  });

  it("turns a pressure line's modal into a direction", () => {
    const story = makeStory({
      beats: undefined,
      seriesState: makeSeriesState({
        open_hooks: [],
        next_chapter_pressure: "Anjali must decide whether to burn the notes",
      }),
    });
    expect(
      deriveContinuationOptions(story, makeChapter({ hookText: undefined }))
        .map((option) => option.prompt),
    ).toEqual(["Have Anjali decide whether to burn the notes."]);
  });

  it("never offers the same sentence twice under two labels", () => {
    const story = makeStory({
      seriesState: makeSeriesState({
        open_hooks: ["Ask Aaji to open the stuck page and share the old fort song."],
        next_chapter_pressure: "The storm is closing in on the fort.",
      }),
    });
    const options = deriveContinuationOptions(story, story.chapters[1]);
    const prompts = options.map((option) => option.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("still offers a direction when the story yields only one", () => {
    // The old rule discarded this and left the reader facing the free-text
    // box alone. One real direction is worth showing.
    const story = makeStory({
      beats: undefined,
      seriesState: makeSeriesState({
        open_hooks: [],
        promised_payoffs: [],
        next_chapter_pressure: "The storm is closing in on the fort.",
      }),
    });
    const chapter = makeChapter({ hookText: undefined });
    expect(deriveContinuationOptions(story, chapter)).toHaveLength(1);
  });

  it("returns nothing usable when the story carries no series data", () => {
    const story = makeStory({ beats: undefined, seriesState: undefined });
    const chapter = makeChapter({ hookText: undefined });
    expect(deriveContinuationOptions(story, chapter)).toHaveLength(0);
  });
});

describe("ChapterEnd", () => {
  it("offers three cards of equal weight, the last of them write-your-own", async () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    const view = await render(
      <ChapterEnd story={story} chapter={chapter} onContinue={jest.fn()} />,
    );

    await waitFor(() => {
      expect(view.getByTestId("chapter-end-option-0")).toBeTruthy();
    });

    // Every derived direction is on screen as its own card, each carrying the
    // exact prose the request will send.
    expect(view.getByText(
      "Ask Aaji to open the stuck page and share the old fort song.",
    )).toBeTruthy();
    expect(view.getByText(
      "Follow the map fragment found under the floorboard.",
    )).toBeTruthy();
    // Two derived cards, not three: the third slot is always the reader's.
    expect(view.queryByTestId("chapter-end-option-2")).toBeNull();

    // Each card is a labelled button, not a bare pressable box: a grid of
    // unlabelled tap targets is unusable with a screen reader.
    expect(view.getByTestId("chapter-end-option-0").props.accessibilityLabel)
      .toBe("Continue: Ask Aaji to open the stuck page and share the old fort song.");
    expect(view.getByTestId("chapter-end-option-1").props.accessibilityRole)
      .toBe("button");

    // The third card. Same shape as the two above it, and it carries the
    // surprise offer rather than leaving it as a second stray text link.
    const writeOwn = view.getByTestId("chapter-end-write-own");
    expect(writeOwn.props.accessibilityRole).toBe("button");
    expect(writeOwn.props.accessibilityLabel)
      .toBe("Write your own direction, or let Katha surprise you");
    expect(view.getByText("Write your own — or get a surprise")).toBeTruthy();
    // The field behind it is not rendered until it is tapped.
    expect(view.queryByTestId("chapter-end-composer-input")).toBeNull();
  });

  it("continues with the exact prose of the card that was tapped", async () => {
    const story = makeStory();
    const onContinue = jest.fn();
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        onContinue={onContinue}
      />,
    );
    await waitFor(() => expect(view.getByTestId("chapter-end-option-1")).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-option-1"));
    });

    // The card's own sentence, unaltered, is the direction handed upward - and
    // the caller passes it straight through as `next_instruction`. What the
    // reader read is what the model is told.
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(
      "Follow the map fragment found under the floorboard.",
    ));
  });

  /**
   * THE WRITE-YOUR-OWN FLOW, END TO END.
   *
   * The card opens the composer IN ITS PLACE, so the field lands where the
   * finger already is; the field takes focus without a second tap; the two
   * derived cards stay usable above it in case the reader changes their mind;
   * and there is a way back out that does not require typing something.
   */
  it("opens a focused composer in the card's place, and closes back to it", async () => {
    const story = makeStory();
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        onContinue={jest.fn()}
      />,
    );
    await waitFor(() => expect(view.getByTestId("chapter-end-write-own")).toBeTruthy());
    expect(view.queryByTestId("chapter-end-composer")).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-write-own"));
    });

    const input = await view.findByTestId("chapter-end-composer-input");
    // Focus goes to the field, not to another tap target.
    expect(input.props.autoFocus).toBe(true);
    expect(input.props.placeholder).toBe("Tell Katha what happens next.");
    // The register is taught, so the reader does not type a question into a
    // box that wants an instruction.
    expect(view.getByText(/An instruction, not a question/)).toBeTruthy();
    // The card it replaced is gone; the derived ones are not.
    expect(view.queryByTestId("chapter-end-write-own")).toBeNull();
    expect(view.getByTestId("chapter-end-option-0")).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(input, "She climbs down to meet the storm.");
    });
    expect(view.getByTestId("chapter-end-composer-input").props.value)
      .toBe("She climbs down to meet the storm.");

    // And there is a way out that costs nothing.
    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-composer-close"));
    });
    await waitFor(() =>
      expect(view.queryByTestId("chapter-end-composer-input")).toBeNull()
    );
    expect(view.getByTestId("chapter-end-write-own")).toBeTruthy();
  });

  it("sends no instruction at all when the reader asks for a surprise", async () => {
    // There is no hardcoded filler behind this control. Sending `undefined`
    // lets the model use the plan and series state it already holds; pasting
    // an invented generic line would tell the model something the story never
    // said.
    const story = makeStory();
    const onContinue = jest.fn();
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        onContinue={onContinue}
      />,
    );
    await waitFor(() => expect(view.getByTestId("chapter-end-write-own")).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-write-own"));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-let-katha-decide"));
    });

    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(onContinue.mock.calls[0][0]).toBeUndefined();
  });

  it("shows a finished state and offers no continuation at the final planned chapter", async () => {
    const finalChapter = makeChapter({
      id: "chapter-3",
      chapterNumber: 3,
      title: "Chapter 3: The Song",
    });
    const story = makeStory({
      chapters: [
        makeChapter({ id: "chapter-1", chapterNumber: 1 }),
        makeChapter({ id: "chapter-2", chapterNumber: 2 }),
        finalChapter,
      ],
    });
    const onContinue = jest.fn();
    const view = await render(
      <ChapterEnd story={story} chapter={finalChapter} onContinue={onContinue} />,
    );

    expect(view.getByText("The story is complete")).toBeTruthy();
    expect(view.queryByTestId("chapter-end-option-0")).toBeNull();
    expect(view.queryByTestId("chapter-end-write-own")).toBeNull();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("degrades to the write-your-own path with a visible explanation when suggestions fail to resolve", async () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    const resolveOptions = jest.fn().mockRejectedValue(new Error("offline"));
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={chapter}
        resolveOptions={resolveOptions}
        onContinue={jest.fn()}
      />,
    );

    // With nothing derived, the composer is already open: the reader's own
    // words are the only way on, and hiding them behind one more tap is
    // ceremony.
    await waitFor(() => {
      expect(view.getByTestId("chapter-end-composer-input")).toBeTruthy();
    });
    // Honest about why - not a silent, empty gap where two cards should be.
    expect(view.getByText(
      "We couldn't load suggested directions for this chapter.",
    )).toBeTruthy();
    expect(view.queryByTestId("chapter-end-option-0")).toBeNull();
  });

  it("fires exactly one continuation request on a double tap", async () => {
    const story = makeStory();
    const chapter = story.chapters[1];
    // The guard moved when the request did. This component used to make the
    // call itself and could lean on its own pending state; it now hands the
    // direction upward and the caller spends the credit, so a second tap that
    // got through would be a second chapter and a second charge for one
    // decision.
    const onContinue = jest.fn();
    const view = await render(
      <ChapterEnd story={story} chapter={chapter} onContinue={onContinue} />,
    );
    await waitFor(() => expect(view.getByTestId("chapter-end-option-0")).toBeTruthy());

    // Two taps as two separate events, each its own `act`, is what a real
    // double tap actually produces - not one JS callback invoked twice in the
    // same synchronous tick.
    const option = view.getByTestId("chapter-end-option-0");
    await act(async () => {
      fireEvent.press(option);
    });
    await act(async () => {
      fireEvent.press(option);
    });

    expect(onContinue).toHaveBeenCalledTimes(1);

    // And a third tap on a different control is still the same one decision.
    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-write-own"));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-let-katha-decide"));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-composer-submit"));
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("submits what was typed in the composer", async () => {
    const story = makeStory();
    const onContinue = jest.fn();
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        onContinue={onContinue}
      />,
    );
    await waitFor(() => expect(view.getByTestId("chapter-end-write-own")).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-write-own"));
    });
    const input = await view.findByTestId("chapter-end-composer-input");
    await act(async () => {
      fireEvent.changeText(input, "  She climbs down to meet the storm.  ");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("chapter-end-composer-submit"));
    });

    // Trimmed, and never the empty string: `""` still renders the
    // reader-direction block in the prompt and claims a steer that is not there.
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(
      "She climbs down to meet the storm.",
    ));
  });
});

describe("ReaderScreen renderChapterEnd wiring", () => {
  // Long enough (~3.4k characters) to paginate into several pages under the
  // test environment's default window size, so page one is provably not the
  // last page - a short chapter that happens to fit in one page would make
  // this test pass without checking anything.
  const LONG_PARAGRAPH = "Sentence one continues the story with concrete, specific detail. "
    .repeat(60);
  const longChapter = makeChapter({
    id: "long-chapter-1",
    chapterNumber: 1,
    paragraphs: [LONG_PARAGRAPH, LONG_PARAGRAPH],
  });
  const wiredStory = makeStory({ chapters: [longChapter, makeChapter({ id: "long-chapter-2", chapterNumber: 2 })] });

  it("only calls renderChapterEnd on the chapter's last page, with the chapter on screen", async () => {
    const renderChapterEnd = jest.fn((_chapter: Chapter): React.ReactNode => null);
    const view = await render(
      <ReaderScreen
        story={wiredStory}
        onBack={jest.fn()}
        renderChapterEnd={renderChapterEnd}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText("Toggle reader controls"));
    });

    // Page one of a multi-page chapter is not the last page.
    expect(renderChapterEnd).not.toHaveBeenCalled();

    // Pressing well past the actual last page is clamped, so this reliably
    // lands on the last page regardless of exactly how many pages this
    // chapter paginates into. Each press gets its own `act` so state commits
    // (and the page count) are current before the next one fires - batching
    // them all into one `act` would fire every press against page one.
    const pressNext = async () => {
      await act(async () => {
        fireEvent.press(view.getByLabelText("Next page"));
      });
    };
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();
    await pressNext();

    await waitFor(() => expect(renderChapterEnd).toHaveBeenCalled());
    const lastCallChapter = renderChapterEnd.mock.calls[
      renderChapterEnd.mock.calls.length - 1
    ][0];
    expect(lastCallChapter.id).toBe(longChapter.id);
  });
});

// Two findings from review.
//
// A story with no `plannedChapterCount` was offered a continuation forever,
// while `continue-story` resolves a missing count to 3 and refuses anything
// past it -- the client promising what the backend had already decided against.
//
// And the production caller omitted `onChapterReady`, so a successful
// continuation showed a confirmation and went nowhere: the chapter was never
// added to app state, so it could not be read. A "What's next?" that produces
// a chapter you cannot reach is worse than no button at all.
describe("agreeing with the server about where a series ends", () => {
  it("treats a story with no planned count as finished at the server's default", async () => {
    const story = makeStory({ plannedChapterCount: undefined });
    const third = makeChapter({ id: "chapter-3", chapterNumber: 3 });
    story.chapters = [...story.chapters, third];

    const view = await render(
      <ChapterEnd story={story} chapter={third} onContinue={jest.fn()} />,
    );

    await waitFor(() =>
      expect(view.queryByTestId("chapter-end-option-0")).toBeNull()
    );
  });

  it("still offers a continuation before that default is reached", async () => {
    const story = makeStory({ plannedChapterCount: undefined });
    const view = await render(
      <ChapterEnd
        story={story}
        chapter={story.chapters[1]}
        onContinue={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(view.getByTestId("chapter-end-option-0")).toBeTruthy()
    );
  });
});

// GONE WITH THE PANEL IT LIVED IN, deliberately.
//
// This file used to end with two tests on the offline walkthrough's honesty:
// when no backend is configured the stub returns canned prose, so the
// direction the reader chose cannot shape it, and the component said so in the
// confirmation panel it showed after a successful continuation ("the direction
// you chose was not used", under a "New chapter ready" heading).
//
// That confirmation panel is what the 2026-09-09 design decision removed. A
// continuation no longer resolves at the bottom of the last page of the
// previous chapter; it turns the reader to page 1 of the NEW chapter and the
// prose arrives there. There is no panel left to carry the sentence, and the
// component no longer makes the request, so it never learns which model
// answered. The behaviour is gone from the product, not moved, and these tests
// went with it rather than being left asserting a surface that no longer
// exists.

import React from "react";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";

const mockInferStoryBrief = jest.fn();
const mockSendEmailCode = jest.fn();
const mockVerifyEmailCode = jest.fn();
const mockEnableNotifications = jest.fn();
class MockStoryShapeRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "StoryShapeRequestError";
  }
}

jest.mock("@/lib/api", () => ({
  inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
  inferOnboardingStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
  StoryShapeRequestError: MockStoryShapeRequestError,
}));

jest.mock("@/lib/session", () => ({
  sendEmailCode: (...args: unknown[]) => mockSendEmailCode(...args),
  verifyEmailCode: (...args: unknown[]) => mockVerifyEmailCode(...args),
}));

jest.mock("@/lib/notifications", () => ({
  enableNotifications: () => mockEnableNotifications(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

// The onboarding flow draws its glyphs through `@/theme`'s named icon set,
// which is backed by Ionicons. The font is irrelevant to every assertion here,
// and rendering it pulls a native font module into the test environment.
jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

jest.mock("@/components/create/CraftingLoader", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    CraftingLoader: () => React.createElement(Text, null, "Crafting"),
    CRAFTING_STAGES: [],
  };
});

/* eslint-disable import/first */
import WriterOnboarding, {
  STARTER_CARD_GAP,
  STARTER_CARD_WIDTH,
  STARTER_RAIL_PEEK,
} from "@/screens/WriterOnboarding";
// The starter copy is owned by the content module and gets rewritten there.
// Asserting against the sentences would make this a test of the copy; keying
// off the module tests what the screen is supposed to do with it.
import { GENRE_STARTERS } from "@/lib/genre-content";
import { colors, onboardingType, spacing } from "@/theme";
/* eslint-enable import/first */

const SHAPE = {
  genres: ["mystery"],
  whereAndWhen: "A hill town, off-season",
  characters: [
    {
      name: "Elena Marquez",
      description: "Historical restorer, 34",
      background: "",
      appearance: "",
      isHero: true,
    },
  ],
  suggestedMoments: ["She hears her own name through the wall"],
  beats: [
    "Elena inherits the house and finds the door",
    "The letters arrive before they are written",
    "She answers one, and it answers back",
  ],
  title: "The Door That Was Not On The Deed",
  opening: "The clocks began counting backward.\n\nElena stood in the hall.",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInferStoryBrief.mockResolvedValue(SHAPE);
  mockSendEmailCode.mockResolvedValue(undefined);
  mockVerifyEmailCode.mockResolvedValue(undefined);
  mockEnableNotifications.mockResolvedValue(true);
});

type View = Awaited<ReturnType<typeof render>>;

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

async function settleCraftingHold() {
  await act(async () => {});
}

async function renderFlow(onDone = jest.fn()) {
  // `render` and `fireEvent` are both async in RNTL 14: every call has to be
  // awaited or the assertion runs against the previous frame.
  const view = await render(<WriterOnboarding onDone={onDone} />);
  return { onDone, view };
}

async function reachDetailsThenFinish(
  view: View,
  onDetails: () => Promise<unknown> | unknown,
) {
  await fireEvent.changeText(
    view.getByLabelText("Your idea"),
    "A woman inherits a boarded-up house and finds letters that arrive early.",
  );
  await fireEvent.press(view.getByRole("button", { name: "Continue" }));
  await view.findByText("Shape the Story");
  await onDetails();
  await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
  await fireEvent.changeText(view.getByLabelText("Email address"), "w@e.com");
  await fireEvent.press(
    view.getByRole("button", { name: "Save & continue" }),
  );
  await fireEvent.changeText(
    await view.findByLabelText("Verification code"),
    "123456",
  );
  await fireEvent.press(
    view.getByRole("button", { name: "Verify and continue" }),
  );
  await settleCraftingHold();
  await view.findByText(SHAPE.title);
  await fireEvent.press(
    await view.findByRole("button", { name: "Continue" }),
  );
  await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
  await fireEvent.press(await view.findByRole("button", { name: "Not now" }));
  await fireEvent.press(await view.findByRole("button", { name: "Open Katha" }));
}

/** Idea, details, auth, the crafting floor, and out the other side onto the preview. */
async function reachPreview(view: View) {
  await reachPreviewWithTitle(view, SHAPE.title);
}

/**
 * The same walk, landing on a named title.
 *
 * The preview screen has no heading of its own - the story's title is the
 * heading - so "have we arrived" is a question about the title, and the
 * failure path arrives under a different one.
 */
async function reachPreviewWithTitle(view: View, title: string) {
  await fireEvent.changeText(
    view.getByLabelText("Your idea"),
    "A woman inherits a boarded-up house and finds letters that arrive early.",
  );
  await fireEvent.press(view.getByRole("button", { name: "Continue" }));
  await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
  await fireEvent.changeText(view.getByLabelText("Email address"), "w@example.com");
  await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
  await fireEvent.changeText(
    await view.findByLabelText("Verification code"),
    "123456",
  );
  await fireEvent.press(view.getByRole("button", { name: "Verify and continue" }));
  await settleCraftingHold();
  await view.findByText(title);
}

describe("writer onboarding", () => {
  it("holds the idea screen until the idea clears the floor", async () => {
    const { view } = await renderFlow();
    expect(
      view.getByRole("button", { name: "Continue" }).props.accessibilityState
        .disabled,
    ).toBe(true);

    // Onboarding gets one model call, and that call has to return a title, a
    // world, a cast, a plan and 150 words of opening. Six words cannot carry
    // it, and the user reads the generic result as what Katha can do.
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A haunted house.",
    );
    // A stateful line, not a countdown. A number ticking down reads as a
    // hurdle; this says what the idea needs, then confirms it has it.
    expect(
      view.getByText("Add a little more so Katha has something to build on."),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Continue" }).props.accessibilityState
        .disabled,
    ).toBe(true);

    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters.",
    );
    expect(view.getByText("Enough to write from.")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Continue" }).props.accessibilityState
        .disabled,
    ).toBe(false);
  });

  it("turns the idea line over at exactly the floor", async () => {
    const { view } = await renderFlow();
    await fireEvent.changeText(view.getByLabelText("Your idea"), "a".repeat(39));
    expect(
      view.getByText("Add a little more so Katha has something to build on."),
    ).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText("Your idea"), "a".repeat(40));
    expect(view.getByText("Enough to write from.")).toBeTruthy();
  });

  it("labels chapter length by reading time, not word count", async () => {
    const { view } = await renderFlow();
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");

    // Minutes are what a reader feels. A word count is a number the writer has
    // to convert before it means anything.
    expect(view.getByLabelText("Chapter length, Standard, about 5 minutes"))
      .toBeTruthy();
    expect(view.getByText("About 15 minutes to read, across 3 chapters."))
      .toBeTruthy();

    await fireEvent.press(view.getByLabelText("Chapter length, Standard, about 5 minutes"));
    await fireEvent.press(view.getByText("Long · 9 min"));
    expect(view.getByText("About 27 minutes to read, across 3 chapters."))
      .toBeTruthy();
    await fireEvent.press(view.getByLabelText("Chapters, 3 chapters"));
    await fireEvent.press(view.getByText("7 chapters"));
    expect(view.getByText("About 63 minutes to read, across 7 chapters."))
      .toBeTruthy();
  });

  it("takes other instructions through to the draft", async () => {
    const onDone = jest.fn();
    const { view } = await renderFlow(onDone);
    await reachDetailsThenFinish(view, () =>
      fireEvent.changeText(
        view.getByLabelText("Other instructions"),
        "no graphic violence",
      ));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0].draft.avoid).toBe("no graphic violence");
  });

  it("opens on a selected genre and keys the starters to it", async () => {
    const { view } = await renderFlow();
    // One chip carrying the current shelf. The other twelve are behind it.
    expect(view.getByLabelText("Genre, Mystery")).toBeTruthy();
    expect(view.queryByLabelText("Horror")).toBeNull();

    // A romance starter on a horror shelf teaches the wrong thing about what
    // to type, and these are what a user with a blank page taps.
    expect(view.getByLabelText(GENRE_STARTERS.mystery[0])).toBeTruthy();

    await fireEvent.press(view.getByLabelText("Genre, Mystery"));
    expect(
      view.getByLabelText("Mystery").props.accessibilityState.selected,
    ).toBe(true);
    await fireEvent.press(view.getByLabelText("Horror"));

    // Choosing closes the list, and the chip states the new answer.
    expect(view.getByLabelText("Genre, Horror")).toBeTruthy();
    expect(view.queryByLabelText("Mystery")).toBeNull();
    expect(view.queryByLabelText(GENRE_STARTERS.mystery[0])).toBeNull();
    expect(view.getByLabelText(GENRE_STARTERS.horror[0])).toBeTruthy();
  });

  it("leaves the shelf alone when the list is dismissed without a pick", async () => {
    const { view } = await renderFlow();
    await fireEvent.press(view.getByLabelText("Genre, Mystery"));
    expect(view.getByLabelText("Horror")).toBeTruthy();

    // The same tap that opened it shuts it. Backing out of a picker must
    // never be a way to lose the answer you already had.
    await fireEvent.press(view.getByLabelText("Genre, Mystery"));
    expect(view.queryByLabelText("Horror")).toBeNull();
    expect(view.getByLabelText("Genre, Mystery")).toBeTruthy();
    expect(view.getByLabelText(GENRE_STARTERS.mystery[0])).toBeTruthy();
  });

  it("opens the chip on the shelf chosen earlier in onboarding", async () => {
    const view = await render(
      <WriterOnboarding onDone={jest.fn()} initialGenre="fantasy" />,
    );
    expect(view.getByLabelText("Genre, Fantasy")).toBeTruthy();
    expect(view.getByLabelText(GENRE_STARTERS.fantasy[0])).toBeTruthy();
  });

  it("marks the optional sections, and only those", async () => {
    const { view } = await renderFlow();
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");

    // Optionality belongs to the section that is optional. A blanket line over
    // the whole screen told the user none of it mattered, and was untrue of
    // the two segmented controls, which always carry a value.
    expect(view.getByLabelText("Moments, optional")).toBeTruthy();
    expect(view.getByLabelText("Writing style, optional")).toBeTruthy();
    expect(view.getByLabelText("Other instructions, optional")).toBeTruthy();
    expect(view.getByText("CHAPTERS")).toBeTruthy();
    expect(view.getByText("CHAPTER LENGTH")).toBeTruthy();
    expect(view.queryByLabelText("Chapters, optional")).toBeNull();
    expect(view.queryByLabelText("Chapter length, optional")).toBeNull();
    expect(
      view.queryByText("All optional. Everything here reaches the story."),
    ).toBeNull();
  });

  it("makes exactly one model call, in the onboarding variant", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    // The whole pre-paywall flow is budgeted at one structured call. A second
    // one here is the failure this test exists to catch.
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
    // The chosen shelf goes with it, so inference shapes to the user's pick
    // rather than overruling it from the sentence.
    expect(mockInferStoryBrief).toHaveBeenCalledWith(
      "A woman inherits a boarded-up house and finds letters that arrive early.",
      "mystery",
      expect.objectContaining({
        chapterLength: "standard",
        plannedChapterCount: 3,
      }),
    );
  });

  it("shows the plan on the preview, numbered and read-only", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);

    // The chapter plan survived the removal of the blueprint screen; the
    // editing of it did not. It is shown here as the shape of what was bought
    // and rewritten in the studio, which is what the entitlements promise.
    for (const beat of SHAPE.beats) {
      expect(view.getByText(beat)).toBeTruthy();
    }
    expect(view.getByText("01")).toBeTruthy();
    expect(view.getByText("03")).toBeTruthy();
    expect(view.queryByLabelText(/Tap to edit/)).toBeNull();
    // Never an "arc", never a "premise". ONBOARDING_FLOW.md's vocabulary rule.
    expect(view.queryByText(/\barc\b/i)).toBeNull();
    expect(view.queryByText(/premise/i)).toBeNull();
  });

  it("puts the concept, the shelf and the world on one byline", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);

    // Three labelled rows in a card on the screen this replaces, one
    // middot-joined line here.
    expect(
      view.getByText("Mystery \u00b7 A hill town, off-season \u00b7 Elena Marquez"),
    ).toBeTruthy();
    expect(view.queryByText("WHERE AND WHEN")).toBeNull();
    expect(view.queryByText("WHO\u2019S IN IT")).toBeNull();
  });

  it("leaves no stranded separators when the shape call gave nothing", async () => {
    mockInferStoryBrief.mockResolvedValue({
      ...SHAPE,
      whereAndWhen: "",
      characters: [],
    });
    const { view } = await renderFlow();
    await reachPreview(view);
    // The shelf is the one part that is always present, because the user
    // picked it themselves.
    expect(view.getByText("Mystery")).toBeTruthy();
    expect(view.queryByText(/\u00b7\s*$/)).toBeNull();
  });

  it("goes straight from the wait to the preview, with no screen in between", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);

    // The blueprint screen was a toll gate: a summary of a story the user had
    // not been allowed to read, with a button to go and read it. Both its
    // heading and its button are gone, and the prose is on this screen.
    expect(view.queryByText("Your idea just became a story.")).toBeNull();
    expect(view.queryByRole("button", { name: "See the preview" })).toBeNull();
    expect(view.getByText("The clocks began counting backward.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("makes the story title the only heading on the preview", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);

    // A screen about one story does not need a sentence above the story's own
    // name, and a second sentence-case line at 28 would make this the only
    // screen in the flow with two titles.
    const headings = view.getAllByRole("header");
    expect(headings).toHaveLength(1);
    expect(headings[0].props.children).toBe(SHAPE.title);
    expect(view.queryByText("This is the beginning.")).toBeNull();
  });


  it("shows entitlements on the preview, never behind the paywall", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    expect(view.getByText("YOU CAN ALWAYS")).toBeTruthy();
    expect(
      view.getByText("Rewrite any line by hand, free and unlimited"),
    ).toBeTruthy();
    expect(view.getByText(/Ask Katha to redraft/)).toBeTruthy();
  });

  it("falls through the paywall to the offer, then the notification ask", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    await fireEvent.press(await view.findByRole("button", { name: "Continue" }));
    await view.findByText("Your story is ready to be created.");
    await fireEvent.press(view.getByRole("button", { name: "Close" }));
    await view.findByText("ONE-TIME OFFER");
    await fireEvent.press(view.getByRole("button", { name: "No thanks" }));
    await view.findByText("Want to know when it's ready?");
  });

  it("asks for notifications only after the user opts in", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    await fireEvent.press(await view.findByRole("button", { name: "Continue" }));
    await fireEvent.press(await view.findByRole("button", { name: "Close" }));
    await fireEvent.press(await view.findByRole("button", { name: "No thanks" }));
    await view.findByText("Want to know when it's ready?");
    // The soft pre-prompt must not have touched the OS dialog on the way here.
    // iOS grants one system prompt per install, and spending it before this
    // screen is unrecoverable.
    expect(mockEnableNotifications).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole("button", { name: "Notify me" }));
    await waitFor(() => expect(mockEnableNotifications).toHaveBeenCalled());
  });

  it("keeps the chosen shelf when inference disagrees with it", async () => {
    mockInferStoryBrief.mockResolvedValue({ ...SHAPE, genres: ["romance"] });
    const onDone = jest.fn();
    const { view } = await renderFlow(onDone);
    await fireEvent.press(view.getByLabelText("Genre, Mystery"));
    await fireEvent.press(view.getByLabelText("Horror"));
    await reachPreview(view);
    await fireEvent.press(await view.findByRole("button", { name: "Continue" }));
    await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
    await fireEvent.press(await view.findByRole("button", { name: "Not now" }));
    await fireEvent.press(await view.findByRole("button", { name: "Open Katha" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const result = onDone.mock.calls[0][0];
    // The one explicit choice on the screen must not be overruled by a guess.
    expect(result.draft.primaryGenre).toBe("horror");
    expect(result.draft.genres[0]).toBe("horror");
    expect(result.draft.genres).toContain("romance");
  });

  it("sends a typed cast, with the first as the lead", async () => {
    const onDone = jest.fn();
    const { view } = await renderFlow(onDone);
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByLabelText("Add a character"));
    await fireEvent.changeText(view.getByLabelText("Character 1 name"), "Elena");
    await fireEvent.changeText(
      view.getByLabelText("Character 1 background"),
      "Restores old houses. Believes wood remembers.",
    );
    await fireEvent.press(view.getByLabelText("Add one more"));
    await fireEvent.changeText(view.getByLabelText("Character 2 name"), "Mara");
    // Two is the cap in onboarding, so the add control is gone.
    expect(view.queryByLabelText("Add one more")).toBeNull();

    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(view.getByLabelText("Email address"), "w@e.com");
    await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(view.getByRole("button", { name: "Verify and continue" }));
    await settleCraftingHold();
    await view.findByText(SHAPE.title);
    await fireEvent.press(await view.findByRole("button", { name: "Continue" }));
    await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
    await fireEvent.press(await view.findByRole("button", { name: "Not now" }));
    await fireEvent.press(await view.findByRole("button", { name: "Open Katha" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const characters = onDone.mock.calls[0][0].draft.characters;
    expect(characters).toHaveLength(2);
    expect(characters[0]).toMatchObject({ name: "Elena", isHero: true });
    // Background is personality and backstory, which is what drives the voice.
    expect(characters[0].background).toContain("wood remembers");
    expect(characters[1]).toMatchObject({ name: "Mara", isHero: false });
  });

  it("hands the blueprint back as a draft, with the plan intact", async () => {
    const onDone = jest.fn();
    const { view } = await renderFlow(onDone);
    await reachPreview(view);
    await fireEvent.press(await view.findByRole("button", { name: "Continue" }));
    await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
    await fireEvent.press(await view.findByRole("button", { name: "Not now" }));
    await fireEvent.press(await view.findByRole("button", { name: "Open Katha" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const result = onDone.mock.calls[0][0];
    expect(result.draft.beats).toEqual(SHAPE.beats);
    expect(result.draft.primaryGenre).toBe("mystery");
    expect(result.draft.whereAndWhen).toBe("A hill town, off-season");
    expect(result.draft.plannedChapterCount).toBe(3);
    expect(result.subscribed).toBe(true);
  });

  it("does not re-run auth when the user walks back to change the idea", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    expect(mockSendEmailCode).toHaveBeenCalledTimes(1);

    // Back to the details step, then forward again. Auth is one-way: a
    // verified address must not be sent a second code, and a signed-in user
    // must not be put back in front of a sign-in form.
    await fireEvent.press(view.getByLabelText("Back"));
    await view.findByText("Shape the Story");
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await settleCraftingHold();
  await view.findByText(SHAPE.title);

    expect(mockSendEmailCode).toHaveBeenCalledTimes(1);
    expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1);
  });



  it("shows retry when the shape call fails", async () => {
    mockInferStoryBrief.mockRejectedValue(new Error("provider down"));
    const { view } = await renderFlow();
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(view.getByLabelText("Email address"), "w@example.com");
    await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
    await fireEvent.changeText(await view.findByLabelText("Verification code"), "123456");
    await fireEvent.press(view.getByRole("button", { name: "Verify and continue" }));
    await view.findByText("Preview needs one more try");
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("clamps the plan when the planned length shrinks", async () => {
    mockInferStoryBrief.mockResolvedValue({
      ...SHAPE,
      beats: ["one", "two", "three", "four", "five", "six", "seven"],
    });
    const onDone = jest.fn();
    const { view } = await renderFlow(onDone);
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    // 3 is the default, so a seven-beat response must arrive already clamped.
    await fireEvent.press(await view.findByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(view.getByLabelText("Email address"), "w@example.com");
    await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(view.getByRole("button", { name: "Verify and continue" }));
    await settleCraftingHold();
  await view.findByText(SHAPE.title);
    expect(view.queryByText("four")).toBeNull();
    expect(view.getByText("three")).toBeTruthy();
  });
});


/* ── The "Try one" rail ───────────────────────────────────────────────── */

describe("the Try one rail", () => {
  // ONBOARDING_FLOW.md fixes the reference frame at 390 x 844. Every number
  // below is checked against that width rather than against the intent.
  const SCREEN = 390;
  const GUTTER = 32; // spacing.xxxl

  it("leaves a slice of the second card on screen at 390pt", async () => {
    const { view } = await renderFlow();
    const cards = GENRE_STARTERS.mystery.map((starter) =>
      StyleSheet.flatten(view.getByLabelText(starter).props.style)
    );
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.width).toBe(STARTER_CARD_WIDTH);
    }

    // Card one starts on the gutter; card two starts a card and a gap later.
    const secondCardStartsAt = GUTTER + STARTER_CARD_WIDTH + STARTER_CARD_GAP;
    const peek = SCREEN - secondCardStartsAt;
    expect(peek).toBe(STARTER_RAIL_PEEK);
    // The peek is the only thing on this screen that says the rail scrolls, so
    // it has to be an unmistakable slice of a card rather than a sliver. A
    // second card that begins at or past the right gutter (358) shows nothing.
    expect(secondCardStartsAt).toBeLessThan(SCREEN - GUTTER);
    expect(peek).toBeGreaterThanOrEqual(56);
  });

  it("never truncates a starter", async () => {
    const { view } = await renderFlow();
    for (const starter of GENRE_STARTERS.mystery) {
      const card = view.getByLabelText(starter);
      // A truncated starter teaches nothing about what a usable idea looks
      // like, which is the entire reason these cards exist.
      expect(view.getByText(starter).props.numberOfLines).toBeUndefined();
      expect(card).toBeTruthy();
    }
  });
});

/* ── The details fields ───────────────────────────────────────────────── */

describe("the details fields", () => {
  async function reachDetails(view: View) {
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");
  }

  it("does not count moments at the user", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);
    // The cap is still five; it is simply never shown. A "0 / 5" turned an
    // invitation into a quota and told an empty screen it was four short.
    expect(view.queryByText("0 / 5")).toBeNull();
    expect(view.queryByText(/\d \/ 5/)).toBeNull();

    await fireEvent.changeText(
      view.getByLabelText("Add a moment"),
      "A rooftop confession",
    );
    await fireEvent.press(view.getByRole("button", { name: "Add moment" }));
    expect(view.queryByText("1 / 5")).toBeNull();
  });

  it("gives moments the roomy box and the other two a single line", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    // A scene is a sentence, so the field that takes scenes is the tall one.
    expect(view.getByLabelText("Add a moment").props.multiline).toBe(true);
    // A style note and a constraint are each one line, and a 62pt box asking
    // for a phrase reads as a field the user failed to finish.
    expect(view.getByLabelText("Writing style").props.multiline).toBeFalsy();
    expect(
      view.getByLabelText("Other instructions").props.multiline,
    ).toBeFalsy();
  });
});

/* ── The email screen ─────────────────────────────────────────────────── */

describe("the email screen", () => {
  async function reachEmail(view: View) {
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await fireEvent.press(
      await view.findByRole("button", { name: "Create my story" }),
    );
    await view.findByLabelText("Email address");
  }

  it("shows what is being saved, and what the address buys", async () => {
    const { view } = await renderFlow();
    await reachEmail(view);

    expect(view.getByText("Save your story before we shape it.")).toBeTruthy();
    expect(view.getByText(/keep your idea and blueprint/)).toBeTruthy();
    expect(view.getByText("EMAIL")).toBeTruthy();
    expect(view.getByLabelText("Email address").props.placeholder).toBe(
      "elena@example.com",
    );
    expect(view.getByRole("button", { name: "Save & continue" })).toBeTruthy();
    expect(
      view.getByText("By continuing you agree to our Terms and Privacy Policy."),
    ).toBeTruthy();
  });

  it("promises the code it actually sends, not the design's magic link", async () => {
    const { view } = await renderFlow();
    await reachEmail(view);
    // session.ts chose a one-time code over a link because a link opens a
    // browser and drops the user out of the flow. Promising a link here and
    // then showing a code box on the next screen breaks that promise on the
    // screen that is asking to be trusted with an address.
    expect(
      view.getByText("We’ll send a 6-digit code. No password needed."),
    ).toBeTruthy();
    expect(view.queryByText(/magic link/i)).toBeNull();
  });

  it("reports where the user is in the flow, and counts screens that exist", async () => {
    const { view } = await renderFlow();
    await reachEmail(view);
    // Six, not seven. Seven counted the blueprint screen, which is gone, and
    // it also put the auth screens at the END of a flow they sit in the middle
    // of. A progress row that is wrong about both is worse than none.
    expect(view.getByLabelText("Step 3 of 6")).toBeTruthy();

    await fireEvent.changeText(
      view.getByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
    await view.findByLabelText("Verification code");
    expect(view.getByLabelText("Step 4 of 6")).toBeTruthy();
    expect(view.queryByLabelText("Step 3 of 6")).toBeNull();
  });

  it("keeps counting on the preview, which its design draws dots on", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);
    expect(view.getByLabelText("Step 5 of 6")).toBeTruthy();
  });
});


/* ── Backend-coordinated crafting ─────────────────────────────────────── */

describe("backend-coordinated crafting", () => {
  async function reachCrafting(view: View) {
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await fireEvent.press(
      await view.findByRole("button", { name: "Create my story" }),
    );
    await fireEvent.changeText(
      view.getByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
    await fireEvent.changeText(
      await view.findByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
  }

  it("reveals when the backend shape request resolves", async () => {
    const { view } = await renderFlow();
    await reachCrafting(view);
    await view.findByText(SHAPE.title);
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
  });

  it("keeps the wait up while the backend request is still in flight", async () => {
    let resolve: (value: unknown) => void = () => {};
    mockInferStoryBrief.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { view } = await renderFlow();
    await reachCrafting(view);
    await view.findByText("Crafting");

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(view.queryByText(SHAPE.title)).toBeNull();
    expect(view.getByText("Crafting")).toBeTruthy();

    await act(async () => {
      resolve(SHAPE);
    });
    await view.findByText(SHAPE.title);
  });

  it("sends the full details brief to the shape call", async () => {
    const { view } = await renderFlow();
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "Nikita inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Add a character" }));
    await fireEvent.changeText(view.getByLabelText("Character 1 name"), "Nikita");
    await fireEvent.changeText(
      view.getByLabelText("Character 1 background"),
      "A careful architect who distrusts old family stories.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");
    await fireEvent.changeText(view.getByLabelText("Add a moment"), "She opens the sealed nursery");
    await fireEvent.press(view.getByRole("button", { name: "Add moment" }));
    await fireEvent.changeText(view.getByLabelText("Writing style"), "quiet gothic");
    await fireEvent.changeText(view.getByLabelText("Other instructions"), "avoid gore");
    await fireEvent.press(view.getByRole("button", { name: "Create my story" }));
    await fireEvent.changeText(await view.findByLabelText("Email address"), "w@example.com");
    await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
    await fireEvent.changeText(await view.findByLabelText("Verification code"), "123456");
    await fireEvent.press(view.getByRole("button", { name: "Verify and continue" }));
    await view.findByText(SHAPE.title);

    expect(mockInferStoryBrief).toHaveBeenCalledWith(
      expect.stringContaining("Nikita inherits"),
      "mystery",
      expect.objectContaining({
        characters: [
          expect.objectContaining({ name: "Nikita", isHero: true }),
        ],
        moments: ["She opens the sealed nursery"],
        writingStyle: "quiet gothic",
        avoid: "avoid gore",
        chapterLength: "standard",
        plannedChapterCount: 3,
      }),
    );
  });

  it("shows a retry screen when shaping fails", async () => {
    mockInferStoryBrief.mockRejectedValue(new Error("provider down"));
    const { view } = await renderFlow();
    await reachCrafting(view);

    await view.findByText("Preview needs one more try");
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("starts a fresh shape request after a failed retryable request", async () => {
    mockInferStoryBrief
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce(SHAPE);
    const { view } = await renderFlow();
    await reachCrafting(view);

    await view.findByText("Preview needs one more try");
    await fireEvent.press(view.getByRole("button", { name: "Try again" }));

    await view.findByText(SHAPE.title);
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(2);
  });

  it("does not present retry as useful after a non-retryable shape failure", async () => {
    mockInferStoryBrief.mockRejectedValue(
      new MockStoryShapeRequestError("Daily limit reached.", false),
    );
    const { view } = await renderFlow();
    await reachCrafting(view);

    await view.findByText("Daily limit reached.");
    expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(view.getByRole("button", { name: "Back to details" })).toBeTruthy();
  });

  it("abandons the reveal when the screen goes away during the request", async () => {
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    mockInferStoryBrief.mockReturnValue(
      new Promise(() => {}),
    );
    const { view } = await renderFlow();
    await reachCrafting(view);
    await view.findByText("Crafting");
    await view.unmount();
    await act(async () => {});
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/* ── Headings and the header group ────────────────────────────────────── */

describe("the onboarding type scale", () => {
  function headerGroupOf(view: View, title: string) {
    const heading = view.getByText(title);
    // The Text and its sibling sub share one wrapper. `parent` is that wrapper
    // rather than the scroll container, which is the whole point of the fix.
    return { heading, group: heading.parent! };
  }

  it("sets every screen heading on the onboarding scale, not the old one", async () => {
    const { view } = await renderFlow();

    function expectOnboardingTitle(title: string) {
      const style = StyleSheet.flatten(view.getByText(title).props.style);
      // 22/28 Inter Tight SemiBold. The flow used to run `type.largeTitle`
      // (Bricolage Grotesque at 34) on every screen except the two auth ones,
      // so five of the seven were still on the pre-onboarding heading and the
      // product owner was right to say they were seeing the old style.
      expect(style.fontSize).toBe(onboardingType.title.fontSize);
      expect(style.fontFamily).toBe(onboardingType.title.fontFamily);
      expect(style.letterSpacing).toBe(onboardingType.title.letterSpacing);
    }

    expectOnboardingTitle("What's your story about?");

    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");
    expectOnboardingTitle("Shape the Story");

    await fireEvent.press(
      view.getByRole("button", { name: "Create my story" }),
    );
    await view.findByText("Save your story before we shape it.");
    expectOnboardingTitle("Save your story before we shape it.");

    await fireEvent.changeText(
      view.getByLabelText("Email address"),
      "w@example.com",
    );
    await fireEvent.press(view.getByRole("button", { name: "Save & continue" }));
    await view.findByText("Check your inbox");
    expectOnboardingTitle("Check your inbox");

    await fireEvent.changeText(
      view.getByLabelText("Verification code"),
      "123456",
    );
    await fireEvent.press(
      view.getByRole("button", { name: "Verify and continue" }),
    );
    await settleCraftingHold();
    // The preview sets no screen title of its own. The story's name is the
    // heading, and it is set on the same token as every heading before it.
    await view.findByText(SHAPE.title);
    expectOnboardingTitle(SHAPE.title);
  });

  it("keeps the sub tied to its heading rather than to the content", async () => {
    const { view } = await renderFlow();
    const { group } = headerGroupOf(view, "What's your story about?");
    const sub = view.getByText(
      "One good sentence is enough. Katha builds the rest.",
    );

    // One group: the sub is the second line of the heading, not the first item
    // of the form. As siblings of the scroll container they sat `spacing.xl`
    // apart, the same distance as two unrelated sections.
    expect(sub.parent).toBe(group);
    expect(StyleSheet.flatten(group.props.style).gap).toBe(spacing.related);
    expect(spacing.related).toBeLessThan(spacing.xl);

    // And the sub is SECONDARY copy on the onboarding scale: smaller than the
    // text in the field it introduces, not the same size as it.
    expect(StyleSheet.flatten(sub.props.style).fontSize).toBe(
      onboardingType.helper.fontSize,
    );
    expect(onboardingType.helper.fontSize).toBeLessThan(onboardingType.body.fontSize);
  });

  it("groups the auth screens' headline the same way as every other step", async () => {
    const { view } = await renderFlow();
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await fireEvent.press(
      await view.findByRole("button", { name: "Create my story" }),
    );

    // The email screen used to set its own headline styles. There is one way
    // to set a heading now, and the artwork above it is a slot on the same
    // component rather than a reason to hand-roll the header.
    const heading = await view.findByText("Save your story before we shape it.");
    const sub = view.getByText(/keep your idea and blueprint/);
    expect(sub.parent).toBe(heading.parent);
    expect(StyleSheet.flatten(heading.parent!.props.style).gap).toBe(
      spacing.related,
    );
  });

  it("names the details screen for what the writer already holds", async () => {
    const { view } = await renderFlow();
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));

    // "Anything that has to happen?" was a yes-or-no question about one of the
    // five things on the screen, and its honest answer is "no".
    await view.findByText("Shape the Story");
    expect(view.queryByText("Anything that has to happen?")).toBeNull();
    expect(
      view.getByText(
        "What you add here reaches the story. What you leave out, Katha decides.",
      ),
    ).toBeTruthy();
  });

  it("lands the reveal as the payoff it is", async () => {
    const { view } = await renderFlow();
    await reachPreview(view);

    // The reveal is the first time the idea is specific, and it follows a wait
    // the user sat through. What they get for the wait is the story: its name,
    // its shelf, its plan and its opening lines, all on one screen. It used to
    // be a summary card with a button to go and see the story.
    expect(view.getByText(SHAPE.title)).toBeTruthy();
    // The cover is a duplicate of the title beside it, so it is hidden from
    // assistive technology and reachable only with hidden elements included.
    expect(
      view.getByText("CONCEPT", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(view.getByText("PREVIEW")).toBeTruthy();
    expect(view.getByText("The clocks began counting backward.")).toBeTruthy();
    expect(view.queryByText("Here's the shape of it.")).toBeNull();
  });
});

/* ── The details screen's hierarchy ───────────────────────────────────── */

/**
 * The screen the product owner called out for having "no space/size
 * hierarchy". Both halves of the cause are asserted here, because fixing
 * either one alone leaves the screen reading as a flat stack:
 *
 *  - SIZE. Every section headed itself with a 12pt uppercase label, which made
 *    the head the smallest thing in its own section and smaller than the
 *    helper line beneath it.
 *  - DISTANCE. One uniform container gap separated the sections, at the same
 *    order as the gap between a head and its own field, so nothing grouped.
 */
describe("the details screen's hierarchy", () => {
  async function reachDetails(view: View) {
    await fireEvent.changeText(
      view.getByLabelText("Your idea"),
      "A woman inherits a boarded-up house and finds letters that arrive early.",
    );
    await fireEvent.press(view.getByRole("button", { name: "Continue" }));
    await view.findByText("Shape the Story");
  }

  /** Every section head on the screen, optional ones reached by their label. */
  function headsOf(view: View) {
    return [
      view.getByLabelText("Moments, optional"),
      view.getByLabelText("Writing style, optional"),
      view.getByLabelText("Other instructions, optional"),
      view.getByText("CHAPTERS"),
      view.getByText("CHAPTER LENGTH"),
    ];
  }

  it("sets every section head on the one eyebrow treatment", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    for (const head of headsOf(view)) {
      const style = StyleSheet.flatten(head.props.style);
      expect(style.fontSize).toBe(onboardingType.sectionHeader.fontSize);
      expect(style.fontFamily).toBe(onboardingType.sectionHeader.fontFamily);
      expect(style.letterSpacing).toBe(onboardingType.sectionHeader.letterSpacing);
      expect(style.color).toBe(colors.ink);
    }
  });

  it("leaves exactly one large heading on the screen", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    // The regression this replaces: section heads promoted to 21pt gave the
    // screen five things that looked like titles and one that was one. Nothing
    // on the screen but the title itself is set above `body`.
    const title = view.getByText("Shape the Story");
    expect(StyleSheet.flatten(title.props.style).fontSize).toBe(
      onboardingType.title.fontSize,
    );
    for (const head of headsOf(view)) {
      expect(StyleSheet.flatten(head.props.style).fontSize).toBeLessThan(
        onboardingType.title.fontSize,
      );
    }
  });

  it("sets secondary copy smaller than the text in the field under it", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    // The defect: the helper line was `body` (16), the same size as the text
    // the user types into the field below it, which gave our sentence equal
    // billing with theirs and made supporting copy the widest block on screen.
    const helper = view.getByText(
      "A scene you want in it. Katha places each one where it fits.",
    );
    const style = StyleSheet.flatten(helper.props.style);
    expect(style.fontSize).toBe(onboardingType.helper.fontSize);
    expect(style.color).toBe(colors.muted);

    const field = view.getByLabelText("Add a moment");
    const fieldSize = StyleSheet.flatten(field.props.style).fontSize;
    expect(style.fontSize).toBeLessThan(fieldSize);
  });

  it("tells the eyebrow from its helper by case and colour, not by size", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    // The eyebrow is deliberately the smaller of the two. It is read first
    // anyway, because it is the only uppercase, semibold, wide-tracked string
    // in the section - four signals at once against one shared with nothing.
    const head = StyleSheet.flatten(
      view.getByLabelText("Moments, optional").props.style,
    );
    const helper = StyleSheet.flatten(
      view.getByText(
        "A scene you want in it. Katha places each one where it fits.",
      ).props.style,
    );
    expect(head.fontSize).toBeLessThan(helper.fontSize);
    expect(head.letterSpacing).toBeGreaterThan(helper.letterSpacing!);
    expect(head.color).not.toBe(helper.color);
  });

  it("keeps the optional marker an aside, not part of the section name", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    const markers = view.getAllByText("(optional)");
    expect(markers).toHaveLength(3);
    for (const marker of markers) {
      const style = StyleSheet.flatten(marker.props.style);
      // Same size as the head it sits in, told apart by family and case: at
      // 12pt there is no room below to take a fifth size.
      expect(style.fontSize).toBe(onboardingType.caption.fontSize);
      expect(style.fontFamily).toBe(onboardingType.caption.fontFamily);
      expect(style.fontWeight).not.toBe(onboardingType.sectionHeader.fontWeight);
    }
  });

  it("puts a section's parts closer together than two sections are", async () => {
    const { view } = await renderFlow();
    await reachDetails(view);

    // Inside a section: a head and the control it heads are one thing.
    const section = view.getByText("CHAPTERS").parent!;
    expect(StyleSheet.flatten(section.props.style).gap).toBe(spacing.related);

    // Between sections: the gap on whatever encloses them, which is the
    // scroll view's content container. Walked rather than named, so the test
    // survives a wrapper being added and still measures the real distance.
    let node = section.parent;
    let outerGap: number | string | undefined;
    while (node) {
      const { contentContainerStyle } = node.props as {
        contentContainerStyle?: ViewStyle;
      };
      if (contentContainerStyle) {
        outerGap = StyleSheet.flatten(contentContainerStyle)?.gap;
        break;
      }
      node = node.parent;
    }
    // A single uniform gap doing both jobs is what flattened the screen.
    expect(outerGap).toBe(spacing.betweenGroups);

    // Visibly different, not marginally. theme.ts holds the same floor.
    expect(spacing.betweenGroups).toBeGreaterThanOrEqual(spacing.related * 2);
  });
});

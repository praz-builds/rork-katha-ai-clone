/**
 * The five questions, and the one exit they all leave through.
 *
 * The exit is the part worth guarding. The flow used to fork at Purpose -
 * writers into a separate onboarding, readers into a fake progress ring - and
 * the whole point of the 2026-09-11 rebuild is that it does not any more.
 * A regression that re-forks it would not fail a render test; it would fail
 * here, on `onCharacterPath` not being called for a reader.
 */
import React from "react";
import { BackHandler, StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

// The progress fill is the only animated thing on these screens, and none of
// the assertions below are about it.
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => ({
      value: initial,
      get: () => initial,
      set: () => undefined,
    }),
    withTiming: passthrough,
    withDelay: (_delay: number, value: unknown) => value,
    Easing: { out: () => passthrough, cubic: passthrough },
  };
});

jest.mock("@expo/vector-icons", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/* eslint-disable import/first */
import KathaOnboardingFlowV2, {
  MIN_GENRE_SELECTIONS,
  MOODS,
  selectionFor,
  toggleAnswer,
} from "@/screens/KathaOnboardingFlowV2";
import { genreChipLabel } from "@/components/explore/GenreStrip";
import { BUTTON_RECIPE } from "@/components/Button";
import { colors, controls, genreLabels, radius } from "@/theme";
import { UI_GENRES } from "@/types/domain";
import type { Genre } from "@/types/domain";
/* eslint-enable import/first */

/**
 * Onboarding offers exactly the Create picker's genres. Pinned as a list
 * rather than a count: the bug this replaces was two invented genres ("Cozy
 * Fantasy", "Paranormal Romance") that resolved to other genres downstream,
 * and a count would have passed straight through it.
 */
const EXPECTED_GENRES: readonly Genre[] = UI_GENRES;
/** Walks name and genres, which every purpose shares. */
async function answerNameAndGenres(
  view: Awaited<ReturnType<typeof render>>,
  name: string,
) {
  await fireEvent.changeText(view.getByPlaceholderText("Your first name"), name);
  await fireEvent.press(view.getByText("Continue"));
  await fireEvent.press(view.getByLabelText("Mystery genre"));
  await fireEvent.press(view.getByLabelText("Fantasy genre"));
  await fireEvent.press(view.getByLabelText("Adventure genre"));
  await fireEvent.press(
    await view.findByText(`Continue with ${MIN_GENRE_SELECTIONS}`),
  );
}

describe("KathaOnboardingFlowV2", () => {
  it("routes Android's hardware Back like the arrow, and only exits from the first screen", async () => {
    // Every answer here is local useState with nothing persisted, so a Back
    // that falls through to the system does not go back a step -- it closes
    // the app and loses the lot, while the arrow one line up goes back with
    // everything intact. That asymmetry is the bug.
    const handlers: (() => boolean)[] = [];
    const spy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: () => {} };
      });
    try {
      const view = await render(<KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />);
      const back = () => handlers[handlers.length - 1]();

      // First screen: not consumed, so the system takes it and the app exits.
      let consumed = true;
      await act(async () => {
        consumed = back();
      });
      expect(consumed).toBe(false);
      expect(view.getByText("First, what should we call you?")).toBeTruthy();

      await answerNameAndGenres(view, "Nikita");
      await view.findByText("What brings you to Katha?");

      // Consumed on a questionnaire screen, and it steps back rather than
      // leaving -- with the name still typed in.
      await act(async () => {
        consumed = back();
      });
      expect(consumed).toBe(true);
      expect(await view.findByText(`Continue with ${MIN_GENRE_SELECTIONS}`)).toBeTruthy();

      await act(async () => {
        consumed = back();
      });
      expect(consumed).toBe(true);
      expect(view.getByDisplayValue("Nikita")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("hands a writer to the character flow with their answers and first genre", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );

    expect(view.getByText("First, what should we call you?")).toBeTruthy();
    await answerNameAndGenres(view, "Nikita");

    expect(view.getByText("What brings you to Katha?")).toBeTruthy();
    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Continue"));
    // Nothing leaves before the last question is answered.
    expect(onCharacterPath).not.toHaveBeenCalled();

    expect(view.getByText("What do you want to write?")).toBeTruthy();
    await fireEvent.press(view.getByText("A full novel"));
    await fireEvent.press(view.getByText("Continue"));

    expect(view.getByText("What usually stops you?")).toBeTruthy();
    await fireEvent.press(view.getByText("Plan chapters"));
    await fireEvent.press(view.getByText("Continue"));

    expect(onCharacterPath).toHaveBeenCalledWith({
      purpose: "write",
      // Mystery was tapped first, so it is the shelf the character is seeded
      // from - and it leaves as the `Genre` id, not a display string.
      initialGenre: "mystery",
      onboarding: {
        name: "Nikita",
        genres: ["Mystery", "Fantasy", "Adventure"],
        otherGenre: "",
        refine: ["novel"],
        mood: [],
        moment: ["chapters"],
      },
    });
  });

  it("hands a reader to the same character flow, not to a building screen", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );

    await answerNameAndGenres(view, "Mira");
    await fireEvent.press(view.getByText("Reading"));
    await fireEvent.press(view.getByText("Continue"));

    // The design's heading, and no line under it: the three options say
    // what the question is about.
    expect(view.getByText("How do you like your stories?")).toBeTruthy();
    expect(view.queryByText(/tune reading and narration/)).toBeNull();
    await fireEvent.press(view.getByText("Listening to audio"));
    await fireEvent.press(view.getByText("Continue"));

    // The reader's own question, greeting them by name.
    expect(view.getByText("Mira, what are you in the mood for?")).toBeTruthy();
    expect(
      view.getByText("Tonight only. It sets the story, and who you'll be in it."),
    ).toBeTruthy();
    await fireEvent.press(view.getByText("Something emotional"));
    await fireEvent.press(view.getByText("Continue"));

    expect(view.getByText("When do you usually read?")).toBeTruthy();
    // Single-line routines, not pitches.
    expect(view.getByText("Before bed")).toBeTruthy();
    expect(view.queryByText("A calm chapter to end the day")).toBeNull();
    // The screen after this one is announced before it arrives.
    expect(view.getByText("Be the lead in these stories")).toBeTruthy();
    await fireEvent.press(view.getByText("Before bed"));
    await fireEvent.press(view.getByText("Continue"));

    expect(onCharacterPath).toHaveBeenCalledWith({
      purpose: "read",
      initialGenre: "mystery",
      onboarding: {
        name: "Mira",
        genres: ["Mystery", "Fantasy", "Adventure"],
        otherGenre: "",
        refine: ["listen"],
        mood: ["emotional"],
        moment: ["sleep"],
      },
    });
  });

  it("lets a reader skip the reading-time question, and only that one", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );

    await answerNameAndGenres(view, "Mira");
    await fireEvent.press(view.getByText("Reading"));
    await fireEvent.press(view.getByText("Continue"));
    expect(view.queryByLabelText("Skip")).toBeNull();
    await fireEvent.press(view.getByText("Reading them myself"));
    await fireEvent.press(view.getByText("Continue"));
    expect(view.queryByLabelText("Skip")).toBeNull();
    await fireEvent.press(view.getByText("Surprise me"));
    await fireEvent.press(view.getByText("Continue"));

    // A tapped-then-reconsidered answer does not leave with the skip.
    await fireEvent.press(view.getByText("Weekends"));
    await fireEvent.press(view.getByLabelText("Skip"));

    expect(onCharacterPath).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "read",
        onboarding: expect.objectContaining({
          refine: ["read"],
          mood: ["surprise"],
          moment: [],
        }),
      }),
    );
  });

  it("asks a writer no mood question and offers no skip", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );

    await answerNameAndGenres(view, "Nikita");
    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("A full novel"));
    await fireEvent.press(view.getByText("Continue"));

    expect(view.getByText("What usually stops you?")).toBeTruthy();
    expect(view.queryByText(/in the mood for/)).toBeNull();
    expect(view.queryByLabelText("Skip")).toBeNull();
    expect(view.queryByText("Be the lead in these stories")).toBeNull();
  });

  /*
    One pill per step, the count from `lib/onboarding-progress.ts`, and the
    same row on every screen. The bar used to be a filled track labelled
    `n/5` that vanished at the character screens, where a different row of
    seven pills started four in.
  */
  it("draws one progress row, counted per purpose, from the first screen", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );
    const step = () =>
      view.getByLabelText(/^Step \d+ of \d+$/).props.accessibilityLabel;

    // The longest row until the purpose is known.
    expect(step()).toBe("Step 1 of 8");
    expect(view.queryByText("1/5")).toBeNull();
    await answerNameAndGenres(view, "Nikita");
    expect(step()).toBe("Step 3 of 8");

    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Continue"));
    // A writer has two questions left, then W3, then the character: seven.
    expect(step()).toBe("Step 4 of 7");
    await fireEvent.press(view.getByText("Short stories"));
    await fireEvent.press(view.getByText("Continue"));
    expect(step()).toBe("Step 5 of 7");

    // Back to purpose, switch to reading: three questions left, so eight.
    await fireEvent.press(view.getByLabelText("Back"));
    await fireEvent.press(view.getByLabelText("Back"));
    await fireEvent.press(view.getByText("Reading"));
    await fireEvent.press(view.getByText("Continue"));
    expect(step()).toBe("Step 4 of 8");
    await fireEvent.press(view.getByText("A mix of both"));
    await fireEvent.press(view.getByText("Continue"));
    expect(step()).toBe("Step 5 of 8");
    await fireEvent.press(view.getByText("Something quick"));
    await fireEvent.press(view.getByText("Continue"));
    expect(step()).toBe("Step 6 of 8");
  });

  it("forgets the old purpose's answers when the purpose changes", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );
    await answerNameAndGenres(view, "Nikita");
    await fireEvent.press(view.getByText("Reading"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Reading them myself"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Something emotional"));

    // Back to the purpose and change the answer.
    await fireEvent.press(view.getByLabelText("Back"));
    await fireEvent.press(view.getByLabelText("Back"));
    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Continue"));
    // The reader's "read" key must not light the writer's Continue.
    expect(
      view.getByLabelText("Continue").props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(view.getByText("A full novel"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Plan chapters"));
    await fireEvent.press(view.getByText("Continue"));

    // No mood rides out with a writer, and Home draws no Tonight rail for them.
    expect(onCharacterPath).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "write",
        onboarding: expect.objectContaining({
          refine: ["novel"],
          mood: [],
          moment: ["chapters"],
        }),
      }),
    );
  });

  it("marks the chosen option with a check and leaves the others bare", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );
    await answerNameAndGenres(view, "Nikita");

    const reading = view.getByLabelText("Reading");
    expect(reading.props.accessibilityState.selected).toBe(false);
    await fireEvent.press(reading);
    expect(view.getByLabelText("Reading").props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText("Writing").props.accessibilityState.selected).toBe(false);
    // Selected: the peach fill and the accent border, on a card whose border
    // was already there in the surface colour so nothing moves.
    const selected = StyleSheet.flatten(view.getByLabelText("Reading").props.style) as {
      backgroundColor?: string;
      borderColor?: string;
      borderWidth?: number;
    };
    const bare = StyleSheet.flatten(view.getByLabelText("Writing").props.style) as {
      backgroundColor?: string;
      borderColor?: string;
      borderWidth?: number;
    };
    expect(selected.backgroundColor).toBe(colors.accentSoft);
    expect(selected.borderColor).toBe(colors.accent);
    expect(bare.backgroundColor).toBe(colors.surface);
    expect(bare.borderColor).toBe(colors.surface);
    expect(selected.borderWidth).toBe(bare.borderWidth);
  });

  it("hands a both-purpose reader through the same exit", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );

    await answerNameAndGenres(view, "Dev");
    await fireEvent.press(view.getByText("A bit of both"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Balance both"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Read, then remix"));
    // One label on the last question for every purpose. "Build my profile"
    // pointed at a screen that no longer exists.
    expect(view.queryByText("Build my profile")).toBeNull();
    await fireEvent.press(view.getByText("Continue"));

    expect(onCharacterPath).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "both",
        initialGenre: "mystery",
      }),
    );
  });

  it("gates the genre screen's Continue button on MIN_GENRE_SELECTIONS, and states that same number in the helper copy", async () => {
    expect(MIN_GENRE_SELECTIONS).toBe(3);

    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );
    await fireEvent.changeText(
      view.getByPlaceholderText("Your first name"),
      "Nikita",
    );
    await fireEvent.press(view.getByText("Continue"));

    // The helper copy and the zero-selection CTA both name the constant, not
    // a hardcoded number that could drift from it.
    expect(
      view.getByText(
        `Pick at least ${MIN_GENRE_SELECTIONS} and we'll build your shelf around them.`,
      ),
    ).toBeTruthy();
    expect(view.getByText(`Pick at least ${MIN_GENRE_SELECTIONS}`)).toBeTruthy();

    await fireEvent.press(view.getByLabelText("Mystery genre"));
    await fireEvent.press(view.getByLabelText("Fantasy genre"));
    // One short of the threshold: the CTA counts down, it does not enable.
    expect(view.getByText("Pick 1 more")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("Adventure genre"));
    expect(
      view.getByText(`Continue with ${MIN_GENRE_SELECTIONS}`),
    ).toBeTruthy();
  });

  it("offers the Create picker's genres by label, and none of the invented ones", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );
    await fireEvent.changeText(
      view.getByPlaceholderText("Your first name"),
      "Nikita",
    );
    await fireEvent.press(view.getByText("Continue"));

    for (const genre of EXPECTED_GENRES) {
      // The VISIBLE label is Explore's `genreChipLabel` - emoji and name -
      // so one taxonomy reads the same in both places. The ACCESSIBILITY
      // label stays the plain name, because a screen reader announcing
      // "dragon Fantasy genre" is worse than "Fantasy genre"; every query in
      // this file goes through `getByLabelText` for that reason.
      expect(view.getByLabelText(`${genreLabels[genre]} genre`)).toBeTruthy();
      expect(view.getByText(genreChipLabel(genre))).toBeTruthy();
      expect(genreChipLabel(genre)).not.toBe(genreLabels[genre]);
    }
    expect(view.queryByText("Other")).toBeNull();
    expect(view.queryByText("Cozy Fantasy")).toBeNull();
    expect(view.queryByText("Paranormal Romance")).toBeNull();
    // The free-text genre went with "Other": there was nothing downstream
    // that could read it.
    expect(view.queryByPlaceholderText("Tell us your genre")).toBeNull();
  });

  it("toggles a chip's selected state on and back off", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );
    await fireEvent.changeText(
      view.getByPlaceholderText("Your first name"),
      "Nikita",
    );
    await fireEvent.press(view.getByText("Continue"));

    const horror = view.getByLabelText("Horror genre");
    expect(horror.props.accessibilityState.selected).toBe(false);
    await fireEvent.press(horror);
    expect(
      view.getByLabelText("Horror genre").props.accessibilityState.selected,
    ).toBe(true);
    await fireEvent.press(view.getByLabelText("Horror genre"));
    expect(
      view.getByLabelText("Horror genre").props.accessibilityState.selected,
    ).toBe(false);
  });

  it("sends genres App.tsx can map back to ids, and the first pick as the id", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );

    await answerNameAndGenres(view, "Nikita");
    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Short stories"));
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Plan chapters"));
    await fireEvent.press(view.getByText("Continue"));

    const payload = onCharacterPath.mock.calls[0][0];
    // `App.tsx`'s `toGenreKeys` is a case-insensitive lookup in `genreLabels`.
    // Every label sent must survive it, or the first shelf comes back empty.
    const byLabel = new Map(
      Object.entries(genreLabels).map(([id, label]) => [
        label.toLowerCase(),
        id,
      ]),
    );
    expect(
      payload.onboarding.genres.map((label: string) =>
        byLabel.get(label.trim().toLowerCase())
      ),
    ).toEqual(["mystery", "fantasy", "adventure"]);
    expect(payload.initialGenre).toBe("mystery");
  });

  it("keeps the answers when you go back a screen", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );

    await answerNameAndGenres(view, "Nikita");
    await fireEvent.press(view.getByLabelText("Back"));

    // The three picks survive: back is a navigation, not a reset.
    expect(
      view.getByText(`Continue with ${MIN_GENRE_SELECTIONS}`),
    ).toBeTruthy();
  });

  /*
    The questionnaire used to draw the app-wide 64pt primary, so the button
    changed size halfway through onboarding. Pinned against the token rather
    than against a number, so the day the button moves, every screen moves
    with it.

    THIS USED TO ASSERT THE OPPOSITE. It read `not.toBe(primaryCtaHeight)`,
    which was the two-recipe system's guard: onboarding at 56, the app at 64,
    and the test standing between them. The split is over -- there is one
    button, and `onboardingCtaHeight` is now an alias of
    `primaryCtaHeight` -- so that assertion could only ever fail, and
    deleting it would have left the screen with nothing checking it at all.
    What replaces it says the thing that is now true and that a regression
    would break: this screen draws no button of its own, it draws the shared
    one.
  */
  it("draws the one shared button, not a local copy", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );

    const cta = StyleSheet.flatten(
      view.getByLabelText("Continue").props.style,
    ) as { minHeight?: number; borderRadius?: number };
    // `minHeight`, not `height`: see the note in Button.tsx about labels
    // that are a whole sentence. The floor is what the geometry promises.
    expect(cta.minHeight).toBe(controls.primaryCtaHeight);
    expect(cta.minHeight).toBe(controls.onboardingCtaHeight);
    expect(cta.borderRadius).toBe(radius.pill);
    // And it came from `Button`, which is the assertion with teeth: a screen
    // that grows its own CTA again would satisfy the numbers above by copying
    // them, and would fail this.
    expect(cta.minHeight).toBe(BUTTON_RECIPE.lg);
    expect(cta.borderRadius).toBe(BUTTON_RECIPE.radius);
  });
});

/*
  2026-09-25: the writer's two questions and the reader's mood and routine
  take several answers. Purpose never does: it decides which screens follow,
  and two purposes at once would leave the next screen undefined.
*/
describe("multi-select questions", () => {
  it("takes several answers exactly where the contract says, and one everywhere else", () => {
    expect(selectionFor("purpose", "")).toBe("single");
    for (const purpose of ["read", "write", "both"] as const) {
      expect(selectionFor("purpose", purpose)).toBe("single");
    }
    expect(selectionFor("refine", "write")).toBe("multi");
    expect(selectionFor("moment", "write")).toBe("multi");
    expect(selectionFor("mood", "read")).toBe("multi");
    expect(selectionFor("moment", "read")).toBe("multi");
    // One option of each is the combination, or the question asks for one.
    expect(selectionFor("refine", "read")).toBe("single");
    expect(selectionFor("refine", "both")).toBe("single");
    expect(selectionFor("moment", "both")).toBe("single");
  });

  it("keeps tap order, toggles off, and treats an exclusive option as a whole answer", () => {
    let answer: string[] = [];
    answer = toggleAnswer(answer, "emotional", "multi", MOODS);
    answer = toggleAnswer(answer, "escape", "multi", MOODS);
    expect(answer).toEqual(["emotional", "escape"]);
    answer = toggleAnswer(answer, "emotional", "multi", MOODS);
    expect(answer).toEqual(["escape"]);
    // Surprise me clears the rest; a real mood clears Surprise me.
    answer = toggleAnswer(answer, "surprise", "multi", MOODS);
    expect(answer).toEqual(["surprise"]);
    answer = toggleAnswer(answer, "quick", "multi", MOODS);
    expect(answer).toEqual(["quick"]);
    // Single-select replaces, and a second tap keeps the choice.
    expect(toggleAnswer(["a"], "b", "single", [])).toEqual(["b"]);
    expect(toggleAnswer(["b"], "b", "single", [])).toEqual(["b"]);
  });

  it("lets a writer pick several formats and several blockers, in tap order", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );
    await answerNameAndGenres(view, "Nikita");
    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Continue"));

    expect(view.getByText("What do you want to write?")).toBeTruthy();
    expect(view.getByText("Pick as many as you like.")).toBeTruthy();
    // Announced as checkboxes, so the kind of question is known before a tap.
    expect(view.getByLabelText("Poetry and verse").props.accessibilityRole).toBe(
      "checkbox",
    );
    await fireEvent.press(view.getByText("Poetry and verse"));
    await fireEvent.press(view.getByText("Short stories"));
    await fireEvent.press(view.getByText("Fan fiction"));
    await fireEvent.press(view.getByText("Fan fiction"));
    expect(
      view.getByLabelText("Poetry and verse").props.accessibilityState.checked,
    ).toBe(true);
    expect(
      view.getByLabelText("Short stories").props.accessibilityState.checked,
    ).toBe(true);
    expect(
      view.getByLabelText("Fan fiction").props.accessibilityState.checked,
    ).toBe(false);
    await fireEvent.press(view.getByText("Continue"));

    expect(view.getByText("What usually stops you?")).toBeTruthy();
    await fireEvent.press(view.getByText("Plan chapters"));
    await fireEvent.press(view.getByText("Rewrite in my voice"));
    // Taking every answer back disables Continue again.
    await fireEvent.press(view.getByText("Plan chapters"));
    await fireEvent.press(view.getByText("Rewrite in my voice"));
    expect(
      view.getByLabelText("Continue").props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(view.getByText("Rewrite in my voice"));
    await fireEvent.press(view.getByText("Plan chapters"));

    // Back and forward again restores both lists as they were.
    await fireEvent.press(view.getByLabelText("Back"));
    expect(
      view.getByLabelText("Short stories").props.accessibilityState.checked,
    ).toBe(true);
    await fireEvent.press(view.getByText("Continue"));
    await fireEvent.press(view.getByText("Continue"));

    expect(onCharacterPath).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "write",
        onboarding: expect.objectContaining({
          refine: ["poetry", "short"],
          mood: [],
          moment: ["voice", "chapters"],
        }),
      }),
    );
  });

  it("lets a reader give several reasons, and keeps purpose and how-to-read single", async () => {
    const onCharacterPath = jest.fn();
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={onCharacterPath} />,
    );
    await answerNameAndGenres(view, "Mira");

    // Purpose routes, so a second tap replaces rather than adds.
    expect(view.getByLabelText("Reading").props.accessibilityRole).toBe("radio");
    await fireEvent.press(view.getByText("Writing"));
    await fireEvent.press(view.getByText("Reading"));
    expect(view.getByLabelText("Writing").props.accessibilityState.checked).toBe(
      false,
    );
    expect(view.queryByText("Pick as many as you like.")).toBeNull();
    await fireEvent.press(view.getByText("Continue"));

    await fireEvent.press(view.getByText("Reading them myself"));
    await fireEvent.press(view.getByText("Listening to audio"));
    await fireEvent.press(view.getByText("Continue"));

    expect(view.getByText("Pick as many as you like.")).toBeTruthy();
    await fireEvent.press(view.getByText("Something that keeps me guessing"));
    await fireEvent.press(view.getByText("Something emotional"));
    await fireEvent.press(view.getByText("Continue"));

    await fireEvent.press(view.getByText("Before bed"));
    await fireEvent.press(view.getByText("Weekends"));
    await fireEvent.press(view.getByText("Continue"));

    expect(onCharacterPath).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "read",
        onboarding: expect.objectContaining({
          refine: ["listen"],
          mood: ["guessing", "emotional"],
          moment: ["sleep", "weekend"],
        }),
      }),
    );
  });
});

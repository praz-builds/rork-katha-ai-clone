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
import { StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

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
} from "@/screens/KathaOnboardingFlowV2";
import { genreChipLabel } from "@/components/explore/GenreStrip";
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
        refine: "novel",
        mood: "",
        moment: "chapters",
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
        refine: "listen",
        mood: "emotional",
        moment: "sleep",
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
          refine: "read",
          mood: "surprise",
          moment: "",
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
          refine: "novel",
          mood: "",
          moment: "chapters",
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
    than against 56, so the day the pill moves, every screen moves with it.
  */
  it("draws the shared onboarding pill, not the app-wide primary", async () => {
    const view = await render(
      <KathaOnboardingFlowV2 onCharacterPath={jest.fn()} />,
    );

    const cta = StyleSheet.flatten(
      view.getByLabelText("Continue").props.style,
    ) as { height?: number; borderRadius?: number };
    expect(cta.height).toBe(controls.onboardingCtaHeight);
    expect(cta.height).not.toBe(controls.primaryCtaHeight);
    expect(cta.borderRadius).toBe(radius.pill);
  });
});

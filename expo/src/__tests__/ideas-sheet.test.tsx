import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

const mockGenerateStory = jest.fn();
const mockInferStoryBrief = jest.fn();
const mockLoadDraft = jest.fn();

jest.mock("@/lib/api", () => {
  class MockGenerationRequestError extends Error {
    resetRequestId = false;
  }
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    generateStoryStreaming: (...args: unknown[]) => mockGenerateStory(...args),
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
    generateCharacterImage: jest.fn(),
    continueStoryStreaming: jest.fn(),
    createGenerationRequestId: () => "ideas-sheet-test-request",
    editParagraphStreaming: jest.fn(),
    publishStory: jest.fn(),
    GenerationRequestError: MockGenerationRequestError,
  };
});

jest.mock("@/lib/draft-storage", () => ({
  loadDraft: () => mockLoadDraft(),
  saveDraft: jest.fn(),
  clearDraft: jest.fn(),
}));

jest.mock("@/components/GeneratingOverlay", () => () => null);

jest.mock("@/components/KathaPrimitives", () => {
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

/* eslint-disable import/first */
import { IdeasSheet } from "@/components/create/IdeasSheet";
import CreateStudioScreen from "@/screens/CreateStudioScreen";
// The starter copy belongs to the content module and gets rewritten there.
// Keying off the module tests what the sheet does with it rather than testing
// the sentences.
import { GENRE_STARTERS } from "@/lib/genre-content";
import { genreLabels } from "@/theme";
import { GENRES } from "@/types/domain";
/* eslint-enable import/first */

beforeEach(() => {
  mockGenerateStory.mockReset();
  mockInferStoryBrief.mockReset().mockResolvedValue({
    genres: ["fantasy"],
    whereAndWhen: "",
    characters: [],
    suggestedMoments: [],
  });
  mockLoadDraft.mockReset().mockResolvedValue(null);
});

describe("the ideas sheet", () => {
  it("shows nothing until it is opened", async () => {
    const view = await render(
      <IdeasSheet visible={false} genre="mystery" onClose={jest.fn()} onPick={jest.fn()} />,
    );
    for (const starter of GENRE_STARTERS.mystery) {
      expect(view.queryByText(starter)).toBeNull();
    }
  });

  it("shows the starters for the genre it was given, and no other genre's", async () => {
    const view = await render(
      <IdeasSheet visible genre="mystery" onClose={jest.fn()} onPick={jest.fn()} />,
    );

    expect(view.getByText(`🔍 ${genreLabels.mystery} ideas`)).toBeTruthy();
    for (const starter of GENRE_STARTERS.mystery) {
      // Never truncated: a clipped starter teaches nothing about what a usable
      // idea looks like, which is most of why the starters exist.
      expect(view.getByText(starter).props.numberOfLines).toBeUndefined();
    }
    for (const starter of GENRE_STARTERS.romance) {
      expect(view.queryByText(starter)).toBeNull();
    }
  });

  it("follows the genre chip when it changes rather than keeping the first list", async () => {
    const view = await render(
      <IdeasSheet visible genre="mystery" onClose={jest.fn()} onPick={jest.fn()} />,
    );
    await view.rerender(
      <IdeasSheet visible genre="horror" onClose={jest.fn()} onPick={jest.fn()} />,
    );

    for (const starter of GENRE_STARTERS.horror) {
      expect(view.getByText(starter)).toBeTruthy();
    }
    for (const starter of GENRE_STARTERS.mystery) {
      expect(view.queryByText(starter)).toBeNull();
    }
  });

  it("hands back the starter that was tapped, once, with no confirm step", async () => {
    const onPick = jest.fn();
    const view = await render(
      <IdeasSheet visible genre="horror" onClose={jest.fn()} onPick={onPick} />,
    );

    const chosen = GENRE_STARTERS.horror[1];
    await fireEvent.press(view.getByLabelText(`Use idea: ${chosen}`));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(chosen);
  });

  it("can be left without choosing, from the close button and from the scrim", async () => {
    const onClose = jest.fn();
    const onPick = jest.fn();
    const view = await render(
      <IdeasSheet visible genre="fantasy" onClose={onClose} onPick={onPick} />,
    );

    // Two ways out, and neither of them chooses anything: the named close
    // button, and the scrim over the brief the writer came from. (The third,
    // hardware back, is the Modal's own `onRequestClose`.) The scrim is
    // queried by testID with hidden elements included because the sheet
    // declares `accessibilityViewIsModal`, which is exactly what should
    // remove a backdrop from a screen reader's reach -- the close button is
    // the exit that reader gets.
    await fireEvent.press(view.getByRole("button", { name: "Close ideas" }));
    await fireEvent.press(view.getByTestId("ideas-scrim", { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("has starters for every genre the picker can land on", () => {
    // `GENRE_STARTERS` is a Record<Genre, string[]>, so this cannot silently
    // go empty -- but a genre could still be given a stub of one.
    for (const genre of GENRES) {
      expect(GENRE_STARTERS[genre].length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the brief's View ideas control", () => {
  it("replaces the inline rail: no starter is on the screen until it is opened", async () => {
    const view = await render(
      <CreateStudioScreen
        credits={12}
        isAnonymous
        onGenerationStarted={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await view.findByLabelText("Story idea");

    expect(view.queryByText("Try one")).toBeNull();
    for (const starter of GENRE_STARTERS.fantasy) {
      expect(view.queryByText(starter)).toBeNull();
    }
    expect(view.getByRole("button", { name: "View Fantasy ideas" })).toBeTruthy();
  });

  it("opens on the current genre, and a pick fills the idea box", async () => {
    const view = await render(
      <CreateStudioScreen
        credits={12}
        isAnonymous
        onGenerationStarted={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await view.findByLabelText("Story idea");

    await fireEvent.press(view.getByRole("button", { name: "View Fantasy ideas" }));
    const chosen = GENRE_STARTERS.fantasy[0];
    await view.findByText(chosen);

    await fireEvent.press(view.getByLabelText(`Use idea: ${chosen}`));

    await waitFor(() =>
      expect(view.getByLabelText("Story idea").props.value).toBe(chosen),
    );
    // Decisive: the sheet is gone on the tap, not waiting for a confirm.
    expect(view.queryByLabelText(`Use idea: ${chosen}`)).toBeNull();
  });

  it("offers the new genre's ideas after the genre chip changes", async () => {
    const view = await render(
      <CreateStudioScreen
        credits={12}
        isAnonymous
        onGenerationStarted={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await view.findByLabelText("Story idea");

    await fireEvent.press(view.getByRole("button", { name: "Genre" }));
    await fireEvent.press(view.getByRole("button", { name: "Choose Horror" }));

    await fireEvent.press(
      await view.findByRole("button", { name: "View Horror ideas" }),
    );
    for (const starter of GENRE_STARTERS.horror) {
      expect(view.getByText(starter)).toBeTruthy();
    }
    for (const starter of GENRE_STARTERS.fantasy) {
      expect(view.queryByText(starter)).toBeNull();
    }
  });

  it("closes without touching the idea the writer already typed", async () => {
    const view = await render(
      <CreateStudioScreen
        credits={12}
        isAnonymous
        onGenerationStarted={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    const idea = await view.findByLabelText("Story idea");
    await fireEvent.changeText(idea, "A lighthouse keeper gets a letter from tomorrow.");

    await fireEvent.press(view.getByRole("button", { name: "View Fantasy ideas" }));
    await view.findByText(GENRE_STARTERS.fantasy[0]);
    await fireEvent.press(view.getByTestId("ideas-scrim", { includeHiddenElements: true }));

    await waitFor(() => expect(view.queryByText(GENRE_STARTERS.fantasy[0])).toBeNull());
    expect(view.getByLabelText("Story idea").props.value).toBe(
      "A lighthouse keeper gets a letter from tomorrow.",
    );
  });
});

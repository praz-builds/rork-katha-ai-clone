import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import {
  PlayerBar,
  SKIP_BACK_MS,
  SKIP_FORWARD_MS,
} from "@/components/listen/PlayerBar";

const BASE = {
  storyTitle: "The Salt Road",
  chapterTitle: "Chapter 2: The Crossing",
  isPlaying: false,
  positionMs: 60_000,
  durationMs: 300_000,
  rate: 1 as const,
  hasNextChapter: true,
};

async function renderBar(overrides: Partial<React.ComponentProps<typeof PlayerBar>> = {}) {
  const handlers = {
    onTogglePlay: jest.fn(),
    onSeek: jest.fn(),
    onRateChange: jest.fn(),
    onChapters: jest.fn(),
    onNextChapter: jest.fn(),
  };
  const view = await render(<PlayerBar {...BASE} {...handlers} {...overrides} />);
  return { view, ...handlers };
}

describe("what the bar tells you", () => {
  it("names the story and the chapter, and shows elapsed against total", async () => {
    const { view } = await renderBar();
    expect(view.getByText("The Salt Road")).toBeTruthy();
    expect(view.getByText("Chapter 2: The Crossing")).toBeTruthy();
    expect(view.getByText("1:00")).toBeTruthy();
    expect(view.getByText("5:00")).toBeTruthy();
  });

  it("refuses to invent a total it has not measured", async () => {
    const { view } = await renderBar({ durationMs: 0 });
    expect(view.getByText("--:--")).toBeTruthy();
  });
});

describe("transport", () => {
  it("labels the control Play while paused", async () => {
    const { view, onTogglePlay } = await renderBar();
    await fireEvent.press(view.getByLabelText("Play narration"));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("labels the control Pause while playing", async () => {
    const { view, onTogglePlay } = await renderBar({ isPlaying: true });
    await fireEvent.press(view.getByLabelText("Pause narration"));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("skips back ten and forward thirty, the asymmetric pair", async () => {
    const { view, onSeek } = await renderBar();
    await fireEvent.press(view.getByLabelText("Skip back 10 seconds"));
    expect(onSeek).toHaveBeenLastCalledWith(60_000 - SKIP_BACK_MS);

    await fireEvent.press(view.getByLabelText("Skip forward 30 seconds"));
    expect(onSeek).toHaveBeenLastCalledWith(60_000 + SKIP_FORWARD_MS);
  });

  it("clamps a skip back to the start of the file", async () => {
    const { view, onSeek } = await renderBar({ positionMs: 2_000 });
    await fireEvent.press(view.getByLabelText("Skip back 10 seconds"));
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it("clamps a skip forward to the end of the file", async () => {
    const { view, onSeek } = await renderBar({ positionMs: 295_000 });
    await fireEvent.press(view.getByLabelText("Skip forward 30 seconds"));
    expect(onSeek).toHaveBeenLastCalledWith(300_000);
  });
});

describe("the scrubber", () => {
  it("maps a touch across the measured track to a time", async () => {
    const { view, onSeek } = await renderBar();
    const track = view.getByTestId("listen-scrubber");
    await fireEvent(track, "layout", { nativeEvent: { layout: { width: 200, height: 44 } } });
    await fireEvent(track, "responderGrant", { nativeEvent: { locationX: 50 } });
    expect(onSeek).toHaveBeenLastCalledWith(75_000);
  });

  it("does nothing at all before layout has given it a width", async () => {
    const { view, onSeek } = await renderBar();
    await fireEvent(view.getByTestId("listen-scrubber"), "responderGrant", {
      nativeEvent: { locationX: 50 },
    });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("is an adjustable with a stepper path, because a drag is not a gesture VoiceOver can make", async () => {
    const { view, onSeek } = await renderBar();
    const track = view.getByTestId("listen-scrubber");
    expect(track.props.accessibilityRole).toBe("adjustable");
    expect(track.props.accessibilityValue.text).toBe("1:00 of 5:00");

    await fireEvent(track, "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeGreaterThan(60_000);
  });
});

describe("speed", () => {
  it("shows the current rate and opens the options on demand", async () => {
    const { view, onRateChange } = await renderBar();
    expect(view.queryByTestId("listen-speed-options")).toBeNull();

    await fireEvent.press(view.getByLabelText("Playback speed, currently 1x"));
    expect(view.getByTestId("listen-speed-options")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("Playback speed 1.5x"));
    expect(onRateChange).toHaveBeenCalledWith(1.5);
    // Choosing closes the row again.
    expect(view.queryByTestId("listen-speed-options")).toBeNull();
  });
});

describe("chapters", () => {
  it("opens the chapter list", async () => {
    const { view, onChapters } = await renderBar();
    await fireEvent.press(view.getByLabelText("Chapter list"));
    expect(onChapters).toHaveBeenCalledTimes(1);
  });

  it("disables Next on the last chapter instead of hiding it", async () => {
    const { view, onNextChapter } = await renderBar({ hasNextChapter: false });
    const next = view.getByLabelText("Next chapter");
    expect(next.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(next);
    expect(onNextChapter).not.toHaveBeenCalled();
  });

  it("moves to the next chapter when there is one", async () => {
    const { view, onNextChapter } = await renderBar();
    await fireEvent.press(view.getByLabelText("Next chapter"));
    expect(onNextChapter).toHaveBeenCalledTimes(1);
  });
});

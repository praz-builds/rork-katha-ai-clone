/**
 * "Where does it begin?" must tell a failed lookup from an empty answer.
 *
 * On 2026-09-24 the founder reached this screen with no chips and the line
 * "Katha has no opening to suggest for this idea yet". Production showed the
 * server had never been asked: no rate-limit claim for that account, no
 * `error_events` row, and the same idea shaped in 7s with three beats when
 * called directly. The client had swallowed a failed call into `null`, and
 * `null` rendered as "nothing to suggest" -- an answer, with no way to ask
 * again and nothing logged.
 *
 * These pin the three outcomes apart:
 *  - the call failed      -> the failed copy, a Retry, and a client log
 *  - the model had nothing -> the honest "no opening" copy, no Retry
 *  - the converter refused every beat -> "no opening", and that is logged
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockInferStoryBrief = jest.fn();
const mockCaptureError = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    inferStoryBrief: (...args: unknown[]) => mockInferStoryBrief(...args),
  };
});

jest.mock("@/lib/analytics", () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

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

jest.mock("@/components/KathaPrimitives", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    CreditPill: ({ credits }: { credits: number }) =>
      React.createElement(Text, null, `${credits} credits`),
  };
});

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/* eslint-disable import/first */
import DirectionStep, {
  resolveOpeningDirections,
  type DirectionBrief,
} from "@/components/create/DirectionStep";
import { StoryShapeRequestError } from "@/lib/api";
import { toDirection } from "@/lib/directions";
/* eslint-enable import/first */

const brief: DirectionBrief = {
  seed: "A lighthouse keeper finds letters about a shipwreck nobody will discuss.",
  primaryGenre: "mystery",
  characters: [],
  moments: [],
  writingStyle: undefined,
  avoid: undefined,
  chapterLength: "standard",
  plannedChapterCount: 3,
};

const BEATS = [
  "She finds her grandmother's hidden letters in the lamp room.",
  "She questions villagers about the night of the wreck.",
  "She learns what happened to the ship.",
];

function shapeWith(beats: string[]) {
  return { genres: ["mystery"], characters: [], suggestedMoments: [], beats };
}

async function renderStep() {
  return await render(
    <DirectionStep brief={brief} credits={9} onStart={jest.fn()} onBack={jest.fn()} />,
  );
}

beforeEach(() => {
  mockInferStoryBrief.mockReset();
  mockCaptureError.mockReset();
  mockTrackEvent.mockReset();
});

describe("resolveOpeningDirections", () => {
  it("asks shaping to throw, so a failed call cannot pass for an empty one", async () => {
    mockInferStoryBrief.mockResolvedValue(shapeWith(BEATS));
    await resolveOpeningDirections(brief);
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);
    expect(mockInferStoryBrief.mock.calls[0][4]).toEqual({ throwOnError: true });
  });

  it("rejects when shaping fails", async () => {
    mockInferStoryBrief.mockRejectedValue(
      new StoryShapeRequestError("boom", true, "provider_failed"),
    );
    await expect(resolveOpeningDirections(brief)).rejects.toBeInstanceOf(
      StoryShapeRequestError,
    );
  });

  it("counts every beat the converter refuses", async () => {
    // Do-support questions are refused by design: "Does she know" cannot be
    // turned into an instruction without conjugating a verb.
    const refused = ["Does she know the keeper?", "Did the ship sink?"];
    expect(refused.map((beat) => toDirection(beat))).toEqual([null, null]);
    mockInferStoryBrief.mockResolvedValue(shapeWith([...refused, BEATS[0]]));
    const resolved = await resolveOpeningDirections(brief);
    expect(resolved.dropped).toBe(2);
    expect(resolved.options).toHaveLength(1);
  });
});

describe("DirectionStep", () => {
  it("shows the failed state with Retry when the lookup fails, and Retry brings the chips", async () => {
    // Behaves as the real `inferStoryBrief` does on a failed call: it throws
    // only when asked to, and otherwise hands back `null` -- which is exactly
    // the swallow this screen used to render as "no opening to suggest".
    mockInferStoryBrief.mockImplementationOnce(
      (...args: unknown[]) =>
        (args[4] as { throwOnError?: boolean } | undefined)?.throwOnError
          ? Promise.reject(
            new StoryShapeRequestError("offline", true, "provider_failed"),
          )
          : Promise.resolve(null),
    );
    const view = await renderStep();

    await view.findByText(/We couldn't load suggested openings/);
    expect(view.queryByText(/no opening to suggest/)).toBeNull();
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "opening_directions_failed",
        context: { reason: "provider_failed", attempt: 0 },
      }),
    );

    mockInferStoryBrief.mockResolvedValueOnce(shapeWith(BEATS));
    await fireEvent.press(view.getByTestId("create-direction-retry"));

    await view.findByTestId("create-direction-option-0");
    expect(view.getByText(String(toDirection(BEATS[0])))).toBeTruthy();
    expect(view.queryByTestId("create-direction-retry")).toBeNull();
    expect(mockInferStoryBrief).toHaveBeenCalledTimes(2);
  });

  it("says there is no opening when the model genuinely had none, with no Retry and no log", async () => {
    mockInferStoryBrief.mockResolvedValue(shapeWith([]));
    const view = await renderStep();

    await view.findByText(/Katha has no opening to suggest for this idea yet/);
    expect(view.queryByTestId("create-direction-retry")).toBeNull();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("logs, counts only, when every beat the model planned is dropped", async () => {
    mockInferStoryBrief.mockResolvedValue(
      shapeWith(["Does she know the keeper?", "Did the ship sink?"]),
    );
    const view = await renderStep();

    await view.findByText(/Katha has no opening to suggest for this idea yet/);
    expect(view.queryByTestId("create-direction-retry")).toBeNull();
    await waitFor(() =>
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "opening_directions_all_dropped",
          context: { beats: 2, dropped: 2 },
        }),
      )
    );
  });

  it("holds Retry for a moment after a rate-limit refusal", async () => {
    jest.useFakeTimers();
    try {
      mockInferStoryBrief.mockRejectedValueOnce(
        new StoryShapeRequestError("busy", false, "rate_limited"),
      );
      const view = await renderStep();

      await view.findByText(/shaping a lot of stories right now/);
      expect(view.getByText("Try again in a moment")).toBeTruthy();
      await fireEvent.press(view.getByTestId("create-direction-retry"));
      // Disabled: an instant retry would be refused by the same window.
      expect(mockInferStoryBrief).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      expect(view.getByText("Try again")).toBeTruthy();
      mockInferStoryBrief.mockResolvedValueOnce(shapeWith(BEATS));
      await fireEvent.press(view.getByTestId("create-direction-retry"));
      expect(mockInferStoryBrief).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

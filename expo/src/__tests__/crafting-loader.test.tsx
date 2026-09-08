import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";

jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;
  return {
    __esModule: true,
    // `createAnimatedComponent` and the four symbols below it are here for the
    // KathaMark the loader centres, not for the loader itself. This file's
    // subject uses only some of them; its child uses the rest, and a mock that
    // omits them fails the suite at import time rather than at an assertion.
    default: {
      View,
      createAnimatedComponent: (component: unknown) => component,
    },
    cancelAnimation: jest.fn(),
    Easing: {
      linear: passthrough,
      inOut: () => passthrough,
      out: () => passthrough,
      quad: passthrough,
      cubic: passthrough,
    },
    interpolate: () => 1,
    runOnJS: (fn: unknown) => fn,
    useAnimatedProps: (factory: () => unknown) => factory(),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withDelay: (_delay: number, value: unknown) => value,
    // Jest mocks rather than bare passthroughs, so a test can assert that
    // reduced motion schedules nothing at all. Reached through
    // `jest.requireMock` below: a factory may not close over a variable this
    // file declares.
    withRepeat: jest.fn(passthrough),
    withTiming: jest.fn(passthrough),
  };
});

jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: props.testID ?? name });
    Component.displayName = name;
    return Component;
  };
  return {
    __esModule: true,
    default: stub("Svg"),
    Svg: stub("Svg"),
    Circle: stub("Circle"),
    Defs: stub("Defs"),
    Path: stub("Path"),
    Pattern: stub("Pattern"),
    Rect: stub("Rect"),
  };
});

/* eslint-disable import/first */
import {
  AUTO_CYCLE_MS,
  CRAFTING_STAGES,
  CraftingLoader,
} from "@/components/create/CraftingLoader";
/* eslint-enable import/first */

const reanimated = jest.requireMock("react-native-reanimated") as {
  withRepeat: jest.Mock;
  withTiming: jest.Mock;
};

let reduceMotion = false;

beforeEach(() => {
  jest.clearAllMocks();
  reduceMotion = false;
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(() => Promise.resolve(reduceMotion));
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: jest.fn() } as never);
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CraftingLoader", () => {
  it("names the stage it is on, and reports it as a progressbar", async () => {
    const view = await render(<CraftingLoader stage={1} />);
    const root = view.getByRole("progressbar");
    expect(root.props.accessibilityLabel).toBe("Crafting your story");
    expect(root.props.accessibilityValue).toEqual({
      min: 0,
      max: CRAFTING_STAGES.length,
      now: 2,
      text: "Understanding the character",
    });
    // The name is on the screen as well as in the value: the label is what a
    // sighted user reads, and the two must never drift apart.
    expect(view.getByText("Understanding the character")).toBeTruthy();
  });

  it("clamps a stage index that runs off either end of the list", async () => {
    const high = await render(<CraftingLoader stage={99} />);
    expect(
      high.getByRole("progressbar").props.accessibilityValue.text,
    ).toBe(CRAFTING_STAGES[CRAFTING_STAGES.length - 1].label);

    const low = await render(<CraftingLoader stage={-5} />);
    expect(low.getByRole("progressbar").props.accessibilityValue.text).toBe(
      CRAFTING_STAGES[0].label,
    );
  });

  it("reports a measured position only when it has one", async () => {
    const measured = await render(<CraftingLoader stage={1} />);
    expect(measured.getByRole("progressbar").props.accessibilityValue).toEqual({
      min: 0,
      max: CRAFTING_STAGES.length,
      now: 2,
      text: CRAFTING_STAGES[1].label,
    });

    const cycling = await render(<CraftingLoader autoCycle />);
    // A cycled headline is elapsed time through named stages, not measurement,
    // so a screen reader is told the stage and never "1 of 4".
    expect(cycling.getByRole("progressbar").props.accessibilityValue).toEqual({
      text: CRAFTING_STAGES[0].label,
    });
  });

  it("keeps the cycled value on the stage the headline is showing", async () => {
    jest.useFakeTimers();
    try {
      const view = await render(<CraftingLoader autoCycle />);
      await act(async () => {
        jest.advanceTimersByTime(AUTO_CYCLE_MS * 2);
      });
      // One clock drives both, so the announced value can never name a
      // different stage than the headline does.
      expect(view.getByText(CRAFTING_STAGES[2].label)).toBeTruthy();
      expect(view.getByRole("progressbar").props.accessibilityValue).toEqual({
        text: CRAFTING_STAGES[2].label,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("cycles at the reference's cadence unless a caller overrides it", async () => {
    jest.useFakeTimers();
    try {
      const view = await render(<CraftingLoader autoCycle />);
      await act(async () => {
        jest.advanceTimersByTime(AUTO_CYCLE_MS - 1);
      });
      expect(view.getByText(CRAFTING_STAGES[0].label)).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(view.getByText(CRAFTING_STAGES[1].label)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("announces each stage change to a screen reader", async () => {
    jest.useFakeTimers();
    try {
      await render(<CraftingLoader autoCycleMs={1000} />);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        CRAFTING_STAGES[1].label,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("cycles the headline on its own timer, and holds at the end", async () => {
    jest.useFakeTimers();
    try {
      const view = await render(<CraftingLoader autoCycleMs={1000} />);
      expect(view.getByText("Getting the context")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(view.getByText("Understanding the character")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      // The wait can outlast the list, and when it does the screen holds on
      // the last stage rather than starting the list again. It used to wrap,
      // and at the 8-11s this screen actually waits that meant the writer
      // re-read a stage they had already been shown - the screen taking back
      // a claim it had just made.
      expect(view.getByText("Building the story arc")).toBeTruthy();
      expect(view.queryByText("Getting the context")).toBeNull();
      // Still held, however long the provider takes.
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
      expect(view.getByText("Building the story arc")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("CraftingLoader under reduced motion", () => {
  it("keeps naming the work, and schedules no animation", async () => {
    reduceMotion = true;
    jest.useFakeTimers();
    try {
      const view = await render(<CraftingLoader autoCycleMs={1000} />);
      // Let the reduce-motion query resolve.
      await act(async () => {});
      reanimated.withRepeat.mockClear();
      reanimated.withTiming.mockClear();

      // Reduced motion is a request about animation, not about information.
      // Freezing the headline leaves the one honest signal on this screen
      // saying "Getting the context" for the whole wait, for exactly the
      // users who have no motion telling them anything is happening.
      expect(view.getByText("Getting the context")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(view.getByText("Understanding the character")).toBeTruthy();
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        "Understanding the character",
      );

      // Nothing moved to get there: no headline cross-fade, and no breath on
      // the mark.
      expect(reanimated.withTiming).not.toHaveBeenCalled();
      expect(reanimated.withRepeat).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

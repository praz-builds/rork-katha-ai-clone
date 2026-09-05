import React from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { act, render } from "@testing-library/react-native";

jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View },
    cancelAnimation: jest.fn(),
    Easing: {
      linear: passthrough,
      inOut: () => passthrough,
      out: () => passthrough,
      quad: passthrough,
      cubic: passthrough,
    },
    interpolate: () => 1,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withRepeat: passthrough,
    withTiming: passthrough,
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

let reduceMotion = false;

function fillWidth(view: Awaited<ReturnType<typeof render>>): string {
  const style = StyleSheet.flatten(
    // The bar is hidden from accessibility on purpose — the stage name is what
    // gets announced — so the query has to opt into hidden elements.
    view.getByTestId("crafting-progress-fill", { includeHiddenElements: true })
      .props.style,
  ) as { width: string };
  return style.width;
}

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
    // The cycled bar is elapsed time through named stages, not measurement, so
    // a screen reader is told the stage and never "2 of 4".
    expect(cycling.getByRole("progressbar").props.accessibilityValue).toEqual({
      text: CRAFTING_STAGES[0].label,
    });
  });

  it("hides the bar entirely when the caller asks it to", async () => {
    const view = await render(
      <CraftingLoader autoCycleMs={1000} showProgress={false} />,
    );
    expect(
      view.queryByTestId("crafting-progress", { includeHiddenElements: true }),
    ).toBeNull();
  });

  it("steps the bar and the headline off one clock while cycling", async () => {
    jest.useFakeTimers();
    try {
      const view = await render(<CraftingLoader autoCycle />);
      // The reference's barFill keyframes: 4% -> 29% -> 54% -> 79% -> 100%.
      expect(view.getByText(CRAFTING_STAGES[0].label)).toBeTruthy();
      expect(fillWidth(view)).toBe("4%");

      for (const [step, label] of [
        [1, CRAFTING_STAGES[1].label],
        [2, CRAFTING_STAGES[2].label],
        [3, CRAFTING_STAGES[3].label],
      ] as const) {
        await act(async () => {
          jest.advanceTimersByTime(AUTO_CYCLE_MS);
        });
        // One clock drives both, so the bar can never name a different stage
        // than the headline does.
        expect(view.getByText(label)).toBeTruthy();
        expect(fillWidth(view)).toBe(`${4 + step * 25}%`);
      }
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

  it("keeps the measured bar on the stage path", async () => {
    const view = await render(<CraftingLoader stage={1} />);
    // Two of four stages done, unchanged by the cycled bar existing.
    expect(fillWidth(view)).toBe("50%");
  });

  it("cycles the headline on its own timer, and wraps", async () => {
    jest.useFakeTimers();
    try {
      const view = await render(
        <CraftingLoader autoCycleMs={1000} showProgress={false} />,
      );
      expect(view.getByText("Getting the context")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(view.getByText("Understanding the character")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      // Four stages, so it is back at the first one rather than stuck at the
      // last: the wait can outlast the list.
      expect(view.getByText("Getting the context")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps naming the work when the user has asked for reduced motion", async () => {
    reduceMotion = true;
    jest.useFakeTimers();
    try {
      const view = await render(
        <CraftingLoader autoCycleMs={1000} showProgress={false} />,
      );
      // Let the reduce-motion query resolve.
      await act(async () => {});
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      // Reduced motion is a request about animation, not about information.
      // Freezing the headline leaves the one honest signal on this screen
      // saying "Getting the context" for the whole wait, for exactly the
      // users who have no spinning ring telling them anything is happening.
      expect(view.getByText("Getting the context")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(view.getByText("Understanding the character")).toBeTruthy();
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        "Understanding the character",
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("CraftingLoader under reduced motion", () => {
  it("still shows the bar's value, it just does not animate to it", async () => {
    reduceMotion = true;
    jest.useFakeTimers();
    try {
      const view = await render(<CraftingLoader autoCycle />);
      await act(async () => {});
      expect(fillWidth(view)).toBe("4%");
      await act(async () => {
        jest.advanceTimersByTime(AUTO_CYCLE_MS);
      });
      expect(view.getByText(CRAFTING_STAGES[1].label)).toBeTruthy();
      expect(fillWidth(view)).toBe("29%");
    } finally {
      jest.useRealTimers();
    }
  });
});

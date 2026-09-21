import React from "react";
import { render } from "@testing-library/react-native";

/**
 * The reduced-motion switch, flipped per test.
 *
* Named `mock*` because babel-plugin-jest-hoist refuses any other out-of-scope
 * reference from inside a `jest.mock` factory.
 *
 * `useReducedMotion` is read once per render, so a module-level flag the mock
 * closes over is enough — no need to remount the accessibility service.
 */
let mockReduceMotion = false;

jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (component: unknown) => component,
    },
    cancelAnimation: jest.fn(),
    // `in`/`out`/`inOut` are curve *wrappers*, so they hand back whatever they
    // were given. The Listen screen's loader draws the Katha mark, which uses
    // them; without these the whole suite fails to load rather than any test
    // failing.
    Easing: {
      bezier: () => passthrough,
      linear: passthrough,
      quad: passthrough,
      in: passthrough,
      out: passthrough,
      inOut: passthrough,
    },
    ReduceMotion: { Never: "never", System: "system" },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => mockReduceMotion,
    // Only `get`/`set` are modelled: the component uses nothing else, and a
    // `value` accessor here trips babel-plugin-jest-hoist's scope analysis.
    useSharedValue: (initial: unknown) => {
      const box: { current: unknown } = { current: initial };
      return {
        get: () => box.current,
        set: (next: unknown) => {
          box.current = next;
        },
      };
    },
    withDelay: (_delay: number, value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});

jest.mock("expo-linear-gradient", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    __esModule: true,
    LinearGradient: (props: Record<string, unknown>) =>
      ReactLocal.createElement(View, { ...props, testID: "linear-gradient" }),
  };
});

jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      ReactLocal.createElement(View, { ...props, testID: props.testID ?? name });
    Component.displayName = name;
    return Component;
  };
  return {
    __esModule: true,
    default: stub("Svg"),
    Svg: stub("Svg"),
    Path: stub("Path"),
    Rect: stub("Rect"),
  };
});

import { NarrationLoader as ListenNarrationLoader } from "@/components/listen/NarrationLoader";
import {
  NARRATION_LOADER_VARIANTS,
  NARRATION_STAGES,
  NarrationLoader,
  narrationMessageFor,
  narrationStageIndex,
} from "@/components/reader/NarrationLoader";

beforeEach(() => {
  mockReduceMotion = false;
});

describe("NarrationLoader", () => {
  it.each(NARRATION_LOADER_VARIANTS)("renders the %s variant", async (variant) => {
    const { getByTestId, getByText } = await render(
      <NarrationLoader variant={variant} stage="generating" />,
    );
    expect(getByTestId("narration-loader")).toBeTruthy();
    expect(getByText("The voice is reading it now")).toBeTruthy();
  });

  it.each(NARRATION_LOADER_VARIANTS)(
    "still renders the %s variant, and its message, with reduced motion on",
    async (variant) => {
      mockReduceMotion = true;
      const { getByTestId, getByText } = await render(
        <NarrationLoader variant={variant} stage="requesting" />,
      );
      expect(getByTestId("narration-loader")).toBeTruthy();
      // The reduced path drops the motion, never the sentence: it is the only
      // thing on this screen that says the wait is progressing.
      expect(getByText("Asking for a reading of this chapter")).toBeTruthy();
    },
  );

  it("reports the stage as a position a screen reader can read", async () => {
    const { getByTestId } = await render(<NarrationLoader stage="finishing" />);
    const root = getByTestId("narration-loader");
    expect(root.props.accessibilityRole).toBe("progressbar");
    expect(root.props.accessibilityValue).toEqual({
      min: 0,
      max: NARRATION_STAGES.length,
      now: NARRATION_STAGES.length,
      text: NARRATION_STAGES[NARRATION_STAGES.length - 1].message,
    });
  });

  it("lets the player override the line without losing the stage", async () => {
    const { getByText, queryByText } = await render(
      <NarrationLoader stage="voice" message="Using the voice you picked" />,
    );
    expect(getByText("Using the voice you picked")).toBeTruthy();
    expect(queryByText(NARRATION_STAGES[0].message)).toBeNull();
  });

  it("clamps a stage that runs off either end of the pipeline", () => {
    expect(narrationStageIndex(-3)).toBe(0);
    expect(narrationStageIndex(99)).toBe(NARRATION_STAGES.length - 1);
    expect(narrationMessageFor("generating")).toBe(
      "The voice is reading it now",
    );
  });

  /**
   * The Listen screen's own loader is a different component (the full-screen
   * one, `components/listen/NarrationLoader`). It is tested here beside its
   * namesake so the two cannot drift apart unnoticed.
   */
  describe("the Listen screen's loader", () => {
    it("says whose chapter is being prepared when the reader did not ask", async () => {
      const { getByText } = await render(
        <ListenNarrationLoader
          art={<></>}
          contextLabel="Next: The Crossing"
          status="Reading the chapter aloud"
          detail="First listen only."
        />,
      );
      // Without this the wait reads as the player having restarted, rather
      // than as the story continuing into its next chapter.
      expect(getByText("Next: The Crossing")).toBeTruthy();
      expect(getByText("Reading the chapter aloud")).toBeTruthy();
    });

    it("shows no context line for a wait the reader walked into", async () => {
      const { queryByTestId } = await render(
        <ListenNarrationLoader
          art={<></>}
          status="Finding your narrator"
          detail=""
        />,
      );
      expect(queryByTestId("narration-loader-context")).toBeNull();
    });
  });

  it("never promises a duration", () => {
    // The provider's queue depth is invisible to the app, so a number here
    // would be invented. This is the guard against one creeping back in.
    for (const stage of NARRATION_STAGES) {
      expect(stage.message).not.toMatch(/\d/);
      expect(stage.message).not.toMatch(/second|minute|moment away|!/i);
    }
  });
});

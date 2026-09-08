import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";

/**
 * The Reanimated stub here does more than CraftingLoader's passthrough, for
 * one reason: this component's whole contract is *when* things happen. A
 * passthrough `withTiming` would let every assertion about clamping, overlap
 * and completion pass vacuously. So a timing node carries its delay and
 * duration, and assigning one to a shared value schedules it on Jest's fake
 * clock — the same shape the real runtime has, just driven by the test.
 */
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;

  /**
   * A scheduled timing, as a plain object. A `jest.mock` factory may not
   * declare a named type, so the shape is spelled out at each use site.
   */
  const isTiming = (value: unknown): boolean =>
    typeof value === "object" && value !== null && "__timing" in value;

  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (Component: unknown) => Component,
    },
    cancelAnimation: jest.fn((shared: { __cancel?: () => void }) => {
      shared?.__cancel?.();
    }),
    Easing: {
      linear: passthrough,
      inOut: () => passthrough,
      out: () => passthrough,
      quad: passthrough,
      cubic: passthrough,
    },
    runOnJS: (fn: unknown) => fn,
    useAnimatedProps: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => {
      const ref = ReactModule.useRef(null);
      if (ref.current === null) {
        const state: {
          v: unknown;
          timer: ReturnType<typeof setTimeout> | null;
        } = { v: initial, timer: null };
        ref.current = {
          __cancel() {
            if (state.timer !== null) {
              clearTimeout(state.timer);
              state.timer = null;
            }
          },
          get value() {
            return state.v;
          },
          set value(next: unknown) {
            this.__cancel();
            if (!isTiming(next)) {
              state.v = next;
              return;
            }
            const timing = next as {
              toValue: unknown;
              delay: number;
              duration: number;
              callback?: (finished: boolean) => void;
            };
            state.timer = setTimeout(() => {
              state.timer = null;
              state.v = timing.toValue;
              timing.callback?.(true);
            }, timing.delay + timing.duration);
          },
        };
      }
      return ref.current;
    },
    withDelay: jest.fn((delay: number, node: { delay: number }) => ({
      ...node,
      delay: node.delay + delay,
    })),
    withTiming: jest.fn(
      (
        toValue: number,
        config?: { duration?: number },
        callback?: (finished: boolean) => void,
      ) => ({
        __timing: true as const,
        toValue,
        delay: 0,
        duration: config?.duration ?? 0,
        callback,
      }),
    ),
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
    Path: stub("Path"),
  };
});

/* eslint-disable import/first */
import { K_LENGTH, K_PATH } from "@/brand/kGlyph";
import {
  DRAW_DURATION_MAX_MS,
  DRAW_DURATION_MIN_MS,
  KathaMark,
} from "@/components/brand/KathaMark";
/* eslint-enable import/first */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Reanimated = require("react-native-reanimated") as {
  withTiming: jest.Mock;
};

/** `motion.fast` — the tail the fill runs past the end of the trace. */
const FILL_TAIL_MS = 150;

let reduceMotion = false;
let removeListener: jest.Mock;

/**
 * The mark holds still until the platform answers about reduced motion, so
 * every test has to let that promise settle before there is anything to
 * observe.
 */
async function mount(element: React.ReactElement) {
  const view = await render(element);
  // A tick for the reduced-motion query to answer, then an act pass for the
  // state it sets and the effect that state releases.
  await act(async () => {});
  return view;
}

beforeEach(() => {
  reduceMotion = false;
  removeListener = jest.fn();
  Reanimated.withTiming.mockClear();
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(() => Promise.resolve(reduceMotion));
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockReturnValue({ remove: removeListener } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KathaMark", () => {
  it("renders, and announces itself as the brand mark", async () => {
    const view = await mount(<KathaMark testID="mark" />);
    const root = view.getByTestId("mark");
    expect(root.props.accessibilityRole).toBe("image");
    expect(root.props.accessibilityLabel).toBe("Katha");
  });

  it("completes one cycle a fill-tail after the trace lands", async () => {
    jest.useFakeTimers();
    try {
      const onComplete = jest.fn();
      await mount(<KathaMark drawDuration={1000} onComplete={onComplete} />);

      await act(async () => {
        jest.advanceTimersByTime(1000 + FILL_TAIL_MS - 1);
      });
      expect(onComplete).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("starts the fill before the trace finishes", async () => {
    await mount(<KathaMark drawDuration={1000} fillStartPercent={70} />);
    // The fill's delay and duration together still land on the trace's end
    // plus the tail, but it is underway at 700ms — the overlap is the gesture.
    expect(Reanimated.withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: 1000 - 700 + FILL_TAIL_MS }),
      expect.any(Function),
    );
  });

  it("clamps a draw duration that is too fast to read", async () => {
    jest.useFakeTimers();
    try {
      const onComplete = jest.fn();
      await mount(<KathaMark drawDuration={10} onComplete={onComplete} />);

      await act(async () => {
        jest.advanceTimersByTime(DRAW_DURATION_MIN_MS + FILL_TAIL_MS - 1);
      });
      expect(onComplete).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("clamps a draw duration that would hold the screen", async () => {
    jest.useFakeTimers();
    try {
      const onComplete = jest.fn();
      await mount(<KathaMark drawDuration={99999} onComplete={onComplete} />);

      await act(async () => {
        jest.advanceTimersByTime(DRAW_DURATION_MAX_MS + FILL_TAIL_MS - 1);
      });
      expect(onComplete).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("repeats after the loop delay, and stops on unmount", async () => {
    jest.useFakeTimers();
    try {
      const onComplete = jest.fn();
      const view = await mount(
        <KathaMark
          drawDuration={1000}
          loop
          loopDelay={500}
          onComplete={onComplete}
        />,
      );
      await act(async () => {
        jest.advanceTimersByTime(1000 + FILL_TAIL_MS);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(500 + 1000 + FILL_TAIL_MS);
      });
      expect(onComplete).toHaveBeenCalledTimes(2);

      await view.unmount();
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      // A loop that outlives its component is a leak that never reports
      // itself, so this is the assertion that matters most here.
      expect(onComplete).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("survives being unmounted mid-trace", async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const onComplete = jest.fn();
      const view = await mount(
        <KathaMark drawDuration={1000} onComplete={onComplete} />,
      );
      await act(async () => {
        jest.advanceTimersByTime(400);
      });

      await expect(view.unmount()).resolves.not.toThrow();

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(onComplete).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("KathaMark under reduced motion", () => {
  it("shows the finished mark immediately and schedules nothing", async () => {
    reduceMotion = true;
    const onComplete = jest.fn();
    const view = await mount(
      <KathaMark testID="mark" onComplete={onComplete} />,
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(Reanimated.withTiming).not.toHaveBeenCalled();

    // The setting is a request about motion, not about the logo: the K is
    // still there, it is simply already drawn. The rerender is only to read
    // the shared values back out — nothing moved them.
    await view.rerender(<KathaMark testID="mark" onComplete={onComplete} />);
    expect(view.getByTestId("Path").props.animatedProps).toEqual({
      strokeDashoffset: 0,
      fillOpacity: 1,
    });
  });

  it("unsubscribes from the reduced-motion listener on unmount", async () => {
    const view = await mount(<KathaMark />);
    await view.unmount();
    expect(removeListener).toHaveBeenCalled();
  });
});

describe("K_LENGTH", () => {
  it("is the actual perimeter of K_PATH", () => {
    // The baked constant is the only length the dash math has — RN cannot ask
    // the rendered node for one. If the glyph is ever regenerated and this
    // number is not, the trace silently stops short or overshoots. This walk
    // is the guard.
    const points = K_PATH.trim()
      .replace(/[Zz]\s*$/, "")
      .split(/(?=[MLml])/)
      .map((command) => command.trim())
      .filter(Boolean)
      .map((command) => {
        const [x, y] = command.slice(1).trim().split(",").map(Number);
        return { x, y };
      });

    expect(points.length).toBeGreaterThan(20);
    expect(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))
      .toBe(true);

    let perimeter = 0;
    for (let i = 0; i < points.length; i += 1) {
      // The contour is closed, so the last point joins back to the first.
      const from = points[i];
      const to = points[(i + 1) % points.length];
      perimeter += Math.hypot(to.x - from.x, to.y - from.y);
    }

    expect(Math.abs(perimeter - K_LENGTH)).toBeLessThan(0.5);
  });
});

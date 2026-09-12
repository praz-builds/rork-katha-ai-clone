import React from "react";
import { act, render, within } from "@testing-library/react-native";

/**
 * Flipped per test. `mock*` because babel-plugin-jest-hoist refuses any other
 * out-of-scope reference from inside a `jest.mock` factory.
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
    Easing: { out: () => passthrough, cubic: passthrough },
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => mockReduceMotion,
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
    withSequence: (value: unknown) => value,
    /**
     * Runs the settle to completion synchronously and invokes the callback the
     * screen gave it. The auto-advance hangs off that callback, so a mock that
     * swallowed it would make a screen that never hands over look green.
     */
    withSpring: jest.fn(
      (
        value: unknown,
        _config?: unknown,
        callback?: (finished: boolean) => void,
      ) => {
        callback?.(true);
        return value;
      },
    ),
    withTiming: jest.fn((value: unknown) => value),
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
    Circle: stub("Circle"),
    Defs: stub("Defs"),
    Path: stub("Path"),
    Pattern: stub("Pattern"),
    Rect: stub("Rect"),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("expo-haptics", () => ({
  __esModule: true,
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light" },
}));

/* eslint-disable import/first */
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
/* eslint-enable import/first */

const reanimated = jest.requireMock("react-native-reanimated") as {
  withSpring: jest.Mock;
};

beforeEach(() => {
  jest.useFakeTimers();
  mockReduceMotion = false;
  reanimated.withSpring.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Advances the screen's timers inside `act`, so the hand-off is observable. */
async function runTimers(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("WelcomeScreen", () => {
  it("renders the welcome copy and no button at all", async () => {
    const { getByText, queryByText, queryByRole } = await render(
      <WelcomeScreen onOpen={jest.fn()} />,
    );

    expect(getByText("Welcome to Katha.")).toBeTruthy();
    expect(getByText("Your next chapter starts here.")).toBeTruthy();
    // The screen hands over on its own. A button here is a request to
    // acknowledge a gift before being allowed to have it.
    expect(queryByText("Open Katha")).toBeNull();
    expect(queryByRole("button")).toBeNull();
  });

  it("marks the heading as a header for assistive tech", async () => {
    const { getByText } = await render(<WelcomeScreen onOpen={jest.fn()} />);

    expect(getByText("Welcome to Katha.").props.accessibilityRole).toBe(
      "header",
    );
  });

  it("hands over by itself once the last coin has settled, exactly once", async () => {
    const onOpen = jest.fn();
    await render(<WelcomeScreen onOpen={onOpen} />);

    // The settle already reported (the spring mock completes synchronously),
    // so nothing but the hold is left. It must not fire early.
    await runTimers(500);
    expect(onOpen).not.toHaveBeenCalled();

    await runTimers(300);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // The failsafe must not hand over a second time.
    await runTimers(10000);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("holds longer under reduced motion, where there is nothing to watch land", async () => {
    mockReduceMotion = true;
    const onOpen = jest.fn();
    await render(<WelcomeScreen onOpen={onOpen} />);

    await runTimers(800);
    expect(onOpen).not.toHaveBeenCalled();

    await runTimers(200);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("never calls onOpen after the screen is gone", async () => {
    const onOpen = jest.fn();
    const { unmount } = await render(<WelcomeScreen onOpen={onOpen} />);

    // Inside `act`, because React 19 defers the unmount commit and the fake
    // clock would otherwise run the screen's timers before its cleanup.
    await act(async () => {
      unmount();
    });
    await runTimers(10000);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("still hands over when no coins are drawn", async () => {
    const onOpen = jest.fn();
    await render(<WelcomeScreen credits={0} onOpen={onOpen} />);

    await runTimers(1000);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("draws one CreditCoin per credit", async () => {
    const { getByTestId, queryByTestId } = await render(
      <WelcomeScreen onOpen={jest.fn()} />,
    );

    expect(getByTestId("welcome-coin-0")).toBeTruthy();
    expect(getByTestId("welcome-coin-2")).toBeTruthy();
    expect(queryByTestId("welcome-coin-3")).toBeNull();
  });

  it("draws each coin as the shared svg mark, not a filled circle view", async () => {
    const { getByTestId } = await render(<WelcomeScreen onOpen={jest.fn()} />);

    // Scoped to one coin, because the dotted ground is an svg too. Each coin is
    // the `CreditCoin` drawing: rim, face, highlight, spark.
    const coin = within(getByTestId("welcome-coin-1"));
    expect(coin.getByTestId("Svg").props.viewBox).toBe("0 0 24 24");
    expect(coin.getAllByTestId("Circle")).toHaveLength(2);
    expect(coin.getAllByTestId("Path")).toHaveLength(2);
  });

  /**
   * The canonical rule: no number, no balance, no price, no plan on this
   * screen. Asserted as "no digit renders anywhere" rather than as "the string
   * '3' is absent", because the failure this guards against is somebody adding
   * "3 credits to start" or "$59/yr" in good faith, and either of those is a
   * digit on a screen that must not have one.
   */
  it("renders no digits at all", async () => {
    const { getByText, queryAllByText } = await render(
      <WelcomeScreen onOpen={jest.fn()} />,
    );

    // The screen is really rendered (guards against a green run on an empty
    // tree), and nothing on it carries a numeral.
    expect(getByText("Welcome to Katha.")).toBeTruthy();
    expect(queryAllByText(/\d/)).toHaveLength(0);
  });

  it("settles the coins with a spring, and skips it under reduced motion", async () => {
    await render(<WelcomeScreen onOpen={jest.fn()} />);
    expect(reanimated.withSpring).toHaveBeenCalled();

    reanimated.withSpring.mockClear();
    mockReduceMotion = true;
    const { getByTestId } = await render(<WelcomeScreen onOpen={jest.fn()} />);

    // Still drawn, just already on the ground.
    expect(getByTestId("welcome-coin-0")).toBeTruthy();
    expect(reanimated.withSpring).not.toHaveBeenCalled();
  });
});

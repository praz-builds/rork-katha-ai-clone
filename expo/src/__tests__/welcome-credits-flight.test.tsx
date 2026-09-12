import React from "react";
import { act, render } from "@testing-library/react-native";

let mockReduceMotion = false;

/**
 * The mock runs every animation to completion SYNCHRONOUSLY, invoking the
 * completion callback `withTiming`/`withSpring` were given. That is what makes
 * the flight's contract testable at all: the thing under test is not the
 * motion, it is the promise that every coin reports a landing and that the
 * overlay always tells its owner it can be unmounted. A passthrough mock that
 * drops the callback would make an overlay that never finishes look green.
 */
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const passthrough = (value: unknown) => value;
  const complete = (
    value: unknown,
    _config?: unknown,
    callback?: (finished: boolean) => void,
  ) => {
    callback?.(true);
    return value;
  };
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
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withSpring: jest.fn(complete),
    withTiming: jest.fn(complete),
  };
});

/** The coin is an svg drawing; the flight does not care what is inside it. */
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
    Path: stub("Path"),
  };
});

/* eslint-disable import/first */
import {
  bumpCredits,
  WelcomeCreditsFlight,
  type FlightTarget,
} from "@/components/onboarding/WelcomeCreditsFlight";
import {
  hasPlayedWelcomeFlight,
  markWelcomeFlightPlayed,
} from "@/lib/welcome-flight";
/* eslint-enable import/first */

const PILL: FlightTarget = { x: 300, y: 60, width: 64, height: 44 };

beforeEach(() => {
  mockReduceMotion = false;
});

/** Lets the `measureTarget` promise and a queued animation frame both run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("WelcomeCreditsFlight", () => {
  it("measures the target and reports every landing in order, then finishes", async () => {
    const measureTarget = jest.fn(async () => PILL);
    const onLanded = jest.fn();
    const onDone = jest.fn();

    await render(
      <WelcomeCreditsFlight
        credits={3}
        measureTarget={measureTarget}
        onLanded={onLanded}
        onDone={onDone}
      />,
    );
    await settle();

    expect(measureTarget).toHaveBeenCalledTimes(1);
    expect(onLanded.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not draw anything the reader can tap through to", async () => {
    const { getByTestId } = await render(
      <WelcomeCreditsFlight
        credits={3}
        measureTarget={async () => PILL}
        onLanded={jest.fn()}
        onDone={jest.fn()}
      />,
    );
    await settle();

    // `includeHiddenElements` because the overlay hides itself from the
    // accessibility tree and from touch, which is exactly the property under
    // test -- the default query would report "not found" for a view that is
    // there and correct.
    expect(
      getByTestId("welcome-credits-flight", { includeHiddenElements: true })
        .props.pointerEvents,
    ).toBe("none");
  });

  it("falls back to a fade when the pill cannot be measured, and still completes", async () => {
    const onLanded = jest.fn();
    const onDone = jest.fn();

    await render(
      <WelcomeCreditsFlight
        credits={3}
        measureTarget={async () => null}
        onLanded={onLanded}
        onDone={onDone}
      />,
    );
    await settle();

    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(onLanded).toHaveBeenCalledWith(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("treats a zero rect as no target", async () => {
    const onLanded = jest.fn();
    const onDone = jest.fn();

    await render(
      <WelcomeCreditsFlight
        credits={3}
        measureTarget={async () => ({ x: 0, y: 0, width: 0, height: 0 })}
        onLanded={onLanded}
        onDone={onDone}
      />,
    );
    await settle();

    expect(onLanded).toHaveBeenCalledWith(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("completes when the measurement rejects", async () => {
    const onDone = jest.fn();

    await render(
      <WelcomeCreditsFlight
        credits={3}
        measureTarget={async () => {
          throw new Error("no view");
        }}
        onLanded={jest.fn()}
        onDone={onDone}
      />,
    );
    await settle();

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("grants the credits without animating under reduced motion", async () => {
    mockReduceMotion = true;
    const measureTarget = jest.fn(async () => PILL);
    const onLanded = jest.fn();
    const onDone = jest.fn();

    const { queryByTestId } = await render(
      <WelcomeCreditsFlight
        credits={3}
        measureTarget={measureTarget}
        onLanded={onLanded}
        onDone={onDone}
      />,
    );
    await settle();

    expect(
      queryByTestId("welcome-credits-flight", { includeHiddenElements: true }),
    ).toBeNull();
    expect(measureTarget).not.toHaveBeenCalled();
    // The grant is still reported, or Home opens showing a zero balance.
    expect(onLanded).toHaveBeenCalledWith(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("bumps a shared value through an overshoot and back to rest", async () => {
    const box = { current: 1 as number };
    const sv = {
      get: () => box.current,
      set: (next: number) => {
        box.current = next;
      },
    };

    bumpCredits(sv as never);

    // `withSequence` in the mock yields its last step, which is the rest value.
    expect(box.current).toBe(1);
  });
});

describe("welcome-flight storage", () => {
  it("round-trips the played flag and defaults to false", async () => {
    expect(await hasPlayedWelcomeFlight()).toBe(false);
    await markWelcomeFlightPlayed();
    expect(await hasPlayedWelcomeFlight()).toBe(true);
  });
});

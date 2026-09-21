/**
 * The cover that never appeared.
 *
 * Explore showed the first screenful of cards as genre gradients forever,
 * while cards met further down the scroll showed their art. The difference
 * was not the stories — it was WHEN the image answered. A cover that resolves
 * fast (warm cache, already decoded, prefetched) fires `onLoad` before the
 * card's mount effect runs; the old code reset the fade to 0 in that effect,
 * so the reveal that had already happened was undone and nothing fired
 * `onLoad` again for the life of the mount.
 *
 * The first test below is that exact ordering: the mocked image reports
 * itself loaded from a LAYOUT effect, which React runs before the parent's
 * passive mount effect. Against the old implementation the cover ends at
 * opacity 0; against the fixed one it ends visible.
 *
 * `Animated.timing` is stubbed to settle immediately because the native
 * driver does not tick under Jest — the animation is not what is being
 * tested, the end state is.
 */
import React from "react";
import { act, render } from "@testing-library/react-native";
import { Animated } from "react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/**
 * An image that reports itself loaded BEFORE the card's mount effect. A child
 * layout effect is the earliest a test can reach; React runs every layout
 * effect at commit and the parent's `useEffect` only afterwards, which is the
 * real-world race with a cached cover.
 */
/**
 * Called from inside the image's layout effect, i.e. DURING the commit that
 * first rendered a new source and BEFORE anything reacts to its load. It is
 * the only place a test can look at the frame a reader would actually see.
 */
let mockOnSourceCommitted: ((key: string) => void) | null = null;

jest.mock("@/components/KathaPrimitives", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const actual = jest.requireActual("@/components/KathaPrimitives");
  return {
    ...actual,
    FocalImage: (
      { source, onLoad }: {
        source: number | { uri: string };
        onLoad?: () => void;
      },
    ) => {
      const key = typeof source === "object" && source !== null
        ? source.uri
        : String(source);
      // ONCE PER SOURCE, like a real image. Firing on every render would hide
      // the very bug under test: a second `onLoad` after the mount effect
      // would repair a reveal that the effect had just undone.
      const fired = ReactModule.useRef(null);
      ReactModule.useLayoutEffect(() => {
        if (fired.current === key) return;
        fired.current = key;
        mockOnSourceCommitted?.(key);
        onLoad?.();
      });
      return ReactModule.createElement("FocalImage", { testID: "focal-image" });
    },
  };
});

/* eslint-disable import/first */
import {
  feedCardMetrics,
  RAIL_CARD_WIDTH,
  StoryFeedCard,
} from "@/components/feed/StoryFeedCard";
import { layoutWidth, REFERENCE_WINDOW_WIDTH } from "@/theme";
import { stories } from "@/data/seed";
/* eslint-enable import/first */

const story = { ...stories[0], coverImageUrl: "https://example.test/cover.png" };

let timing: jest.SpyInstance;

beforeEach(() => {
  timing = jest.spyOn(Animated, "timing").mockImplementation((
    value: unknown,
    config: { toValue: unknown },
  ) => {
    const node = value as { setValue: (to: number) => void };
    return {
      start: (callback?: (result: { finished: boolean }) => void) => {
        node.setValue(config.toValue as number);
        callback?.({ finished: true });
      },
      stop: () => {},
      reset: () => {},
    } as unknown as ReturnType<typeof Animated.timing>;
  });
});

afterEach(() => {
  timing.mockRestore();
  mockOnSourceCommitted = null;
});

/**
 * The cover's CURRENT opacity, as a number.
 *
 * WHY THE `typeof` CHECK IS HERE. A reviewer has read this as returning the
 * `Animated.Value` object, which would make `toBe(1)` unsatisfiable and every
 * assertion below vacuous. It does not: `Animated.View` resolves its style to
 * a plain number on the host element the query returns, and reverting the
 * reveal fix makes these tests report `Expected: 1, Received: 0` — a number,
 * and one that discriminates. The check makes that permanent rather than
 * remembered, because the failure mode if it ever DID become an object is a
 * suite that passes while protecting nothing.
 */
const coverOpacity = (element: { props: Record<string, unknown> }) => {
  const style = element.props.style as
    | { opacity?: number }
    | { opacity?: number }[];
  const flattened = Array.isArray(style)
    ? Object.assign({}, ...style)
    : style;
  const opacity = (flattened as { opacity?: number }).opacity;
  expect(typeof opacity).toBe("number");
  return opacity;
};

it("shows a cover whose onLoad fires before the first paint", async () => {
  const view = await render(<StoryFeedCard story={story} />);
  await act(async () => {});
  expect(coverOpacity(view.getByTestId("story-feed-cover"))).toBe(1);
});

it("fades a regenerated cover in again", async () => {
  const view = await render(<StoryFeedCard story={story} />);
  await act(async () => {});

  await view.rerender(
    <StoryFeedCard
      story={{ ...story, coverImageUrl: "https://example.test/cover-2.png" }}
    />,
  );
  await act(async () => {});
  // The new source loads on its own layout effect, so it ends visible too -
  // the remembered key is per-source, not a one-way "has ever loaded" latch.
  expect(coverOpacity(view.getByTestId("story-feed-cover"))).toBe(1);
});

it("starts a regenerated cover hidden, in the frame that swaps it", async () => {
  /*
    The mirror of the bug above. `revealed` going false and the effect calling
    `setValue(0)` is not enough, because that effect is PASSIVE: the frame
    that first paints the new source still carries the old source's opacity of
    1, so regenerated art pops in at full strength instead of fading up from
    the gradient.

    The probe fires inside the new image's layout effect, which is during that
    exact commit and before anything has reacted to its load, so what it reads
    is the frame a reader would see.
  */
  const view = await render(<StoryFeedCard story={story} />);
  await act(async () => {});
  expect(coverOpacity(view.getByTestId("story-feed-cover"))).toBe(1);

  const seen: number[] = [];
  mockOnSourceCommitted = () => {
    seen.push(coverOpacity(view.getByTestId("story-feed-cover")) as number);
  };

  await view.rerender(
    <StoryFeedCard
      story={{ ...story, coverImageUrl: "https://example.test/cover-2.png" }}
    />,
  );
  await act(async () => {});

  expect(seen).toEqual([0]);
});

it("never withholds the card while the cover is missing", async () => {
  // A story with no cover at all still renders its title and its stats: the
  // gradient IS the card. Gating the row on its picture would hide a story
  // whose cover generation failed for good.
  const view = await render(
    <StoryFeedCard
      story={{ ...story, coverImageUrl: undefined, coverImage: undefined }}
    />,
  );
  expect(view.getByText(story.title)).toBeTruthy();
  expect(view.queryByTestId("story-feed-cover")).toBeNull();
});

describe("the card scales with the window", () => {
  // 390 is the frame the design system is drawn at, so its numbers are the
  // ones that must not move: a 116 x 155 cover and a 300pt rail card.
  const content = (window: number) => window - 20 * 2;

  it("reproduces the reference geometry at 390", () => {
    const list = feedCardMetrics(content(390), "list");
    expect(list.coverWidth).toBe(116);
    expect(list.coverHeight).toBe(155);
    expect(feedCardMetrics(content(390), "rail").cardWidth).toBe(
      RAIL_CARD_WIDTH,
    );
  });

  it("draws the reference frame when the window has not been measured", () => {
    /*
      `useWindowDimensions()` reports 0 on the first web frame. Computed from
      that number the geometry is not merely small, it is WRONG in both
      directions at once: a list cover collapses to nothing and a rail card
      clamps UP to its 236 minimum, i.e. a card wider than the window holding
      it. One frame later it all snaps to the real size, and that snap is what
      a cold load looks like.

      So an unmeasured window is answered with 390 - the frame the design is
      specified at - and the first frame is simply correct.
    */
    for (const unmeasured of [0, -1, Number.NaN]) {
      const first = layoutWidth(unmeasured);
      expect(first).toEqual(layoutWidth(REFERENCE_WINDOW_WIDTH));

      const list = feedCardMetrics(first.content, "list");
      const rail = feedCardMetrics(first.content, "rail");
      expect(list.coverWidth).toBe(116);
      expect(list.coverHeight).toBe(155);
      expect(rail.cardWidth).toBe(RAIL_CARD_WIDTH);
    }
  });

  it("never draws a rail card wider than the column it was given", () => {
    // The clamp's job is to pull a small number UP, so on its own it hands
    // back a 236pt card for any content narrower than that. Nothing feeds it
    // such a width today; this is the guard that keeps that true.
    for (const content of [0, 1, 100, 235]) {
      const rail = feedCardMetrics(content, "rail");
      expect(rail.cardWidth as number).toBeLessThanOrEqual(content);
      expect(rail.coverWidth).toBeLessThanOrEqual(content);
    }
  });

  it("keeps every width inside the window it was measured from", () => {
    for (const window of [320, 390, 430, 768]) {
      const available = Math.min(content(window), 560);
      const list = feedCardMetrics(content(window), "list");
      const rail = feedCardMetrics(content(window), "rail");

      expect(list.cardWidth).toBeNull(); // fills its column
      expect(list.coverWidth).toBeLessThan(available);
      expect(rail.cardWidth).not.toBeNull();
      expect(rail.cardWidth as number).toBeLessThanOrEqual(available);
      // The cover may never take so much of a card that the title has no
      // column left beside it.
      expect(rail.coverWidth).toBeLessThan((rail.cardWidth as number) / 2);
      expect(list.coverHeight).toBe(Math.round(list.coverWidth * 4 / 3));
    }
  });
});

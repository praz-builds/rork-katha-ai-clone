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
});

const coverOpacity = (element: { props: Record<string, unknown> }) => {
  const style = element.props.style as
    | { opacity?: number }
    | { opacity?: number }[];
  const flattened = Array.isArray(style)
    ? Object.assign({}, ...style)
    : style;
  return (flattened as { opacity?: number }).opacity;
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

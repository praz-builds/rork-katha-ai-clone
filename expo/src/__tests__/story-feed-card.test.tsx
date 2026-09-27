/**
 * The cover the card asks for, and the one it is allowed to show.
 *
 * WHAT THIS FILE USED TO TEST, AND WHY IT NO LONGER DOES. Explore showed the
 * first screenful of cards as genre gradients forever while cards further down
 * showed their art, because the reveal was a hand-rolled `Animated.Value`
 * driven from `onLoad`: a cover that resolved fast fired `onLoad` before the
 * mount effect that zeroed the opacity, so the reveal was undone and nothing
 * fired again. Fixing that introduced the mirror bug, where a regenerated
 * cover reused the old value of 1 and popped in at full strength.
 *
 * Both were the same bug -- a fade whose correctness depended on the ordering
 * of a callback and an effect -- and `expo-image`'s `transition` removed the
 * ordering question along with the state. There is nothing left to assert
 * about opacity, so the three tests that did are gone rather than rewritten
 * against a mechanism that is now the library's.
 *
 * What replaces them is the two things the card still decides for itself: the
 * URL it asks Supabase for, and the recycling key that stops a reused row
 * showing the previous story's art. Both fail silently -- a full-size cover
 * looks identical, just slower, and a stale cover looks like the right one
 * until you read the title next to it.
 */
import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/**
 * `FocalImage`, reduced to the two props the card is responsible for choosing.
 * They are put on the host element so a query can read them back.
 */
jest.mock("@/components/KathaPrimitives", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const actual = jest.requireActual("@/components/KathaPrimitives");
  return {
    ...actual,
    FocalImage: (
      { source, recyclingKey }: {
        source: number | { uri: string };
        recyclingKey?: string;
      },
    ) =>
      ReactModule.createElement("FocalImage", {
        testID: "focal-image",
        uri: typeof source === "object" && source !== null ? source.uri : null,
        recyclingKey,
      }),
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


type CardView = Awaited<ReturnType<typeof render>>;

/** What the card chose to hand `FocalImage`. */
const cover = (view: CardView) =>
  view.getByTestId("focal-image").props as {
    uri: string | null;
    recyclingKey?: string;
  };

it("asks Supabase for a card-sized cover, not the full-size PNG", async () => {
  // The whole point of the change. A published cover is ~2MB at 832x1248 and
  // this box is about 116x155pt; the transform endpoint returns ~70KB of WebP
  // for the same image. See `lib/cover-url.ts` for the measurements.
  const view = await render(
    <StoryFeedCard
      story={{
        ...story,
        coverImageUrl:
          "https://p.supabase.co/storage/v1/object/public/covers/covers/abc/cover.png",
      }}
    />,
  );

  expect(cover(view).uri).toBe(
    "https://p.supabase.co/storage/v1/render/image/public/covers/covers/abc/cover.png" +
      "?width=350&quality=60&resize=cover",
  );
});

it("leaves a cover it does not recognise exactly as it found it", async () => {
  // An uploaded cover on somebody else's host. Being wrong here has to mean
  // "no faster", never "no image".
  const view = await render(
    <StoryFeedCard
      story={{ ...story, coverImageUrl: "https://elsewhere.test/mine.jpg" }}
    />,
  );

  expect(cover(view).uri).toBe("https://elsewhere.test/mine.jpg");
});

it("keys the image to the story, so a recycled row cannot show a stale cover", async () => {
  // `FlatList` reuses row components as it scrolls. Without this the reused
  // row keeps painting the previous story's art until the new one decodes,
  // which looks like a correct card until you read the title beside it.
  const view = await render(<StoryFeedCard story={story} />);
  expect(cover(view).recyclingKey).toBe(story.id);
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

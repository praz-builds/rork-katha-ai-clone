/**
 * Every surface asks for the cover at its own size.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE OTHER TWO. `cover-url.test.ts` proves
 * the function builds the right URL. `focal-image.test.tsx` proves the
 * component sends the right header for a URL it builds itself. Neither proves
 * that the screens **call** the function — and that is the half that has
 * already been wrong once: `Cover` was missed on the first pass, so Library's
 * shelves and every author page fetched ~2 MB per 96pt thumbnail, twenty at a
 * time, while the screen looked identical and the suite stayed green.
 *
 * Reverting `coverUrl(story.coverImageUrl, size)` in `Cover` leaves
 * `cover-url.test.ts`, `focal-image.test.tsx` and `story-feed-card.test.tsx`
 * all passing. This file is what fails.
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
 * `expo-image`, not `@/components/KathaPrimitives`.
 *
 * `Cover` and `FocalImage` live in the same module, and a module-internal
 * reference does not go through a `jest.mock` of that module -- so mocking
 * `FocalImage` there renders the real one and finds nothing. Mocking the leaf
 * the real component renders is both simpler and closer to what ships.
 */
jest.mock("expo-image", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    Image: (props: Record<string, unknown>) =>
      ReactModule.createElement("ExpoImage", { testID: "expo-image", ...props }),
  };
});

/* eslint-disable import/first */
import { Cover } from "@/components/KathaPrimitives";
import { COVER_WIDTHS } from "@/lib/cover-url";
import { stories as seedStories } from "@/data/seed";
/* eslint-enable import/first */

const PUBLIC =
  "https://p.supabase.co/storage/v1/object/public/covers/covers/abc/cover.png";

const story = { ...seedStories[0], id: "story-1", coverImageUrl: PUBLIC };

type Rendered = Awaited<ReturnType<typeof render>>;
const sourceOf = (view: Rendered) =>
  view.getByTestId("expo-image").props.source as
    | { uri: string; headers?: Record<string, string> }
    | number;
const uriOf = (view: Rendered) => {
  const source = sourceOf(view);
  return typeof source === "object" && source !== null ? source.uri : null;
};

it("asks for a shelf thumbnail at the mini width, not the full-size PNG", async () => {
  // `size="mini"` is Library's shelves and every author page, drawn into a
  // 96pt box -- the worst bytes-to-pixels ratio in the app, and the caller
  // that was missed the first time round.
  const view = await render(<Cover story={story} size="mini" />);

  expect(uriOf(view)).toContain("/render/image/public/");
  expect(uriOf(view)).toContain(`width=${COVER_WIDTHS.mini}`);
});

it("asks for a card at the card width", async () => {
  const view = await render(<Cover story={story} size="card" />);
  expect(uriOf(view)).toContain(`width=${COVER_WIDTHS.card}`);
});

it("keys a shelf row to its story, so a recycled row cannot show a stale cover", async () => {
  const view = await render(<Cover story={story} size="mini" />);
  expect(view.getByTestId("expo-image").props.recyclingKey).toBe("story-1");
});

it("leaves a cover it does not recognise exactly as it found it", async () => {
  // An uploaded cover on somebody else's host. Being wrong here has to mean
  // "no faster", never "no image".
  const view = await render(
    <Cover
      story={{ ...story, coverImageUrl: "https://elsewhere.test/mine.jpg" }}
      size="mini"
    />,
  );
  expect(uriOf(view)).toBe("https://elsewhere.test/mine.jpg");
});

it("draws the genre gradient under the art, not instead of it", async () => {
  // These were the two arms of one ternary, so a story WITH a cover rendered
  // no gradient at all -- invisible while the image painted at full opacity
  // from the first frame, and not once it fades in.
  const view = await render(<Cover story={story} size="mini" />);
  expect(view.getByTestId("expo-image")).toBeTruthy();
  // The gradient is still rendered alongside it, not replaced by it.
  expect(JSON.stringify(view.toJSON())).toContain("LinearGradient");
});

/**
 * The hero, pinned at the source rather than by rendering.
 *
 * `Cover` carries `card` and `mini`, but the two full-bleed surfaces call
 * `coverUrl` themselves, and rendering either would mean standing up a player
 * and a detail screen to assert one string. So this reads the files. It is the
 * crude half of the pair on purpose: what it catches is the thing that
 * actually happened to `Cover` -- a surface quietly going back to
 * `story.coverImageUrl` and fetching 2 MB behind an identical-looking screen.
 */
it("asks for the hero surfaces at the hero width", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  for (const file of ["StoryDetailScreen", "ListenScreen"]) {
    const source = fs.readFileSync(`${__dirname}/../screens/${file}.tsx`, "utf8");
    expect(source).toContain('coverUrl(story.coverImageUrl, "hero")');
  }
});

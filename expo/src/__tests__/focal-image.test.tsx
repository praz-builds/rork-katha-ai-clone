/**
 * `FocalImage`, and the one line that carries most of the saving.
 *
 * WHY THIS FILE EXISTS. `cover-url.test.ts` proves that `coverUrl` rewrites a
 * URL and that `isTransformedCover` classifies one. Neither touches the wiring
 * that turns those facts into bytes, which is the `headers` on the source here.
 * Supabase decides WebP from the request's `Accept` header and from nothing
 * else: the same transform URL is 70,810 bytes with it and 865,744 without.
 *
 * So deleting `headers` would leave every test green, `expo export` succeeding,
 * and every cover silently twelve times bigger than it should be, with the
 * screen looking identical. That is the exact regression the module's own
 * docblock calls out as unfindable by looking, and until this file it was also
 * unfindable by CI -- `story-feed-card.test.tsx` mocks `FocalImage` away, so
 * nothing in the suite ever executed the branch.
 */
import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";

jest.mock("expo-image", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    Image: (props: Record<string, unknown>) =>
      ReactModule.createElement("ExpoImage", { testID: "expo-image", ...props }),
  };
});

/* eslint-disable import/first */
import { FocalImage } from "@/components/KathaPrimitives";
import { coverUrl } from "@/lib/cover-url";
/* eslint-enable import/first */

const PUBLIC =
  "https://p.supabase.co/storage/v1/object/public/covers/covers/abc/cover.png";

type Rendered = Awaited<ReturnType<typeof render>>;
const source = (view: Rendered) =>
  view.getByTestId("expo-image").props.source as
    | { uri: string; headers?: Record<string, string> }
    | number;

// The native branch, for the whole file. `defineProperty` rather than
// `jest.replaceProperty` because this must not be restored between tests: the
// web branch renders a bare `<img>` with no testID, so a single restored test
// fails with "unable to find expo-image" and looks like a component bug.
// `FocalImage`'s web branch is covered by the screens that render it.
beforeAll(() => {
  Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
});

it("sends the WebP Accept header with a transformed cover", async () => {
  const uri = coverUrl(PUBLIC, "card");
  const view = await render(<FocalImage source={{ uri: uri as string }} />);

  const resolved = source(view) as { uri: string; headers?: Record<string, string> };
  expect(resolved.uri).toBe(uri);
  // Without this the same URL returns an 866 KB PNG instead of a 71 KB WebP,
  // and nothing anywhere says so.
  expect(resolved.headers?.Accept).toContain("image/webp");
});

it("sends no header with a cover it did not rewrite", async () => {
  // Somebody else's host gains nothing from it, and a raw Supabase object URL
  // is not a transform request.
  // `view.getByTestId` is scoped to its own tree, so two live renders do not
  // collide -- and unmounting between them does, because the auto-cleanup that
  // follows then has nothing to tear down and leaves the next test's render
  // unqueryable. That cost a confusing "unable to find expo-image" on the two
  // tests after this one.
  for (const uri of [PUBLIC, "https://elsewhere.test/mine.jpg"]) {
    const view = await render(<FocalImage source={{ uri }} />);
    const resolved = source(view) as { uri: string; headers?: Record<string, string> };
    expect(resolved.uri).toBe(uri);
    expect(resolved.headers).toBeUndefined();
  }
});

it("passes a bundled asset straight through", async () => {
  // A `require`d module id is a number, not a URL, and a header on it is
  // meaningless. It must reach expo-image unwrapped.
  const view = await render(<FocalImage source={42} />);
  expect(source(view)).toBe(42);
});

it("keeps the cover-crop settings the card depends on", async () => {
  const view = await render(
    <FocalImage
      source={{ uri: coverUrl(PUBLIC, "card") as string }}
      focalX={0.25}
      focalY={0.75}
      recyclingKey="story-1"
    />,
  );
  const props = view.getByTestId("expo-image").props;

  expect(props.contentFit).toBe("cover");
  expect(props.contentPosition).toEqual({ left: "25%", top: "75%" });
  // The disk cache `Image.prefetch` never gave, and the key that stops a
  // recycled row painting the previous story's art.
  expect(props.cachePolicy).toBe("disk");
  expect(props.recyclingKey).toBe("story-1");
});

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
import { act, render } from "@testing-library/react-native";

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
import { COVER_WIDTHS, coverUrl } from "@/lib/cover-url";
/* eslint-enable import/first */

const PUBLIC =
  "https://p.supabase.co/storage/v1/object/public/covers/covers/abc/cover.png";

type Rendered = Awaited<ReturnType<typeof render>>;
const source = (view: Rendered) =>
  view.getByTestId("expo-image").props.source as
    | { uri: string; headers?: Record<string, string> }
    | number;

/**
 * `defineProperty` rather than `jest.replaceProperty` because this must not be
 * restored between tests: the two branches render different elements, so a
 * silently restored platform fails with "unable to find expo-image" and reads
 * as a component bug.
 */
const platform = (os: "ios" | "web") => {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
};

describe("the native branch", () => {
  beforeAll(() => platform("ios"));

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
});

/**
 * The web branch, whose failure mode is the picture rather than the bytes.
 *
 * `opacity: 0` is set inline and only two things ever put it back: the load
 * event, and the `ref`'s `complete` check for an image the browser had already
 * cached before React attached a handler. If both miss, the cover is invisible
 * forever -- the "first screenful of Explore is gradients forever" report
 * reproduced in the DOM, on the one surface this client can currently be
 * looked at.
 *
 * Nothing else in the suite renders this branch: `story-feed-card` stubs
 * `FocalImage` out, `genres.test.tsx` renders the real one without setting a
 * platform (so it takes the native path), and no other file sets `"web"` and
 * renders a cover. Deleting the load handler would leave every other test
 * green and every cover blank.
 */
describe("the web branch", () => {
  beforeAll(() => platform("web"));
  afterAll(() => platform("ios"));

  const img = (view: Rendered) => view.getByTestId("focal-image-web");

  it("starts hidden and reveals itself when the image loads", async () => {
    const view = await render(
      <FocalImage source={{ uri: coverUrl(PUBLIC, "card") as string }} />,
    );
    const node = img(view);

    // Hidden to begin with, so it can cross-fade up from the genre gradient
    // its callers layer underneath.
    expect(node.props.style.opacity).toBe(0);
    expect(node.props.style.transition).toContain("opacity");

    const target = { style: { opacity: "0" } };
    await act(async () => {
      node.props.onLoad({ currentTarget: target });
    });
    expect(target.style.opacity).toBe("1");
  });

  it("reveals an already-cached image the load event will never fire for", async () => {
    // The exact race the native side had: a cached image can finish before
    // React attaches `onLoad`, and an element left at 0 with no event coming
    // is invisible for good.
    const view = await render(
      <FocalImage source={{ uri: coverUrl(PUBLIC, "card") as string }} />,
    );
    const cached = { complete: true, style: { opacity: "0" } };

    await act(async () => {
      img(view).props.ref(cached);
    });
    expect(cached.style.opacity).toBe("1");
  });

  it("remounts on a new source, so a regenerated cover fades rather than pops", async () => {
    // Opacity is written imperatively, outside React, and React rewrites only
    // the style keys that changed -- `opacity: 0` is in both renders, so the
    // `1` from the previous load would survive and the new art would appear at
    // full strength. `key` on the uri makes it a new element.
    const view = await render(
      <FocalImage source={{ uri: coverUrl(PUBLIC, "card") as string }} />,
    );
    expect(img(view).props.src).toBe(coverUrl(PUBLIC, "card"));

    const regenerated =
      "https://p.supabase.co/storage/v1/object/public/covers/covers/abc/cover-2.png";
    await view.rerender(
      <FocalImage source={{ uri: coverUrl(regenerated, "card") as string }} />,
    );
    expect(img(view).props.src).toBe(coverUrl(regenerated, "card"));
    // A fresh element, so the previous load's inline `1` is gone.
    expect(img(view).props.style.opacity).toBe(0);
  });

  it("still asks for the transformed URL", async () => {
    const view = await render(
      <FocalImage source={{ uri: coverUrl(PUBLIC, "mini") as string }} />,
    );
    expect(img(view).props.src).toContain("/render/image/public/");
    expect(img(view).props.src).toContain(`width=${COVER_WIDTHS.mini}`);
  });
});

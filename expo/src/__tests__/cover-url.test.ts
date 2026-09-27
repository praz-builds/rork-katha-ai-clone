/**
 * `coverUrl`, which is where the 28x saving actually comes from.
 *
 * The numbers this is built on were measured against the live project on
 * 2026-09-27, not estimated:
 *
 *   original PNG                             1,978,908 bytes
 *   ?width=350&quality=60, no Accept           865,744 bytes  (still PNG)
 *   ?width=350&quality=60, Accept image/webp    70,810 bytes
 *
 * So the rewrite and the header are two halves of one change, and the header
 * half is invisible if you only check that the image still appears. The last
 * test here is the one that pins them together.
 *
 * Everything else is about NOT breaking an image. A reader's uploaded cover, a
 * bundled asset, a URL from another host: being wrong has to mean "no faster",
 * never "no image".
 */
import {
  COVER_ACCEPT_HEADERS,
  COVER_WIDTHS,
  coverUrl,
  isTransformedCover,
} from "@/lib/cover-url";

const PUBLIC =
  "https://iafeuxgoiknncgyjmugd.supabase.co/storage/v1/object/public/covers/covers/abc-123/cover.png";
const RENDERED =
  "https://iafeuxgoiknncgyjmugd.supabase.co/storage/v1/render/image/public/covers/covers/abc-123/cover.png";

it("rewrites a Supabase public cover to the transform endpoint", () => {
  expect(coverUrl(PUBLIC, "card")).toBe(`${RENDERED}?width=350&quality=60&resize=cover`);
});

it("asks for a width that suits the surface", () => {
  expect(coverUrl(PUBLIC, "mini")).toContain(`width=${COVER_WIDTHS.mini}`);
  expect(coverUrl(PUBLIC, "card")).toContain(`width=${COVER_WIDTHS.card}`);
  expect(coverUrl(PUBLIC, "hero")).toContain(`width=${COVER_WIDTHS.hero}`);
  // Ordered, because a hero that asks for less than a card would be a typo
  // nothing else would catch.
  expect(COVER_WIDTHS.mini).toBeLessThan(COVER_WIDTHS.card);
  expect(COVER_WIDTHS.card).toBeLessThan(COVER_WIDTHS.hero);
});

it("leaves alone everything that is not a Supabase public cover", () => {
  // Each of these reaches `FocalImage` unchanged and still renders.
  for (const url of [
    "https://elsewhere.test/someone-elses-upload.jpg",
    "data:image/png;base64,iVBORw0KGgo=",
    "file:///var/tmp/local.png",
    "/storage/v1/object/public/covers/relative.png".replace("/storage", "/nope"),
  ]) {
    expect(coverUrl(url, "card")).toBe(url);
  }
});

it("answers null for nothing, rather than a broken URL", () => {
  expect(coverUrl(null, "card")).toBeNull();
  expect(coverUrl(undefined, "card")).toBeNull();
  expect(coverUrl("", "card")).toBeNull();
});

it("never transforms twice", () => {
  // Two callers resizing the same URL -- the mapping layer and a component --
  // must not produce `?width=350?width=232`. The first width wins, because
  // whoever set it chose it.
  const once = coverUrl(PUBLIC, "card");
  expect(coverUrl(once, "mini")).toBe(once);
  expect(coverUrl(once, "hero")).toBe(once);
});

it("leaves a URL that already carries a query string", () => {
  // Appending to one would mean parsing it, and this codebase does not produce
  // a public-object URL with a query in the first place.
  const signed = `${PUBLIC}?token=abc`;
  expect(coverUrl(signed, "card")).toBe(signed);
});

it("marks exactly the URLs that need the WebP Accept header", () => {
  // The pairing that makes the saving real: `FocalImage` attaches the header
  // to precisely the URLs this module rewrote. Without it the same URL comes
  // back as an 866 KB PNG instead of a 71 KB WebP, and nothing looks wrong.
  expect(isTransformedCover(coverUrl(PUBLIC, "card"))).toBe(true);
  expect(isTransformedCover(PUBLIC)).toBe(false);
  expect(isTransformedCover("https://elsewhere.test/mine.jpg")).toBe(false);
  expect(isTransformedCover(null)).toBe(false);

  expect(COVER_ACCEPT_HEADERS.Accept).toContain("image/webp");
  // `*/*` on the end, so a host that cannot produce WebP still answers.
  expect(COVER_ACCEPT_HEADERS.Accept).toContain("*/*");
});

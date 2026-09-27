/**
 * Ask Supabase for a cover at the size it is about to be drawn at.
 *
 * THE PROBLEM, MEASURED. A published cover is a full-size PNG in the `covers`
 * bucket -- a real one sampled from production on 2026-09-27 is **1,978,908
 * bytes**, 832x1248. Explore draws it into a box about 116x155pt. Every card
 * downloads and decodes two megabytes to paint a thumbnail, six at a time,
 * and that is the whole of why the list takes so long to fill in.
 *
 * Supabase's image transformation endpoint is enabled on this project.
 * Rewriting `/object/public/` to `/render/image/public/` and asking for a
 * width turns the same cover into **70,810 bytes** at `width=350&quality=60`:
 * a 28x reduction, verified against the live URL rather than estimated.
 *
 * THE CATCH, AND IT IS THE WHOLE TRICK. That 70 KB is WebP, and Supabase
 * decides WebP from the request's `Accept` header, not from a query
 * parameter -- there is no `format=webp`. The identical URL fetched without
 * `Accept: image/webp` comes back as PNG at **865,744 bytes**. Better than two
 * megabytes, twelve times worse than it needs to be. So the header is not a
 * detail of the image component; it is the other half of this file's job, and
 * `FocalImage` sends it. Change one without the other and the win mostly
 * evaporates with nothing failing.
 *
 * WHY A NO-OP IS ALWAYS SAFE. A reader's uploaded cover, a bundled asset, a
 * data URI, a URL from some other host, `null` -- none of them match, and
 * every one of them falls through to the original string untouched. Being
 * wrong here has to mean "no faster", never "no image".
 */

/** The public-object path segment, and what it becomes for a transform. */
const OBJECT_SEGMENT = "/storage/v1/object/public/";
const RENDER_SEGMENT = "/storage/v1/render/image/public/";

/**
 * The width to request per surface, in source pixels.
 *
 * Roughly 3x the layout size, so the art still looks right on a 3x screen and
 * on the widest phone in each band. Going finer than this is measuring noise:
 * the step from 2 MB to 70 KB is the change, and 350 versus 320 is not.
 */
export const COVER_WIDTHS = {
  /** Explore, Library and Home rail cards: ~116pt wide. */
  card: 350,
  /** The story page hero. */
  hero: 800,
  /**
   * `Cover size="mini"`: Library shelves and author pages. **96pt**, which is
   * `miniCover`'s literal width in `KathaPrimitives`, not the 74pt this said
   * when it was written against the reader's chrome. 232 was 3x of 74 and only
   * 2.4x of 96, which would have made those thumbnails softer on a 3x screen
   * than they were before any of this -- a regression dressed as an
   * optimisation. Measure the box, then multiply.
   */
  mini: 288,
} as const;

export type CoverSize = keyof typeof COVER_WIDTHS;

/**
 * The `Accept` every transformed cover must be fetched with.
 *
 * Without it Supabase serves the original format and the transform saves an
 * order of magnitude less. `*\/*` stays on the end so a host that cannot
 * produce WebP still answers with something.
 */
export const COVER_ACCEPT_HEADERS = { Accept: "image/webp,*/*" } as const;

/**
 * `url` rewritten to ask for `size`, or `url` unchanged when it is not a
 * Supabase public-object URL.
 *
 * Idempotent: a URL already pointing at the render endpoint is returned as it
 * is rather than transformed twice, so a caller that resizes at both the
 * mapping layer and the component does not produce `?width=350?width=350`.
 */
export function coverUrl(
  url: string | null | undefined,
  size: CoverSize,
): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  // Already a transform URL: whoever built it chose a width, and re-deciding
  // it here would silently override them.
  if (url.includes(RENDER_SEGMENT)) return url;
  if (!url.includes(OBJECT_SEGMENT)) return url;
  // A query string on a public-object URL is not something this codebase
  // produces, and appending to one would mean parsing it. Leave it alone.
  if (url.includes("?")) return url;

  return `${url.replace(OBJECT_SEGMENT, RENDER_SEGMENT)}?width=${
    COVER_WIDTHS[size]
  }&quality=60&resize=cover`;
}

/**
 * True when `url` is one this module rewrote, and therefore one that must be
 * fetched with `COVER_ACCEPT_HEADERS` to get WebP rather than PNG.
 *
 * `FocalImage` uses this to decide whether to attach the header at all: a
 * bundled asset or somebody's uploaded cover gains nothing from it and a
 * header on a `require`d asset is meaningless.
 */
export function isTransformedCover(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes(RENDER_SEGMENT);
}

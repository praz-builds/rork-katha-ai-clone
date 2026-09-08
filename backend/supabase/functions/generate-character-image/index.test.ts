// A style reference is optional, bounded, and never an arbitrary data URL.
//
// The product decision (2026-09-08) lets a writer attach a photo to steer a
// character's look. That makes this endpoint the one place in the codebase
// where a user hands us an image, so what it accepts is a security boundary
// and not merely validation.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReferenceImage } from "./index.ts";

const PIXEL = "iVBORw0KGgoAAAANSUhEUg==";

Deno.test("an absent reference is fine, and is not an error", () => {
  // Attaching a photo is optional; every character sheet written before this
  // feature existed must keep working unchanged.
  assertEquals(parseReferenceImage(undefined), {});
  assertEquals(parseReferenceImage(null), {});
});

Deno.test("a JPEG, PNG or WebP data URL is accepted", () => {
  for (const type of ["jpeg", "jpg", "png", "webp"]) {
    const url = `data:image/${type};base64,${PIXEL}`;
    assertEquals(parseReferenceImage(url), { value: url });
  }
});

Deno.test("SVG is refused, however image-shaped it looks", () => {
  // The reason this is an allowlist and not `startsWith("data:image/")`: SVG is
  // a document, not a bitmap. It can carry script and remote references, and it
  // is the one "image" type that must never reach a parser or be echoed back.
  const result = parseReferenceImage(
    `data:image/svg+xml;base64,${PIXEL}`,
  );
  assert("error" in result);
});

Deno.test("a non-image data URL is refused", () => {
  for (
    const value of [
      `data:text/html;base64,${PIXEL}`,
      `data:application/pdf;base64,${PIXEL}`,
      "https://example.test/photo.jpg",
      "javascript:alert(1)",
    ]
  ) {
    assert("error" in parseReferenceImage(value), `${value} was accepted`);
  }
});

Deno.test("a non-string, or an empty string, is refused rather than ignored", () => {
  // Silently dropping a malformed reference would hand the writer a portrait
  // that ignored the one input they cared most about, while reporting success.
  for (const value of [42, true, {}, [], ""]) {
    assert("error" in parseReferenceImage(value));
  }
});

Deno.test("an oversized reference is refused at the boundary, not at the model", () => {
  const huge = `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}`;
  const result = parseReferenceImage(huge);
  assert("error" in result);
  assertEquals(result.error, "reference_image is too large");

  // Just inside the cap still passes, so the bound is a bound and not a
  // blanket refusal of anything large.
  const prefix = "data:image/png;base64,";
  const ok = prefix + "A".repeat(6 * 1024 * 1024 - prefix.length);
  assert(!("error" in parseReferenceImage(ok)));
});

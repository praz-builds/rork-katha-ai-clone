/**
 * The two generation paths must persist a cast the same way.
 *
 * `generate-story` and `generate-story-stream` each build their own
 * `characters` insert. That duplication is deliberate - they differ in almost
 * everything around it - but it means a column added to one can be silently
 * missing from the other, and the symptom is a portrait the writer generated
 * and paid for quietly not being saved.
 *
 * This is a source-level check rather than a behavioural one because both
 * inserts live inside `serve()` handlers with live Supabase clients, and there
 * is no seam to stub. Reading the source is blunt, but it catches the exact
 * drift that happened here and costs nothing to keep.
 */

import { assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const PATHS = {
  buffered: "supabase/functions/generate-story/index.ts",
  streamed: "supabase/functions/generate-story-stream/index.ts",
};

/** The fields a cast row is built from, as written in both inserts. */
const CAST_FIELDS = [
  "story_id",
  "name",
  "description",
  "background",
  "appearance",
  "portrait_url",
  "is_hero",
];

async function sourceOf(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../../../${path}`, import.meta.url));
}

Deno.test("both generation paths persist every cast field", async () => {
  const buffered = await sourceOf(PATHS.buffered);
  const streamed = await sourceOf(PATHS.streamed);

  for (const field of CAST_FIELDS) {
    assert(
      buffered.includes(`${field}:`),
      `generate-story drops ${field} from its characters insert`,
    );
    assert(
      streamed.includes(`${field}:`),
      `generate-story-stream drops ${field} from its characters insert. ` +
        `A field added to one path has to be added to the other.`,
    );
  }
});

Deno.test("a pre-generated portrait reaches persistence on both paths", async () => {
  // The specific regression: `portrait_url` was added to the buffered path when
  // draft portraits shipped, and the streamed path - which is what users
  // actually hit - was written separately and never got it.
  for (const [name, path] of Object.entries(PATHS)) {
    const source = await sourceOf(path);
    assert(
      source.includes("portrait_url: c.portraitUrl"),
      `${name} does not carry the draft portrait through to the character row`,
    );
  }
});

/**
 * Katha Originals: check the slate, then build each cover prompt with the
 * production prompt builder.
 *
 *   deno run --allow-read --allow-write backend/originals/build-cover-prompts.ts
 *
 * Every brief's `request` goes through the same `validateGenerationRequest`
 * that `generate-story` runs, so a brief that passes here is one the pipeline
 * accepts unchanged. The cover prompt is built by the real `buildCoverPrompt`
 * with the inputs production passes it (`image.ts`, safety level 0), so a cover
 * made from it tests the prompt system rather than a hand-written prompt.
 *
 * The cast checks exist because a slate of house stories that share names,
 * faces or roles reads as one generator's defaults, not thirteen books.
 */
import { buildCoverPrompt } from "../supabase/functions/_shared/cover-prompts.ts";
import { BANNED_NAMES } from "../supabase/functions/_shared/ban-lists.ts";
import { validateGenerationRequest } from "../supabase/functions/_shared/validation.ts";

type Character = {
  name: string;
  isHero?: boolean;
  background?: string;
  appearance?: string;
};
type Brief = {
  slug: string;
  title: string;
  logline: string;
  themes: string[];
  request: Record<string, unknown> & {
    primary_genre: string;
    image_style: string;
    where_and_when?: string;
    avoid?: string;
    characters: Character[];
  };
};

const here = new URL(".", import.meta.url);
const checkOnly = Deno.args.includes("--check");

// Every briefs*.json file is one slate: names must be unique across all of
// them, so batches written in parallel cannot quietly share a cast.
const files: string[] = [];
for await (const entry of Deno.readDir(here)) {
  if (/^briefs.*\.json$/.test(entry.name)) files.push(entry.name);
}
files.sort();
const slate = { stories: [] as Brief[] };
for (const file of files) {
  const parsed = JSON.parse(await Deno.readTextFile(new URL(file, here)));
  slate.stories.push(...(parsed.stories as Brief[]));
}

const problems: string[] = [];
const seenNames = new Map<string, string>();
const seenTitles = new Set<string>();
const seenSlugs = new Set<string>();

// Title words ("Mrs", "Captain", "Dr") are not names; the rest of every name
// must be unique across the slate, first and last alike.
const HONORIFICS = new Set([
  "mrs", "mr", "miss", "ms", "dr", "captain", "major", "don", "lola",
  "grandmother", "nana", "the", "of", "hanim",
]);

for (const brief of slate.stories) {
  const where = `${brief.slug}:`;
  if (seenSlugs.has(brief.slug)) problems.push(`${where} duplicate slug`);
  seenSlugs.add(brief.slug);
  if (seenTitles.has(brief.title.toLowerCase())) {
    problems.push(`${where} duplicate title`);
  }
  seenTitles.add(brief.title.toLowerCase());

  const validated = validateGenerationRequest({
    ...brief.request,
    request_id: crypto.randomUUID(),
  });
  if ("error" in validated) {
    problems.push(`${where} pipeline rejects request: ${validated.error}`);
  }

  const cast = brief.request.characters;
  if (cast.filter((c) => c.isHero).length !== 1) {
    problems.push(`${where} needs exactly one hero`);
  }
  for (const character of cast) {
    if (!character.appearance?.trim() || !character.background?.trim()) {
      problems.push(`${where} ${character.name} lacks appearance or background`);
    }
    const tokens = character.name.toLowerCase().replace(/['"]/g, " ")
      .split(/[\s-]+/).filter((t) => t && !HONORIFICS.has(t));
    for (const token of tokens) {
      const owner = seenNames.get(token);
      if (owner && owner !== brief.slug) {
        problems.push(`${where} name "${token}" already used in ${owner}`);
      }
      seenNames.set(token, brief.slug);
      if (BANNED_NAMES.some((banned) => banned.toLowerCase() === token)) {
        problems.push(`${where} "${token}" is on the banned AI-default names list`);
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  Deno.exit(1);
}
if (checkOnly) {
  console.log(`${slate.stories.length} briefs across ${files.length} files: all valid, no shared names.`);
  Deno.exit(0);
}

/*
  ORIGINALS-ONLY corrections to the production prompt, found by the 2026-09-18
  cover review (both models failed the same way, so the prompt is the cause):

  1. "scene" genres (comedy, educational, sliceOfLife, ...) send no cast, so the
     model invents the people. Here the lead's look is added as it is for the
     "portrait" genres.
  2. The composition line says the upper third is cropped away in a landscape
     hero. The hero is now 62% of the screen and nearly portrait: the top ~15%
     sits under the status bar and controls and the bottom ~45% dissolves into
     the page. Faces belong in the middle band.

  Production's buildCoverPrompt is deliberately NOT changed here; that fix
  belongs with the prompt work in its own branch.
*/
const SCENE_GENRES = new Set([
  "comedy", "educational", "sliceOfLife", "contemporary", "cozyFantasy",
  "poetry", "bedtime",
]);
const STALE_CROP =
  "Keep the upper third relatively quiet -- it is cropped away in the landscape hero.";
const CROP_NOTE =
  "Keep the top 15% of the image free of faces and important detail, and place the main character's face between 20% and 50% of the image height; the bottom third may fade out.";

function originalsPrompt(brief: Brief, base: string): string {
  let prompt = base.includes(STALE_CROP)
    ? base.replace(STALE_CROP, CROP_NOTE)
    : `${base} ${CROP_NOTE}`;
  if (SCENE_GENRES.has(brief.request.primary_genre)) {
    const lead = brief.request.characters.find((c) => c.isHero) ??
      brief.request.characters[0];
    if (lead?.appearance) {
      prompt = prompt.replace(
        "Wardrobe:",
        `Feature the story's lead character: ${lead.appearance}. Wardrobe:`,
      );
    }
  }
  return prompt;
}

const prompts = slate.stories.map((brief) => ({
  slug: brief.slug,
  title: brief.title,
  genre: brief.request.primary_genre,
  artStyle: brief.request.image_style,
  prompt: originalsPrompt(
    brief,
    buildCoverPrompt(
      brief.request.primary_genre,
      brief.title,
      brief.themes,
      brief.request.characters,
      brief.request.where_and_when,
      brief.request.avoid,
      undefined,
      brief.request.image_style,
    ),
  ),
}));

await Deno.writeTextFile(
  new URL("cover-prompts.json", here),
  JSON.stringify(prompts, null, 2) + "\n",
);
const chapters = slate.stories.reduce(
  (sum, b) => sum + Number(b.request.planned_chapter_count),
  0,
);
console.log(
  `${prompts.length} briefs valid, ${seenNames.size} unique name parts, ${chapters} chapters planned. Wrote cover-prompts.json`,
);

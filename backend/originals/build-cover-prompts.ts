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
const slate = JSON.parse(
  await Deno.readTextFile(new URL("briefs.json", here)),
) as { stories: Brief[] };

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

const prompts = slate.stories.map((brief) => ({
  slug: brief.slug,
  title: brief.title,
  genre: brief.request.primary_genre,
  artStyle: brief.request.image_style,
  prompt: buildCoverPrompt(
    brief.request.primary_genre,
    brief.title,
    brief.themes,
    brief.request.characters,
    brief.request.where_and_when,
    brief.request.avoid,
    undefined,
    brief.request.image_style,
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

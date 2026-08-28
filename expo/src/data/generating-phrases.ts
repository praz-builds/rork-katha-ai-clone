import type { Genre } from "@/types/domain";

/**
 * A phrase template. Text before `|` is the prefix, text after is the
 * highlighted keyword (rendered in italic serif). If no `|`, the whole
 * string is the prefix and there is no keyword.
 */
type PhraseTemplate = string;

const SHARED: PhraseTemplate[] = [
  "Finding the|first line",
  "Shaping the|opening scene",
  "Building the world around your idea",
  "Choosing the|right words",
  "Letting the characters|introduce themselves",
  "Plotting the|turning point",
  "Weaving|conflict into the story",
  "Tuning the|narrator's voice",
  "Sketching the|emotional arc",
  "Writing the scene that|changes everything",
];

const GENRE_PHRASES: Record<Genre, PhraseTemplate[]> = {
  romance: [
    "Setting up the|meet-cute",
    "Building|romantic tension",
    "Writing the moment|everything shifts",
    "Finding the right words for|longing",
  ],
  romantasy: [
    "Conjuring a world of|magic and desire",
    "Forging the bond between|sword and heart",
    "Threading|fate through the story",
  ],
  darkRomance: [
    "Darkening the|edges",
    "Twisting|loyalty into longing",
    "Sharpening the tension between|danger and want",
  ],
  fantasy: [
    "Summoning the world from|nothing",
    "Drawing the map of|somewhere impossible",
    "Breathing life into|ancient magic",
    "Setting it in a world of|kingdoms",
  ],
  scifi: [
    "Booting up the|universe",
    "Calibrating the|timeline",
    "Running|first-contact protocols",
    "Setting it in a world of|starships",
  ],
  thriller: [
    "Planting the|first clue",
    "Tightening the|screws",
    "Hiding the truth in|plain sight",
  ],
  mystery: [
    "Scattering the|evidence",
    "Introducing the|suspects",
    "Burying the real answer|deeper",
  ],
  horror: [
    "Dimming the|lights",
    "Listening for what|shouldn't be there",
    "Making the familiar feel|wrong",
  ],
  contemporary: [
    "Grounding the story in|real life",
    "Finding the|quiet drama",
    "Capturing an ordinary moment that|isn't",
  ],
  historical: [
    "Stepping back in|time",
    "Researching the|period details",
    "Giving voice to a|forgotten era",
  ],
  adventure: [
    "Charting the|unknown",
    "Packing for the|journey",
    "Crossing the threshold into|danger",
  ],
  comedy: [
    "Timing the|punchline",
    "Setting up the|absurd",
    "Making sure it|lands",
  ],
  poetry: [
    "Listening for the|rhythm",
    "Counting|syllables and silence",
    "Finding the image that|carries it all",
  ],
};

const CONTINUATION: PhraseTemplate[] = [
  "Picking up where we|left off",
  "Advancing the|plot",
  "Raising the|stakes",
  "Deepening the|characters",
  "Writing the next|turning point",
  "Threading earlier details|forward",
  "Building toward the|climax",
];

const FINALE: PhraseTemplate[] = [
  "Writing the|final chapter",
  "Resolving the|central thread",
  "Landing every|character arc",
  "Calling back to|where it began",
  "Earning the|last line",
];

export type ParsedPhrase = { prefix: string; keyword: string | null };

/** Parse a phrase template into prefix + optional keyword. */
export function parsePhrase(template: string): ParsedPhrase {
  const idx = template.indexOf("|");
  if (idx === -1) return { prefix: template, keyword: null };
  return {
    prefix: template.slice(0, idx),
    keyword: template.slice(idx + 1),
  };
}

/** Secondary status line shown below the main phrase. */
const STATUS_LINES: Record<"story" | "chapter" | "finale", string[]> = {
  story: [
    "Writing the story profile...",
    "Generating your draft...",
    "Crafting the narrative...",
    "Assembling the plot...",
  ],
  chapter: [
    "Continuing the story...",
    "Writing the next chapter...",
    "Advancing the narrative...",
  ],
  finale: [
    "Writing the conclusion...",
    "Bringing it all together...",
    "Resolving the story...",
  ],
};

/**
 * Returns shuffled phrase templates and a random status line for the overlay.
 */
export function getGeneratingPhrases(
  genre: Genre,
  mode: "story" | "chapter" | "finale" = "story",
): { phrases: string[]; statusLine: string } {
  let pool: string[];
  if (mode === "finale") pool = [...FINALE, ...SHARED.slice(0, 3)];
  else if (mode === "chapter") pool = [...CONTINUATION, ...SHARED.slice(0, 4)];
  else pool = [...(GENRE_PHRASES[genre] ?? []), ...SHARED];

  const statusPool = STATUS_LINES[mode];
  return {
    phrases: shuffle(pool),
    statusLine: statusPool[Math.floor(Math.random() * statusPool.length)],
  };
}

function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

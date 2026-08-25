/**
 * Genre-specific cover image prompt templates for DALL-E 3.
 *
 * Each genre defines a visual style, color palette, composition guidance,
 * and mood keywords. These are combined with story-specific details
 * (title, themes, characters) to generate a cohesive cover prompt.
 */

interface GenrePromptConfig {
  style: string;
  palette: string;
  composition: string;
  mood: string;
  characterApproach: "scene" | "silhouette" | "portrait";
}

const GENRE_PROMPTS: Record<string, GenrePromptConfig> = {
  romance: {
    style:
      "warm illustrated style, soft painterly brushstrokes, intimate lighting, editorial book cover quality",
    palette: "warm corals, sunset oranges, blush pinks, soft gold highlights",
    composition:
      "close framing, meaningful object or two figures in gentle proximity, soft bokeh background",
    mood: "intimate, tender, yearning",
    characterApproach: "portrait",
  },
  fantasy: {
    style:
      "epic fantasy illustration, rich painterly detail, ornate decorative elements, atmospheric depth",
    palette:
      "deep emerald greens, royal purples, antique gold, moonlit silver",
    composition:
      "sweeping landscape or silhouetted figure against magical sky, ornate border elements",
    mood: "mystical, grand, wonder",
    characterApproach: "silhouette",
  },
  romantasy: {
    style:
      "lush fantasy illustration with romantic warmth, detailed and elegant, rich jewel-tone atmosphere",
    palette:
      "deep amethyst purple, rose gold, midnight blue, warm candlelight amber",
    composition:
      "figure amid magical elements, enchanted setting with romantic tension, swirling magical particles",
    mood: "enchanted, passionate, mythic",
    characterApproach: "portrait",
  },
  mystery: {
    style:
      "noir illustration, high contrast, dramatic chiaroscuro lighting, cinematic tension",
    palette:
      "dark slate, deep navy, single red accent, desaturated tones with warm lamplight",
    composition:
      "single ominous object or shadowed doorway, deep perspective, atmospheric fog or rain",
    mood: "tension, intrigue, foreboding",
    characterApproach: "silhouette",
  },
  thriller: {
    style:
      "stark cinematic illustration, bold angular shadows, urgent composition, photorealistic edge",
    palette:
      "pure black background, bright crimson accent, cold steel grey, harsh white highlights",
    composition:
      "isolated figure or object, diagonal lines creating urgency, claustrophobic framing",
    mood: "danger, adrenaline, high stakes",
    characterApproach: "silhouette",
  },
  horror: {
    style:
      "dark atmospheric illustration, desaturated with unsettling undertones, subtle dread",
    palette:
      "near-monochromatic greys, sickly muted green or blood red accent, deep shadow",
    composition:
      "shadows and negative space, something partially hidden, incomplete forms, fog or darkness",
    mood: "dread, unease, visceral",
    characterApproach: "silhouette",
  },
  scifi: {
    style:
      "retro-futuristic illustration, clean geometric lines, neon glow effects, metallic textures",
    palette:
      "deep space black, electric cyan, neon magenta, cool chrome, holographic accents",
    composition:
      "expansive cosmic vista or character silhouette against technological backdrop, geometric framing",
    mood: "wonder, vast, alien",
    characterApproach: "silhouette",
  },
  adventure: {
    style:
      "bold cinematic illustration, dynamic action energy, saturated color, wide establishing shot",
    palette:
      "warm amber, sunset orange, deep ocean teal, lush jungle green, golden highlights",
    composition:
      "sweeping landscape, tiny figure against vast environment, sense of scale and journey",
    mood: "excitement, exploration, discovery",
    characterApproach: "silhouette",
  },
  historical: {
    style:
      "rich period illustration, ornamental texture, aged paper quality, detailed and layered",
    palette:
      "warm sepia, aged gold, burgundy wine, ivory, rich earth tones",
    composition:
      "layered historical scene with period architecture, decorative border elements, textured surfaces",
    mood: "atmospheric, dignified, evocative",
    characterApproach: "portrait",
  },
  darkAcademia: {
    style:
      "moody gothic illustration, candlelit interiors, aged library aesthetic, oil painting texture",
    palette:
      "deep mahogany brown, aged ivory, forest green, antique gold, candlelight amber",
    composition:
      "shadowed hallway or candlelit study, leather-bound books, ivy-covered architecture",
    mood: "intellectual, brooding, secretive",
    characterApproach: "silhouette",
  },
  drama: {
    style:
      "emotional painterly illustration, expressive brushwork, literary fiction aesthetic",
    palette:
      "muted earth tones, overcast greys, single warm accent, soft natural light",
    composition:
      "contemplative scene, generous negative space, single meaningful object, window light",
    mood: "reflective, bittersweet, human",
    characterApproach: "scene",
  },
  sliceOfLife: {
    style:
      "warm cozy illustration, gentle watercolor texture, soft afternoon light, everyday beauty",
    palette:
      "warm caramel, soft sage green, dusty rose, cream, golden hour amber",
    composition:
      "intimate everyday scene, kitchen table or window seat, warm interior with soft shadows",
    mood: "warm, nostalgic, comforting",
    characterApproach: "scene",
  },
  mythology: {
    style:
      "mythological illustration, bold ancient art influence, temple fresco or mural quality",
    palette:
      "deep terracotta, burnished bronze, saffron yellow, temple red, dark indigo",
    composition:
      "deity or mythical creature in powerful pose, celestial elements, sacred geometry patterns",
    mood: "epic, ancient, sacred",
    characterApproach: "portrait",
  },
  poetry: {
    style:
      "ethereal abstract illustration, dreamy watercolor washes, minimalist and lyrical",
    palette:
      "soft lavender, misty grey-blue, pale rose, translucent whites, ink black accents",
    composition:
      "abstract or semi-abstract forms, flowing organic shapes, generous white space, single delicate element",
    mood: "ethereal, contemplative, luminous",
    characterApproach: "scene",
  },
  comedy: {
    style:
      "vibrant pop illustration, bold outlines, playful exaggeration, bright and energetic",
    palette:
      "sunshine yellow, electric blue, hot pink, lime green, pure white highlights",
    composition:
      "absurd or unexpected scene, exaggerated proportions, playful arrangement of objects",
    mood: "joyful, witty, irreverent",
    characterApproach: "scene",
  },
  bedtime: {
    style:
      "soft dreamy illustration, gentle moonlit glow, soothing rounded shapes, storybook warmth",
    palette:
      "midnight navy, soft moonlight silver, warm amber glow, deep indigo, gentle lavender",
    composition:
      "nightscape with gentle moon, cozy scene with warm lamp light, starlit sky, peaceful setting",
    mood: "calm, soothing, magical",
    characterApproach: "scene",
  },
};

/**
 * Build a DALL-E 3 prompt for a story cover image.
 *
 * The prompt intentionally avoids requesting text-on-image (titles are
 * composited programmatically after generation).
 */
export function buildCoverPrompt(
  genre: string,
  title: string,
  themes: string[],
  characters?: { name: string; description: string }[],
): string {
  const config = GENRE_PROMPTS[genre] ?? GENRE_PROMPTS.drama;

  let sceneDescription = `Inspired by the story "${title}"`;
  if (themes.length > 0) {
    sceneDescription += `, with themes of ${themes.slice(0, 4).join(", ")}`;
  }

  let characterNote = "";
  if (
    characters &&
    characters.length > 0 &&
    config.characterApproach !== "scene"
  ) {
    const hero = characters.find((c) =>
      "isHero" in c ? (c as { isHero: boolean }).isHero : false
    ) ?? characters[0];
    if (config.characterApproach === "silhouette") {
      characterNote = `. Include a distant silhouetted figure suggesting ${hero.description}`;
    } else {
      characterNote = `. Feature a character: ${hero.description}, shown from shoulders up or three-quarter view`;
    }
  }

  return [
    `Book cover illustration for a ${genre} story.`,
    `Visual style: ${config.style}.`,
    `Color palette: ${config.palette}.`,
    `Composition: ${config.composition}.`,
    `Mood: ${config.mood}.`,
    `${sceneDescription}${characterNote}.`,
    `The image must contain NO text, NO titles, NO words, NO letters, NO watermarks. Pure illustration only.`,
    `Portrait orientation, high quality, professional book cover art.`,
  ].join(" ");
}

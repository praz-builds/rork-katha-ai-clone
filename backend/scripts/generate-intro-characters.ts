#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
/**
 * Draws the two cast members the onboarding intro is built around, and the
 * cover their story ends up on (`expo/src/screens/KathaOnboarding.jsx`).
 *
 * WHY A SCRIPT AND NOT A ONE-OFF CURL. Same reason as
 * `generate-testimonial-portraits.ts`: these files will be replaced by name
 * later, and the prompts ARE the spec for the replacements. The intro types an
 * appearance line on screen and then shows what Katha drew from it — if the
 * file and the typed line ever drift apart, the screen is lying about the
 * product. Keeping both in one table is what stops that.
 *
 * THE PROMPT IS THE PRODUCTION ONE. `portraitPrompt` below is
 * `buildPortraitPrompt` from `supabase/functions/_shared/image.ts` with the
 * appearance substituted and nothing else changed. The intro must show what
 * the real pipeline really draws, not a prettier hand-tuned variant.
 *
 * WHAT IT WRITES, per character:
 *   <slug>-portrait.png  450x630, flat #E4DCD0 ground — the house portrait
 *                        spec (`expo/assets/onboarding/stage-*.webp`).
 *   <slug>-cutout.png    the same drawing with the flat ground removed, for
 *                        compositing over the intro's own surfaces.
 * and once:
 *   cover-trek.png       1024x1024, both characters, the story's cover.
 *
 * THE CUTOUT IS DERIVED, NOT GENERATED. Asking the model for transparency
 * gives you a checkerboard painted into the pixels about a third of the time.
 * Generating on a known flat ground and flood-filling it away from the borders
 * is deterministic, and it cannot eat a hole out of the middle of the figure
 * the way a global colour-distance threshold does — a grey shirt is within
 * tolerance of #E4DCD0 and a threshold pass will punch straight through it.
 *
 * NO BORDER, EVER. The asset this replaces had an orange frame painted into
 * the image, which showed as a second edge inside the card it was drawn in.
 * `NO_FRAME_CLAUSE` is in the prompt and `assertNoFrame` checks the result,
 * because the prompt alone has not been enough historically.
 *
 * RUN:
 *   deno run --allow-env --allow-read --allow-write --allow-net \
 *     backend/scripts/generate-intro-characters.ts [slug ...|cover]
 */

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const MODEL = "google/gemini-2.5-flash-image";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OUT_DIR = new URL("../../expo/assets/onboarding/", import.meta.url);
const ENV_FILE = new URL("../.env", import.meta.url);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 120_000;

/** The house portrait shape: `expo/src/lib/onboarding-cast.ts`. */
const PORTRAIT_W = 450;
const PORTRAIT_H = 630;
const COVER_SIDE = 1024;

/** The flat ground every portrait is drawn on, as RGB. `colors.onboardingStone`. */
const GROUND = { r: 0xE4, g: 0xDC, b: 0xD0 };
/**
 * How far from the ground colour a pixel may sit and still be background.
 *
 * Generous, because the model renders a "flat" ground with a soft gradient and
 * a contact shadow under the feet. It is only ever applied to pixels the flood
 * fill has already reached from a border, so a garment in the same family as
 * the ground is never at risk — the figure is not connected to the edge.
 */
const GROUND_TOLERANCE = 52;

/**
 * The two people the intro is about, and the appearance line it types.
 *
 * `appearance` is what the user is shown typing into the APPEARANCE field on
 * screen 1, character for character. It is also the only thing fed to the
 * portrait prompt, exactly as the product does it: Appearance drives the
 * image, nothing else does.
 *
 * RAYA IS THE LEAD OF THE INTRO. She is drawn on screen 1 — the one character
 * the viewer watches being made — and Praz joins the cast on screen 2. The two
 * of them are deliberately different builds and different ages inside the same
 * South Asian register, because the stage cast (`onboarding-cast.ts`) makes the
 * same promise and a lead plus a clone of the lead does not make it.
 */
const CAST = [
  {
    slug: "raya",
    appearance:
      "An Indian woman in her twenties with curly black hair and round glasses. Athletic build, olive field jacket, worn hiking boots.",
  },
  {
    slug: "praz",
    appearance:
      "A tall South Indian man in his thirties. Blue denim shirt, sleeves rolled, grey jeans, brown boots, a calm steady gaze.",
  },
] as const;

/**
 * The cover the intro's story carries on screen 3.
 *
 * Both characters must be recognisable as the two just drawn, which is the one
 * thing a text prompt is weakest at. The appearance lines are restated in full
 * rather than referenced by name for that reason.
 */
const COVER_PROMPT = [
  "Book cover illustration for an adventure story.",
  `Two hikers together on a forest trail at night: ${CAST[0].appearance} ${CAST[1].appearance}`,
  "They stand close together facing the viewer in a still, dark pine forest under a deep blue night sky.",
  // STATED AS A RELATIONSHIP, not as two separate heights. Asked for
  // individually the model drew her at roughly two thirds of his height, which
  // read as an adult and a child rather than as two friends the same age.
  "She is as tall as he is. Draw the tops of their two heads at exactly the same level in the frame, and their eyes on the same horizontal line, as if a ruler laid across the picture touched both crowns. Both are adults.",
  "One of them holds a warm lantern that lights both their faces; everything beyond falls into cool darkness.",
  "Painterly book-illustration style, atmospheric, deep shadows with warm lamplight.",
  // THE FRAMING IS THE WHOLE POINT OF THIS PROMPT, not a nicety. One source
  // image is centre-cropped by every surface that shows it: a 70pt square
  // tile on Home, a 334x230 landscape band on the story page, and the same
  // three sizes the product's own covers are cut to (`cover-prompts.ts`,
  // SAFE_ZONE_CLAUSE). A wide establishing shot with two small figures low in
  // the frame survives none of those crops — the first draft of this cover was
  // exactly that, and the Home tile showed nothing but empty sky.
  // "Cut them off at the knees, do not show their feet" was tried and is the
  // wrong lever: pushing the figures DOWN out of frame pushes their heads UP
  // out of it, and two generations running came back with the taller
  // character's scalp clipped by the top edge. Asking for a standing full
  // shot, and letting the crop do the tightening, is what actually produced a
  // frame with both faces safely inside it.
  "Framing: a full standing shot of the two figures together, filling the middle of the frame and taking up most of the image height, with both faces clearly visible and lit. The forest is background only.",
  // SAFE_ZONE_CLAUSE, restated from `supabase/functions/_shared/cover-prompts.ts`
  // (it is a module-private const there; copied rather than exported so a
  // script does not widen a shared backend API). Verbatim except that it is
  // told about two faces instead of one, and about the crops this particular
  // image gets: a 70pt SQUARE tile on Home and a 334x230 WIDE band on the
  // story page. The wide one is the cruel one -- it keeps only the middle 69%
  // of a square source -- and the first cover that got this far had the taller
  // character's head at 3% of the image height, so the story page beheaded him.
  "Framing: keep the top 15% of the image free of faces and important detail; place BOTH faces between 20% and 50% of the image height and near the horizontal centre, so they survive a square crop and a wide 3:2 crop; the bottom third may be simple and fade out.",
  "There is a clear band of night sky and distant trees above both heads. Neither head touches or is cut by the top edge.",
  "The image must contain NO text, NO titles, NO words, NO letters, NO watermarks.",
  "No border, no frame, no decorative edge, no vignette; the illustration runs to every edge.",
  "Square 1:1 framing, high quality.",
].join(" ");

/**
 * `buildPortraitPrompt` from `supabase/functions/_shared/image.ts`, with the
 * `auto` art style (no style clause, no reminder) and no reference image —
 * which is what onboarding sends. Kept in the same order as the original so a
 * diff between the two is readable.
 */
function portraitPrompt(appearance: string): string {
  return [
    `Character portrait illustration of ${appearance}`,
    "Full body, standing, facing the viewer, on a plain neutral background.",
    "Painterly book-illustration style, soft even lighting, no background scenery.",
    // The flat ground is ours, not the product's: the product composites onto
    // whatever surface it is drawn on, and the intro needs a known colour to
    // subtract for the cutout.
    "The background is one flat, even, light warm grey colour (#E4DCD0) with no gradient, no texture and no scenery.",
    "The image must contain NO text, NO titles, NO words, NO letters, NO watermarks.",
    "No border, no frame, no decorative edge, no vignette; the illustration runs to every edge.",
    "Full-body portrait orientation, subject centered in frame, high quality.",
  // Repeated at the end, in the terms the failure actually takes: the model
  // returns a knee crop, not a headless figure, so the instruction names the
  // shoes and the space under them rather than saying "full body" again.
  "The WHOLE body is visible from the top of the head down to the shoes, with empty background visible below the shoes. Do not crop at the knees, thighs or waist.",
  ].join(" ");
}

/** `backend/.env` is the only place this key lives locally; it is gitignored. */
async function readKey(): Promise<string> {
  const fromEnv = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (fromEnv) return fromEnv;
  const text = await Deno.readTextFile(ENV_FILE);
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.+)\s*$/.exec(
      line,
    );
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(
    "OPENROUTER_API_KEY not found in the environment or backend/.env",
  );
}

function decodeBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function draw(prompt: string, apiKey: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://katha.ai",
        "X-Title": "Katha AI",
      },
      body: JSON.stringify({
        model: MODEL,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const payload = await res.json() as {
      choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    };
    const url = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    // No image on a 200 is this provider's refusal shape, not a transport bug.
    if (!url) {
      throw new Error(
        "no image in the response (content policy or unsupported modality)",
      );
    }
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      if (comma < 0) throw new Error("malformed data URL in the response");
      return decodeBase64(url.slice(comma + 1));
    }
    if (!/^https?:\/\//.test(url)) {
      throw new Error("image came back as neither a data URL nor an http link");
    }
    const image = await fetch(url, { signal: controller.signal });
    if (!image.ok) throw new Error(`image link ${image.status}`);
    return new Uint8Array(await image.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function channels(pixel: number) {
  return {
    r: (pixel >> 24) & 0xff,
    g: (pixel >> 16) & 0xff,
    b: (pixel >> 8) & 0xff,
    a: pixel & 0xff,
  };
}

function nearGround(pixel: number): boolean {
  const { r, g, b } = channels(pixel);
  return Math.abs(r - GROUND.r) + Math.abs(g - GROUND.g) +
      Math.abs(b - GROUND.b) < GROUND_TOLERANCE * 3;
}

/**
 * A painted-in frame is a ring of non-ground pixels hugging the edge.
 *
 * Sampled as "what fraction of the outermost ring is NOT the ground colour".
 * The old Praz asset scored about 1.0 here (a solid orange rectangle); a clean
 * generation scores near 0, because the ground runs to every edge. A figure
 * whose shoulder touches the frame lifts it a little, hence the loose bar.
 */
function frameScore(image: Image): number {
  let edge = 0;
  let foreign = 0;
  const check = (x: number, y: number) => {
    edge++;
    if (!nearGround(image.getPixelAt(x + 1, y + 1))) foreign++;
  };
  for (let x = 0; x < image.width; x++) {
    check(x, 0);
    check(x, image.height - 1);
  }
  for (let y = 1; y < image.height - 1; y++) {
    check(0, y);
    check(image.width - 1, y);
  }
  return edge ? foreign / edge : 0;
}

/**
 * How much of the bottom edge the subject is standing on.
 *
 * A portrait that is cropped at the knees scores high here, because the legs
 * run off the bottom of the frame; a full-body one scores near zero, because
 * there is ground under the feet. The prompt asks for head to feet in so many
 * words and the model still returns a knee crop often enough to need checking
 * -- the same lesson as the border and the cover's safe zone. `frameScore`
 * does not catch it: it averages all four edges, so one bad edge out of four
 * disappears into three clean ones.
 */
function bottomTouch(image: Image): number {
  let foreign = 0;
  const y = image.height - 1;
  for (let x = 0; x < image.width; x++) {
    if (!nearGround(image.getPixelAt(x + 1, y + 1))) foreign++;
  }
  return foreign / image.width;
}

/**
 * Remove the flat ground by flooding inward from every border pixel.
 *
 * Connectivity is the whole point: only background that the edge can reach is
 * cleared, so an olive jacket that happens to sit within tolerance of the
 * ground survives, and a gap between an arm and a torso is cleared correctly
 * because it is reachable around the hand. A plain threshold pass gets both of
 * those wrong.
 */
function cutout(source: Image): Image {
  const image = source.clone();
  const { width, height } = image;
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index]) return;
    seen[index] = 1;
    if (!nearGround(image.getPixelAt(x + 1, y + 1))) return;
    queue.push(index);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (queue.length) {
    const index = queue.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    image.setPixelAt(x + 1, y + 1, 0x00000000);
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  return image;
}

/**
 * Trim a uniform matte the model painted around the illustration.
 *
 * Gemini returns the cover inside a white margin often enough to need handling
 * rather than retrying blindly: the picture inside it is usually good, and
 * throwing away a good composition to re-roll a border is expensive. Walks in
 * from each edge while the whole row or column is within tolerance of the
 * corner colour, which is the shape a matte has and a photograph does not.
 *
 * Deliberately NOT used on the portraits. There the flat ground IS the image,
 * and trimming it would crop the figure to its own silhouette.
 */
function trimMatte(image: Image): number {
  const corner = image.getPixelAt(1, 1);
  const { r, g, b } = channels(corner);
  const matches = (pixel: number) => {
    const c = channels(pixel);
    return Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) < 30;
  };
  const rowIsMatte = (y: number) => {
    for (let x = 0; x < image.width; x++) {
      if (!matches(image.getPixelAt(x + 1, y + 1))) return false;
    }
    return true;
  };
  const columnIsMatte = (x: number) => {
    for (let y = 0; y < image.height; y++) {
      if (!matches(image.getPixelAt(x + 1, y + 1))) return false;
    }
    return true;
  };

  let top = 0;
  let bottom = image.height - 1;
  let left = 0;
  let right = image.width - 1;
  while (top < bottom && rowIsMatte(top)) top++;
  while (bottom > top && rowIsMatte(bottom)) bottom--;
  while (left < right && columnIsMatte(left)) left++;
  while (right > left && columnIsMatte(right)) right--;

  const width = right - left + 1;
  const height = bottom - top + 1;
  const trimmed = Math.max(top, left, image.width - 1 - right, image.height - 1 - bottom);
  // A few stray pixels are not a matte; a real one is tens of pixels deep.
  if (trimmed < 4 || width < image.width / 2 || height < image.height / 2) {
    return 0;
  }
  image.crop(left, top, width, height);
  return trimmed;
}

/** Centre-crop to an aspect, then resize. Reports the source for the run log. */
function fit(image: Image, width: number, height: number): string {
  const source = `${image.width}x${image.height}`;
  const want = width / height;
  const have = image.width / image.height;
  if (Math.abs(want - have) > 0.001) {
    const [w, h] = have > want
      ? [Math.round(image.height * want), image.height]
      : [image.width, Math.round(image.width / want)];
    image.crop(
      Math.round((image.width - w) / 2),
      Math.round((image.height - h) / 2),
      w,
      h,
    );
  }
  image.resize(width, height);
  return source;
}

async function drawCharacter(
  member: typeof CAST[number],
  apiKey: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await draw(portraitPrompt(member.appearance), apiKey);
      const image = await Image.decode(raw);
      const source = fit(image, PORTRAIT_W, PORTRAIT_H);

      const score = frameScore(image);
      // Retried rather than accepted: a painted-in border is exactly the defect
      // this regeneration exists to remove, and it is cheaper to redraw than to
      // ship it and crop it by hand later.
      if (score > 0.35 && attempt < MAX_ATTEMPTS) {
        throw new Error(
          `border painted into the image (edge score ${score.toFixed(2)})`,
        );
      }
      const feet = bottomTouch(image);
      if (feet > 0.15 && attempt < MAX_ATTEMPTS) {
        throw new Error(
          `cropped before the feet (bottom edge ${(feet * 100).toFixed(0)}% subject)`,
        );
      }

      await Deno.writeFile(
        new URL(`${member.slug}-portrait.png`, OUT_DIR),
        await image.encode(9),
      );
      const cut = cutout(image);
      await Deno.writeFile(
        new URL(`${member.slug}-cutout.png`, OUT_DIR),
        await cut.encode(9),
      );
      console.log(
        `[ok] ${member.slug} ${source} -> ${PORTRAIT_W}x${PORTRAIT_H} (edge ${
          score.toFixed(2)
        }, feet ${bottomTouch(image).toFixed(2)}) + cutout`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[attempt ${attempt}/${MAX_ATTEMPTS}] ${member.slug}: ${message}`);
    }
  }
  console.error(`[fail] ${member.slug} not drawn`);
  return false;
}

async function drawCover(apiKey: string): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await draw(COVER_PROMPT, apiKey);
      const image = await Image.decode(raw);
      // Before the fit, so the aspect is measured on the illustration and not
      // on the matte around it.
      const trimmed = trimMatte(image);
      const source = fit(image, COVER_SIDE, COVER_SIDE);

      // The cover is centre-cropped three ways by the client, so a surviving
      // border shows as a sliver down one edge of one of them. Same bar as the
      // portraits, measured against the cover's own corner rather than the
      // portrait ground.
      const corner = channels(image.getPixelAt(1, 1));
      let foreign = 0;
      for (let x = 0; x < image.width; x++) {
        const c = channels(image.getPixelAt(x + 1, 1));
        if (Math.abs(c.r - corner.r) + Math.abs(c.g - corner.g) + Math.abs(c.b - corner.b) > 90) {
          foreign++;
        }
      }
      if (foreign < image.width * 0.2 && attempt < MAX_ATTEMPTS) {
        throw new Error("top edge is a flat band — matte survived the trim");
      }

      await Deno.writeFile(
        new URL("cover-trek.png", OUT_DIR),
        await image.encode(9),
      );
      console.log(
        `[ok] cover-trek ${source}${trimmed ? ` (trimmed ${trimmed}px matte)` : ""} -> ${COVER_SIDE}x${COVER_SIDE}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[attempt ${attempt}/${MAX_ATTEMPTS}] cover-trek: ${message}`);
    }
  }
  console.error("[fail] cover-trek not drawn");
  return false;
}

async function main() {
  const only = new Set(Deno.args);
  const wantCover = !only.size || only.has("cover");
  const targets = only.size
    ? CAST.filter((member) => only.has(member.slug))
    : [...CAST];
  if (!targets.length && !wantCover) {
    throw new Error(`no character matched ${[...only].join(", ")}`);
  }

  const apiKey = await readKey();
  await Deno.mkdir(OUT_DIR, { recursive: true });

  let drawn = 0;
  let wanted = 0;
  for (const member of targets) {
    wanted++;
    if (await drawCharacter(member, apiKey)) drawn++;
  }
  if (wantCover) {
    wanted++;
    if (await drawCover(apiKey)) drawn++;
  }

  console.log(`\n${drawn}/${wanted} written to expo/assets/onboarding/`);
  // A run that drew nothing must not exit 0; see the testimonial script.
  if (drawn < wanted) Deno.exit(1);
}

if (import.meta.main) await main();

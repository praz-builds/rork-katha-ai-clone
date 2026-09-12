#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
/**
 * Draws the eight provisional testimonial portraits for the onboarding paywall
 * rail (`expo/src/components/onboarding/TestimonialRail.tsx`).
 *
 * WHY A SCRIPT AND NOT A ONE-OFF CURL. The product lane will replace these
 * files by name later, and when it does somebody has to be able to see what
 * the placeholders were asked for. The prompts ARE the spec for the
 * replacements: same framing, same lighting, same crop, so swapping a file
 * does not change the rhythm of the rail.
 *
 * WHAT IT GENERATES. Generic people, never a likeness of a real individual:
 * the prompt says so explicitly, because "a 36 year old Latina mother" is one
 * unlucky sampling away from a recognisable face and these images ship in a
 * paywall beside a quote the person never said.
 *
 * THE PROVIDER. OpenRouter's chat-completions endpoint with
 * `modalities: ["image", "text"]`, exactly as
 * `supabase/functions/_shared/image.ts` does it — the image comes back on
 * `choices[0].message.images[0].image_url.url` as a `data:` URL, and a refusal
 * comes back as a normal 200 with prose and an empty `images` array. That is
 * why an empty array is retried rather than thrown: on this provider it is the
 * moderation signal, not a transport failure.
 *
 * SIZE. Gemini returns 1024x1024 PNGs at about 1.3MB each, and the rail draws
 * them in a 44pt round frame — 132 device pixels on a 3x phone. Shipping ten
 * megabytes of assets to fill eight thumbnails is the kind of thing nobody
 * notices until the bundle is too big to ship, so every portrait is downscaled
 * to 512x512 before it is written. A non-square generation is centre-cropped to
 * the shorter side first; `resizeMode="cover"` in the component would do the
 * same thing, but a square file on disk means the replacement images the
 * product lane drops in have an unambiguous shape to match.
 *
 * RUN:
 *   deno run --allow-env --allow-read --allow-write --allow-net \
 *     backend/scripts/generate-testimonial-portraits.ts [slug ...]
 *
 * With no arguments it draws all eight. With slugs it draws only those, which
 * is how a single unconvincing face gets redrawn without spending eight
 * generations to replace one.
 */

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const MODEL = "google/gemini-2.5-flash-image";
const OUTPUT_SIZE = 512;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OUT_DIR = new URL("../../expo/assets/testimonials/", import.meta.url);
const ENV_FILE = new URL("../.env", import.meta.url);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * One clause per person, and only the clause the picture needs.
 *
 * The age and the description come from the persona list in the feedback
 * brief; nothing about what they use Katha for is in here, because a portrait
 * that illustrates the quote ("a mother reading to two children") reads as
 * stock photography and stops being a face.
 */
const PEOPLE: { slug: string; subject: string }[] = [
  {
    slug: "mateo-rpg",
    subject:
      "a 29 year old Hispanic man with short dark hair and light stubble",
  },
  {
    slug: "ana-bedtime",
    subject: "a 36 year old Latina woman with long dark wavy hair",
  },
  {
    slug: "dev-commute",
    subject:
      "a 41 year old South Asian man with short black hair and a trimmed beard",
  },
  {
    slug: "chloe-fanfic",
    subject: "a 24 year old white woman with shoulder length light brown hair",
  },
  {
    slug: "marcus-dad",
    subject:
      "a 38 year old Black man with short cropped hair and a short beard",
  },
  {
    slug: "priya-bilingual",
    subject:
      "a 20 year old Latina woman, a college student, with dark hair tied back",
  },
  {
    slug: "ruth-memoir",
    subject: "a 67 year old white woman with short grey hair and glasses",
  },
  {
    slug: "leo-worldbuilder",
    subject: "a 17 year old East Asian teenage boy with straight black hair",
  },
];

function promptFor(subject: string): string {
  return [
    `An ultra realistic candid smartphone photograph of ${subject}.`,
    "Shoulders up, looking directly at the camera, a relaxed natural half smile.",
    "Soft natural daylight, plain neutral out of focus background, shallow depth of field.",
    "Everyday clothing, no makeup styling, real skin texture with visible pores and fine lines.",
    "Looks like a real photo taken on a phone, not a studio headshot and not an illustration.",
    "This is a fictional generic person invented for the image and must not resemble any real or famous individual.",
    "Square 1:1 framing, face centred. No text, no watermark, no logo, no border, no caption.",
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
    // A LINK IS ALSO A VALID ANSWER. `_shared/image.ts` accepts both shapes
    // and so must this: rejecting a link here burned all three attempts and
    // wrote no portrait, on a response that was perfectly good.
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

/**
 * Centre-crop to a square, then down to 512, then re-encode as PNG.
 *
 * Reports the source dimensions so a rectangular generation is visible in the
 * run log rather than silently trimmed: if the model starts returning 3:4, the
 * prompt needs fixing, not the crop.
 */
async function toSquarePng(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; source: string }> {
  const image = await Image.decode(bytes);
  const source = `${image.width}x${image.height}`;
  if (image.width !== image.height) {
    const side = Math.min(image.width, image.height);
    image.crop(
      Math.round((image.width - side) / 2),
      Math.round((image.height - side) / 2),
      side,
      side,
    );
  }
  image.resize(OUTPUT_SIZE, OUTPUT_SIZE);
  return { bytes: await image.encode(9), source };
}

async function main() {
  const only = new Set(Deno.args);
  const targets = only.size ? PEOPLE.filter((p) => only.has(p.slug)) : PEOPLE;
  if (!targets.length) {
    throw new Error(`no persona matched ${[...only].join(", ")}`);
  }

  const apiKey = await readKey();
  await Deno.mkdir(OUT_DIR, { recursive: true });

  let drawn = 0;
  for (const person of targets) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const raw = await draw(promptFor(person.subject), apiKey);
        const { bytes, source } = await toSquarePng(raw);
        await Deno.writeFile(new URL(`${person.slug}.png`, OUT_DIR), bytes);
        console.log(
          `[ok] ${person.slug} ${source} -> ${OUTPUT_SIZE}x${OUTPUT_SIZE} ${
            (bytes.length / 1024).toFixed(0)
          }KB`,
        );
        drawn++;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[attempt ${attempt}/${MAX_ATTEMPTS}] ${person.slug}: ${message}`,
        );
        if (attempt === MAX_ATTEMPTS) {
          console.error(`[fail] ${person.slug} not drawn`);
        }
      }
    }
  }
  console.log(
    `\n${drawn}/${targets.length} portraits written to expo/assets/testimonials/`,
  );
  // A run that drew nothing used to exit 0, so a CI step or a wrapper script
  // could not tell a full set from an empty one.
  if (drawn < targets.length) {
    throw new Error(`${targets.length - drawn} portrait(s) not drawn`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

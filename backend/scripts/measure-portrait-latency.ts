#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read
/**
 * Where the 15-20 seconds between W4's press and the face on screen go.
 *
 * The onboarding portrait is drawn by `generate-character-image`, which is a
 * thin wrapper around `generateDraftCharacterPortrait` in `_shared/image.ts`.
 * Almost everything the user waits for happens inside one OpenRouter call, so
 * this script measures that call directly, with the exact prompt shape
 * `buildPortraitPrompt` produces, under the request shapes we could ship.
 *
 * It is a measurement tool, not part of the function. Nothing imports it.
 *
 *   deno run --allow-env --allow-net --allow-read \
 *     backend/scripts/measure-portrait-latency.ts --runs 3
 *
 * Flags:
 *   --runs N        runs per variant (default 3)
 *   --only <name>   run one variant (repeatable, substring match)
 *   --list          print variant names and exit
 *   --no-upload     skip the storage leg (network to Supabase not needed)
 */

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

/** `backend/.env`, read directly: this script runs from a shell, not Deploy. */
async function loadDotEnv(): Promise<void> {
  const url = new URL("../.env", import.meta.url);
  let text: string;
  try {
    text = await Deno.readTextFile(url);
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!Deno.env.get(key)) Deno.env.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// The prompt under test
// ---------------------------------------------------------------------------

/**
 * A typical W4 appearance line, of the length people actually type.
 *
 * Prompt CONTENT is out of scope for this work, so this reproduces the shape
 * `buildPortraitPrompt(appearance, 0, false, undefined)` produces rather than
 * importing it: importing `image.ts` would pull in the Supabase client and the
 * whole provider chain to read one string.
 */
const APPEARANCE =
  "A tall woman in her early thirties with dark curly hair pulled back, " +
  "warm brown eyes, a canvas jacket over a striped shirt, and worn boots.";

const PORTRAIT_WARDROBE_CLAUSE =
  "Wardrobe: ordinary everyday clothing appropriate to the setting and era, the same register of dress for every character regardless of ethnicity, unless the character description specifies otherwise. No ceremonial, festival, folk or traditional national dress unless asked for.";

/** Mirrors `buildPortraitPrompt` at safety level 0 with no reference, plus the
 * `ASPECT.portrait` tail `generateWithOpenRouter` appends. */
const PROMPT = [
  `Character portrait illustration of ${APPEARANCE}.`,
  `Full body, standing, facing the viewer, on a plain neutral background.`,
  `Painterly book-illustration style, soft even lighting, no background scenery.`,
  PORTRAIT_WARDROBE_CLAUSE,
  `The image must contain NO text, NO titles, NO words, NO letters, NO watermarks.`,
  `Full-body portrait orientation, subject centered in frame, high quality.`,
].join(" ") +
  " Render as a single image, full-body portrait orientation, 4:5 aspect ratio.";

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

interface Variant {
  name: string;
  model: string;
  /** Merged into the chat/completions body. */
  extra: Record<string, unknown>;
}

const NANO = "google/gemini-2.5-flash-image";
const G31 = "google/gemini-3.1-flash-image";

const VARIANTS: Variant[] = [
  /** What the chain sends today. See `ASPECT` in `_shared/image.ts`. */
  {
    name: "2.5-flash 4:5 (shipped)",
    model: NANO,
    extra: { image_config: { aspect_ratio: "4:5" } },
  },
  /** What it sent before: no size parameter at all, so 1024x1024 square. */
  { name: "2.5-flash baseline", model: NANO, extra: {} },
  {
    name: "2.5-flash 2:3",
    model: NANO,
    extra: { image_config: { aspect_ratio: "2:3" } },
  },
  {
    name: "2.5-flash 2:3 1K",
    model: NANO,
    extra: { image_config: { aspect_ratio: "2:3", image_size: "1K" } },
  },
  { name: "3.1-flash baseline", model: G31, extra: {} },
  {
    name: "3.1-flash 2:3",
    model: G31,
    extra: { image_config: { aspect_ratio: "2:3" } },
  },
  {
    name: "3.1-flash 2:3 low-effort",
    model: G31,
    extra: {
      image_config: { aspect_ratio: "2:3" },
      reasoning: { effort: "low" },
    },
  },
];

// ---------------------------------------------------------------------------
// One measured call
// ---------------------------------------------------------------------------

interface Sample {
  ok: boolean;
  /** POST sent -> response body fully read. */
  providerMs: number;
  /** base64 text -> Uint8Array. */
  decodeMs: number;
  /** Supabase Storage upload, when enabled. */
  uploadMs: number;
  bytes: number;
  type: string;
  /** Decoded from the PNG/JPEG/WebP header. */
  dimensions: string;
  note?: string;
}

async function measure(
  variant: Variant,
  apiKey: string,
  doUpload: boolean,
): Promise<Sample> {
  const body = {
    model: variant.model,
    modalities: ["image", "text"],
    messages: [{ role: "user", content: PROMPT }],
    ...variant.extra,
  };

  const t0 = performance.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://katha.ai",
      "X-Title": "Katha AI latency measurement",
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  const providerMs = performance.now() - t0;

  if (!res.ok) {
    return {
      ok: false,
      providerMs,
      decodeMs: 0,
      uploadMs: 0,
      bytes: 0,
      type: "-",
      dimensions: "-",
      note: `HTTP ${res.status}: ${
        JSON.stringify(payload?.error ?? payload).slice(0, 160)
      }`,
    };
  }

  const url = payload?.choices?.[0]?.message?.images?.[0]?.image_url?.url as
    | string
    | undefined;
  if (!url) {
    return {
      ok: false,
      providerMs,
      decodeMs: 0,
      uploadMs: 0,
      bytes: 0,
      type: "-",
      dimensions: "-",
      note: "no image in response (refusal or unsupported modality)",
    };
  }

  const comma = url.indexOf(",");
  const b64 = url.startsWith("data:") && comma > -1 ? url.slice(comma + 1) : "";
  const t1 = performance.now();
  const bytes = decodeBase64(b64);
  const decodeMs = performance.now() - t1;

  let uploadMs = 0;
  if (doUpload) uploadMs = await timeUpload(bytes);

  return {
    ok: true,
    providerMs,
    decodeMs,
    uploadMs,
    bytes: bytes.length,
    type: sniff(bytes),
    dimensions: dimensions(bytes),
  };
}

function decodeBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sniff(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x52 && b[8] === 0x57) return "webp";
  return "?";
}

/** Enough of each header to read width and height. Measurement only. */
function dimensions(b: Uint8Array): string {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (sniff(b) === "png" && b.length > 24) {
    return `${view.getUint32(16)}x${view.getUint32(20)}`;
  }
  if (sniff(b) === "webp" && b.length > 30) {
    // VP8L and VP8X carry dimensions differently; VP8X is the common case here.
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return `${w}x${h}`;
    }
  }
  if (sniff(b) === "jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8
      ) {
        return `${view.getUint16(i + 7)}x${view.getUint16(i + 5)}`;
      }
      i += 2 + view.getUint16(i + 2);
    }
  }
  return "?";
}

/**
 * The storage leg, against the real bucket under a throwaway key.
 *
 * Uploaded to `covers/latency-probe/...` and deleted straight after, so the
 * measurement costs one object-lifetime and leaves nothing behind.
 */
async function timeUpload(bytes: Uint8Array): Promise<number> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return 0;
  const type = sniff(bytes);
  const path = `covers/latency-probe/${crypto.randomUUID()}.${type}`;
  const endpoint = `${url}/storage/v1/object/covers/${path}`;
  const t = performance.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": `image/${type}`,
      "x-upsert": "true",
    },
    body: bytes as unknown as BodyInit,
  });
  const ms = performance.now() - t;
  await res.body?.cancel();
  await fetch(endpoint, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}` },
  }).then((r) => r.body?.cancel()).catch(() => {});
  return ms;
}

// ---------------------------------------------------------------------------
// The RPC round trip
// ---------------------------------------------------------------------------

/**
 * `claim_character_portrait_request`, which every call pays before drawing.
 *
 * Measured so the report can say plainly whether it is worth attention. It is
 * a single-row upsert behind the service role, so the expectation is tens of
 * milliseconds and the answer is "no".
 */
async function measureRpc(runs: number): Promise<number[]> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return [];
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const res = await fetch(
      `${url}/rest/v1/rpc/claim_character_portrait_request`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_user_id: crypto.randomUUID() }),
      },
    );
    samples.push(performance.now() - t);
    await res.body?.cancel();
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

const s = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

async function main(): Promise<void> {
  await loadDotEnv();
  const args = Deno.args;
  const runs = Number(valueOf(args, "--runs") ?? 3);
  const only = args.filter((a, i) => args[i - 1] === "--only");
  const doUpload = !args.includes("--no-upload");

  if (args.includes("--list")) {
    for (const v of VARIANTS) console.log(v.name);
    return;
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set (backend/.env or the env).");
    Deno.exit(1);
  }

  const selected = only.length
    ? VARIANTS.filter((v) => only.some((o) => v.name.includes(o)))
    : VARIANTS;

  console.log(`prompt (${PROMPT.length} chars):\n${PROMPT}\n`);
  console.log(
    `| variant | n | provider p50 | provider max | decode p50 | upload p50 | bytes | size |`,
  );
  console.log(`|---|---|---|---|---|---|---|---|`);

  for (const variant of selected) {
    const samples: Sample[] = [];
    for (let i = 0; i < runs; i++) {
      try {
        samples.push(await measure(variant, apiKey, doUpload));
      } catch (error) {
        samples.push({
          ok: false,
          providerMs: 0,
          decodeMs: 0,
          uploadMs: 0,
          bytes: 0,
          type: "-",
          dimensions: "-",
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const good = samples.filter((x) => x.ok);
    if (!good.length) {
      console.log(
        `| ${variant.name} | 0/${runs} | failed | | | | | ${
          samples[0]?.note ?? ""
        } |`,
      );
      continue;
    }
    const provider = good.map((x) => x.providerMs);
    console.log(
      `| ${variant.name} | ${good.length}/${runs} | ${
        s(percentile(provider, 50))
      } | ${s(Math.max(...provider))} | ${
        percentile(good.map((x) => x.decodeMs), 50).toFixed(1)
      }ms | ${percentile(good.map((x) => x.uploadMs), 50).toFixed(0)}ms | ${
        Math.round(percentile(good.map((x) => x.bytes), 50) / 1024)
      } KB | ${good[0].type} ${good[0].dimensions} |`,
    );
    for (const bad of samples.filter((x) => !x.ok)) {
      console.log(`|   ^ failure | | | | | | | ${bad.note} |`);
    }
  }

  const rpc = await measureRpc(runs);
  if (rpc.length) {
    console.log(
      `\nclaim_character_portrait_request: p50 ${
        percentile(rpc, 50).toFixed(0)
      }ms, max ${Math.max(...rpc).toFixed(0)}ms over ${rpc.length} calls`,
    );
  }
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i > -1 ? args[i + 1] : undefined;
}

if (import.meta.main) await main();

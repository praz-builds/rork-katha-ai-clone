/**
 * Draw the Originals cover prompts with the production image model, for
 * comparison with the Codex set.
 *
 *   OPENROUTER_API_KEY=... deno run --allow-read --allow-write --allow-net --allow-env \
 *     backend/originals/gemini-covers.ts [model]
 *
 * The request body mirrors `generateWithOpenRouter` in `_shared/image.ts`
 * exactly - the same suffix on the prompt, `modalities`, and
 * `image_config.aspect_ratio: "2:3"` - so the result is what a user's cover
 * would be for the same prompt at safety level 0. Writes
 * covers/gemini/<slug>.png; an existing file is skipped, so a rerun only
 * retries failures.
 */
const model = Deno.args[0] ?? "google/gemini-2.5-flash-image";
const key = Deno.env.get("OPENROUTER_API_KEY");
if (!key) throw new Error("OPENROUTER_API_KEY is not set");

const here = new URL(".", import.meta.url);
const outDir = new URL(`covers/${model.split("/").pop()}/`, here);
await Deno.mkdir(outDir, { recursive: true });
const prompts = JSON.parse(
  await Deno.readTextFile(new URL("cover-prompts.json", here)),
) as { slug: string; prompt: string }[];

async function draw(slug: string, prompt: string): Promise<string> {
  const target = new URL(`${slug}.png`, outDir);
  try {
    await Deno.stat(target);
    return `skip ${slug}`;
  } catch { /* not drawn yet */ }

  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://katha.ai",
      "X-Title": "Katha AI",
    },
    body: JSON.stringify({
      model,
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "2:3" },
      messages: [{
        role: "user",
        content:
          `${prompt} Render as a single image, portrait orientation, 2:3 aspect ratio.`,
      }],
    }),
  });
  const payload = await res.json();
  const url = payload?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!res.ok || !url) {
    return `FAIL ${slug} ${res.status} ${JSON.stringify(payload).slice(0, 200)}`;
  }
  const bytes = url.startsWith("data:")
    ? Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0))
    : new Uint8Array(await (await fetch(url)).arrayBuffer());
  await Deno.writeFile(target, bytes);
  const cost = payload?.usage?.cost;
  return `OK ${slug} ${((Date.now() - started) / 1000).toFixed(1)}s${cost ? ` $${cost}` : ""}`;
}

// Four at a time: fast, and well inside OpenRouter's rate limits.
const queue = [...prompts];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) {
    console.log(await draw(next.slug, next.prompt));
  }
}));

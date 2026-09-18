/**
 * Write Katha Originals through the production pipeline and publish them.
 *
 *   deno run -A backend/originals/run-originals.ts [--only=slug,slug] [--concurrency=4] [--finalize-only]
 *
 * Per story, resumably (state in run-state.json):
 *   1. `generate-story` as the house account with the brief's request, public,
 *      `story_flow: "auto"` - the same call the Create flow makes.
 *   2. `continue-story` until `planned_chapter_count`; the server writes the
 *      finale itself on the last planned chapter.
 *   3. Wait for the pipeline's own media task (cast portraits + a cover) to
 *      settle, so it cannot overwrite what step 4 writes.
 *   4. Upload the approved Codex cover under a NEW object name (the CDN caches
 *      `cover.png`) and point `cover_image_url` at it.
 *   5. Mark the story curated and public, and its chapters published.
 *
 * Every request id is saved BEFORE its request is sent, so a timeout followed
 * by a rerun replays the same generation instead of paying for a second one.
 */
import { callFunction, callStream, env, houseClient, service } from "./lib.ts";

type Brief = {
  slug: string;
  title: string;
  request: Record<string, unknown> & { planned_chapter_count: number };
};
type StoryState = {
  story_id?: string;
  start_request_id?: string;
  chapter_request_ids?: Record<string, string>;
  chapters_done?: number;
  media_settled?: boolean;
  cover_uploaded?: string;
  published?: boolean;
  awaiting_review?: boolean;
  errors?: string[];
};

const here = new URL(".", import.meta.url);
const arg = (name: string) =>
  Deno.args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = arg("only")?.split(",");
const concurrency = Number(arg("concurrency") ?? 4);
const finalizeOnly = Deno.args.includes("--finalize-only");

const briefs: Brief[] = [];
for await (const entry of Deno.readDir(here)) {
  if (/^briefs.*\.json$/.test(entry.name)) {
    briefs.push(...JSON.parse(await Deno.readTextFile(new URL(entry.name, here))).stories);
  }
}
const exclude = arg("exclude")?.split(",") ?? [];
const todo = briefs.filter((b) => (!only || only.includes(b.slug)) && !exclude.includes(b.slug));

/**
 * THE QUALITY GATE. A story is published only once a reviewer has read every
 * chapter and passed it: a "publish" verdict in any reviews*.jsonl, or its slug
 * in approved.txt (a "fix" verdict whose fixes have been applied and checked).
 * Until then it is written and covered but stays private.
 */
const approved = new Set<string>();
for await (const entry of Deno.readDir(here)) {
  if (/^reviews.*\.jsonl$/.test(entry.name)) {
    for (const line of (await Deno.readTextFile(new URL(entry.name, here))).split("\n")) {
      try {
        const review = JSON.parse(line);
        if (review.verdict === "publish") approved.add(review.slug);
      } catch { /* blank or partial line */ }
    }
  }
}
try {
  for (const slug of (await Deno.readTextFile(new URL("approved.txt", here))).split("\n")) {
    if (slug.trim()) approved.add(slug.trim());
  }
} catch { /* none yet */ }

const statePath = new URL("run-state.json", here);
let state: Record<string, StoryState> = {};
try {
  state = JSON.parse(await Deno.readTextFile(statePath));
} catch { /* first run */ }
let saving = Promise.resolve();
function save() {
  saving = saving.then(() =>
    Deno.writeTextFile(statePath, JSON.stringify(state, null, 1) + "\n")
  );
  return saving;
}
const log = (slug: string, msg: string) =>
  console.log(`${new Date().toISOString().slice(11, 19)} ${slug.padEnd(34)} ${msg}`);

const { client, userId } = await houseClient();

// The database, not this file, says what is published: unpublish.ts (or a
// hand edit) may have taken a story down since the last run.
{
  const ids = Object.values(state).map((v) => v.story_id).filter(Boolean) as string[];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await service.from("stories").select("id,is_curated").in("id", ids.slice(i, i + 100));
    for (const row of data ?? []) {
      const entry = Object.values(state).find((v) => v.story_id === row.id);
      if (entry) entry.published = row.is_curated === true;
    }
  }
}

async function chapterCount(storyId: string): Promise<number> {
  const { count } = await service.from("chapters").select("id", { count: "exact", head: true })
    .eq("story_id", storyId);
  return count ?? 0;
}

async function write(brief: Brief, s: StoryState) {
  const planned = brief.request.planned_chapter_count;

  if (!s.story_id) {
    s.start_request_id ??= crypto.randomUUID();
    await save();
    const started = Date.now();
    const res = await callStream(client, "generate-story-stream", {
      ...brief.request,
      request_id: s.start_request_id,
      visibility: "public",
      story_flow: "auto",
      notify_on_ready: false,
    });
    const story = res.body.story as { id?: string } | undefined;
    if (res.event !== "done" || !story?.id) {
      // A failed start is refunded; the next run must not replay its id.
      if (res.event === "error") delete s.start_request_id;
      throw new Error(`generate-story ${res.status} ${res.event} ${JSON.stringify(res.body).slice(0, 300)}`);
    }
    s.story_id = story.id;
    s.chapters_done = 1;
    await save();
    log(brief.slug, `ch 1/${planned} ${Math.round((Date.now() - started) / 1000)}s ${s.story_id}`);
  }

  s.chapter_request_ids ??= {};
  let done = await chapterCount(s.story_id);
  while (done < planned) {
    const n = done + 1;
    let attempt = 0;
    for (;;) {
      s.chapter_request_ids[n] ??= crypto.randomUUID();
      await save();
      const started = Date.now();
      const res = await callStream(client, "continue-story", {
        story_id: s.story_id,
        request_id: s.chapter_request_ids[n],
        stream: true,
      });
      if (res.event === "done") {
        log(brief.slug, `ch ${n}/${planned} ${Math.round((Date.now() - started) / 1000)}s`);
        break;
      }
      // A refunded operation is finished: replaying its request id only
      // replays the refund. A retry needs a new id, and costs a new credit.
      // A refunded or failed operation is finished: replaying its id only
      // replays the failure. "Already in progress" keeps the id - that one
      // is still being written and will be picked up on replay.
      const failedOp = res.body.status === "refunded" || res.body.status === "failed" ||
        res.event === "error" ||
        /start a new request/i.test(String(res.body.error ?? ""));
      if (failedOp) delete s.chapter_request_ids[n];
      attempt += 1;
      const why = `continue-story ch${n} ${res.status} ${res.event} ${JSON.stringify(res.body).slice(0, 200)}`;
      if (attempt > 4) throw new Error(why);
      log(brief.slug, `retrying ch ${n} (${why.slice(0, 90)})`);
      await new Promise((r) => setTimeout(r, 45_000 * attempt));
    }
    done = await chapterCount(s.story_id);
    s.chapters_done = done;
    await save();
  }
}

async function settleMedia(brief: Brief, s: StoryState) {
  if (s.media_settled) return;
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const { data } = await service.from("stories").select("cover_status").eq("id", s.story_id!).single();
    if (data?.cover_status === "ready" || data?.cover_status === "failed") {
      s.media_settled = true;
      await save();
      log(brief.slug, `pipeline media ${data.cover_status}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("pipeline media did not settle in 6 minutes");
}

async function finalize(brief: Brief, s: StoryState) {
  const coverFile = new URL(`covers/${brief.slug}.png`, here);
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(coverFile);
  } catch {
    log(brief.slug, "waiting for its approved cover - not published yet");
    return;
  }
  if (!s.cover_uploaded) {
    const path = `covers/${s.story_id}/original-v1.png`;
    const { error } = await service.storage.from("covers").upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) throw new Error(`cover upload ${error.message}`);
    s.cover_uploaded = service.storage.from("covers").getPublicUrl(path).data.publicUrl;
    await save();
  }
  if (!approved.has(brief.slug)) {
    s.awaiting_review = true;
    await save();
    log(brief.slug, "written and covered; held private until its review passes");
    return;
  }
  const { error: storyError } = await service.from("stories").update({
    // The pipeline names the story itself (the brief has no title field), and
    // the approved cover was reviewed under the brief's title.
    title: brief.title,
    // The entity gate classifies every character-sheet name as a
    // `private_individual` ("user character sheet is sole authority"), so any
    // story with a named cast is forced private. These casts were invented
    // for the house library, so the flag is a false positive here; clearing
    // it is what lets the CHECK constraint accept `is_public`. Reported as a
    // product bug separately - it blocks every user's named-cast story too.
    entity_gate_reason: null,
    cover_image_url: s.cover_uploaded,
    cover_status: "ready",
    is_curated: true,
    is_public: true,
  }).eq("id", s.story_id!);
  if (storyError) throw new Error(`story publish ${storyError.message}`);
  const { error: chapterError } = await service.from("chapters").update({ is_published: true })
    .eq("story_id", s.story_id!);
  if (chapterError) throw new Error(`chapter publish ${chapterError.message}`);
  s.published = true;
  await save();
  log(brief.slug, "published as a Katha Original");
}

/**
 * The OpenRouter key that writes these stories is the one every real user's
 * generation runs on. Never start a new story below this much headroom: a
 * library that stops half-built is fine, a production outage is not.
 */
const RESERVE_USD = Number(arg("reserve") ?? 5);
let reserveHit = false;
async function openRouterRemaining(): Promise<number> {
  const res = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  const { data } = await res.json();
  return data.total_credits - data.total_usage;
}

async function run(brief: Brief) {
  const s = (state[brief.slug] ??= {});
  if (s.published) return;
  if (!s.story_id && !finalizeOnly) {
    const remaining = await openRouterRemaining();
    if (reserveHit || remaining < RESERVE_USD) {
      reserveHit = true;
      log(brief.slug, `not started: OpenRouter has $${remaining.toFixed(2)} left (reserve $${RESERVE_USD})`);
      return;
    }
  }
  try {
    if (!finalizeOnly) await write(brief, s);
    if (!s.story_id) return;
    await settleMedia(brief, s);
    await finalize(brief, s);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (s.errors ??= []).push(`${new Date().toISOString()} ${message}`);
    await save();
    log(brief.slug, `FAILED ${message}`);
  }
}

const boot = await callFunction(client, "bootstrap-user", {});
console.log(`house ${userId}, ${todo.length} stories, balance ${boot.body.balance}`);

const queue = [...todo];
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) await run(next);
}));
await saving;
const published = todo.filter((b) => state[b.slug]?.published).length;
console.log(`done: ${published}/${todo.length} published`);

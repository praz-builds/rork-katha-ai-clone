#!/usr/bin/env -S deno run -A
/**
 * Seed the production fixtures the Play listing screenshots need, and take them
 * away again.
 *
 * `store/android/screenshot-plan.md` frame 7 is a published Original with "two
 * or three comments from house accounts", and frame 1 wants the streak pill
 * showing a real number. Neither exists in production: `comments` is empty and
 * the house account has no `streaks` row. Captures happen on a real device from
 * the closed-test build, so this has to be seeded ahead of the capture session
 * rather than during it.
 *
 * Everything written here is house content on house accounts. No real user's
 * row is created, read into, or modified.
 *
 * Idempotent: running it twice makes no second copy of anything. Reversible:
 * `--teardown` removes exactly what it created and nothing else.
 *
 *   deno run -A scripts/seed-screenshot-fixtures.ts            # report only
 *   deno run -A scripts/seed-screenshot-fixtures.ts --apply
 *   deno run -A scripts/seed-screenshot-fixtures.ts --teardown
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (backend/.env).
 */

const URL_ = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!URL_ || !KEY) {
  console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

const APPLY = Deno.args.includes("--apply");
const TEARDOWN = Deno.args.includes("--teardown");

/** The house account that owns the 80 Katha Originals. */
const HOUSE_ID = "3ae4750d-f24a-4dc9-a810-991dae1ce029";

/**
 * The Original the comments hang on: a folktale, so the frame carries no
 * romance or horror imagery -- store assets are shown to everyone whatever the
 * app's rating (screenshot-plan.md, "Rules for what is on screen").
 */
const STORY_ID = "0da6a6bb-8b84-458a-8e89-3da7a8046e0d"; // A Bridge by Cockcrow

/**
 * House readers. `username` is what a comment renders as -- the comments
 * function selects `profiles.username` and returns it as
 * `author_display_name`, NOT `display_name` -- so these have to read well as
 * handles. They also have to satisfy `profiles_username_shape`:
 * ^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$
 *
 * Emails are @example.com, which RFC 2606 reserves, so none of these can ever
 * collide with or deliver to a real address.
 */
const READERS = [
  {
    email: "screenshot-reader-ana@example.com",
    username: "ana_reads",
    display_name: "Ana",
    avatar_id: "k07",
    bio: "House account for store screenshots.",
    comment: "Read this in one sitting. The bridge scene got me.",
  },
  {
    email: "screenshot-reader-tomas@example.com",
    username: "tomas_ferreira",
    display_name: "Tomás",
    avatar_id: "k22",
    bio: "House account for store screenshots.",
    comment: "That line in chapter three about the rain. Oof.",
  },
];

type Json = Record<string, unknown>;

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function get(path: string): Promise<Json[]> {
  const r = await rest(path);
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return await r.json();
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${URL_}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** The auth user for an email, or null. Listing is paged; match exactly. */
async function findAuthUser(email: string): Promise<string | null> {
  const r = await admin(`users?page=1&per_page=200`);
  if (!r.ok) throw new Error(`list users -> ${r.status} ${await r.text()}`);
  const body = await r.json() as { users?: Array<{ id: string; email?: string }> };
  const hit = (body.users ?? []).find((u) =>
    (u.email ?? "").toLowerCase() === email.toLowerCase()
  );
  return hit?.id ?? null;
}

async function report(): Promise<void> {
  const story = await get(
    `stories?select=id,title,is_public,comment_count&id=eq.${STORY_ID}`,
  );
  const comments = await get(
    `comments?select=id,user_id,content&story_id=eq.${STORY_ID}`,
  );
  const streak = await get(`streaks?select=*&user_id=eq.${HOUSE_ID}`);
  console.log("story:   ", story[0]?.title, "| public:", story[0]?.is_public);
  console.log("comments:", comments.length, "on that story");
  for (const c of comments) console.log("    ", JSON.stringify(c.content));
  console.log("streak:  ", streak.length ? JSON.stringify(streak[0]) : "none");
  for (const r of READERS) {
    const id = await findAuthUser(r.email);
    console.log(`reader   ${r.username.padEnd(16)} ${id ? id : "absent"}`);
  }
}

async function apply(): Promise<void> {
  // 1. House reader accounts, one auth user + one profile each.
  for (const r of READERS) {
    let id = await findAuthUser(r.email);
    if (id) {
      console.log(`reader ${r.username}: auth user exists`);
    } else {
      const res = await admin("users", {
        method: "POST",
        body: JSON.stringify({
          email: r.email,
          email_confirm: true,
          user_metadata: { house_account: "store-screenshots" },
        }),
      });
      if (!res.ok) throw new Error(`create ${r.email} -> ${res.status} ${await res.text()}`);
      id = ((await res.json()) as { id: string }).id;
      console.log(`reader ${r.username}: auth user created ${id}`);
    }

    // The profile row may already exist from a trigger on auth user creation.
    const existing = await get(`profiles?select=id&id=eq.${id}`);
    const body = {
      id,
      username: r.username,
      display_name: r.display_name,
      avatar_id: r.avatar_id,
      bio: r.bio,
    };
    const res = existing.length
      ? await rest(`profiles?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await rest(`profiles`, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`profile ${r.username} -> ${res.status} ${await res.text()}`);
    console.log(`reader ${r.username}: profile ${existing.length ? "updated" : "created"}`);
  }

  // 2. One comment each, only if that exact comment is not already there.
  for (const r of READERS) {
    const id = await findAuthUser(r.email);
    const have = await get(
      `comments?select=id&story_id=eq.${STORY_ID}&user_id=eq.${id}`,
    );
    if (have.length) {
      console.log(`comment ${r.username}: already present`);
      continue;
    }
    const res = await rest("comments", {
      method: "POST",
      body: JSON.stringify({ user_id: id, story_id: STORY_ID, content: r.comment }),
    });
    if (!res.ok) throw new Error(`comment ${r.username} -> ${res.status} ${await res.text()}`);
    console.log(`comment ${r.username}: created`);
  }

  // 3. `stories.comment_count` is a denormalised counter with no trigger
  //    maintaining it, so set it from the real row count rather than leaving
  //    the story page disagreeing with its own comment list.
  const rows = await get(`comments?select=id&story_id=eq.${STORY_ID}&deleted_at=is.null`);
  const res = await rest(`stories?id=eq.${STORY_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ comment_count: rows.length }),
  });
  if (!res.ok) throw new Error(`comment_count -> ${res.status} ${await res.text()}`);
  console.log(`comment_count: set to ${rows.length}`);

  // 4. The streak pill in frame 1.
  const today = new Date().toISOString().slice(0, 10);
  const streakBody = {
    user_id: HOUSE_ID,
    current_streak: 3,
    longest_streak: 3,
    last_activity_date: today,
    next_credit_at: 3,
  };
  const s = await rest("streaks?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(streakBody),
  });
  if (!s.ok) throw new Error(`streak -> ${s.status} ${await s.text()}`);
  console.log("streak: house account set to 3 days");
}

async function teardown(): Promise<void> {
  for (const r of READERS) {
    const id = await findAuthUser(r.email);
    if (!id) {
      console.log(`reader ${r.username}: absent`);
      continue;
    }
    const c = await rest(`comments?user_id=eq.${id}&story_id=eq.${STORY_ID}`, {
      method: "DELETE",
    });
    console.log(`comment ${r.username}: ${c.ok ? "deleted" : `FAILED ${c.status}`}`);
    // Deleting the auth user cascades to `profiles` (on delete cascade).
    const u = await admin(`users/${id}`, { method: "DELETE" });
    console.log(`reader  ${r.username}: ${u.ok ? "deleted" : `FAILED ${u.status}`}`);
  }
  const rows = await get(`comments?select=id&story_id=eq.${STORY_ID}&deleted_at=is.null`);
  await rest(`stories?id=eq.${STORY_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ comment_count: rows.length }),
  });
  console.log(`comment_count: reset to ${rows.length}`);
  const s = await rest(`streaks?user_id=eq.${HOUSE_ID}`, { method: "DELETE" });
  console.log(`streak: ${s.ok ? "removed" : `FAILED ${s.status}`}`);
}

console.log(`project: ${URL_}`);
if (TEARDOWN) {
  await teardown();
} else if (APPLY) {
  await apply();
  console.log("\n--- after ---");
  await report();
} else {
  console.log("(report only; pass --apply to write, --teardown to undo)\n");
  await report();
}

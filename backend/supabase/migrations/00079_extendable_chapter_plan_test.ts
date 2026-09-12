// 00079: the plan is a range, and extending it is part of paying for the
// chapter.
//
// Executed rather than inspected, for the reason 00071 paid for: a plpgsql
// body is parsed when it RUNS, so a mistake inside one deploys cleanly and
// passes any test that only checks the function exists. Every assertion below
// calls the function and then reads the story row and the ledger, because the
// thing under test is a plan and the money attached to it.
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function createDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable
      as $$ select current_user::text $$;
    grant usage on schema auth to anon, authenticated, service_role;
  `);

  const migrations: string[] = [];
  for await (const entry of Deno.readDir(new URL(".", import.meta.url))) {
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) {
      migrations.push(entry.name);
    }
  }
  migrations.sort();
  for (const migration of migrations) {
    const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

const USER = "00000000-0000-4000-8000-000000000790";

async function seed(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query("insert into profiles(id) values ($1)", [USER]);
  await db.query(
    "select grant_credit($1, 90, 'welcome', 'extend-test', 'welcome:extend-test')",
    [USER],
  );
}

async function makeStory(
  db: PGlite,
  requestId: string,
  options: {
    mode?: "series" | "standalone";
    planned?: number | null;
    illustrate?: boolean;
  } = {},
): Promise<string> {
  const { mode = "series", planned = 1, illustrate = false } = options;
  const begun = await db.query<{ result: Record<string, unknown> }>(
    `select begin_story_generation(
       $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
       array[]::text[], 'sweet', $3, 'An idea.', 'English',
       null, 'standard', $4, array[]::text[], array[]::text[], null, null,
       $5, array[]::text[]) as result`,
    [USER, requestId, mode, planned, illustrate],
  );
  return begun.rows[0].result.story_id as string;
}

async function plannedCount(db: PGlite, storyId: string): Promise<number | null> {
  const row = await db.query<{ planned_chapter_count: number | null }>(
    "select planned_chapter_count from public.stories where id = $1",
    [storyId],
  );
  return row.rows[0].planned_chapter_count;
}

async function balance(db: PGlite): Promise<number> {
  const row = await db.query<{ balance_after: number }>(
    `select balance_after from public.credit_ledger
      where user_id = $1
      order by created_at desc, ledger_sequence desc limit 1`,
    [USER],
  );
  return row.rows[0].balance_after;
}

async function reserve(
  db: PGlite,
  storyId: string,
  requestId: string,
  chapterNumber: number,
  extendTo: number | null,
  illustrate = false,
): Promise<{ spent: number; credits: number; planned: number | null }> {
  const before = await balance(db);
  const result = await db.query<{ result: Record<string, unknown> }>(
    `select reserve_generation_operation($1, $2, $3, $4, 'continuation', $5, $6) as result`,
    [USER, requestId, storyId, chapterNumber, illustrate, extendTo],
  );
  const operation = result.rows[0].result;
  return {
    spent: before - (await balance(db)),
    credits: operation.credits as number,
    planned: (operation.planned_chapter_count as number | null) ?? null,
  };
}

Deno.test("the plan is a bounded range, not the four values the picker offers", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-range");

    // Every value the extension path can produce is storable. Before this
    // migration 4 was a constraint violation, which is what made an extended
    // story impossible to persist at all.
    for (const value of [1, 2, 4, 5, 9, 14, 15]) {
      await db.query(
        "update public.stories set planned_chapter_count = $2 where id = $1",
        [story, value],
      );
      assertEquals(await plannedCount(db, story), value);
    }
    await db.query(
      "update public.stories set planned_chapter_count = null where id = $1",
      [story],
    );
    assertEquals(await plannedCount(db, story), null);

    // The ceiling and the floor are still enforced.
    for (const bad of [0, 16, -1, 100]) {
      await assertRejects(() =>
        db.query(
          "update public.stories set planned_chapter_count = $2 where id = $1",
          [story, bad],
        )
      );
    }
  } finally {
    await db.close();
  }
});

Deno.test("extending raises the plan and charges the ordinary chapter price", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // A one-chapter story: a series of one, which is what makes it extendable.
    const story = await makeStory(db, "req-extend", { planned: 1 });
    assertEquals(await plannedCount(db, story), 1);

    const second = await reserve(db, story, "cont-2", 2, 2);
    assertEquals(await plannedCount(db, story), 2);
    // Not discounted for being unplanned, and not surcharged for it.
    assertEquals(second.spent, 1);
    assertEquals(second.credits, 1);
    assertEquals(second.planned, 2);

    // One chapter at a time, repeatedly.
    const third = await reserve(db, story, "cont-3", 3, 3);
    assertEquals(await plannedCount(db, story), 3);
    assertEquals(third.spent, 1);

    // An illustrated extension still costs its picture, and no more.
    const illustrated = await makeStory(db, "req-extend-art", {
      planned: 1,
      illustrate: true,
    });
    const art = await reserve(db, illustrated, "cont-art-2", 2, 2, true);
    assertEquals(art.spent, 2);
    assertEquals(await plannedCount(db, illustrated), 2);
  } finally {
    await db.close();
  }
});

Deno.test("a replayed extension request does not raise the plan twice", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-replay", { planned: 1 });
    await reserve(db, story, "cont-once", 2, 2);
    assertEquals(await plannedCount(db, story), 2);

    // Same request id: the reservation is replayed, so the raise must not run
    // a second time. It would otherwise walk the plan forward on every retry
    // of a request that has already been paid for once.
    const before = await balance(db);
    const replay = await db.query<{ result: Record<string, unknown> }>(
      `select reserve_generation_operation($1, 'cont-once', $2, 2, 'continuation', false, 2) as result`,
      [USER, story],
    );
    assertEquals(replay.rows[0].result.replayed, true);
    assertEquals(await balance(db), before);
    assertEquals(await plannedCount(db, story), 2);
  } finally {
    await db.close();
  }
});

Deno.test("extension stops at fifteen, and charges nothing when it refuses", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-ceiling", { planned: 15 });
    const before = await balance(db);

    await assertRejects(
      () => reserve(db, story, "cont-16", 16, 16),
      Error,
      "Story cannot be extended",
    );
    assertEquals(await balance(db), before);
    assertEquals(await plannedCount(db, story), 15);
  } finally {
    await db.close();
  }
});

Deno.test("only a series can be extended, and only to the chapter being reserved", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    // A standalone has no plan to raise and no chapter two; its ending is a
    // rewrite, not more prose.
    const standalone = await makeStory(db, "req-standalone", {
      mode: "standalone",
      planned: 1,
    });
    await assertRejects(
      () => reserve(db, standalone, "cont-standalone", 2, 2),
      Error,
      "Story cannot be extended",
    );

    // The raise must be the chapter being paid for. A caller that could name
    // any chapter could buy one chapter and unlock fourteen.
    const series = await makeStory(db, "req-mismatch", { planned: 1 });
    await assertRejects(
      () => reserve(db, series, "cont-mismatch", 2, 15),
      Error,
      "Story cannot be extended",
    );
    assertEquals(await plannedCount(db, series), 1);
  } finally {
    await db.close();
  }
});

Deno.test("an in-plan continuation never shrinks the plan", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-noshrink", { planned: 7 });
    // Chapter 2 of a 7-chapter story, sent with the flag set. It is already
    // within the plan, so the plan must be left exactly where it was.
    const result = await reserve(db, story, "cont-inplan", 2, 2);
    assertEquals(await plannedCount(db, story), 7);
    assertEquals(result.spent, 1);
  } finally {
    await db.close();
  }
});

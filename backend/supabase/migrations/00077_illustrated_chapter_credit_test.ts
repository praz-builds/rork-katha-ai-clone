// 00077: the arithmetic of an illustrated chapter, executed rather than
// inspected.
//
// The lesson 00071 paid for applies to every line of this migration: a plpgsql
// body is parsed when it RUNS, so a mistake inside one deploys cleanly and
// passes any test that only checks the function exists. Every assertion below
// calls the function and reads the ledger afterwards, because the thing under
// test is money.
//
// What the CODE charges: starting a story is 3 (`begin_story_generation`),
// every chapter after the first is 1, or 2 when illustrated. So a 3-chapter
// illustrated story is 7 = 3 + 2 + 2, which is what the assertions below
// actually reserve.
//
// `source-of-truth/CREDITS_AND_PRICING.md` §1 disagrees: it prices the start at
// 1 and the same story at 5. That disagreement is real, unresolved, and
// recorded in AGENTS.md as a decision for the product owner -- it is a price,
// not a bug, and it must not be settled by editing one side to match the
// other. This file states the code's arithmetic because this file tests the
// code.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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

const USER = "00000000-0000-4000-8000-000000000770";

async function seed(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query("insert into profiles(id) values ($1)", [USER]);
  await db.query(
    "select grant_credit($1, 60, 'welcome', 'chapter-art-test', 'welcome:chapter-art-test')",
    [USER],
  );
}

/** A story whose brief either asked for chapter illustrations or did not. */
async function makeStory(
  db: PGlite,
  requestId: string,
  illustrate: boolean,
): Promise<string> {
  const begun = await db.query<{ result: Record<string, unknown> }>(
    `select begin_story_generation(
       $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
       array[]::text[], 'sweet', 'series', 'An idea.', 'English',
       null, 'standard', 3, array[]::text[], array[]::text[], null, null,
       $3, array[]::text[]) as result`,
    [USER, requestId, illustrate],
  );
  return begun.rows[0].result.story_id as string;
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

/** One continuation reservation, returning what it charged. */
async function reserve(
  db: PGlite,
  storyId: string,
  requestId: string,
  chapterNumber: number,
  illustrate?: boolean,
): Promise<{ operationId: string; spent: number; credits: number }> {
  const before = await balance(db);
  // `undefined` omits the argument entirely, which is the older deploy of
  // `continue-story`: it names five parameters and not this one, and must
  // still resolve here and still charge 1.
  const result = await db.query<{ result: Record<string, unknown> }>(
    illustrate === undefined
      ? `select reserve_generation_operation($1, $2, $3, $4, 'continuation') as result`
      : `select reserve_generation_operation($1, $2, $3, $4, 'continuation', $5) as result`,
    illustrate === undefined
      ? [USER, requestId, storyId, chapterNumber]
      : [USER, requestId, storyId, chapterNumber, illustrate],
  );
  const operation = result.rows[0].result;
  return {
    operationId: operation.id as string,
    spent: before - (await balance(db)),
    credits: (operation.credits as number) ?? 1,
  };
}

Deno.test("an illustrated chapter costs two credits and a plain one costs one", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const plain = await makeStory(db, "req-plain", false);
    const illustrated = await makeStory(db, "req-illustrated", true);

    const plainChapter = await reserve(db, plain, "cont-plain", 2, false);
    assertEquals(plainChapter.spent, 1);
    assertEquals(plainChapter.credits, 1);

    const artChapter = await reserve(db, illustrated, "cont-art", 2, true);
    assertEquals(artChapter.spent, 2);
    assertEquals(artChapter.credits, 2);

    // The whole arithmetic for a 3-chapter illustrated story, as charged:
    // 3 to start, then 2 and 2 -- seven.
    const third = await reserve(db, illustrated, "cont-art-3", 3, true);
    assertEquals(third.spent, 2);
  } finally {
    await db.close();
  }
});

Deno.test("the story row decides the price, not the caller", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const plain = await makeStory(db, "req-plain-2", false);
    const illustrated = await makeStory(db, "req-illustrated-2", true);

    // A caller claiming art on a story that never asked for it is charged the
    // plain price: nothing will draw a picture for this chapter, because
    // `generateChapterArt` reads the same column before it spends a provider
    // call.
    assertEquals(
      (await reserve(db, plain, "cont-lying", 2, true)).spent,
      1,
    );
    // And the flag can always lower the price: an older deploy that does not
    // send it, or one that has decided not to illustrate this chapter, is
    // charged 1 for a chapter that then gets no art.
    assertEquals(
      (await reserve(db, illustrated, "cont-no-art", 2, false)).spent,
      1,
    );
    assertEquals(
      (await reserve(db, illustrated, "cont-legacy", 3, undefined)).spent,
      1,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a failed illustrated chapter refunds both credits", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-refund", true);
    const { operationId, spent } = await reserve(db, story, "cont-fail", 2, true);
    assertEquals(spent, 2);

    const before = await balance(db);
    await db.query(
      "select refund_generation_operation($1, $2, 'provider outage')",
      [operationId, USER],
    );
    // Not 1. A flat refund would keep the credit that bought art for a
    // chapter that was never written.
    assertEquals((await balance(db)) - before, 2);
  } finally {
    await db.close();
  }
});

Deno.test("art that never arrives refunds exactly the art credit, once", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-art-refund", true);
    const { operationId } = await reserve(db, story, "cont-art-lost", 2, true);
    // The text was delivered: this is the state the background art task runs
    // in, and it is why the whole operation cannot simply be refunded.
    await db.query(
      "update public.generation_operations set status = 'completed' where id = $1",
      [operationId],
    );

    const before = await balance(db);
    await db.query(
      "select refund_story_media_component($1, $2, 'chapter_art')",
      [operationId, USER],
    );
    assertEquals((await balance(db)) - before, 1);

    // Idempotent on the component key, so a retried background task cannot
    // pay the writer twice for one missing picture.
    await db.query(
      "select refund_story_media_component($1, $2, 'chapter_art')",
      [operationId, USER],
    );
    assertEquals((await balance(db)) - before, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a chapter that was never charged for art gets nothing back", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-art-none", true);
    const { operationId } = await reserve(db, story, "cont-plain-art", 2, false);
    await db.query(
      "update public.generation_operations set status = 'completed' where id = $1",
      [operationId],
    );

    const before = await balance(db);
    await db.query(
      "select refund_story_media_component($1, $2, 'chapter_art')",
      [operationId, USER],
    );
    assertEquals(await balance(db), before);
  } finally {
    await db.close();
  }
});

Deno.test("the story components still refund against a story operation only", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const story = await makeStory(db, "req-cover", true);
    const operation = await db.query<{ id: string }>(
      `select id from public.generation_operations
        where story_id = $1 and kind = 'story'`,
      [story],
    );
    const operationId = operation.rows[0].id;

    const before = await balance(db);
    await db.query(
      "select refund_story_media_component($1, $2, 'cover')",
      [operationId, USER],
    );
    assertEquals((await balance(db)) - before, 1);

    // A continuation operation is not where a cover was ever bought, so the
    // lookup finds nothing rather than refunding against the wrong purchase.
    const { operationId: continuation } = await reserve(
      db,
      story,
      "cont-cover-mixup",
      2,
      true,
    );
    let raised = "";
    try {
      await db.query(
        "select refund_story_media_component($1, $2, 'cover')",
        [continuation, USER],
      );
    } catch (error) {
      raised = error instanceof Error ? error.message : String(error);
    }
    assertEquals(raised.includes("Story generation operation not found"), true);
  } finally {
    await db.close();
  }
});

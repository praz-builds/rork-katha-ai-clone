// 00082: a refunded extension gives the plan back as well as the credit.
//
// The defect this pins was invisible in the happy path and only appeared on a
// provider failure: the credit returned, the raised plan did not, and the
// retry of that chapter was then written as a FINALE because it no longer
// looked like an extension. So these exercise the failure path, which is the
// only place the bug lived.
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
  for await (const e of Deno.readDir(new URL(".", import.meta.url))) {
    if (e.isFile && /^\d+.*\.sql$/.test(e.name)) migrations.push(e.name);
  }
  migrations.sort();
  for (const m of migrations) {
    const sql = await Deno.readTextFile(new URL(m, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

const USER = "00000000-0000-4000-8000-000000000820";

async function seed(db: PGlite): Promise<string> {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query("insert into profiles(id) values ($1)", [USER]);
  await db.query(
    "select grant_credit($1, 60, 'welcome', 'ext-test', 'welcome:ext-test')",
    [USER],
  );
  const story = await db.query<{ id: string }>(
    `insert into public.stories (author_id, title, genre, primary_genre, status, story_mode, planned_chapter_count)
     values ($1,'T',array['mystery']::text[],'mystery','complete','series',1) returning id`,
    [USER],
  );
  await db.query(
    `insert into public.chapters (story_id, chapter_number, title, content)
     values ($1,1,'C1','text')`,
    [story.rows[0].id],
  );
  return story.rows[0].id;
}

async function reserve(
  db: PGlite,
  storyId: string,
  requestId: string,
  chapter: number,
  extendTo: number | null,
): Promise<string | null> {
  try {
    await db.query(
      `select reserve_generation_operation($1,$2,$3,$4,'continuation',false,$5)`,
      [USER, requestId, storyId, chapter, extendTo],
    );
    return null;
  } catch (error) {
    return String(error);
  }
}


Deno.test("a refunded extension puts the plan back", async () => {
  const db = await createDatabase();
  try {
    const storyId = await seed(db);
    const reserved = await db.query<{ reserve_generation_operation: Record<string, unknown> }>(
      `select reserve_generation_operation($1,$2,$3,2,'continuation',false,2)`,
      [USER, "ext-fail", storyId],
    );
    const op = reserved.rows[0].reserve_generation_operation;
    const operationId = op.id as string;

    const raised = await db.query<{ planned_chapter_count: number }>(
      "select planned_chapter_count from public.stories where id = $1",
      [storyId],
    );
    assertEquals(raised.rows[0].planned_chapter_count, 2);

    // The provider fails and the operation is refunded.
    await db.query("select refund_generation_operation($1,$2,'provider failed')", [
      operationId,
      USER,
    ]);

    // The plan must come back to 1. Left at 2, the next attempt at chapter 2
    // is not an extension (`2 > 2` is false), so it would be written as a
    // finale and the story could never be extended properly again.
    const after = await db.query<{ planned_chapter_count: number }>(
      "select planned_chapter_count from public.stories where id = $1",
      [storyId],
    );
    assertEquals(after.rows[0].planned_chapter_count, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a refund does not lower a plan somebody else raised further", async () => {
  const db = await createDatabase();
  try {
    const storyId = await seed(db);
    await db.query(
      `select reserve_generation_operation($1,$2,$3,2,'continuation',false,2)`,
      [USER, "ext-a", storyId],
    );
    const reserved = await db.query<{ reserve_generation_operation: Record<string, unknown> }>(
      `select reserve_generation_operation($1,$2,$3,2,'continuation',false,2)`,
      [USER, "ext-a", storyId],
    );
    const operationId =
      reserved.rows[0].reserve_generation_operation.id as string;

    // Chapter 2 lands, and the plan moves on to 3 by a later extension.
    await db.query(
      `insert into public.chapters (story_id, chapter_number, title, content)
       values ($1,2,'C2','text')`,
      [storyId],
    );
    await db.query(
      "update public.stories set planned_chapter_count = 3 where id = $1",
      [storyId],
    );

    await db.query("select refund_generation_operation($1,$2,'late failure')", [
      operationId,
      USER,
    ]);

    // Untouched: the plan is no longer the one this operation raised, and a
    // chapter exists at that number. Lowering it here would corrupt a story
    // that had moved on.
    const after = await db.query<{ planned_chapter_count: number }>(
      "select planned_chapter_count from public.stories where id = $1",
      [storyId],
    );
    assertEquals(after.rows[0].planned_chapter_count, 3);
  } finally {
    await db.close();
  }
});

// The two cases 00081's `<> plan + 1` broke. Both are paid, both are allowed,
// and the skip is still refused — which is the only thing that guard was for.
Deno.test("an in-plan flag is still a paid no-op, not a refusal", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [USER]);
    await db.query("insert into profiles(id) values ($1)", [USER]);
    await db.query(
      "select grant_credit($1, 60, 'welcome', 'inplan', 'welcome:inplan')",
      [USER],
    );
    const story = await db.query<{ id: string }>(
      `insert into public.stories (author_id, title, genre, primary_genre, status, story_mode, planned_chapter_count)
       values ($1,'T',array['mystery']::text[],'mystery','complete','series',7) returning id`,
      [USER],
    );
    await db.query(
      `insert into public.chapters (story_id, chapter_number, title, content)
       values ($1,1,'C1','text')`,
      [story.rows[0].id],
    );
    // Chapter 2 of a 7-chapter plan, with the flag set. 00079 called this "an
    // ordinary in-plan continuation that happened to send the flag" and made
    // it a no-op; 00081 started refusing it.
    await db.query(
      `select reserve_generation_operation($1,$2,$3,2,'continuation',false,2)`,
      [USER, "inplan-2", story.rows[0].id],
    );
    const row = await db.query<{ planned_chapter_count: number }>(
      "select planned_chapter_count from public.stories where id = $1",
      [story.rows[0].id],
    );
    // Unchanged: the flag may raise a plan, never shrink one.
    assertEquals(row.rows[0].planned_chapter_count, 7);
  } finally {
    await db.close();
  }
});

Deno.test("a legacy story with no plan is extendable from what it has written", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [USER]);
    await db.query("insert into profiles(id) values ($1)", [USER]);
    await db.query(
      "select grant_credit($1, 60, 'welcome', 'legacy', 'welcome:legacy')",
      [USER],
    );
    const story = await db.query<{ id: string }>(
      `insert into public.stories (author_id, title, genre, primary_genre, status, story_mode)
       values ($1,'T',array['mystery']::text[],'mystery','complete','series') returning id`,
      [USER],
    );
    for (const n of [1, 2, 3, 4, 5]) {
      await db.query(
        `insert into public.chapters (story_id, chapter_number, title, content)
         values ($1,$2,'C','text')`,
        [story.rows[0].id, n],
      );
    }
    // Null plan resolves to 3, but the story has five chapters. Reading it as
    // a three-chapter story made chapter 6 unreachable for ever, while the
    // reader was told the story could not be extended any further.
    await db.query(
      `select reserve_generation_operation($1,$2,$3,6,'continuation',false,6)`,
      [USER, "legacy-6", story.rows[0].id],
    );
    const row = await db.query<{ planned_chapter_count: number }>(
      "select planned_chapter_count from public.stories where id = $1",
      [story.rows[0].id],
    );
    assertEquals(row.rows[0].planned_chapter_count, 6);
  } finally {
    await db.close();
  }
});

// The bug the first version of this migration introduced. It restored
// `chapter_number - 1` whenever the plan equalled the chapter — which is also
// true of an ordinary LAST in-plan chapter, so a failure there quietly cut the
// story short and made its ending unreachable.
Deno.test("a failed last in-plan chapter does not shrink the plan", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [USER]);
    await db.query("insert into profiles(id) values ($1)", [USER]);
    await db.query(
      "select grant_credit($1, 60, 'welcome', 'inplan-fail', 'welcome:inplan-fail')",
      [USER],
    );
    const story = await db.query<{ id: string }>(
      `insert into public.stories (author_id, title, genre, primary_genre, status, story_mode, planned_chapter_count)
       values ($1,'T',array['mystery']::text[],'mystery','complete','series',3) returning id`,
      [USER],
    );
    for (const n of [1, 2]) {
      await db.query(
        `insert into public.chapters (story_id, chapter_number, title, content)
         values ($1,$2,'C','text')`,
        [story.rows[0].id, n],
      );
    }
    // Chapter 3 of a 3-chapter plan: ordinary, in-plan, no extension flag.
    const reserved = await db.query<{ reserve_generation_operation: Record<string, unknown> }>(
      `select reserve_generation_operation($1,$2,$3,3,'continuation',false,null)`,
      [USER, "last-chapter", story.rows[0].id],
    );
    await db.query("select refund_generation_operation($1,$2,'provider failed')", [
      reserved.rows[0].reserve_generation_operation.id as string,
      USER,
    ]);
    const after = await db.query<{ planned_chapter_count: number }>(
      "select planned_chapter_count from public.stories where id = $1",
      [story.rows[0].id],
    );
    // Still 3. Cut to 2, the story would read complete with its ending
    // permanently unwritten.
    assertEquals(after.rows[0].planned_chapter_count, 3);
  } finally {
    await db.close();
  }
});

// Bounding only the upper side still allowed a hole: chapter 3 of a story that
// owns one, inside a plan of seven, leaves chapter 2 missing for ever because
// every later continuation numbers from the newest chapter.
Deno.test("an extension cannot open a gap inside an existing plan", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [USER]);
    await db.query("insert into profiles(id) values ($1)", [USER]);
    await db.query(
      "select grant_credit($1, 60, 'welcome', 'gap', 'welcome:gap')",
      [USER],
    );
    const story = await db.query<{ id: string }>(
      `insert into public.stories (author_id, title, genre, primary_genre, status, story_mode, planned_chapter_count)
       values ($1,'T',array['mystery']::text[],'mystery','complete','series',1) returning id`,
      [USER],
    );
    await db.query(
      `insert into public.chapters (story_id, chapter_number, title, content)
       values ($1,1,'C1','text')`,
      [story.rows[0].id],
    );
    let refused = false;
    try {
      // Raises the plan (5 > 1) but skips chapters 2, 3 and 4.
      await db.query(
        `select reserve_generation_operation($1,$2,$3,5,'continuation',false,5)`,
        [USER, "gap-5", story.rows[0].id],
      );
    } catch {
      refused = true;
    }
    assertEquals(refused, true);
    const after = await db.query<{ planned_chapter_count: number }>(
      "select planned_chapter_count from public.stories where id = $1",
      [story.rows[0].id],
    );
    assertEquals(after.rows[0].planned_chapter_count, 1);
  } finally {
    await db.close();
  }
});

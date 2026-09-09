// 00062: one fork per reader per story, and a record of every narration object
// left behind by a deleted `chapter_audio` row.
import {
  assert,
  assertEquals,
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

async function attempt(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const AUTHOR = "00000000-0000-4000-8000-000000000621";
const READER = "00000000-0000-4000-8000-000000000622";
const OTHER_READER = "00000000-0000-4000-8000-000000000623";
const STORY = "00000000-0000-4000-8000-000000000624";
const CHAPTER = "00000000-0000-4000-8000-000000000625";
const FORK_ONE = "00000000-0000-4000-8000-000000000626";
const FORK_TWO = "00000000-0000-4000-8000-000000000627";

async function seed(db: PGlite) {
  for (
    const [id, name] of [[AUTHOR, "author_62"], [READER, "reader_62"], [
      OTHER_READER,
      "other_62",
    ]]
  ) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id, username) values ($1, $2)", [
      id,
      name,
    ]);
  }
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, status, is_public, story_mode, word_count)
     values ($1, $2, 'The Corner Table', array['romance'], 'romance', 'complete', true, 'series', 400)`,
    [STORY, AUTHOR],
  );
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content, word_count, chapter_role, is_published)
     values ($1, $2, 1, 'Ch 1', 'Aarav walked in.', 400, 'series_opening', true)`,
    [CHAPTER, STORY],
  );
}

async function insertFork(db: PGlite, id: string, ownerId: string) {
  return await attempt(
    db,
    `insert into stories
       (id, author_id, title, genre, primary_genre, status, story_mode, word_count, forked_from_story_id)
     values ($1, $2, 'The Corner Table', array['romance'], 'romance', 'complete', 'series', 400, $3)`,
    [id, ownerId, STORY],
  );
}

Deno.test("a reader gets one fork of a story, however many requests race", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    assertEquals(await insertFork(db, FORK_ONE, READER), null);

    // The second request of a racing pair. Before 00062 this succeeded and the
    // reader owned two private copies with their rewrites split between them.
    assertEquals(await insertFork(db, FORK_TWO, READER), "23505");

    // A DIFFERENT reader forking the same story is not a duplicate.
    assertEquals(await insertFork(db, FORK_TWO, OTHER_READER), null);

    // And the constraint says nothing about originals: every unforked story
    // has a null `forked_from_story_id`, and the index is partial.
    assertEquals(
      await attempt(
        db,
        `insert into stories
           (author_id, title, genre, primary_genre, status, story_mode, word_count)
         values ($1, 'Another', array['romance'], 'romance', 'complete', 'standalone', 10)`,
        [READER],
      ),
      null,
    );
    assertEquals(
      await attempt(
        db,
        `insert into stories
           (author_id, title, genre, primary_genre, status, story_mode, word_count)
         values ($1, 'And another', array['romance'], 'romance', 'complete', 'standalone', 10)`,
        [READER],
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a story's word count is summed and written in one statement", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(
      `insert into chapters (id, story_id, chapter_number, title, content, word_count, chapter_role, is_published)
       values (gen_random_uuid(), $1, 2, 'Ch 2', 'Maya answered.', 250, 'mid_series', true)`,
      [STORY],
    );
    // The stale total `edit-story` could leave behind before 00062.
    await db.query("update stories set word_count = 1 where id = $1", [STORY]);

    const result = await db.query<{ total: number }>(
      "select recompute_story_word_count($1) as total",
      [STORY],
    );
    assertEquals(Number(result.rows[0].total), 650);

    const stored = await db.query<{ word_count: number }>(
      "select word_count from stories where id = $1",
      [STORY],
    );
    assertEquals(Number(stored.rows[0].word_count), 650);

    // A story with no chapters left sums to zero rather than to null.
    await db.query("delete from chapters where story_id = $1", [STORY]);
    const empty = await db.query<{ total: number }>(
      "select recompute_story_word_count($1) as total",
      [STORY],
    );
    assertEquals(Number(empty.rows[0].total), 0);
  } finally {
    await db.close();
  }
});

Deno.test("deleting a chapter_audio row records its object for the sweeper", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(
      `insert into voices (id, display_name, language, gender, tier, sort_order, is_active)
       values ('v-62-a', 'A', 'en', 'female', 'standard', 900, true),
              ('v-62-b', 'B', 'en', 'male', 'standard', 901, true)
       on conflict do nothing`,
    );
    await db.query(
      `insert into chapter_audio (chapter_id, voice_id, storage_path, status, generated_at)
       values ($1, 'v-62-a', 'audio/ch/a.mp3', 'ready', now())`,
      [CHAPTER],
    );

    await db.query(
      "delete from chapter_audio where chapter_id = $1 and voice_id = 'v-62-a'",
      [CHAPTER],
    );

    const recorded = await db.query<{ storage_path: string; swept: boolean }>(
      "select storage_path, swept_at is null as swept from orphaned_audio_objects",
    );
    assertEquals(recorded.rows.length, 1);
    assertEquals(recorded.rows[0].storage_path, "audio/ch/a.mp3");
    assert(recorded.rows[0].swept, "a freshly recorded object is unswept");
  } finally {
    await db.close();
  }
});

Deno.test("an object another row still points at is never recorded as an orphan", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(
      `insert into voices (id, display_name, language, gender, tier, sort_order, is_active)
       values ('v-62-a', 'A', 'en', 'female', 'standard', 900, true),
              ('v-62-b', 'B', 'en', 'male', 'standard', 901, true)
       on conflict do nothing`,
    );
    // A legacy backfill that gave two voices the same path. Deleting one must
    // not queue the file the other one is still playing.
    await db.query(
      `insert into chapter_audio (chapter_id, voice_id, storage_path, status, generated_at)
       values ($1, 'v-62-a', 'audio/ch/shared.mp3', 'ready', now()),
              ($1, 'v-62-b', 'audio/ch/shared.mp3', 'ready', now())`,
      [CHAPTER],
    );

    await db.query(
      "delete from chapter_audio where chapter_id = $1 and voice_id = 'v-62-a'",
      [CHAPTER],
    );
    assertEquals(
      (await db.query("select 1 from orphaned_audio_objects")).rows.length,
      0,
    );

    // Once the last row goes, the path is recorded exactly once.
    await db.query("delete from chapter_audio where chapter_id = $1", [
      CHAPTER,
    ]);
    const rows = await db.query<{ storage_path: string }>(
      "select storage_path from orphaned_audio_objects",
    );
    assertEquals(rows.rows.map((r) => r.storage_path), [
      "audio/ch/shared.mp3",
    ]);
  } finally {
    await db.close();
  }
});

Deno.test("a pending row with no object leaves nothing behind", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(
      `insert into voices (id, display_name, language, gender, tier, sort_order, is_active)
       values ('v-62-a', 'A', 'en', 'female', 'standard', 900, true)
       on conflict do nothing`,
    );
    await db.query(
      `insert into chapter_audio (chapter_id, voice_id, status)
       values ($1, 'v-62-a', 'pending')`,
      [CHAPTER],
    );
    await db.query("delete from chapter_audio where chapter_id = $1", [
      CHAPTER,
    ]);
    assertEquals(
      (await db.query("select 1 from orphaned_audio_objects")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

// 00057: saved characters, forks, and reimagine-in-place, proven on a real
// Postgres via PGlite with every migration applied in order.
import {
  assert,
  assertEquals,
  assertNotEquals,
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

async function asUser(db: PGlite, userId: string) {
  await db.exec(`
    set request.jwt.claim.sub = '${userId}';
    set role authenticated;
  `);
}

async function asSuperuser(db: PGlite) {
  await db.exec("reset role;");
}

async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const AUTHOR = "00000000-0000-4000-8000-000000000571";
const READER = "00000000-0000-4000-8000-000000000572";
const STORY = "00000000-0000-4000-8000-000000000573";
const CHAPTER_ONE = "00000000-0000-4000-8000-000000000574";
const CHAPTER_TWO = "00000000-0000-4000-8000-000000000575";

async function seedUsers(db: PGlite) {
  for (const [id, name] of [[AUTHOR, "author_57"], [READER, "reader_57"]]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id, username) values ($1, $2)", [
      id,
      name,
    ]);
    await db.query(
      "select grant_credit($1, 10, 'purchase', 'seed', $2)",
      [id, `op:seed:${id}`],
    );
  }
}

async function seedStory(
  db: PGlite,
  overrides: { isCurated?: boolean } = {},
) {
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, status, is_curated, story_mode, word_count, series_state)
     values ($1, $2, 'The Corner Table', array['romance'], 'romance', 'complete', $3, 'series', 900,
             '{"open_hooks": ["Maya has not said why she came back"]}'::jsonb)`,
    [STORY, AUTHOR, overrides.isCurated ?? false],
  );
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content, word_count, chapter_role, is_published)
     values ($1, $2, 1, 'Ch 1', 'Aarav walked in.\n\nMaya looked up.', 400, 'series_opening', true),
            ($3, $2, 2, 'Ch 2', 'Aarav ordered chai.\n\nMaya stayed quiet.', 500, 'mid_series', true)`,
    [CHAPTER_ONE, STORY, CHAPTER_TWO],
  );
  await db.query(
    `insert into characters (story_id, name, description, background, appearance, is_hero)
     values ($1, 'Aarav', 'A returning son', 'Left at fifteen', 'Rolled sleeves', true),
            ($1, 'Maya', 'The girl at the counter', null, 'Blue marker on her hands', false)`,
    [STORY],
  );
}

Deno.test("a story's cast is remembered once per lower-cased name, only for its author", async () => {
  const db = await createDatabase();
  try {
    await seedUsers(db);
    await seedStory(db);

    const first = await db.query<{ n: number }>(
      "select remember_story_characters($1, $2) as n",
      [AUTHOR, STORY],
    );
    assertEquals(first.rows[0].n, 2);

    // Same names again, and a case variant, are not duplicates.
    await db.query(
      "insert into characters (story_id, name, description) values ($1, 'AARAV', 'shouted')",
      [STORY],
    );
    const second = await db.query<{ n: number }>(
      "select remember_story_characters($1, $2) as n",
      [AUTHOR, STORY],
    );
    assertEquals(second.rows[0].n, 0);

    // Somebody else calling it against a story they do not own gets nothing.
    const stranger = await db.query<{ n: number }>(
      "select remember_story_characters($1, $2) as n",
      [READER, STORY],
    );
    assertEquals(stranger.rows[0].n, 0);

    const rows = await db.query<{ owner_id: string; name: string }>(
      "select owner_id, name from user_characters order by name",
    );
    assertEquals(rows.rows.map((r) => r.name), ["Aarav", "Maya"]);
    assert(rows.rows.every((r) => r.owner_id === AUTHOR));
  } finally {
    await db.close();
  }
});

Deno.test("saved characters are visible and deletable only by their owner, and the client RPC scopes to auth.uid()", async () => {
  const db = await createDatabase();
  try {
    await seedUsers(db);
    await seedStory(db);

    await asUser(db, AUTHOR);
    const saved = await db.query<{ n: number }>(
      "select save_my_story_characters($1) as n",
      [STORY],
    );
    assertEquals(saved.rows[0].n, 2);
    const mine = await db.query<{ name: string }>(
      "select name from user_characters order by name",
    );
    assertEquals(mine.rows.length, 2);

    // A user may insert their own directly through PostgREST-shaped access...
    assertEquals(
      await attempt(
        db,
        `insert into user_characters (owner_id, name) values ('${AUTHOR}', 'Ravi')`,
      ),
      null,
    );
    // ...but not somebody else's.
    assertEquals(
      await attempt(
        db,
        `insert into user_characters (owner_id, name) values ('${READER}', 'Impostor')`,
      ),
      "42501",
    );

    await asUser(db, READER);
    const theirs = await db.query<{ name: string }>(
      "select name from user_characters",
    );
    assertEquals(theirs.rows.length, 0);
    // A delete that RLS hides is a no-op, not a breach.
    await db.query("delete from user_characters");
    await asSuperuser(db);
    const still = await db.query<{ count: number }>(
      "select count(*)::int as count from user_characters",
    );
    assertEquals(still.rows[0].count, 3);
  } finally {
    await db.close();
  }
});

Deno.test("fork_story copies a readable story privately for a non-author and refuses everything else", async () => {
  const db = await createDatabase();
  try {
    await seedUsers(db);
    // Curated: readable by everyone (Katha Originals) without being public,
    // which is the case that proves a fork copies the private flag rather
    // than inheriting the source's readability.
    await seedStory(db, { isCurated: true });

    // The author cannot fork their own story.
    assertEquals(
      await attempt(db, `select fork_story('${STORY}', '${AUTHOR}')`),
      "P0001",
    );

    const forked = await db.query<{ id: string }>(
      "select fork_story($1, $2) as id",
      [STORY, READER],
    );
    const copyId = forked.rows[0].id;
    assertNotEquals(copyId, STORY);

    const copy = await db.query<{
      author_id: string;
      is_public: boolean;
      is_curated: boolean;
      forked_from_story_id: string;
      title: string;
      status: string;
      like_count: number;
    }>(
      "select author_id, is_public, is_curated, forked_from_story_id, title, status, like_count from stories where id = $1",
      [copyId],
    );
    assertEquals(copy.rows[0].author_id, READER);
    assertEquals(copy.rows[0].is_public, false);
    assertEquals(copy.rows[0].is_curated, false);
    assertEquals(copy.rows[0].forked_from_story_id, STORY);
    assertEquals(copy.rows[0].title, "The Corner Table");
    assertEquals(copy.rows[0].status, "complete");
    assertEquals(copy.rows[0].like_count, 0);

    const chapters = await db.query<{
      chapter_number: number;
      content: string;
      is_published: boolean;
      id: string;
    }>(
      "select id, chapter_number, content, is_published from chapters where story_id = $1 order by chapter_number",
      [copyId],
    );
    assertEquals(chapters.rows.map((c) => c.chapter_number), [1, 2]);
    assertEquals(
      chapters.rows[0].content,
      "Aarav walked in.\n\nMaya looked up.",
    );
    assert(chapters.rows.every((c) => c.is_published === false));
    assert(
      chapters.rows.every((c) => c.id !== CHAPTER_ONE && c.id !== CHAPTER_TWO),
    );

    const cast = await db.query<{ name: string; is_hero: boolean }>(
      "select name, is_hero from characters where story_id = $1 order by name",
      [copyId],
    );
    assertEquals(cast.rows.map((c) => c.name), ["Aarav", "Maya"]);

    // The original is untouched.
    const original = await db.query<{ count: number }>(
      "select count(*)::int as count from chapters where story_id = $1",
      [STORY],
    );
    assertEquals(original.rows[0].count, 2);

    // A private story cannot be forked by a stranger.
    await db.query("update stories set is_curated = false where id = $1", [
      STORY,
    ]);
    assertEquals(
      await attempt(db, `select fork_story('${STORY}', '${READER}')`),
      "P0001",
    );
  } finally {
    await db.close();
  }
});

Deno.test("a reimagine reserves a credit under its own kind and completes by rewriting the chapter in place", async () => {
  const db = await createDatabase();
  try {
    await seedUsers(db);
    await seedStory(db);

    await db.query(
      `insert into voices (id, display_name, gender, provider, provider_voice_id, is_active)
       values ('v-test', 'Test', 'female', 'runpod', 'x', true)
       on conflict do nothing`,
    ).catch(() => {});

    const reserved = await db.query<{ result: Record<string, unknown> }>(
      "select reserve_generation_operation($1, 'reimagine-1', $2, 2, 'reimagine') as result",
      [AUTHOR, STORY],
    );
    const operationId = reserved.rows[0].result.id as string;
    assertEquals(reserved.rows[0].result.replayed, false);
    assertEquals(reserved.rows[0].result.balance, 9);

    // The same chapter cannot be reserved twice while the rewrite is running,
    // by a continuation or by another reimagine.
    assertEquals(
      await attempt(
        db,
        `select reserve_generation_operation('${AUTHOR}', 'reimagine-2', '${STORY}', 2, 'reimagine')`,
      ),
      "KTH01",
    );

    const completed = await db.query<{ result: Record<string, unknown> }>(
      `select complete_reimagine_generation(
         $1, $2, 'A New Table', 'Aarav walked out.\n\nMaya followed.', 450,
         'Aarav walked out.', 'They left together.', '{"open_hooks": ["Where are they going"]}'::jsonb,
         'unanswered_question', 'Where are they going'
       ) as result`,
      [operationId, AUTHOR],
    );
    const chapter = completed.rows[0].result;
    assertEquals(chapter.id, CHAPTER_TWO);
    assertEquals(chapter.title, "A New Table");
    assertEquals(chapter.content, "Aarav walked out.\n\nMaya followed.");
    assertEquals(chapter.word_count, 450);
    assertEquals(chapter.hook_type, "unanswered_question");

    const story = await db.query<{
      word_count: number;
      series_state: Record<string, unknown>;
      previously_summary: string;
    }>(
      "select word_count, series_state, previously_summary from stories where id = $1",
      [STORY],
    );
    // 900 - 500 + 450: the story total tracks the rewrite.
    assertEquals(story.rows[0].word_count, 850);
    // Chapter 2 is the latest, so continuity follows it.
    assertEquals(story.rows[0].series_state.open_hooks, [
      "Where are they going",
    ]);
    assertEquals(story.rows[0].previously_summary, "They left together.");

    const op = await db.query<{ status: string; result_chapter_id: string }>(
      "select status, result_chapter_id from generation_operations where id = $1",
      [operationId],
    );
    assertEquals(op.rows[0].status, "completed");
    assertEquals(op.rows[0].result_chapter_id, CHAPTER_TWO);

    // Chapter count is unchanged: a rewrite is not a new chapter.
    const count = await db.query<{ count: number }>(
      "select count(*)::int as count from chapters where story_id = $1",
      [STORY],
    );
    assertEquals(count.rows[0].count, 2);
  } finally {
    await db.close();
  }
});

Deno.test("reimagining a middle chapter leaves the story's continuity alone and a completion needs a reservation of its own kind", async () => {
  const db = await createDatabase();
  try {
    await seedUsers(db);
    await seedStory(db);

    const reserved = await db.query<{ result: Record<string, unknown> }>(
      "select reserve_generation_operation($1, 'reimagine-mid', $2, 1, 'reimagine') as result",
      [AUTHOR, STORY],
    );
    const operationId = reserved.rows[0].result.id as string;

    await db.query(
      `select complete_reimagine_generation(
         $1, $2, '', 'Rewritten opening.', 300, null, 'Something else.',
         '{"open_hooks": ["should not land"]}'::jsonb, 'danger', 'a hook'
       )`,
      [operationId, AUTHOR],
    );

    const story = await db.query<{
      series_state: Record<string, unknown>;
      previously_summary: string | null;
    }>(
      "select series_state, previously_summary from stories where id = $1",
      [STORY],
    );
    assertEquals(story.rows[0].series_state.open_hooks, [
      "Maya has not said why she came back",
    ]);
    assertEquals(story.rows[0].previously_summary, null);

    // An empty title keeps the old one.
    const chapter = await db.query<{ title: string; hook_type: string }>(
      "select title, hook_type from chapters where id = $1",
      [CHAPTER_ONE],
    );
    assertEquals(chapter.rows[0].title, "Ch 1");
    // A series opening may carry a hook; the rule only forces 'none' for
    // standalone and finale roles.
    assertEquals(chapter.rows[0].hook_type, "danger");

    // A continuation reservation cannot be completed as a reimagine.
    const cont = await db.query<{ result: Record<string, unknown> }>(
      "select reserve_generation_operation($1, 'cont-3', $2, 3, 'continuation') as result",
      [AUTHOR, STORY],
    );
    assertEquals(
      await attempt(
        db,
        `select complete_reimagine_generation('${
          cont.rows[0].result.id
        }', '${AUTHOR}', 't', 'c', 1)`,
      ),
      "P0001",
    );
  } finally {
    await db.close();
  }
});

Deno.test("a story character can point at the saved character it was made from", async () => {
  const db = await createDatabase();
  try {
    await seedUsers(db);
    await seedStory(db);
    const saved = await db.query<{ id: string }>(
      "insert into user_characters (owner_id, name, appearance) values ($1, 'Ravi', 'tall') returning id",
      [AUTHOR],
    );
    await db.query(
      "insert into characters (story_id, name, saved_character_id) values ($1, 'Ravi', $2)",
      [STORY, saved.rows[0].id],
    );
    await db.query("delete from user_characters where id = $1", [
      saved.rows[0].id,
    ]);
    const row = await db.query<{ saved_character_id: string | null }>(
      "select saved_character_id from characters where name = 'Ravi'",
    );
    assertEquals(row.rows[0].saved_character_id, null);
  } finally {
    await db.close();
  }
});

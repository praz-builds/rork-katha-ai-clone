import {
  assertEquals,
  assertStringIncludes,
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

async function asService(db: PGlite) {
  await db.exec("reset role; set role service_role;");
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

async function createUser(db: PGlite, id: string, username?: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into profiles(id, username) values ($1, $2)", [
    id,
    username ?? `user_${id.slice(-4)}`,
  ]);
}

async function createStory(db: PGlite, id: string, authorId: string) {
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, is_public, status, content_rating)
     values ($1, $2, 'Engagement Story', array['romance'], 'romance', true,
             'complete', 'sweet')`,
    [id, authorId],
  );
}

async function createChapter(db: PGlite, id: string, storyId: string) {
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content, is_published)
     values ($1, $2, 1, 'One', 'Body', true)`,
    [id, storyId],
  );
}

async function scalar<T>(db: PGlite, sql: string, params: unknown[] = []) {
  const result = await db.query<Record<string, T>>(sql, params);
  return Object.values(result.rows[0])[0];
}

const AUTHOR = "00000000-0000-4000-8000-000000000461";
const READER = "00000000-0000-4000-8000-000000000462";
const OTHER = "00000000-0000-4000-8000-000000000463";
const STORY = "00000000-0000-4000-8000-000000000460";
const CHAPTER = "00000000-0000-4000-8000-000000000464";

async function seed(db: PGlite) {
  for (const id of [AUTHOR, READER, OTHER]) {
    await createUser(db, id);
  }
  await createStory(db, STORY, AUTHOR);
  await createChapter(db, CHAPTER, STORY);
  await asService(db);
}

Deno.test("liking twice leaves the counter at 1", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    const first = await db.query<{ on: boolean; count: number }>(
      "select * from toggle_story_like($1, $2, true)",
      [READER, STORY],
    );
    const second = await db.query<{ on: boolean; count: number }>(
      "select * from toggle_story_like($1, $2, true)",
      [READER, STORY],
    );

    assertEquals(first.rows[0], { on: true, count: 1 });
    assertEquals(second.rows[0], { on: true, count: 1 });
    assertEquals(
      await scalar<number>(db, "select like_count from stories where id = $1", [
        STORY,
      ]),
      1,
    );
  } finally {
    await db.close();
  }
});

Deno.test("unliking an unliked story is a clean no-op", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    const result = await db.query<{ on: boolean; count: number }>(
      "select * from toggle_story_like($1, $2, false)",
      [READER, STORY],
    );

    assertEquals(result.rows[0], { on: false, count: 0 });
    assertEquals(
      await scalar<number>(db, "select like_count from stories where id = $1", [
        STORY,
      ]),
      0,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a concurrent-safe double-call leaves like rows and counter consistent", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const migration = await Deno.readTextFile(
      new URL("00046_engagement_persistence.sql", import.meta.url),
    );
    assertStringIncludes(
      migration,
      "pg_catalog.pg_advisory_xact_lock",
    );
    assertStringIncludes(
      migration,
      "insert into public.story_likes(user_id, story_id)",
    );
    assertStringIncludes(migration, "on conflict do nothing");

    await db.query("select * from toggle_story_like($1, $2, true)", [
      READER,
      STORY,
    ]);
    await db.query("select * from toggle_story_like($1, $2, true)", [
      READER,
      STORY,
    ]);

    await asSuperuser(db);
    assertEquals(
      await scalar<number>(db, "select count(*)::int from story_likes"),
      1,
    );
    assertEquals(
      await scalar<number>(db, "select like_count from stories where id = $1", [
        STORY,
      ]),
      1,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a self-follow is refused cleanly", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    const result = await db.query<
      { on: boolean; count: number; refused: boolean }
    >(
      "select * from toggle_user_follow($1, $2, true)",
      [AUTHOR, AUTHOR],
    );

    assertEquals(result.rows[0], { on: false, count: 0, refused: true });
    assertEquals(
      await scalar<number>(db, "select count(*)::int from user_followers"),
      0,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a second read of the same chapter inside 24h does not move read_count", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    const first = await db.query<
      { recorded: boolean; counted: boolean; count: number }
    >(
      "select recorded, counted, count from record_story_read($1, $2, $3, 12, null, null)",
      [READER, STORY, CHAPTER],
    );
    const second = await db.query<
      { recorded: boolean; counted: boolean; count: number }
    >(
      "select recorded, counted, count from record_story_read($1, $2, $3, 18, null, null)",
      [READER, STORY, CHAPTER],
    );

    assertEquals(first.rows[0], { recorded: true, counted: true, count: 1 });
    assertEquals(second.rows[0], { recorded: false, counted: false, count: 1 });
    await asSuperuser(db);
    assertEquals(
      await scalar<number>(db, "select read_count from stories where id = $1", [
        STORY,
      ]),
      1,
    );
    assertEquals(
      await scalar<number>(db, "select count(*)::int from story_reads"),
      1,
    );
  } finally {
    await db.close();
  }
});

Deno.test("an author reading their own story does not count for earnings", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    const result = await db.query<
      {
        recorded: boolean;
        counted: boolean;
        count: number;
        is_own_story: boolean;
        counts_for_earnings: boolean;
      }
    >(
      `select recorded, counted, count, is_own_story, counts_for_earnings
       from record_story_read($1, $2, $3, 20, null, null)`,
      [AUTHOR, STORY, CHAPTER],
    );

    assertEquals(result.rows[0], {
      recorded: true,
      counted: false,
      count: 0,
      is_own_story: true,
      counts_for_earnings: false,
    });
    assertEquals(
      await scalar<number>(db, "select read_count from stories where id = $1", [
        STORY,
      ]),
      0,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a streak touched twice in one day increments once", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    const first = await db.query<
      { current_streak: number; longest_streak: number }
    >(
      "select current_streak, longest_streak from touch_streak($1)",
      [READER],
    );
    const second = await db.query<
      { current_streak: number; longest_streak: number }
    >(
      "select current_streak, longest_streak from touch_streak($1)",
      [READER],
    );

    assertEquals(first.rows[0], { current_streak: 1, longest_streak: 1 });
    assertEquals(second.rows[0], { current_streak: 1, longest_streak: 1 });
  } finally {
    await db.close();
  }
});

Deno.test("longest_streak is raised but never lowered", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await asSuperuser(db);
    await db.query(
      `insert into streaks
         (user_id, current_streak, longest_streak, last_activity_date, next_credit_at)
       values ($1, 8, 8, (now() at time zone 'UTC')::date - 3, 3)`,
      [OTHER],
    );
    await asService(db);

    const reset = await db.query<
      { current_streak: number; longest_streak: number }
    >(
      "select current_streak, longest_streak from touch_streak($1)",
      [OTHER],
    );
    assertEquals(reset.rows[0], { current_streak: 1, longest_streak: 8 });

    await asSuperuser(db);
    await db.query(
      `update streaks
       set current_streak = 8,
           longest_streak = 8,
           last_activity_date = (now() at time zone 'UTC')::date - 1
       where user_id = $1`,
      [OTHER],
    );
    await asService(db);

    const raised = await db.query<
      { current_streak: number; longest_streak: number }
    >(
      "select current_streak, longest_streak from touch_streak($1)",
      [OTHER],
    );
    assertEquals(raised.rows[0], { current_streak: 9, longest_streak: 9 });
  } finally {
    await db.close();
  }
});

Deno.test("relationship RLS exposes only the caller's own rows", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await asSuperuser(db);
    await db.query(
      "insert into story_likes(user_id, story_id) values ($1, $2)",
      [
        READER,
        STORY,
      ],
    );
    await db.query(
      "insert into story_likes(user_id, story_id) values ($1, $2)",
      [
        OTHER,
        STORY,
      ],
    );

    await asUser(db, READER);
    const rows = await db.query<{ user_id: string }>(
      "select user_id from story_likes order by user_id",
    );
    assertEquals(rows.rows, [{ user_id: READER }]);

    assertEquals(
      await attempt(
        db,
        `insert into story_likes(user_id, story_id) values ('${OTHER}', '${STORY}')`,
      ),
      "42501",
    );
  } finally {
    await db.close();
  }
});

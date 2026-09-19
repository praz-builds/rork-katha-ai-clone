// 00092: the story bible column.
//
// Small, because the migration is small -- but the two things it must be true
// of are the two things a nullable jsonb column added to a hot table can get
// wrong: an existing row must survive it reading as "no bible", and the column
// must actually accept the document shape the merge writes. Both are cheap to
// assert and neither is obvious from reading one `alter table`.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

const THIS_MIGRATION = "00092_story_bible.sql";

async function createDatabase(stopBefore?: string) {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
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
    if (stopBefore && migration >= stopBefore) break;
    await applyMigration(db, migration);
  }
  return db;
}

async function applyMigration(db: PGlite, migration: string) {
  const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
  await db.exec(sql.replace(/create index concurrently/gi, "create index"));
}

const AUTHOR = "00000000-0000-4000-8000-000000000921";
const OLD_STORY = "00000000-0000-4000-8000-0000000009c1";
const NEW_STORY = "00000000-0000-4000-8000-0000000009c2";

Deno.test("a story written before the bible existed keeps reading as one with no bible", async () => {
  const db = await createDatabase(THIS_MIGRATION);
  try {
    await db.query("insert into auth.users(id) values ($1)", [AUTHOR]);
    await db.query(
      "insert into profiles(id, username) values ($1, 'bible_author')",
      [AUTHOR],
    );
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, status)
       values ($1, $2, 'Written Yesterday', array['mystery'], 'mystery', 'complete')`,
      [OLD_STORY, AUTHOR],
    );

    await applyMigration(db, THIS_MIGRATION);

    // NULL, not '{}': the column carries "this story predates the bible", and
    // `parseStoryBible` is the single place that turns that into an empty one.
    // A default would have quietly claimed every legacy story had been checked.
    const { rows } = await db.query<{ story_bible: unknown }>(
      "select story_bible from stories where id = $1",
      [OLD_STORY],
    );
    assertEquals(rows[0].story_bible, null);
  } finally {
    await db.close();
  }
});

Deno.test("the column accepts a whole bible document", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [AUTHOR]);
    await db.query(
      "insert into profiles(id, username) values ($1, 'bible_author')",
      [AUTHOR],
    );
    const bible = {
      version: 1,
      facts: [{
        id: "klazina|cows",
        subject: "Klazina",
        key: "cows",
        value: "three",
        chapter: 1,
      }],
      calendar: {
        start: "12 March 1953, dawn",
        now: "14 March 1953, evening",
        elapsed: "two days",
        deadline: "the 09:00 ferry on the 16th",
        day: 2,
      },
      truth: ["Adriaan took the list the night the dyke broke."],
      shown: [{ chapter: 2, what: "Adriaan admits he took the list" }],
      contradictions: [],
    };
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, status, story_bible)
       values ($1, $2, 'Island Calling', array['mystery'], 'mystery', 'complete', $3)`,
      [NEW_STORY, AUTHOR, JSON.stringify(bible)],
    );
    const { rows } = await db.query<{ day: number; cows: string }>(
      `select (story_bible->'calendar'->>'day')::int as day,
              story_bible->'facts'->0->>'value' as cows
         from stories where id = $1`,
      [NEW_STORY],
    );
    assertEquals(rows[0].day, 2);
    assertEquals(rows[0].cows, "three");
  } finally {
    await db.close();
  }
});

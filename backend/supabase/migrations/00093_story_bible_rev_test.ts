// 00093: the story bible's revision counter.
//
// The counter exists to make the bible's write conditional, so the two things
// worth asserting are the two the compare-and-swap depends on: a row that
// already existed starts at a known revision rather than NULL, and an update
// guarded on a STALE revision changes nothing. The second is the whole bug --
// chapter N+1 overwriting chapter N's facts because it merged against a bible
// it read before N's deferred write landed.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

const THIS_MIGRATION = "00093_story_bible_rev.sql";

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

const AUTHOR = "00000000-0000-4000-8000-000000000931";
const STORY = "00000000-0000-4000-8000-0000000009d1";

async function seedStory(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [AUTHOR]);
  await db.query(
    "insert into profiles(id, username) values ($1, 'rev_author')",
    [AUTHOR],
  );
  await db.query(
    `insert into stories (id, author_id, title, genre, primary_genre, status)
     values ($1, $2, 'The Tide Register', array['mystery'], 'mystery', 'complete')`,
    [STORY, AUTHOR],
  );
}

Deno.test("a story that existed before the counter starts at revision 0, not null", async () => {
  // NOT NULL DEFAULT 0 rather than a nullable integer: the compare-and-swap
  // filters on equality, and `= null` matches no row in SQL, so a nullable
  // column would make every legacy story's first merge silently lose.
  const db = await createDatabase(THIS_MIGRATION);
  try {
    await seedStory(db);
    await applyMigration(db, THIS_MIGRATION);

    const { rows } = await db.query<{ story_bible_rev: number }>(
      "select story_bible_rev from stories where id = $1",
      [STORY],
    );
    assertEquals(rows[0].story_bible_rev, 0);
  } finally {
    await db.close();
  }
});

Deno.test("a merge guarded on a stale revision writes nothing, and the winner's facts survive", async () => {
  // The race, reproduced: two chapters both read revision 0, and both merge
  // against it. The first write wins and moves the revision; the second must
  // change no row at all, which is what tells the caller to re-read and merge
  // again instead of overwriting what it never saw.
  const db = await createDatabase();
  try {
    await seedStory(db);

    const chapterOne = {
      version: 1,
      facts: [{ id: "ilse|cats", value: "three" }],
    };
    const chapterTwo = {
      version: 1,
      facts: [{ id: "joris|age", value: "34" }],
    };

    const first = await db.query(
      `update stories set story_bible = $1, story_bible_rev = story_bible_rev + 1
        where id = $2 and story_bible_rev = $3 returning id`,
      [JSON.stringify(chapterOne), STORY, 0],
    );
    assertEquals(first.rows.length, 1);

    // Chapter two still believes the revision is 0.
    const second = await db.query(
      `update stories set story_bible = $1, story_bible_rev = story_bible_rev + 1
        where id = $2 and story_bible_rev = $3 returning id`,
      [JSON.stringify(chapterTwo), STORY, 0],
    );
    assertEquals(second.rows.length, 0);

    const { rows } = await db.query<
      { story_bible: { facts: { id: string }[] }; story_bible_rev: number }
    >(
      "select story_bible, story_bible_rev from stories where id = $1",
      [STORY],
    );
    // Chapter one's fact is still there: the losing write did not land.
    assertEquals(rows[0].story_bible.facts[0].id, "ilse|cats");
    assertEquals(rows[0].story_bible_rev, 1);

    // And the retry, now merging against revision 1, succeeds.
    const retry = await db.query(
      `update stories set story_bible = $1, story_bible_rev = story_bible_rev + 1
        where id = $2 and story_bible_rev = $3 returning id`,
      [
        JSON.stringify({
          version: 1,
          facts: [...chapterOne.facts, ...chapterTwo.facts],
        }),
        STORY,
        1,
      ],
    );
    assertEquals(retry.rows.length, 1);

    const after = await db.query<{ story_bible: { facts: { id: string }[] } }>(
      "select story_bible from stories where id = $1",
      [STORY],
    );
    assertEquals(after.rows[0].story_bible.facts.map((f) => f.id), [
      "ilse|cats",
      "joris|age",
    ]);
  } finally {
    await db.close();
  }
});

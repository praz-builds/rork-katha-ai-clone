// 00099: votes on a curated list of what to build next.
//
// Every migration applied in order against a real Postgres (PGlite), then
// exercised as the `authenticated` role, because RLS and column grants only
// mean something when a non-owner role runs into them.
//
// What is asserted:
//
//   1. A reader can read topics, vote once, see the tally, and take it back.
//   2. A reader cannot vote as somebody else, cannot vote twice, cannot vote
//      on a shipped topic, cannot see other readers' vote rows, and cannot
//      write topics.
//   3. An anonymous session cannot vote.
//   4. Deleting the auth user removes that person's votes.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function createDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
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
      const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
      await db.exec(sql.replace(/create index concurrently/gi, "create index"));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

const READER = "00000000-0000-4000-8000-000000000981";
const OTHER = "00000000-0000-4000-8000-000000000982";

async function seed(db: PGlite) {
  for (const id of [READER, OTHER]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id) values ($1)", [id]);
  }
  await db.exec(
    "insert into feedback_topics(id, title, status) values ('done_thing', 'Done', 'shipped')",
  );
}

async function as<T>(
  db: PGlite,
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId,
  ]);
  await db.exec("set role authenticated");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}

Deno.test("00099: vote once on a curated topic, see the count, take it back", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    const topics = await as(
      db,
      READER,
      () =>
        db.query<{ id: string }>(
          "select id from feedback_topics order by sort_order",
        ),
    );
    assert(topics.rows.some((row) => row.id === "dark_mode_app"));

    await as(
      db,
      READER,
      () =>
        db.query(
          "insert into feedback_votes(topic_id) values ('dark_mode_app')",
        ),
    );
    await as(
      db,
      OTHER,
      () =>
        db.query(
          "insert into feedback_votes(topic_id) values ('dark_mode_app')",
        ),
    );

    const tally = await as(
      db,
      READER,
      () =>
        db.query<{ votes: number; voted: boolean }>(
          "select votes::int as votes, voted from feedback_topic_tallies() where topic_id = 'dark_mode_app'",
        ),
    );
    assertEquals(tally.rows, [{ votes: 2, voted: true }]);

    // Only one's own vote rows are visible.
    const visible = await as(
      db,
      READER,
      () => db.query<{ user_id: string }>("select user_id from feedback_votes"),
    );
    assertEquals(visible.rows, [{ user_id: READER }]);

    await as(
      db,
      READER,
      () =>
        assertRejects(() =>
          db.query(
            "insert into feedback_votes(topic_id) values ('dark_mode_app')",
          )
        ),
    );
    await as(
      db,
      READER,
      () =>
        assertRejects(() =>
          db.query("insert into feedback_votes(topic_id) values ('done_thing')")
        ),
    );
    await as(db, READER, () =>
      assertRejects(() =>
        db.query(
          "insert into feedback_votes(topic_id, user_id) values ('more_voices', $1)",
          [OTHER],
        )
      ));
    await as(
      db,
      READER,
      () =>
        assertRejects(() =>
          db.query(
            "insert into feedback_topics(id, title) values ('mine', 'Mine')",
          )
        ),
    );

    // Deleting somebody else's vote touches nothing.
    await as(
      db,
      READER,
      () => db.query("delete from feedback_votes where user_id = $1", [OTHER]),
    );
    await as(
      db,
      READER,
      () =>
        db.query("delete from feedback_votes where topic_id = 'dark_mode_app'"),
    );
    const after = await as(
      db,
      OTHER,
      () =>
        db.query<{ votes: number; voted: boolean }>(
          "select votes::int as votes, voted from feedback_topic_tallies() where topic_id = 'dark_mode_app'",
        ),
    );
    assertEquals(after.rows, [{ votes: 1, voted: true }]);
  } finally {
    await db.close();
  }
});

Deno.test("00099: an anonymous session cannot vote", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: READER, is_anonymous: true }),
    ]);
    await as(
      db,
      READER,
      () =>
        assertRejects(() =>
          db.query(
            "insert into feedback_votes(topic_id) values ('more_voices')",
          )
        ),
    );
    // The same person, named, is let through.
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: READER, is_anonymous: false }),
    ]);
    await as(
      db,
      READER,
      () =>
        db.query("insert into feedback_votes(topic_id) values ('more_voices')"),
    );
  } finally {
    await db.close();
  }
});

Deno.test("00099: deleting the auth user removes their votes", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await as(
      db,
      READER,
      () =>
        db.query("insert into feedback_votes(topic_id) values ('more_voices')"),
    );
    // The auth user going is what cascades; see the migration's Deletion note.
    await db.query("delete from auth.users where id = $1", [READER]);
    const votes = await db.query(
      "select 1 from feedback_votes where user_id = $1",
      [READER],
    );
    assertEquals(votes.rows.length, 0);
  } finally {
    await db.close();
  }
});

// 00069-00072: the profile surface, and the two functions that raised 42883
// on every call because an expression node was schema-qualified.
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

const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER = "aaaaaaaa-0000-0000-0000-000000000002";
const STORY = "aaaaaaaa-0000-0000-0000-000000000003";

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users(id) values ('${USER}'), ('${OTHER}');
    insert into public.profiles(id, username) values
      ('${USER}', 'nightmapper'), ('${OTHER}', 'reader_two');
    insert into public.stories(id, author_id, title, genre, primary_genre, status, is_public)
      values ('${STORY}', '${USER}', 'The Night Cartographer',
              array['fantasy'], 'fantasy', 'complete', true);
  `);
}

// ---------------------------------------------------------------------------
// 00071: the two calls that always raised
//
// Both deployed cleanly and passed every migration test, because a plpgsql
// body is only parsed when it RUNS. The only test that could have caught them
// is one that calls the function -- so these do.
// ---------------------------------------------------------------------------

Deno.test("set_profile_bio actually runs, for text and for null", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const { rows } = await db.query<{ bio: string | null }>(
      `select bio from public.set_profile_bio($1, $2)`,
      [USER, "  Maps the streets that only exist at night.  "],
    );
    assertEquals(rows[0].bio, "Maps the streets that only exist at night.");

    // The null path is the one that names `coalesce` as well as `nullif`.
    const cleared = await db.query<{ bio: string | null }>(
      `select bio from public.set_profile_bio($1, null)`,
      [USER],
    );
    assertEquals(cleared.rows[0].bio, null);

    // Whitespace collapses to null rather than to a blank line under a name.
    const blank = await db.query<{ bio: string | null }>(
      `select bio from public.set_profile_bio($1, '   ')`,
      [USER],
    );
    assertEquals(blank.rows[0].bio, null);
  } finally {
    await db.close();
  }
});

Deno.test("release_cover_claim gives the attempt back instead of raising", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec(
      `update public.stories set cover_attempt_count = 3, cover_status = 'generating' where id = '${STORY}'`,
    );

    await db.query(
      `select public.release_cover_claim($1, $2, 'ready', true)`,
      [STORY, USER],
    );
    const { rows } = await db.query<{ n: number; status: string }>(
      `select cover_attempt_count as n, cover_status as status
         from public.stories where id = $1`,
      [STORY],
    );
    assertEquals(rows[0].n, 2, "the refunded attempt was not returned");
    assertEquals(rows[0].status, "ready");

    // Replayed release cannot drive the count below zero.
    await db.exec(
      `update public.stories set cover_attempt_count = 0 where id = '${STORY}'`,
    );
    await db.query(
      `select public.release_cover_claim($1, $2, 'failed', true)`,
      [STORY, USER],
    );
    const { rows: floor } = await db.query<{ n: number }>(
      `select cover_attempt_count as n from public.stories where id = $1`,
      [STORY],
    );
    assertEquals(floor[0].n, 0);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 00069: the name, and the calendar
// ---------------------------------------------------------------------------

Deno.test("a display name is the owner's to write, and is not the handle", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // Names are not slugs: spaces, capitals and accents all belong.
    await db.query(
      `update public.profiles set display_name = $2 where id = $1`,
      [USER, "Priyá Ramanujan"],
    );
    const { rows } = await db.query<{ display_name: string; username: string }>(
      `select display_name, username from public.profiles where id = $1`,
      [USER],
    );
    assertEquals(rows[0].display_name, "Priyá Ramanujan");
    assertEquals(rows[0].username, "nightmapper");

    const canWrite = await db.query<{ ok: boolean }>(
      `select has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE') as ok`,
    );
    assertEquals(canWrite.rows[0].ok, true);
  } finally {
    await db.close();
  }
});

Deno.test("an empty display name is refused, and a very long one too", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (const bad of ["   ", "x".repeat(61)]) {
      let raised = false;
      try {
        await db.query(
          `update public.profiles set display_name = $2 where id = $1`,
          [USER, bad],
        );
      } catch {
        raised = true;
      }
      assertEquals(raised, true, `"${bad.slice(0, 8)}..." was accepted`);
    }
  } finally {
    await db.close();
  }
});

// The calendar and the streak must never disagree: one function decides both.
Deno.test("touch_streak records the day it counts", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(`select * from public.touch_streak($1)`, [USER]);
    // Called twice on the same day: one streak, one row, no duplicate error.
    await db.query(`select * from public.touch_streak($1)`, [USER]);

    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.activity_days where user_id = $1`,
      [USER],
    );
    assertEquals(rows[0].n, 1);

    const cal = await db.query<{ day: string }>(
      `select day::text as day from public.activity_calendar($1, 365)`,
      [USER],
    );
    assertEquals(cal.rows.length, 1);
  } finally {
    await db.close();
  }
});

Deno.test("the calendar window is bounded and cannot be widened past a year", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec(`
      insert into public.activity_days(user_id, day) values
        ('${USER}', (now() at time zone 'UTC')::date),
        ('${USER}', (now() at time zone 'UTC')::date - 10),
        ('${USER}', (now() at time zone 'UTC')::date - 500);
    `);
    // 500 days ago is outside even the hard ceiling.
    const wide = await db.query<{ day: string }>(
      `select day::text as day from public.activity_calendar($1, 100000)`,
      [USER],
    );
    assertEquals(wide.rows.length, 2);

    const narrow = await db.query<{ day: string }>(
      `select day::text as day from public.activity_calendar($1, 5)`,
      [USER],
    );
    assertEquals(narrow.rows.length, 1, "a 5 day window returned another day");
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 00072: what each profile shows
// ---------------------------------------------------------------------------

Deno.test("profile_overview carries the display name and the tombstone flag", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(
      `update public.profiles set display_name = 'Priya' where id = $1`,
      [USER],
    );
    const { rows } = await db.query<
      {
        display_name: string | null;
        deleted_at: string | null;
        following: number;
      }
    >(
      `select display_name, deleted_at, following from public.profile_overview($1)`,
      [USER],
    );
    assertEquals(rows[0].display_name, "Priya");
    assertEquals(rows[0].deleted_at, null);
    assertEquals(rows[0].following, 0);
  } finally {
    await db.close();
  }
});

// A comment is only as public as the story it is on. A profile must not become
// a way to read around a story's visibility.
Deno.test("profile_comments follows the story's visibility, not the comment's", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const PRIVATE = "aaaaaaaa-0000-0000-0000-00000000000f";
    await db.exec(`
      insert into public.stories(id, author_id, title, genre, primary_genre, status, is_public)
        values ('${PRIVATE}', '${OTHER}', 'Kept Back', array['fantasy'], 'fantasy', 'complete', false);
      insert into public.comments(story_id, user_id, content) values
        ('${STORY}', '${USER}', 'On a public story.'),
        ('${PRIVATE}', '${USER}', 'On a private one.');
    `);

    const { rows } = await db.query<{ content: string }>(
      `select content from public.profile_comments($1, 20)`,
      [USER],
    );
    assertEquals(rows.map((r) => r.content), ["On a public story."]);
  } finally {
    await db.close();
  }
});

Deno.test("a soft-deleted comment leaves the profile too", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec(`
      insert into public.comments(story_id, user_id, content, deleted_at)
        values ('${STORY}', '${USER}', 'Withdrawn.', now());
    `);
    const { rows } = await db.query<{ content: string }>(
      `select content from public.profile_comments($1, 20)`,
      [USER],
    );
    assertEquals(rows, []);
  } finally {
    await db.close();
  }
});

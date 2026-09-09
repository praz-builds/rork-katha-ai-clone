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

async function createUser(db: PGlite, id: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into profiles(id) values ($1)", [id]);
}

async function claim(db: PGlite, userId: string, scope: string | null) {
  const result = await db.query<{ claim_story_shape_request: boolean }>(
    "select claim_story_shape_request($1, $2)",
    [userId, scope],
  );
  return result.rows[0].claim_story_shape_request;
}

Deno.test("a request rejected by the per-user limit does not spend the budget", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000391";

  try {
    await createUser(db, userId);

    for (let index = 0; index < 6; index++) {
      assertEquals(await claim(db, userId, null), true);
    }

    // The seventh is over the six-per-minute window. 00039's fix was the
    // ordering that gets here: decide first, write afterwards, so a claim that
    // is going to be refused never moves a counter on its way to refusing.
    assertEquals(await claim(db, userId, null), false);

    const perUser = await db.query<{ request_count: number }>(
      "select request_count from story_shape_rate_limits where user_id = $1",
      [userId],
    );
    assertEquals(perUser.rows[0].request_count, 6);
  } finally {
    await db.close();
  }
});

Deno.test("the per-minute window reopens, and it is the only limit left", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000393";

  try {
    await createUser(db, userId);

    for (let index = 0; index < 6; index++) {
      assertEquals(await claim(db, userId, null), true);
    }
    assertEquals(await claim(db, userId, null), false);

    await db.query(
      `update story_shape_rate_limits
       set window_started_at = now() - interval '2 minutes'
       where user_id = $1`,
      [userId],
    );
    assertEquals(await claim(db, userId, null), true);
  } finally {
    await db.close();
  }
});

/*
 * Three tests were removed here rather than rewritten, and this note is what
 * is left of them.
 *
 * They asserted the two anonymous ceilings 00046 deletes: that thirty claims
 * from thirty different users sharing one network scope refused the
 * thirty-first, that a global counter sitting at 500 refused everybody for the
 * rest of the day, and that an unparseable scope hash raised. All three
 * described a policy that no longer exists - not behaviour that regressed - so
 * keeping them inverted ("assert the ceiling does NOT apply") would have left
 * this file arguing with itself about which migration was in force.
 * `00056_story_shape_no_anonymous_ceiling_test.ts` asserts the policy that
 * replaced them.
 */

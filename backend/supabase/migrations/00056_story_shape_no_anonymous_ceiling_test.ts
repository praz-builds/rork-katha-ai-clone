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

function userId(index: number) {
  // The last group is exactly twelve hex digits, so the index gets five.
  return `00000000-0000-4000-8000-0000046${String(index).padStart(5, "0")}`;
}

Deno.test("no number of people sharing a network can use up the previews", async () => {
  // The per-scope ceiling was 30 a day. One office, cafe or campus is one
  // scope, so a room of people trying the product together was the exact
  // situation that ran it out - and the thirty-first person met an empty
  // answer they had no way to read as anything but their idea failing.
  const db = await createDatabase();
  const scope = "a".repeat(64);

  try {
    for (let index = 0; index < 40; index++) {
      const id = userId(index);
      await createUser(db, id);
      assertEquals(await claim(db, id, scope), true);
    }
  } finally {
    await db.close();
  }
});

Deno.test("there is no project-wide daily ceiling on shaped previews", async () => {
  // 500 a day across every anonymous user, which onboarding spends one of per
  // new writer. The five hundredth new user of the day used to be the last one
  // who could be shown a shaped preview.
  const db = await createDatabase();

  try {
    const rows = await db.query<{ count: number }>(
      "select count(*)::int as count from anonymous_story_shape_global_limits",
    );
    assertEquals(rows.rows[0].count, 0, "the global counter is never written");

    for (let index = 100; index < 140; index++) {
      const id = userId(index);
      await createUser(db, id);
      assertEquals(await claim(db, id, "b".repeat(64)), true);
    }

    const after = await db.query<{ count: number }>(
      "select count(*)::int as count from anonymous_story_shape_global_limits",
    );
    assertEquals(after.rows[0].count, 0);
  } finally {
    await db.close();
  }
});

Deno.test("the per-caller burst guard is untouched", async () => {
  // The limit that survives, because it is the only one scoped to whoever is
  // actually doing the damage: a client in a retry loop is stopped in the same
  // second it starts, and a person writing a story never reaches it.
  const db = await createDatabase();
  const id = userId(90);

  try {
    await createUser(db, id);
    for (let index = 0; index < 6; index++) {
      assertEquals(await claim(db, id, null), true);
    }
    assertEquals(await claim(db, id, null), false);
  } finally {
    await db.close();
  }
});

Deno.test("the scope parameter is accepted and ignored, however malformed", async () => {
  // Kept in the signature on purpose: `shape-story` and this migration do not
  // deploy atomically, so the deployed function may still be passing a hash
  // for a window after this lands. It must not be able to raise - and it no
  // longer validates, because there is nothing left that reads the value.
  const db = await createDatabase();
  const id = userId(91);

  try {
    await createUser(db, id);
    assertEquals(await claim(db, id, "not-a-hash"), true);
    assertEquals(await claim(db, id, ""), true);
  } finally {
    await db.close();
  }
});

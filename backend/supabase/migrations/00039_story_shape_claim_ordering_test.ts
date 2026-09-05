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

async function globalCount(db: PGlite) {
  const result = await db.query<{ request_count: number }>(
    "select request_count from anonymous_story_shape_global_limits where window_key = now()::date",
  );
  return result.rows[0]?.request_count ?? 0;
}

Deno.test("a request rejected by the per-user limit does not spend the global anonymous budget", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000391";
  const scope = "a".repeat(64);

  try {
    await createUser(db, userId);

    for (let index = 0; index < 6; index++) {
      assertEquals(await claim(db, userId, scope), true);
    }
    assertEquals(await globalCount(db), 6);

    // The seventh is over the six-per-minute per-user limit. Before the
    // reorder this still incremented the global counter to 7 on its way to
    // returning false, so a client retrying in a loop drained the project's
    // shared daily budget without ever receiving a shape.
    assertEquals(await claim(db, userId, scope), false);
    assertEquals(await globalCount(db), 6);

    const perScope = await db.query<{ request_count: number }>(
      "select request_count from anonymous_story_shape_rate_limits where scope_hash = $1",
      [scope],
    );
    assertEquals(perScope.rows[0].request_count, 6);
  } finally {
    await db.close();
  }
});

Deno.test("the per-scope daily limit still stops before the global counter moves", async () => {
  const db = await createDatabase();
  const scope = "b".repeat(64);

  try {
    // Thirty distinct users so only the shared network scope can reject.
    for (let index = 0; index < 31; index++) {
      const userId = `00000000-0000-4000-8000-0000000004${
        String(index).padStart(2, "0")
      }`;
      await createUser(db, userId);
      const granted = await claim(db, userId, scope);
      assertEquals(granted, index < 30);
    }

    assertEquals(await globalCount(db), 30);
  } finally {
    await db.close();
  }
});

Deno.test("the global ceiling and the named-user path keep their original behaviour", async () => {
  const db = await createDatabase();
  const anonymousUser = "00000000-0000-4000-8000-000000000392";
  const namedUser = "00000000-0000-4000-8000-000000000393";

  try {
    await createUser(db, anonymousUser);
    await createUser(db, namedUser);

    await db.query(
      `insert into anonymous_story_shape_global_limits (window_key, request_count)
       values (now()::date, 500)
       on conflict (window_key) do update set request_count = excluded.request_count`,
    );
    assertEquals(await claim(db, anonymousUser, "c".repeat(64)), false);

    // A signed-in caller passes no scope and is unaffected by the global
    // ceiling; only the six-per-minute window applies.
    for (let index = 0; index < 6; index++) {
      assertEquals(await claim(db, namedUser, null), true);
    }
    assertEquals(await claim(db, namedUser, null), false);

    await db.query(
      `update story_shape_rate_limits
       set window_started_at = now() - interval '2 minutes'
       where user_id = $1`,
      [namedUser],
    );
    assertEquals(await claim(db, namedUser, null), true);
  } finally {
    await db.close();
  }
});

Deno.test("an unparseable anonymous scope is still refused outright", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000394";

  try {
    await createUser(db, userId);
    let raised = false;
    try {
      await claim(db, userId, "not-a-hash");
    } catch {
      raised = true;
    }
    assertEquals(raised, true);
  } finally {
    await db.close();
  }
});

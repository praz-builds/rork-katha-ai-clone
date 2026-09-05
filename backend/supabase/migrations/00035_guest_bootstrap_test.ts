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

Deno.test("anonymous bootstrap limits each hashed network to three welcome grants per day", async () => {
  const db = await createDatabase();
  const scope = "a".repeat(64);

  try {
    for (let index = 0; index < 3; index++) {
      const result = await db.query<
        { claim_anonymous_bootstrap_grant: boolean }
      >(
        "select claim_anonymous_bootstrap_grant($1)",
        [scope],
      );
      assertEquals(result.rows[0].claim_anonymous_bootstrap_grant, true);
    }
    const denied = await db.query<{ claim_anonymous_bootstrap_grant: boolean }>(
      "select claim_anonymous_bootstrap_grant($1)",
      [scope],
    );
    assertEquals(denied.rows[0].claim_anonymous_bootstrap_grant, false);

    await db.query(
      `update anonymous_bootstrap_rate_limits
       set window_started_at = now() - interval '24 hours' - interval '1 second'
       where scope_hash = $1`,
      [scope],
    );
    const reset = await db.query<{ claim_anonymous_bootstrap_grant: boolean }>(
      "select claim_anonymous_bootstrap_grant($1)",
      [scope],
    );
    assertEquals(reset.rows[0].claim_anonymous_bootstrap_grant, true);
  } finally {
    await db.close();
  }
});

Deno.test("anonymous bootstrap fails closed at the shared daily grant budget", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `insert into anonymous_bootstrap_global_limits (window_key, grant_count)
       values (now()::date, 300)
       on conflict (window_key) do update set grant_count = excluded.grant_count`,
    );
    const denied = await db.query<{ claim_anonymous_bootstrap_grant: boolean }>(
      "select claim_anonymous_bootstrap_grant($1)",
      ["b".repeat(64)],
    );
    assertEquals(denied.rows[0].claim_anonymous_bootstrap_grant, false);
  } finally {
    await db.close();
  }
});

Deno.test("anonymous user bootstrap grants once without consuming replay slots", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000351";
  const scope = "e".repeat(64);
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    const first = await db.query<
      { bootstrap_anonymous_user: Record<string, unknown> }
    >(
      "select bootstrap_anonymous_user($1, $2)",
      [userId, scope],
    );
    assertEquals(first.rows[0].bootstrap_anonymous_user.welcome_granted, true);
    assertEquals(first.rows[0].bootstrap_anonymous_user.balance, 3);

    const replay = await db.query<
      { bootstrap_anonymous_user: Record<string, unknown> }
    >(
      "select bootstrap_anonymous_user($1, $2)",
      [userId, scope],
    );
    assertEquals(
      replay.rows[0].bootstrap_anonymous_user.welcome_granted,
      false,
    );
    assertEquals(replay.rows[0].bootstrap_anonymous_user.balance, 3);
    const limit = await db.query<{ grant_count: number }>(
      "select grant_count from anonymous_bootstrap_rate_limits where scope_hash = $1",
      [scope],
    );
    assertEquals(limit.rows[0].grant_count, 1);
  } finally {
    await db.close();
  }
});

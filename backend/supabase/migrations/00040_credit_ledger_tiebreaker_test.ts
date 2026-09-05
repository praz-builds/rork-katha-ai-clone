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

const BEGIN_STORY = `select begin_story_generation(
  $1, $2, 'A Title', 'romance', array['romance'], 'adult', array[]::text[],
  'sweet', 'standalone', 'a topic', 'en', 'somewhere', 'standard', 3,
  array[]::text[], array[]::text[], null, null, false, array[]::text[]
) as result`;

Deno.test("a replayed balance read is decided by ledger_sequence, not by a random uuid", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000401";

  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);

    await db.query(
      "select grant_credit($1, 10, 'purchase', 'seed', 'op:seed')",
      [
        userId,
      ],
    );
    const first = await db.query<{ result: Record<string, unknown> }>(
      BEGIN_STORY,
      [userId, "request-401"],
    );
    assertEquals(first.rows[0].result.replayed, false);
    assertEquals(first.rows[0].result.balance, 7);

    // Collapse every ledger row onto one timestamp, which is what
    // refresh_subscription_grant produces naturally by writing the lapse and
    // the grant inside a single transaction. created_at can no longer separate
    // them, so the tie-breaker is the only thing deciding which balance the
    // replay reports.
    await db.query(
      "update credit_ledger set created_at = timestamptz '2020-01-01 00:00:00Z'",
    );

    const replay = await db.query<{ result: Record<string, unknown> }>(
      BEGIN_STORY,
      [userId, "request-401"],
    );
    assertEquals(replay.rows[0].result.replayed, true);
    assertEquals(replay.rows[0].result.balance, 7);
  } finally {
    await db.close();
  }
});

Deno.test("no live function reads a credit_ledger balance without the sequence tie-breaker", async () => {
  const db = await createDatabase();
  try {
    const functions = await db.query<{ name: string; body: string }>(
      `select p.proname as name, pg_get_functiondef(p.oid) as body
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );

    // Match each statement that reads credit_ledger and then orders, so a
    // function reintroducing `id desc` on the ledger fails here rather than
    // reporting a coin-flip balance in production.
    const offenders: string[] = [];
    for (const row of functions.rows) {
      const pattern =
        /from public\.credit_ledger(?:(?!;)[\s\S])*?order by created_at desc, (\w+) desc/g;
      for (const match of row.body.matchAll(pattern)) {
        if (match[1] !== "ledger_sequence") {
          offenders.push(`${row.name}: ${match[1]}`);
        }
      }
    }

    assertEquals(offenders, []);
  } finally {
    await db.close();
  }
});

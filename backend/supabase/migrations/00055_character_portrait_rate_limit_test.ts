// `generate-character-image` spent money with nothing in front of it.
//
// No credit reservation, no idempotency key, no rate limit — and one call can
// become up to six paid provider requests (two models across three safety
// rungs). The client mints a fresh request id on every tap, so there was never
// anything for a replay to collide with either. 00055 is the bound.
//
// These test the claim function, which is the only door: the table has RLS on
// and no policy, so nothing but `service_role` through this `security definer`
// function can touch the counter.
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

const USER = "00000000-0000-4000-8000-000000000701";
const OTHER = "00000000-0000-4000-8000-000000000702";
const LIMIT = 12;

async function makeUser(db: PGlite, userId: string) {
  await db.query("insert into auth.users(id) values ($1)", [userId]);
  await db.query("insert into profiles(id, username) values ($1, $2)", [
    userId,
    `u_${userId.slice(-4)}`,
  ]);
}

async function claim(db: PGlite, userId: string): Promise<boolean> {
  const result = await db.query<{ claim_character_portrait_request: boolean }>(
    "select claim_character_portrait_request($1)",
    [userId],
  );
  return result.rows[0].claim_character_portrait_request;
}

Deno.test("a writer gets their whole hourly allowance, then is refused", async () => {
  const db = await createDatabase();
  try {
    await makeUser(db, USER);
    for (let i = 0; i < LIMIT; i += 1) {
      assertEquals(await claim(db, USER), true, `claim ${i + 1} was refused`);
    }
    // A cast is capped at 3 characters, so twelve is four reimaginings of
    // every one of them inside an hour. Past that it is a loop, not a writer.
    assertEquals(await claim(db, USER), false);
  } finally {
    await db.close();
  }
});

Deno.test("the cap is per writer, not shared", async () => {
  const db = await createDatabase();
  try {
    await makeUser(db, USER);
    await makeUser(db, OTHER);
    for (let i = 0; i < LIMIT; i += 1) await claim(db, USER);
    assertEquals(await claim(db, USER), false);
    // One person exhausting their hour must not stop anybody else working.
    assertEquals(await claim(db, OTHER), true);
  } finally {
    await db.close();
  }
});

Deno.test("the window rolls, so a refusal is a wait and not a wall", async () => {
  const db = await createDatabase();
  try {
    await makeUser(db, USER);
    for (let i = 0; i < LIMIT; i += 1) await claim(db, USER);
    assertEquals(await claim(db, USER), false);

    // Age the window by hand; there is no other way to pass an hour here.
    await db.query(
      `update character_portrait_rate_limits
       set window_started_at = now() - interval '61 minutes'
       where user_id = $1`,
      [USER],
    );
    assertEquals(await claim(db, USER), true);

    // And the new window starts at one, not at the old count.
    const row = await db.query<{ request_count: number }>(
      "select request_count from character_portrait_rate_limits where user_id = $1",
      [USER],
    );
    assertEquals(row.rows[0].request_count, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a null user is refused rather than counted", async () => {
  const db = await createDatabase();
  try {
    const result = await db.query<
      { claim_character_portrait_request: boolean }
    >("select claim_character_portrait_request(null)");
    assertEquals(result.rows[0].claim_character_portrait_request, false);
  } finally {
    await db.close();
  }
});

Deno.test("the counter is not reachable by the client roles", async () => {
  // The whole bound rests on this. A counter a client can read, update or
  // delete is not a rate limit — it is a suggestion.
  const db = await createDatabase();
  try {
    await makeUser(db, USER);
    await claim(db, USER);

    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role};`);
      for (
        const statement of [
          "select * from character_portrait_rate_limits",
          "update character_portrait_rate_limits set request_count = 0",
          "delete from character_portrait_rate_limits",
        ]
      ) {
        let code: string | null = null;
        try {
          await db.query(statement);
        } catch (error) {
          code = (error as { code?: string }).code ?? "denied";
        }
        assert(code !== null, `${role} could run: ${statement}`);
      }

      // And the function itself is service-role only, so a client cannot even
      // burn its own allowance from the outside.
      let functionDenied = false;
      try {
        await db.query("select claim_character_portrait_request($1)", [USER]);
      } catch {
        functionDenied = true;
      }
      assert(functionDenied, `${role} could call the claim function`);
    }
    await db.exec("reset role;");
  } finally {
    await db.close();
  }
});

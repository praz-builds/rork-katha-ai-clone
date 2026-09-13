// 00086: the grant is exercised as the roles that have it and the roles that
// must not.
//
// The bug this covers is invisible to every test that runs as the migration
// role, because that role owns the tables and needs no grant. So each assertion
// below does `set role` first and then reads, which is the shape a PostgREST
// request actually has.
//
// `service_role` is created `bypassrls` here, matching Supabase, for a reason
// that is the whole point of the migration's last paragraph: without bypassrls
// a granted select against a policy-less RLS table returns zero rows instead of
// an error, which would let this file pass while the live project still refused
// the read. The two locks have to be modelled separately to tell them apart.
//
// What is asserted, in the order it matters:
//
//   1. `service_role` can select the row `claim_guest_portrait_request` created
//      -- the exact call that returned `permission denied for table
//      guest_portrait_quotas`.
//   2. `service_role` can correct a count and clear a row.
//   3. `authenticated` and `anon` still cannot select, update or delete either
//      table, and cannot execute the RPCs.
//   4. Neither table gained an INSERT grant.
//   5. The claim / release contract from 00084 is unchanged by the grant.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function createDatabase() {
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
    const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

const GUEST = "00000000-0000-4000-8000-000000000861";
const OTHER_GUEST = "00000000-0000-4000-8000-000000000862";

async function seed(db: PGlite) {
  for (const id of [GUEST, OTHER_GUEST]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id) values ($1)", [id]);
  }
}

async function claim(db: PGlite, userId: string): Promise<boolean> {
  const result = await db.query<{ allowed: boolean }>(
    "select claim_guest_portrait_request($1) as allowed",
    [userId],
  );
  return result.rows[0].allowed;
}

async function denied(db: PGlite, sql: string, what: string) {
  let rejected = false;
  try {
    await db.query(sql);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true, `${what}: ${sql}`);
}

Deno.test("the service role can read the row the claim RPC created", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals(await claim(db, GUEST), true);
    assertEquals(await claim(db, GUEST), true);

    await db.exec("set role service_role");
    // This is the call that returned `permission denied for table
    // guest_portrait_quotas` before the grant: support or an abuse review
    // asking what an identity has actually spent.
    const quotas = await db.query<{ claimed_count: number }>(
      "select claimed_count from guest_portrait_quotas where user_id = $1",
      [GUEST],
    );
    assertEquals(quotas.rows.length, 1);
    assertEquals(quotas.rows[0].claimed_count, 2);

    // 00055's hourly window is NOT covered: 00063 pins it unreadable by
    // every role including service_role, and this migration does not reopen
    // that decision. A read of it under the service key must still fail.
    await denied(
      db,
      "select request_count from character_portrait_rate_limits",
      "service_role could read the hourly window",
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

Deno.test("the service role can correct a count and clear a row", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 0; i < 4; i++) await claim(db, GUEST);
    assertEquals(await claim(db, GUEST), false);

    await db.exec("set role service_role");
    // A support correction: four slots were spent on generations the provider
    // mangled, and nobody called release.
    await db.query(
      "update guest_portrait_quotas set claimed_count = 1 where user_id = $1",
      [GUEST],
    );
    await db.exec("reset role");
    assertEquals(await claim(db, GUEST), true);

    await db.exec("set role service_role");
    await db.query("delete from guest_portrait_quotas where user_id = $1", [
      GUEST,
    ]);
    const after = await db.query("select 1 from guest_portrait_quotas");
    assertEquals(after.rows.length, 0);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

Deno.test("the service role was not handed INSERT on either counter", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec("set role service_role");
    // The claim functions own the shape of a new row, `first_claimed_at`
    // included. Starting a counter by hand is not a correction.
    await assertRejects(() =>
      db.query(
        "insert into guest_portrait_quotas(user_id, claimed_count) values ($1, 1)",
        [GUEST],
      )
    );
    await assertRejects(() =>
      db.query(
        "insert into character_portrait_rate_limits(user_id) values ($1)",
        [GUEST],
      )
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

Deno.test("authenticated and anon still cannot touch either counter", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals(await claim(db, GUEST), true);

    for (const role of ["authenticated", "anon"]) {
      await db.exec(`set role ${role}`);
      for (
        const table of [
          "guest_portrait_quotas",
          "character_portrait_rate_limits",
        ]
      ) {
        // A counter a client can read tells it how many slots are left; one it
        // can write is not a cap at all.
        await denied(db, `select * from ${table}`, `${role} could select`);
        await denied(
          db,
          `update ${table} set user_id = user_id`,
          `${role} could update`,
        );
        await denied(db, `delete from ${table}`, `${role} could delete`);
      }
      await assertRejects(() =>
        db.query("select claim_guest_portrait_request($1)", [GUEST])
      );
      await assertRejects(() =>
        db.query("select release_guest_portrait_request($1)", [GUEST])
      );
      await assertRejects(() =>
        db.query("select claim_character_portrait_request($1)", [GUEST])
      );
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});

Deno.test("the claim and release contract is unchanged by the grant", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 1; i <= 4; i++) {
      assertEquals(await claim(db, GUEST), true, `claim ${i} was refused`);
    }
    assertEquals(await claim(db, GUEST), false);

    await db.query("select release_guest_portrait_request($1)", [GUEST]);
    assertEquals(await claim(db, GUEST), true);
    assertEquals(await claim(db, GUEST), false);

    // Still per identity, and still nothing a grant could have widened.
    assertEquals(await claim(db, OTHER_GUEST), true);

    await db.exec("set role service_role");
    const rows = await db.query<{ user_id: string; claimed_count: number }>(
      "select user_id, claimed_count from guest_portrait_quotas order by user_id",
    );
    assertEquals(rows.rows.length, 2);
    assertEquals(rows.rows[0].claimed_count, 4);
    assertEquals(rows.rows[1].claimed_count, 1);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

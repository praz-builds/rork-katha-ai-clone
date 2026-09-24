// 00096: three free character images per account, and what happens to an
// account that had already used more of 00088's six.
//
// Same harness as 00088's file: every migration applied in order against a
// real Postgres (PGlite), because a plpgsql body is parsed when it RUNS and a
// function that only exists proves nothing. 00088's own file covers the whole
// reserve / refund / replay contract at whatever the number is; this one pins
// the number and the carry-over, which is what 00096 changed.
//
// What is asserted:
//
//   1. A new account has three, the third is free and the fourth costs 1.
//   2. An account that spent 4-6 under the six reads 0 left, is charged for the
//      next one, and keeps its stored count -- nothing is rewritten, nothing
//      billed retroactively, no slots handed back.
//   3. An account that spent 2 under the six has exactly 1 free one left.
//   4. The superseded 00084 wrapper agrees: three, then refused.
//   5. The redefined functions are still service-role only.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
    // A migration that fails to apply throws before the caller's `finally`
    // has a handle to close, so close it here.
    await db.close();
    throw error;
  }
}

const FRESH = "00000000-0000-4000-8000-000000000961";
const HEAVY = "00000000-0000-4000-8000-000000000962";
const LIGHT = "00000000-0000-4000-8000-000000000963";
const GUEST = "00000000-0000-4000-8000-000000000964";

async function seed(db: PGlite) {
  for (const id of [FRESH, HEAVY, LIGHT, GUEST]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id) values ($1)", [id]);
  }
}

async function fund(db: PGlite, userId: string, amount: number) {
  await db.query(
    "select grant_credit($1, $2, 'purchase', $3, $4)",
    [userId, amount, `seed-${userId}`, `purchase:seed:${userId}:${amount}`],
  );
}

async function balance(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ balance_after: number }>(
    `select balance_after from credit_ledger where user_id = $1
     order by created_at desc, ledger_sequence desc limit 1`,
    [userId],
  );
  return result.rows.length ? result.rows[0].balance_after : 0;
}

type Claim = {
  operation_id: string;
  credits: number;
  free_remaining: number;
  balance: number;
};

async function claim(
  db: PGlite,
  userId: string,
  requestId: string,
): Promise<Claim> {
  const result = await db.query<{ claim: Claim }>(
    "select claim_character_image_request($1, $2, true) as claim",
    [userId, requestId],
  );
  return result.rows[0].claim;
}

async function remaining(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ remaining: number }>(
    "select character_image_free_remaining($1) as remaining",
    [userId],
  );
  return result.rows[0].remaining;
}

async function freeUsed(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ claimed_count: number }>(
    "select claimed_count from guest_portrait_quotas where user_id = $1",
    [userId],
  );
  return result.rows.length ? result.rows[0].claimed_count : 0;
}

/** A counter row exactly as 00088 would have left it in production. */
async function spentUnderSix(db: PGlite, userId: string, count: number) {
  await db.query(
    "insert into guest_portrait_quotas(user_id, claimed_count) values ($1, $2)",
    [userId, count],
  );
}

Deno.test("a new account has three, and the fourth costs a credit", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, FRESH, 2);
    assertEquals(await remaining(db, FRESH), 3);

    for (let i = 1; i <= 3; i++) {
      const free = await claim(db, FRESH, `f-${i}`);
      assertEquals(free.credits, 0, `image ${i} was charged`);
      assertEquals(free.free_remaining, 3 - i);
    }
    assertEquals(await balance(db, FRESH), 2);

    const fourth = await claim(db, FRESH, "f-4");
    assertEquals(fourth.credits, 1);
    assertEquals(fourth.free_remaining, 0);
    assertEquals(await balance(db, FRESH), 1);
    // The counter holds free slots only, so it stops at three.
    assertEquals(await freeUsed(db, FRESH), 3);
  } finally {
    await db.close();
  }
});

Deno.test("an account already past three reads none left and pays", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, HEAVY, 1);
    await spentUnderSix(db, HEAVY, 5);

    // Clamped, not negative: the client quotes from this number.
    assertEquals(await remaining(db, HEAVY), 0);

    const next = await claim(db, HEAVY, "after-00096");
    assertEquals(next.credits, 1);
    assertEquals(next.free_remaining, 0);
    assertEquals(await balance(db, HEAVY), 0);
    // The stored history is kept, not rewritten down to three.
    assertEquals(await freeUsed(db, HEAVY), 5);

    // A failed paid image refunds the credit and does not touch the counter.
    await db.query(
      "select release_character_image_request($1, $2, 'provider failed')",
      [next.operation_id, HEAVY],
    );
    assertEquals(await balance(db, HEAVY), 1);
    assertEquals(await freeUsed(db, HEAVY), 5);
    assertEquals(await remaining(db, HEAVY), 0);
  } finally {
    await db.close();
  }
});

Deno.test("an account that used two under the six has one left", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, LIGHT, 1);
    await spentUnderSix(db, LIGHT, 2);
    assertEquals(await remaining(db, LIGHT), 1);

    const last = await claim(db, LIGHT, "last-free");
    assertEquals(last.credits, 0);
    assertEquals(last.free_remaining, 0);

    const paid = await claim(db, LIGHT, "first-paid");
    assertEquals(paid.credits, 1);
    assertEquals(await balance(db, LIGHT), 0);
  } finally {
    await db.close();
  }
});

Deno.test("the superseded guest wrapper stops at three too", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 1; i <= 3; i++) {
      const result = await db.query<{ allowed: boolean }>(
        "select claim_guest_portrait_request($1) as allowed",
        [GUEST],
      );
      assertEquals(result.rows[0].allowed, true, `claim ${i} was refused`);
    }
    const fourth = await db.query<{ allowed: boolean }>(
      "select claim_guest_portrait_request($1) as allowed",
      [GUEST],
    );
    assertEquals(fourth.rows[0].allowed, false);
    assertEquals(await freeUsed(db, GUEST), 3);
  } finally {
    await db.close();
  }
});

Deno.test("the redefined functions are still service-role only", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec("set role authenticated");
    for (
      const statement of [
        "select claim_character_image_request($1, 'x', true)",
        "select character_image_free_remaining($1)",
        "select claim_guest_portrait_request($1)",
      ]
    ) {
      await assertRejects(() => db.query(statement, [FRESH]));
    }
    await db.exec("reset role");
    assertEquals(await freeUsed(db, FRESH), 0);
  } finally {
    await db.close();
  }
});

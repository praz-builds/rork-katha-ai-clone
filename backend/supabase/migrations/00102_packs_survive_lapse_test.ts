// 00102: credits bought as packs survive a subscription lapse; the plan's
// grant and earned credits do not.
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

const USER = "66666666-6666-6666-6666-666666666666";

async function grant(db: PGlite, amount: number, reason: string, key: string) {
  await db.query(
    `select public.grant_credit($1, $2, $3, $4, $4)`,
    [USER, amount, reason, key],
  );
}

async function buckets(db: PGlite) {
  const { rows } = await db.query<{ grant: number; purchased: number; earned: number }>(
    `select subscription_grant_balance::int as grant, purchased_balance::int as purchased,
            earned_balance::int as earned
       from public.credit_balance_buckets where user_id = $1`,
    [USER],
  );
  return rows[0];
}

async function lastLedger(db: PGlite) {
  const { rows } = await db.query<{ amount: number; reason: string; balance_after: number }>(
    `select amount, reason, balance_after from public.credit_ledger
      where user_id = $1 order by created_at desc, ledger_sequence desc limit 1`,
    [USER],
  );
  return rows[0];
}

async function seeded() {
  const db = await createDatabase();
  await db.exec(`
    insert into auth.users(id) values ('${USER}');
    insert into public.profiles(id) values ('${USER}');
  `);
  await grant(db, 50, "subscription", "plan");
  await grant(db, 100, "purchase", "pack");
  await grant(db, 3, "streak", "streak");
  return db;
}

Deno.test("a lapse voids the plan grant and earned credits and keeps the pack", async () => {
  const db = await seeded();
  try {
    assertEquals(await buckets(db), { grant: 50, purchased: 100, earned: 3 });

    const { rows } = await db.query<{ remaining: number }>(
      `select public.lapse_credits($1, 'revenuecat:expiration:yearly', 'rc:evt-exp') as remaining`,
      [USER],
    );
    assertEquals(rows[0].remaining, 100);
    assertEquals(await buckets(db), { grant: 0, purchased: 100, earned: 0 });

    // The ledger records only what was voided, and the balance the app reads
    // (the latest balance_after) is the pack balance, not zero.
    assertEquals(await lastLedger(db), { amount: -53, reason: "lapse", balance_after: 100 });

    const lapsed = await db.query<{ lapsed_amount: number }>(
      `select lapsed_amount from public.credit_lapse_operations where user_id = $1`,
      [USER],
    );
    assertEquals(lapsed.rows[0].lapsed_amount, 53);
  } finally {
    await db.close();
  }
});

Deno.test("a repeated lapse is a no-op and still returns the pack balance", async () => {
  const db = await seeded();
  try {
    await db.query(`select public.lapse_credits($1, 'ref', 'rc:evt-exp')`, [USER]);
    const { rows } = await db.query<{ remaining: number }>(
      `select public.lapse_credits($1, 'ref', 'rc:evt-exp') as remaining`,
      [USER],
    );
    assertEquals(rows[0].remaining, 100);
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.credit_ledger where user_id = $1 and reason = 'lapse'`,
      [USER],
    );
    assertEquals(count.rows[0].n, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a pack-only balance survives a lapse untouched, with no ledger row", async () => {
  const db = await createDatabase();
  try {
    await db.exec(`
      insert into auth.users(id) values ('${USER}');
      insert into public.profiles(id) values ('${USER}');
    `);
    await grant(db, 30, "purchase", "pack");
    const { rows } = await db.query<{ remaining: number }>(
      `select public.lapse_credits($1, 'ref', 'rc:evt-exp') as remaining`,
      [USER],
    );
    assertEquals(rows[0].remaining, 30);
    assertEquals(await buckets(db), { grant: 0, purchased: 30, earned: 0 });
    assertEquals((await lastLedger(db)).reason, "purchase");
  } finally {
    await db.close();
  }
});

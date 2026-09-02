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
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) migrations.push(entry.name);
  }
  migrations.sort();
  for (const migration of migrations) {
    await db.exec((await Deno.readTextFile(new URL(migration, import.meta.url)))
      .replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

Deno.test("subscription refresh replaces only the grant bucket", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000091";
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query("select grant_credit($1, 10, 'purchase', 'pack', 'rc:pack')", [userId]);
    await db.query("select refresh_subscription_grant($1, 20, 'month-1', 'rc:month-1')", [userId]);
    await db.query("select deduct_credit($1, 5, 'generation', 'story', 'generation:1')", [userId]);
    const refreshed = await db.query<{ refresh_subscription_grant: number }>(
      "select refresh_subscription_grant($1, 20, 'month-2', 'rc:month-2')", [userId],
    );
    assertEquals(refreshed.rows[0].refresh_subscription_grant, 30);
    const buckets = await db.query<{ subscription_grant_balance: number; purchased_balance: number; earned_balance: number }>(
      "select subscription_grant_balance, purchased_balance, earned_balance from credit_balance_buckets where user_id = $1", [userId],
    );
    assertEquals(buckets.rows[0], { subscription_grant_balance: 20, purchased_balance: 10, earned_balance: 0 });
  } finally { await db.close(); }
});

Deno.test("chargebacks clamp and record the shortfall without a negative balance", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000092";
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query("select grant_credit($1, 10, 'purchase', 'pack', 'rc:pack')", [userId]);
    const balance = await db.query<{ deduct_credit: number }>(
      "select deduct_credit($1, 40, 'chargeback', 'refund', 'rc:refund')", [userId],
    );
    assertEquals(balance.rows[0].deduct_credit, 0);
    const chargeback = await db.query<{ debited_amount: number; shortfall_amount: number }>(
      "select debited_amount, shortfall_amount from credit_chargebacks where user_id = $1", [userId],
    );
    assertEquals(chargeback.rows[0], { debited_amount: 10, shortfall_amount: 30 });
  } finally { await db.close(); }
});

Deno.test("automatic refunds restore the bucket that funded the generation", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000094";
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query("select refresh_subscription_grant($1, 20, 'month', 'rc:month')", [userId]);
    await db.query("select deduct_credit($1, 5, 'generation', 'story', 'generation:story')", [userId]);
    await db.query("select grant_credit($1, 5, 'refund', 'story', 'refund:story')", [userId]);
    const buckets = await db.query<{ subscription_grant_balance: number; purchased_balance: number; earned_balance: number }>(
      "select subscription_grant_balance, purchased_balance, earned_balance from credit_balance_buckets where user_id = $1", [userId],
    );
    assertEquals(buckets.rows[0], { subscription_grant_balance: 20, purchased_balance: 0, earned_balance: 0 });
  } finally { await db.close(); }
});

Deno.test("expiration writes one negative lapse ledger entry and is idempotent", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000093";
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query("select grant_credit($1, 10, 'purchase', 'pack', 'rc:pack')", [userId]);
    await db.query("select refresh_subscription_grant($1, 20, 'month', 'rc:month')", [userId]);
    await db.query("select lapse_credits($1, 'expired', 'rc:expired')", [userId]);
    await db.query("select lapse_credits($1, 'expired', 'rc:expired')", [userId]);
    const ledger = await db.query<{ amount: number; reason: string; balance_after: number }>(
      "select amount, reason, balance_after from credit_ledger where user_id = $1 order by created_at, ledger_sequence", [userId],
    );
    assertEquals(ledger.rows.at(-1), { amount: -30, reason: "lapse", balance_after: 0 });
    const lapses = await db.query<{ count: number }>(
      "select count(*)::integer as count from credit_lapse_operations where user_id = $1", [userId],
    );
    assertEquals(lapses.rows[0].count, 1);
  } finally { await db.close(); }
});

Deno.test("partial automatic refunds restore only the refunded allocation", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000095";
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query("select refresh_subscription_grant($1, 5, 'month', 'rc:month')", [userId]);
    await db.query("select deduct_credit($1, 5, 'generation', 'story', 'generation:story')", [userId]);
    await db.query("select grant_credit($1, 2, 'refund', 'story', 'refund:story')", [userId]);
    const buckets = await db.query<{ subscription_grant_balance: number; purchased_balance: number; earned_balance: number }>(
      "select subscription_grant_balance, purchased_balance, earned_balance from credit_balance_buckets where user_id = $1", [userId],
    );
    assertEquals(buckets.rows[0], { subscription_grant_balance: 2, purchased_balance: 0, earned_balance: 0 });
  } finally { await db.close(); }
});

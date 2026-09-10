// 00068: a superseded expiration cannot erase credits a renewal just granted.
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

const USER = "55555555-5555-5555-5555-555555555555";

async function seed(db: PGlite, credits: number) {
  await db.exec(`
    insert into auth.users(id) values ('${USER}');
    insert into public.profiles(id) values ('${USER}');
  `);
  await db.query(
    `select public.grant_credit($1, $2, 'subscription', 'seed', 'seed-key')`,
    [USER, credits],
  );
}

async function balance(db: PGlite): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `select (subscription_grant_balance + purchased_balance + earned_balance)::int as total
       from public.credit_balance_buckets where user_id = $1`,
    [USER],
  );
  return rows[0]?.total ?? 0;
}

async function recordSubscription(db: PGlite, eventId: string, at: string) {
  await db.query(
    `select public.record_revenuecat_subscription(
       $1, 'ai.katha.sub.writer.yearly', 'writer', 'writer', 'yearly', 'NORMAL',
       true, true, now() + interval '300 days', $2, $3::timestamptz)`,
    [USER, eventId, at],
  );
}

// The upgrade and the straggler: an EXPIRATION for an event the subscription
// row has already moved past must leave the balance alone. Before this, it
// zeroed every bucket -- grant, packs and earned alike -- while
// `record_revenuecat_subscription` correctly ignored the same event, so the
// user was left showing an active tier with no credits.
Deno.test("an expiration the subscription row has moved past changes nothing", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 50);
    await recordSubscription(db, "evt-renewal", "2026-09-10T10:00:00Z");
    assertEquals(await balance(db), 50);

    const { rows } = await db.query<{ lapse_credits: number }>(
      `select public.lapse_credits($1, 'revenuecat:expiration:old', 'rc:evt-stale', 'evt-stale') as lapse_credits`,
      [USER],
    );
    assertEquals(
      rows[0].lapse_credits,
      50,
      "the reported balance must be the real one",
    );
    assertEquals(
      await balance(db),
      50,
      "a superseded expiration erased the balance",
    );
  } finally {
    await db.close();
  }
});

Deno.test("the current expiration still lapses, exactly as before", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 50);
    await recordSubscription(db, "evt-expire", "2026-09-10T10:00:00Z");

    const { rows } = await db.query<{ lapse_credits: number }>(
      `select public.lapse_credits($1, 'revenuecat:expiration:current', 'rc:evt-expire', 'evt-expire') as lapse_credits`,
      [USER],
    );
    assertEquals(rows[0].lapse_credits, 0);
    assertEquals(await balance(db), 0);
  } finally {
    await db.close();
  }
});

// The guard is opt-in: omitting the argument must behave exactly as the
// three-argument function did, or every non-webhook caller changes meaning.
Deno.test("without an event id the lapse is unconditional", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 50);
    await recordSubscription(db, "evt-something-else", "2026-09-10T10:00:00Z");

    await db.query(
      `select public.lapse_credits($1, 'manual', 'manual-key')`,
      [USER],
    );
    assertEquals(await balance(db), 0);
  } finally {
    await db.close();
  }
});

// No subscription row is not a supersession. Refusing there would leave
// credits alive for an account whose subscription record never arrived.
Deno.test("an expiration with no subscription row on file still lapses", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 50);
    await db.query(
      `select public.lapse_credits($1, 'revenuecat:expiration:x', 'rc:evt-x', 'evt-x')`,
      [USER],
    );
    assertEquals(await balance(db), 0);
  } finally {
    await db.close();
  }
});

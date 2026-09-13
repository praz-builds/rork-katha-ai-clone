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

/*
 * Renamed from "story starts debit and refund three credits...". The shape
 * this test guards -- debit, replay, refund, then the same for a continuation,
 * with the ledger read back at the end -- is unchanged; only the start price
 * moved. Migration 00087 settled the long-standing disagreement between
 * `source-of-truth/CREDITS_AND_PRICING.md` §Summary, which always said ONE
 * credit bundling the cast, chapter one's words and chapter one's art, and
 * `begin_story_generation`, which deducted three. The document won.
 */
Deno.test("story starts debit and refund one credit, and continuations stay at one", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000341";

  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      "select grant_credit($1, 5, 'welcome', 'pricing-test', 'welcome:pricing-test')",
      [userId],
    );

    const started = await db.query<{
      begin_story_generation: Record<string, unknown>;
    }>(
      `select begin_story_generation(
        $1, 'story-start', 'A market encounter', 'romance',
        array['romance', 'comedy']::text[], 'adult', array[]::text[],
        'sweet', 'series', 'Two strangers meet in a market.', 'English',
        'Mumbai at monsoon dusk', 'standard', 3, array[]::text[],
        array[]::text[], null, null, false, array[]::text[]
      )`,
      [userId],
    );
    const start = started.rows[0].begin_story_generation;
    const operationId = start.operation_id as string;
    const storyId = start.story_id as string;
    assertEquals(start.balance, 4);

    const replay = await db.query<{
      begin_story_generation: Record<string, unknown>;
    }>(
      `select begin_story_generation(
        $1, 'story-start', 'A market encounter', 'romance',
        array['romance', 'comedy']::text[], 'adult', array[]::text[],
        'sweet', 'series', 'Two strangers meet in a market.', 'English',
        'Mumbai at monsoon dusk', 'standard', 3, array[]::text[],
        array[]::text[], null, null, false, array[]::text[]
      )`,
      [userId],
    );
    assertEquals(replay.rows[0].begin_story_generation.replayed, true);
    assertEquals(replay.rows[0].begin_story_generation.balance, 4);

    const storyRefund = await db.query<{
      refund_generation_operation: Record<string, unknown>;
    }>(
      "select refund_generation_operation($1, $2, 'provider failed')",
      [operationId, userId],
    );
    assertEquals(
      storyRefund.rows[0].refund_generation_operation.refunded,
      true,
    );
    assertEquals(storyRefund.rows[0].refund_generation_operation.balance, 5);

    const replayedRefund = await db.query<{
      refund_generation_operation: Record<string, unknown>;
    }>(
      "select refund_generation_operation($1, $2, 'provider failed')",
      [operationId, userId],
    );
    assertEquals(
      replayedRefund.rows[0].refund_generation_operation.refunded,
      false,
    );

    const continuation = await db.query<{
      reserve_generation_operation: Record<string, unknown>;
    }>(
      "select reserve_generation_operation($1, 'chapter-two', $2, 2, 'continuation')",
      [userId, storyId],
    );
    const continuationOperationId = continuation.rows[0]
      .reserve_generation_operation.id as string;
    assertEquals(continuation.rows[0].reserve_generation_operation.balance, 4);

    const continuationRefund = await db.query<{
      refund_generation_operation: Record<string, unknown>;
    }>(
      "select refund_generation_operation($1, $2, 'provider failed')",
      [continuationOperationId, userId],
    );
    assertEquals(
      continuationRefund.rows[0].refund_generation_operation.balance,
      5,
    );

    const ledger = await db.query<{ amount: number; reason: string }>(
      `select amount, reason from credit_ledger
       where user_id = $1 order by created_at, id`,
      [userId],
    );
    assertEquals(ledger.rows, [
      { amount: 5, reason: "welcome" },
      { amount: -1, reason: "generation" },
      { amount: 1, reason: "refund" },
      { amount: -1, reason: "generation" },
      { amount: 1, reason: "refund" },
    ]);
  } finally {
    await db.close();
  }
});

/*
 * "anonymous story shaping has network and shared daily budgets" was here.
 *
 * It asserted the two ceilings this file introduced - 30 shapes a day per
 * anonymous network scope and 500 a day across the project - and migration
 * 00046 removed both. These test files run every migration in order before
 * asserting, so this one was testing 00034's policy against 00046's function
 * and could only ever fail. The policy that replaced it is asserted in
 * `00056_story_shape_no_anonymous_ceiling_test.ts`; everything else 00034 set
 * up, including the per-user window, is still covered above and in 00039.
 */

/*
 * WHAT MOVED HERE, AND WHY THE COMPONENT UNDER TEST CHANGED.
 *
 * This asserted the two things `refund_story_media_component` has to get right
 * -- one payout per component however many times it is called, and buckets
 * restored in grant, then purchased, then earned order -- using a story's
 * `cast` and `cover`. It cannot use those any more, and the reason is the
 * point of migration 00087 rather than an accident of it: a story start is now
 * ONE credit bundling the cast, chapter one's words and chapter one's art, so
 * there is no separate component credit to give back and paying one out would
 * refund the whole story over a missing picture.
 *
 * `chapter_art` is the component that still has a credit of its own -- an
 * illustrated continuation is debited 2, one of which is the picture -- so the
 * idempotency and the bucket order are asserted against that, and the bundled
 * start's refusal is asserted directly underneath.
 */
Deno.test("missing paid media refunds are component-idempotent and preserve bucket order", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000343";
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      "select grant_credit($1, 2, 'subscription', 'sub-test', 'sub:test')",
      [userId],
    );
    await db.query(
      "select grant_credit($1, 2, 'purchase', 'pack-test', 'pack:test')",
      [userId],
    );
    const started = await db.query<{
      begin_story_generation: Record<string, unknown>;
    }>(
      `select begin_story_generation(
        $1, 'media-refund', 'A market encounter', 'romance',
        array['romance']::text[], 'adult', array[]::text[], 'sweet',
        'series', 'Two strangers meet in a market.', 'English',
        'Mumbai at monsoon dusk', 'standard', 3, array[]::text[],
        array[]::text[], null, null, true, array[]::text[]
      )`,
      [userId],
    );
    const storyOperationId = started.rows[0].begin_story_generation
      .operation_id;
    const storyId = started.rows[0].begin_story_generation.story_id;

    // The bundled start: 1 credit, taken from the grant bucket first.
    const afterStart = await db.query<{ balance: number }>(
      `select subscription_grant_balance + purchased_balance + earned_balance
         as balance
       from credit_balance_buckets where user_id = $1`,
      [userId],
    );
    assertEquals(Number(afterStart.rows[0].balance), 3);

    // A cast or a cover that never arrived refunds NOTHING against a 1-credit
    // start, because the single credit also bought the chapter the writer read
    // and kept. It returns the balance untouched rather than raising.
    const noCover = await db.query<{ refund_story_media_component: number }>(
      "select refund_story_media_component($1, $2, 'cover')",
      [storyOperationId, userId],
    );
    assertEquals(noCover.rows[0].refund_story_media_component, 3);

    // An illustrated chapter still has a picture credit of its own: 2 debited,
    // spanning the last grant credit and the first purchased one.
    const continuation = await db.query<{
      reserve_generation_operation: Record<string, unknown>;
    }>(
      `select reserve_generation_operation(
        $1, 'chapter-two-art', $2, 2, 'continuation', true)`,
      [userId, storyId],
    );
    const operationId = continuation.rows[0].reserve_generation_operation.id;

    const art = await db.query<{ refund_story_media_component: number }>(
      "select refund_story_media_component($1, $2, 'chapter_art')",
      [operationId, userId],
    );
    assertEquals(art.rows[0].refund_story_media_component, 2);
    // Called again -- one payout per component, however many times the media
    // task decides the picture is missing.
    const replay = await db.query<{ refund_story_media_component: number }>(
      "select refund_story_media_component($1, $2, 'chapter_art')",
      [operationId, userId],
    );
    assertEquals(replay.rows[0].refund_story_media_component, 2);

    const buckets = await db.query<{
      subscription_grant_balance: number;
      purchased_balance: number;
      earned_balance: number;
    }>(
      `select subscription_grant_balance, purchased_balance, earned_balance
       from credit_balance_buckets where user_id = $1`,
      [userId],
    );
    // Grant first: the refunded credit goes back where the debit took it from,
    // so a subscription credit does not quietly become a purchased one that
    // survives the next lapse.
    assertEquals(buckets.rows[0], {
      subscription_grant_balance: 1,
      purchased_balance: 1,
      earned_balance: 0,
    });
  } finally {
    await db.close();
  }
});

Deno.test("clients cannot bypass the service-owned story publication path", async () => {
  const db = await createDatabase();
  try {
    const privileges = await db.query<{
      can_insert: boolean;
      can_update: boolean;
    }>(
      `select
         has_table_privilege('authenticated', 'public.stories', 'INSERT') as can_insert,
         has_table_privilege('authenticated', 'public.stories', 'UPDATE') as can_update`,
    );
    assertEquals(privileges.rows[0], {
      can_insert: false,
      can_update: false,
    });
  } finally {
    await db.close();
  }
});

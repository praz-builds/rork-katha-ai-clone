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

Deno.test("story starts debit and refund three credits while continuations stay at one", async () => {
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
    assertEquals(start.balance, 2);

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
    assertEquals(replay.rows[0].begin_story_generation.balance, 2);

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
      { amount: -3, reason: "generation" },
      { amount: 3, reason: "refund" },
      { amount: -1, reason: "generation" },
      { amount: 1, reason: "refund" },
    ]);
  } finally {
    await db.close();
  }
});

Deno.test("anonymous story shaping has network and shared daily budgets", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000342";
  const scope = "c".repeat(64);
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    const allowed = await db.query<{ claim_story_shape_request: boolean }>(
      "select claim_story_shape_request($1, $2)",
      [userId, scope],
    );
    assertEquals(allowed.rows[0].claim_story_shape_request, true);

    await db.query(
      `update anonymous_story_shape_global_limits
       set request_count = 500 where window_key = now()::date`,
    );
    const denied = await db.query<{ claim_story_shape_request: boolean }>(
      "select claim_story_shape_request($1, $2)",
      [userId, "d".repeat(64)],
    );
    assertEquals(denied.rows[0].claim_story_shape_request, false);
  } finally {
    await db.close();
  }
});

Deno.test("missing paid media refunds are component-idempotent and preserve bucket order", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000343";
  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      "select grant_credit($1, 1, 'subscription', 'sub-test', 'sub:test')",
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
        array[]::text[], null, null, false, array[]::text[]
      )`,
      [userId],
    );
    const operationId = started.rows[0].begin_story_generation.operation_id;

    const cast = await db.query<{ refund_story_media_component: number }>(
      "select refund_story_media_component($1, $2, 'cast')",
      [operationId, userId],
    );
    assertEquals(cast.rows[0].refund_story_media_component, 1);
    const cover = await db.query<{ refund_story_media_component: number }>(
      "select refund_story_media_component($1, $2, 'cover')",
      [operationId, userId],
    );
    assertEquals(cover.rows[0].refund_story_media_component, 2);
    const replay = await db.query<{ refund_story_media_component: number }>(
      "select refund_story_media_component($1, $2, 'cast')",
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

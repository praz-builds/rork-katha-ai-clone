import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";

const migrations = [
  "00001_initial_schema.sql",
  "00002_rls_policies.sql",
  "00003_strategic_additions.sql",
  "00004_atomic_credit_rpcs.sql",
  "00005_secure_credit_operations.sql",
];

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select null::uuid $$;
    create function auth.role() returns text language sql stable
      as $$ select null::text $$;
  `);

  for (const migration of migrations) {
    await db.exec(await Deno.readTextFile(new URL(migration, import.meta.url)));
  }
  return db;
}

Deno.test("generation operations debit once and compensate failures once", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000001";
  const storyId = "00000000-0000-4000-8000-000000000002";

  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      "select grant_credit($1, 3, 'welcome', 'signup', 'welcome:signup')",
      [userId],
    );
    await db.query(
      `insert into stories(id, author_id, title, genre, length_type, status)
       values ($1, $2, 'Generating...', array['fantasy'], 'short', 'generating')`,
      [storyId, userId],
    );

    const first = await db.query<
      { reserve_generation_operation: Record<string, unknown> }
    >(
      "select reserve_generation_operation($1, 'request-1', $2, 1, 'story')",
      [userId, storyId],
    );
    const replay = await db.query<
      { reserve_generation_operation: Record<string, unknown> }
    >(
      "select reserve_generation_operation($1, 'request-1', $2, 1, 'story')",
      [userId, storyId],
    );

    assertEquals(first.rows[0].reserve_generation_operation.balance, 2);
    assertEquals(replay.rows[0].reserve_generation_operation.replayed, true);
    const operationId = first.rows[0].reserve_generation_operation.id;

    await db.query(
      "select refund_generation_operation($1, $2, 'provider failed')",
      [operationId, userId],
    );
    await db.query(
      "select refund_generation_operation($1, $2, 'provider failed')",
      [operationId, userId],
    );

    const ledger = await db.query<
      { amount: number; reason: string; balance_after: number }
    >(
      `select amount, reason, balance_after from credit_ledger
       where user_id = $1 order by created_at, id`,
      [userId],
    );
    assertEquals(
      ledger.rows.map(({ amount, reason }) => ({ amount, reason })),
      [
        { amount: 3, reason: "welcome" },
        { amount: -1, reason: "generation" },
        { amount: 1, reason: "refund" },
      ],
    );
    assertEquals(ledger.rows.at(-1)?.balance_after, 3);
  } finally {
    await db.close();
  }
});

Deno.test("feedback request replay cannot duplicate a daily reward", async () => {
  const db = await createDatabase();
  const authorId = "00000000-0000-4000-8000-000000000011";
  const readerId = "00000000-0000-4000-8000-000000000012";
  const storyId = "00000000-0000-4000-8000-000000000013";

  try {
    await db.query("insert into auth.users(id) values ($1), ($2)", [
      authorId,
      readerId,
    ]);
    await db.query("insert into profiles(id) values ($1), ($2)", [
      authorId,
      readerId,
    ]);
    await db.query(
      `insert into stories(id, author_id, title, genre, is_public, status)
       values ($1, $2, 'Published story', array['thriller'], true, 'complete')`,
      [storyId, authorId],
    );

    const first = await db.query<{ create_feedback: Record<string, unknown> }>(
      "select create_feedback($1, 'feedback-1', $2, null, 'Sharp ending.')",
      [readerId, storyId],
    );
    const replay = await db.query<{ create_feedback: Record<string, unknown> }>(
      "select create_feedback($1, 'feedback-1', $2, null, 'Sharp ending.')",
      [readerId, storyId],
    );

    assertEquals(first.rows[0].create_feedback.credit_granted, true);
    assertEquals(replay.rows[0].create_feedback.replayed, true);
    const counts = await db.query<{ comments: number; rewards: number }>(
      `select
         (select count(*)::integer from comments where user_id = $1) as comments,
         (select count(*)::integer from credit_ledger
          where user_id = $1 and reason = 'feedback') as rewards`,
      [readerId],
    );
    assertEquals(counts.rows[0], { comments: 1, rewards: 1 });
  } finally {
    await db.close();
  }
});

Deno.test("provider transaction keys cannot credit multiple accounts or reasons", async () => {
  const db = await createDatabase();
  const firstUser = "00000000-0000-4000-8000-000000000021";
  const secondUser = "00000000-0000-4000-8000-000000000022";

  try {
    await db.query("insert into auth.users(id) values ($1), ($2)", [
      firstUser,
      secondUser,
    ]);
    await db.query("insert into profiles(id) values ($1), ($2)", [
      firstUser,
      secondUser,
    ]);
    await db.query(
      "select grant_credit($1, 10, 'purchase', 'txn-1', 'adapty:txn-1')",
      [firstUser],
    );

    await assertRejects(() =>
      db.query(
        "select grant_credit($1, 10, 'subscription', 'txn-1', 'adapty:txn-1')",
        [firstUser],
      )
    );
    await assertRejects(() =>
      db.query(
        "select grant_credit($1, 10, 'purchase', 'txn-1', 'adapty:txn-1')",
        [secondUser],
      )
    );

    const rewards = await db.query<{ count: number }>(
      "select count(*)::integer as count from credit_ledger where operation_key = 'adapty:txn-1'",
    );
    assertEquals(rewards.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a completed operation wins a late refund race", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000031";
  const storyId = "00000000-0000-4000-8000-000000000032";

  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      "select grant_credit($1, 1, 'welcome', 'signup', 'welcome:signup')",
      [userId],
    );
    await db.query(
      `insert into stories(id, author_id, title, genre, length_type, status)
       values ($1, $2, 'Generating...', array['fantasy'], 'short', 'generating')`,
      [storyId, userId],
    );
    const reservation = await db.query<{
      reserve_generation_operation: Record<string, string>;
    }>(
      "select reserve_generation_operation($1, 'request-complete', $2, 1, 'story')",
      [userId, storyId],
    );
    const operationId = reservation.rows[0].reserve_generation_operation.id;
    await db.query(
      "select complete_story_generation($1, $2, $3, 'Complete', 'The end.', 2)",
      [operationId, storyId, userId],
    );

    const refund = await db.query<{
      refund_generation_operation: Record<string, unknown>;
    }>(
      "select refund_generation_operation($1, $2, 'late timeout')",
      [operationId, userId],
    );
    assertEquals(
      refund.rows[0].refund_generation_operation.status,
      "completed",
    );
    assertEquals(refund.rows[0].refund_generation_operation.refunded, false);
    assertEquals(
      typeof refund.rows[0].refund_generation_operation.result_chapter_id,
      "string",
    );

    const rewards = await db.query<{ count: number }>(
      "select count(*)::integer as count from credit_ledger where user_id = $1 and reason = 'refund'",
      [userId],
    );
    assertEquals(rewards.rows[0].count, 0);
  } finally {
    await db.close();
  }
});

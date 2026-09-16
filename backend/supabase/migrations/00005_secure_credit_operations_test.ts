import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function assertSqlState(
  operation: () => Promise<unknown>,
  code: string,
  message: string,
) {
  const error = await assertRejects(operation, Error, message) as Error & {
    code?: string;
  };
  assertEquals(error.code, code);
}

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
    // PGlite cannot model a concurrent build; parser validation covers the
    // production syntax while behavior tests use the equivalent plain index.
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
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
      `insert into stories(id, author_id, title, genre, primary_genre, length_type, status)
       values ($1, $2, 'Generating...', array['fantasy'], 'fantasy', 'short', 'generating')`,
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

    await assertRejects(
      () =>
        db.query(
          "select reserve_generation_operation($1, 'request-2', $2, 1, 'story')",
          [userId, storyId],
        ),
      Error,
      "Generation chapter already reserved",
    );

    const firstRefund = await db.query<{
      refund_generation_operation: Record<string, unknown>;
    }>(
      "select refund_generation_operation($1, $2, 'provider failed')",
      [operationId, userId],
    );
    const refundReplay = await db.query<{
      refund_generation_operation: Record<string, unknown>;
    }>(
      "select refund_generation_operation($1, $2, 'provider failed')",
      [operationId, userId],
    );
    assertEquals(
      firstRefund.rows[0].refund_generation_operation.refunded,
      true,
    );
    assertEquals(
      refundReplay.rows[0].refund_generation_operation.refunded,
      false,
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

// Migration 00089 retired the daily feedback faucet: `create_feedback` still
// writes the comment and still dedupes a replayed `request_id`, but it grants
// nothing. A credit for a comment is now claimed afterwards through
// `claim_comment_credit`, which is where the 40-character floor, the
// own-story exclusion, the qualifying read and the per-story/day/month caps
// live. What this test guards is the replay contract, which is unchanged.
Deno.test("feedback request replay writes one comment and no reward", async () => {
  const db = await createDatabase();
  const authorId = "00000000-0000-4000-8000-000000000011";
  const readerId = "00000000-0000-4000-8000-000000000012";
  const storyId = "00000000-0000-4000-8000-000000000013";
  const otherStoryId = "00000000-0000-4000-8000-000000000014";

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
      `insert into stories(id, author_id, title, genre, primary_genre, is_public, status)
       values
         ($1, $3, 'Published story', array['thriller'], 'thriller', true, 'complete'),
         ($2, $3, 'Other story', array['fantasy'], 'fantasy', true, 'complete')`,
      [storyId, otherStoryId, authorId],
    );

    const first = await db.query<{ create_feedback: Record<string, unknown> }>(
      "select create_feedback($1, 'feedback-1', $2, null, 'Sharp ending.')",
      [readerId, storyId],
    );
    const replay = await db.query<{ create_feedback: Record<string, unknown> }>(
      "select create_feedback($1, 'feedback-1', $2, null, 'Sharp ending.')",
      [readerId, storyId],
    );

    assertEquals(first.rows[0].create_feedback.credit_granted, false);
    assertEquals(replay.rows[0].create_feedback.replayed, true);
    await assertSqlState(
      () =>
        db.query(
          "select create_feedback($1, 'feedback-1', $2, null, 'Wrong replay.')",
          [readerId, otherStoryId],
        ),
      "KTH05",
      "Feedback request belongs to another story",
    );
    const counts = await db.query<{ comments: number; rewards: number }>(
      `select
         (select count(*)::integer from comments where user_id = $1) as comments,
         (select count(*)::integer from credit_ledger
          where user_id = $1 and reason = 'feedback') as rewards`,
      [readerId],
    );
    // One comment, and no ledger row at all: the faucet is retired, so a
    // replay cannot duplicate a reward that is never granted in the first
    // place.
    assertEquals(counts.rows[0], { comments: 1, rewards: 0 });
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
      "select grant_credit($1, 10, 'purchase', 'txn-1', 'rc:txn-1')",
      [firstUser],
    );

    await assertRejects(
      () =>
        db.query(
          "select grant_credit($1, 10, 'subscription', 'txn-1', 'rc:txn-1')",
          [firstUser],
        ),
      Error,
      "Idempotency key reused with different credit data",
    );
    await assertRejects(
      () =>
        db.query(
          "select grant_credit($1, 10, 'purchase', 'txn-1', 'rc:txn-1')",
          [secondUser],
        ),
      Error,
      'duplicate key value violates unique constraint "idx_credit_ledger_external_operation_key"',
    );

    const rewards = await db.query<{ count: number }>(
      "select count(*)::integer as count from credit_ledger where operation_key = 'rc:txn-1'",
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
  const readerId = "00000000-0000-4000-8000-000000000033";

  try {
    await db.query("insert into auth.users(id) values ($1), ($2)", [
      userId,
      readerId,
    ]);
    await db.query("insert into profiles(id) values ($1), ($2)", [
      userId,
      readerId,
    ]);
    await db.query(
      "select grant_credit($1, 1, 'welcome', 'signup', 'welcome:signup')",
      [userId],
    );
    await db.query(
      `insert into stories(id, author_id, title, genre, primary_genre, length_type, status)
       values ($1, $2, 'Generating...', array['fantasy'], 'fantasy', 'short', 'generating')`,
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
    const draftChapter = await db.query<{ id: string; is_published: boolean }>(
      "select id, is_published from chapters where story_id = $1",
      [storyId],
    );
    assertEquals(draftChapter.rows[0].is_published, false);

    await db.query("update stories set is_public = true where id = $1", [
      storyId,
    ]);
    await db.exec("grant select on stories, chapters to authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      readerId,
    ]);
    await db.exec("set role authenticated");
    const hiddenDraft = await db.query<{ id: string }>(
      "select id from chapters where id = $1",
      [draftChapter.rows[0].id],
    );
    await db.exec("reset role");
    assertEquals(hiddenDraft.rows, []);

    await db.query(
      "update chapters set is_published = true, published_at = now() where id = $1",
      [draftChapter.rows[0].id],
    );
    await db.exec("set role authenticated");
    const visible = await db.query<{ id: string }>(
      "select id from chapters where id = $1",
      [draftChapter.rows[0].id],
    );
    await db.exec("reset role");
    assertEquals(visible.rows, [{ id: draftChapter.rows[0].id }]);

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

Deno.test("application errors expose stable SQLSTATE contracts", async () => {
  const db = await createDatabase();
  const readerId = "00000000-0000-4000-8000-000000000041";
  const authorId = "00000000-0000-4000-8000-000000000042";
  const storyId = "00000000-0000-4000-8000-000000000043";
  const missingId = "00000000-0000-4000-8000-000000000044";

  try {
    await db.query("insert into auth.users(id) values ($1), ($2)", [
      readerId,
      authorId,
    ]);
    await db.query("insert into profiles(id) values ($1), ($2)", [
      readerId,
      authorId,
    ]);

    await assertSqlState(
      () =>
        db.query(
          "select deduct_credit($1, 1, 'generation', 'story', 'generation:missing')",
          [readerId],
        ),
      "KTH02",
      "Insufficient credits",
    );
    await assertSqlState(
      () =>
        db.query(
          "select create_feedback($1, 'missing-story', $2, null, 'Feedback')",
          [readerId, missingId],
        ),
      "KTH03",
      "Story not found",
    );

    await db.query(
      `insert into stories(id, author_id, title, genre, primary_genre, is_public, status)
       values ($1, $2, 'Published', array['mystery'], 'mystery', true, 'complete')`,
      [storyId, authorId],
    );
    await assertSqlState(
      () =>
        db.query(
          "select create_feedback($1, 'missing-chapter', $2, $3, 'Feedback')",
          [readerId, storyId, missingId],
        ),
      "KTH04",
      "Chapter not found",
    );

    await db.query(
      `insert into stories(id, author_id, title, genre, primary_genre, is_public, status)
       values ($1, null, 'Community story', array['drama'], 'contemporary', true, 'complete')`,
      [missingId],
    );
    const ownerlessFeedback = await db.query<{
      create_feedback: Record<string, unknown>;
    }>(
      "select create_feedback($1, 'ownerless-story', $2, null, 'Feedback')",
      [readerId, missingId],
    );
    // A story with no author is still commentable, and since 00089 retired the
    // faucet no comment grants a credit. What matters here is that the
    // ownerless row does not raise: this test is about SQLSTATE contracts.
    assertEquals(
      ownerlessFeedback.rows[0].create_feedback.credit_granted,
      false,
    );
  } finally {
    await db.close();
  }
});

Deno.test("bucket migration seeds from the newest legacy balance", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000051";

  try {
    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into profiles(id) values ($1)", [userId]);
    await db.query(
      `insert into credit_ledger(
         id, user_id, amount, reason, reference_id, balance_after, created_at
       ) values
         ('00000000-0000-4000-8000-000000000052', $1, 9, 'purchase', 'legacy', 9, '2026-01-01'),
         ('00000000-0000-4000-8000-000000000053', $1, 10, 'purchase', 'legacy', 10, '2026-01-01')`,
      [userId],
    );

    const result = await db.query<{ grant_credit: number }>(
      "select grant_credit($1, 10, 'purchase', 'legacy', 'rc:legacy')",
      [userId],
    );
    assertEquals(result.rows[0].grant_credit, 20);
  } finally {
    await db.close();
  }
});

Deno.test("public grants exclude profile purpose and story status", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000061";

  try {
    const privileges = await db.query<{
      safe_profile: boolean;
      sensitive_profile: boolean;
      story_status: boolean;
    }>(
      `select
         has_column_privilege('authenticated', 'public.profiles', 'username', 'select') as safe_profile,
         has_column_privilege('authenticated', 'public.profiles', 'onboarding_purpose', 'select') as sensitive_profile,
         has_column_privilege('authenticated', 'public.stories', 'status', 'update') as story_status`,
    );
    assertEquals(privileges.rows[0], {
      safe_profile: true,
      sensitive_profile: false,
      story_status: false,
    });

    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query(
      `insert into profiles(id, username, onboarding_purpose)
       values ($1, 'reader', 'casual')`,
      [userId],
    );
    await db.exec("set role authenticated");
    const profile = await db.query<{ username: string }>(
      "select username from public_profiles where id = $1",
      [userId],
    );
    await db.exec("reset role");
    assertEquals(profile.rows, [{ username: "reader" }]);

    const index = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from pg_indexes
       where schemaname = 'public' and indexname = 'idx_stories_title_trgm'`,
    );
    assertEquals(index.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

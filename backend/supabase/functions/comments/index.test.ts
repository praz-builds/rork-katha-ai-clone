import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";
import {
  isSelfBlock,
  parseOptionalUuid,
  parseThreadPagination,
  pgErrorCode,
  validateCommentContent,
  validateReportDetails,
  validateReportReason,
  validateReportTarget,
  validateVoteValue,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Part 1: pure request-handling logic, tested directly with no database.
//
// This is the layer described in the task as extractable and directly
// testable: every input-validation decision the HTTP handler makes before a
// query is ever issued. None of this needs PGlite, PostgREST, or a live
// project.
// ---------------------------------------------------------------------------

Deno.test("validateCommentContent rejects empty and whitespace-only content", () => {
  assertEquals(validateCommentContent(""), null);
  assertEquals(validateCommentContent("   \n\t  "), null);
  assertEquals(validateCommentContent(null), null);
  assertEquals(validateCommentContent(42), null);
});

Deno.test("validateCommentContent trims and accepts real content", () => {
  assertEquals(validateCommentContent("  hello  "), "hello");
});

Deno.test("validateCommentContent rejects content over the length cap", () => {
  const tooLong = "a".repeat(5_001);
  assertEquals(validateCommentContent(tooLong), null);
  const atCap = "a".repeat(5_000);
  assertEquals(validateCommentContent(atCap), atCap);
});

Deno.test("validateVoteValue accepts only -1, 0, 1", () => {
  assertEquals(validateVoteValue(1), 1);
  assertEquals(validateVoteValue(-1), -1);
  assertEquals(validateVoteValue(0), 0);
  assertEquals(validateVoteValue(2), null);
  assertEquals(validateVoteValue("1"), null);
  assertEquals(validateVoteValue(null), null);
});

Deno.test("validateReportReason only accepts the migration's enum", () => {
  assertEquals(validateReportReason("spam"), "spam");
  assertEquals(validateReportReason("harassment"), "harassment");
  assertEquals(validateReportReason("not_a_reason"), null);
  assertEquals(validateReportReason(""), null);
});

Deno.test("validateReportDetails: optional, blank treated as absent, capped at 2000", () => {
  assertEquals(validateReportDetails(undefined), { ok: true, value: null });
  assertEquals(validateReportDetails(null), { ok: true, value: null });
  assertEquals(validateReportDetails("   "), { ok: true, value: null });
  assertEquals(validateReportDetails("  fraud  "), { ok: true, value: "fraud" });
  assertEquals(validateReportDetails("a".repeat(2000)), {
    ok: true,
    value: "a".repeat(2000),
  });
  assertEquals(validateReportDetails("a".repeat(2001)), { ok: false });
  assertEquals(validateReportDetails(123), { ok: false });
});

Deno.test("validateReportTarget requires exactly one of story_id / comment_id", () => {
  assertEquals(validateReportTarget("story-1", null), true);
  assertEquals(validateReportTarget(null, "comment-1"), true);
  assertEquals(validateReportTarget("story-1", "comment-1"), false);
  assertEquals(validateReportTarget(null, null), false);
});

Deno.test("isSelfBlock", () => {
  assertEquals(isSelfBlock("u1", "u1"), true);
  assertEquals(isSelfBlock("u1", "u2"), false);
});

Deno.test("parseOptionalUuid accepts absence, rejects garbage, validates format", () => {
  assertEquals(parseOptionalUuid(undefined), { ok: true, value: null });
  assertEquals(parseOptionalUuid(null), { ok: true, value: null });
  assertEquals(parseOptionalUuid("not-a-uuid"), { ok: false });
  assertEquals(
    parseOptionalUuid("6ba7b810-9dad-41d1-80b4-00c04fd430c8"),
    { ok: true, value: "6ba7b810-9dad-41d1-80b4-00c04fd430c8" },
  );
});

Deno.test("parseThreadPagination: defaults, caps, and rejects malformed input", () => {
  const base = new URL("https://example.com/comments?story_id=x");
  assertEquals(parseThreadPagination(base), { page: 1, limit: 100 });

  const withParams = new URL(
    "https://example.com/comments?story_id=x&page=3&limit=50",
  );
  assertEquals(parseThreadPagination(withParams), { page: 3, limit: 50 });

  // limit is capped at 300 even if the client asks for more.
  const overLimit = new URL(
    "https://example.com/comments?story_id=x&limit=9999",
  );
  assertEquals(parseThreadPagination(overLimit), { page: 1, limit: 300 });

  // page beyond MAX_PAGE (500) is rejected outright, not silently clamped.
  const overPage = new URL(
    "https://example.com/comments?story_id=x&page=501",
  );
  assertEquals(parseThreadPagination(overPage), null);

  const malformed = new URL(
    "https://example.com/comments?story_id=x&page=abc",
  );
  assertEquals(parseThreadPagination(malformed), null);

  const zero = new URL("https://example.com/comments?story_id=x&page=0");
  assertEquals(parseThreadPagination(zero), null);
});

Deno.test("pgErrorCode extracts a string .code, and only a string .code", () => {
  assertEquals(pgErrorCode({ code: "23505" }), "23505");
  assertEquals(pgErrorCode({ code: 23505 }), undefined);
  assertEquals(pgErrorCode(new Error("boom")), undefined);
  assertEquals(pgErrorCode(null), undefined);
  assertEquals(pgErrorCode("just a string"), undefined);
});

// ---------------------------------------------------------------------------
// Part 2: the SQL-facing behaviour the handlers above are built on, run
// against PGlite (in-memory Postgres, no network) with every migration
// applied -- the same harness `00042_threaded_comments_moderation_test.ts`
// uses. supabase-js talks to PostgREST over HTTP, which PGlite does not
// speak, so these tests issue the same statements the handlers issue
// (insert-then-catch-23505-then-update for a vote, a plain insert for a
// report, the same `not user_id in (...)` shape for blocked-author
// exclusion) directly against the database, to verify the invariants the
// handlers rely on actually hold. This is NOT a test of index.ts's HTTP
// layer (see the report for exactly what that means is uncovered).
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

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
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) {
      migrations.push(entry.name);
    }
  }
  migrations.sort();
  for (const migration of migrations) {
    const sql = await Deno.readTextFile(new URL(migration, MIGRATIONS_DIR));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`
    set request.jwt.claim.sub = '${userId}';
    set role authenticated;
  `);
}

async function asSuperuser(db: PGlite) {
  await db.exec("reset role;");
}

async function createUser(db: PGlite, id: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into profiles(id, username) values ($1, $2)", [
    id,
    `user_${id.slice(-4)}`,
  ]);
}

async function createStory(db: PGlite, id: string, authorId: string) {
  await db.query(
    `insert into stories (id, author_id, title, genre, primary_genre, is_public)
     values ($1, $2, 'Test Story', array['romance'], 'romance', true)`,
    [id, authorId],
  );
}

async function insertComment(
  db: PGlite,
  opts: {
    userId: string;
    storyId: string;
    parentId: string | null;
    content: string;
  },
) {
  await asUser(db, opts.userId);
  const result = await db.query<{ id: string; depth: number }>(
    `insert into comments (user_id, story_id, parent_id, content)
     values ($1, $2, $3, $4)
     returning id, depth`,
    [opts.userId, opts.storyId, opts.parentId, opts.content],
  );
  return result.rows[0];
}

/** Mirrors `castVote()` in index.ts: insert, catch 23505, fall back to update. */
async function castVoteViaSql(
  db: PGlite,
  userId: string,
  commentId: string,
  value: -1 | 1,
) {
  await asUser(db, userId);
  try {
    await db.query(
      "insert into comment_votes (user_id, comment_id, value) values ($1, $2, $3)",
      [userId, commentId, value],
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    await db.query(
      "update comment_votes set value = $3 where user_id = $1 and comment_id = $2",
      [userId, commentId, value],
    );
  }
}

async function readScore(db: PGlite, commentId: string): Promise<number> {
  await asSuperuser(db);
  const result = await db.query<{ score: number }>(
    "select score from comments where id = $1",
    [commentId],
  );
  return result.rows[0].score;
}

const AUTHOR = "00000000-0000-4000-8000-000000000501";
const PARENT_AUTHOR = "00000000-0000-4000-8000-000000000502";
const REPLIER = "00000000-0000-4000-8000-000000000503";
const VOTER = "00000000-0000-4000-8000-000000000504";
const REPORTER = "00000000-0000-4000-8000-000000000505";
const READER = "00000000-0000-4000-8000-000000000506";
const BLOCKED_AUTHOR = "00000000-0000-4000-8000-000000000507";
const STORY = "00000000-0000-4000-8000-000000000500";

Deno.test("posting a reply nests under its parent (depth increments, parent_id matches)", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, PARENT_AUTHOR);
    await createUser(db, REPLIER);
    await createStory(db, STORY, PARENT_AUTHOR);

    const root = await insertComment(db, {
      userId: PARENT_AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "root comment",
    });
    assertEquals(root.depth, 0);

    const reply = await insertComment(db, {
      userId: REPLIER,
      storyId: STORY,
      parentId: root.id,
      content: "a reply",
    });
    assertEquals(reply.depth, 1);

    await asSuperuser(db);
    const stored = await db.query<{ parent_id: string; depth: number }>(
      "select parent_id, depth from comments where id = $1",
      [reply.id],
    );
    assertEquals(stored.rows[0].parent_id, root.id);
    assertEquals(stored.rows[0].depth, 1);
  } finally {
    await db.close();
  }
});

Deno.test("voting the same way twice does not double-count the score", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, VOTER);
    await createStory(db, STORY, AUTHOR);
    const comment = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "vote target",
    });

    await castVoteViaSql(db, VOTER, comment.id, 1);
    assertEquals(await readScore(db, comment.id), 1);

    // Same user, same value, again -- this is the insert-23505-update path,
    // not a second row and not a second +1.
    await castVoteViaSql(db, VOTER, comment.id, 1);
    assertEquals(await readScore(db, comment.id), 1);

    await asSuperuser(db);
    const rowCount = await db.query<{ count: number }>(
      "select count(*)::int as count from comment_votes where comment_id = $1",
      [comment.id],
    );
    assertEquals(rowCount.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

Deno.test("flipping a vote from up to down moves the score by exactly 2", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, VOTER);
    await createStory(db, STORY, AUTHOR);
    const comment = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "flip target",
    });

    await castVoteViaSql(db, VOTER, comment.id, 1);
    assertEquals(await readScore(db, comment.id), 1);

    await castVoteViaSql(db, VOTER, comment.id, -1);
    assertEquals(await readScore(db, comment.id), -1);
  } finally {
    await db.close();
  }
});

Deno.test("a duplicate report is caught as 23505, not a crash, and the handler's mapping treats it as a clean outcome", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, REPORTER);
    await createStory(db, STORY, AUTHOR);
    const comment = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "reported comment",
    });

    await asUser(db, REPORTER);
    await db.query(
      `insert into content_reports (reporter_id, comment_id, reason) values ($1, $2, 'spam')`,
      [REPORTER, comment.id],
    );

    let code: string | null = null;
    try {
      await db.query(
        `insert into content_reports (reporter_id, comment_id, reason) values ($1, $2, 'harassment')`,
        [REPORTER, comment.id],
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? "unknown";
    }
    // This is exactly the code handleReport() branches on to return
    // `{ reported: true, already_reported: true }` at HTTP 200 instead of
    // propagating a 500.
    assertEquals(code, "23505");
    assertEquals(pgErrorCode({ code }), "23505");
  } finally {
    await db.close();
  }
});

Deno.test("a self-block is rejected before it ever reaches the database, and the DB rejects it too", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);

    // The app-level guard `handleBlock()` uses:
    assertEquals(isSelfBlock(AUTHOR, AUTHOR), true);

    // Independently, the DB's own check constraint also rejects it if the
    // app-level guard were ever bypassed.
    await asUser(db, AUTHOR);
    let code: string | null = null;
    try {
      await db.query(
        "insert into user_blocks (blocker_id, blocked_id) values ($1, $1)",
        [AUTHOR],
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? "unknown";
    }
    assertEquals(code, "23514");
  } finally {
    await db.close();
  }
});

Deno.test("a blocked author's comments are absent from the thread read", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, BLOCKED_AUTHOR);
    await createUser(db, READER);
    await createStory(db, STORY, AUTHOR);

    const visible = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "should be visible",
    });
    const hidden = await insertComment(db, {
      userId: BLOCKED_AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "should be hidden",
    });

    await asUser(db, READER);
    await db.query(
      "insert into user_blocks (blocker_id, blocked_id) values ($1, $2)",
      [READER, BLOCKED_AUTHOR],
    );

    // Mirrors handleReadThread(): fetch the caller's own blocks, then
    // exclude those authors with the same `not (...) in (...)` shape used
    // in index.ts (and already used by feed/index.ts for curated IDs).
    const blocks = await db.query<{ blocked_id: string }>(
      "select blocked_id from user_blocks where blocker_id = $1",
      [READER],
    );
    const blockedIds = blocks.rows.map((r) => r.blocked_id);
    assertEquals(blockedIds, [BLOCKED_AUTHOR]);

    const rows = await db.query<{ id: string }>(
      `select id from comments
       where story_id = $1 and user_id not in (${blockedIds.map((_, i) => `$${i + 2}`).join(",")})
       order by created_at asc`,
      [STORY, ...blockedIds],
    );
    const visibleIds = rows.rows.map((r) => r.id);
    assertEquals(visibleIds.includes(visible.id), true);
    assertEquals(visibleIds.includes(hidden.id), false);
  } finally {
    await db.close();
  }
});

Deno.test("an unblock after a block succeeds and is idempotent (a block is never a trap)", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, READER);
    await createUser(db, BLOCKED_AUTHOR);

    await asUser(db, READER);
    await db.query(
      "insert into user_blocks (blocker_id, blocked_id) values ($1, $2)",
      [READER, BLOCKED_AUTHOR],
    );

    // Mirrors handleUnblock(): unconditional delete, no existence check.
    const first = await db.query(
      "delete from user_blocks where blocker_id = $1 and blocked_id = $2",
      [READER, BLOCKED_AUTHOR],
    );
    assertEquals(first.affectedRows, 1);

    // Unblocking again (already gone) must not error.
    const second = await db.query(
      "delete from user_blocks where blocker_id = $1 and blocked_id = $2",
      [READER, BLOCKED_AUTHOR],
    );
    assertEquals(second.affectedRows, 0);
  } finally {
    await db.close();
  }
});

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";
import {
  chapterNumberOf,
  isSelfBlock,
  parseOptionalUuid,
  parseThreadPagination,
  pgErrorCode,
  validateCommentContent,
  validateReportDetails,
  validateReportReason,
  validateReportTarget,
  validateStoryReportDetails,
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

/**
 * A REPORT MUST SAY WHAT HAPPENED.
 *
 * `details` was optional, and the reports that arrived were a reason enum and
 * nothing else - a bucket name a moderator cannot act on, filed in one tap by
 * whoever was most annoyed. These pin the rule at the boundary, not only in
 * the sheet that happens to enforce it in its UI today.
 */
Deno.test("validateReportDetails: required, trimmed, floored at 10 and capped at 2000", () => {
  assertEquals(validateReportDetails(undefined), {
    ok: false,
    reason: "missing",
  });
  assertEquals(validateReportDetails(null), { ok: false, reason: "missing" });
  assertEquals(validateReportDetails("   "), { ok: false, reason: "missing" });
  assertEquals(validateReportDetails(123), { ok: false, reason: "missing" });
  // A word is not a description. Ten characters is the floor under "x".
  assertEquals(validateReportDetails("fraud"), {
    ok: false,
    reason: "missing",
  });
  // Whitespace does not pad it over the floor either.
  assertEquals(validateReportDetails("  spam    "), {
    ok: false,
    reason: "missing",
  });
  assertEquals(validateReportDetails("  posted my address  "), {
    ok: true,
    value: "posted my address",
  });
  assertEquals(validateReportDetails("a".repeat(2000)), {
    ok: true,
    value: "a".repeat(2000),
  });
  assertEquals(validateReportDetails("a".repeat(2001)), {
    ok: false,
    reason: "length",
  });
});

/**
 * THE TWO TARGETS TAKE DIFFERENT REASONS (D13).
 *
 * The union of both lists is what 00089's check constraint accepts, so the
 * only place a story can be stopped from being filed as `hate_speech` -- a
 * comment reason that says nothing about a whole story -- is here.
 */
Deno.test("story reports take the story reasons and comment reports keep theirs", () => {
  for (
    const reason of [
      "copyright",
      "inappropriate_content",
      "inappropriate_cover",
      "other",
    ]
  ) {
    assertEquals(validateReportReason(reason, "story"), reason);
  }
  assertEquals(validateReportReason("hate_speech", "story"), null);
  assertEquals(validateReportReason("spam", "story"), null);

  // A comment has no cover and is not somebody else's manuscript.
  assertEquals(validateReportReason("inappropriate_cover", "comment"), null);
  assertEquals(validateReportReason("copyright", "comment"), null);
  assertEquals(validateReportReason("spam", "comment"), "spam");
  // The default target is a comment, which is what every caller before D13
  // meant by it.
  assertEquals(validateReportReason("spam"), "spam");
});

/**
 * A STORY REPORT'S NOTE IS OPTIONAL, AND BOUNDED.
 *
 * The comment rule is the opposite and stays that way; see
 * `validateReportDetails` above. Blank becomes null rather than an empty
 * string so the column reads as "nothing was said" instead of "something was
 * said and it was empty".
 */
Deno.test("validateStoryReportDetails: optional, trimmed, capped at 1000", () => {
  assertEquals(validateStoryReportDetails(undefined), {
    ok: true,
    value: null,
  });
  assertEquals(validateStoryReportDetails(null), { ok: true, value: null });
  assertEquals(validateStoryReportDetails("   "), { ok: true, value: null });
  assertEquals(validateStoryReportDetails(123), { ok: true, value: null });
  // No ten-character floor: a story reason stands on its own.
  assertEquals(validateStoryReportDetails("  cover  "), {
    ok: true,
    value: "cover",
  });
  assertEquals(validateStoryReportDetails("a".repeat(1000)), {
    ok: true,
    value: "a".repeat(1000),
  });
  assertEquals(validateStoryReportDetails("a".repeat(1001)), {
    ok: false,
    reason: "length",
  });
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
// applied -- the same harness `00043_threaded_comments_moderation_test.ts`
// uses. supabase-js talks to PostgREST over HTTP, which PGlite does not
// speak, so these tests issue the same SQL boundary the handlers rely on
// (the vote RPC, a plain insert for a report, the same `not user_id in (...)`
// shape for blocked-author exclusion) directly against the database, to
// verify the invariants the handlers rely on actually hold. This is NOT a
// test of index.ts's HTTP layer (see the report for exactly what that means
// is uncovered).
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

async function castVoteViaSql(
  db: PGlite,
  userId: string,
  commentId: string,
  value: -1 | 0 | 1,
) {
  await asUser(db, userId);
  await db.query("select set_comment_vote($1, $2)", [commentId, value]);
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

    // Same user, same value, again -- this is a no-op update inside the RPC,
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

Deno.test("clearing a vote removes the row and restores the score", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, VOTER);
    await createStory(db, STORY, AUTHOR);
    const comment = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "clear target",
    });

    await castVoteViaSql(db, VOTER, comment.id, -1);
    assertEquals(await readScore(db, comment.id), -1);

    await castVoteViaSql(db, VOTER, comment.id, 0);
    assertEquals(await readScore(db, comment.id), 0);

    await asSuperuser(db);
    const rowCount = await db.query<{ count: number }>(
      "select count(*)::int as count from comment_votes where comment_id = $1",
      [comment.id],
    );
    assertEquals(rowCount.rows[0].count, 0);
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
       where story_id = $1 and user_id not in (${
        blockedIds.map((_, i) => `$${i + 2}`).join(",")
      })
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

// ---------------------------------------------------------------------------
// The chapter tag a comment carries
//
// A reader scanning a long thread sees which chapter each comment is about.
// The number rides an embedded PostgREST relationship, which is why this is
// read defensively rather than trusted to arrive in one shape: a comment left
// on the story as a whole, and every comment written before the join existed,
// must come back as null so the client renders no tag at all rather than a
// wrong one.
// ---------------------------------------------------------------------------

Deno.test("a comment on a chapter reports that chapter's number", () => {
  assertEquals(chapterNumberOf({ chapters: { chapter_number: 3 } }), 3);
});

Deno.test("an embedded relationship returned as an array is still read", () => {
  assertEquals(chapterNumberOf({ chapters: [{ chapter_number: 12 }] }), 12);
});

Deno.test("a comment left on the story, not a chapter, has no tag", () => {
  assertEquals(chapterNumberOf({ chapters: null }), null);
  assertEquals(chapterNumberOf({}), null);
  assertEquals(chapterNumberOf({ chapters: [] }), null);
});

Deno.test("chapter one is a number, not a falsy value to be dropped", () => {
  // `0` and `1` both survive: an `if (n)` guard here would silently discard
  // a real chapter number, and chapter numbering starts at 1.
  assertEquals(chapterNumberOf({ chapters: { chapter_number: 1 } }), 1);
  assertEquals(chapterNumberOf({ chapters: { chapter_number: 0 } }), 0);
});

Deno.test("a non-numeric chapter number is refused rather than passed on", () => {
  assertEquals(chapterNumberOf({ chapters: { chapter_number: "4" } }), null);
  assertEquals(chapterNumberOf({ chapters: "nonsense" }), null);
});

// ---------------------------------------------------------------------------
// Every reader sees every reader's comments
//
// Founder report (2026-09-24): the chapter-end comments looked like they only
// ever showed the viewer's own. Traced end to end, nothing on the read path
// narrows by viewer: `handleReadThread` filters by `story_id` and the viewer's
// own block list, and the SELECT policy admits any authenticated caller on a
// public or curated story. This pins that down against the real policies, on
// the case production actually has -- a Katha Original (curated, not public)
// with comments attached to a published chapter -- read by somebody who has
// never commented at all.
// ---------------------------------------------------------------------------

Deno.test("every reader sees every reader's comments on a curated story, their own or not", async () => {
  const db = await createDatabase();
  const HOUSE = "00000000-0000-4000-8000-000000000511";
  const FIRST = "00000000-0000-4000-8000-000000000512";
  const SECOND = "00000000-0000-4000-8000-000000000513";
  const LURKER = "00000000-0000-4000-8000-000000000514";
  const ORIGINAL = "00000000-0000-4000-8000-000000000510";
  const CHAPTER_ONE = "00000000-0000-4000-8000-000000000519";
  try {
    for (const id of [HOUSE, FIRST, SECOND, LURKER]) await createUser(db, id);
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, is_public, is_curated)
       values ($1, $2, 'An Original', array['mystery'], 'mystery', false, true)`,
      [ORIGINAL, HOUSE],
    );
    await db.query(
      `insert into chapters (id, story_id, chapter_number, content, is_published)
       values ($1, $2, 1, 'Chapter one.', true)`,
      [CHAPTER_ONE, ORIGINAL],
    );

    for (const [userId, content] of [[FIRST, "first"], [SECOND, "second"]]) {
      await asUser(db, userId);
      await db.query(
        `insert into comments (user_id, story_id, chapter_id, content)
         values ($1, $2, $3, $4)`,
        [userId, ORIGINAL, CHAPTER_ONE, content],
      );
      await asSuperuser(db);
    }

    // The same read `handleReadThread` makes (story filter, profile and
    // chapter embeds), run as each viewer in turn under RLS.
    for (const viewer of [FIRST, SECOND, LURKER, HOUSE]) {
      await asUser(db, viewer);
      const rows = await db.query<
        { content: string; username: string; chapter_number: number }
      >(
        `select c.content, p.username, ch.chapter_number
           from comments c
           left join profiles p on p.id = c.user_id
           left join chapters ch on ch.id = c.chapter_id
          where c.story_id = $1
          order by c.content asc`,
        [ORIGINAL],
      );
      assertEquals(
        rows.rows.map((row) => [row.content, row.username, row.chapter_number]),
        [["first", "user_0512", 1], ["second", "user_0513", 1]],
        `viewer ${viewer} should see both readers' comments`,
      );
      await asSuperuser(db);
    }
  } finally {
    await db.close();
  }
});

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

/** Switch the connection to `authenticated`, acting as the given user. */
async function asUser(db: PGlite, userId: string) {
  await db.exec(`
    set request.jwt.claim.sub = '${userId}';
    set role authenticated;
  `);
}

/** Drop back to the (superuser, RLS-bypassing) seeding role. */
async function asSuperuser(db: PGlite) {
  await db.exec("reset role;");
}

/** Run a statement as whoever `db` is currently acting as; report the error code, or null on success. */
async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
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

/** Insert a comment as `userId` (subject to RLS/grants), returning its id. */
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
  const result = await db.query<{ id: string }>(
    `insert into comments (user_id, story_id, parent_id, content)
     values ($1, $2, $3, $4)
     returning id`,
    [opts.userId, opts.storyId, opts.parentId, opts.content],
  );
  return result.rows[0].id;
}

const AUTHOR = "00000000-0000-4000-8000-000000000421";
const VOTER_ONE = "00000000-0000-4000-8000-000000000422";
const VOTER_TWO = "00000000-0000-4000-8000-000000000423";
const REPORTER = "00000000-0000-4000-8000-000000000424";
const BLOCKER = "00000000-0000-4000-8000-000000000425";
const BLOCKED = "00000000-0000-4000-8000-000000000426";
const STORY = "00000000-0000-4000-8000-000000000420";

async function seedStoryAndComment(db: PGlite) {
  for (const id of [AUTHOR, VOTER_ONE, VOTER_TWO, REPORTER, BLOCKER, BLOCKED]) {
    await createUser(db, id);
  }
  await createStory(db, STORY, AUTHOR);
  const commentId = await insertComment(db, {
    userId: AUTHOR,
    storyId: STORY,
    parentId: null,
    content: "root comment",
  });
  await asSuperuser(db);
  return commentId;
}

Deno.test("a user cannot vote on the same comment twice - the primary key rejects the second row", async () => {
  const db = await createDatabase();
  try {
    const commentId = await seedStoryAndComment(db);

    await asUser(db, VOTER_ONE);
    assertEquals(
      await attempt(
        db,
        `insert into comment_votes (user_id, comment_id, value)
         values ('${VOTER_ONE}', '${commentId}', 1)`,
      ),
      null,
    );

    // Second vote from the same user on the same comment: rejected by the
    // (user_id, comment_id) primary key, not by application logic.
    assertEquals(
      await attempt(
        db,
        `insert into comment_votes (user_id, comment_id, value)
         values ('${VOTER_ONE}', '${commentId}', -1)`,
      ),
      "23505",
    );
  } finally {
    await db.close();
  }
});

Deno.test("a user cannot block themselves, and cannot block the same person twice", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, BLOCKER);
    await createUser(db, BLOCKED);

    await asUser(db, BLOCKER);

    // The check constraint rejects blocker_id = blocked_id outright.
    assertEquals(
      await attempt(
        db,
        `insert into user_blocks (blocker_id, blocked_id) values ('${BLOCKER}', '${BLOCKER}')`,
      ),
      "23514",
    );

    assertEquals(
      await attempt(
        db,
        `insert into user_blocks (blocker_id, blocked_id) values ('${BLOCKER}', '${BLOCKED}')`,
      ),
      null,
    );

    // The primary key rejects a duplicate block of the same person.
    assertEquals(
      await attempt(
        db,
        `insert into user_blocks (blocker_id, blocked_id) values ('${BLOCKER}', '${BLOCKED}')`,
      ),
      "23505",
    );
  } finally {
    await db.close();
  }
});

Deno.test("a user cannot report the same comment twice", async () => {
  const db = await createDatabase();
  try {
    const commentId = await seedStoryAndComment(db);

    await asUser(db, REPORTER);
    assertEquals(
      await attempt(
        db,
        `insert into content_reports (reporter_id, comment_id, reason)
         values ('${REPORTER}', '${commentId}', 'spam')`,
      ),
      null,
    );

    // Same reporter, same comment, a different reason: still rejected. The
    // uniqueness guard is on (reporter, target), not (reporter, target, reason).
    assertEquals(
      await attempt(
        db,
        `insert into content_reports (reporter_id, comment_id, reason)
         values ('${REPORTER}', '${commentId}', 'harassment')`,
      ),
      "23505",
    );

    // The reporter cannot read their own report back: insert-only, per the
    // migration's RLS design. There is no SELECT grant at all for
    // `authenticated` on this table (on top of there being no SELECT
    // policy), so the attempt fails at the privilege check before RLS is
    // even evaluated.
    assertEquals(
      await attempt(db, "select * from content_reports"),
      "42501",
    );
  } finally {
    await db.close();
  }
});

Deno.test("a reporter cannot set the moderation status directly on insert", async () => {
  const db = await createDatabase();
  try {
    const commentId = await seedStoryAndComment(db);

    await asUser(db, REPORTER);
    // The INSERT grant is column-scoped and does not include `status`, so
    // trying to set it (even to a value that happens to match the default)
    // is a privilege error, not a silently-accepted no-op.
    assertEquals(
      await attempt(
        db,
        `insert into content_reports (reporter_id, comment_id, reason, status)
         values ('${REPORTER}', '${commentId}', 'spam', 'dismissed')`,
      ),
      "42501",
    );

    // The unadorned insert (no status column referenced) still works and
    // lands on the 'pending' default.
    assertEquals(
      await attempt(
        db,
        `insert into content_reports (reporter_id, comment_id, reason)
         values ('${REPORTER}', '${commentId}', 'spam')`,
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("comment nesting is capped at 8 levels (depth 0-7)", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);

    let parentId: string | null = null;
    const ids: string[] = [];
    for (let level = 0; level <= 7; level++) {
      parentId = await insertComment(db, {
        userId: AUTHOR,
        storyId: STORY,
        parentId,
        content: `level ${level}`,
      });
      ids.push(parentId);
    }

    await asSuperuser(db);
    const depths = await db.query<{ depth: number }>(
      "select depth from comments where id = any($1) order by depth",
      [ids],
    );
    assertEquals(depths.rows.map((r) => r.depth), [0, 1, 2, 3, 4, 5, 6, 7]);

    // A ninth level, under the depth-7 comment, must be refused.
    let raisedCode: string | null = null;
    try {
      await insertComment(db, {
        userId: AUTHOR,
        storyId: STORY,
        parentId,
        content: "level 8 - too deep",
      });
    } catch (error) {
      raisedCode = (error as { code?: string }).code ?? "unknown";
    }
    assertEquals(raisedCode, "P0001");

    await asSuperuser(db);
    const count = await db.query<{ count: number }>(
      "select count(*)::int as count from comments where story_id = $1",
      [STORY],
    );
    assertEquals(count.rows[0].count, 8);
  } finally {
    await db.close();
  }
});

Deno.test("comments.score tracks vote inserts, value changes, and vote removal", async () => {
  const db = await createDatabase();
  try {
    const commentId = await seedStoryAndComment(db);

    const readScore = async () => {
      await asSuperuser(db);
      const result = await db.query<{ score: number }>(
        "select score from comments where id = $1",
        [commentId],
      );
      return result.rows[0].score;
    };

    assertEquals(await readScore(), 0);

    await asUser(db, VOTER_ONE);
    await db.query(
      "insert into comment_votes (user_id, comment_id, value) values ($1, $2, 1)",
      [VOTER_ONE, commentId],
    );
    assertEquals(await readScore(), 1);

    await asUser(db, VOTER_TWO);
    await db.query(
      "insert into comment_votes (user_id, comment_id, value) values ($1, $2, 1)",
      [VOTER_TWO, commentId],
    );
    assertEquals(await readScore(), 2);

    // Voter one flips their upvote to a downvote: net change of -2.
    await asUser(db, VOTER_ONE);
    await db.query(
      "update comment_votes set value = -1 where user_id = $1 and comment_id = $2",
      [VOTER_ONE, commentId],
    );
    assertEquals(await readScore(), 0);

    // Voter two removes their upvote entirely: net change of -1.
    await asUser(db, VOTER_TWO);
    await db.query(
      "delete from comment_votes where user_id = $1 and comment_id = $2",
      [VOTER_TWO, commentId],
    );
    assertEquals(await readScore(), -1);
  } finally {
    await db.close();
  }
});

Deno.test("soft-deleting a comment scrubs its content but never hides the row, even for a leaf with no replies", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);

    const parentId = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "will be deleted but has a reply",
    });
    const childId = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId,
      content: "child reply",
    });
    const leafId = await insertComment(db, {
      userId: AUTHOR,
      storyId: STORY,
      parentId: null,
      content: "will be deleted with no replies",
    });

    await asUser(db, AUTHOR);

    // This is the case decision 1 calls out by name: a leaf comment with no
    // replies must still be soft-deletable by its own author. A SELECT
    // policy that hid rows on `deleted_at` made exactly this UPDATE fail
    // with "new row violates row-level security policy" - it does not fail
    // here, because visibility never depended on `deleted_at`.
    await db.query(
      "update comments set deleted_at = now() where id = $1",
      [parentId],
    );
    await db.query(
      "update comments set deleted_at = now() where id = $1",
      [leafId],
    );

    // Content is scrubbed server-side regardless of what the client sent.
    const rows = await db.query<{ id: string; content: string }>(
      "select id, content from comments order by created_at",
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.content]));
    assertEquals(byId[parentId], "[deleted]");
    assertEquals(byId[leafId], "[deleted]");
    assertEquals(byId[childId], "child reply");

    // All three rows remain readable - a tombstone is a placeholder, not a
    // hole in the thread.
    const visibleIds = rows.rows.map((r) => r.id);
    assertEquals(visibleIds.includes(parentId), true);
    assertEquals(visibleIds.includes(childId), true);
    assertEquals(visibleIds.includes(leafId), true);
  } finally {
    await db.close();
  }
});

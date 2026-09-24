// 00097: the open report queue, read against real SQL.
//
// Same harness as every migration test: all migrations applied in order to a
// real Postgres (PGlite). What is asserted:
//
//   1. The view lists only unresolved reports (pending, reviewed), newest
//      first, and a closed one (actioned, dismissed) is not in it.
//   2. Each row carries the context a moderator needs: the story's title for a
//      story report, the comment's text and its story for a comment report,
//      the person reported, the reporter, and how many open reports share the
//      same target.
//   3. service_role can read it -- the grant on `content_reports` is what
//      makes that true, since 00043's table was never granted to it.
//   4. A reporter (authenticated) and a guest (anon) cannot read it: the
//      queue is not a way around the table's insert-only rule.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function createDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
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
  } catch (error) {
    await db.close();
    throw error;
  }
}

const READER = "00000000-0000-4000-8000-000000000971";
const SECOND_READER = "00000000-0000-4000-8000-000000000972";
const AUTHOR = "00000000-0000-4000-8000-000000000973";
const COMMENTER = "00000000-0000-4000-8000-000000000974";
const STORY = "00000000-0000-4000-8000-0000000009b1";
const OTHER_STORY = "00000000-0000-4000-8000-0000000009b2";

async function seed(db: PGlite): Promise<{ commentId: string }> {
  const names: [string, string][] = [
    [READER, "reader_one"],
    [SECOND_READER, "reader_two"],
    [AUTHOR, "the_author"],
    [COMMENTER, "loud_commenter"],
  ];
  for (const [id, username] of names) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query(
      "insert into profiles(id, username) values ($1, $2)",
      [id, username],
    );
  }
  for (const [id, title] of [[STORY, "The Reported Story"], [OTHER_STORY, "Another Story"]]) {
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
       values ($1, $2, $3, array['romance'], 'romance', true, 'complete')`,
      [id, AUTHOR, title],
    );
  }
  const comment = await db.query<{ id: string }>(
    `insert into comments (user_id, story_id, content)
     values ($1, $2, 'This is the comment somebody reported.') returning id`,
    [COMMENTER, OTHER_STORY],
  );
  return { commentId: comment.rows[0].id };
}

/** Insert a report directly, with a controlled time and status. */
async function report(
  db: PGlite,
  opts: {
    reporter: string;
    storyId?: string;
    commentId?: string;
    reason: string;
    details?: string;
    status?: string;
    minutesAgo: number;
  },
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into content_reports
       (reporter_id, story_id, comment_id, reason, details, status, created_at)
     values ($1, $2, $3, $4, $5, $6, now() - make_interval(mins => $7))
     returning id`,
    [
      opts.reporter,
      opts.storyId ?? null,
      opts.commentId ?? null,
      opts.reason,
      opts.details ?? null,
      opts.status ?? "pending",
      opts.minutesAgo,
    ],
  );
  return result.rows[0].id;
}

type QueueRow = {
  report_id: string;
  status: string;
  target_type: string;
  reason: string;
  reported_user_id: string;
  reported_username: string;
  story_id: string;
  story_title: string;
  comment_excerpt: string | null;
  reporter_username: string;
  open_reports_on_target: number | string;
};

async function queueAs(db: PGlite, role: string): Promise<QueueRow[]> {
  await db.exec(`set role ${role};`);
  try {
    const result = await db.query<QueueRow>(
      "select * from content_reports_open order by reported_at desc",
    );
    return result.rows;
  } finally {
    await db.exec("reset role;");
  }
}

Deno.test("the queue lists unresolved reports newest first, with their context", async () => {
  const db = await createDatabase();
  try {
    const { commentId } = await seed(db);
    const oldStory = await report(db, {
      reporter: READER,
      storyId: STORY,
      reason: "copyright",
      minutesAgo: 60,
    });
    const secondOnSameStory = await report(db, {
      reporter: SECOND_READER,
      storyId: STORY,
      reason: "inappropriate_cover",
      status: "reviewed",
      minutesAgo: 30,
    });
    const onComment = await report(db, {
      reporter: READER,
      commentId,
      reason: "harassment",
      details: "Posted my address in a reply.",
      minutesAgo: 5,
    });
    // Closed reports: never in the queue.
    await report(db, {
      reporter: SECOND_READER,
      commentId,
      reason: "spam",
      details: "Same link in every thread.",
      status: "dismissed",
      minutesAgo: 1,
    });
    await report(db, {
      reporter: READER,
      storyId: OTHER_STORY,
      reason: "other",
      status: "actioned",
      minutesAgo: 2,
    });

    const rows = await queueAs(db, "service_role");

    assertEquals(
      rows.map((row) => row.report_id),
      [onComment, secondOnSameStory, oldStory],
      "unresolved only, newest first",
    );

    const comment = rows[0];
    assertEquals(comment.target_type, "comment");
    assertEquals(comment.reported_user_id, COMMENTER);
    assertEquals(comment.reported_username, "loud_commenter");
    assertEquals(comment.story_id, OTHER_STORY);
    assertEquals(comment.story_title, "Another Story");
    assertEquals(comment.comment_excerpt, "This is the comment somebody reported.");
    assertEquals(comment.reporter_username, "reader_one");
    // The dismissed spam report on the same comment is closed, so it is not
    // counted as open.
    assertEquals(Number(comment.open_reports_on_target), 1);

    const story = rows[2];
    assertEquals(story.target_type, "story");
    assertEquals(story.reported_user_id, AUTHOR);
    assertEquals(story.reported_username, "the_author");
    assertEquals(story.story_title, "The Reported Story");
    assertEquals(story.comment_excerpt, null);
    // Two open reports against the same story: a pile-on is visible.
    assertEquals(Number(story.open_reports_on_target), 2);
    assertEquals(Number(rows[1].open_reports_on_target), 2);
  } finally {
    await db.close();
  }
});

Deno.test("a reporter and a guest cannot read the queue", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await report(db, {
      reporter: READER,
      storyId: STORY,
      reason: "copyright",
      minutesAgo: 1,
    });

    for (const role of ["authenticated", "anon"]) {
      await db.exec(
        `set request.jwt.claim.sub = '${READER}'; set role ${role};`,
      );
      try {
        await assertRejects(
          () => db.query("select * from content_reports_open"),
          Error,
          "permission denied",
        );
      } finally {
        await db.exec("reset role;");
      }
    }

    // And the service client reads the table itself now, which 00043 alone
    // never allowed.
    await db.exec("set role service_role;");
    try {
      const result = await db.query<{ n: number }>(
        "select count(*)::int as n from content_reports",
      );
      assert(result.rows[0].n >= 1);
    } finally {
      await db.exec("reset role;");
    }
  } finally {
    await db.close();
  }
});

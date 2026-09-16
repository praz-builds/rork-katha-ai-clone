// 00090: the three things a client talking straight to PostgREST could do
// that the edge function would have refused, executed against real SQL.
//
// Same lesson as every migration test since 00071: a plpgsql body is parsed
// when it RUNS, so a broken function deploys cleanly and passes a test that
// only checks it exists. Every assertion below either writes a row the
// constraint has to reject, or calls the function and reads what it returns.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function createDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
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
}

const READER = "00000000-0000-4000-8000-000000000901";
const AUTHOR = "00000000-0000-4000-8000-000000000902";
const STORY = "00000000-0000-4000-8000-0000000009a1";

async function seed(db: PGlite) {
  for (const id of [READER, AUTHOR]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query(
      "insert into profiles(id) values ($1) on conflict do nothing",
      [id],
    );
  }
  await db.query(
    `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
     values ($1, $2, 'A Story', array['romance'], 'romance', true, 'complete')`,
    [STORY, AUTHOR],
  );
}

async function insertComment(
  db: PGlite,
  userId: string,
  content: string,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into comments (user_id, story_id, content) values ($1, $2, $3)
     returning id`,
    [userId, STORY, content],
  );
  return result.rows[0].id;
}

type Claim = { ok: boolean; reason?: string; credits?: number };

async function claim(
  db: PGlite,
  userId: string,
  commentId: string,
  requestId = "req-1",
): Promise<Claim> {
  const result = await db.query<{ claim: Claim }>(
    "select claim_comment_credit($1, $2, $3) as claim",
    [userId, commentId, requestId],
  );
  return result.rows[0].claim;
}

const LONG =
  "This chapter turned the whole premise on its head and I loved it.";

// ---------------------------------------------------------------------------
// 1. A report's reason has to belong to its target
// ---------------------------------------------------------------------------
//
// The edge function has always enforced this. The table did not, and the
// table is reachable without the edge function: `content_reports` carries a
// column-scoped INSERT grant to `authenticated` and an
// `auth.uid() = reporter_id` policy, so these inserts are run AS the
// authenticated role with a JWT claim set, exactly as PostgREST would.

async function fileReport(
  db: PGlite,
  opts: {
    reporter: string;
    storyId?: string;
    commentId?: string;
    reason: string;
    details?: string;
  },
) {
  await db.exec(
    `set request.jwt.claim.sub = '${opts.reporter}'; set role authenticated;`,
  );
  try {
    await db.query(
      `insert into content_reports (reporter_id, story_id, comment_id, reason, details)
       values ($1, $2, $3, $4, $5)`,
      [
        opts.reporter,
        opts.storyId ?? null,
        opts.commentId ?? null,
        opts.reason,
        opts.details ?? null,
      ],
    );
  } finally {
    await db.exec("reset role;");
  }
}

Deno.test("a story takes the story reasons and refuses a comment's", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // Every story reason, each on its own story so the per-target unique
    // index does not do the refusing for us.
    for (
      const reason of [
        "copyright",
        "inappropriate_content",
        "inappropriate_cover",
        "other",
      ]
    ) {
      const storyId = crypto.randomUUID();
      await db.query(
        `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
         values ($1, $2, 'S', array['romance'], 'romance', true, 'complete')`,
        [storyId, AUTHOR],
      );
      await fileReport(db, { reporter: READER, storyId, reason });
    }

    for (const reason of ["hate_speech", "spam", "harassment", "violence"]) {
      const storyId = crypto.randomUUID();
      await db.query(
        `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
         values ($1, $2, 'S', array['romance'], 'romance', true, 'complete')`,
        [storyId, AUTHOR],
      );
      await assertRejects(
        () => fileReport(db, { reporter: READER, storyId, reason }),
        Error,
        "content_reports_reason_check",
      );
    }
  } finally {
    await db.close();
  }
});

Deno.test("a comment keeps its own reasons and refuses a story's", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (
      const reason of [
        "spam",
        "harassment",
        "hate_speech",
        "sexual_content",
        "violence",
        "self_harm",
        "misinformation",
        "other",
      ]
    ) {
      const commentId = await insertComment(db, AUTHOR, LONG);
      await fileReport(db, { reporter: READER, commentId, reason });
    }

    // The finding, exactly: a comment has no cover.
    for (
      const reason of [
        "inappropriate_cover",
        "copyright",
        "inappropriate_content",
      ]
    ) {
      const commentId = await insertComment(db, AUTHOR, LONG);
      await assertRejects(
        () => fileReport(db, { reporter: READER, commentId, reason }),
        Error,
        "content_reports_reason_check",
      );
    }
  } finally {
    await db.close();
  }
});

Deno.test("the details ceiling follows the target: 1000 for a story, 2000 for a comment", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    await fileReport(db, {
      reporter: READER,
      storyId: STORY,
      reason: "other",
      details: "a".repeat(1000),
    });

    const secondStory = crypto.randomUUID();
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
       values ($1, $2, 'S', array['romance'], 'romance', true, 'complete')`,
      [secondStory, AUTHOR],
    );
    await assertRejects(
      () =>
        fileReport(db, {
          reporter: READER,
          storyId: secondStory,
          reason: "other",
          details: "a".repeat(1001),
        }),
      Error,
      "content_reports_details_target_check",
    );

    // A comment report is allowed the longer note the function allows it.
    const commentId = await insertComment(db, AUTHOR, LONG);
    await fileReport(db, {
      reporter: READER,
      commentId,
      reason: "spam",
      details: "a".repeat(2000),
    });
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 2. `streak_ladder()` has the grants every other 00089 function has
// ---------------------------------------------------------------------------

Deno.test("streak_ladder is service-role only, like the rest of 00089", async () => {
  const db = await createDatabase();
  try {
    const result = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
      pub: boolean;
    }>(
      `select
         has_function_privilege('anon', 'public.streak_ladder()', 'execute') as anon,
         has_function_privilege('authenticated', 'public.streak_ladder()', 'execute') as authenticated,
         has_function_privilege('service_role', 'public.streak_ladder()', 'execute') as service_role,
         has_function_privilege('public', 'public.streak_ladder()', 'execute') as pub`,
    );
    assertEquals(result.rows[0].anon, false);
    assertEquals(result.rows[0].authenticated, false);
    assertEquals(result.rows[0].service_role, true);
    assertEquals(result.rows[0].pub, false);

    // Still returns the five rungs to a caller that may run it.
    const ladder = await db.query<{ milestone: number; credits: number }>(
      "select milestone, credits from public.streak_ladder() order by milestone",
    );
    assertEquals(ladder.rows.length, 5);
    assertEquals(ladder.rows[0], { milestone: 2, credits: 2 });
    assertEquals(ladder.rows[4], { milestone: 21, credits: 10 });
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// 3. The qualifying read needs a server-set clock, not a client's number
// ---------------------------------------------------------------------------

Deno.test("one fabricated read with a day's duration is not a qualifying read", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    // The attack, in the order it happens: POST a read claiming the column's
    // maximum, then immediately comment. `read_at` is the server's, and it is
    // the same instant as the comment.
    await db.query(
      `insert into story_reads (story_id, user_id, duration_seconds, read_at)
       values ($1, $2, 86400, now())`,
      [STORY, READER],
    );
    const commentId = await insertComment(db, READER, LONG);

    // The 120-second sum is satisfied -- 86400 clears it by a wide margin --
    // and the claim is refused anyway, because nothing server-set is 60
    // seconds older than the comment.
    const sum = await db.query<{ total: number }>(
      `select coalesce(sum(duration_seconds), 0)::int as total
       from story_reads where user_id = $1 and story_id = $2`,
      [READER, STORY],
    );
    assert(sum.rows[0].total >= 120);
    assertEquals(await claim(db, READER, commentId), {
      ok: false,
      reason: "not_read",
    });

    // A read 59 seconds before the comment is still inside the window.
    await db.query(
      `insert into story_reads (story_id, user_id, duration_seconds, read_at)
       values ($1, $2, 86400, (select created_at - interval '59 seconds' from comments where id = $3))`,
      [STORY, READER, commentId],
    );
    assertEquals(
      (await claim(db, READER, commentId, "req-2")).reason,
      "not_read",
    );
  } finally {
    await db.close();
  }
});

Deno.test("a genuine read recorded before the comment still pays", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // Ten minutes ago, two chapters, 130 seconds between them -- the shape a
    // real reader produces.
    await db.query(
      `insert into story_reads (story_id, user_id, duration_seconds, read_at)
       values ($1, $2, 70, now() - interval '10 minutes'),
              ($1, $2, 60, now() - interval '8 minutes')`,
      [STORY, READER],
    );
    const commentId = await insertComment(db, READER, LONG);
    const result = await claim(db, READER, commentId);
    assertEquals(result.ok, true);
    assertEquals(result.credits, 1);
  } finally {
    await db.close();
  }
});

Deno.test("an old read that is long enough in wall-clock but short in duration still fails", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // The other half of the gate is unchanged: the server clock alone is not
    // a read either. 30 seconds of duration, recorded an hour ago.
    await db.query(
      `insert into story_reads (story_id, user_id, duration_seconds, read_at)
       values ($1, $2, 30, now() - interval '1 hour')`,
      [STORY, READER],
    );
    const commentId = await insertComment(db, READER, LONG);
    assertEquals(await claim(db, READER, commentId), {
      ok: false,
      reason: "not_read",
    });
  } finally {
    await db.close();
  }
});

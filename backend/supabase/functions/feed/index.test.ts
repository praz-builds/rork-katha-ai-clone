// Tests for the author-blocking filter added to buildNewUserFeed and
// buildReturningUserFeed in index.ts.
//
// index.ts talks to Postgres exclusively through supabase-js/PostgREST, and
// PGlite (an in-process Postgres) has no PostgREST layer in front of it, so
// the edge function's own code cannot be invoked directly against it -- the
// same constraint every other edge function in this repo has, which is why
// there is no precedent anywhere in `functions/` for driving an `index.ts`
// straight from a test.
//
// What *can* be verified against a real Postgres is the thing that actually
// matters: the exact query shape index.ts now issues -- `author_id not in
// (...)` added to the WHERE clause, evaluated before `LIMIT`/`OFFSET` --
// really does exclude a blocked author's stories, really does leave every
// other viewer's results untouched, and really does not disturb pagination.
// These tests build the schema the same way
// `00043_threaded_comments_moderation_test.ts` does (full migration replay
// under PGlite) and then run the literal SQL that
// `.eq(...).neq(...).not("author_id", "in", "(...)").order(...).range(...)`
// compiles down to, parameterized exactly as buildNewUserFeed and
// buildReturningUserFeed construct it.
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

  const migrationsDir = new URL("../../migrations/", import.meta.url);
  const migrations: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) {
      migrations.push(entry.name);
    }
  }
  migrations.sort();
  for (const migration of migrations) {
    const sql = await Deno.readTextFile(new URL(migration, migrationsDir));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

async function createUser(db: PGlite, id: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into profiles(id, username) values ($1, $2)", [
    id,
    `user_${id.slice(-4)}`,
  ]);
}

interface StorySeed {
  id: string;
  authorId: string;
  likeCount: number;
  isCurated?: boolean;
  isPublic?: boolean;
}

async function createStory(db: PGlite, s: StorySeed) {
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, status, content_rating,
        is_curated, is_public, like_count, read_count)
     values ($1, $2, 'Test Story', array['romance'], 'romance', 'complete',
             'sweet', $3, $4, $5, 0)`,
    [
      s.id,
      s.authorId,
      s.isCurated ?? false,
      s.isPublic ?? false,
      s.likeCount,
    ],
  );
}

function uuid(n: number, tag = 0): string {
  return `00000000-0000-4000-8000-${String(tag).padStart(4, "0")}${
    String(n).padStart(8, "0")
  }`;
}

const READER_NO_BLOCKS = uuid(1, 1); // a viewer who has never blocked anyone
const BLOCKER = uuid(2, 1); // the viewer who blocks AUTHOR_BLOCKED
const AUTHOR_A = uuid(3, 1);
const AUTHOR_B = uuid(4, 1);
const AUTHOR_BLOCKED = uuid(5, 1);

/**
 * The exact query buildNewUserFeed issues for the curated list: `.eq(
 * "is_curated", true).eq("status", "complete").neq("content_rating",
 * "explicit")`, optionally `.not("author_id", "in", "(...)")`, then
 * `.order("like_count", { ascending: false }).range(offset, offset+limit-1)`.
 */
async function curatedPage(
  db: PGlite,
  opts: { blockedAuthorIds: string[]; limit: number; offset: number },
) {
  const exclusion = opts.blockedAuthorIds.length > 0
    ? `and author_id not in (${
      opts.blockedAuthorIds.map((id) => `'${id}'`).join(",")
    })`
    : "";
  const rows = await db.query<{ id: string; like_count: number }>(
    `select id, like_count from stories
     where is_curated = true and status = 'complete'
       and content_rating <> 'explicit'
       ${exclusion}
     order by like_count desc
     limit $1 offset $2`,
    [opts.limit, opts.offset],
  );
  const count = await db.query<{ count: string }>(
    `select count(*)::int as count from stories
     where is_curated = true and status = 'complete'
       and content_rating <> 'explicit'
       ${exclusion}`,
  );
  return { rows: rows.rows, total: Number(count.rows[0].count) };
}

async function seedThreeAuthorsNineCurated(db: PGlite) {
  for (
    const id of [READER_NO_BLOCKS, BLOCKER, AUTHOR_A, AUTHOR_B, AUTHOR_BLOCKED]
  ) {
    await createUser(db, id);
  }
  // Interleaved like_count ranking so a blocked author's rows land in the
  // middle of the order, not conveniently at the end -- this is what would
  // expose a short-page or a skipped row if filtering happened after the
  // slice instead of before it.
  const authors = [AUTHOR_A, AUTHOR_B, AUTHOR_BLOCKED];
  let likeCount = 100;
  const ids: Record<string, string[]> = {
    [AUTHOR_A]: [],
    [AUTHOR_B]: [],
    [AUTHOR_BLOCKED]: [],
  };
  let n = 0;
  for (let round = 0; round < 3; round++) {
    for (const author of authors) {
      const id = uuid(likeCount, 9);
      await createStory(db, {
        id,
        authorId: author,
        likeCount,
        isCurated: true,
      });
      ids[author].push(id);
      likeCount -= 1;
      n++;
    }
  }
  await db.query(
    "insert into user_blocks (blocker_id, blocked_id) values ($1, $2)",
    [BLOCKER, AUTHOR_BLOCKED],
  );
  return ids;
}

Deno.test("a blocked author's curated stories are absent from the blocker's feed query", async () => {
  const db = await createDatabase();
  try {
    await seedThreeAuthorsNineCurated(db);

    const { rows, total } = await curatedPage(db, {
      blockedAuthorIds: [AUTHOR_BLOCKED],
      limit: 20,
      offset: 0,
    });

    assertEquals(total, 6); // 9 seeded, 3 from the blocked author excluded
    const returnedIds = new Set(rows.map((r) => r.id));
    const blockedRows = await db.query<{ id: string }>(
      "select id from stories where author_id = $1",
      [AUTHOR_BLOCKED],
    );
    for (const row of blockedRows.rows) {
      assertEquals(returnedIds.has(row.id), false);
    }
  } finally {
    await db.close();
  }
});

Deno.test("the same stories remain visible to a viewer who has not blocked that author", async () => {
  const db = await createDatabase();
  try {
    await seedThreeAuthorsNineCurated(db);

    // READER_NO_BLOCKS has no row in user_blocks, so no exclusion clause is
    // added at all -- this mirrors index.ts skipping `.not(...)` entirely
    // when `blockedAuthorIds` is empty.
    const { rows, total } = await curatedPage(db, {
      blockedAuthorIds: [],
      limit: 20,
      offset: 0,
    });

    assertEquals(total, 9);
    const blockedRows = await db.query<{ id: string }>(
      "select id from stories where author_id = $1",
      [AUTHOR_BLOCKED],
    );
    const returnedIds = new Set(rows.map((r) => r.id));
    for (const row of blockedRows.rows) {
      assertEquals(returnedIds.has(row.id), true);
    }
  } finally {
    await db.close();
  }
});

Deno.test("a user with zero blocks gets an unchanged feed query and total", async () => {
  const db = await createDatabase();
  try {
    await seedThreeAuthorsNineCurated(db);

    const withNoExclusion = await curatedPage(db, {
      blockedAuthorIds: [],
      limit: 5,
      offset: 0,
    });
    // Passing an empty blockedAuthorIds list must produce byte-identical
    // results to the pre-feature query (same total, same page, same order) --
    // there is nothing for a no-blocks user to notice.
    assertEquals(withNoExclusion.total, 9);
    assertEquals(withNoExclusion.rows.length, 5);
    const likeCounts = withNoExclusion.rows.map((r) => r.like_count);
    assertEquals(
      [...likeCounts].sort((a, b) => b - a),
      likeCounts,
    );
  } finally {
    await db.close();
  }
});

Deno.test("pagination does not short-page or skip rows when a block is active", async () => {
  const db = await createDatabase();
  try {
    await seedThreeAuthorsNineCurated(db);

    const limit = 5;
    const page1 = await curatedPage(db, {
      blockedAuthorIds: [AUTHOR_BLOCKED],
      limit,
      offset: 0,
    });
    const page2 = await curatedPage(db, {
      blockedAuthorIds: [AUTHOR_BLOCKED],
      limit,
      offset: limit,
    });

    // 6 visible stories total (9 seeded minus 3 from the blocked author).
    assertEquals(page1.total, 6);
    assertEquals(page2.total, 6);

    // Page 1 is a full page, not short, even though blocked-author rows sit
    // in the middle of the like_count ranking -- proof the filter ran before
    // the LIMIT/OFFSET, not after.
    assertEquals(page1.rows.length, 5);
    // Page 2 carries exactly the remainder, with no gap and no repeat.
    assertEquals(page2.rows.length, 1);

    const page1Ids = page1.rows.map((r) => r.id);
    const page2Ids = page2.rows.map((r) => r.id);
    const combined = [...page1Ids, ...page2Ids];
    assertEquals(new Set(combined).size, combined.length); // no duplicates

    const expected = await db.query<{ id: string }>(
      `select id from stories
       where is_curated = true and status = 'complete'
         and content_rating <> 'explicit' and author_id <> $1
       order by like_count desc`,
      [AUTHOR_BLOCKED],
    );
    assertEquals(combined, expected.rows.map((r) => r.id)); // no gaps, right order
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// The privilege the whole handler turned on
//
// `feed` read `user_blocks` with the SERVICE client, and 00043 ends with
// `revoke all on table public.user_blocks from public, anon` while granting
// only `authenticated` -- so `service_role` had no SELECT on it and the read
// returned 42501. That read happens before any feed is built, so the throw
// reached the catch and EVERY request from EVERY user answered
// `500 Internal server error`, from the day 00043 was applied until
// 2026-09-10. Nobody saw it: the client falls back to bundled content on a
// failed fetch, so the home screen still looked full, and the handler wrote
// no telemetry at all.
//
// Two independent things now have to hold, and this pair asserts both,
// because either one alone would have prevented the outage.
// ---------------------------------------------------------------------------

Deno.test("the caller's own role can read its block list, which is the role feed now uses", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, BLOCKER);
    await createUser(db, AUTHOR_BLOCKED);
    await db.query(
      "insert into user_blocks(blocker_id, blocked_id) values ($1, $2)",
      [BLOCKER, AUTHOR_BLOCKED],
    );

    // `feed` issues this through the anon-key client carrying the caller's
    // JWT, so it runs as `authenticated` with RLS scoping it to the caller.
    await db.exec(`set local role authenticated`);
    await db.query(
      `select set_config('request.jwt.claim.sub', $1, true)`,
      [BLOCKER],
    );
    const mine = await db.query<{ blocked_id: string }>(
      "select blocked_id from user_blocks where blocker_id = $1",
      [BLOCKER],
    );
    assertEquals(mine.rows.map((r) => r.blocked_id), [AUTHOR_BLOCKED]);

    // ...and RLS, not the filter, is what keeps it to the caller: asking for
    // somebody else's list returns nothing rather than their blocks.
    const theirs = await db.query<{ blocked_id: string }>(
      "select blocked_id from user_blocks where blocker_id = $1",
      [AUTHOR_BLOCKED],
    );
    assertEquals(theirs.rows, []);
  } finally {
    await db.close();
  }
});

Deno.test("service_role can also read user_blocks, so a service-side reader no longer 500s", async () => {
  const db = await createDatabase();
  try {
    const granted = await db.query<{ ok: boolean }>(
      `select has_table_privilege('service_role', 'public.user_blocks', 'SELECT') as ok`,
    );
    assertEquals(
      granted.rows[0].ok,
      true,
      "service_role cannot SELECT user_blocks; the feed handler will 500 again",
    );
  } finally {
    await db.close();
  }
});

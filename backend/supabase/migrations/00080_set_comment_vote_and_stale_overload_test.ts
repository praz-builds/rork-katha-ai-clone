// 00080: the function comment voting has always needed, and a stale overload.
//
// These CALL things rather than checking that they exist, which is what the
// original defect punished: `set_comment_vote` was absent from production for
// weeks while every test passed, because the harness built a fresh database
// from an edited 00043 and production never re-ran it.
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
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) migrations.push(entry.name);
  }
  migrations.sort();
  for (const m of migrations) {
    const sql = await Deno.readTextFile(new URL(m, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

const USER = "00000000-0000-4000-8000-000000000800";

Deno.test("a reader can cast, change and clear a vote", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [USER]);
    await db.query("insert into profiles(id) values ($1)", [USER]);
    const story = await db.query<{ id: string }>(
      `insert into public.stories (author_id, title, genre, primary_genre, status, is_public)
       values ($1,'T',array['mystery']::text[],'mystery','complete',true) returning id`,
      [USER],
    );
    const comment = await db.query<{ id: string }>(
      `insert into public.comments (story_id, user_id, content)
       values ($1,$2,'nice') returning id`,
      [story.rows[0].id, USER],
    );
    const commentId = comment.rows[0].id;

    // `auth.uid()` reads this setting; the function is SECURITY DEFINER and
    // refuses an unauthenticated caller outright.
    await db.exec(`set request.jwt.claim.sub = '${USER}'`);

    const votes = async () => {
      const r = await db.query<{ value: number }>(
        "select value from public.comment_votes where comment_id = $1",
        [commentId],
      );
      return r.rows.map((v) => v.value);
    };

    await db.query("select set_comment_vote($1, $2::smallint)", [commentId, 1]);
    assertEquals(await votes(), [1]);

    // Changing a vote updates in place rather than stacking a second row.
    await db.query("select set_comment_vote($1, $2::smallint)", [commentId, -1]);
    assertEquals(await votes(), [-1]);

    // Zero is "un-vote", not "a vote of zero".
    await db.query("select set_comment_vote($1, $2::smallint)", [commentId, 0]);
    assertEquals(await votes(), []);
  } finally {
    await db.close();
  }
});

Deno.test("an out-of-range vote is refused", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [USER]);
    await db.query("insert into profiles(id) values ($1)", [USER]);
    await db.exec(`set request.jwt.claim.sub = '${USER}'`);
    let refused = false;
    try {
      await db.query(
        "select set_comment_vote($1, $2::smallint)",
        ["00000000-0000-4000-8000-0000000008ff", 7],
      );
    } catch {
      refused = true;
    }
    assertEquals(refused, true);
  } finally {
    await db.close();
  }
});

// The stale overload. `drop function if exists` with a WRONG signature is a
// silent no-op, so this asserts the outcome rather than trusting the statement.
Deno.test("complete_story_generation has exactly one overload left", async () => {
  const db = await createDatabase();
  try {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'complete_story_generation'`,
    );
    assertEquals(r.rows[0].n, 1);
  } finally {
    await db.close();
  }
});

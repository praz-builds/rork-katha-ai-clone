// 00064: the column the Library selects by name, and a counter that stops
// scanning the whole bookmarks table on every tap.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
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

async function seed(db: PGlite) {
  const author = "11111111-1111-1111-1111-111111111111";
  const reader = "22222222-2222-2222-2222-222222222222";
  const other = "33333333-3333-3333-3333-333333333333";
  const story = "44444444-4444-4444-4444-444444444444";
  await db.exec(`
    insert into auth.users(id) values
      ('${author}'), ('${reader}'), ('${other}');
    insert into public.profiles(id) values
      ('${author}'), ('${reader}'), ('${other}');
    insert into public.stories(id, author_id, title, genre, primary_genre, status, is_public)
      values ('${story}', '${author}', 'The Map Remembers', array['fantasy'], 'fantasy', 'complete', true);
  `);
  return { author, reader, other, story };
}

// The client selects `bookmark_count` by name in two column lists. Without the
// column PostgREST rejects the whole select with 42703, which is why the
// Library's shelves were empty and search silently answered from fixtures.
Deno.test("stories.bookmark_count exists and starts at zero", async () => {
  const db = await createDatabase();
  try {
    const { story } = await seed(db);
    const { rows } = await db.query<{ bookmark_count: number }>(
      `select bookmark_count from public.stories where id = $1`,
      [story],
    );
    assertEquals(rows[0].bookmark_count, 0);
  } finally {
    await db.close();
  }
});

Deno.test("the counter follows real inserts and deletes, and a repeat tap is not a second save", async () => {
  const db = await createDatabase();
  try {
    const { reader, other, story } = await seed(db);
    const count = async () => {
      const { rows } = await db.query<{ bookmark_count: number }>(
        `select bookmark_count from public.stories where id = $1`,
        [story],
      );
      return rows[0].bookmark_count;
    };

    await db.query(`select public.toggle_bookmark($1, $2, true)`, [
      reader,
      story,
    ]);
    assertEquals(await count(), 1);

    // `on conflict do nothing` inserts no row, so counting the tap would
    // inflate the number every time a client retried.
    await db.query(`select public.toggle_bookmark($1, $2, true)`, [
      reader,
      story,
    ]);
    assertEquals(await count(), 1);

    await db.query(`select public.toggle_bookmark($1, $2, true)`, [
      other,
      story,
    ]);
    assertEquals(await count(), 2);

    await db.query(`select public.toggle_bookmark($1, $2, false)`, [
      reader,
      story,
    ]);
    assertEquals(await count(), 1);

    // Unsaving something never saved removes no row and must not decrement.
    await db.query(`select public.toggle_bookmark($1, $2, false)`, [
      reader,
      story,
    ]);
    assertEquals(await count(), 1);
  } finally {
    await db.close();
  }
});

// A reader must never be shown "-1 saved" because a counter drifted.
Deno.test("the counter cannot go negative", async () => {
  const db = await createDatabase();
  try {
    const { reader, story } = await seed(db);
    await db.query(`select public.toggle_bookmark($1, $2, true)`, [
      reader,
      story,
    ]);
    // Force drift: the row exists but the counter says zero.
    await db.exec(
      `update public.stories set bookmark_count = 0 where id = '${story}'`,
    );
    await db.query(`select public.toggle_bookmark($1, $2, false)`, [
      reader,
      story,
    ]);
    const { rows } = await db.query<{ bookmark_count: number }>(
      `select bookmark_count from public.stories where id = $1`,
      [story],
    );
    assertEquals(rows[0].bookmark_count, 0);
  } finally {
    await db.close();
  }
});

// The count(*) this replaced was a sequential scan of the whole bookmarks
// table on every bookmark tap: 00003 gave `story_likes` a story_id index and
// missed the sibling. The cascade still needs it even now the counter does not.
Deno.test("bookmarks.story_id is indexed, like its sibling story_likes", async () => {
  const db = await createDatabase();
  try {
    const { rows } = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where tablename = 'bookmarks' and indexdef like '%(story_id)%'`,
    );
    assert(rows.length > 0, "bookmarks.story_id has no covering index");
  } finally {
    await db.close();
  }
});

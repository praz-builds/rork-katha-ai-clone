// 00078: the directions a chapter was offered, and the one it took.
//
// The only new logic here is a CHECK constraint, and a CHECK is exactly the
// kind of thing that passes every test that does not try to violate it. So
// this writes rows: one per allowed value, and one that must be refused.
//
// It also pins that the columns are NULLABLE with no default. Every chapter
// written before this migration has an UNKNOWN answer rather than a known-empty
// one, and a `'{}'::jsonb` default would assert those chapters were offered no
// directions -- which is not something a migration can know.
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

const USER = "00000000-0000-4000-8000-000000000780";

async function seedChapter(db: PGlite): Promise<string> {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query("insert into profiles(id) values ($1)", [USER]);
  const story = await db.query<{ id: string }>(
    `insert into public.stories (author_id, title, genre, primary_genre, status)
     values ($1, 'T', array['mystery']::text[], 'mystery', 'complete') returning id`,
    [USER],
  );
  const chapter = await db.query<{ id: string }>(
    `insert into public.chapters (story_id, chapter_number, title, content)
     values ($1, 1, 'C1', 'text') returning id`,
    [story.rows[0].id],
  );
  return chapter.rows[0].id;
}

Deno.test("a chapter records who chose its direction, and refuses anyone else", async () => {
  const db = await createDatabase();
  try {
    const chapterId = await seedChapter(db);

    for (const by of ["reader", "model", "ranking"]) {
      await db.query(
        `update public.chapters
         set directions_offered = $1::jsonb,
             direction_chosen = $2,
             direction_chosen_by = $3
         where id = $4`,
        [
          JSON.stringify([{ id: "beat", prompt: "Open the stuck page." }]),
          "Open the stuck page.",
          by,
          chapterId,
        ],
      );
      const row = await db.query<{ direction_chosen_by: string }>(
        "select direction_chosen_by from public.chapters where id = $1",
        [chapterId],
      );
      assertEquals(row.rows[0].direction_chosen_by, by);
    }

    // 'model' and 'ranking' are deliberately distinct: collapsing them would
    // let a surfaced chip claim a choice that was really a fallback. Anything
    // outside the three is refused rather than stored and later believed.
    let refused = false;
    try {
      await db.query(
        "update public.chapters set direction_chosen_by = $1 where id = $2",
        ["ai", chapterId],
      );
    } catch {
      refused = true;
    }
    assertEquals(refused, true);
  } finally {
    await db.close();
  }
});

Deno.test("a chapter written before this migration has an unknown answer, not an empty one", async () => {
  const db = await createDatabase();
  try {
    const chapterId = await seedChapter(db);
    const row = await db.query<
      {
        directions_offered: unknown;
        direction_chosen: string | null;
        direction_chosen_by: string | null;
      }
    >(
      `select directions_offered, direction_chosen, direction_chosen_by
       from public.chapters where id = $1`,
      [chapterId],
    );
    // Null, not '{}'. "We do not know what was offered" and "nothing was
    // offered" are different facts and the surface that reads them must be
    // able to tell them apart.
    assertEquals(row.rows[0].directions_offered, null);
    assertEquals(row.rows[0].direction_chosen, null);
    assertEquals(row.rows[0].direction_chosen_by, null);
  } finally {
    await db.close();
  }
});

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

async function asUser(db: PGlite, userId: string) {
  await db.exec(`
    set request.jwt.claim.sub = '${userId}';
    set role authenticated;
  `);
}

async function asSuperuser(db: PGlite) {
  await db.exec("reset role;");
}

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
    `phrase_${id.slice(-4)}`,
  ]);
}

async function createStoryAndChapter(
  db: PGlite,
  storyId: string,
  chapterId: string,
  authorId: string,
) {
  await db.query(
    `insert into stories (id, author_id, title, genre, primary_genre, is_public)
     values ($1, $2, 'Phrase Story', array['contemporary'], 'contemporary', true)`,
    [storyId, authorId],
  );
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content)
     values ($1, $2, 1, 'One', 'A chapter with ordinary speech.')`,
    [chapterId, storyId],
  );
}

async function savePhrase(
  db: PGlite,
  userId: string,
  phrase: string,
  storyId: string,
  chapterId: string,
) {
  await asUser(db, userId);
  const result = await db.query<{ id: string }>(
    `select id from public.save_phrase($1, $2, $3, $4, $5)`,
    [
      userId,
      phrase,
      storyId,
      chapterId,
      `She said, "${phrase}," and picked up her bag.`,
    ],
  );
  return result.rows[0].id;
}

const AUTHOR = "00000000-0000-4000-8000-000000000471";
const READER = "00000000-0000-4000-8000-000000000472";
const OTHER = "00000000-0000-4000-8000-000000000473";
const STORY = "00000000-0000-4000-8000-000000000474";
const CHAPTER = "00000000-0000-4000-8000-000000000475";

Deno.test("phrase normalisation collapses casing and punctuation in SQL", async () => {
  const db = await createDatabase();
  try {
    const result = await db.query<{ a: string; b: string; c: string }>(
      `select public.phrase_normalize_key('At the end of the day.') as a,
              public.phrase_normalize_key('at the end of the day') as b,
              public.phrase_normalize_key('Couldn’t help but!') as c`,
    );
    assertEquals(result.rows[0].a, result.rows[0].b);
    assertEquals(result.rows[0].c, "couldn't help but");
  } finally {
    await db.close();
  }
});

Deno.test("a banned word or banned phrase is refused entry to the corpus", async () => {
  const db = await createDatabase();
  try {
    assertEquals(
      await attempt(
        db,
        `insert into phrase_corpus
          (phrase_text, phrase_key, register, cefr, literal_gloss, example_sentence)
         values
          ('leverage', public.phrase_normalize_key('leverage'), 'everyday', 'B1', 'use', 'We can leverage this.')`,
      ),
      "23514",
    );
    assertEquals(
      await attempt(
        db,
        `insert into phrase_corpus
          (phrase_text, phrase_key, register, cefr, literal_gloss, example_sentence)
         values
          ('at the end of the day', public.phrase_normalize_key('at the end of the day'), 'idiom', 'B1', 'finally', 'At the end of the day, we left.')`,
      ),
      "23514",
    );
  } finally {
    await db.close();
  }
});

Deno.test("saving the same phrase twice yields one row and does not error", async () => {
  const db = await createDatabase();
  try {
    for (const id of [AUTHOR, READER]) await createUser(db, id);
    await createStoryAndChapter(db, STORY, CHAPTER, AUTHOR);

    const first = await savePhrase(db, READER, "On my way.", STORY, CHAPTER);
    const second = await savePhrase(db, READER, "on my way", STORY, CHAPTER);
    assertEquals(first, second);

    await asSuperuser(db);
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from saved_phrases where user_id = $1",
      [READER],
    );
    assertEquals(count.rows[0].n, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a user cannot read another user's saved phrases under RLS", async () => {
  const db = await createDatabase();
  try {
    for (const id of [AUTHOR, READER, OTHER]) await createUser(db, id);
    await createStoryAndChapter(db, STORY, CHAPTER, AUTHOR);
    await savePhrase(db, READER, "on my way", STORY, CHAPTER);

    await asUser(db, OTHER);
    const visible = await db.query<{ id: string }>(
      "select id from saved_phrases",
    );
    assertEquals(visible.rows, []);
  } finally {
    await db.close();
  }
});

Deno.test("due-for-practice query returns only that user's due rows, soonest first", async () => {
  const db = await createDatabase();
  try {
    for (const id of [AUTHOR, READER, OTHER]) await createUser(db, id);
    await createStoryAndChapter(db, STORY, CHAPTER, AUTHOR);

    const later = await savePhrase(db, READER, "on my way", STORY, CHAPTER);
    const sooner = await savePhrase(db, READER, "right away", STORY, CHAPTER);
    const other = await savePhrase(db, OTHER, "by the way", STORY, CHAPTER);

    await asSuperuser(db);
    await db.query(
      `update phrase_practice set due_at = $1 where saved_phrase_id = $2`,
      ["2026-09-08T10:00:00Z", later],
    );
    await db.query(
      `update phrase_practice set due_at = $1 where saved_phrase_id = $2`,
      ["2026-09-08T09:00:00Z", sooner],
    );
    await db.query(
      `update phrase_practice set due_at = $1 where saved_phrase_id = $2`,
      ["2026-09-08T08:00:00Z", other],
    );

    await asUser(db, READER);
    const due = await db.query<{ saved_phrase_id: string }>(
      `select saved_phrase_id
       from phrase_practice
       where due_at <= '2026-09-09T00:00:00Z'
       order by due_at asc`,
    );

    assertEquals(due.rows.map((row) => row.saved_phrase_id), [sooner, later]);
  } finally {
    await db.close();
  }
});

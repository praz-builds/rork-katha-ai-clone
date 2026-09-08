// `record_story_read` (00046) never checked whether the caller could
// actually read the story or chapter it was told to record a read on -- any
// authenticated caller could inflate `stories.read_count` on a story private
// to them just by knowing its id. 00052 folds the same readability rule
// `save_phrase` (00047) and `canReadChapter` (`_shared/narration-audio.ts`)
// already use into this RPC. These tests exercise the redefined function,
// not the original 00046 one.
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

async function asService(db: PGlite) {
  await db.exec("reset role; set role service_role;");
}

// `service_role` in this harness is a plain role, not the real Supabase
// deployment's RLS-bypassing one, so a direct SELECT against a private story
// -- exactly the case these tests set up -- is invisible to it. Verification
// queries against a private/unpublished fixture run as the superuser instead,
// same as `00046_engagement_persistence_test.ts` already does for its own
// post-RPC assertions.
async function asSuperuser(db: PGlite) {
  await db.exec("reset role;");
}

async function createUser(db: PGlite, id: string, username?: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into profiles(id, username) values ($1, $2)", [
    id,
    username ?? `user_${id.slice(-4)}`,
  ]);
}

async function createStory(
  db: PGlite,
  id: string,
  // Nullable on purpose: a story with no author is the case that exposed the
  // three-valued-logic hole in the readability guard.
  authorId: string | null,
  opts: { isPublic?: boolean; isCurated?: boolean } = {},
) {
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, is_public, is_curated, status, content_rating)
     values ($1, $2, 'Read Gate Story', array['romance'], 'romance', $3, $4,
             'complete', 'sweet')`,
    [id, authorId, opts.isPublic ?? false, opts.isCurated ?? false],
  );
}

async function createChapter(
  db: PGlite,
  id: string,
  storyId: string,
  isPublished: boolean,
) {
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content, is_published)
     values ($1, $2, 1, 'One', 'Body', $3)`,
    [id, storyId, isPublished],
  );
}

async function recordRead(
  db: PGlite,
  userId: string,
  storyId: string,
  chapterId: string | null,
): Promise<string | null> {
  try {
    await db.query(
      "select recorded from record_story_read($1, $2, $3, 5, null, null)",
      [userId, storyId, chapterId],
    );
    return null;
  } catch (error) {
    return (error as { message?: string }).message ?? "unknown error";
  }
}

const AUTHOR = "00000000-0000-4000-8000-000000000561";
const READER = "00000000-0000-4000-8000-000000000562";
const STORY = "00000000-0000-4000-8000-000000000560";
const CHAPTER = "00000000-0000-4000-8000-000000000564";

Deno.test("a reader cannot record a read on a private, unpublished story that is not theirs", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, READER);
    await createStory(db, STORY, AUTHOR, { isPublic: false, isCurated: false });
    await createChapter(db, CHAPTER, STORY, false);
    await asService(db);

    const error = await recordRead(db, READER, STORY, CHAPTER);
    assertEquals(error, "Story not found");

    await asSuperuser(db);
    const readCount = await db.query<{ read_count: number }>(
      "select read_count from stories where id = $1",
      [STORY],
    );
    assertEquals(readCount.rows[0].read_count, 0);
    const reads = await db.query<{ n: number }>(
      "select count(*)::int as n from story_reads",
    );
    assertEquals(reads.rows[0].n, 0);
  } finally {
    await db.close();
  }
});

Deno.test("an author can still record a read on their own unpublished, private story", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR, { isPublic: false, isCurated: false });
    await createChapter(db, CHAPTER, STORY, false);
    await asService(db);

    const error = await recordRead(db, AUTHOR, STORY, CHAPTER);
    assertEquals(error, null);

    await asSuperuser(db);
    const result = await db.query<
      { is_own_story: boolean; counts_for_earnings: boolean }
    >(
      `select is_own_story, counts_for_earnings
       from story_reads where story_id = $1 and user_id = $2`,
      [STORY, AUTHOR],
    );
    assertEquals(result.rows.length, 1);
    assertEquals(result.rows[0].is_own_story, true);
    assertEquals(result.rows[0].counts_for_earnings, false);
  } finally {
    await db.close();
  }
});

Deno.test("a reader can record a read on a public story with a published chapter", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, READER);
    await createStory(db, STORY, AUTHOR, { isPublic: true });
    await createChapter(db, CHAPTER, STORY, true);
    await asService(db);

    const error = await recordRead(db, READER, STORY, CHAPTER);
    assertEquals(error, null);

    const readCount = await db.query<{ read_count: number }>(
      "select read_count from stories where id = $1",
      [STORY],
    );
    assertEquals(readCount.rows[0].read_count, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a reader can record a read on a curated story with a published chapter", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, READER);
    await createStory(db, STORY, AUTHOR, { isPublic: false, isCurated: true });
    await createChapter(db, CHAPTER, STORY, true);
    await asService(db);

    const error = await recordRead(db, READER, STORY, CHAPTER);
    assertEquals(error, null);
  } finally {
    await db.close();
  }
});

Deno.test("a reader is refused on a public story whose specific chapter is not yet published", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, READER);
    // The story is public, but this particular chapter is still a draft --
    // the story-level flag alone must not be enough.
    await createStory(db, STORY, AUTHOR, { isPublic: true });
    await createChapter(db, CHAPTER, STORY, false);
    await asService(db);

    const error = await recordRead(db, READER, STORY, CHAPTER);
    assertEquals(error, "Story not found");
  } finally {
    await db.close();
  }
});

Deno.test("a nonexistent story and a private one the caller cannot read fail identically", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createUser(db, READER);
    await createStory(db, STORY, AUTHOR, { isPublic: false, isCurated: false });
    await createChapter(db, CHAPTER, STORY, true);
    await asService(db);

    const missing = await recordRead(
      db,
      READER,
      "00000000-0000-4000-8000-000000009999",
      null,
    );
    const unreadable = await recordRead(db, READER, STORY, CHAPTER);
    assertEquals(missing, unreadable);
  } finally {
    await db.close();
  }
});


// A null author must not make the guard evaporate.
//
// The check was `v_author_id <> p_user_id`, and `<>` against NULL evaluates to
// NULL rather than true -- so the `if` never fired and an unpublished chapter
// was accepted for a non-author. Three-valued logic turns a security check into
// a no-op exactly when the data is unusual, which is exactly when you want it.
Deno.test("an unpublished chapter is refused even when the story has no author", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, READER);
    await createStory(db, STORY, null, { isPublic: true, isCurated: false });
    await createChapter(db, CHAPTER, STORY, false);
    await asService(db);

    const error = await recordRead(db, READER, STORY, CHAPTER);
    assertEquals(
      error,
      "Story not found",
      "a null author must not open the gate",
    );

    await asSuperuser(db);
    const readCount = await db.query<{ read_count: number }>(
      "select read_count from stories where id = $1",
      [STORY],
    );
    assertEquals(readCount.rows[0].read_count, 0);
  } finally {
    await db.close();
  }
});

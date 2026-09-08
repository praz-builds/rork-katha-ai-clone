// The same harness 00046's companion test uses: every migration applied in
// order against a real Postgres (PGlite), so RLS, constraints and the claim
// RPC are asserted as they will actually behave rather than as they read.
//
// The backfill test is the one exception: it needs to see the world as it was
// the moment before 00048 ran, so it builds a database from every migration
// *except* this one, seeds a legacy `chapters.audio_url` row by hand, then
// applies this migration's SQL directly and checks what it produced. Every
// other test in this file uses the full, ordinary migration set.
import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

const THIS_MIGRATION = "00048_voice_library.sql";

async function bootstrapAuthSchema(db: PGlite) {
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
}

async function migrationFiles(): Promise<string[]> {
  const migrations: string[] = [];
  for await (const entry of Deno.readDir(new URL(".", import.meta.url))) {
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) {
      migrations.push(entry.name);
    }
  }
  migrations.sort();
  return migrations;
}

/** Every migration applied in order, including this one. */
async function createDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await bootstrapAuthSchema(db);
  for (const migration of await migrationFiles()) {
    const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

/** Every migration strictly before `00048_voice_library.sql` -- the world as it looked the moment before this one ran. */
async function createDatabaseBeforeThisMigration(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await bootstrapAuthSchema(db);
  for (const migration of await migrationFiles()) {
    if (migration >= THIS_MIGRATION) continue;
    const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

async function applyThisMigration(db: PGlite): Promise<void> {
  const sql = await Deno.readTextFile(new URL(THIS_MIGRATION, import.meta.url));
  await db.exec(sql.replace(/create index concurrently/gi, "create index"));
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`
    set request.jwt.claim.sub = '${userId}';
    set role authenticated;
  `);
}

async function asAnon(db: PGlite) {
  await db.exec("reset role; set role anon;");
}

async function asService(db: PGlite) {
  await db.exec("reset role; set role service_role;");
}

async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
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
  authorId: string,
  opts: { isPublic?: boolean; isCurated?: boolean } = {},
) {
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, is_public, is_curated, status, content_rating)
     values ($1, $2, 'Narrated Story', array['romance'], 'romance', $3, $4, 'complete', 'sweet')`,
    [id, authorId, opts.isPublic ?? false, opts.isCurated ?? false],
  );
}

async function createChapter(
  db: PGlite,
  id: string,
  storyId: string,
  opts: {
    isPublished?: boolean;
    audioUrl?: string | null;
    wordCount?: number;
  } = {},
) {
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content, word_count, audio_url, is_published)
     values ($1, $2, 1, 'One', 'Body text for narration.', $3, $4, $5)`,
    [
      id,
      storyId,
      opts.wordCount ?? 4,
      opts.audioUrl ?? null,
      opts.isPublished ?? false,
    ],
  );
}

const AUTHOR = "00000000-0000-4000-8000-000000000481";
const READER = "00000000-0000-4000-8000-000000000482";
const STORY = "00000000-0000-4000-8000-000000000480";
const CHAPTER = "00000000-0000-4000-8000-000000000483";

async function scalar<T>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, params);
  return Object.values(result.rows[0])[0];
}

// ---------------------------------------------------------------------------
// The seeded voice registry
// ---------------------------------------------------------------------------

Deno.test("seeds exactly today's 8 voices, in sort order, with only the backed ones active", async () => {
  const db = await createDatabase();
  try {
    await asService(db);
    const result = await db.query<
      { id: string; tier: string; is_active: boolean }
    >(
      "select id, tier, is_active from voices order by sort_order asc",
    );
    assertEquals(
      result.rows.map((r) => r.id),
      ["aria", "kai", "elvira", "alvaro", "onyx", "nova", "echo", "fable"],
    );
    // All eight rows still exist -- 00053 deactivates `elvira` and `alvaro`
    // rather than deleting them, because `chapter_audio.voice_id` references
    // this table and a narration already generated in one of those voices must
    // keep playing. What it changes is reachability: their provider
    // (`edge_tts`) has no implementation, so offering them meant a reader
    // choosing a voice that could only ever fail.
    assertEquals(
      result.rows.filter((r) => !r.is_active).map((r) => r.id),
      ["elvira", "alvaro"],
    );
    assertEquals(
      result.rows.filter((r) => r.is_active).map((r) => r.id),
      ["aria", "kai", "onyx", "nova", "echo", "fable"],
    );
    assertEquals(
      result.rows.filter((r) => r.tier === "standard").map((r) => r.id),
      ["aria", "kai", "elvira", "alvaro"],
    );
    assertEquals(
      result.rows.filter((r) => r.tier === "premium").map((r) => r.id),
      ["onyx", "nova", "echo", "fable"],
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// RLS: voices
// ---------------------------------------------------------------------------

Deno.test("voices: anon has no grant at all, authenticated can read active voices", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await asAnon(db);
    assertEquals(await attempt(db, "select 1 from voices limit 1"), "42501");

    await asUser(db, AUTHOR);
    // Six, not eight: the policy is `is_active = true`, and 00053 deactivated
    // the two `edge_tts` voices that have no implementation behind them. That
    // the number here tracks the seed's active count rather than its row count
    // is the point -- a voice deactivated in a later migration must actually
    // stop being offered, not merely stop being recommended.
    const count = await scalar<string>(db, "select count(*)::text from voices");
    assertEquals(count, "6");
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// RLS: chapter_audio
// ---------------------------------------------------------------------------

async function seedNarrationStory(
  db: PGlite,
  opts: { isPublic: boolean; isPublished: boolean },
) {
  await createUser(db, AUTHOR);
  await createUser(db, READER);
  await createStory(db, STORY, AUTHOR, { isPublic: opts.isPublic });
  await createChapter(db, CHAPTER, STORY, { isPublished: opts.isPublished });
  await asService(db);
  await db.query(
    `insert into chapter_audio (chapter_id, voice_id, status)
     values ($1, 'aria', 'pending')`,
    [CHAPTER],
  );
}

Deno.test("chapter_audio: the author can always read their own chapter's rows", async () => {
  const db = await createDatabase();
  try {
    await seedNarrationStory(db, { isPublic: false, isPublished: false });
    await asUser(db, AUTHOR);
    const count = await scalar<string>(
      db,
      `select count(*)::text from chapter_audio where chapter_id = '${CHAPTER}'`,
    );
    assertEquals(count, "1");
  } finally {
    await db.close();
  }
});

Deno.test("chapter_audio: a non-author cannot read an unpublished or private story's rows", async () => {
  const db = await createDatabase();
  try {
    await seedNarrationStory(db, { isPublic: false, isPublished: false });
    await asUser(db, READER);
    const count = await scalar<string>(
      db,
      `select count(*)::text from chapter_audio where chapter_id = '${CHAPTER}'`,
    );
    assertEquals(count, "0");
  } finally {
    await db.close();
  }
});

Deno.test("chapter_audio: a non-author CAN read a published chapter on a public story", async () => {
  const db = await createDatabase();
  try {
    await seedNarrationStory(db, { isPublic: true, isPublished: true });
    await asUser(db, READER);
    const count = await scalar<string>(
      db,
      `select count(*)::text from chapter_audio where chapter_id = '${CHAPTER}'`,
    );
    assertEquals(count, "1");

    await asAnon(db);
    assertEquals(
      await attempt(
        db,
        `select 1 from chapter_audio where chapter_id = '${CHAPTER}'`,
      ),
      "42501",
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

Deno.test("chapter_audio: (chapter_id, voice_id) is unique", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);
    await createChapter(db, CHAPTER, STORY);
    await asService(db);
    await db.query(
      "insert into chapter_audio (chapter_id, voice_id, status) values ($1, 'aria', 'pending')",
      [CHAPTER],
    );
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio (chapter_id, voice_id, status) values ('${CHAPTER}', 'aria', 'pending')`,
      ),
      "23505",
    );
    // A different voice on the same chapter is a different row entirely.
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio (chapter_id, voice_id, status) values ('${CHAPTER}', 'kai', 'pending')`,
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("chapter_audio: ready status and (storage_path, generated_at) must agree", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);
    await createChapter(db, CHAPTER, STORY);
    await asService(db);

    // ready with no storage_path/generated_at: rejected.
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio (chapter_id, voice_id, status)
         values ('${CHAPTER}', 'aria', 'ready')`,
      ),
      "23514",
    );

    // pending with both storage_path and generated_at already set: also
    // rejected -- a retry must clear both, which is exactly what the claim
    // function does.
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio (chapter_id, voice_id, status, storage_path, generated_at)
         values ('${CHAPTER}', 'kai', 'pending', 'x/y.mp3', now())`,
      ),
      "23514",
    );

    // ready with both set: accepted.
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio (chapter_id, voice_id, status, storage_path, generated_at)
         values ('${CHAPTER}', 'elvira', 'ready', 'x/y.mp3', now())`,
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// claim_chapter_audio_generation: the atomic dedup + retry contract
// ---------------------------------------------------------------------------

Deno.test("claim: the first caller for a (chapter, voice) wins and inserts a pending row", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);
    await createChapter(db, CHAPTER, STORY);
    await asService(db);

    const result = await db.query<{ claimed: boolean; status: string }>(
      "select * from claim_chapter_audio_generation($1, 'aria', $2, 140)",
      [CHAPTER, `${STORY}/${CHAPTER}/aria.mp3`],
    );
    assertEquals(result.rows[0].claimed, true);
    assertEquals(result.rows[0].status, "pending");

    const count = await scalar<string>(
      db,
      "select count(*)::text from chapter_audio",
    );
    assertEquals(count, "1");
  } finally {
    await db.close();
  }
});

Deno.test("claim: a second caller for the same pending (chapter, voice) does not claim and does not duplicate the row", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);
    await createChapter(db, CHAPTER, STORY);
    await asService(db);

    await db.query(
      "select * from claim_chapter_audio_generation($1, 'aria', $2, 140)",
      [CHAPTER, `${STORY}/${CHAPTER}/aria.mp3`],
    );
    const second = await db.query<{ claimed: boolean; status: string }>(
      "select * from claim_chapter_audio_generation($1, 'aria', $2, 140)",
      [CHAPTER, `${STORY}/${CHAPTER}/aria.mp3`],
    );

    assertEquals(second.rows[0].claimed, false);
    assertEquals(second.rows[0].status, "pending");
    const count = await scalar<string>(
      db,
      "select count(*)::text from chapter_audio",
    );
    assertEquals(
      count,
      "1",
      "two readers pressing Listen at once must cost one generation",
    );
  } finally {
    await db.close();
  }
});

Deno.test("claim: a ready row is reported but never reset by a later claim", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);
    await createChapter(db, CHAPTER, STORY);
    await asService(db);

    const first = await db.query<{ audio_id: string }>(
      "select * from claim_chapter_audio_generation($1, 'aria', $2, 140)",
      [CHAPTER, `${STORY}/${CHAPTER}/aria.mp3`],
    );
    const audioId = first.rows[0].audio_id;
    await db.query(
      `update chapter_audio
       set status = 'ready', storage_path = $2, generated_at = now(), provider_job_id = null
       where id = $1`,
      [audioId, `${STORY}/${CHAPTER}/aria.mp3`],
    );

    const claimAgain = await db.query<
      { claimed: boolean; status: string; storage_path: string }
    >(
      "select * from claim_chapter_audio_generation($1, 'aria', $2, 999)",
      [CHAPTER, `${STORY}/${CHAPTER}/aria.mp3`],
    );
    assertEquals(claimAgain.rows[0].claimed, false);
    assertEquals(claimAgain.rows[0].status, "ready");
    assertEquals(
      claimAgain.rows[0].storage_path,
      `${STORY}/${CHAPTER}/aria.mp3`,
    );

    const wordCount = await scalar<number>(
      db,
      "select word_count from chapter_audio where id = $1",
      [audioId],
    );
    assertNotEquals(
      wordCount,
      999,
      "a claim against a ready row must not overwrite it",
    );
  } finally {
    await db.close();
  }
});

Deno.test("claim: a failed row can be claimed again, reset to pending", async () => {
  const db = await createDatabase();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);
    await createChapter(db, CHAPTER, STORY);
    await asService(db);

    const first = await db.query<{ audio_id: string }>(
      "select * from claim_chapter_audio_generation($1, 'aria', $2, 140)",
      [CHAPTER, `${STORY}/${CHAPTER}/aria.mp3`],
    );
    const audioId = first.rows[0].audio_id;
    await db.query(
      `update chapter_audio
       set status = 'failed', storage_path = null, generated_at = null,
           provider_job_id = null, error_code = 'provider_error'
       where id = $1`,
      [audioId],
    );

    const retry = await db.query<{ claimed: boolean; status: string }>(
      "select * from claim_chapter_audio_generation($1, 'aria', $2, 250)",
      [CHAPTER, `${STORY}/${CHAPTER}/aria.mp3`],
    );
    assertEquals(retry.rows[0].claimed, true, "a failed job must be retryable");
    assertEquals(retry.rows[0].status, "pending");

    const row = await db.query<
      {
        status: string;
        storage_path: string | null;
        provider_job_id: string | null;
        word_count: number;
        error_code: string | null;
      }
    >(
      "select status, storage_path, provider_job_id, word_count, error_code from chapter_audio where id = $1",
      [audioId],
    );
    assertEquals(row.rows[0].status, "pending");
    assertEquals(row.rows[0].storage_path, null);
    assertEquals(row.rows[0].provider_job_id, null);
    assertEquals(row.rows[0].word_count, 250);
    assertEquals(row.rows[0].error_code, null);

    const count = await scalar<string>(
      db,
      "select count(*)::text from chapter_audio",
    );
    assertEquals(
      count,
      "1",
      "a retry reuses the same row rather than creating a second one",
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Backfill: chapters.audio_url -> chapter_audio, losing nothing
// ---------------------------------------------------------------------------

Deno.test("backfill: an existing chapters.audio_url becomes a ready chapter_audio row for the default voice", async () => {
  const db = await createDatabaseBeforeThisMigration();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR, { isPublic: true });
    await createChapter(db, CHAPTER, STORY, {
      isPublished: true,
      audioUrl: "https://cdn.example/legacy/aria.mp3",
      wordCount: 812,
    });

    // Sanity: chapter_audio does not exist before this migration runs.
    assertEquals(
      await attempt(db, "select 1 from chapter_audio limit 1"),
      "42P01", // undefined_table
    );

    await applyThisMigration(db);

    const row = await db.query<{
      voice_id: string;
      storage_path: string;
      word_count: number;
      status: string;
      generated_at: string | null;
    }>(
      `select voice_id, storage_path, word_count, status, generated_at
       from chapter_audio where chapter_id = $1`,
      [CHAPTER],
    );
    assertEquals(
      row.rows.length,
      1,
      "the backfill must produce exactly one row per legacy chapter",
    );
    assertEquals(row.rows[0].voice_id, "aria");
    assertEquals(
      row.rows[0].storage_path,
      "https://cdn.example/legacy/aria.mp3",
    );
    assertEquals(row.rows[0].word_count, 812);
    assertEquals(row.rows[0].status, "ready");
    assertNotEquals(row.rows[0].generated_at, null);

    // The legacy column must still be there -- this migration does not drop it.
    const legacyStillPresent = await scalar<string>(
      db,
      "select audio_url from chapters where id = $1",
      [CHAPTER],
    );
    assertEquals(legacyStillPresent, "https://cdn.example/legacy/aria.mp3");
  } finally {
    await db.close();
  }
});

Deno.test("backfill: a chapter with no audio_url gets no chapter_audio row", async () => {
  const db = await createDatabaseBeforeThisMigration();
  try {
    await createUser(db, AUTHOR);
    await createStory(db, STORY, AUTHOR);
    await createChapter(db, CHAPTER, STORY, { audioUrl: null });

    await applyThisMigration(db);

    const count = await scalar<string>(
      db,
      "select count(*)::text from chapter_audio where chapter_id = $1",
      [CHAPTER],
    );
    assertEquals(count, "0");
  } finally {
    await db.close();
  }
});

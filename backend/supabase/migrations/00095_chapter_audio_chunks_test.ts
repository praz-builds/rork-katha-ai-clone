// 00095: a narration's chunks become rows, and the rules that make that safe.
//
// The same harness every other migration test uses: every migration applied in
// order against a real Postgres (PGlite), so RLS, the grants and the claim RPC
// are asserted as they will actually behave rather than as they read.
//
// Three things are worth a test here, and they are the three that would each
// be a real incident: a chunk row reaching a reader who cannot read the
// chapter (it names the parts of a story they are not entitled to), the claim
// RPC being callable by an ordinary authenticated user (it DELETES the chunk
// set, so calling it mid-narration would strand a run that is already paid
// for), and the cascade failing to take the chunk rows with their parent (a
// deleted `chapter_audio` row leaving chunk rows pointing at nothing).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

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

/**
 * Every caller wraps this in `try { ... } finally { db.close() }`, which only
 * protects what this function RETURNS. A migration that fails to apply -- the
 * ordinary way this harness reports a broken .sql file -- threw out of here
 * with the PGlite instance already open and nothing holding a reference to it,
 * so each failing run leaked a process handle. In CI, where a broken migration
 * fails every test in the file, that is one leak per test.
 *
 * So the acquire is inside the guard: whatever goes wrong after `new PGlite`,
 * the instance it opened is closed before the error leaves.
 */
async function createDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await bootstrapAuthSchema(db);
    for (const migration of await migrationFiles()) {
      const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
      await db.exec(sql.replace(/create index concurrently/gi, "create index"));
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`
    reset role;
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

async function scalar<T>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, params);
  return Object.values(result.rows[0])[0];
}

const AUTHOR = "00000000-0000-4000-8000-000000000951";
const READER = "00000000-0000-4000-8000-000000000952";
const STORY = "00000000-0000-4000-8000-000000000950";
const CHAPTER = "00000000-0000-4000-8000-000000000953";

async function seedNarration(
  db: PGlite,
  opts: { isPublic: boolean; isPublished: boolean },
): Promise<string> {
  // Seeded as the owning role, not as `service_role`: the fixtures reach into
  // `auth.users`, which the platform's service role has no grant on.
  for (const id of [AUTHOR, READER]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id, username) values ($1, $2)", [
      id,
      `user_${id.slice(-4)}`,
    ]);
  }
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, is_public, is_curated, status, content_rating)
     values ($1, $2, 'Narrated Story', array['romance'], 'romance', $3, false, 'complete', 'sweet')`,
    [STORY, AUTHOR, opts.isPublic],
  );
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content, word_count, is_published)
     values ($1, $2, 1, 'One', 'Body text for narration.', 4, $3)`,
    [CHAPTER, STORY, opts.isPublished],
  );
  await asService(db);
  return await scalar<string>(
    db,
    `insert into chapter_audio (chapter_id, voice_id, status)
     values ($1, 'aria', 'pending') returning id`,
    [CHAPTER],
  );
}

// ---------------------------------------------------------------------------
// The claim RPC
// ---------------------------------------------------------------------------

Deno.test("claim: writes 0..n-1 pending rows carrying their own char counts", async () => {
  const db = await createDatabase();
  try {
    const audioId = await seedNarration(db, {
      isPublic: false,
      isPublished: false,
    });
    await asService(db);
    const claimed = await db.query<
      { chunk_index: number; char_count: number; status: string }
    >(
      "select * from claim_chapter_audio_chunks($1, 3, $2) order by chunk_index",
      [audioId, [8900, 8800, 4200]],
    );
    assertEquals(claimed.rows.map((r) => r.chunk_index), [0, 1, 2]);
    assertEquals(claimed.rows.map((r) => Number(r.char_count)), [
      8900,
      8800,
      4200,
    ]);
    assertEquals(claimed.rows.map((r) => r.status), [
      "pending",
      "pending",
      "pending",
    ]);
  } finally {
    await db.close();
  }
});

Deno.test("claim: a second claim restarts at chunk 0 rather than resuming", async () => {
  const db = await createDatabase();
  try {
    const audioId = await seedNarration(db, {
      isPublic: false,
      isPublished: false,
    });
    await asService(db);
    await db.query("select * from claim_chapter_audio_chunks($1, 3, $2)", [
      audioId,
      [10, 20, 30],
    ]);
    // Pretend the first run got one chunk done. A resume onto this row is
    // exactly what must not happen: if the prose changed in between, the
    // finished file would splice two revisions together.
    await db.query(
      `update chapter_audio_chunks set status = 'ready', storage_path = 'x/y.00.mp3'
       where chapter_audio_id = $1 and chunk_index = 0`,
      [audioId],
    );

    await db.query("select * from claim_chapter_audio_chunks($1, 2, $2)", [
      audioId,
      [40, 50],
    ]);

    const rows = await db.query<{ chunk_index: number; status: string }>(
      "select chunk_index, status from chapter_audio_chunks where chapter_audio_id = $1 order by chunk_index",
      [audioId],
    );
    assertEquals(rows.rows.map((r) => r.chunk_index), [0, 1]);
    assertEquals(rows.rows.map((r) => r.status), ["pending", "pending"]);
  } finally {
    await db.close();
  }
});

Deno.test("claim: an ordinary authenticated caller cannot execute it", async () => {
  const db = await createDatabase();
  try {
    const audioId = await seedNarration(db, {
      isPublic: true,
      isPublished: true,
    });
    // The reader can SEE this narration -- the story is public and the chapter
    // published -- and that is the whole point: being allowed to read the rows
    // must not imply being allowed to delete and recreate the chunk set of a
    // run somebody has already paid RunPod for.
    await asUser(db, READER);
    assertEquals(
      await attempt(
        db,
        `select * from claim_chapter_audio_chunks('${audioId}', 3, null)`,
      ),
      "42501",
    );
    await asAnon(db);
    assertEquals(
      await attempt(
        db,
        `select * from claim_chapter_audio_chunks('${audioId}', 3, null)`,
      ),
      "42501",
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// RLS
// ---------------------------------------------------------------------------

Deno.test("rls: a chunk row of a chapter the caller cannot read is invisible", async () => {
  const db = await createDatabase();
  try {
    const audioId = await seedNarration(db, {
      isPublic: false,
      isPublished: false,
    });
    await asService(db);
    await db.query("select * from claim_chapter_audio_chunks($1, 2, null)", [
      audioId,
    ]);

    await asUser(db, READER);
    assertEquals(
      await scalar<string>(
        db,
        "select count(*)::text from chapter_audio_chunks",
      ),
      "0",
    );

    // The author of the private story still sees their own.
    await asUser(db, AUTHOR);
    assertEquals(
      await scalar<string>(
        db,
        "select count(*)::text from chapter_audio_chunks",
      ),
      "2",
    );

    // And anon has no grant at all, exactly as on `chapter_audio`.
    await asAnon(db);
    assertEquals(
      await attempt(db, "select 1 from chapter_audio_chunks limit 1"),
      "42501",
    );
  } finally {
    await db.close();
  }
});

Deno.test("rls: a published chapter on a public story is readable by any reader", async () => {
  const db = await createDatabase();
  try {
    const audioId = await seedNarration(db, {
      isPublic: true,
      isPublished: true,
    });
    await asService(db);
    await db.query("select * from claim_chapter_audio_chunks($1, 2, null)", [
      audioId,
    ]);

    await asUser(db, READER);
    assertEquals(
      await scalar<string>(
        db,
        "select count(*)::text from chapter_audio_chunks",
      ),
      "2",
    );

    // Readable, never writable: the manifest is served to the reader, and the
    // reader must not be able to mark a chunk ready on a path of their own.
    assert(
      (await attempt(
        db,
        `update chapter_audio_chunks set status = 'failed' where chunk_index = 0`,
      )) !== null,
      "an ordinary reader must not be able to write a chunk row",
    );
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Constraints and lifecycle
// ---------------------------------------------------------------------------

Deno.test("a chunk is ready exactly when it has a storage path", async () => {
  const db = await createDatabase();
  try {
    const audioId = await seedNarration(db, {
      isPublic: false,
      isPublished: false,
    });
    await asService(db);

    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio_chunks (chapter_audio_id, chunk_index, status)
         values ('${audioId}', 0, 'ready')`,
      ),
      "23514",
    );
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio_chunks (chapter_audio_id, chunk_index, status, storage_path)
         values ('${audioId}', 1, 'pending', 'x/y.01.mp3')`,
      ),
      "23514",
    );
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio_chunks (chapter_audio_id, chunk_index, status, storage_path)
         values ('${audioId}', 2, 'ready', 'x/y.02.mp3')`,
      ),
      null,
    );
    // A provider job id is interpolated into a RunPod URL, so the same shape
    // the parent row demands is demanded here.
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio_chunks (chapter_audio_id, chunk_index, provider_job_id)
         values ('${audioId}', 3, 'not a job id/../')`,
      ),
      "23514",
    );
    // ...and one chunk index per narration, once.
    assertEquals(
      await attempt(
        db,
        `insert into chapter_audio_chunks (chapter_audio_id, chunk_index)
         values ('${audioId}', 2)`,
      ),
      "23505",
    );
  } finally {
    await db.close();
  }
});

Deno.test("deleting the parent chapter_audio row takes its chunk rows with it", async () => {
  const db = await createDatabase();
  try {
    const audioId = await seedNarration(db, {
      isPublic: false,
      isPublished: false,
    });
    await asService(db);
    await db.query("select * from claim_chapter_audio_chunks($1, 3, null)", [
      audioId,
    ]);
    assertEquals(
      await scalar<string>(
        db,
        "select count(*)::text from chapter_audio_chunks",
      ),
      "3",
    );

    // `edit-story` deletes the `chapter_audio` row whenever it rewrites a
    // chapter body. Chunk rows left behind would describe parts of a prose
    // revision that no longer exists.
    await db.query("delete from chapter_audio where id = $1", [audioId]);
    assertEquals(
      await scalar<string>(
        db,
        "select count(*)::text from chapter_audio_chunks",
      ),
      "0",
    );
  } finally {
    await db.close();
  }
});

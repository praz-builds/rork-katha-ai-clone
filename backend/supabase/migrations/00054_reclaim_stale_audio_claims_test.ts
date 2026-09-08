// A `pending` narration claim used to be permanent.
//
// `claim_chapter_audio_generation` (00048) refuses a claim whenever a row for
// the (chapter, voice) pair is already `pending`, which is what stops two
// readers from starting two paid RunPod jobs on the same chapter. Nothing ever
// cleared such a row when no job was actually behind it -- the isolate died
// between the claim and the job start, or `generate-audio`'s own failure write
// failed -- so the chapter became unnarratable in that voice forever, and no
// retry could change it. 00054 gives `pending` an expiry.
//
// These tests exercise the redefined function, not 00048's original.
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

const AUTHOR = "00000000-0000-4000-8000-000000000601";
const STORY = "00000000-0000-4000-8000-000000000602";
const CHAPTER = "00000000-0000-4000-8000-000000000603";
const VOICE = "aria";

async function seed(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [AUTHOR]);
  await db.query("insert into profiles(id, username) values ($1, 'narrator')", [
    AUTHOR,
  ]);
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, is_public, status, content_rating)
     values ($1, $2, 'Narrated', array['romance'], 'romance', true, 'complete', 'sweet')`,
    [STORY, AUTHOR],
  );
  await db.query(
    `insert into chapters (id, story_id, chapter_number, title, content, is_published)
     values ($1, $2, 1, 'One', 'Body', true)`,
    [CHAPTER, STORY],
  );
  // The voice has to exist: `chapter_audio.voice_id` references it.
  const existing = await db.query<{ n: number }>(
    "select count(*)::int as n from voices where id = $1",
    [VOICE],
  );
  if (existing.rows[0].n === 0) {
    await db.query(
      "insert into voices (id, label, provider, provider_voice_id, is_active) values ($1, 'Aria', 'runpod', 'aria', true)",
      [VOICE],
    );
  }
}

type ClaimRow = {
  audio_id: string;
  status: string;
  provider_job_id: string | null;
  claimed: boolean;
};

function claim(db: PGlite) {
  return db.query<ClaimRow>(
    "select * from claim_chapter_audio_generation($1, $2, $3, $4)",
    [CHAPTER, VOICE, `audio/${STORY}/${CHAPTER}/${VOICE}.mp3`, 800],
  );
}

/** Age the row's `updated_at` by hand -- the only way to simulate elapsed time. */
async function ageClaim(db: PGlite, interval: string) {
  await db.query(
    `update chapter_audio set updated_at = now() - $1::interval
     where chapter_id = $2 and voice_id = $3`,
    [interval, CHAPTER, VOICE],
  );
}

Deno.test("a fresh pending claim still blocks a second one", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const first = await claim(db);
    assertEquals(first.rows[0].claimed, true);

    // This is the guarantee the expiry must not break: two readers pressing
    // Listen at the same moment start exactly one paid job.
    const second = await claim(db);
    assertEquals(second.rows[0].claimed, false);
    assertEquals(second.rows[0].status, "pending");
  } finally {
    await db.close();
  }
});

Deno.test("a pending claim that has gone stale is re-claimable", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals((await claim(db)).rows[0].claimed, true);

    // The stranded shape: claimed, never given a provider job id, isolate gone.
    await ageClaim(db, "11 minutes");

    const retry = await claim(db);
    assertEquals(retry.rows[0].claimed, true);
    assertEquals(retry.rows[0].status, "pending");
    assertEquals(retry.rows[0].provider_job_id, null);
  } finally {
    await db.close();
  }
});

Deno.test("a pending claim just inside the window is still not re-claimable", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals((await claim(db)).rows[0].claimed, true);
    await ageClaim(db, "9 minutes");
    assertEquals((await claim(db)).rows[0].claimed, false);
  } finally {
    await db.close();
  }
});

Deno.test("a ready row is never re-claimed, however old it is", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals((await claim(db)).rows[0].claimed, true);
    await db.query(
      `update chapter_audio
       set status = 'ready', storage_path = 'audio/x.mp3', generated_at = now(),
           updated_at = now() - interval '400 days'
       where chapter_id = $1 and voice_id = $2`,
      [CHAPTER, VOICE],
    );

    // Cached narration is permanent. Ageing must never cost a re-generation
    // of audio that already exists -- that would be paying twice for the same
    // file, which is the whole point of the cache.
    const retry = await claim(db);
    assertEquals(retry.rows[0].claimed, false);
    assertEquals(retry.rows[0].status, "ready");
  } finally {
    await db.close();
  }
});

Deno.test("a failed row is re-claimable immediately, as it always was", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals((await claim(db)).rows[0].claimed, true);
    await db.query(
      `update chapter_audio set status = 'failed', error_code = 'job_not_recorded'
       where chapter_id = $1 and voice_id = $2`,
      [CHAPTER, VOICE],
    );
    assertEquals((await claim(db)).rows[0].claimed, true);
  } finally {
    await db.close();
  }
});

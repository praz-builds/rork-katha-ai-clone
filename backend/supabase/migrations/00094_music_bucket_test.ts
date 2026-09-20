// 00094: the music bucket is public to read and closed to everyone's writes.
//
// The bucket DDL is the one part of this migration that does anything, and in
// the normal harness it is skipped -- `storage.buckets` is a Supabase platform
// table that bare Postgres does not have, so the migration takes its guard and
// returns. That guard is load-bearing (every other migration test depends on
// it), so it is tested both ways here: once with no storage schema, proving
// the migration still applies, and once against a stand-in storage schema,
// proving the bucket it creates is the one we meant.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";

const THIS_MIGRATION = "00094_music_bucket.sql";

async function applyThisMigration(db: PGlite) {
  const sql = await Deno.readTextFile(new URL(THIS_MIGRATION, import.meta.url));
  await db.exec(sql);
}

/**
 * A stand-in for the platform's storage schema: the two tables and the one
 * column set this migration touches. Enough to run the real DDL against, and
 * deliberately not a fuller imitation -- anything more would be asserting on
 * our copy of Supabase rather than on our migration.
 */
async function createStorageSchema(db: PGlite) {
  await db.exec(`
    create schema storage;
    create table storage.buckets(
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null,
      name text not null
    );
    alter table storage.objects enable row level security;
  `);
}

Deno.test("applies cleanly where there is no storage schema", async () => {
  const db = new PGlite();
  // No throw is the assertion: every other migration test runs the whole
  // chain against a database with no storage schema, and an unguarded
  // `insert into storage.buckets` here would break all of them at once.
  await applyThisMigration(db);
  await db.close();
});

Deno.test("creates a public music bucket with an audio-only size cap", async () => {
  const db = new PGlite();
  await createStorageSchema(db);
  await applyThisMigration(db);

  const bucket = await db.query<
    { public: boolean; file_size_limit: string; allowed_mime_types: string[] }
  >("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'music'");

  assertEquals(bucket.rows.length, 1);
  // Public read is the whole point: the app fetches these with no auth.
  assertEquals(bucket.rows[0].public, true);
  assertEquals(Number(bucket.rows[0].file_size_limit), 10485760);
  // An image or a video uploaded here would be served to readers as audio.
  assertEquals(bucket.rows[0].allowed_mime_types.sort(), [
    "audio/aac",
    "audio/mp4",
    "audio/mpeg",
  ]);

  await db.close();
});

Deno.test("is readable by anyone and writable by nobody but the service role", async () => {
  const db = new PGlite();
  await createStorageSchema(db);
  await applyThisMigration(db);

  const policies = await db.query<{ cmd: string; policyname: string }>(
    "select cmd, policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'",
  );

  // Exactly one policy, and it is a read. Nobody uploads music from the app:
  // the catalogue is ours and every track carries a licence we hold, so the
  // service role (which bypasses RLS) is the only writer. An insert or update
  // policy appearing here would mean a user JWT could put audio in front of
  // every reader.
  assertEquals(policies.rows.length, 1);
  assertEquals(policies.rows[0].cmd, "SELECT");
  assert(policies.rows[0].policyname.includes("Music"));

  await db.close();
});

Deno.test("can be applied twice without failing", async () => {
  // Migrations are replayed against databases that already have the bucket
  // (a re-run, a restored branch). The `on conflict do update` is what makes
  // that safe, and a second apply is the only way to prove it.
  const db = new PGlite();
  await createStorageSchema(db);
  await applyThisMigration(db);
  await applyThisMigration(db);

  const count = await db.query<{ n: string }>(
    "select count(*) as n from storage.buckets where id = 'music'",
  );
  assertEquals(Number(count.rows[0].n), 1);

  await db.close();
});

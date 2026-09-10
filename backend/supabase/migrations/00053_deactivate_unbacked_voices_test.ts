// A voice the system cannot generate must not be offered.
//
// `00048` seeded elvira and alvaro active, but their provider (`edge_tts`) is
// not implemented in this migration's historical context. `00059` reactivates
// them after the backend integration exists, so these tests now assert the
// registry rows survived and are active in the final schema.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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

// This test used to assert the opposite, because 00059 reactivated the pair on
// the expectation of an `EDGE_TTS_SERVICE_URL` worker. The worker was never
// deployed and the secret was never set, so between 00059 and 00063 the picker
// offered both Spanish voices, `ListenScreen` defaulted every Spanish story to
// Elvira, and every tap failed. 00063 put them back, and this is now the
// assertion that a fourth flip has to argue with.
Deno.test("the edge_tts voices stay hidden while nothing can speak with them", async () => {
  const db = await createDatabase();
  try {
    const offered = await db.query<{ id: string }>(
      "select id from public.voices where is_active = true order by id",
    );
    const ids = offered.rows.map((row) => row.id);
    assertEquals(ids.includes("elvira"), false, "elvira must not be offered");
    assertEquals(ids.includes("alvaro"), false, "alvaro must not be offered");

    // ...and hiding them must not empty the picker: the six RunPod voices
    // that do work are still offered.
    assertEquals(ids.length, 6);
  } finally {
    await db.close();
  }
});

Deno.test("the edge_tts voices keep their provider configuration", async () => {
  const db = await createDatabase();
  try {
    const kept = await db.query<{ id: string; provider: string }>(
      "select id, provider from public.voices where id in ('elvira','alvaro') order by id",
    );
    assertEquals(kept.rows.length, 2);
    assertEquals(kept.rows.every((row) => row.provider === "edge_tts"), true);
  } finally {
    await db.close();
  }
});

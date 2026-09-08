// A voice the system cannot generate must not be offered.
//
// `00048` seeded elvira and alvaro active, but their provider (`edge_tts`) is
// not implemented -- `_shared/edge-tts.ts` returns null unconditionally, so
// `generate-audio` answers a typed `edge_tts_not_implemented` for either. The
// picker offered two voices that always failed, for a reason the reader could
// neither understand nor act on.
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

Deno.test("the edge_tts voices are not offered while the provider is unimplemented", async () => {
  const db = await createDatabase();
  try {
    const offered = await db.query<{ id: string }>(
      "select id from public.voices where is_active = true order by id",
    );
    const ids = offered.rows.map((row) => row.id);
    assertEquals(ids.includes("elvira"), false, "elvira must not be offered");
    assertEquals(ids.includes("alvaro"), false, "alvaro must not be offered");

    // The English voices are untouched, so the picker still has something to
    // show. A fix that emptied the list would pass the assertions above.
    assertEquals(ids.length > 0, true);
  } finally {
    await db.close();
  }
});

Deno.test("the unbacked voices are deactivated rather than deleted", async () => {
  const db = await createDatabase();
  try {
    // The rows carry the provider parameters an edge_tts implementation will
    // need, and `chapter_audio` may already reference them. Deleting a registry
    // row to express "not yet" throws away the configuration with it.
    const kept = await db.query<{ id: string; provider: string }>(
      "select id, provider from public.voices where id in ('elvira','alvaro') order by id",
    );
    assertEquals(kept.rows.length, 2);
    assertEquals(kept.rows.every((row) => row.provider === "edge_tts"), true);
  } finally {
    await db.close();
  }
});

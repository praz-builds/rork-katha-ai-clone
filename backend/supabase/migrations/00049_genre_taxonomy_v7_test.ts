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

async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

async function insertWithGenre(
  db: PGlite,
  genre: string,
): Promise<string | null> {
  return await attempt(
    db,
    `insert into public.stories (title, genre, primary_genre)
     values ('Genre Check', array['${genre}'], '${genre}')`,
  );
}

const NEW_GENRES = ["educational", "fanfiction", "folktale", "sliceOfLife"];

// The seven genres removed from the UI, per source-of-truth/STORY_PROMPT_SYSTEM.md
// and AGENTS.md's taxonomy section. They must remain insertable: existing
// stories carry these values and the constraint must never reject them.
const REMOVED_FROM_UI_GENRES = [
  "romantasy",
  "darkRomance",
  "paranormalRomance",
  "cozyFantasy",
  "poetry",
  "thriller",
  "contemporary",
];

const UNCHANGED_UI_GENRES = [
  "romance",
  "fantasy",
  "scifi",
  "mystery",
  "horror",
  "historical",
  "adventure",
  "comedy",
];

Deno.test("each new v7 genre is accepted by the primary_genre check constraint", async () => {
  const db = await createDatabase();
  try {
    for (const genre of NEW_GENRES) {
      const error = await insertWithGenre(db, genre);
      assertEquals(error, null, `${genre} was rejected: ${error}`);
    }
  } finally {
    await db.close();
  }
});

Deno.test("every genre removed from the UI is still a valid stored value", async () => {
  const db = await createDatabase();
  try {
    for (const genre of REMOVED_FROM_UI_GENRES) {
      const error = await insertWithGenre(db, genre);
      assertEquals(error, null, `${genre} was rejected: ${error}`);
    }
  } finally {
    await db.close();
  }
});

Deno.test("every genre unaffected by the v7 change is still a valid stored value", async () => {
  const db = await createDatabase();
  try {
    for (const genre of UNCHANGED_UI_GENRES) {
      const error = await insertWithGenre(db, genre);
      assertEquals(error, null, `${genre} was rejected: ${error}`);
    }
  } finally {
    await db.close();
  }
});

Deno.test("the constraint still rejects a genre outside the full taxonomy", async () => {
  const db = await createDatabase();
  try {
    const error = await insertWithGenre(db, "notARealGenre");
    // 23514 = check_violation
    assertEquals(error, "23514");
  } finally {
    await db.close();
  }
});

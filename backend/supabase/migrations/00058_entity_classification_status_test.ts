import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

/**
 * The same harness every migration test in this directory uses: every
 * migration applied in order against a real Postgres, so a constraint is
 * asserted as it will actually behave rather than as it reads.
 */
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

const AUTHOR = "00000000-0000-4000-8000-000000000581";

async function seedStory(db: PGlite, id: string, status: string | null) {
  await db.query(
    `insert into stories
       (id, author_id, title, genre, primary_genre, entity_classification_status)
     values ($1, $2, 'Story', array['historical'], 'historical', $3)`,
    [id, AUTHOR, status],
  );
}

Deno.test("a story records whether its entity classification ever answered", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [AUTHOR]);
    await db.query("insert into profiles(id, username) values ($1, $2)", [
      AUTHOR,
      "classification_author",
    ]);

    // The three legal states, and the distinction the whole migration exists
    // for: 'ok' with a null gate reason means "checked, names nobody", while
    // 'unavailable' means "not checked" - values that used to be the same
    // null and were therefore both read as permission to publish.
    await seedStory(db, "00000000-0000-4000-8000-000000000582", "ok");
    await seedStory(db, "00000000-0000-4000-8000-000000000583", "unavailable");
    await seedStory(db, "00000000-0000-4000-8000-000000000584", null);

    const rows = await db.query<
      { entity_classification_status: string | null }
    >(
      "select entity_classification_status from stories order by id",
    );
    assertEquals(rows.rows.map((r) => r.entity_classification_status), [
      "ok",
      "unavailable",
      null,
    ]);

    // Nothing else. A third word here would be a state `publish-story` has no
    // branch for, and its fallthrough is "publish".
    const code = await attempt(
      db,
      `insert into stories
         (id, author_id, title, genre, primary_genre, entity_classification_status)
       values ('00000000-0000-4000-8000-000000000585', '${AUTHOR}', 'S',
               array['historical'], 'historical', 'pending')`,
    );
    assertEquals(code, "23514");

    // Legacy rows stay null rather than being backfilled to 'unavailable':
    // they predate the column, and calling them unchecked would lock the
    // existing corpus out of publishing.
    const legacy = await db.query<{ count: string }>(
      "select count(*)::text as count from stories where entity_classification_status is null",
    );
    assertEquals(legacy.rows[0].count, "1");
  } finally {
    await db.close();
  }
});

Deno.test("the grounding bucket can actually be written to error_events", async () => {
  const db = await createDatabase();
  try {
    // Telemetry for a silently-failing safety control that is itself silently
    // rejected by a CHECK is worse than none: it reads, in code, as though
    // the failure is being recorded. 'engagement' and 'phrase.learning' have
    // been in the TypeScript union since 00046/00047 and were never added
    // here, so every row those paths wrote was discarded.
    for (const bucket of ["grounding", "engagement", "phrase.learning"]) {
      const code = await attempt(
        db,
        `insert into error_events(bucket, source, message)
         values ('${bucket}', 'runtime', 'test')`,
      );
      assertEquals(code, null, `bucket ${bucket} must be insertable`);
    }

    // The allow-list is still an allow-list.
    assertEquals(
      await attempt(
        db,
        `insert into error_events(bucket, source, message)
         values ('made.up', 'runtime', 'test')`,
      ),
      "23514",
    );

    const rows = await db.query<{ count: string }>(
      "select count(*)::text as count from error_events where bucket = 'grounding'",
    );
    assert(Number(rows.rows[0].count) >= 1);
  } finally {
    await db.close();
  }
});

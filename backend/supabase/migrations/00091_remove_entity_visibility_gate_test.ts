// 00091: the entity visibility gate is gone, and a named cast publishes.
//
// Executed against real SQL, like every migration test here. The first test
// stops one migration short, seeds a row the way the gate left it, and only
// then applies 00091 -- because "clears every gated row" cannot be proved on a
// database where no gated row ever existed.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

const THIS_MIGRATION = "00091_remove_entity_visibility_gate.sql";

/** Every migration in order, optionally stopping before `stopBefore`. */
async function createDatabase(stopBefore?: string) {
  const db = new PGlite({ extensions: { pg_trgm } });
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

  const migrations: string[] = [];
  for await (const entry of Deno.readDir(new URL(".", import.meta.url))) {
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) {
      migrations.push(entry.name);
    }
  }
  migrations.sort();
  for (const migration of migrations) {
    if (stopBefore && migration >= stopBefore) break;
    await applyMigration(db, migration);
  }
  return db;
}

async function applyMigration(db: PGlite, migration: string) {
  const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
  await db.exec(sql.replace(/create index concurrently/gi, "create index"));
}

async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const AUTHOR = "00000000-0000-4000-8000-000000000911";
const READER = "00000000-0000-4000-8000-000000000912";
const NAMED_CAST = "00000000-0000-4000-8000-0000000009b1";

async function seedPeople(db: PGlite) {
  for (const [id, username] of [[AUTHOR, "cast_author"], [READER, "reader"]]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query(
      "insert into profiles(id, username) values ($1, $2) on conflict (id) do update set username = excluded.username",
      [id, username],
    );
  }
}

Deno.test("a row the gate kept private is cleared, stays private, and can then be published", async () => {
  const db = await createDatabase(THIS_MIGRATION);
  try {
    await seedPeople(db);
    // How 00050 left a story whose character sheet named Aarav: private, with
    // the reason set, and unpublishable.
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, status,
                            is_public, entity_gate_reason)
       values ($1, $2, 'The Corner Table', array['romance'], 'romance',
               'complete', false, 'private_individual')`,
      [NAMED_CAST, AUTHOR],
    );
    assertEquals(
      await attempt(
        db,
        `update stories set is_public = true where id = '${NAMED_CAST}'`,
      ),
      "23514",
      "precondition: before 00091 the gate refuses this write",
    );

    await applyMigration(db, THIS_MIGRATION);

    const cleared = await db.query<
      { is_public: boolean; reason: string | null }
    >(
      "select is_public, entity_gate_reason as reason from stories where id = $1",
      [NAMED_CAST],
    );
    assertEquals(cleared.rows[0].reason, null);
    // The migration publishes nothing on anybody's behalf.
    assertEquals(cleared.rows[0].is_public, false);

    // The writer's toggle now works.
    assertEquals(
      await attempt(
        db,
        `update stories set is_public = true where id = '${NAMED_CAST}'`,
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("both 00050 constraints are gone and the column is kept for older clients", async () => {
  const db = await createDatabase();
  try {
    const constraints = await db.query<{ conname: string }>(
      `select conname from pg_constraint
       where conrelid = 'public.stories'::regclass
         and conname in ('stories_entity_gate_forces_private',
                         'stories_entity_gate_reason_is_valid')`,
    );
    assertEquals(constraints.rows, []);

    // Still selectable, still nullable: an old build that asks for it gets a
    // null rather than an unknown-column error.
    const column = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'stories'
         and column_name = 'entity_gate_reason'`,
    );
    assertEquals(column.rows, [{ is_nullable: "YES" }]);
  } finally {
    await db.close();
  }
});

Deno.test("a public named-cast story counts on its writer's public profile", async () => {
  const db = await createDatabase();
  try {
    await seedPeople(db);
    // Inserted public directly: with the constraint gone this is simply a
    // public story, whatever its cast was classified as.
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, status,
                            is_public, content_rating, read_count, like_count,
                            grounding_entities)
       values ($1, $2, 'The Corner Table', array['romance'], 'romance',
               'complete', true, 'sweet', 40, 4,
               '[{"surface": "Aarav", "entityClass": "private_individual"}]'::jsonb)`,
      [NAMED_CAST, AUTHOR],
    );
    await db.query(
      "insert into comments (user_id, story_id, content) values ($1, $2, 'Loved the chai scene')",
      [AUTHOR, NAMED_CAST],
    );

    const profile = await db.query<Record<string, unknown>>(
      "select * from public_profile($1, $2)",
      [AUTHOR, READER],
    );
    assertEquals(profile.rows[0].stories_published, 1);
    assertEquals(profile.rows[0].total_reads, 40);
    assertEquals(profile.rows[0].total_likes, 4);

    const comments = await db.query<{ story_id: string }>(
      "select story_id from profile_comments($1)",
      [AUTHOR],
    );
    assertEquals(comments.rows.map((r) => r.story_id), [NAMED_CAST]);
  } finally {
    await db.close();
  }
});

Deno.test("no profile function still filters on the removed gate", async () => {
  const db = await createDatabase();
  try {
    for (
      const signature of [
        "public.public_profile(uuid, uuid)",
        "public.profile_comments(uuid, integer)",
        "public.activity_calendar(uuid, integer, uuid)",
      ]
    ) {
      const def = await db.query<{ body: string }>(
        `select pg_get_functiondef('${signature}'::regprocedure) as body`,
      );
      assert(
        !def.rows[0].body.includes("entity_gate_reason"),
        `${signature} still reads entity_gate_reason`,
      );
      // And the grant posture those functions have always had survives the
      // re-issue: service role only.
      const granted = await db.query<{ ok: boolean }>(
        `select has_function_privilege('authenticated', '${signature}', 'execute') as ok`,
      );
      assertEquals(granted.rows[0].ok, false);
    }
  } finally {
    await db.close();
  }
});

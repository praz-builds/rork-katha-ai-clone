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

const AUTHOR = "00000000-0000-4000-8000-000000000501";

async function seedAuthor(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [AUTHOR]);
  await db.query("insert into profiles(id, username) values ($1, $2)", [
    AUTHOR,
    "gate_author",
  ]);
}

async function insertStory(
  db: PGlite,
  id: string,
  overrides: { entityGateReason?: string | null; isPublic?: boolean } = {},
): Promise<string | null> {
  const reasonLiteral = overrides.entityGateReason
    ? `'${overrides.entityGateReason}'`
    : "null";
  const isPublicLiteral = overrides.isPublic ?? false;
  return await attempt(
    db,
    `insert into stories
       (id, author_id, title, genre, primary_genre, is_public, entity_gate_reason)
     values (
       '${id}', '${AUTHOR}', 'Gate Check', array['historical'], 'historical',
       ${isPublicLiteral}, ${reasonLiteral}
     )`,
  );
}

Deno.test("a story starts with no gate, and the column accepts only the two real reasons", async () => {
  const db = await createDatabase();
  try {
    await seedAuthor(db);
    const id = "00000000-0000-4000-8000-000000000510";
    assertEquals(await insertStory(db, id), null);

    const row = await db.query<{ reason: string | null }>(
      "select entity_gate_reason as reason from stories where id = $1",
      [id],
    );
    assertEquals(row.rows[0].reason, null);

    assertEquals(
      await attempt(
        db,
        `update stories set entity_gate_reason = 'not_a_real_reason' where id = '${id}'`,
      ),
      "23514",
    );
    assertEquals(
      await attempt(
        db,
        `update stories set entity_gate_reason = 'living_public_figure' where id = '${id}'`,
      ),
      null,
    );
    assertEquals(
      await attempt(
        db,
        `update stories set entity_gate_reason = 'private_individual' where id = '${id}'`,
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a gated story cannot be made public at the database layer, whoever tries", async () => {
  const db = await createDatabase();
  try {
    await seedAuthor(db);

    const gatedPrivate = "00000000-0000-4000-8000-000000000511";
    assertEquals(
      await insertStory(db, gatedPrivate, {
        entityGateReason: "living_public_figure",
        isPublic: false,
      }),
      null,
    );

    // The direct write a client could make through the `authenticated`
    // UPDATE (is_public) grant from migration 00015 - this is the path a
    // single Edge Function's application-level check cannot close by itself.
    assertEquals(
      await attempt(
        db,
        `update stories set is_public = true where id = '${gatedPrivate}'`,
      ),
      "23514",
    );

    // Inserting a row already public and already gated must fail the same way.
    const bornGated = "00000000-0000-4000-8000-000000000512";
    assertEquals(
      await insertStory(db, bornGated, {
        entityGateReason: "private_individual",
        isPublic: true,
      }),
      "23514",
    );
  } finally {
    await db.close();
  }
});

Deno.test("an ungated story publishes exactly as before", async () => {
  const db = await createDatabase();
  try {
    await seedAuthor(db);
    const id = "00000000-0000-4000-8000-000000000513";
    assertEquals(await insertStory(db, id, { isPublic: false }), null);
    assertEquals(
      await attempt(
        db,
        `update stories set is_public = true where id = '${id}'`,
      ),
      null,
    );
    const row = await db.query<{ is_public: boolean }>(
      "select is_public from stories where id = $1",
      [id],
    );
    assertEquals(row.rows[0].is_public, true);
  } finally {
    await db.close();
  }
});

Deno.test("a story already public before this migration is never retroactively touched", async () => {
  const db = await createDatabase();
  try {
    await seedAuthor(db);
    // Simulates a row that existed before entity_gate_reason did: public,
    // and the column left at its default (null).
    const id = "00000000-0000-4000-8000-000000000514";
    assertEquals(await insertStory(db, id, { isPublic: true }), null);

    const row = await db.query<
      { is_public: boolean; reason: string | null }
    >(
      "select is_public, entity_gate_reason as reason from stories where id = $1",
      [id],
    );
    assertEquals(row.rows[0].is_public, true);
    assertEquals(row.rows[0].reason, null);
  } finally {
    await db.close();
  }
});

Deno.test("entity_gate_reason is not reachable by the owner-update grant", async () => {
  const db = await createDatabase();
  try {
    const granted = await db.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'stories'
         and grantee = 'authenticated' and privilege_type = 'UPDATE'
         and column_name = 'entity_gate_reason'`,
    );
    // Server-derived, like grounding and grounding_entities: a client that
    // could clear this column could publish the exact story it exists to keep
    // private.
    assertEquals(granted.rows, []);
  } finally {
    await db.close();
  }
});

Deno.test("the two check constraints are independent: reason validity and the privacy rule", async () => {
  const db = await createDatabase();
  try {
    await seedAuthor(db);
    // A syntactically valid reason with is_public left false must succeed -
    // the forces-private constraint only ever rejects the public direction.
    const id = "00000000-0000-4000-8000-000000000515";
    assertEquals(
      await insertStory(db, id, {
        entityGateReason: "living_public_figure",
        isPublic: false,
      }),
      null,
    );
    assert(true);
  } finally {
    await db.close();
  }
});

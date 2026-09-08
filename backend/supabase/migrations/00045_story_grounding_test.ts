import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";
import {
  ENTITY_CLASSES,
  GROUNDING_TTL_DAYS,
  groundingCacheKey,
  SEARCHABLE_ENTITY_CLASSES,
} from "../functions/_shared/grounding-types.ts";

/**
 * The same harness 00043's companion test uses: every migration applied in
 * order against a real Postgres, so a constraint or a grant is asserted as it
 * will actually behave rather than as it reads.
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

/** Report the SQLSTATE of a failing statement, or null when it succeeds. */
async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const AUTHOR = "00000000-0000-4000-8000-000000000451";
const STORY = "00000000-0000-4000-8000-000000000450";

async function seedStory(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [AUTHOR]);
  await db.query("insert into profiles(id, username) values ($1, $2)", [
    AUTHOR,
    "grounding_author",
  ]);
  await db.query(
    `insert into stories (id, author_id, title, genre, primary_genre, is_public)
     values ($1, $2, 'Grounded Story', array['historical'], 'historical', true)`,
    [STORY, AUTHOR],
  );
}

Deno.test("a story starts with empty grounding, and both columns must be arrays", async () => {
  const db = await createDatabase();
  try {
    await seedStory(db);

    const row = await db.query<{ grounding: unknown; entities: unknown }>(
      "select grounding, grounding_entities as entities from stories where id = $1",
      [STORY],
    );
    assertEquals(row.rows[0].grounding, []);
    assertEquals(row.rows[0].entities, []);

    // A jsonb column with no shape constraint accepts a string or an object,
    // and every consumer then defends against shapes it will never see.
    assertEquals(
      await attempt(
        db,
        `update stories set grounding = '{"a":1}'::jsonb where id = '${STORY}'`,
      ),
      "23514",
    );
    assertEquals(
      await attempt(
        db,
        `update stories set grounding_entities = '"x"'::jsonb where id = '${STORY}'`,
      ),
      "23514",
    );
    assertEquals(
      await attempt(
        db,
        `update stories set grounding = '[{"canonicalName":"x"}]'::jsonb where id = '${STORY}'`,
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("neither grounding column is reachable by the owner-update grant", async () => {
  const db = await createDatabase();
  try {
    await seedStory(db);
    const granted = await db.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'stories'
         and grantee = 'authenticated' and privilege_type = 'UPDATE'
         and column_name in ('grounding', 'grounding_entities')`,
    );
    // `grounding` is interpolated into a story prompt on every continuation, so
    // a client-writable column would be a free channel into the generator's
    // system message on a paid path.
    assertEquals(granted.rows, []);
  } finally {
    await db.close();
  }
});

Deno.test("the cache key is derived, and matches the TypeScript rule", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `select entity_grounding_upsert($1, $2, $3::jsonb, $4)`,
      [
        "  Shivaji   MAHARAJ. ",
        "historical_public_figure",
        JSON.stringify({ canonicalName: "Chhatrapati Shivaji Maharaj" }),
        "model_knowledge",
      ],
    );

    const row = await db.query<{ cache_key: string }>(
      "select cache_key from entity_grounding",
    );
    assertEquals(
      row.rows[0].cache_key,
      "shivaji maharaj:historical_public_figure",
    );
    // The SQL and the TypeScript must agree, or the cache silently halves its
    // hit rate and writes duplicate rows nobody notices.
    assertEquals(
      row.rows[0].cache_key,
      groundingCacheKey("  Shivaji   MAHARAJ. ", "historical_public_figure"),
    );

    // Diacritics survive on both sides: folding them collides names that are
    // genuinely different.
    const accented = await db.query<{ key: string }>(
      "select entity_grounding_key($1, $2) as key",
      ["Malmö", "real_place"],
    );
    assertEquals(
      accented.rows[0].key,
      groundingCacheKey("Malmö", "real_place"),
    );
    assert(!accented.rows[0].key.startsWith("malmo:"));
  } finally {
    await db.close();
  }
});

Deno.test("a spelling variant refreshes the one row rather than adding another", async () => {
  const db = await createDatabase();
  try {
    for (
      const name of ["Shivaji Maharaj", "shivaji  maharaj", "Shivaji-Maharaj"]
    ) {
      await db.query(
        `select entity_grounding_upsert($1, $2, $3::jsonb, $4)`,
        [
          name,
          "historical_public_figure",
          JSON.stringify({ canonicalName: name }),
          "model_knowledge",
        ],
      );
    }

    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from entity_grounding",
    );
    assertEquals(count.rows[0].n, 1);

    // Last writer wins: two generations racing on the same entity have each
    // produced a valid card, and the loser's work is simply discarded.
    const row = await db.query<{ canonical_name: string }>(
      "select canonical_name from entity_grounding",
    );
    assertEquals(row.rows[0].canonical_name, "Shivaji-Maharaj");
  } finally {
    await db.close();
  }
});

Deno.test("expiry is computed by class, and mirrors the TypeScript TTLs", async () => {
  const db = await createDatabase();
  try {
    for (const entityClass of SEARCHABLE_ENTITY_CLASSES) {
      await db.query(
        `select entity_grounding_upsert($1, $2, '{}'::jsonb, 'model_knowledge')`,
        [`Entity ${entityClass}`, entityClass],
      );
    }

    const rows = await db.query<{ entity_class: string; days: number }>(
      `select entity_class,
              round(extract(epoch from (expires_at - created_at)) / 86400)::int as days
       from entity_grounding`,
    );
    for (const row of rows.rows) {
      assertEquals(
        row.days,
        GROUNDING_TTL_DAYS[row.entity_class as keyof typeof GROUNDING_TTL_DAYS],
        `${row.entity_class} TTL disagrees with GROUNDING_TTL_DAYS`,
      );
    }
    assertEquals(rows.rows.length, SEARCHABLE_ENTITY_CLASSES.size);
  } finally {
    await db.close();
  }
});

Deno.test("a private individual cannot be cached, and nor can a fictional one", async () => {
  const db = await createDatabase();
  try {
    // The rows here are shared across the whole corpus. A row for a private
    // individual would be one user's private story idea, cached for everyone.
    for (const entityClass of ENTITY_CLASSES) {
      const code = await attempt(
        db,
        `select entity_grounding_upsert('Someone', '${entityClass}', '{}'::jsonb, 'model_knowledge')`,
      );
      const expected = SEARCHABLE_ENTITY_CLASSES.has(entityClass)
        ? null
        : "23514";
      assertEquals(code, expected, entityClass);
    }
  } finally {
    await db.close();
  }
});

Deno.test("lookup applies expiry itself, so no caller can forget it", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `select entity_grounding_upsert('Taylor Swift', 'living_public_figure', $1::jsonb, 'model_knowledge')`,
      [JSON.stringify({ canonicalName: "Taylor Swift" })],
    );

    const hit = await db.query<{ card: { canonicalName: string } | null }>(
      "select entity_grounding_lookup('taylor  swift', 'living_public_figure') as card",
    );
    assertEquals(hit.rows[0].card?.canonicalName, "Taylor Swift");

    // A two-year-old card about a living person reads exactly like a fresh one
    // and is instructed to the generator as true.
    await db.query(
      "update entity_grounding set expires_at = now() - interval '1 day'",
    );
    const miss = await db.query<{ card: unknown }>(
      "select entity_grounding_lookup('Taylor Swift', 'living_public_figure') as card",
    );
    assertEquals(miss.rows[0].card, null);

    const pruned = await db.query<{ n: number }>(
      "select entity_grounding_prune() as n",
    );
    assertEquals(pruned.rows[0].n, 1);
  } finally {
    await db.close();
  }
});

Deno.test("the cache is service-role only, with RLS enabled behind it", async () => {
  const db = await createDatabase();
  try {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'entity_grounding'",
    );
    assertEquals(rls.rows[0].relrowsecurity, true);

    // A client that could read this cache could enumerate which real people
    // other users' private story ideas have named.
    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.table_privileges
       where table_schema = 'public' and table_name = 'entity_grounding'
         and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );
    assertEquals(grants.rows, []);

    // service_role bypasses RLS but is still subject to table privileges, and
    // those are two different gates - the lesson 00042 paid for.
    const service = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.table_privileges
       where table_schema = 'public' and table_name = 'entity_grounding'
         and grantee = 'service_role'
       order by privilege_type`,
    );
    assertEquals(
      service.rows.map((row) => row.privilege_type),
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
    );
  } finally {
    await db.close();
  }
});

// A name is not an identity.
//
// The cache key was the normalized name alone, so a card about Washington the
// person and a card about Washington the place resolved to the same row: the
// second upsert silently overwrote the first, and every later lookup answered
// with facts about the wrong kind of thing. The card is well-formed on the way
// into the prompt, which is what makes this the worst place for a collision to
// hide in a system whose whole job is factual accuracy.
Deno.test("two entities sharing a name do not share a cache row", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `select entity_grounding_upsert('Washington', 'historical_public_figure', $1::jsonb, 'model_knowledge')`,
      [JSON.stringify({ canonicalName: "Washington", kind: "person" })],
    );
    await db.query(
      `select entity_grounding_upsert('Washington', 'real_place', $1::jsonb, 'model_knowledge')`,
      [JSON.stringify({ canonicalName: "Washington", kind: "real_place" })],
    );

    const rows = await db.query<{ n: number }>(
      "select count(*)::int as n from entity_grounding",
    );
    assertEquals(rows.rows[0].n, 2, "the two entities must not collide");

    const person = await db.query<{ card: { kind: string } | null }>(
      "select entity_grounding_lookup('Washington', 'historical_public_figure') as card",
    );
    assertEquals(person.rows[0].card?.kind, "person");

    const place = await db.query<{ card: { kind: string } | null }>(
      "select entity_grounding_lookup('Washington', 'real_place') as card",
    );
    assertEquals(place.rows[0].card?.kind, "real_place");
  } finally {
    await db.close();
  }
});

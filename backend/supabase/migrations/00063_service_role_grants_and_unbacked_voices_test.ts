// 00063: the grants the feed, saved characters and the subscription refresh
// were failing on, and the two voices that were offered with nothing behind
// them.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
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

// The defect: 00012 recorded that this project has no default privileges, so
// every table created after it needs its own grant -- and 00026, 00043 and
// 00057 each added a table that an edge function reads with the service role
// and none of them granted it. On production that returned 42501, which the
// feed turned into a 500 for every user on every request.
Deno.test("service_role can read the three tables its functions actually read", async () => {
  const db = await createDatabase();
  try {
    for (
      const table of [
        "user_blocks",
        "user_characters",
        "revenuecat_subscriptions",
      ]
    ) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_table_privilege('service_role', $1, 'SELECT') as ok`,
        [`public.${table}`],
      );
      assertEquals(rows[0].ok, true, `service_role cannot SELECT ${table}`);
    }
  } finally {
    await db.close();
  }
});

// Least privilege is the other half: the rate-limit tables are reached only
// through SECURITY DEFINER functions, which execute as the owner. Granting
// those to service_role would widen the blast radius to fix a problem they do
// not have.
Deno.test("the rate-limit tables stay unreadable by every client role and by service_role", async () => {
  const db = await createDatabase();
  try {
    const tables = [
      "anonymous_bootstrap_rate_limits",
      "story_shape_rate_limits",
      "character_portrait_rate_limits",
    ];
    for (const table of tables) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const { rows } = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, $2, 'SELECT') as ok`,
          [role, `public.${table}`],
        );
        assertEquals(rows[0].ok, false, `${role} should not read ${table}`);
      }
    }
  } finally {
    await db.close();
  }
});

// 00053 hid these because the provider was a stub; 00059 un-hid them for a
// worker that was never deployed, and every Spanish reader got a voice that
// could not speak. The runtime check in `_shared/voices.ts` is what stops a
// fourth round of this, but the rows must be correct in their own right.
Deno.test("no voice is active unless something can speak with it", async () => {
  const db = await createDatabase();
  try {
    const { rows } = await db.query<{ id: string; provider: string }>(
      `select id, provider from public.voices where is_active and provider = 'edge_tts'`,
    );
    assertEquals(
      rows,
      [],
      "an edge_tts voice is active with no worker deployed",
    );

    const { rows: live } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.voices where is_active`,
    );
    assert(
      live[0].count > 0,
      "deactivating the pair must not empty the picker",
    );
  } finally {
    await db.close();
  }
});

// 00067: only the server creates a profile row.
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

// The window: 00013 dropped the signup trigger, so a profile does not exist
// until `bootstrap-user` upserts it. 00002's insert policy plus 00012's
// table-level grant let the account fill that gap itself, writing the exact
// columns 00038 and 00060 spent two migrations taking away from UPDATE --
// `avatar_url` (rendered on every byline the user appears on), `referred_by`
// and `account_created_at`. Bootstrap's `ignoreDuplicates` upsert then no-ops
// and the row stands.
Deno.test("an account cannot insert its own profile row", async () => {
  const db = await createDatabase();
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('authenticated', 'public.profiles', 'INSERT') as ok`,
    );
    assertEquals(
      rows[0].ok,
      false,
      "authenticated still holds INSERT on profiles",
    );

    const { rows: policies } = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT'`,
    );
    assertEquals(policies, [], "an INSERT policy on profiles still exists");
  } finally {
    await db.close();
  }
});

// The service role creates the row, and must keep being able to.
Deno.test("the server can still create a profile", async () => {
  const db = await createDatabase();
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('service_role', 'public.profiles', 'INSERT') as ok`,
    );
    assertEquals(
      rows[0].ok,
      true,
      "bootstrap-user can no longer create profiles",
    );
  } finally {
    await db.close();
  }
});

// The owner keeps every write they are supposed to have. Taking INSERT away
// must not have taken the profile screen with it.
Deno.test("the owner keeps the narrow update they are meant to have", async () => {
  const db = await createDatabase();
  try {
    // 00060 revoked table-level UPDATE and granted it back on three columns
    // only, so the privilege is per-column and `has_table_privilege` is the
    // wrong question to ask.
    for (const column of ["onboarding_purpose", "preferred_genres", "bio"]) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_column_privilege('authenticated', 'public.profiles', $1, 'UPDATE') as ok`,
        [column],
      );
      assertEquals(rows[0].ok, true, `the owner can no longer edit ${column}`);
    }
    // And the columns the server owns stay the server's.
    for (
      const column of [
        "avatar_url",
        "username",
        "referred_by",
        "account_created_at",
      ]
    ) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_column_privilege('authenticated', 'public.profiles', $1, 'UPDATE') as ok`,
        [column],
      );
      assertEquals(rows[0].ok, false, `${column} is writable by its owner`);
    }

    for (const fn of ["claim_username", "set_avatar"]) {
      const { rows: exists } = await db.query<{ count: number }>(
        `select count(*)::int as count from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [fn],
      );
      assertEquals(exists[0].count > 0, true, `${fn} is missing`);
    }
  } finally {
    await db.close();
  }
});

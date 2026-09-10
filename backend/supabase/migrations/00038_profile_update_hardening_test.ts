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

const OWNER = "00000000-0000-4000-8000-000000000381";
const VICTIM = "00000000-0000-4000-8000-000000000382";
const UNCLAIMED = "00000000-0000-4000-8000-000000000383";

async function seed(db: PGlite) {
  for (const id of [OWNER, VICTIM, UNCLAIMED]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
  }
  await db.query("insert into profiles(id, username) values ($1, 'owner')", [
    OWNER,
  ]);
  await db.query("insert into profiles(id, username) values ($1, 'victim')", [
    VICTIM,
  ]);
  await db.exec(`
    set request.jwt.claim.sub = '${OWNER}';
    set role authenticated;
  `);
}

/** Run a statement as the signed-in owner and report the error code, or null on success. */
async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

Deno.test("a profile owner may edit the fields the product exposes", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals(
      await attempt(
        db,
        `update profiles set onboarding_purpose = 'casual',
           preferred_genres = array['romance'], bio = 'Writes at night.'
         where id = '${OWNER}'`,
      ),
      null,
    );
    await db.exec("reset role;");
    const row = await db.query<{ bio: string }>(
      "select bio from profiles where id = $1",
      [OWNER],
    );
    assertEquals(row.rows[0].bio, "Writes at night.");
  } finally {
    await db.close();
  }
});

Deno.test("the handle and the avatar left the owner's own grant", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    // Both were in this migration's grant and migration 00060 took them out,
    // because both became server-derived when the profile became editable:
    // `username` is claimed through `claim_username` so a lost race can be
    // reported as "taken" rather than a raw 23505, and `avatar_url` must
    // address an object in our own bucket rather than any URL on the internet.
    // A direct UPDATE would route around both, so the privilege is gone.
    for (
      const statement of [
        `update profiles set username = 'renamed' where id = '${OWNER}'`,
        `update profiles set avatar_url = 'https://tracker.test/pixel.gif' where id = '${OWNER}'`,
      ]
    ) {
      assertEquals(await attempt(db, statement), "42501", statement);
    }
  } finally {
    await db.close();
  }
});

Deno.test("a profile owner cannot rewrite their row into somebody else's identity", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    // 42501 is insufficient_privilege: WITH CHECK rejects the post-update row.
    // Without it, this statement succeeded and the victim's auth.users row was
    // left pointing at a profile they no longer controlled.
    assertEquals(
      await attempt(
        db,
        `update profiles set id = '${UNCLAIMED}' where id = '${OWNER}'`,
      ),
      "42501",
    );

    await db.exec("reset role;");
    const rows = await db.query<{ count: number }>(
      "select count(*)::int as count from profiles where id = $1",
      [OWNER],
    );
    assertEquals(rows.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

Deno.test("the anti-fraud columns are not writable by their subject", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (
      const statement of [
        `update profiles set referred_by = '${VICTIM}' where id = '${OWNER}'`,
        `update profiles set first_generation_at = now() where id = '${OWNER}'`,
        `update profiles set account_created_at = now() - interval '1 year' where id = '${OWNER}'`,
      ]
    ) {
      assertEquals(await attempt(db, statement), "42501", statement);
    }
  } finally {
    await db.close();
  }
});

Deno.test("another user's profile stays out of reach", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // RLS filters the row out rather than raising, so the write is a no-op.
    // Written against `bio` rather than `username` since 00060: the handle is
    // no longer in the owner's grant at all, so a `username` write would fail
    // on the privilege and never reach the policy this test is about.
    assertEquals(
      await attempt(
        db,
        `update profiles set bio = 'stolen' where id = '${VICTIM}'`,
      ),
      null,
    );
    await db.exec("reset role;");
    const row = await db.query<{ bio: string | null }>(
      "select bio from profiles where id = $1",
      [VICTIM],
    );
    assertEquals(row.rows[0].bio, null);
  } finally {
    await db.close();
  }
});

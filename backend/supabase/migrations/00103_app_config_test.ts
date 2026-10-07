// 00103: the remote app-version switch.
//
// What is under test, and why:
//   - anyone, signed in or not, can READ the row: the app checks it at launch
//     before any session exists, so a grant missing for `anon` would make
//     every check fail silently and the switch would never fire;
//   - nobody but the service role can WRITE it: a client that could lower
//     `minimum_supported_version` could unblock itself, and one that could
//     raise it could lock every user out;
//   - the seed is the first shipped build (1.0.1) for both versions, so a
//     fresh deploy forces and offers nothing;
//   - a malformed version is refused at the table, so the client never has to
//     guess what "1.x" means;
//   - `updated_at` moves on change, so "when was this raised" is answerable.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function createDatabase() {
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
    if (entry.isFile && /^\d+.*\.sql$/.test(entry.name)) migrations.push(entry.name);
  }
  migrations.sort();
  for (const migration of migrations) {
    const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  await db.exec("grant usage on schema public to anon, authenticated, service_role");
  return db;
}

Deno.test("anon and authenticated can read the switch; the seed forces nothing", async () => {
  const db = await createDatabase();
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    const rows = await db.query<{
      platform: string;
      minimum_supported_version: string;
      latest_version: string;
      store_url: string;
    }>("select platform, minimum_supported_version, latest_version, store_url from public.app_config");
    assertEquals(rows.rows.length, 1);
    assertEquals(rows.rows[0].platform, "android");
    assertEquals(rows.rows[0].minimum_supported_version, "1.0.1");
    assertEquals(rows.rows[0].latest_version, "1.0.1");
    assert(rows.rows[0].store_url.includes("id=ai.katha.createstories"));
    await db.exec("reset role");
  }
});

Deno.test("only the service role can change the switch", async () => {
  const db = await createDatabase();
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assertRejects(() =>
      db.query("update public.app_config set minimum_supported_version = '0.0.1'")
    );
    await assertRejects(() =>
      db.query(
        "insert into public.app_config(platform, minimum_supported_version, latest_version, store_url) values ('ios','1.0.0','1.0.0','https://apps.apple.com/')",
      )
    );
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  await db.query("update public.app_config set minimum_supported_version = '1.2.0', latest_version = '1.4.0' where platform = 'android'");
  await db.exec("reset role");
  const after = await db.query<{ minimum_supported_version: string }>(
    "select minimum_supported_version from public.app_config where platform = 'android'",
  );
  assertEquals(after.rows[0].minimum_supported_version, "1.2.0");
});

Deno.test("a malformed version or a non-https store link is refused", async () => {
  const db = await createDatabase();
  for (const bad of ["1.x", "v1.2.0", "", "1..2"]) {
    await assertRejects(() =>
      db.query("update public.app_config set minimum_supported_version = $1", [bad])
    );
  }
  await assertRejects(() =>
    db.query("update public.app_config set store_url = 'market://details?id=x'")
  );
  await db.query("update public.app_config set latest_version = '1.10.0'");
});

Deno.test("updated_at moves when the switch changes", async () => {
  const db = await createDatabase();
  await db.query("update public.app_config set updated_at = '2000-01-01'");
  await db.query("update public.app_config set latest_version = '1.0.2'");
  const row = await db.query<{ updated_at: Date }>("select updated_at from public.app_config");
  assert(new Date(row.rows[0].updated_at).getFullYear() > 2000);
});

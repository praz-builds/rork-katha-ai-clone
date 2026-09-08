import {
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

async function makeUser(
  db: Awaited<ReturnType<typeof createDatabase>>,
  userId: string,
) {
  await db.query("insert into auth.users(id) values ($1)", [userId]);
  await db.query("insert into profiles(id) values ($1)", [userId]);
}

Deno.test("a caller under the per-user limit keeps getting grounding", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000501";
  try {
    await makeUser(db, userId);
    for (let i = 0; i < 8; i++) {
      const allowed = await db.query<
        { claim_grounding_fallback_request: boolean }
      >(
        "select claim_grounding_fallback_request($1, null)",
        [userId],
      );
      assertEquals(allowed.rows[0].claim_grounding_fallback_request, true);
    }
  } finally {
    await db.close();
  }
});

Deno.test("a caller over the per-user limit is refused, not errored", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000502";
  try {
    await makeUser(db, userId);
    for (let i = 0; i < 8; i++) {
      await db.query(
        "select claim_grounding_fallback_request($1, null)",
        [userId],
      );
    }
    const denied = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, null)",
      [userId],
    );
    assertEquals(denied.rows[0].claim_grounding_fallback_request, false);
  } finally {
    await db.close();
  }
});

Deno.test("the per-user limit is scoped per caller, not shared", async () => {
  const db = await createDatabase();
  const userA = "00000000-0000-4000-8000-000000000503";
  const userB = "00000000-0000-4000-8000-000000000504";
  try {
    await makeUser(db, userA);
    await makeUser(db, userB);

    for (let i = 0; i < 8; i++) {
      await db.query(
        "select claim_grounding_fallback_request($1, null)",
        [userA],
      );
    }
    const userAExhausted = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, null)",
      [userA],
    );
    assertEquals(
      userAExhausted.rows[0].claim_grounding_fallback_request,
      false,
    );

    const userBStillAllowed = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, null)",
      [userB],
    );
    assertEquals(
      userBStillAllowed.rows[0].claim_grounding_fallback_request,
      true,
    );
  } finally {
    await db.close();
  }
});

Deno.test("the per-user window resets after ten minutes", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000505";
  try {
    await makeUser(db, userId);
    for (let i = 0; i < 8; i++) {
      await db.query(
        "select claim_grounding_fallback_request($1, null)",
        [userId],
      );
    }
    const denied = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, null)",
      [userId],
    );
    assertEquals(denied.rows[0].claim_grounding_fallback_request, false);

    await db.query(
      `update grounding_fallback_rate_limits
       set window_started_at = now() - interval '10 minutes' - interval '1 second'
       where user_id = $1`,
      [userId],
    );

    const reset = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, null)",
      [userId],
    );
    assertEquals(reset.rows[0].claim_grounding_fallback_request, true);
  } finally {
    await db.close();
  }
});

Deno.test("an anonymous caller is limited by hashed network scope, not just user id", async () => {
  const db = await createDatabase();
  const scope = "e".repeat(64);
  try {
    for (let i = 0; i < 15; i++) {
      // A distinct anonymous user id each time -- exactly what a farming loop
      // that mints a fresh anonymous session per request would do -- must
      // still be caught by the shared network scope.
      const userId = `00000000-0000-4000-8000-0000000006${
        String(i).padStart(2, "0")
      }`;
      await makeUser(db, userId);
      const allowed = await db.query<
        { claim_grounding_fallback_request: boolean }
      >(
        "select claim_grounding_fallback_request($1, $2)",
        [userId, scope],
      );
      assertEquals(allowed.rows[0].claim_grounding_fallback_request, true);
    }

    const freshUserId = "00000000-0000-4000-8000-000000000699";
    await makeUser(db, freshUserId);
    const denied = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, $2)",
      [freshUserId, scope],
    );
    assertEquals(denied.rows[0].claim_grounding_fallback_request, false);
  } finally {
    await db.close();
  }
});

Deno.test("the anonymous network window resets after sixty minutes", async () => {
  const db = await createDatabase();
  const scope = "f".repeat(64);
  try {
    for (let i = 0; i < 15; i++) {
      const userId = `00000000-0000-4000-8000-0000000007${
        String(i).padStart(2, "0")
      }`;
      await makeUser(db, userId);
      await db.query(
        "select claim_grounding_fallback_request($1, $2)",
        [userId, scope],
      );
    }

    const exhaustedUserId = "00000000-0000-4000-8000-000000000798";
    await makeUser(db, exhaustedUserId);
    const denied = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, $2)",
      [exhaustedUserId, scope],
    );
    assertEquals(denied.rows[0].claim_grounding_fallback_request, false);

    await db.query(
      `update anonymous_grounding_fallback_rate_limits
       set window_started_at = now() - interval '60 minutes' - interval '1 second'
       where scope_hash = $1`,
      [scope],
    );

    const resetUserId = "00000000-0000-4000-8000-000000000799";
    await makeUser(db, resetUserId);
    const reset = await db.query<
      { claim_grounding_fallback_request: boolean }
    >(
      "select claim_grounding_fallback_request($1, $2)",
      [resetUserId, scope],
    );
    assertEquals(reset.rows[0].claim_grounding_fallback_request, true);
  } finally {
    await db.close();
  }
});

Deno.test("an anonymous caller's network scope hash must be well-formed", async () => {
  const db = await createDatabase();
  const userId = "00000000-0000-4000-8000-000000000800";
  try {
    await makeUser(db, userId);
    await assertRejects(
      () =>
        db.query(
          "select claim_grounding_fallback_request($1, $2)",
          [userId, "not-a-valid-hash"],
        ),
    );
  } finally {
    await db.close();
  }
});

Deno.test("the tables are service-role only", async () => {
  const db = await createDatabase();
  try {
    const privileges = await db.query<{
      user_table_select: boolean;
      anon_table_select: boolean;
      claim_execute: boolean;
    }>(
      `select
         has_table_privilege(
           'authenticated', 'public.grounding_fallback_rate_limits', 'SELECT'
         ) as user_table_select,
         has_table_privilege(
           'authenticated', 'public.anonymous_grounding_fallback_rate_limits',
           'SELECT'
         ) as anon_table_select,
         has_function_privilege(
           'authenticated',
           'public.claim_grounding_fallback_request(uuid, text)',
           'EXECUTE'
         ) as claim_execute`,
    );
    assertEquals(privileges.rows[0], {
      user_table_select: false,
      anon_table_select: false,
      claim_execute: false,
    });
  } finally {
    await db.close();
  }
});

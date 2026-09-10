// 00076: the writer's Story mode, from the generation call to the row the
// reader consults at every chapter end afterwards.
//
// These CALL the function rather than checking that it exists, which is the
// lesson 00071 paid for: a plpgsql body is parsed when it runs, so a mistake
// inside one deploys cleanly and passes every test that does not execute it.
//
// The clamp here is asymmetric on purpose and that asymmetry is what is under
// test. An unrecognised style falls back to a look; an unrecognised story mode
// falls back to a SPENDING DECISION. `auto` writes the next chapter without
// asking, so anything the database does not recognise has to resolve to
// `interactive` -- the mode that asks first.
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

const USER = "00000000-0000-4000-8000-000000000760";

async function seed(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query("insert into profiles(id) values ($1)", [USER]);
  await db.query(
    "select grant_credit($1, 60, 'welcome', 'story-flow-test', 'welcome:story-flow-test')",
    [USER],
  );
}

/**
 * One generation, returning the story row's stored mode.
 *
 * `undefined` for `flow` omits the argument entirely and `undefined` for
 * `style` omits both -- between them they cover the two deploys that can be
 * calling this function mid-rollout: one that predates Story mode, and one that
 * predates Image style as well.
 */
async function beginWithFlow(
  db: PGlite,
  requestId: string,
  flow: string | null | undefined,
  style: string | undefined = "auto",
): Promise<string> {
  const head = `select begin_story_generation(
    $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
    array[]::text[], 'sweet', 'series', 'An idea.', 'English',
    null, 'standard', 3, array[]::text[], array[]::text[], null, null,
    false, array[]::text[]`;
  const call = style === undefined
    ? `${head}) as result`
    : flow === undefined
    ? `${head}, $3) as result`
    : `${head}, $3, $4) as result`;
  const params = style === undefined
    ? [USER, requestId]
    : flow === undefined
    ? [USER, requestId, style]
    : [USER, requestId, style, flow];

  const begun = await db.query<{ result: Record<string, unknown> }>(
    call,
    params,
  );
  const storyId = begun.rows[0].result.story_id as string;
  const row = await db.query<{ story_flow: string }>(
    "select story_flow from public.stories where id = $1",
    [storyId],
  );
  return row.rows[0].story_flow;
}

Deno.test("a generation stores the writer's story mode", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals(await beginWithFlow(db, "req-auto", "auto"), "auto");
    assertEquals(
      await beginWithFlow(db, "req-interactive", "interactive"),
      "interactive",
    );
  } finally {
    await db.close();
  }
});

Deno.test("anything the database does not recognise asks before it spends", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // Case and padding are a client detail. Everything after them is a stale
    // client, a renamed mode or a hand-rolled request, and not one of them may
    // be read as consent to write a chapter unprompted.
    const cases: [string | null, string][] = [
      ["  Auto ", "auto"],
      ["AUTO", "auto"],
      ["automatic", "interactive"],
      ["auto-continue", "interactive"],
      ["", "interactive"],
      ["'; drop table public.stories; --", "interactive"],
      [null, "interactive"],
    ];
    let n = 0;
    for (const [sent, expected] of cases) {
      assertEquals(
        await beginWithFlow(db, `clamp-${n++}`, sent),
        expected,
        `${JSON.stringify(sent)}`,
      );
    }
  } finally {
    await db.close();
  }
});

// The rollout window: code and schema disagree for as long as it takes the
// handlers to deploy, and during it the older handler names fewer parameters.
// Both shapes must still resolve to this function and both must default to the
// mode that asks.
Deno.test("a handler that predates either picker still resolves", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals(await beginWithFlow(db, "no-flow-arg", undefined), "interactive");
    assertEquals(
      await beginWithFlow(db, "no-style-arg", undefined, undefined),
      "interactive",
    );
  } finally {
    await db.close();
  }
});

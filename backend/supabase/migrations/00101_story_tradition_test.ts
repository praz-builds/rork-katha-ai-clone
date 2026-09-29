// 00101: the faith axis, persisted on the story, and threaded through the one
// RPC that creates a story row.
//
// The same lesson every migration test since 00071 restates: a plpgsql body is
// parsed when it RUNS, so a broken function deploys cleanly and passes a test
// that only checks it exists. Every assertion below CALLS the function, because
// `begin_story_generation` is also where the credit is taken -- a body that
// fails to parse fails a paid generation.
//
// WHAT IS ACTUALLY UNDER TEST, and why each part is here:
//
//   - the column exists, is nullable, and has no default (absent is absent);
//   - a 22-argument call -- the shape a `generate-story` deploy that predates
//     this migration makes -- still resolves and still writes a story. That is
//     the whole point of the new parameter going last with a default, and a
//     regression here means a deploy ordering can fail someone's paid request;
//   - a supported id is stored, so `continue-story` and the cover pipeline can
//     read it back;
//   - an id the function does not recognise becomes NULL rather than raising.
//     This is the one that costs money if it breaks: the check constraint would
//     abort the transaction that also deducts the credit, so a stale client
//     would lose the writer their story over a soft preference. "Normalise,
//     never reject" is not advice here, it is the tested behaviour;
//   - the declared-but-unsupported ids from `traditions.ts` (buddhist, secular,
//     ...) take that same path, because no reviewed representation policy
//     exists for them and a row carrying one would make the prompt and the
//     cover layers disagree about whether a policy applies;
//   - `claim_cover_regeneration` hands the tradition back. That RPC's result is
//     the ENTIRE input a cover regeneration is built from -- it deliberately
//     does not follow the claim with a second SELECT of the row, which is why
//     00075 had to add `image_style` to it for the same reason. A tradition
//     missing here fails in the worst available shape: the first cover honours
//     the depiction policy, the regenerated one silently does not, nothing
//     errors, and the writer has paid a credit for the picture that broke it.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

/** Every migration in this directory, in order. 00101 is the last of them. */
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

const USER = "00000000-0000-4000-8000-0000000001a1";

async function seedUser(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query(
    "insert into profiles(id) values ($1) on conflict do nothing",
    [USER],
  );
  // Enough credits that nothing below is ever refused for money.
  await db.query(
    "select grant_credit($1, 50, 'welcome', 'seed-00101', 'welcome:seed-00101')",
    [USER],
  );
}

async function balanceOf(db: PGlite): Promise<number> {
  const result = await db.query<{ balance: number }>(
    `select subscription_grant_balance + purchased_balance + earned_balance
       as balance
     from credit_balance_buckets where user_id = $1`,
    [USER],
  );
  return Number(result.rows[0].balance);
}

type Begun = { story_id: string; balance: number; replayed: boolean };

/** The 23-argument call: what the deploy that lands with this migration makes. */
async function begin(
  db: PGlite,
  requestId: string,
  tradition: string | null,
): Promise<Begun> {
  const result = await db.query<{ result: Begun }>(
    `select begin_story_generation(
       $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
       array[]::text[], 'sweet', 'standalone', 'An idea.', 'English',
       null, 'standard', 1, array[]::text[], array[]::text[], null, null,
       false, array[]::text[], 'auto', 'interactive', $3) as result`,
    [USER, requestId, tradition],
  );
  return result.rows[0].result;
}

/** The 22-argument call: what a `generate-story` deploy from before this makes. */
async function beginWithoutTradition(
  db: PGlite,
  requestId: string,
): Promise<Begun> {
  const result = await db.query<{ result: Begun }>(
    `select begin_story_generation(
       $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
       array[]::text[], 'sweet', 'standalone', 'An idea.', 'English',
       null, 'standard', 1, array[]::text[], array[]::text[], null, null,
       false, array[]::text[], 'auto', 'interactive') as result`,
    [USER, requestId],
  );
  return result.rows[0].result;
}

async function traditionOf(
  db: PGlite,
  storyId: string,
): Promise<string | null> {
  const row = await db.query<{ tradition: string | null }>(
    "select tradition from stories where id = $1",
    [storyId],
  );
  return row.rows[0].tradition;
}

Deno.test("stories.tradition is nullable and has no default", async () => {
  const db = await createDatabase();
  try {
    const column = await db.query<{
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>(
      `select is_nullable, column_default, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = 'stories'
          and column_name = 'tradition'`,
    );
    assertEquals(column.rows.length, 1);
    assertEquals(column.rows[0].is_nullable, "YES");
    // No default: a story that states nothing stores nothing, and behaves in
    // every respect as it did before this column existed.
    assertEquals(column.rows[0].column_default, null);
    assertEquals(column.rows[0].data_type, "text");
  } finally {
    await db.close();
  }
});

Deno.test("an existing story row carries a null tradition", async () => {
  const db = await createDatabase();
  try {
    await seedUser(db);
    // Inserted the way every row written before this migration was: without
    // naming the column at all.
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, status)
       values ('00000000-0000-4000-8000-00000000c001', $1, 'Old', array['romance'], 'romance', 'complete')`,
      [USER],
    );
    assertEquals(
      await traditionOf(db, "00000000-0000-4000-8000-00000000c001"),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("each Phase 1 tradition is stored as given", async () => {
  const db = await createDatabase();
  try {
    await seedUser(db);
    for (const id of ["christian", "muslim", "jewish", "hindu"]) {
      const begun = await begin(db, `req-${id}`, id);
      assertEquals(begun.replayed, false);
      assertEquals(await traditionOf(db, begun.story_id), id);
    }
  } finally {
    await db.close();
  }
});

Deno.test("no tradition stores null, and still costs one credit", async () => {
  const db = await createDatabase();
  try {
    await seedUser(db);
    const before = await balanceOf(db);
    const begun = await begin(db, "req-none", null);
    assertEquals(await traditionOf(db, begun.story_id), null);
    assertEquals(Number(begun.balance), before - 1);
    assertEquals(await balanceOf(db), before - 1);
  } finally {
    await db.close();
  }
});

Deno.test("a 22-argument call from an older deploy still writes a story", async () => {
  const db = await createDatabase();
  try {
    await seedUser(db);
    const begun = await beginWithoutTradition(db, "req-old-deploy");
    assertEquals(begun.replayed, false);
    assert(begun.story_id);
    assertEquals(await traditionOf(db, begun.story_id), null);
  } finally {
    await db.close();
  }
});

Deno.test("an unrecognised tradition normalises to null, never raises", async () => {
  const db = await createDatabase();
  try {
    await seedUser(db);
    // Declared-but-unsupported ids from traditions.ts, a typo, a casing
    // variant, free text and the empty string. None of them may cost the
    // writer their paid generation.
    const cases: Record<string, string | null> = {
      buddhist: null,
      secular: null,
      christain: null,
      "not-a-tradition": null,
      "": null,
      // Casing and whitespace are normalised rather than refused, which is what
      // `lower`/`btrim` are for.
      "  MUSLIM ": "muslim",
      Jewish: "jewish",
    };
    let i = 0;
    for (const [value, expected] of Object.entries(cases)) {
      const begun = await begin(db, `req-bad-${i++}`, value);
      assertEquals(
        await traditionOf(db, begun.story_id),
        expected,
        `tradition ${JSON.stringify(value)}`,
      );
    }
  } finally {
    await db.close();
  }
});

Deno.test("the check constraint refuses an unsupported id written directly", async () => {
  const db = await createDatabase();
  try {
    await seedUser(db);
    // The RPC clamps, so this can only happen through a direct write -- which
    // is exactly what the constraint is for: the column and `traditions.ts`
    // must not be able to drift apart.
    let raised = false;
    try {
      await db.query(
        `insert into stories (author_id, title, genre, primary_genre, status, tradition)
         values ($1, 'X', array['romance'], 'romance', 'complete', 'buddhist')`,
        [USER],
      );
    } catch {
      raised = true;
    }
    assert(raised, "stories_tradition_check should refuse an unsupported id");
  } finally {
    await db.close();
  }
});

Deno.test("claim_cover_regeneration hands the tradition back", async () => {
  const db = await createDatabase();
  try {
    await seedUser(db);

    const begun = await begin(db, "req-cover", "muslim");
    // The claim only fires on a story the cover pipeline has finished with.
    await db.query(
      `update stories set status = 'complete', cover_status = 'ready',
              cover_image_url = 'https://example.test/c.png'
         where id = $1`,
      [begun.story_id],
    );

    const claimed = await db.query<{ claim: Record<string, unknown> }>(
      "select claim_cover_regeneration($1, $2, $3) as claim",
      [begun.story_id, USER, "regen-1"],
    );
    const claim = claimed.rows[0].claim;
    assertEquals(claim.claimed, true);
    assertEquals(claim.tradition, "muslim");
    // The fields the regeneration already built its prompt from are still
    // there: this is an addition, not a reshaping, so no existing caller of
    // this RPC changes behaviour.
    assertEquals(claim.image_style, "auto");
    assertEquals(claim.title, "Untitled");

    // And a story with no tradition claims exactly as it always has: the key
    // is present and null, which `optionalString` in cover-regeneration.ts
    // reads as absent.
    const plain = await begin(db, "req-cover-none", null);
    await db.query(
      `update stories set status = 'complete', cover_status = 'ready',
              cover_image_url = 'https://example.test/d.png'
         where id = $1`,
      [plain.story_id],
    );
    const plainClaim = await db.query<{ claim: Record<string, unknown> }>(
      "select claim_cover_regeneration($1, $2, $3) as claim",
      [plain.story_id, USER, "regen-2"],
    );
    assertEquals(plainClaim.rows[0].claim.claimed, true);
    assertEquals(plainClaim.rows[0].claim.tradition, null);
  } finally {
    await db.close();
  }
});

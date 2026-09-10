// 00075: the writer's image style, from the generation call to the row to the
// cover regeneration that reads it back.
//
// These CALL the functions rather than checking that they exist, which is the
// lesson 00071 paid for: a plpgsql body is parsed when it runs, so a mistake
// inside one deploys cleanly and passes every test that does not execute it.
// This file executes the clamp -- the one piece of new logic in the migration,
// and the piece that decides whether an unrecognised style costs somebody their
// paid generation.
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

const USER = "00000000-0000-4000-8000-000000000751";

async function seed(db: PGlite) {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query("insert into profiles(id) values ($1)", [USER]);
  await db.query(
    "select grant_credit($1, 30, 'welcome', 'image-style-test', 'welcome:image-style-test')",
    [USER],
  );
}

/** One generation, returning the story row's stored style. */
async function beginWithStyle(
  db: PGlite,
  requestId: string,
  style: string | null | undefined,
): Promise<{ storyId: string; imageStyle: string }> {
  // `undefined` omits the argument entirely, which is the older caller: a
  // deploy of `generate-story` that names 20 parameters and not this one.
  const call = style === undefined
    ? `select begin_story_generation(
        $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
        array[]::text[], 'sweet', 'standalone', 'An idea.', 'English',
        null, 'standard', 3, array[]::text[], array[]::text[], null, null,
        false, array[]::text[]
      ) as result`
    : `select begin_story_generation(
        $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
        array[]::text[], 'sweet', 'standalone', 'An idea.', 'English',
        null, 'standard', 3, array[]::text[], array[]::text[], null, null,
        false, array[]::text[], $3
      ) as result`;
  const params = style === undefined ? [USER, requestId] : [
    USER,
    requestId,
    style,
  ];
  const begun = await db.query<{ result: Record<string, unknown> }>(
    call,
    params,
  );
  const storyId = begun.rows[0].result.story_id as string;
  const row = await db.query<{ image_style: string }>(
    "select image_style from public.stories where id = $1",
    [storyId],
  );
  return { storyId, imageStyle: row.rows[0].image_style };
}

Deno.test("a generation stores the writer's image style", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (
      const style of ["auto", "anime", "cinematic", "comic", "watercolor"]
    ) {
      const { imageStyle } = await beginWithStyle(db, `req-${style}`, style);
      assertEquals(imageStyle, style);
    }
  } finally {
    await db.close();
  }
});

// The failure this clamp exists for. `stories_image_style_check` is enforced in
// the same transaction as the credit deduction, so a style the database does
// not recognise would not produce an ugly cover -- it would abort the whole
// paid generation and the writer would lose the story.
Deno.test("an unrecognised image style costs nobody their generation", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // Case and padding are a client detail; the rest is a stale or hostile
    // client, and every one of them is the genre's own look.
    const cases: [string, string | null][] = [
      ["  Anime ", "anime"],
      ["WATERCOLOR", "watercolor"],
      ["oil-painting", "auto"],
      ["", "auto"],
      ["'; drop table public.stories; --", "auto"],
      ["auto", "auto"],
    ];
    let n = 0;
    for (const [sent, expected] of cases) {
      const { imageStyle } = await beginWithStyle(db, `clamp-${n++}`, sent);
      assertEquals(imageStyle, expected, `${JSON.stringify(sent)}`);
    }

    // An explicit null, which is how a caller spells "the user did not pick".
    assertEquals(
      (await beginWithStyle(db, "null-style", null)).imageStyle,
      "auto",
    );
    // And no argument at all: an older deploy of the handler, mid-rollout.
    assertEquals(
      (await beginWithStyle(db, "absent-style", undefined)).imageStyle,
      "auto",
    );
  } finally {
    await db.close();
  }
});

// The claim is the only thing a cover regeneration sees. A style missing from
// it is a writer paying a credit to have their anime cover replaced by the
// genre default.
Deno.test("the cover regeneration claim carries the style back", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const { storyId } = await beginWithStyle(db, "claim-style", "comic");

    const claimed = await db.query<{ result: Record<string, unknown> }>(
      "select claim_cover_regeneration($1, $2, 'regen-1') as result",
      [storyId, USER],
    );
    const claim = claimed.rows[0].result;
    assertEquals(claim.claimed, true);
    assertEquals(claim.image_style, "comic");
  } finally {
    await db.close();
  }
});

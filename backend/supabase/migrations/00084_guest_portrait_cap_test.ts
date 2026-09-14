// 00084: the cap is exercised, not inspected.
//
// Same lesson 00071 paid for and 00082 restated -- a plpgsql body is parsed
// when it RUNS, so a mistake inside one deploys cleanly and passes any test
// that only asserts the function exists. Every assertion below calls the
// function and then calls it again, because the thing under test is whether the
// fifth portrait of an anonymous session is refused.
//
// What is asserted, in the order it matters:
//
//   1. The first six claims pass and the seventh does not, ever, for that
//      identity -- there is no window to wait out.
//   2. A release returns exactly one slot, so a failed generation does not
//      burn one.
//   3. Release floors at zero: a double release cannot mint a slot.
//   4. Identities do not share a budget.
//   5. Neither function is executable by `authenticated`. The user id is an
//      argument taken on trust, so the caller must be the service role that
//      verified the token.
//   6. Nothing here touches `claim_guest_characters` (00082): a guest who signs
//      in keeps their characters and does NOT carry the count to the owner.
//
// ## Why this file now says six
//
// 00088 widened this counter from "four per anonymous identity" to "six per
// user, anonymous or named", and made anything past the six cost a credit
// through `claim_character_image_request`. The pair asserted here is superseded
// by that function and is kept only so an older deploy of
// `generate-character-image` still bounds an anonymous caller at the CURRENT
// number rather than the old one -- which is precisely what the counts below
// pin. The credit half of the rule is tested in 00088's own file.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
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

const GUEST = "00000000-0000-4000-8000-000000000841";
const OTHER_GUEST = "00000000-0000-4000-8000-000000000842";
const OWNER = "00000000-0000-4000-8000-000000000843";

async function seed(db: PGlite) {
  for (const id of [GUEST, OTHER_GUEST, OWNER]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id) values ($1)", [id]);
  }
}

async function claim(db: PGlite, userId: string): Promise<boolean> {
  const result = await db.query<{ allowed: boolean }>(
    "select claim_guest_portrait_request($1) as allowed",
    [userId],
  );
  return result.rows[0].allowed;
}

async function release(db: PGlite, userId: string) {
  await db.query("select release_guest_portrait_request($1)", [userId]);
}

async function claimed(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ claimed_count: number }>(
    "select claimed_count from guest_portrait_quotas where user_id = $1",
    [userId],
  );
  return result.rows.length ? result.rows[0].claimed_count : 0;
}

Deno.test("six portraits, then no more, through the superseded pair", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 1; i <= 6; i++) {
      assertEquals(await claim(db, GUEST), true, `claim ${i} was refused`);
    }
    // A lifetime cap, not a window: there is nothing to wait out, so the
    // seventh and the eighth are both refused with no clock involved.
    assertEquals(await claim(db, GUEST), false);
    assertEquals(await claim(db, GUEST), false);
    assertEquals(await claimed(db, GUEST), 6);
  } finally {
    await db.close();
  }
});

Deno.test("a failed generation gives the slot back", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 0; i < 6; i++) await claim(db, GUEST);
    assertEquals(await claim(db, GUEST), false);

    // On this path there is no credit reservation to refund, so the release is
    // the only thing standing between a provider failure and a slot the user
    // paid for with nothing.
    await release(db, GUEST);
    assertEquals(await claimed(db, GUEST), 5);
    assertEquals(await claim(db, GUEST), true);
    assertEquals(await claim(db, GUEST), false);
  } finally {
    await db.close();
  }
});

Deno.test("release floors at zero and cannot mint a slot", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    assertEquals(await claim(db, GUEST), true);
    // A retry loop that releases twice for one claim must not end up with more
    // budget than it started with.
    await release(db, GUEST);
    await release(db, GUEST);
    await release(db, GUEST);
    assertEquals(await claimed(db, GUEST), 0);

    for (let i = 1; i <= 6; i++) {
      assertEquals(await claim(db, GUEST), true, `claim ${i} was refused`);
    }
    assertEquals(await claim(db, GUEST), false);
  } finally {
    await db.close();
  }
});

Deno.test("releasing for an identity that never claimed does nothing", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await release(db, GUEST);
    // No row, no negative count, no exception -- the 502 path calls this
    // without knowing whether the claim ever happened.
    assertEquals(await claimed(db, GUEST), 0);
    assertEquals(await claim(db, GUEST), true);
  } finally {
    await db.close();
  }
});

Deno.test("one identity's cap is not another's", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 0; i < 6; i++) await claim(db, GUEST);
    assertEquals(await claim(db, GUEST), false);
    assertEquals(await claim(db, OTHER_GUEST), true);
    assertEquals(await claimed(db, GUEST), 6);
    assertEquals(await claimed(db, OTHER_GUEST), 1);
  } finally {
    await db.close();
  }
});

Deno.test("a null identity is refused rather than counted", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const result = await db.query<{ allowed: boolean }>(
      "select claim_guest_portrait_request(null) as allowed",
    );
    assertEquals(result.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});

Deno.test("signing in does not carry the guest's count to the owner", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 0; i < 6; i++) await claim(db, GUEST);
    await db.query(
      "insert into user_characters(owner_id, name, appearance) values ($1, $2, $3)",
      [GUEST, "Naina", "Paint on her hands, her grandmother's coat."],
    );

    // 00082 moves characters and nothing else, and it still does after 00088:
    // a count is not carried onto the claiming account. That was free of
    // consequence when only anonymous identities were capped; now that both are,
    // it means a guest who signs into an EXISTING account arrives with that
    // account's own six intact. See 00088's report note -- it is bounded by the
    // three-guest-bootstraps-per-network-per-day limit (00035), not by this.
    await db.query("select claim_guest_characters($1, $2)", [GUEST, OWNER]);
    assertEquals(await claimed(db, OWNER), 0);
    assertEquals(await claimed(db, GUEST), 6);
  } finally {
    await db.close();
  }
});

Deno.test("only the service role may execute either function", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec("set role authenticated");
    // The user id is an argument taken on trust. If `authenticated` could call
    // these, any caller could release somebody else's slots -- or read the
    // table and learn how many an identity has left.
    await assertRejects(() =>
      db.query("select claim_guest_portrait_request($1)", [GUEST])
    );
    await assertRejects(() =>
      db.query("select release_guest_portrait_request($1)", [GUEST])
    );
    await assertRejects(() =>
      db.query("select claimed_count from guest_portrait_quotas")
    );
    await db.exec("reset role");
    assertEquals(await claimed(db, GUEST), 0);
  } finally {
    await db.close();
  }
});

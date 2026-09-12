// 00082: the claim is executed, not inspected.
//
// The lesson 00071 paid for applies here too -- a plpgsql body is parsed when
// it RUNS, so a mistake inside one deploys cleanly and passes any test that
// only checks the function exists. Every assertion below calls the function and
// reads `user_characters` afterwards, because the thing under test is whether a
// character a user watched appear is still theirs an hour later.
//
// What is asserted, in the order it matters:
//
//   1. Characters move from the anonymous profile to the named one.
//   2. Nothing else moves -- credits stay on the guest ledger.
//   3. A name the account already uses is skipped, not merged, not renamed,
//      and does not take the whole claim down with a unique-index violation.
//   4. Claiming onto yourself is a no-op, not an error: that is the normal
//      in-place conversion arriving here with one id.
//   5. `authenticated` cannot execute it. The guest id is taken on trust from
//      the caller, so the caller must be the service role that verified the
//      token.
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

const GUEST = "00000000-0000-4000-8000-000000000821";
const OWNER = "00000000-0000-4000-8000-000000000822";

async function seed(db: PGlite) {
  for (const id of [GUEST, OWNER]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id) values ($1)", [id]);
  }
  // The three credits the guest bootstrap grants, so the test can prove they
  // are NOT carried across with the characters.
  await db.query(
    "select grant_credit($1, 3, 'welcome', $2, $3)",
    [GUEST, GUEST, `guest_bootstrap:${GUEST}`],
  );
}

async function addCharacter(db: PGlite, owner: string, name: string) {
  await db.query(
    "insert into user_characters(owner_id, name, appearance) values ($1, $2, $3)",
    [owner, name, "Paint on her hands, her grandmother's coat."],
  );
}

async function namesOf(db: PGlite, owner: string): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "select name from user_characters where owner_id = $1 order by name",
    [owner],
  );
  return rows.rows.map((row) => row.name);
}

async function claim(db: PGlite, guest: string, owner: string) {
  const result = await db.query<{ moved: number }>(
    "select claim_guest_characters($1, $2) as moved",
    [guest, owner],
  );
  return result.rows[0].moved;
}

Deno.test("the onboarding character follows the person who made it", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await addCharacter(db, GUEST, "Naina");

    assertEquals(await claim(db, GUEST, OWNER), 1);
    assertEquals(await namesOf(db, OWNER), ["Naina"]);
    assertEquals(await namesOf(db, GUEST), []);
  } finally {
    await db.close();
  }
});

Deno.test("credits stay on the guest ledger", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await addCharacter(db, GUEST, "Naina");
    await claim(db, GUEST, OWNER);

    // Moving the guest grant onto named accounts would turn 00035's per
    // network cap into a farm. The character is the promise; the credits are
    // not.
    const owner = await db.query<{ count: number }>(
      "select count(*)::int as count from credit_ledger where user_id = $1",
      [OWNER],
    );
    assertEquals(owner.rows[0].count, 0);
    const guest = await db.query<{ balance_after: number }>(
      `select balance_after from credit_ledger where user_id = $1
        order by created_at desc, ledger_sequence desc limit 1`,
      [GUEST],
    );
    assertEquals(guest.rows[0].balance_after, 3);
  } finally {
    await db.close();
  }
});

Deno.test("a name the account already uses is skipped, not collided with", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await addCharacter(db, GUEST, "  naina  ");
    await addCharacter(db, GUEST, "Ravi");
    await addCharacter(db, OWNER, "Naina");

    // The unique index is on (owner_id, lower(btrim(name))), so an unguarded
    // update would abort the whole claim and Ravi would be lost with it.
    assertEquals(await claim(db, GUEST, OWNER), 1);
    assertEquals(await namesOf(db, OWNER), ["Naina", "Ravi"]);
    assertEquals(await namesOf(db, GUEST), ["  naina  "]);
  } finally {
    await db.close();
  }
});

Deno.test("claiming onto the same identity is a no-op", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await addCharacter(db, GUEST, "Naina");

    // This is the in-place conversion arriving here with one id. It must not
    // raise: nothing has to move because nothing changed hands.
    assertEquals(await claim(db, GUEST, GUEST), 0);
    assertEquals(await namesOf(db, GUEST), ["Naina"]);
  } finally {
    await db.close();
  }
});

Deno.test("only the service role may execute it", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await addCharacter(db, GUEST, "Naina");

    await db.exec("set role authenticated");
    // The guest id is an argument, taken on trust. If `authenticated` could
    // call this, any signed-in user could name any anonymous profile and take
    // its characters.
    await assertRejects(() =>
      db.query("select claim_guest_characters($1, $2)", [GUEST, OWNER])
    );
    await db.exec("reset role");
    assertEquals(await namesOf(db, GUEST), ["Naina"]);
  } finally {
    await db.close();
  }
});

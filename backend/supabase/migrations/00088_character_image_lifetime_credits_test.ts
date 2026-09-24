// 00088: the free images are exercised, the next one is charged, and nothing is ever
// drawn for a user who cannot pay.
//
// Same lesson 00071 paid for and 00082, 00084 and 00085 restated -- a plpgsql
// body is parsed when it RUNS, so a mistake inside one deploys cleanly and
// passes any test that only asserts the function exists. Every assertion below
// calls the function against real SQL and then reads the ledger, because the
// thing under test is money.
//
// What is asserted, in the order it matters:
//
//   1. The last free image is free and the next costs exactly one credit.
//   2. A user with no credits is REFUSED (KTH02), not drawn for -- and the
//      refusal leaves no reservation behind, so the request id is still usable
//      once they have a balance.
//   3. A failed charged image refunds the credit; a failed free one gives the
//      slot back. Neither can be settled twice.
//   4. A re-delivered request (the same request_id) replays the reservation
//      and does NOT charge again, and a request_id that already completed or
//      refunded cannot be spent a second time.
//   5. The counter is per user: one person's allowance is not another's.
//   6. An anonymous identity's existing 00084 count carries into the allowance
//      rather than starting over.
//   7. Neither function is executable by `authenticated`. The user id is an
//      argument taken on trust, so the caller must be the service role that
//      verified the token.
//
// ## The number is three since 00096
//
// This harness applies every migration in order, so it runs against the
// allowance 00096 set (three, product owner 2026-09-24), not the six 00088
// shipped. The assertions are written against `FREE` rather than a literal so
// the next time the number moves it moves here in one place; 00096's own test
// asserts the three, and what happens to an account already past it.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

/** Free character images per account. 00096 moved it from 6 to 3. */
const FREE = 3;

async function createDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    -- bypassrls, matching Supabase, because a granted select against a
    -- policy-less RLS table returns zero rows instead of an error without it --
    -- which would let this file pass while the live project refused the read.
    -- 00086 paid for that distinction.
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

const WRITER = "00000000-0000-4000-8000-000000000881";
const OTHER = "00000000-0000-4000-8000-000000000882";
const GUEST = "00000000-0000-4000-8000-000000000883";
const BROKE = "00000000-0000-4000-8000-000000000884";

async function seed(db: PGlite) {
  for (const id of [WRITER, OTHER, GUEST, BROKE]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id) values ($1)", [id]);
  }
}

/** Put credits on an account the way a purchase would. */
async function fund(db: PGlite, userId: string, amount: number) {
  await db.query(
    "select grant_credit($1, $2, 'purchase', $3, $4)",
    [userId, amount, `seed-${userId}`, `purchase:seed:${userId}:${amount}`],
  );
}

async function balance(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ balance_after: number }>(
    `select balance_after from credit_ledger where user_id = $1
     order by created_at desc, ledger_sequence desc limit 1`,
    [userId],
  );
  return result.rows.length ? result.rows[0].balance_after : 0;
}

type Claim = {
  operation_id: string;
  status: string;
  credits: number;
  replayed: boolean;
  /** Whether THIS delivery holds the claim and should call the provider. */
  drawing: boolean;
  free_remaining: number;
  balance: number;
};

/**
 * `mayPurchase` defaults to TRUE here because most of these tests are about a
 * named user, who may buy past their free images. The function's own default is the
 * opposite -- false, so a caller that forgets the argument refuses to spend
 * rather than spending -- and the anonymous wall is tested explicitly below.
 */
async function claim(
  db: PGlite,
  userId: string,
  requestId: string,
  mayPurchase = true,
): Promise<Claim> {
  const result = await db.query<{ claim: Claim }>(
    "select claim_character_image_request($1, $2, $3) as claim",
    [userId, requestId, mayPurchase],
  );
  return result.rows[0].claim;
}

async function release(db: PGlite, operationId: string, userId: string) {
  const result = await db.query<{ release: Record<string, unknown> }>(
    "select release_character_image_request($1, $2, 'provider failed') as release",
    [operationId, userId],
  );
  return result.rows[0].release;
}

async function complete(db: PGlite, operationId: string, userId: string) {
  await db.query("select complete_character_image_request($1, $2)", [
    operationId,
    userId,
  ]);
}

async function freeUsed(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ claimed_count: number }>(
    "select claimed_count from guest_portrait_quotas where user_id = $1",
    [userId],
  );
  return result.rows.length ? result.rows[0].claimed_count : 0;
}

Deno.test("the last free image is free and the next costs one credit", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 5);

    for (let i = 1; i <= FREE; i++) {
      const claimed = await claim(db, WRITER, `req-${i}`);
      assertEquals(claimed.credits, 0, `image ${i} was charged`);
      assertEquals(claimed.free_remaining, FREE - i);
      assertEquals(claimed.balance, 5, `image ${i} moved the balance`);
      await complete(db, claimed.operation_id, WRITER);
    }
    // Every free one used, and the counter says so rather than the test
    // inferring it from the balance.
    assertEquals(await freeUsed(db, WRITER), FREE);
    assertEquals(await balance(db, WRITER), 5);

    const next = await claim(db, WRITER, "req-next");
    assertEquals(next.credits, 1);
    assertEquals(next.free_remaining, 0);
    assertEquals(next.balance, 4);
    assertEquals(await balance(db, WRITER), 4);

    // And one more, so the charge is the new steady state rather than a
    // one-off boundary effect.
    const after = await claim(db, WRITER, "req-after");
    assertEquals(after.credits, 1);
    assertEquals(await balance(db, WRITER), 3);
  } finally {
    await db.close();
  }
});

Deno.test("editing counts against the same allowance, because editing costs", async () => {
  // There is no separate "edit" call: the Craft sheet re-invokes the same
  // endpoint with changed fields and a new request id, which is a fresh paid
  // provider generation. This asserts the counter cannot tell them apart --
  // counting the generation and not the edit would make "edit the appearance"
  // a free regeneration button.
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 3);

    const first = await claim(db, WRITER, "create");
    await complete(db, first.operation_id, WRITER);
    const edited = await claim(db, WRITER, "edit-1");
    await complete(db, edited.operation_id, WRITER);

    assertEquals(await freeUsed(db, WRITER), 2);
    assertEquals(edited.free_remaining, FREE - 2);
  } finally {
    await db.close();
  }
});

Deno.test("a user with no credits is refused, not drawn for", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // No funding at all: the free ones are free, so this account reaches the charge
    // with a zero balance, which is the ordinary free-tier shape.
    for (let i = 1; i <= FREE; i++) {
      const claimed = await claim(db, BROKE, `free-${i}`);
      await complete(db, claimed.operation_id, BROKE);
    }
    assertEquals(await balance(db, BROKE), 0);

    await assertRejects(
      () => claim(db, BROKE, "paid-1"),
      Error,
      "Insufficient credits",
    );

    // The refusal took the reservation with it. Without this, a user who
    // topped up and retried the same request id would find it spent and be
    // told to start over -- and a reservation nobody can settle would sit
    // `reserved` forever.
    const rows = await db.query(
      "select 1 from character_image_operations where user_id = $1 and request_id = 'paid-1'",
      [BROKE],
    );
    assertEquals(rows.rows.length, 0);

    // Nothing was drawn and nothing was taken, so the counter did not move
    // either.
    assertEquals(await freeUsed(db, BROKE), FREE);
    assertEquals(await balance(db, BROKE), 0);

    // Top up and the same id works, at the same price.
    await fund(db, BROKE, 1);
    const paid = await claim(db, BROKE, "paid-1");
    assertEquals(paid.credits, 1);
    assertEquals(await balance(db, BROKE), 0);
  } finally {
    await db.close();
  }
});

Deno.test("a failed charged image refunds the credit", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 2);
    for (let i = 1; i <= FREE; i++) {
      const free = await claim(db, WRITER, `free-${i}`);
      await complete(db, free.operation_id, WRITER);
    }

    const paid = await claim(db, WRITER, "paid-1");
    assertEquals(paid.credits, 1);
    assertEquals(await balance(db, WRITER), 1);

    const released = await release(db, paid.operation_id, WRITER);
    assertEquals(released.refunded, true);
    assertEquals(released.balance, 2);
    assertEquals(await balance(db, WRITER), 2);

    // A second release must not mint a credit. The endpoint's 502 path and its
    // catch-all can both fire for one request.
    const again = await release(db, paid.operation_id, WRITER);
    assertEquals(again.refunded, false);
    assertEquals(await balance(db, WRITER), 2);
  } finally {
    await db.close();
  }
});

Deno.test("a failed free image gives the slot back, not a credit", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 2);

    const first = await claim(db, WRITER, "free-1");
    assertEquals(first.credits, 0);
    assertEquals(await freeUsed(db, WRITER), 1);

    const released = await release(db, first.operation_id, WRITER);
    assertEquals(released.refunded, true);
    assertEquals(released.credits, 0);
    // Onboarding promises the retry after "We couldn't find {Name} this time"
    // is free. Without the decrement the third failure in a row would end the
    // flow having silently spent the whole allowance.
    assertEquals(await freeUsed(db, WRITER), 0);
    assertEquals(released.free_remaining, FREE);
    // And no credit was invented out of a free failure.
    assertEquals(await balance(db, WRITER), 2);

    await release(db, first.operation_id, WRITER);
    assertEquals(await freeUsed(db, WRITER), 0);
  } finally {
    await db.close();
  }
});

Deno.test("a completed image cannot be refunded afterwards", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 3);
    for (let i = 1; i <= FREE; i++) {
      const free = await claim(db, WRITER, `free-${i}`);
      await complete(db, free.operation_id, WRITER);
    }
    const paid = await claim(db, WRITER, "paid-1");
    await complete(db, paid.operation_id, WRITER);

    const released = await release(db, paid.operation_id, WRITER);
    assertEquals(released.refunded, false);
    assertEquals(released.status, "completed");
    // The image was delivered. Refunding it because a later step threw would
    // hand back a credit for work that arrived.
    assertEquals(await balance(db, WRITER), 2);
  } finally {
    await db.close();
  }
});

Deno.test("a re-delivered request replays and is not charged twice", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 3);
    for (let i = 1; i <= FREE; i++) {
      const free = await claim(db, WRITER, `free-${i}`);
      await complete(db, free.operation_id, WRITER);
    }

    const first = await claim(db, WRITER, "same-tap");
    assertEquals(first.credits, 1);
    assertEquals(await balance(db, WRITER), 2);

    // The same request id arriving again is the same tap, not a new one: a
    // network retry, a double-fired promise, a re-delivered invocation.
    const replay = await claim(db, WRITER, "same-tap");
    assertEquals(replay.replayed, true);
    assertEquals(replay.operation_id, first.operation_id);
    assertEquals(replay.credits, 1);
    assertEquals(await balance(db, WRITER), 2);

    // One reservation, not two.
    const rows = await db.query(
      "select 1 from character_image_operations where user_id = $1 and request_id = 'same-tap'",
      [WRITER],
    );
    assertEquals(rows.rows.length, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a spent request id replays as spent rather than drawing again", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 3);

    const free = await claim(db, WRITER, "one-shot");
    await complete(db, free.operation_id, WRITER);

    const replay = await claim(db, WRITER, "one-shot");
    assertEquals(replay.replayed, true);
    // The caller turns this into a refusal. Answering `reserved` would let one
    // charge (or one free slot) buy a second image.
    assertEquals(replay.status, "completed");
    assertEquals(await freeUsed(db, WRITER), 1);

    // The other spent state: a reservation that was settled as a failure. Its
    // slot went back, so the retry is a NEW request id -- reusing this one must
    // not resurrect a reservation nothing is holding.
    const failed = await claim(db, WRITER, "failed-once");
    await release(db, failed.operation_id, WRITER);
    const afterRefund = await claim(db, WRITER, "failed-once");
    assertEquals(afterRefund.status, "refunded");
    assertEquals(afterRefund.replayed, true);
  } finally {
    await db.close();
  }
});

Deno.test("the counter is per user", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 2);
    await fund(db, OTHER, 2);

    for (let i = 1; i <= FREE; i++) {
      const claimed = await claim(db, WRITER, `w-${i}`);
      await complete(db, claimed.operation_id, WRITER);
    }
    const writerPaid = await claim(db, WRITER, "w-7");
    assertEquals(writerPaid.credits, 1);

    // Spending one person's allowance must not touch anybody else's.
    const otherFirst = await claim(db, OTHER, "o-1");
    assertEquals(otherFirst.credits, 0);
    assertEquals(otherFirst.free_remaining, FREE - 1);
    assertEquals(await balance(db, OTHER), 2);
  } finally {
    await db.close();
  }
});

Deno.test("an anonymous identity's existing count carries into the allowance", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // The shape of a row 00084 left behind in production: an image already
    // spent on an anonymous identity before 00088 existed. Written through the
    // superseded claim, because that is what put it there.
    await db.query("select claim_guest_portrait_request($1)", [GUEST]);
    assertEquals(await freeUsed(db, GUEST), 1);

    // One carried -- not a fresh allowance, and not orphaned.
    const next = await claim(db, GUEST, "after-migration");
    assertEquals(next.credits, 0);
    assertEquals(next.free_remaining, FREE - 2);
    await complete(db, next.operation_id, GUEST);

    for (let i = 1; i <= FREE - 2; i++) {
      const more = await claim(db, GUEST, `more-${i}`);
      assertEquals(more.credits, 0);
      await complete(db, more.operation_id, GUEST);
    }

    // One past the allowance. The guest was funded 0, so it is a refusal
    // rather than a charge -- which is the free tier's wall, and it is a wall
    // you can pay past rather than one you sign in past.
    await assertRejects(
      () => claim(db, GUEST, "one-too-many"),
      Error,
      "Insufficient credits",
    );
  } finally {
    await db.close();
  }
});

Deno.test("the free allowance reader agrees with the counter", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const start = await db.query<{ remaining: number }>(
      "select character_image_free_remaining($1) as remaining",
      [WRITER],
    );
    // No row yet. A user who has never made one has all of them, and the reader
    // must say so rather than returning null for a missing row.
    assertEquals(start.rows[0].remaining, FREE);

    for (let i = 1; i <= FREE; i++) {
      const claimed = await claim(db, WRITER, `r-${i}`);
      await complete(db, claimed.operation_id, WRITER);
    }
    const spent = await db.query<{ remaining: number }>(
      "select character_image_free_remaining($1) as remaining",
      [WRITER],
    );
    assertEquals(spent.rows[0].remaining, 0);
  } finally {
    await db.close();
  }
});

Deno.test("a blank or oversized request id is refused rather than counted", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (const bad of ["", "   ", "x".repeat(129)]) {
      await assertRejects(
        () => claim(db, WRITER, bad),
        Error,
        "Invalid character image request ID",
      );
    }
    await assertRejects(() =>
      db.query("select claim_character_image_request(null, 'req')")
    );
    assertEquals(await freeUsed(db, WRITER), 0);
  } finally {
    await db.close();
  }
});

Deno.test("releasing an operation that belongs to somebody else is refused", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 2);
    const claimed = await claim(db, WRITER, "mine");

    // The user id is an argument taken on trust from the edge function, so the
    // pair must match. A release keyed on the operation alone would let one
    // caller settle another's reservation.
    await assertRejects(
      () => release(db, claimed.operation_id, OTHER),
      Error,
      "Character image operation not found",
    );
    assertEquals(await freeUsed(db, WRITER), 1);
  } finally {
    await db.close();
  }
});

Deno.test("only the service role may execute any of these", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const claimed = await claim(db, WRITER, "before-role-change");

    await db.exec("set role authenticated");
    for (
      const statement of [
        "select claim_character_image_request($1, 'x')",
        "select character_image_free_remaining($1)",
      ]
    ) {
      await assertRejects(() => db.query(statement, [WRITER]));
    }
    await assertRejects(() =>
      db.query("select complete_character_image_request($1, $2)", [
        claimed.operation_id,
        WRITER,
      ])
    );
    await assertRejects(() =>
      db.query("select release_character_image_request($1, $2, 'x')", [
        claimed.operation_id,
        WRITER,
      ])
    );
    // A row that says what a user was charged is not a row the user may read,
    // and one they could write is not a charge at all.
    await assertRejects(() =>
      db.query("select * from character_image_operations")
    );
    await db.exec("reset role");

    // And the service role can read it, which is what support needs when
    // somebody says they were charged and got nothing.
    await db.exec("set role service_role");
    const rows = await db.query("select * from character_image_operations");
    assert(rows.rows.length === 1);
    await assertRejects(() =>
      db.query(
        "insert into character_image_operations(user_id, request_id) values ($1, 'by-hand')",
        [WRITER],
      )
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

// An anonymous identity gets its free images and no more, whatever its balance.
//
// Its credits are the three from `bootstrap_user`, and those exist to get it a
// STORY — the thing that converts it. Spent on portraits instead, the user ends
// up with no story, us with three provider bills, and nothing to convert them
// with. The wall is there to be converted, not waited out, which is what its
// copy has always said: "Sign in to keep making characters."
Deno.test("an anonymous caller may use its free images and never buy one more", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const user = GUEST;
    await fund(db, user, 50);
    for (let n = 1; n <= FREE; n += 1) {
      const free = await claim(db, user, `anon-${n}`, false);
      assertEquals(free.credits, 0);
    }
    // All free ones spent, fifty credits in hand, and still refused.
    let refused = false;
    try {
      await claim(db, user, "anon-over", false);
    } catch (error) {
      refused = String(error).includes("Insufficient credits");
    }
    assertEquals(refused, true);

    // Nothing was reserved, so the id is still usable after they sign in.
    const bought = await claim(db, user, "anon-over", true);
    assertEquals(bought.credits, 1);
  } finally {
    await db.close();
  }
});

// The default is the safe direction: a caller that forgets the argument must
// refuse to spend rather than spend.
Deno.test("the purchase flag defaults to refusing", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const user = GUEST;
    await fund(db, user, 50);
    for (let n = 1; n <= FREE; n += 1) await claim(db, user, `d-${n}`, false);
    const result = await db.query<{ ok: boolean }>(
      `select exists(
         select 1 from public.character_image_operations
         where user_id = $1 and request_id = 'd-default'
       ) as ok`,
      [user],
    );
    assertEquals(result.rows[0].ok, false);
    let refused = false;
    try {
      // Two arguments only — the third falls to its default.
      await db.query("select claim_character_image_request($1, 'd-default')", [
        user,
      ]);
    } catch {
      refused = true;
    }
    assertEquals(refused, true);
  } finally {
    await db.close();
  }
});

// One reservation draws once. A replay used to hand the reserved row back as
// usable, so two concurrent deliveries of the same request id both called the
// provider — and we paid twice for one charge.
Deno.test("a second delivery of a live reservation is told it is in flight", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 10);
    const first = await claim(db, WRITER, "redelivered");
    assertEquals(first.drawing, true);

    const second = await claim(db, WRITER, "redelivered");
    assertEquals(second.replayed, true);
    // Same reservation, and this delivery must NOT draw.
    assertEquals(second.drawing, false);
    assertEquals(second.operation_id, first.operation_id);
  } finally {
    await db.close();
  }
});

// The window exists so a delivery whose worker DIED can still be retried.
// Without it a crashed attempt would hold its reservation for ever and the
// user could never get the image they had already been charged for.
Deno.test("a stale claim can be taken again", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await fund(db, WRITER, 10);
    const first = await claim(db, WRITER, "crashed");
    assertEquals(first.drawing, true);

    // The worker died four minutes ago.
    await db.query(
      `update public.character_image_operations
       set draw_claimed_at = now() - interval '4 minutes'
       where id = $1`,
      [first.operation_id],
    );

    const retry = await claim(db, WRITER, "crashed");
    assertEquals(retry.drawing, true);
    assertEquals(retry.operation_id, first.operation_id);
    // Still one charge, not two.
    assertEquals(retry.credits, first.credits);
  } finally {
    await db.close();
  }
});

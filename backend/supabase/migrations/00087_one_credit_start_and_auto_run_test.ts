// 00087: the settled start price and the pre-bought auto run, executed rather
// than inspected.
//
// The lesson 00071 paid for applies to every line of the migration under test:
// a plpgsql body is parsed when it RUNS, so a mistake inside one deploys
// cleanly and passes any test that only checks the function exists. Every
// assertion below calls the function and reads the ledger afterwards, because
// the thing under test is money.
//
// The arithmetic these tests pin, which is now the same arithmetic
// `source-of-truth/CREDITS_AND_PRICING.md` §1 states:
//
//   * starting a story: 1 credit, bundling the cast, chapter one's words and
//     chapter one's art (the cover);
//   * a one-chapter story: 1 credit in total, because nothing else is charged;
//   * every chapter after the first: 1, or 2 when the story illustrates them;
//   * a 3-chapter illustrated story: 5 = 1 + 2 + 2.
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

const USER = "00000000-0000-4000-8000-000000000870";
const RUN = "00000000-0000-4000-8000-0000000008a0";

async function seed(db: PGlite, credits: number) {
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query("insert into profiles(id) values ($1)", [USER]);
  await db.query(
    "select grant_credit($1, $2, 'welcome', 'auto-run-test', 'welcome:auto-run-test')",
    [USER, credits],
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

type Begun = { story_id: string; operation_id: string; balance: number };

/** A story exactly as the create brief would begin one. */
async function makeStory(
  db: PGlite,
  requestId: string,
  options: {
    flow?: "interactive" | "auto";
    mode?: "series" | "standalone";
    planned?: number;
    illustrate?: boolean;
  } = {},
): Promise<Begun> {
  const begun = await db.query<{ result: Begun }>(
    `select begin_story_generation(
       $1, $2, 'Untitled', 'mystery', array['mystery']::text[], 'adult',
       array[]::text[], 'sweet', $3, 'An idea.', 'English',
       null, 'standard', $4, array[]::text[], array[]::text[], null, null,
       $5, array[]::text[], 'auto', $6) as result`,
    [
      USER,
      requestId,
      options.mode ?? "series",
      options.planned ?? 3,
      options.illustrate ?? false,
      options.flow ?? "interactive",
    ],
  );
  return begun.rows[0].result;
}

type Run = {
  chapters: number;
  from_chapter: number;
  through_chapter: number;
  credits: number;
  credits_per_chapter: number;
  balance: number;
  reserved: boolean;
};

async function reserveRun(db: PGlite, storyId: string, from: number, run = RUN) {
  const result = await db.query<{ result: Run }>(
    "select reserve_auto_chapter_run($1, $2, $3, $4) as result",
    [USER, storyId, run, from],
  );
  return result.rows[0].result;
}

// ---------------------------------------------------------------------------
// Part 1 -- the start price
// ---------------------------------------------------------------------------

Deno.test("starting a story costs one credit, not three", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const before = await balanceOf(db);
    const begun = await makeStory(db, "start-price");
    assertEquals(before - Number(begun.balance), 1);
    assertEquals(await balanceOf(db), 9);

    // And the ledger says so, not just the returned number.
    const debit = await db.query<{ amount: number }>(
      `select amount from credit_ledger
       where user_id = $1 and reference_id = $2 and reason = 'generation'`,
      [USER, begun.operation_id],
    );
    assertEquals(Number(debit.rows[0].amount), -1);
  } finally {
    await db.close();
  }
});

Deno.test("a one-chapter story costs exactly one credit in total", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "one-chapter", {
      flow: "auto",
      planned: 1,
    });
    // Auto mode pre-buys the rest of the plan. There is no rest of the plan.
    const run = await reserveRun(db, begun.story_id, 2);
    assertEquals(run.chapters, 0);
    assertEquals(await balanceOf(db), 9);
  } finally {
    await db.close();
  }
});

Deno.test("a failed one-credit start refunds exactly one", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "failed-start");
    await db.query(
      "select refund_generation_operation($1, $2, 'provider down')",
      [begun.operation_id, USER],
    );
    // Not three. `refund_generation_operation` clamps the story refund with
    // `least(3, actual debit)`, so the ceiling never pays out more than the
    // start took.
    assertEquals(await balanceOf(db), 10);
  } finally {
    await db.close();
  }
});

Deno.test("a bundled start refunds no separate credit for a missing cover", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "missing-cover");
    // The cover failed. At the legacy 3-credit start this gave back the
    // cover's own credit; at 1 there is no separate credit to give back, and
    // paying one out would refund the whole story the writer read and kept.
    const refunded = await db.query<{ result: number }>(
      "select refund_story_media_component($1, $2, 'cover') as result",
      [begun.operation_id, USER],
    );
    assertEquals(Number(refunded.rows[0].result), 9);
    assertEquals(await balanceOf(db), 9);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Part 2 -- the pre-bought run
// ---------------------------------------------------------------------------

Deno.test("a run of N chapters takes exactly N credits, in one transaction", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "run-of-five", {
      flow: "auto",
      planned: 6,
    });
    assertEquals(await balanceOf(db), 9);

    const run = await reserveRun(db, begun.story_id, 2);
    assertEquals(run.chapters, 5); // chapters 2..6
    assertEquals(run.credits, 5);
    assertEquals(run.through_chapter, 6);
    assertEquals(await balanceOf(db), 4);

    // One reserved operation per chapter, all carrying the run id, and one
    // debit each keyed to its own operation -- which is what lets the existing
    // per-chapter refund path price them without a second price table.
    const reserved = await db.query<{ chapter_number: number }>(
      `select chapter_number from generation_operations
       where story_id = $1 and auto_run_id = $2 and status = 'reserved'
       order by chapter_number`,
      [begun.story_id, RUN],
    );
    assertEquals(reserved.rows.map((row) => Number(row.chapter_number)), [
      2,
      3,
      4,
      5,
      6,
    ]);

    const stored = await db.query<{ through: number }>(
      "select auto_run_through_chapter as through from stories where id = $1",
      [begun.story_id],
    );
    assertEquals(Number(stored.rows[0].through), 6);
  } finally {
    await db.close();
  }
});

Deno.test("an illustrated run costs two credits a chapter", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 11);
    const begun = await makeStory(db, "illustrated-run", {
      flow: "auto",
      planned: 3,
      illustrate: true,
    });
    // 1 to start. A 3-chapter illustrated story is 5 = 1 + 2 + 2.
    assertEquals(await balanceOf(db), 10);
    const run = await reserveRun(db, begun.story_id, 2);
    assertEquals(run.chapters, 2);
    assertEquals(run.credits_per_chapter, 2);
    assertEquals(run.credits, 4);
    assertEquals(await balanceOf(db), 6);
  } finally {
    await db.close();
  }
});

Deno.test("the run stops at the balance, and buys whole chapters only", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 6);
    const begun = await makeStory(db, "short-balance", {
      flow: "auto",
      planned: 15,
      illustrate: true,
    });
    assertEquals(await balanceOf(db), 5);
    const run = await reserveRun(db, begun.story_id, 2);
    // Five credits buys two illustrated chapters, not two and a half. The odd
    // credit stays with the writer.
    assertEquals(run.chapters, 2);
    assertEquals(run.through_chapter, 3);
    assertEquals(await balanceOf(db), 1);
  } finally {
    await db.close();
  }
});

Deno.test("an insufficient balance reserves nothing at all", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 1);
    const begun = await makeStory(db, "broke", { flow: "auto", planned: 5 });
    assertEquals(await balanceOf(db), 0);

    const run = await reserveRun(db, begun.story_id, 2);
    assertEquals(run.chapters, 0);
    assertEquals(run.credits, 0);
    assertEquals(run.reserved, false);
    assertEquals(await balanceOf(db), 0);

    // Not a partial run: no reserved rows, no debits beyond the start.
    const rows = await db.query<{ count: number }>(
      `select count(*)::int as count from generation_operations
       where story_id = $1 and auto_run_id is not null`,
      [begun.story_id],
    );
    assertEquals(Number(rows.rows[0].count), 0);

    // And the row records "a run was considered and bought nothing", which is
    // a different fact from "this story predates runs" -- the client tells the
    // two apart by null.
    const stored = await db.query<{ through: number | null }>(
      "select auto_run_through_chapter as through from stories where id = $1",
      [begun.story_id],
    );
    assertEquals(Number(stored.rows[0].through), 1);
  } finally {
    await db.close();
  }
});

Deno.test("an interactive story never pre-buys", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "interactive", { planned: 5 });
    const run = await reserveRun(db, begun.story_id, 2);
    assertEquals(run.chapters, 0);
    assertEquals(await balanceOf(db), 9);
    const stored = await db.query<{ through: number | null }>(
      "select auto_run_through_chapter as through from stories where id = $1",
      [begun.story_id],
    );
    assertEquals(stored.rows[0].through, null);
  } finally {
    await db.close();
  }
});

Deno.test("a second run cannot be stacked over a live one", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "no-stack", { flow: "auto", planned: 4 });
    const first = await reserveRun(db, begun.story_id, 2);
    assertEquals(first.chapters, 3);
    const after = await balanceOf(db);

    const second = await reserveRun(
      db,
      begun.story_id,
      2,
      "00000000-0000-4000-8000-0000000008b0",
    );
    assertEquals(second.chapters, 0);
    assertEquals(second.through_chapter, 4);
    assertEquals(await balanceOf(db), after);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Claiming -- the chapter the run already paid for
// ---------------------------------------------------------------------------

Deno.test("writing a pre-bought chapter claims it and charges nothing", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "claim", { flow: "auto", planned: 4 });
    await reserveRun(db, begun.story_id, 2);
    const after = await balanceOf(db);

    const claimed = await db.query<
      { result: { credits: number; prepaid: boolean; id: string } }
    >(
      `select reserve_generation_operation(
         $1, 'write-chapter-2', $2, 2, 'continuation', false, null) as result`,
      [USER, begun.story_id],
    );
    assertEquals(claimed.rows[0].result.prepaid, true);
    assertEquals(Number(claimed.rows[0].result.credits), 0);
    assertEquals(await balanceOf(db), after);

    // The claim adopts the caller's request id, so an ordinary retry replays
    // through the (user_id, request_id) lookup exactly as an unbought chapter
    // would.
    const replay = await db.query<{ result: { replayed: boolean } }>(
      `select reserve_generation_operation(
         $1, 'write-chapter-2', $2, 2, 'continuation', false, null) as result`,
      [USER, begun.story_id],
    );
    assertEquals(replay.rows[0].result.replayed, true);
    assertEquals(await balanceOf(db), after);
  } finally {
    await db.close();
  }
});

Deno.test("a second request for a claimed chapter is refused, not re-sold", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "double-claim", {
      flow: "auto",
      planned: 4,
    });
    await reserveRun(db, begun.story_id, 2);
    await db.query(
      `select reserve_generation_operation(
         $1, 'first', $2, 2, 'continuation', false, null)`,
      [USER, begun.story_id],
    );
    const after = await balanceOf(db);

    await assertRejects(() =>
      db.query(
        `select reserve_generation_operation(
           $1, 'second', $2, 2, 'continuation', false, null)`,
        [USER, begun.story_id],
      )
    );
    assertEquals(await balanceOf(db), after);
  } finally {
    await db.close();
  }
});

Deno.test("an interactive story still reserves and pays per chapter", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "per-chapter", { planned: 4 });
    const after = await balanceOf(db);
    const reserved = await db.query<{ result: { credits: number } }>(
      `select reserve_generation_operation(
         $1, 'chapter-2', $2, 2, 'continuation', false, null) as result`,
      [USER, begun.story_id],
    );
    assertEquals(Number(reserved.rows[0].result.credits), 1);
    assertEquals(await balanceOf(db), after - 1);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Refunding the unused remainder
// ---------------------------------------------------------------------------

Deno.test("a run that fails at chapter four of six refunds exactly three", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "fail-at-four", {
      flow: "auto",
      planned: 6,
    });
    const run = await reserveRun(db, begun.story_id, 2);
    assertEquals(run.chapters, 5);
    assertEquals(await balanceOf(db), 4);

    // Chapters 2 and 3 were written and kept; chapter 4 was claimed and the
    // provider failed on it; 5 and 6 were never attempted.
    for (const chapter of [2, 3]) {
      const claimed = await db.query<{ result: { id: string } }>(
        `select reserve_generation_operation(
           $1, $2, $3, $4, 'continuation', false, null) as result`,
        [USER, `written-${chapter}`, begun.story_id, chapter],
      );
      await db.query(
        `update generation_operations set status = 'completed' where id = $1`,
        [claimed.rows[0].result.id],
      );
    }
    await db.query(
      `select reserve_generation_operation(
         $1, 'failed-4', $2, 4, 'continuation', false, null)`,
      [USER, begun.story_id],
    );

    const refunded = await db.query<
      { result: { chapters: number; credits: number } }
    >(
      "select refund_auto_chapter_run($1, $2, 4, 'provider down') as result",
      [USER, begun.story_id],
    );
    assertEquals(Number(refunded.rows[0].result.chapters), 3);
    assertEquals(Number(refunded.rows[0].result.credits), 3);
    // 10 - 1 start - 5 run + 3 remainder. The writer is charged 1 + 2 = 3 for
    // the story and the two chapters they actually received.
    assertEquals(await balanceOf(db), 7);

    const stored = await db.query<{ through: number }>(
      "select auto_run_through_chapter as through from stories where id = $1",
      [begun.story_id],
    );
    assertEquals(Number(stored.rows[0].through), 3);
  } finally {
    await db.close();
  }
});

Deno.test("refunding a run twice does not refund twice", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "double-refund", {
      flow: "auto",
      planned: 6,
    });
    await reserveRun(db, begun.story_id, 2);
    assertEquals(await balanceOf(db), 4);

    const first = await db.query<{ result: { credits: number } }>(
      "select refund_auto_chapter_run($1, $2, 2, 'stopped') as result",
      [USER, begun.story_id],
    );
    assertEquals(Number(first.rows[0].result.credits), 5);
    assertEquals(await balanceOf(db), 9);

    const second = await db.query<
      { result: { chapters: number; credits: number } }
    >(
      "select refund_auto_chapter_run($1, $2, 2, 'stopped') as result",
      [USER, begun.story_id],
    );
    assertEquals(Number(second.rows[0].result.chapters), 0);
    assertEquals(Number(second.rows[0].result.credits), 0);
    assertEquals(await balanceOf(db), 9);
  } finally {
    await db.close();
  }
});

Deno.test("an illustrated run refunds two credits a chapter", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 12);
    const begun = await makeStory(db, "illustrated-refund", {
      flow: "auto",
      planned: 4,
      illustrate: true,
    });
    const run = await reserveRun(db, begun.story_id, 2);
    assertEquals(run.chapters, 3);
    assertEquals(await balanceOf(db), 5);

    const refunded = await db.query<{ result: { credits: number } }>(
      "select refund_auto_chapter_run($1, $2, 3, 'stopped') as result",
      [USER, begun.story_id],
    );
    // Chapters 3 and 4, at the price they were actually debited.
    assertEquals(Number(refunded.rows[0].result.credits), 4);
    assertEquals(await balanceOf(db), 9);
  } finally {
    await db.close();
  }
});

Deno.test("a refund never marks a story that never pre-bought", async () => {
  const db = await createDatabase();
  try {
    await seed(db, 10);
    const begun = await makeStory(db, "never-bought", { planned: 4 });
    await db.query(
      "select refund_auto_chapter_run($1, $2, 2, 'stopped')",
      [USER, begun.story_id],
    );
    const stored = await db.query<{ through: number | null }>(
      "select auto_run_through_chapter as through from stories where id = $1",
      [begun.story_id],
    );
    assert(stored.rows[0].through === null);
  } finally {
    await db.close();
  }
});

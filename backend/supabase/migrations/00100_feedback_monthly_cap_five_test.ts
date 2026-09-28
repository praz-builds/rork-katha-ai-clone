// 00100: the feedback claim's monthly cap is five, enforced where it is paid
// and reported where it is listed.
//
// The same lesson every migration test since 00071 restates: a plpgsql body is
// parsed when it RUNS, so a broken function deploys cleanly and passes a test
// that only checks it exists. Every assertion below calls the function and
// then reads the ledger, because what is under test is money.
//
// WHY BOTH FUNCTIONS. 00100 changes one digit in two places and they are
// reached by different callers. `claim_comment_credit` refuses the sixth claim
// (through `comment_credit_block_reason`, which it re-derives under the lock);
// `comment_credit_claims` is what draws the "N left this month" line on the
// Credits screen. A change to one and not the other would pay correctly while
// promising wrongly, or the reverse, and neither shows up as an error.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

/** Every migration in this directory, in order. 00100 is the last of them. */
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

const READER = "00000000-0000-4000-8000-000000000a01";
const AUTHOR = "00000000-0000-4000-8000-000000000a02";

const LONG =
  "This chapter turned the whole premise on its head and I loved it.";

async function seedUser(db: PGlite, id: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query(
    "insert into profiles(id) values ($1) on conflict do nothing",
    [id],
  );
}

/**
 * `count` stories by the author, each read for long enough and each commented
 * on by the reader. Returns the comment ids in the order the stories were
 * made, so a test can claim them one at a time.
 */
async function seedReadAndCommented(
  db: PGlite,
  count: number,
): Promise<string[]> {
  for (const id of [READER, AUTHOR]) await seedUser(db, id);
  const comments: string[] = [];
  for (let i = 0; i < count; i++) {
    const storyId = `00000000-0000-4000-8000-00000000a10${i}`;
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
       values ($1, $2, 'S', array['romance'], 'romance', true, 'complete')`,
      [storyId, AUTHOR],
    );
    await db.query(
      `insert into story_reads (story_id, user_id, duration_seconds, read_at)
       values ($1, $2, 200, now() - interval '1 hour')`,
      [storyId, READER],
    );
    const result = await db.query<{ id: string }>(
      `insert into comments (user_id, story_id, content) values ($1, $2, $3)
       returning id`,
      [READER, storyId, LONG],
    );
    comments.push(result.rows[0].id);
  }
  return comments;
}

type Claim = { ok: boolean; reason?: string; credits?: number; balance?: number };

async function claim(
  db: PGlite,
  commentId: string,
  requestId: string,
): Promise<Claim> {
  const result = await db.query<{ claim: Claim }>(
    "select claim_comment_credit($1, $2, $3) as claim",
    [READER, commentId, requestId],
  );
  return result.rows[0].claim;
}

/**
 * Move every paid feedback row off today but inside this calendar month, so
 * the one-a-day cap lifts and the monthly one is the only thing left standing.
 *
 * THE FIRST OF THE MONTH HAS NO SUCH TIME, and that is a property of the
 * calendar rather than of this helper. The window is `[month_start, day_start)`
 * and on the 1st those are the same instant, so it is empty: every back-dated
 * row is still "today", the daily cap fires first, and the monthly branch
 * cannot be reached at all. The original version of this placed rows at
 * `month_start + N hours` and would have failed three of four tests **twelve
 * times a year**, on a suite gated to run whenever a `.sql` file changes.
 *
 * So the helper reports whether it could do what it says. Callers that need the
 * monthly cap in isolation skip on the 1st, with `monthlyCapReachable()` saying
 * why, and the daily cap covers the same claim being refused on that one day --
 * which is the correct behaviour, not a gap: a reader who has claimed five
 * times on the 1st is stopped by the daily rule before the monthly one.
 *
 * `00089_..._test.ts` inherits the same pattern and is corrected with it.
 */
async function backdateFeedbackRows(db: PGlite, hour: number): Promise<void> {
  await db.query(
    `update credit_ledger
        set created_at = (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
                         + ($2 || ' hours')::interval
      where user_id = $1 and reason = 'feedback'`,
    [READER, String(hour)],
  );
}

/** False on the 1st of the month, when `[month_start, day_start)` is empty. */
async function monthlyCapReachable(db: PGlite): Promise<boolean> {
  const result = await db.query<{ reachable: boolean }>(
    `select date_trunc('month', now() at time zone 'UTC')
          < date_trunc('day', now() at time zone 'UTC') as reachable`,
  );
  return result.rows[0].reachable;
}

async function remaining(db: PGlite): Promise<{ today: number; month: number }> {
  const result = await db.query<
    { summary: { remaining: { today: number; month: number } } }
  >("select comment_credit_claims($1) as summary", [READER]);
  return result.rows[0].summary.remaining;
}

Deno.test("five claims a month are paid and the sixth is refused", async () => {
  const db = await createDatabase();
  try {
    if (!await monthlyCapReachable(db)) {
      // The 1st: `[month_start, day_start)` is empty, so five prior claims
      // cannot be placed off today and the daily cap refuses before the
      // monthly one is consulted. Asserted below instead of skipped silently.
      const comments = await seedReadAndCommented(db, 2);
      assertEquals((await claim(db, comments[0], "d0")).ok, true);
      assertEquals(await claim(db, comments[1], "d1"), {
        ok: false,
        reason: "daily_cap",
      });
      return;
    }

    const comments = await seedReadAndCommented(db, 6);

    // One a day is still the rule, so each claim after the first needs the
    // paid rows moved off today before the next one is attempted.
    for (let i = 0; i < 5; i++) {
      assertEquals(
        (await claim(db, comments[i], `c${i}`)).ok,
        true,
        `claim ${i + 1} of 5 should be paid`,
      );
      await backdateFeedbackRows(db, i + 1);
    }

    // Five paid this month. The sixth is refused for the month even though
    // the day is clear and the comment itself qualifies in every other way.
    assertEquals(await claim(db, comments[5], "c5"), {
      ok: false,
      reason: "monthly_cap",
    });

    const balance = await db.query<{ balance_after: number }>(
      `select balance_after from credit_ledger where user_id = $1
       order by created_at desc, ledger_sequence desc limit 1`,
      [READER],
    );
    assertEquals(balance.rows[0].balance_after, 5);
  } finally {
    await db.close();
  }
});

/**
 * THE ONE ASSERTION THAT PINS THE DIGIT, and it runs on every day of the year.
 *
 * The three tests that need five prior claims all return early on the 1st,
 * because `[month_start, day_start)` is empty and the claims cannot be placed
 * off today. That left a gap: on the 1st, a `00100` that wrote `>= 7` and
 * `greatest(7 - v_month, 0)` passed the whole file -- three early returns and
 * the read-gate test, which never touches the monthly count. Twelve days a
 * year, on the suite whose whole job is this number.
 *
 * A fresh account needs no back-dating and no prior claim: the function returns
 * `greatest(5 - 0, 0)` whatever the date. So this is unconditional, and it is
 * the test that fails if the cap is ever changed without meaning to.
 */
Deno.test("a fresh account is offered five claims this month", async () => {
  const db = await createDatabase();
  try {
    await seedReadAndCommented(db, 1);
    assertEquals(await remaining(db), { today: 1, month: 5 });
  } finally {
    await db.close();
  }
});

Deno.test("the listed remaining count counts down from five", async () => {
  const db = await createDatabase();
  try {
    if (!await monthlyCapReachable(db)) {
      // The 1st: `[month_start, day_start)` is empty, so five prior claims
      // cannot be placed off today and the daily cap refuses before the
      // monthly one is consulted. Asserted below instead of skipped silently.
      const comments = await seedReadAndCommented(db, 2);
      assertEquals((await claim(db, comments[0], "d0")).ok, true);
      assertEquals(await claim(db, comments[1], "d1"), {
        ok: false,
        reason: "daily_cap",
      });
      return;
    }

    const comments = await seedReadAndCommented(db, 6);

    assertEquals(await remaining(db), { today: 1, month: 5 });

    assertEquals((await claim(db, comments[0], "r0")).ok, true);
    assertEquals(await remaining(db), { today: 0, month: 4 });

    for (let i = 1; i < 5; i++) {
      await backdateFeedbackRows(db, i);
      assertEquals((await claim(db, comments[i], `r${i}`)).ok, true);
    }
    // Spent out for the month. `today` is 1 because the last claim was
    // back-dated off today; `month` is what stops the next one, and the
    // screen has to say 0 rather than a negative number.
    await backdateFeedbackRows(db, 5);
    assertEquals(await remaining(db), { today: 1, month: 0 });
  } finally {
    await db.close();
  }
});

// The mistake this test exists for, which CI caught on the first attempt:
// 00100 replaces `comment_credit_block_reason`, and its latest definition is
// **00090's**, not 00089's -- 00090 added a second half to the read gate, a
// read whose server-set `read_at` is a full minute older than the comment,
// which closes the one-request forgery where a read and a comment are posted
// in the same round trip. Rebuilding the function from 00089 silently reverted
// that. 00090's own test caught it, but only because it happened to exist;
// this asserts it from the migration that did the damage, so the next person
// replacing this function sees the requirement here.
Deno.test("00090's 60-second read gate survives the cap change", async () => {
  const db = await createDatabase();
  try {
    for (const id of [READER, AUTHOR]) await seedUser(db, id);
    const storyId = "00000000-0000-4000-8000-00000000a201";
    await db.query(
      `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
       values ($1, $2, 'S', array['romance'], 'romance', true, 'complete')`,
      [storyId, AUTHOR],
    );

    // A forged read: the duration is enormous, so the 120-second sum passes,
    // but `read_at` defaults to now() and the comment is written in the same
    // instant. Only the 60-second gate can refuse this.
    await db.query(
      `insert into story_reads (story_id, user_id, duration_seconds)
       values ($1, $2, 86400)`,
      [storyId, READER],
    );
    const comment = await db.query<{ id: string }>(
      `insert into comments (user_id, story_id, content) values ($1, $2, $3)
       returning id`,
      [READER, storyId, LONG],
    );

    assertEquals(await claim(db, comment.rows[0].id, "forged"), {
      ok: false,
      reason: "not_read",
    });
  } finally {
    await db.close();
  }
});

Deno.test("the sixth claim is refused without taking the credit", async () => {
  const db = await createDatabase();
  try {
    if (!await monthlyCapReachable(db)) {
      // The 1st: `[month_start, day_start)` is empty, so five prior claims
      // cannot be placed off today and the daily cap refuses before the
      // monthly one is consulted. Asserted below instead of skipped silently.
      const comments = await seedReadAndCommented(db, 2);
      assertEquals((await claim(db, comments[0], "d0")).ok, true);
      assertEquals(await claim(db, comments[1], "d1"), {
        ok: false,
        reason: "daily_cap",
      });
      return;
    }

    const comments = await seedReadAndCommented(db, 6);
    for (let i = 0; i < 5; i++) {
      await claim(db, comments[i], `p${i}`);
      await backdateFeedbackRows(db, i + 1);
    }

    await claim(db, comments[5], "p5");

    // A refusal writes nothing: five ledger rows, and the comment it refused
    // is still unclaimed and therefore still editable by its owner.
    const rows = await db.query<{ count: string }>(
      "select count(*) as count from credit_ledger where user_id = $1 and reason = 'feedback'",
      [READER],
    );
    assertEquals(Number(rows.rows[0].count), 5);

    const unclaimed = await db.query<{ credit_claimed_at: string | null }>(
      "select credit_claimed_at from comments where id = $1",
      [comments[5]],
    );
    assertEquals(unclaimed.rows[0].credit_claimed_at, null);
  } finally {
    await db.close();
  }
});

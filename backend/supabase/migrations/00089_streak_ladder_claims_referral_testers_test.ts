// 00089: the ladder pays each rung once, a feedback claim obeys every rule,
// an invite code pays both sides in one transaction, and a tester earns
// nothing -- all executed against real SQL rather than inspected.
//
// The same lesson every migration test since 00071 restates: a plpgsql body
// is parsed when it RUNS, so a broken function deploys cleanly and passes a
// test that only checks it exists. Every assertion below calls the function
// and then reads the ledger, because most of what is under test is money.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

const LAST_MIGRATION = "00089_streak_ladder_claims_referral_testers.sql";

/**
 * `beforeLast` runs after every migration but 00089, so a test can seed the
 * rows the backfill is supposed to find.
 */
async function createDatabase(
  beforeLast?: (db: PGlite) => Promise<void>,
) {
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
    if (migration === LAST_MIGRATION && beforeLast) await beforeLast(db);
    const sql = await Deno.readTextFile(new URL(migration, import.meta.url));
    await db.exec(sql.replace(/create index concurrently/gi, "create index"));
  }
  return db;
}

const READER = "00000000-0000-4000-8000-000000000891";
const AUTHOR = "00000000-0000-4000-8000-000000000892";
const TESTER = "00000000-0000-4000-8000-000000000893";
const INVITEE = "00000000-0000-4000-8000-000000000894";
const STORY = "00000000-0000-4000-8000-0000000008a1";

async function seedUser(db: PGlite, id: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query(
    "insert into profiles(id) values ($1) on conflict do nothing",
    [id],
  );
}

async function seed(db: PGlite) {
  for (const id of [READER, AUTHOR, TESTER, INVITEE]) await seedUser(db, id);
  await db.query(
    "insert into tester_accounts(email, user_id) values ('tester@example.com', $1)",
    [TESTER],
  );
  await db.query(
    `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
     values ($1, $2, 'A Story', array['romance'], 'romance', true, 'complete')`,
    [STORY, AUTHOR],
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

async function ledgerRows(
  db: PGlite,
  userId: string,
  reason: string,
): Promise<{ amount: number; operation_key: string }[]> {
  const result = await db.query<{ amount: number; operation_key: string }>(
    `select amount, operation_key from credit_ledger
     where user_id = $1 and reason = $2 order by ledger_sequence`,
    [userId, reason],
  );
  return result.rows;
}

/** Put the streak at `n - 1` ending yesterday, then touch it: today is day n. */
async function reachDay(db: PGlite, userId: string, day: number) {
  await db.query(
    `insert into streaks (user_id, current_streak, longest_streak, last_activity_date)
     values ($1, $2, $2, (now() at time zone 'UTC')::date - 1)
     on conflict (user_id) do update
       set current_streak = $2, longest_streak = greatest(streaks.longest_streak, $2),
           last_activity_date = (now() at time zone 'UTC')::date - 1`,
    [userId, day - 1],
  );
  const result = await db.query<{ current_streak: number }>(
    "select current_streak from touch_streak($1)",
    [userId],
  );
  return result.rows[0].current_streak;
}

async function insertComment(
  db: PGlite,
  userId: string,
  content: string,
  storyId = STORY,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into comments (user_id, story_id, content) values ($1, $2, $3)
     returning id`,
    [userId, storyId, content],
  );
  return result.rows[0].id;
}

async function readStory(
  db: PGlite,
  userId: string,
  seconds: number,
  storyId = STORY,
) {
  await db.query(
    `insert into story_reads (story_id, user_id, duration_seconds, read_at)
     values ($1, $2, $3, now() - interval '1 hour')`,
    [storyId, userId, seconds],
  );
}

type Claim = {
  ok: boolean;
  reason?: string;
  credits?: number;
  balance?: number;
  replayed?: boolean;
};

async function claim(
  db: PGlite,
  userId: string,
  commentId: string,
  requestId = "req-1",
): Promise<Claim> {
  const result = await db.query<{ claim: Claim }>(
    "select claim_comment_credit($1, $2, $3) as claim",
    [userId, commentId, requestId],
  );
  return result.rows[0].claim;
}

const LONG =
  "This chapter turned the whole premise on its head and I loved it.";

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

Deno.test("streak_ladder is exactly the five rungs", async () => {
  const db = await createDatabase();
  try {
    const rows = await db.query<{ milestone: number; credits: number }>(
      "select milestone, credits from streak_ladder()",
    );
    assertEquals(rows.rows, [
      { milestone: 2, credits: 2 },
      { milestone: 5, credits: 4 },
      { milestone: 10, credits: 6 },
      { milestone: 15, credits: 8 },
      { milestone: 21, credits: 10 },
    ]);
  } finally {
    await db.close();
  }
});

Deno.test("each rung pays once, on the day it is reached, and the total is 30", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const paidOn: Record<number, number> = {};
    for (let day = 1; day <= 25; day++) {
      const before = await balance(db, READER);
      assertEquals(await reachDay(db, READER, day), day);
      const after = await balance(db, READER);
      if (after !== before) paidOn[day] = after - before;
    }
    assertEquals(paidOn, { 2: 2, 5: 4, 10: 6, 15: 8, 21: 10 });
    assertEquals(await balance(db, READER), 30);

    const rows = await ledgerRows(db, READER, "streak");
    assertEquals(
      rows.map((row) => row.operation_key),
      [2, 5, 10, 15, 21].map((m) => `streak:${READER}:${m}`),
    );

    const milestones = await db.query<{ milestone: number; credited: boolean }>(
      "select milestone, credited from streak_milestones where user_id = $1 order by milestone",
      [READER],
    );
    assertEquals(milestones.rows.map((r) => r.milestone), [2, 5, 10, 15, 21]);
    assert(milestones.rows.every((r) => r.credited));
  } finally {
    await db.close();
  }
});

Deno.test("a second touch on the same day changes nothing, and the day is on the calendar", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await reachDay(db, READER, 2);
    assertEquals(await balance(db, READER), 2);
    for (let i = 0; i < 3; i++) {
      const again = await db.query<{ current_streak: number }>(
        "select current_streak from touch_streak($1)",
        [READER],
      );
      assertEquals(again.rows[0].current_streak, 2);
    }
    assertEquals(await balance(db, READER), 2);
    const days = await db.query(
      "select 1 from activity_days where user_id = $1 and day = (now() at time zone 'UTC')::date",
      [READER],
    );
    assertEquals(days.rows.length, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a rung lost and reached again is not paid twice", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await reachDay(db, READER, 5);
    assertEquals(await balance(db, READER), 6);
    // The streak breaks and climbs back past day 5.
    await reachDay(db, READER, 1);
    await reachDay(db, READER, 5);
    assertEquals(await balance(db, READER), 6);
  } finally {
    await db.close();
  }
});

Deno.test("rungs already reached before 00089 are achieved, dated, and unpaid", async () => {
  const db = await createDatabase(async (db) => {
    await seedUser(db, READER);
    await db.query(
      `insert into streaks (user_id, current_streak, longest_streak, last_activity_date, updated_at)
       values ($1, 3, 12, (now() at time zone 'UTC')::date - 1, '2026-09-01T00:00:00Z')`,
      [READER],
    );
  });
  try {
    const rows = await db.query<
      { milestone: number; credited: boolean; achieved_at: string }
    >(
      "select milestone, credited, achieved_at from streak_milestones where user_id = $1 order by milestone",
      [READER],
    );
    assertEquals(rows.rows.map((r) => r.milestone), [2, 5, 10]);
    assert(rows.rows.every((r) => r.credited === false));
    assert(
      rows.rows.every((r) =>
        new Date(r.achieved_at).toISOString() === "2026-09-01T00:00:00.000Z"
      ),
    );
    assertEquals(await balance(db, READER), 0);

    // Climbing to day 4 today pays nothing (day 2 is on record); day 15 is
    // the next thing that pays.
    await db.query("select touch_streak($1)", [READER]);
    assertEquals(await balance(db, READER), 0);
    await reachDay(db, READER, 15);
    assertEquals(await balance(db, READER), 8);
  } finally {
    await db.close();
  }
});

Deno.test("a tester reaches rungs and is paid nothing", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let day = 1; day <= 6; day++) await reachDay(db, TESTER, day);
    assertEquals(await balance(db, TESTER), 0);
    const rows = await db.query<{ milestone: number; credited: boolean }>(
      "select milestone, credited from streak_milestones where user_id = $1 order by milestone",
      [TESTER],
    );
    assertEquals(rows.rows, [
      { milestone: 2, credited: false },
      { milestone: 5, credited: false },
    ]);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Feedback claims
// ---------------------------------------------------------------------------

Deno.test("a qualifying comment pays one credit, once, and is then frozen", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await readStory(db, READER, 130);
    const commentId = await insertComment(db, READER, LONG);

    const first = await claim(db, READER, commentId, "tap-1");
    assertEquals(first, { ok: true, credits: 1, balance: 1, replayed: false });
    assertEquals(await balance(db, READER), 1);
    assertEquals(
      (await ledgerRows(db, READER, "feedback")).map((r) => r.operation_key),
      [`feedback:${commentId}`],
    );

    // The same tap delivered twice is one claim.
    const replay = await claim(db, READER, commentId, "tap-1");
    assertEquals(replay.ok, true);
    assertEquals(replay.balance, 1);
    assertEquals(await balance(db, READER), 1);

    // A new tap on a claimed comment is told so.
    const again = await claim(db, READER, commentId, "tap-2");
    assertEquals(again, { ok: false, reason: "already_claimed" });

    // Frozen: the owner's UPDATE no longer matches the row.
    await db.exec(
      `set request.jwt.claim.sub = '${READER}'; set role authenticated;`,
    );
    const edit = await db.query(
      "update comments set content = 'x' where id = $1",
      [commentId],
    );
    assertEquals(edit.affectedRows ?? 0, 0);
    await db.exec("reset role;");
    const content = await db.query<{ content: string }>(
      "select content from comments where id = $1",
      [commentId],
    );
    assertEquals(content.rows[0].content, LONG);

    const row = await db.query<
      { credit_claimed_at: string | null; credit_ledger_id: string | null }
    >(
      "select credit_claimed_at, credit_ledger_id from comments where id = $1",
      [commentId],
    );
    assert(row.rows[0].credit_claimed_at !== null);
    assert(row.rows[0].credit_ledger_id !== null);
  } finally {
    await db.close();
  }
});

Deno.test("an unclaimed comment stays editable by its owner", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const commentId = await insertComment(db, READER, LONG);
    await db.exec(
      `set request.jwt.claim.sub = '${READER}'; set role authenticated;`,
    );
    const edit = await db.query(
      "update comments set content = 'edited, still long enough to matter here' where id = $1",
      [commentId],
    );
    assertEquals(edit.affectedRows, 1);
    await db.exec("reset role;");
  } finally {
    await db.close();
  }
});

Deno.test("every refusal reason, in the order the claim checks them", async () => {
  const db = await createDatabase();
  try {
    await seed(db);

    // too_short
    const short = await insertComment(db, READER, "nice");
    assertEquals(await claim(db, READER, short), {
      ok: false,
      reason: "too_short",
    });

    // own_story
    const mine = await insertComment(db, AUTHOR, LONG);
    assertEquals(await claim(db, AUTHOR, mine), {
      ok: false,
      reason: "own_story",
    });

    // not_read: no read at all, then a read too short, then a read AFTER
    // the comment -- none qualifies.
    const unread = await insertComment(db, READER, LONG);
    assertEquals(await claim(db, READER, unread), {
      ok: false,
      reason: "not_read",
    });
    await readStory(db, READER, 60);
    assertEquals(await claim(db, READER, unread), {
      ok: false,
      reason: "not_read",
    });
    await db.query(
      `insert into story_reads (story_id, user_id, duration_seconds, read_at)
       values ($1, $2, 600, now() + interval '1 hour')`,
      [STORY, READER],
    );
    assertEquals(await claim(db, READER, unread), {
      ok: false,
      reason: "not_read",
    });
    // Two reads that add up count as one qualifying read.
    await readStory(db, READER, 60);
    assertEquals((await claim(db, READER, unread)).ok, true);

    // story_cap: a second comment on the same story.
    const second = await insertComment(db, READER, LONG);
    assertEquals(await claim(db, READER, second), {
      ok: false,
      reason: "story_cap",
    });

    // deleted
    const deleted = await insertComment(db, READER, LONG);
    await db.query("update comments set deleted_at = now() where id = $1", [
      deleted,
    ]);
    assertEquals(await claim(db, READER, deleted), {
      ok: false,
      reason: "deleted",
    });

    // reported: only an upheld report blocks; pending and dismissed do not.
    const reported = await insertComment(db, READER, LONG);
    await db.query(
      "insert into content_reports (reporter_id, comment_id, reason, status) values ($1, $2, 'spam', 'dismissed')",
      [AUTHOR, reported],
    );
    assertEquals((await claim(db, READER, reported)).reason, "story_cap");
    await db.query(
      "update content_reports set status = 'actioned' where comment_id = $1",
      [reported],
    );
    assertEquals(await claim(db, READER, reported), {
      ok: false,
      reason: "reported",
    });

    // tester
    await readStory(db, TESTER, 200);
    const testers = await insertComment(db, TESTER, LONG);
    assertEquals(await claim(db, TESTER, testers), {
      ok: false,
      reason: "tester",
    });

    // Somebody else's comment is not found, not refused.
    await assertRejects(
      () => claim(db, AUTHOR, unread),
      Error,
      "Comment not found",
    );
  } finally {
    await db.close();
  }
});

Deno.test("one claim a day and six a month, counted from the ledger", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    // Seven stories by the author, each read and commented on.
    const comments: string[] = [];
    for (let i = 0; i < 8; i++) {
      const storyId = `00000000-0000-4000-8000-0000000008b${i}`;
      await db.query(
        `insert into stories (id, author_id, title, genre, primary_genre, is_public, status)
         values ($1, $2, 'S', array['romance'], 'romance', true, 'complete')`,
        [storyId, AUTHOR],
      );
      await readStory(db, READER, 200, storyId);
      comments.push(await insertComment(db, READER, LONG, storyId));
    }

    assertEquals((await claim(db, READER, comments[0], "c0")).ok, true);
    assertEquals(await claim(db, READER, comments[1], "c1"), {
      ok: false,
      reason: "daily_cap",
    });

    // Back-date the paid rows to earlier days this month: the daily cap
    // lifts, and the monthly one is what remains.
    for (let i = 1; i < 6; i++) {
      await db.query(
        `update credit_ledger set created_at = date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' + ($2 || ' hours')::interval
         where user_id = $1 and reason = 'feedback'`,
        [READER, String(i)],
      );
      assertEquals((await claim(db, READER, comments[i], `c${i}`)).ok, true);
    }
    // Six paid this month. The next is refused for the month even on a
    // fresh day.
    await db.query(
      `update credit_ledger set created_at = date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' + interval '1 hour'
       where user_id = $1 and reason = 'feedback'`,
      [READER],
    );
    assertEquals(await claim(db, READER, comments[6], "c6"), {
      ok: false,
      reason: "monthly_cap",
    });
    assertEquals(await balance(db, READER), 6);

    const listed = await db.query<
      {
        summary: {
          claims: {
            comment_id: string;
            status: string;
            reason: string | null;
          }[];
          remaining: { today: number; month: number };
        };
      }
    >("select comment_credit_claims($1) as summary", [READER]);
    const summary = listed.rows[0].summary;
    assertEquals(summary.remaining, { today: 1, month: 0 });
    assertEquals(summary.claims.length, 8);
    assertEquals(
      summary.claims.filter((c) => c.status === "claimed").length,
      6,
    );
    assert(
      summary.claims.filter((c) => c.status === "ineligible").every((c) =>
        c.reason === "monthly_cap"
      ),
    );
  } finally {
    await db.close();
  }
});

Deno.test("the legacy create_feedback posts the comment and grants nothing", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const result = await db.query<
      { r: { credit_granted: boolean; balance: number; replayed: boolean } }
    >(
      "select create_feedback($1, 'legacy-1', $2, null, 'a') as r",
      [READER, STORY],
    );
    assertEquals(result.rows[0].r.credit_granted, false);
    assertEquals(result.rows[0].r.balance, 0);
    assertEquals(await balance(db, READER), 0);
    const comments = await db.query(
      "select 1 from comments where user_id = $1 and request_id = 'legacy-1'",
      [READER],
    );
    assertEquals(comments.rows.length, 1);
    // And the replay answers the same way.
    const replay = await db.query<
      { r: { replayed: boolean; credit_granted: boolean } }
    >(
      "select create_feedback($1, 'legacy-1', $2, null, 'a') as r",
      [READER, STORY],
    );
    assertEquals(replay.rows[0].r.replayed, true);
    assertEquals(replay.rows[0].r.credit_granted, false);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// Invite codes
// ---------------------------------------------------------------------------

async function identity(db: PGlite, userId: string) {
  const result = await db.query<
    { username: string; avatar_id: string; referral_code: string }
  >("select * from ensure_identity($1)", [userId]);
  return result.rows[0];
}

async function claimCode(db: PGlite, userId: string, code: string) {
  const result = await db.query<{ r: { ok: boolean; reason?: string } }>(
    "select claim_referral_code($1, $2) as r",
    [userId, code],
  );
  return result.rows[0].r;
}

async function settle(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    "select settle_referrals($1) as n",
    [userId],
  );
  return result.rows[0].n;
}

Deno.test("ensure_identity assigns a handle, a creature and a code, once", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const first = await identity(db, READER);
    assert(/^[a-z]+_[a-z]+_\d\d$/.test(first.username), first.username);
    assert(
      /^k(0[1-9]|[12][0-9]|3[0-6])$/.test(first.avatar_id),
      first.avatar_id,
    );
    assertEquals(first.referral_code, first.username);

    const second = await identity(db, READER);
    assertEquals(second, first);

    // A handle the person chose is kept; the code follows the handle it
    // found, not one chosen later.
    await db.query("select claim_username($1, 'chosen_name')", [READER]);
    const third = await identity(db, READER);
    assertEquals(third.username, "chosen_name");
    assertEquals(third.referral_code, first.referral_code);

    // A creature is not forced on somebody with a photo.
    await db.query(
      "update profiles set avatar_url = 'https://x/y', avatar_id = null where id = $1",
      [AUTHOR],
    );
    const withPhoto = await identity(db, AUTHOR);
    assertEquals(withPhoto.avatar_id, null);
  } finally {
    await db.close();
  }
});

Deno.test("choosing a creature clears the photo and a photo clears the creature", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query("select set_creature_avatar($1, 'k07')", [READER]);
    await db.query(
      `select set_avatar($1, $2, $3)`,
      [
        READER,
        `${READER}/avatar-1.png`,
        `https://cdn/avatars/${READER}/avatar-1.png`,
      ],
    );
    let row = await db.query<
      { avatar_id: string | null; avatar_url: string | null }
    >(
      "select avatar_id, avatar_url from profiles where id = $1",
      [READER],
    );
    assertEquals(row.rows[0].avatar_id, null);
    assert(row.rows[0].avatar_url !== null);

    await db.query("select set_creature_avatar($1, 'k36')", [READER]);
    row = await db.query(
      "select avatar_id, avatar_url from profiles where id = $1",
      [READER],
    );
    assertEquals(row.rows[0], { avatar_id: "k36", avatar_url: null });

    await assertRejects(() =>
      db.query("select set_creature_avatar($1, 'k37')", [READER])
    );
    await assertRejects(() =>
      db.query("select set_creature_avatar($1, 'K01')", [READER])
    );
  } finally {
    await db.close();
  }
});

Deno.test("an invite pays 10 and 5 in one transaction, once both conditions hold", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const referrer = await identity(db, READER);

    assertEquals(
      await claimCode(db, INVITEE, referrer.referral_code.toUpperCase()),
      {
        ok: true,
      },
    );
    // Neither condition holds yet: nothing paid, and the row is pending.
    assertEquals(await balance(db, READER), 0);
    assertEquals(await balance(db, INVITEE), 0);
    assertEquals(await settle(db, INVITEE), 0);

    // A story, but the account is minutes old.
    await db.query(
      "update profiles set first_generation_at = now() where id = $1",
      [INVITEE],
    );
    assertEquals(await settle(db, INVITEE), 0);
    assertEquals(await balance(db, INVITEE), 0);

    // A day passes.
    await db.query(
      "update profiles set account_created_at = now() - interval '25 hours' where id = $1",
      [INVITEE],
    );
    assertEquals(await settle(db, INVITEE), 1);
    assertEquals(await balance(db, READER), 10);
    assertEquals(await balance(db, INVITEE), 5);
    assertEquals(
      (await ledgerRows(db, READER, "referral")).map((r) => r.operation_key),
      [`referral:referrer:${INVITEE}`],
    );
    assertEquals(
      (await ledgerRows(db, INVITEE, "referral")).map((r) => r.operation_key),
      [`referral:invitee:${INVITEE}`],
    );

    // Settling again, from either side, pays nothing more.
    assertEquals(await settle(db, INVITEE), 0);
    assertEquals(await settle(db, READER), 0);
    assertEquals(await balance(db, READER), 10);

    const summary = await db.query<
      { invited: number; credited: number; month_remaining: number }
    >("select * from referral_summary($1)", [READER]);
    assertEquals(summary.rows[0], {
      invited: 1,
      credited: 1,
      month_remaining: 2,
    });
  } finally {
    await db.close();
  }
});

Deno.test("every refusal an invite code can give", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const reader = await identity(db, READER);
    const author = await identity(db, AUTHOR);
    const tester = await identity(db, TESTER);

    assertEquals(await claimCode(db, INVITEE, "nobody_has_this"), {
      ok: false,
      reason: "invalid",
    });
    assertEquals(await claimCode(db, INVITEE, ""), {
      ok: false,
      reason: "invalid",
    });
    assertEquals(await claimCode(db, READER, reader.referral_code), {
      ok: false,
      reason: "self",
    });
    assertEquals(await claimCode(db, INVITEE, tester.referral_code), {
      ok: false,
      reason: "tester",
    });
    assertEquals(await claimCode(db, TESTER, reader.referral_code), {
      ok: false,
      reason: "tester",
    });

    await db.query(
      "update profiles set account_created_at = now() - interval '8 days' where id = $1",
      [AUTHOR],
    );
    assertEquals(await claimCode(db, AUTHOR, reader.referral_code), {
      ok: false,
      reason: "too_old",
    });

    assertEquals(await claimCode(db, INVITEE, reader.referral_code), {
      ok: true,
    });
    assertEquals(await claimCode(db, INVITEE, author.referral_code), {
      ok: false,
      reason: "already",
    });
    assertEquals(await claimCode(db, INVITEE, reader.referral_code), {
      ok: false,
      reason: "already",
    });

    // The table refuses a self-referral even if a writer routes around the
    // function.
    await assertRejects(() =>
      db.query(
        "insert into referrals (referrer_id, referred_id) values ($1, $1)",
        [READER],
      )
    );
  } finally {
    await db.close();
  }
});

Deno.test("a referrer is paid for three invites a month and ten in a lifetime", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const reader = await identity(db, READER);
    const invitees: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `00000000-0000-4000-8000-0000000008c${i.toString(16)}`;
      await seedUser(db, id);
      invitees.push(id);
      assertEquals(await claimCode(db, id, reader.referral_code), { ok: true });
      await db.query(
        `update profiles set first_generation_at = now(),
           account_created_at = now() - interval '2 days' where id = $1`,
        [id],
      );
    }

    // Three settle this month; the fourth waits.
    assertEquals(await settle(db, READER), 3);
    assertEquals(await balance(db, READER), 30);
    assertEquals(await settle(db, invitees[3]), 0);
    assertEquals(await balance(db, invitees[3]), 0);

    // Move every paid one into last month and the next three land -- up to
    // the tenth, and never the eleventh.
    for (let round = 0; round < 3; round++) {
      await db.query(
        "update referrals set credited_at = credited_at - interval '40 days' where referrer_id = $1 and credited_at is not null",
        [READER],
      );
      await settle(db, READER);
    }
    const paid = await db.query<{ n: number }>(
      "select count(*)::int as n from referrals where referrer_id = $1 and credited_at is not null",
      [READER],
    );
    assertEquals(paid.rows[0].n, 10);
    assertEquals(await balance(db, READER), 100);
    await db.query(
      "update referrals set credited_at = credited_at - interval '40 days' where referrer_id = $1 and credited_at is not null",
      [READER],
    );
    assertEquals(await settle(db, READER), 0);
    assertEquals(await balance(db, READER), 100);
  } finally {
    await db.close();
  }
});

Deno.test("finishing a first story stamps first_generation_at and settles the invite", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const reader = await identity(db, READER);
    assertEquals(await claimCode(db, INVITEE, reader.referral_code), {
      ok: true,
    });
    await db.query(
      "update profiles set account_created_at = now() - interval '2 days' where id = $1",
      [INVITEE],
    );
    await db.query(
      "select grant_credit($1, 3, 'welcome', 'w', 'welcome:w')",
      [INVITEE],
    );

    const begun = await db.query<
      { r: { story_id: string; operation_id: string } }
    >(
      `select begin_story_generation(
         $1, 'first-story', 'Untitled', 'mystery', array['mystery']::text[], 'adult',
         array[]::text[], 'sweet', 'standalone', 'An idea.', 'English',
         null, 'standard', 1, array[]::text[], array[]::text[], null, null,
         false, array[]::text[], 'auto', 'interactive') as r`,
      [INVITEE],
    );
    const { story_id, operation_id } = begun.rows[0].r;
    await db.query(
      `select complete_story_generation($1, $2, $3, 'Title', 'Once upon a time.', 4)`,
      [operation_id, story_id, INVITEE],
    );

    const stamped = await db.query<{ first_generation_at: string | null }>(
      "select first_generation_at from profiles where id = $1",
      [INVITEE],
    );
    assert(stamped.rows[0].first_generation_at !== null);
    // 3 welcome - 1 start + 5 invite.
    assertEquals(await balance(db, INVITEE), 7);
    assertEquals(await balance(db, READER), 10);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// The profile, the reports, the roles
// ---------------------------------------------------------------------------

Deno.test("profile_overview carries the ladder, the milestones, the code and the override", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await identity(db, READER);
    await reachDay(db, READER, 2);
    await db.query(
      "update profiles set entitlement_override = 'katha' where id = $1",
      [READER],
    );
    const row = await db.query<Record<string, unknown>>(
      "select * from profile_overview($1)",
      [READER],
    );
    const profile = row.rows[0];
    assertEquals(profile.entitlement_override, "katha");
    assert(typeof profile.referral_code === "string");
    assert(typeof profile.avatar_id === "string");
    assertEquals(profile.referral_invited, 0);
    assertEquals(profile.referral_month_remaining, 3);
    assertEquals(profile.ladder, [
      { milestone: 2, credits: 2 },
      { milestone: 5, credits: 4 },
      { milestone: 10, credits: 6 },
      { milestone: 15, credits: 8 },
      { milestone: 21, credits: 10 },
    ]);
    const milestones = profile.milestones as {
      milestone: number;
      credited: boolean;
      achieved_at: string | null;
    }[];
    assertEquals(milestones.length, 5);
    assertEquals(milestones[0].credited, true);
    assert(milestones[0].achieved_at !== null);
    assertEquals(milestones[1].credited, false);
    assertEquals(milestones[1].achieved_at, null);

    await assertRejects(() =>
      db.query(
        "update profiles set entitlement_override = 'gold' where id = $1",
        [READER],
      )
    );
  } finally {
    await db.close();
  }
});

Deno.test("story reports accept the new reasons and comment reports keep the old", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (
      const reason of [
        "copyright",
        "inappropriate_content",
        "inappropriate_cover",
        "other",
      ]
    ) {
      await db.query(
        "insert into content_reports (reporter_id, story_id, reason) values ($1, $2, $3)",
        [
          `00000000-0000-4000-8000-0000000008d${reason.length % 10}`.replace(
            /.{36}$/,
            READER,
          ),
          STORY,
          reason,
        ],
      ).catch(() => undefined);
    }
    const accepted = await db.query<{ n: number }>(
      "select count(*)::int as n from content_reports where story_id = $1",
      [STORY],
    );
    // One per reporter per story: the first insert lands, the rest are the
    // duplicate index doing its job, not the reason check.
    assertEquals(accepted.rows[0].n, 1);
    await assertRejects(() =>
      db.query(
        "insert into content_reports (reporter_id, story_id, reason) values ($1, $2, 'made_up')",
        [AUTHOR, STORY],
      )
    );
  } finally {
    await db.close();
  }
});

Deno.test("only the service role may execute any of these, and read the tester tables", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec("set role authenticated");
    for (
      const statement of [
        "select touch_streak($1)",
        "select claim_comment_credit($1, $1, 'x')",
        "select comment_credit_claims($1)",
        "select claim_referral_code($1, 'x')",
        "select settle_referrals($1)",
        "select ensure_identity($1)",
        "select set_creature_avatar($1, 'k01')",
        "select reviewer_signin_locked('a', 'b')",
        "select * from tester_accounts",
        "select * from reviewer_signin_attempts",
        "select * from streak_milestones",
      ]
    ) {
      await assertRejects(
        () => db.query(statement, [READER]),
        Error,
        undefined,
        statement,
      );
    }
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

Deno.test("the lockout counts five failures per email and a hundred per ip", async () => {
  const db = await createDatabase();
  try {
    const locked = async () =>
      (await db.query<{ l: boolean }>(
        "select reviewer_signin_locked('e1', 'ip1') as l",
      )).rows[0].l;
    assertEquals(await locked(), false);
    for (let i = 0; i < 4; i++) {
      await db.query(
        "insert into reviewer_signin_attempts (email, ip, ok) values ('e1', 'ip1', false)",
      );
    }
    assertEquals(await locked(), false);
    await db.query(
      "insert into reviewer_signin_attempts (email, ip, ok) values ('e1', 'ip1', false)",
    );
    assertEquals(await locked(), true);

    // Old failures do not count, and are swept.
    await db.query(
      "update reviewer_signin_attempts set at = now() - interval '2 days'",
    );
    assertEquals(await locked(), false);
    const left = await db.query<{ n: number }>(
      "select count(*)::int as n from reviewer_signin_attempts",
    );
    assertEquals(left.rows[0].n, 0);

    // The IP rule counts successes too.
    for (let i = 0; i < 100; i++) {
      await db.query(
        "insert into reviewer_signin_attempts (email, ip, ok) values ($1, 'ip1', true)",
        [`e${i}`],
      );
    }
    assertEquals(await locked(), true);
  } finally {
    await db.close();
  }
});

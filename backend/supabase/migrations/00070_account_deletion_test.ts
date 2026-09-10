// 00070: deleting an account destroys the person and keeps their public work.
import {
  assert,
  assertEquals,
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

const LEAVER = "bbbbbbbb-0000-0000-0000-000000000001";
const READER = "bbbbbbbb-0000-0000-0000-000000000002";
const PUBLIC_STORY = "bbbbbbbb-0000-0000-0000-000000000003";
const DRAFT = "bbbbbbbb-0000-0000-0000-000000000004";

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users(id) values ('${LEAVER}'), ('${READER}');
    insert into public.profiles(id, username, display_name, avatar_url, bio)
      values ('${LEAVER}', 'nightmapper', 'Priya',
              'https://x.test/storage/v1/object/public/avatars/a/b.png',
              'Maps streets that only exist at night.'),
             ('${READER}', 'reader_two', 'Sam', null, null);

    insert into public.stories(id, author_id, title, genre, primary_genre, status, is_public)
      values ('${PUBLIC_STORY}', '${LEAVER}', 'The Night Cartographer',
              array['fantasy'], 'fantasy', 'complete', true),
             ('${DRAFT}', '${LEAVER}', 'Unfinished',
              array['fantasy'], 'fantasy', 'complete', false);

    insert into public.chapters(story_id, chapter_number, title, content, is_published)
      values ('${PUBLIC_STORY}', 1, 'One', 'Tiago kept his inks in a sardine tin.', true);

    insert into public.comments(story_id, user_id, content)
      values ('${PUBLIC_STORY}', '${LEAVER}', 'Glad this one found readers.');

    -- The reader keeps this story in their library.
    insert into public.bookmarks(user_id, story_id) values ('${READER}', '${PUBLIC_STORY}');
    insert into public.user_followers(author_id, follower_id) values ('${LEAVER}', '${READER}');

    -- The leaver's own private things.
    insert into public.bookmarks(user_id, story_id) values ('${LEAVER}', '${PUBLIC_STORY}');
    insert into public.activity_days(user_id, day) values ('${LEAVER}', (now() at time zone 'UTC')::date);
    insert into public.streaks(user_id, current_streak, longest_streak, last_activity_date)
      values ('${LEAVER}', 4, 9, (now() at time zone 'UTC')::date);
  `);
  // A financial record, which must outlive the account.
  await db.query(
    `select public.grant_credit($1, 3, 'welcome', 'seed', 'seed-key')`,
    [LEAVER],
  );
}

async function scalar<T>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const { rows } = await db.query<Record<string, T>>(sql, params);
  return Object.values(rows[0])[0];
}

// The whole reason for anonymise-and-keep: somebody else's library.
Deno.test("a reader who saved the story still has it after the author leaves", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(`select public.delete_account($1, 'not_reading', null)`, [
      LEAVER,
    ]);

    assertEquals(
      await scalar<number>(
        db,
        `select count(*)::int from public.stories where id = $1`,
        [PUBLIC_STORY],
      ),
      1,
      "the published story was destroyed",
    );
    assertEquals(
      await scalar<number>(
        db,
        `select count(*)::int from public.chapters where story_id = $1`,
        [PUBLIC_STORY],
      ),
      1,
      "the chapter went with the account",
    );
    assertEquals(
      await scalar<number>(
        db,
        `select count(*)::int from public.bookmarks where user_id = $1`,
        [READER],
      ),
      1,
      "the reader's bookmark was removed",
    );
  } finally {
    await db.close();
  }
});

Deno.test("nothing that names the person survives", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(
      `select public.delete_account($1, 'privacy', 'Too much time online.')`,
      [LEAVER],
    );

    const { rows } = await db.query<{
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      deleted_at: string | null;
    }>(
      `select username, display_name, avatar_url, bio, deleted_at
         from public.profiles where id = $1`,
      [LEAVER],
    );
    assertEquals(rows.length, 1, "the tombstone row must remain");
    assertEquals(rows[0].username, null);
    assertEquals(rows[0].display_name, null);
    assertEquals(rows[0].avatar_url, null);
    assertEquals(rows[0].bio, null);
    assert(rows[0].deleted_at !== null, "deleted_at was not set");
  } finally {
    await db.close();
  }
});

Deno.test("the handle is freed for somebody else to claim", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(`select public.delete_account($1, null, null)`, [LEAVER]);
    const { rows } = await db.query<{ ok: boolean; reason: string | null }>(
      `select ok, reason from public.claim_username($1, 'nightmapper')`,
      [READER],
    );
    assertEquals(rows[0].ok, true, `handle still taken: ${rows[0].reason}`);
  } finally {
    await db.close();
  }
});

Deno.test("private work and relationships go; the financial record stays", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(`select public.delete_account($1, null, null)`, [LEAVER]);

    for (
      const [what, sql] of [
        [
          "the unpublished draft",
          `select count(*)::int from public.stories where id = '${DRAFT}'`,
        ],
        [
          "their own bookmarks",
          `select count(*)::int from public.bookmarks where user_id = '${LEAVER}'`,
        ],
        [
          "their streak",
          `select count(*)::int from public.streaks where user_id = '${LEAVER}'`,
        ],
        [
          "their activity days",
          `select count(*)::int from public.activity_days where user_id = '${LEAVER}'`,
        ],
        [
          "the follow edge",
          `select count(*)::int from public.user_followers where author_id = '${LEAVER}'`,
        ],
      ] as const
    ) {
      assertEquals(await scalar<number>(db, sql), 0, `${what} survived`);
    }

    assert(
      await scalar<number>(
        db,
        `select count(*)::int from public.credit_ledger where user_id = $1`,
        [LEAVER],
      ) > 0,
      "the credit ledger was destroyed; it is a financial record",
    );
  } finally {
    await db.close();
  }
});

// The comment survives so its thread does, but it is no longer anyone's.
Deno.test("comments stay, and stop resolving to a name", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(`select public.delete_account($1, null, null)`, [LEAVER]);

    assertEquals(
      await scalar<number>(
        db,
        `select count(*)::int from public.comments where user_id = $1`,
        [LEAVER],
      ),
      1,
      "the comment was destroyed and its thread broken",
    );
    assertEquals(
      await scalar<string | null>(
        db,
        `select username from public.profiles where id = $1`,
        [LEAVER],
      ),
      null,
    );
  } finally {
    await db.close();
  }
});

Deno.test("a tombstone has no public profile page", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const before = await db.query(
      `select * from public.public_profile($1, null)`,
      [LEAVER],
    );
    assertEquals(before.rows.length, 1);

    await db.query(`select public.delete_account($1, null, null)`, [LEAVER]);
    const after = await db.query(
      `select * from public.public_profile($1, null)`,
      [LEAVER],
    );
    assertEquals(after.rows.length, 0, "a deleted account still has a page");
  } finally {
    await db.close();
  }
});

Deno.test("deleting twice is safe and reports the same count", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const first = await scalar<number>(
      db,
      `select public.delete_account($1, 'x', null)`,
      [LEAVER],
    );
    const second = await scalar<number>(
      db,
      `select public.delete_account($1, 'x', null)`,
      [LEAVER],
    );
    assertEquals(first, 1);
    assertEquals(second, 1, "a retried delete changed the answer");

    assertEquals(
      await scalar<number>(
        db,
        `select count(*)::int from public.account_deletion_reasons`,
      ),
      1,
      "the reason was recorded twice",
    );
  } finally {
    await db.close();
  }
});

// The reason is product feedback, not a record about a person.
Deno.test("the stored reason cannot be joined back to who left", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(
      `select public.delete_account($1, 'not_reading', 'Ran out of time.')`,
      [LEAVER],
    );
    const { rows } = await db.query<{ reason: string; detail: string | null }>(
      `select reason, detail from public.account_deletion_reasons`,
    );
    assertEquals(rows[0].reason, "not_reading");
    assertEquals(rows[0].detail, "Ran out of time.");

    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'account_deletion_reasons'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    assertEquals(
      names.includes("user_id"),
      false,
      "the reason names the person",
    );
  } finally {
    await db.close();
  }
});

// Review on PR #88: the deletion is not finished until nothing can undo it.
// The auth row is deleted by a SEPARATE call that can fail, so a tombstone can
// briefly still authenticate -- and if it could then write to its own profile,
// a deleted person could put their name back on bylines that had stopped being
// theirs.
Deno.test("a tombstone cannot be given a name, a bio, a picture or a handle again", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query(`select public.delete_account($1, null, null)`, [LEAVER]);

    const attempts: { what: string; sql: string; params: unknown[] }[] = [
      {
        what: "a display name",
        sql: `select public.set_display_name($1, 'Back Again')`,
        params: [LEAVER],
      },
      {
        what: "a bio",
        sql: `select public.set_profile_bio($1, 'Still here.')`,
        params: [LEAVER],
      },
      {
        what: "an avatar",
        sql: `select public.set_avatar($1, $2, $3)`,
        params: [LEAVER, `${LEAVER}/a.png`, `https://x.test/${LEAVER}/a.png`],
      },
    ];
    for (const { what, sql, params } of attempts) {
      let raised = false;
      try {
        await db.query(sql, params);
      } catch {
        raised = true;
      }
      assertEquals(raised, true, `a tombstone was given ${what}`);
    }

    // `claim_username` answers rather than raising, because a refusal there is
    // a normal outcome the client renders.
    const { rows } = await db.query<{ ok: boolean }>(
      `select ok from public.claim_username($1, 'backagain')`,
      [LEAVER],
    );
    assertEquals(rows[0].ok, false, "a tombstone claimed a handle");

    // And none of it landed.
    const { rows: after } = await db.query<{ display_name: string | null }>(
      `select display_name from public.profiles where id = $1`,
      [LEAVER],
    );
    assertEquals(after[0].display_name, null);
  } finally {
    await db.close();
  }
});

// A living account must be unaffected by the guard above.
Deno.test("an ordinary account can still edit its own profile", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const { rows } = await db.query<{ display_name: string }>(
      `select display_name from public.set_display_name($1, 'Renamed')`,
      [READER],
    );
    assertEquals(rows[0].display_name, "Renamed");
  } finally {
    await db.close();
  }
});

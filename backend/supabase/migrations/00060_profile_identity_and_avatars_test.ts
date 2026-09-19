import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

/**
 * The same harness every migration test in this directory uses: every
 * migration applied in order against a real Postgres, so a constraint is
 * asserted as it will actually behave rather than as it reads.
 */
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

async function attempt(db: PGlite, sql: string): Promise<string | null> {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const ADA = "00000000-0000-4000-8000-000000000601";
const BEN = "00000000-0000-4000-8000-000000000602";
const CAI = "00000000-0000-4000-8000-000000000603";

async function seedPerson(db: PGlite, id: string) {
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into profiles(id) values ($1)", [id]);
}

type ClaimRow = { ok: boolean; reason: string | null; username: string | null };

function claim(db: PGlite, id: string, name: string) {
  return db.query<ClaimRow>(
    "select ok, reason, username from claim_username($1, $2)",
    [id, name],
  );
}

Deno.test("a handle has a shape, and the shape is enforced by the column", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);

    for (
      const good of ["ada", "ada_l", "a1b", "reader_of_long_wo", "x9_9x"]
    ) {
      const result = await claim(db, ADA, good);
      assertEquals(result.rows[0].ok, true, `${good} should be claimable`);
    }

    // Case is normalized rather than rejected: a person typing their own name
    // with a capital should get the handle, not a validation error.
    const shouted = await claim(db, ADA, "  AdaLovelace  ");
    assertEquals(shouted.rows[0].ok, true);
    assertEquals(shouted.rows[0].username, "adalovelace");

    for (
      const bad of [
        "ab", // too short
        "a".repeat(21), // too long
        "_ada", // leading underscore
        "ada_", // trailing underscore
        "ada lovelace", // space
        "ada-lovelace", // hyphen
        "ada!", // punctuation
        "", // empty
      ]
    ) {
      const result = await claim(db, ADA, bad);
      assertEquals(result.rows[0].ok, false, `${bad} must be refused`);
      assertEquals(result.rows[0].reason, "invalid");
    }

    // The RPC is not the only lock. A direct write of a malformed handle --
    // service role, psql, a future migration -- is refused by the constraint.
    assertEquals(
      await attempt(
        db,
        `update profiles set username = 'Not A Handle' where id = '${ADA}'`,
      ),
      "23514",
    );
  } finally {
    await db.close();
  }
});

Deno.test("a lost race is reported as taken, not as a raw failure", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);
    await seedPerson(db, BEN);

    assertEquals((await claim(db, ADA, "storyteller")).rows[0].ok, true);

    // Ben checked availability a moment before Ada committed. The check is not
    // what protects him; the caught unique violation is.
    const lost = await claim(db, BEN, "storyteller");
    assertEquals(lost.rows[0].ok, false);
    assertEquals(lost.rows[0].reason, "taken");
    assertEquals(lost.rows[0].username, null);

    // Ben still has no handle: a lost race must not clear what he had.
    const ben = await db.query<{ username: string | null }>(
      "select username from profiles where id = $1",
      [BEN],
    );
    assertEquals(ben.rows[0].username, null);

    // Differing only by case is the same handle. The lowercase unique index is
    // what makes that true, not the regex.
    assertEquals((await claim(db, BEN, "StoryTeller")).rows[0].reason, "taken");

    // Ada re-saving her own unchanged handle is a success, not a collision.
    const again = await claim(db, ADA, "storyteller");
    assertEquals(again.rows[0].ok, true);
    assertEquals(again.rows[0].username, "storyteller");
  } finally {
    await db.close();
  }
});

Deno.test("reserved handles cannot be taken by any write path", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);

    for (const reserved of ["admin", "support", "kathaai", "moderator"]) {
      const result = await claim(db, ADA, reserved);
      assertEquals(result.rows[0].ok, false, `${reserved} must be refused`);
      assertEquals(result.rows[0].reason, "reserved");
    }

    // Not merely an application convention: the constraint refuses the direct
    // write too, which is what makes the word actually reserved.
    assertEquals(
      await attempt(
        db,
        `update profiles set username = 'admin' where id = '${ADA}'`,
      ),
      "23514",
    );
  } finally {
    await db.close();
  }
});

Deno.test("an avatar may only point at the owner's own stored object", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);
    await seedPerson(db, BEN);

    const url =
      `https://example.supabase.co/storage/v1/object/public/avatars/${ADA}/avatar.jpg`;
    const ok = await db.query<{ avatar_url: string }>(
      "select avatar_url from set_avatar($1, $2, $3)",
      [ADA, `${ADA}/avatar.jpg`, url],
    );
    assertEquals(ok.rows[0].avatar_url, url);

    // Someone else's folder.
    assertNotEquals(
      await attempt(
        db,
        `select set_avatar('${ADA}', '${BEN}/avatar.jpg',
           'https://example.supabase.co/storage/v1/object/public/avatars/${BEN}/avatar.jpg')`,
      ),
      null,
    );

    // A traversal out of the folder.
    assertNotEquals(
      await attempt(
        db,
        `select set_avatar('${ADA}', '${ADA}/../${BEN}/avatar.jpg', 'https://x/${ADA}/../${BEN}/avatar.jpg')`,
      ),
      null,
    );

    // A URL that does not address the path we just uploaded to -- the shape a
    // hijacked endpoint would produce.
    assertNotEquals(
      await attempt(
        db,
        `select set_avatar('${ADA}', '${ADA}/avatar.jpg', 'https://tracker.example/pixel.gif')`,
      ),
      null,
    );

    // And the column itself is no longer writable by an ordinary user, so
    // routing around the function is not an option either.
    const grants = await db.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'profiles'
          and grantee = 'authenticated' and privilege_type = 'UPDATE'
          and column_name in ('avatar_url', 'username')`,
    );
    assertEquals(grants.rows[0].count, "0");

    // What the owner *may* still write directly. `display_name` joined the
    // list in 00069: unlike a handle there is no scarcity to arbitrate, and
    // unlike an avatar there is no impersonation surface -- it appears on the
    // reader's own home screen, never on a byline a stranger sees.
    const editable = await db.query<{ column_name: string }>(
      `select column_name
         from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'profiles'
          and grantee = 'authenticated' and privilege_type = 'UPDATE'
        order by column_name`,
    );
    assertEquals(editable.rows.map((r) => r.column_name), [
      "bio",
      "display_name",
      "onboarding_purpose",
      "preferred_genres",
    ]);
  } finally {
    await db.close();
  }
});

Deno.test("the owner's numbers are counted, and the streak is one of them", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);
    await seedPerson(db, BEN);

    // A brand-new reader is all zeros and a null streak date. Zero is a true
    // number; there is nothing here that has to be invented.
    const fresh = await db.query<Record<string, number | null>>(
      "select * from profile_overview($1)",
      [ADA],
    );
    assertEquals(fresh.rows[0].current_streak, 0);
    assertEquals(fresh.rows[0].longest_streak, 0);
    assertEquals(fresh.rows[0].last_activity_date, null);
    assertEquals(fresh.rows[0].stories_written, 0);
    assertEquals(fresh.rows[0].followers, 0);

    await db.query(
      `insert into stories(id, author_id, title, genre, primary_genre, status,
                           is_public, read_count, like_count)
       values ('00000000-0000-4000-8000-00000000060a', $1, 'Public',
               array['romance'], 'romance', 'complete', true, 40, 7),
              ('00000000-0000-4000-8000-00000000060b', $1, 'Draft',
               array['romance'], 'romance', 'draft', false, 2, 1)`,
      [ADA],
    );
    await db.query(
      `insert into chapters(story_id, chapter_number, content)
       values ('00000000-0000-4000-8000-00000000060a', 1, 'one'),
              ('00000000-0000-4000-8000-00000000060a', 2, 'two'),
              ('00000000-0000-4000-8000-00000000060b', 1, 'draft one')`,
    );
    await db.query(
      "insert into user_followers(author_id, follower_id) values ($1, $2)",
      [ADA, BEN],
    );
    await db.query("select touch_streak($1)", [ADA]);

    const row = await db.query<Record<string, number | null>>(
      "select * from profile_overview($1)",
      [ADA],
    );
    // The owner's own view counts drafts: they are her work and she can see
    // them. This is the one place that is true.
    assertEquals(row.rows[0].stories_written, 2);
    assertEquals(row.rows[0].chapters_written, 3);
    assertEquals(row.rows[0].total_reads, 42);
    assertEquals(row.rows[0].total_likes, 8);
    assertEquals(row.rows[0].followers, 1);
    assertEquals(row.rows[0].following, 0);
    assertEquals(row.rows[0].current_streak, 1);
    assertEquals(row.rows[0].longest_streak, 1);
  } finally {
    await db.close();
  }
});

Deno.test("a streak counts UTC days, and a missed day resets it", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);

    const read = async () => {
      const row = await db.query<
        { current_streak: number; longest_streak: number }
      >(
        "select current_streak, longest_streak from streaks where user_id = $1",
        [
          ADA,
        ],
      );
      return row.rows[0];
    };

    await db.query("select touch_streak($1)", [ADA]);
    assertEquals(await read(), { current_streak: 1, longest_streak: 1 });

    // Twice on the same UTC day is one day. Reading five chapters before bed
    // must not read as a five-day streak.
    await db.query("select touch_streak($1)", [ADA]);
    await db.query("select touch_streak($1)", [ADA]);
    assertEquals(await read(), { current_streak: 1, longest_streak: 1 });

    // Yesterday continues; the day before that does not.
    await db.query(
      "update streaks set last_activity_date = (now() at time zone 'UTC')::date - 1 where user_id = $1",
      [ADA],
    );
    await db.query("select touch_streak($1)", [ADA]);
    assertEquals(await read(), { current_streak: 2, longest_streak: 2 });

    await db.query(
      `update streaks set last_activity_date = (now() at time zone 'UTC')::date - 2,
                          current_streak = 9, longest_streak = 9
        where user_id = $1`,
      [ADA],
    );
    await db.query("select touch_streak($1)", [ADA]);
    const afterBreak = await read();
    assertEquals(afterBreak.current_streak, 1);
    // The best streak survives the break. That is the number that makes a
    // reset feel like a setback rather than an erasure.
    assertEquals(afterBreak.longest_streak, 9);
  } finally {
    await db.close();
  }
});

Deno.test("a private story never reaches a public profile", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);
    await seedPerson(db, BEN);
    await seedPerson(db, CAI);
    await claim(db, ADA, "ada");

    await db.query(
      `insert into stories(id, author_id, title, genre, primary_genre, status,
                           is_public, is_curated, content_rating,
                           read_count, like_count)
       values
         -- shown
         ('00000000-0000-4000-8000-00000000061a', $1, 'Public', array['romance'],
          'romance', 'complete', true, false, 'sweet', 100, 10),
         -- a draft the author has not published
         ('00000000-0000-4000-8000-00000000061b', $1, 'Draft', array['romance'],
          'romance', 'draft', false, false, 'sweet', 5, 5),
         -- still generating
         ('00000000-0000-4000-8000-00000000061c', $1, 'Half', array['romance'],
          'romance', 'generating', false, false, 'sweet', 5, 5),
         -- complete, but its writer kept it private
         ('00000000-0000-4000-8000-00000000061d', $1, 'Private', array['romance'],
          'romance', 'complete', false, false, 'sweet', 500, 50),
         -- explicit: not shown on a public byline, so not counted on one
         ('00000000-0000-4000-8000-00000000061e', $1, 'Explicit', array['romance'],
          'romance', 'complete', true, false, 'explicit', 900, 90)`,
      [ADA],
    );
    await db.query(
      "insert into user_followers(author_id, follower_id) values ($1, $2)",
      [ADA, BEN],
    );

    const row = await db.query<Record<string, unknown>>(
      "select * from public_profile($1, $2)",
      [ADA, BEN],
    );
    const it = row.rows[0];
    assertEquals(it.username, "ada");
    assertEquals(it.stories_published, 1);
    // 100, not 605: the private story's reads would leak its existence just
    // as surely as its title would.
    assertEquals(it.total_reads, 100);
    assertEquals(it.total_likes, 10);
    assertEquals(it.followers, 1);
    assertEquals(it.is_following, true);
    assert(it.first_published_at !== null);

    // Someone who does not follow her, and a signed-out visitor.
    const stranger = await db.query<Record<string, unknown>>(
      "select is_following from public_profile($1, $2)",
      [ADA, CAI],
    );
    assertEquals(stranger.rows[0].is_following, false);
    const guest = await db.query<Record<string, unknown>>(
      "select is_following from public_profile($1, null)",
      [ADA],
    );
    assertEquals(guest.rows[0].is_following, false);

    // Nothing private is even in the shape. A column that does not exist
    // cannot be leaked by a careless endpoint that spreads the whole row.
    const columns = Object.keys(it).sort();
    assertEquals(columns, [
      "author_id",
      "avatar_url",
      "bio",
      "first_published_at",
      "followers",
      // The other half of the pair, added in 00073. A page that showed who
      // was interested in somebody while hiding who they were interested in
      // read as oddly one-sided.
      "following",
      "is_following",
      "member_since",
      "stories_published",
      "total_likes",
      "total_reads",
      "username",
    ]);

    // An author with nothing public yet reads as an author with nothing
    // public yet, not as an error and not as a zero-story stranger.
    const quiet = await db.query<Record<string, unknown>>(
      "select stories_published, first_published_at from public_profile($1, null)",
      [BEN],
    );
    assertEquals(quiet.rows[0].stories_published, 0);
    assertEquals(quiet.rows[0].first_published_at, null);
  } finally {
    await db.close();
  }
});

Deno.test("a bio is the owner's own text, and it is capped", async () => {
  const db = await createDatabase();
  try {
    await seedPerson(db, ADA);
    assertEquals(
      await attempt(
        db,
        `update profiles set bio = '${"x".repeat(200)}' where id = '${ADA}'`,
      ),
      null,
    );
    assertEquals(
      await attempt(
        db,
        `update profiles set bio = '${"x".repeat(201)}' where id = '${ADA}'`,
      ),
      "23514",
    );
  } finally {
    await db.close();
  }
});

// 00098: app feedback -- the table behind Profile's "Send feedback" sheet.
//
// Every migration applied in order against a real Postgres (PGlite), because a
// plpgsql body is parsed when it RUNS: a function that merely exists proves
// nothing.
//
// What is asserted:
//
//   1. A submission is filed, trimmed, and its optional fields kept.
//   2. A retry with the same request id replays the first row, files nothing,
//      and is not refused by the bound even when the bound is full.
//   3. Five in an hour, then refused; older rows age out of the hourly bound
//      but still count toward the daily twenty.
//   4. The bound is per user: one person at the limit does not block another.
//   5. No client role can call the function or read the table.
//   6. Deleting the account erases its feedback, and only its feedback.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { pg_trgm } from "npm:@electric-sql/pglite@0.3.14/contrib/pg_trgm";

async function createDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
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
  } catch (error) {
    await db.close();
    throw error;
  }
}

const WRITER = "00000000-0000-4000-8000-000000000971";
const OTHER = "00000000-0000-4000-8000-000000000972";

async function seed(db: PGlite) {
  for (const id of [WRITER, OTHER]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into profiles(id) values ($1)", [id]);
  }
}

type Result = { id?: string; replayed?: boolean; rate_limited: boolean };

async function submit(
  db: PGlite,
  userId: string,
  requestId: string,
  message = "The reader skipped a page.",
): Promise<Result> {
  const result = await db.query<{ result: Result }>(
    `select submit_app_feedback($1, $2, 'bug', $3, '1.0.0', 'android', 'profile')
       as result`,
    [userId, requestId, message],
  );
  return result.rows[0].result;
}

async function count(db: PGlite, userId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    "select count(*)::int as n from app_feedback where user_id = $1",
    [userId],
  );
  return result.rows[0].n;
}

/** Moves every row the user has filed back in time, as if sent earlier. */
async function age(db: PGlite, userId: string, interval: string) {
  await db.query(
    `update app_feedback set created_at = created_at - $2::interval
     where user_id = $1`,
    [userId, interval],
  );
}

Deno.test("a submission is filed, trimmed, with its optional fields", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const result = await submit(db, WRITER, "req-1", "  Music is too loud.  ");
    assertEquals(result.rate_limited, false);
    assertEquals(result.replayed, false);
    const row = await db.query<{
      message: string;
      category: string;
      app_version: string;
      platform: string;
      screen: string;
    }>(
      "select message, category, app_version, platform, screen from app_feedback where id = $1",
      [result.id],
    );
    assertEquals(row.rows[0], {
      message: "Music is too loud.",
      category: "bug",
      app_version: "1.0.0",
      platform: "android",
      screen: "profile",
    });
  } finally {
    await db.close();
  }
});

Deno.test("a retry replays the first row and is never refused by the bound", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    const first = await submit(db, WRITER, "req-1");
    for (let i = 2; i <= 5; i += 1) await submit(db, WRITER, `req-${i}`);
    // The hour is now full. The first request's retry must still succeed.
    const retry = await submit(db, WRITER, "req-1");
    assertEquals(retry, { id: first.id, replayed: true, rate_limited: false });
    assertEquals(await count(db, WRITER), 5);
  } finally {
    await db.close();
  }
});

Deno.test("five an hour, then refused; twenty a day across hours", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 1; i <= 5; i += 1) {
      assertEquals((await submit(db, WRITER, `h1-${i}`)).rate_limited, false);
    }
    assertEquals(await submit(db, WRITER, "h1-6"), { rate_limited: true });
    assertEquals(await count(db, WRITER), 5);

    // Three more hours of five each: the hourly bound resets every time.
    for (let hour = 2; hour <= 4; hour += 1) {
      await age(db, WRITER, "61 minutes");
      for (let i = 1; i <= 5; i += 1) {
        assertEquals(
          (await submit(db, WRITER, `h${hour}-${i}`)).rate_limited,
          false,
        );
      }
    }
    assertEquals(await count(db, WRITER), 20);

    // A fresh hour, but twenty inside the day: refused.
    await age(db, WRITER, "61 minutes");
    assertEquals(await submit(db, WRITER, "h5-1"), { rate_limited: true });

    // A day later, open again.
    await age(db, WRITER, "1 day");
    assertEquals((await submit(db, WRITER, "d2-1")).rate_limited, false);
  } finally {
    await db.close();
  }
});

Deno.test("the bound is per user", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    for (let i = 1; i <= 5; i += 1) await submit(db, WRITER, `w-${i}`);
    assertEquals((await submit(db, WRITER, "w-6")).rate_limited, true);
    assertEquals((await submit(db, OTHER, "o-1")).rate_limited, false);
  } finally {
    await db.close();
  }
});

Deno.test("no client role can call the function or read the table", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await submit(db, WRITER, "req-1");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assertRejects(
        () =>
          db.query(
            "select submit_app_feedback($1, 'x', 'bug', 'hi', null, null, null)",
            [WRITER],
          ),
        Error,
        "permission denied",
      );
      await assertRejects(
        () => db.query("select * from app_feedback"),
        Error,
        "permission denied",
      );
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});

Deno.test("deleting the account erases its feedback and nobody else's", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await submit(db, WRITER, "req-1");
    await submit(db, WRITER, "req-2");
    await submit(db, OTHER, "req-1");
    await db.query("select public.delete_account($1, 'privacy', null)", [
      WRITER,
    ]);
    assertEquals(await count(db, WRITER), 0);
    assertEquals(await count(db, OTHER), 1);
  } finally {
    await db.close();
  }
});

Deno.test("a deleted account with a still-valid token files nothing", async () => {
  const db = await createDatabase();
  try {
    await seed(db);
    await db.query("select public.delete_account($1, 'privacy', null)", [
      WRITER,
    ]);
    // Sign-out on the device is local, so the old token can still reach the
    // function after the erase trigger has fired.
    const late = await db.query<{ result: Record<string, unknown> }>(
      `select submit_app_feedback($1, 'late-1', 'bug', 'Still here?', '1.0.0',
         'android', 'profile') as result`,
      [WRITER],
    );
    assertEquals(late.rows[0].result, { gone: true });
    assertEquals(await count(db, WRITER), 0);
    assertEquals((await submit(db, OTHER, "o-1")).rate_limited, false);
  } finally {
    await db.close();
  }
});

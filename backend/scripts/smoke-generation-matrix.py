#!/usr/bin/env python3
"""Production matrix for the story-generation flow (2026-09-03 pipeline work).

Generates real stories across the configurations `STORY_GENERATION_FLOW.md`
describes, and asserts the behaviour the unit tests cannot reach: that the
providers answer, that the background media task actually lands a cover and
portraits, that credits move exactly once, and that the kids-mode and
word-ceiling refusals happen against the deployed functions rather than only
against the local module.

Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from the
environment. Never prints key material. Creates one fixture user and deletes it,
its stories and its auth row in `finally` - including when setup fails partway.

Usage:
    cd backend && python3 scripts/smoke-generation-matrix.py
    ... --keep    leave the fixture user and stories behind for inspection
"""
import json, os, ssl, sys, time, uuid, urllib.request, urllib.error

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()

for _var in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    if not os.environ.get(_var):
        print(f"missing {_var} in the environment")
        sys.exit(2)

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ["SUPABASE_ANON_KEY"]
SVC = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
KEEP = "--keep" in sys.argv

PASS, FAIL = [], []
# Stamped before any request, so section 11 can ask "did anything fail during
# this run" rather than "has anything ever failed".
run_started_at = None


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))
    return cond


def req(method, path, body=None, token=None, key=None, timeout=240):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, method=method)
    r.add_header("apikey", key or ANON)
    r.add_header("Authorization", f"Bearer {token or key or ANON}")
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=CTX) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:400]}
    except Exception as e:
        # Transport failures must not propagate: raising here would skip the
        # teardown in `finally` and strand rows in the production project.
        return 0, {"error": f"{type(e).__name__}: {e}"}


def rest(path, key=None):
    return req("GET", "/rest/v1/" + path, key=key or SVC)


def rpc(fn, args):
    return req("POST", f"/rest/v1/rpc/{fn}", args, key=SVC)


def balance(uid):
    _, d = rest(f"credit_ledger?user_id=eq.{uid}&select=balance_after"
                f"&order=created_at.desc,id.desc&limit=1")
    return d[0]["balance_after"] if d else 0


def rid(tag):
    return f"matrix-{tag}-{uuid.uuid4().hex[:10]}"


def generate(jwt, **body):
    body.setdefault("request_id", rid("gen"))
    return req("POST", "/functions/v1/generate-story", body, token=jwt)


def await_cover(story_id, timeout_s=240, poll_s=6):
    """Poll `cover_status` until it leaves 'generating'.

    The cover is produced on a background task after the response is flushed
    (`media.ts`), so it is not observable from the generate call. This is the
    only way to test that the task ran at all - which matters, because
    `EdgeRuntime.waitUntil` keeps the isolate alive on a best-effort basis and a
    silently-reclaimed isolate is exactly the failure worth catching in
    production rather than in review.
    """
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        _, d = rest(f"stories?id=eq.{story_id}"
                    f"&select=cover_status,cover_image_url,cover_started_at")
        if d:
            last = d[0]
            if last["cover_status"] in ("ready", "failed"):
                return last
        time.sleep(poll_s)
    return last or {"cover_status": "timeout"}


# --- Ideas, written the way a user actually types them ----------------------
# The 40-character floor is gone (decision 10), so the matrix deliberately
# includes ideas that the old gate would have refused.
IDEA_ONE_LINE = "a door that wasn't on the deed"                      # 29
IDEA_ONE_WORD = "ghosts"                                             # 6
IDEA_RICH = ("elena inherits her grandmother's house and finds a door "
             "that wasn't on the deed")
IDEA_KIDS = "a boy and a very old tortoise decide to find the sea"
IDEA_SERIES = ("a mapmaker discovers the valley she is charting quietly "
               "rearranges itself whenever she falls asleep")

CAST_RICH = [
    {"name": "Elena Márquez", "description": "Historical restorer, 34",
     "background": "Hasn't spoken to her mother in six years. Believes wood "
                   "remembers what people forget.",
     "appearance": "Dark hair pinned up, paint on her hands, her "
                   "grandmother's coat.",
     "isHero": True},
    {"name": "Tomás", "description": "The town's only locksmith, 60s",
     "background": "Knew the grandmother. Will not say how.",
     "appearance": "Heavy glasses, a cardigan with burn holes."},
]

MOMENTS = [
    "She hears her own name through the wall",
    "The door is warm to the touch",
    "Tomás refuses to make the key",
]

import datetime
# "Z", not "+00:00": the plus decodes to a space inside a query string, and
# PostgREST then rejects the value with 22007.
run_started_at = (
    datetime.datetime.now(datetime.timezone.utc)
    .isoformat()
    .replace("+00:00", "Z")
)

print("=" * 74)
print("SMOKE MATRIX - story generation flow")
print("=" * 74)
print(f"run started {run_started_at}")

uid = None
email = ""
story_ids = []

try:
    email = f"matrix+{uuid.uuid4().hex[:10]}@kathaai.test"
    pw = "Mtx!" + uuid.uuid4().hex[:12]
    print(f"\n[0] Fixture user {email}")
    s, d = req("POST", "/auth/v1/admin/users",
               {"email": email, "password": pw, "email_confirm": True}, key=SVC)
    if s not in (200, 201):
        print("  cannot create user:", s, json.dumps(d)[:300]); sys.exit(1)
    uid = d["id"]

    s, pd = req("POST", "/rest/v1/profiles",
                {"id": uid, "username": f"mtx_{uid.replace('-', '')[:16]}"}, key=SVC)
    if s not in (200, 201, 204, 409):
        print("  cannot create profile:", s, json.dumps(pd)[:250]); sys.exit(1)

    s, d = req("POST", "/auth/v1/token?grant_type=password",
               {"email": email, "password": pw})
    if s != 200:
        print("  cannot sign in:", s, json.dumps(d)[:300]); sys.exit(1)
    jwt = d["access_token"]

    gs, gd = rpc("grant_credit", {"p_user_id": uid, "p_amount": 80,
                                  "p_reason": "welcome",
                                  "p_reference_id": f"mtx-{uid[:8]}",
                                  "p_operation_key": rid("grant")})
    if gs != 200:
        print("  grant_credit failed:", gs, json.dumps(gd)[:250]); sys.exit(1)
    print(f"  signed in; balance = {balance(uid)}")

    # ---------------------------------------------------- 1 the removed gate
    print("\n[1] The 40-character gate is gone (decision 10)")
    b0 = balance(uid)
    s, d = generate(jwt, primary_genre="mystery", story_mode="standalone",
                    topic=IDEA_ONE_LINE)
    if check(f"1.1 a {len(IDEA_ONE_LINE)}-char idea generates", s == 200,
             f"HTTP {s} {json.dumps(d)[:160]}"):
        story_ids.append(d["story"]["id"])
        check("1.2 exactly 1 credit", b0 - balance(uid) == 1)
        check("1.3 response claims cover_status=generating",
              d["story"].get("cover_status") == "generating",
              str(d["story"].get("cover_status")))
    s, d = generate(jwt, primary_genre="horror", story_mode="standalone",
                    topic=IDEA_ONE_WORD)
    if check("1.4 a one-word idea generates", s == 200, f"HTTP {s}"):
        story_ids.append(d["story"]["id"])
    b1 = balance(uid)
    s, d = generate(jwt, primary_genre="mystery", topic="   ")
    check("1.5 a blank idea is still refused", s == 400, f"HTTP {s}")
    check("1.6 a refusal costs no credit", balance(uid) == b1)

    # ------------------------------------------- 2 the full brief, end to end
    print("\n[2] A full brief - world, cast, moments (sections 4, 5, 12)")
    b0 = balance(uid)
    s, d = generate(jwt, primary_genre="mystery", story_mode="standalone",
                    topic=IDEA_RICH,
                    where_and_when="A hill town, off-season, present day",
                    characters=CAST_RICH, moments=MOMENTS,
                    chapter_length="standard")
    rich_id = None
    if check("2.1 rich brief generates", s == 200, f"HTTP {s} {json.dumps(d)[:200]}"):
        rich_id = d["story"]["id"]; story_ids.append(rich_id)
        body = d["chapter"]["content"]
        wc = d["chapter"].get("word_count") or 0
        check("2.2 word count under the standard ceiling", wc <= 2400, f"{wc} words")
        check("2.3 word count is not trivially short", wc >= 500, f"{wc} words")
        # The cast reached the prompt if their names reached the prose. This is
        # the only observable proof that background/appearance were not dropped
        # again the way they silently were before this session.
        check("2.4 the protagonist appears in the prose", "Elena" in body)
        check("2.5 the second character appears too", "Tomás" in body or "Tomas" in body)
        check("2.6 where_and_when persisted",
              (rest(f"stories?id=eq.{rich_id}&select=where_and_when")[1] or
               [{}])[0].get("where_and_when") == "A hill town, off-season, present day")
        check("2.7 exactly 1 credit for the chapter", b0 - balance(uid) == 1)

    # ------------------------------------------------ 3 the background media
    if rich_id:
        print("\n[3] Background media - cover and portraits (sections 10.2, 10.4)")
        cover = await_cover(rich_id)
        check("3.1 cover_status left 'generating'",
              cover["cover_status"] in ("ready", "failed"), str(cover["cover_status"]))
        check("3.2 cover_started_at was stamped", bool(cover.get("cover_started_at")))
        if cover["cover_status"] == "ready":
            check("3.3 cover_image_url is populated", bool(cover.get("cover_image_url")))
        else:
            # A failed cover is a legitimate outcome (decision 39) but is worth
            # seeing loudly, because it means every image provider refused.
            check("3.3 cover generated (concept card is the fallback)", False,
                  "every image provider failed - check error_events")
        cs, cast = rest(f"characters?story_id=eq.{rich_id}&select=name,portrait_url")
        rows = cast if isinstance(cast, list) else []
        rows = [c for c in rows if isinstance(c, dict)]
        with_art = [c for c in rows if c.get("portrait_url")]
        check("3.4 both characters were persisted", len(rows) == 2,
              f"{len(rows)} (HTTP {cs} {str(cast)[:80]})")
        check("3.5 portraits were generated",
              bool(rows) and len(with_art) == len(rows),
              f"{len(with_art)}/{len(rows)} have portrait_url")

    # ------------------------------------------------------ 4 moments clamp
    print("\n[4] Moments are clamped, never rejected (section 5)")
    b0 = balance(uid)
    s, d = generate(jwt, primary_genre="romance", story_mode="standalone",
                    topic="two exes get stuck in the same elevator",
                    moments=[f"beat number {i}" for i in range(9)])
    if check("4.1 nine moments still generate", s == 200, f"HTTP {s}"):
        story_ids.append(d["story"]["id"])
        check("4.2 exactly 1 credit", b0 - balance(uid) == 1)

    # ----------------------------------------------------------- 5 kids mode
    print("\n[5] Kids mode removes, it does not default (section 3)")
    b0 = balance(uid)
    for genre in ("darkRomance", "paranormalRomance", "horror", "thriller"):
        s, d = generate(jwt, primary_genre=genre, audience_mode="kids",
                        topic=IDEA_KIDS)
        check(f"5.x {genre} refused in kids mode", s == 400,
              f"HTTP {s} {(d or {}).get('error', '')[:60]}")
    check("5.5 refusals cost no credit", balance(uid) == b0)
    s, d = generate(jwt, primary_genre="adventure", audience_mode="kids",
                    topic=IDEA_KIDS, chapter_length="short")
    if check("5.6 adventure generates in kids mode", s == 200, f"HTTP {s}"):
        kid_id = d["story"]["id"]; story_ids.append(kid_id)
        _, sd = rest(f"stories?id=eq.{kid_id}&select=content_rating,spice_level,chapter_length")
        row = (sd or [{}])[0]
        check("5.7 content_rating is kids", row.get("content_rating") == "kids",
              str(row.get("content_rating")))
        check("5.8 spice forced to sweet", row.get("spice_level") == "sweet",
              str(row.get("spice_level")))
        check("5.9 chapter_length stored as short",
              row.get("chapter_length") == "short",
              str(row.get("chapter_length")))

    # ------------------------------------------------------ 6 chapter length
    print("\n[6] Chapter length drives the band, and is stored faithfully")
    for length, floor, ceiling in (("short", 300, 1400), ("long", 900, 3900)):
        s, d = generate(jwt, primary_genre="fantasy", story_mode="standalone",
                        topic="a cartographer maps a valley that keeps moving",
                        chapter_length=length)
        if check(f"6.x {length} generates", s == 200, f"HTTP {s}"):
            sid = d["story"]["id"]; story_ids.append(sid)
            wc = d["chapter"].get("word_count") or 0
            check(f"6.x {length} within its ceiling", wc <= ceiling, f"{wc} words")
            check(f"6.x {length} not trivially short", wc >= floor, f"{wc} words")
            _, sd = rest(f"stories?id=eq.{sid}&select=chapter_length")
            # The column must hold what was requested. An earlier revision
            # collapsed "standard" to "short", which made continue-story pick
            # the wrong word-count ceiling and refund legitimate chapters.
            check(f"6.x {length} stored verbatim, not collapsed",
                  (sd or [{}])[0].get("chapter_length") == length,
                  str((sd or [{}])[0].get("chapter_length")))

    # -------------------------------------------- 7 series and the world layer
    print("\n[7] Series continuation carries the world layer")
    b0 = balance(uid)
    s, d = generate(jwt, primary_genre="fantasy", story_mode="series",
                    topic=IDEA_SERIES,
                    where_and_when="A cartographers' guild, 1890s",
                    chapter_length="short")
    if check("7.1 series opening generates", s == 200, f"HTTP {s} {json.dumps(d)[:200]}"):
        series_id = d["story"]["id"]; story_ids.append(series_id)
        ch1 = d["chapter"]
        check("7.2 chapter_role is series_opening",
              ch1.get("chapter_role") == "series_opening", str(ch1.get("chapter_role")))
        check("7.3 a hook was set", (ch1.get("hook_type") or "none") != "none",
              str(ch1.get("hook_type")))
        _, sd = rest(f"stories?id=eq.{series_id}&select=series_state")
        state = (sd or [{}])[0].get("series_state") or {}
        check("7.4 series_state is not empty",
              bool((state.get("central_conflict") or "").strip()),
              json.dumps(state)[:80])

        s2, d2 = req("POST", "/functions/v1/continue-story",
                     {"story_id": series_id, "request_id": rid("cont")}, token=jwt)
        if check("7.5 chapter 2 generates", s2 == 200, f"HTTP {s2} {json.dumps(d2)[:200]}"):
            check("7.6 chapter 2 is mid_series",
                  d2["chapter"].get("chapter_role") == "mid_series",
                  str(d2["chapter"].get("chapter_role")))
            check("7.7 two chapters cost two credits", b0 - balance(uid) == 2,
                  f"{b0} -> {balance(uid)}")

    # ------------------------------------------- 8 a cast with nothing to draw
    print("\n[8] A name-only cast degrades to the genre cover, it does not break")
    s, d = generate(jwt, primary_genre="mystery", story_mode="standalone",
                    topic="a widow starts receiving postcards in her husband's hand",
                    characters=[{"name": "Marguerite"}])
    if check("8.1 a name-only character generates", s == 200, f"HTTP {s}"):
        blank_id = d["story"]["id"]; story_ids.append(blank_id)
        cover = await_cover(blank_id)
        check("8.2 the cover still resolved",
              cover["cover_status"] in ("ready", "failed"), str(cover["cover_status"]))

    # ------------------------------------------------------ 9 idempotent retry
    print("\n[9] A replayed request_id replays, it does not double-charge")
    r = rid("replay")
    b0 = balance(uid)
    s1, d1 = generate(jwt, primary_genre="comedy", story_mode="standalone",
                      topic="a man who cannot stop apologising to inanimate objects",
                      request_id=r)
    if check("9.1 first call generates", s1 == 200, f"HTTP {s1}"):
        story_ids.append(d1["story"]["id"])
        s2, d2 = generate(jwt, primary_genre="comedy", story_mode="standalone",
                          topic="a man who cannot stop apologising to inanimate objects",
                          request_id=r)
        check("9.2 the replay returns the same chapter",
              s2 == 200 and d2.get("replayed") is True and
              d2["chapter"]["id"] == d1["chapter"]["id"], f"HTTP {s2}")
        check("9.3 still only one credit", b0 - balance(uid) == 1,
              f"{b0} -> {balance(uid)}")

    # ------------------------------------------------- 10 which model answered
    print("\n[10] Provider chain")
    s, d = generate(jwt, primary_genre="poetry", story_mode="standalone",
                    topic="the tide pool remembers")
    if check("10.1 generation succeeded", s == 200, f"HTTP {s}"):
        story_ids.append(d["story"]["id"])
        print(f"       model that answered: {d.get('model')}")
        check("10.2 a model was reported", bool(d.get("model")))

    # ------------------------------------------------------ 11 telemetry check
    print("\n[11] Failures recorded, per the Observability Gate")
    # Assertions, not decoration.
    #
    # This section only printed, so the matrix could exit 0 while the telemetry
    # view was unreadable or while this very run had recorded failures - and the
    # build log would then claim "no new failures" on the strength of a report
    # nobody checked. Both are now checks.
    #
    # Scoped by time rather than by a correlation id: `logError` writes
    # identifiers and enums only, and adding a run key to its context would mean
    # threading a test concern through production telemetry. The run start is a
    # tighter filter than it looks - nothing else writes to this project while
    # the matrix holds its fixture user.
    st, ev = req("GET",
                 "/rest/v1/error_events?select=fingerprint,bucket,error_code,occurred_at"
                 f"&occurred_at=gte.{run_started_at}"
                 "&order=occurred_at.desc&limit=50",
                 key=SVC)
    check("11.1 telemetry is readable",
          st == 200 and isinstance(ev, list),
          f"HTTP {st} {str(ev)[:120]}")

    rows = ev if isinstance(ev, list) else []
    # A row that is not a dict means the view's shape changed under us. Skipping
    # it would let a schema change quietly turn this assertion into a no-op,
    # which is the failure mode the whole section exists to close.
    malformed = [e for e in rows if not isinstance(e, dict)]
    check("11.2 telemetry rows have the expected shape", not malformed,
          f"{len(malformed)} malformed: {str(malformed[:2])[:120]}")

    during_run = [e for e in rows if isinstance(e, dict)]
    check("11.3 this run recorded no failures", not during_run,
          "; ".join(f"{e.get('bucket')}/{e.get('error_code')}" for e in during_run[:5]))

    st2, summary = rest("error_event_summary?select=fingerprint,bucket,error_code,occurrences"
                        "&order=last_seen.desc&limit=8")
    if st2 == 200 and isinstance(summary, list):
        print("       historical, for context:")
        for row in summary:
            if not isinstance(row, dict):
                continue
            print(f"       {row.get('bucket',''):<20} {row.get('error_code',''):<28} "
                  f"x{row.get('occurrences','?')}  {str(row.get('fingerprint',''))[:12]}")

finally:
    print("\n[teardown]")
    if KEEP:
        print(f"  --keep: leaving user {uid} and {len(story_ids)} stories in place")
    elif uid:
        for sid in story_ids:
            req("DELETE", f"/rest/v1/stories?id=eq.{sid}", key=SVC)
        req("DELETE", f"/rest/v1/profiles?id=eq.{uid}", key=SVC)
        # The profile row must go before the auth user: credit_ledger.user_id
        # references profiles(id), and the auth delete cascades into a state the
        # ledger FK rejects, which surfaces as a 500 rather than a clear error.
        # Clear the ledger first so the delete has nothing holding it.
        req("DELETE", f"/rest/v1/credit_ledger?user_id=eq.{uid}", key=SVC)
        req("DELETE", f"/rest/v1/generation_operations?user_id=eq.{uid}", key=SVC)
        req("DELETE", f"/rest/v1/profiles?id=eq.{uid}", key=SVC)
        s, body = req("DELETE", f"/auth/v1/admin/users/{uid}", key=SVC)
        print(f"  removed {len(story_ids)} stories, profile and auth user (HTTP {s})")
        if s not in (200, 204):
            print(f"  WARNING: fixture auth user {uid} may be stranded: {str(body)[:160]}")
        print("  note: cover and portrait objects in the `covers` bucket are NOT")
        print("        cascade-deleted. Storage orphan cleanup is an open item.")

print("\n" + "=" * 74)
print(f"PASS {len(PASS)}   FAIL {len(FAIL)}")
if FAIL:
    for name in FAIL:
        print(f"  FAILED: {name}")
print("=" * 74)
sys.exit(1 if FAIL else 0)

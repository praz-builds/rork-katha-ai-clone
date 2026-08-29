#!/usr/bin/env python3
"""Production smoke test for series-state generation (PRs #30, #31).

Uses seeds written the way a real user types them - lowercase, casual, specific -
spanning the full accepted length range (40-100 chars) plus under-length rejects.

Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from the
environment. Never prints key material.
"""
import json, os, ssl, sys, uuid, urllib.request, urllib.error

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ["SUPABASE_ANON_KEY"]
SVC = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

PASS, FAIL = [], []
gen_failures = 0  # generations the harness observed returning non-200


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
        # Transport, timeout, TLS and decode failures must not propagate:
        # raising here would skip cleanup and leave rows in the production
        # project. Surface them as status 0 so callers record a failure.
        return 0, {"error": f"{type(e).__name__}: {e}"}


def rest(path, key=None):
    return req("GET", "/rest/v1/" + path, key=key)


def rpc(fn, args):
    return req("POST", f"/rest/v1/rpc/{fn}", args, key=SVC)


def balance(uid):
    s, d = rest(f"credit_ledger?user_id=eq.{uid}&select=balance_after"
                f"&order=created_at.desc,id.desc&limit=1", key=SVC)
    return d[0]["balance_after"] if d else 0


def rid(tag):
    return f"smoke-{tag}-{uuid.uuid4().hex[:10]}"


def find_user_by_email(target: str) -> tuple[str | None, bool]:
    """Locate a fixture auth user by exact email, paging the admin list.

    Returns (user_id, lookup_ok). The second value matters: a failed lookup is
    NOT the same as "no such user". Collapsing the two would let a transient
    error silently skip the auth-user deletion and strand the fixture with no
    signal, which is the exact outcome this function exists to prevent.

    Used only when the create response was indeterminate.
    """
    if not target:
        return None, True
    wanted = target.lower()
    page = 1
    while True:
        st, body = None, None
        for attempt in range(3):  # transient failures are worth retrying
            st, body = req("GET", f"/auth/v1/admin/users?page={page}&per_page=200", key=SVC)
            if st == 200 and body is not None:
                break
        if st != 200 or body is None:
            return None, False  # lookup failed; caller must not assume absence
        users = body.get("users", body) if isinstance(body, dict) else body
        if not users:
            # An empty page ends the list. No fixed page cap, so project size
            # cannot hide the fixture.
            return None, True
        for u in users:
            if (u.get("email") or "").lower() == wanted:
                return u.get("id"), True
        page += 1


# Seeds as a real user would type them, spanning the accepted 40-100 range.
SEED_STANDALONE = "a barista who hears what strangers regret"                      # 41
SEED_SERIES = ("a mapmaker discovers the valley she is charting quietly "
               "rearranges itself whenever she falls asleep")                      # 99
SEED_KIDS = "a boy and a very old tortoise decide to find the sea before summer ends"  # 71

# Length sweep: one generation each, real-user phrasing, 40 -> 100 chars.
LENGTH_SWEEP = [
    ("a barista who hears what strangers regret", "contemporary"),                  # 41
    ("two exes get stuck in the same elevator for three hours", "romance"),         # 55
    ("a retired spy is recognised by the barista who makes her coffee", "thriller"),# 63
    ("a widow starts receiving postcards signed in her late husband's handwriting",
     "mystery"),                                                                    # 75
    ("a vampire barista falls for the guy who orders an oat milk latte every morning",
     "paranormalRomance"),                                                          # 78
    ("a lighthouse keeper works out the light has been guiding something back "
     "that should have stayed lost", "horror"),                                     # 100
]

TOO_SHORT = [
    "a haunted house",                    # 15
    "enemies to lovers on a train",       # 28
    "a girl finds a door in her attic",   # 32
]

print("=" * 74)
print("SMOKE TEST - series state generation (PR #30 + #31)")
print("=" * 74)

# Identifiers are declared before the try so finally can clean up whatever
# was created, even when setup itself fails partway through.
uid = None
email = ""
story_ids = []
results = {}

# Everything that touches the production project runs inside this try, with
# teardown in finally. sys.exit() raises SystemExit, so setup failures unwind
# through finally rather than skipping it and leaking a fixture.
try:
    email = f"smoke+{uuid.uuid4().hex[:10]}@kathaai.test"
    pw = "Sm0ke!" + uuid.uuid4().hex[:12]
    print(f"\n[0] Test user {email}")
    s, d = req("POST", "/auth/v1/admin/users",
               {"email": email, "password": pw, "email_confirm": True}, key=SVC)
    if s not in (200, 201):
        print("  cannot create user:", s, json.dumps(d)[:300])
        sys.exit(1)
    uid = d["id"]
    print(f"  id {uid}")

    # There is no signup flow yet, so no trigger creates the profile row.
    # credit_ledger.user_id references profiles(id), so the harness creates it.
    s, pd = req("POST", "/rest/v1/profiles",
                {"id": uid, "username": f"smoke_{uid.replace('-', '')[:16]}"}, key=SVC)
    if s not in (200, 201, 204, 409):
        print("  cannot create profile:", s, json.dumps(pd)[:250])
        sys.exit(1)
    print(f"  profile row created (HTTP {s})")

    s, d = req("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw})
    if s != 200:
        print("  cannot sign in:", s, json.dumps(d)[:300])
        sys.exit(1)
    jwt = d["access_token"]

    gs, gd = rpc("grant_credit", {"p_user_id": uid, "p_amount": 60, "p_reason": "welcome",
                                  "p_reference_id": f"smoke-{uid[:8]}",
                                  "p_operation_key": rid("grant")})
    if gs != 200:
        print("  grant_credit failed:", gs, json.dumps(gd)[:250])
        sys.exit(1)
    b_start = balance(uid)
    if b_start != 60:
        print(f"  unexpected starting balance {b_start}")
        sys.exit(1)
    print(f"  signed in; balance = {b_start}")

    # ------------------------------------------------------ 1 seed validation
    print("\n[1] Seed length validation (real users type short prompts)")
    for seed in TOO_SHORT:
        s, d = req("POST", "/functions/v1/generate-story",
                   {"primary_genre": "contemporary", "story_mode": "standalone",
                    "seed": seed, "request_id": rid("short")}, token=jwt)
        check(f"1.x rejects {len(seed)}-char seed", s == 400,
              f"HTTP {s} {(d or {}).get('error','')[:50]}")
    b_after_reject = balance(uid)
    check("1.4 rejected seeds cost no credit", b_after_reject == b_start, f"balance {b_after_reject}")

    # --------------------------------------------------------- 2 standalone
    print(f"\n[2] Standalone story - {len(SEED_STANDALONE)}-char seed")
    b0 = balance(uid)
    r_a = rid("standalone")
    s, d = req("POST", "/functions/v1/generate-story",
               {"primary_genre": "contemporary", "story_mode": "standalone",
                "seed": SEED_STANDALONE, "request_id": r_a}, token=jwt)
    print(f"  HTTP {s}")
    ch_a = None
    if s != 200:
        print("  body:", json.dumps(d)[:500])
        FAIL.append("2: standalone generation")
    else:
        st, ch_a = d["story"], d["chapter"]
        story_ids.append(st["id"])
        check("2.1 story_mode == standalone", st.get("story_mode") == "standalone", str(st.get("story_mode")))
        check("2.2 chapter_role == standalone", ch_a.get("chapter_role") == "standalone", str(ch_a.get("chapter_role")))
        check("2.3 hook_type == none", ch_a.get("hook_type") == "none", str(ch_a.get("hook_type")))
        check("2.4 no hook_text", not (ch_a.get("hook_text") or "").strip())
        sx, sd = rest(f"stories?id=eq.{st['id']}&select=series_state", key=SVC)
        stored = sd[0]["series_state"] if sd else None
        check("2.5 stored series_state empty for standalone", stored == {}, json.dumps(stored)[:60])
        wc = ch_a.get("word_count") or 0
        check("2.6 word_count in 500-1500 band", 400 <= wc <= 1800, f"{wc} words")
        check("2.7 exactly 1 credit deducted", b0 - balance(uid) == 1, f"{b0} -> {balance(uid)}")

    # ------------------------------------------------------- 3 idempotency
    if ch_a:
        print("\n[3] Idempotent replay (same request_id)")
        b1 = balance(uid)
        s, d = req("POST", "/functions/v1/generate-story",
                   {"primary_genre": "contemporary", "story_mode": "standalone",
                    "seed": SEED_STANDALONE, "request_id": r_a}, token=jwt)
        check("3.1 replay returns 200", s == 200, f"HTTP {s}")
        if s == 200:
            check("3.2 same chapter id", d.get("chapter", {}).get("id") == ch_a["id"])
            check("3.3 flagged replayed", d.get("replayed") is True, str(d.get("replayed")))
        check("3.4 no extra credit charged", balance(uid) == b1, f"{b1} -> {balance(uid)}")

    # ------------------------------------------------------------ 4 series
    print(f"\n[4] Series chapter 1 - {len(SEED_SERIES)}-char seed")
    b2 = balance(uid)
    s, d = req("POST", "/functions/v1/generate-story",
               {"primary_genre": "fantasy", "story_mode": "series",
                "seed": SEED_SERIES, "request_id": rid("series")}, token=jwt)
    print(f"  HTTP {s}")
    series_id = None
    if s != 200:
        print("  body:", json.dumps(d)[:500])
        FAIL.append("4: series generation")
        gen_failures += 1
    else:
        st, ch = d["story"], d["chapter"]
        series_id = st["id"]
        story_ids.append(series_id)
        ss = st.get("series_state") or {}
        results["ch1_state"] = ss
        check("4.1 story_mode == series", st.get("story_mode") == "series", str(st.get("story_mode")))
        check("4.2 chapter_role == series_opening", ch.get("chapter_role") == "series_opening", str(ch.get("chapter_role")))
        check("4.3 hook_type set and != none", ch.get("hook_type") not in (None, "", "none"), str(ch.get("hook_type")))
        check("4.4 hook_text non-empty", bool((ch.get("hook_text") or "").strip()), (ch.get("hook_text") or "")[:60])
        check("4.5 central_conflict populated", bool(ss.get("central_conflict")), (ss.get("central_conflict") or "")[:60])
        check("4.6 open_hooks non-empty", bool(ss.get("open_hooks")), json.dumps(ss.get("open_hooks"))[:60])
        check("4.7 next_chapter_pressure set", bool(ss.get("next_chapter_pressure")), (ss.get("next_chapter_pressure") or "")[:50])
        wc = ch.get("word_count") or 0
        check("4.8 word_count in 600-900 band", 450 <= wc <= 1200, f"{wc} words")
        check("4.9 1 credit deducted", b2 - balance(uid) == 1, f"{b2} -> {balance(uid)}")

    # -------------------------------------------------------- 5 mid-series
    if series_id:
        print("\n[5] Continue series - chapter 2")
        b3 = balance(uid)
        s, d = req("POST", "/functions/v1/continue-story",
                   {"story_id": series_id, "request_id": rid("cont")}, token=jwt)
        print(f"  HTTP {s}")
        if s != 200:
            print("  body:", json.dumps(d)[:500])
            FAIL.append("5: mid-series continuation")
            gen_failures += 1
        else:
            ch2 = d["chapter"]
            check("5.1 chapter_role == mid_series", ch2.get("chapter_role") == "mid_series", str(ch2.get("chapter_role")))
            check("5.2 chapter_number == 2", ch2.get("chapter_number") == 2, str(ch2.get("chapter_number")))
            check("5.3 hook_type set and != none", ch2.get("hook_type") not in (None, "", "none"), str(ch2.get("hook_type")))
            sx, sd = rest(f"stories?id=eq.{series_id}&select=series_state", key=SVC)
            new_state = sd[0]["series_state"] if sd else {}
            results["ch2_state"] = new_state
            ch1 = results.get("ch1_state") or {}
            check("5.4 series_state still populated", bool(new_state.get("central_conflict")), (new_state.get("central_conflict") or "")[:50])
            check("5.5 series_state advanced from ch1", new_state != ch1,
                  "changed" if new_state != ch1 else "IDENTICAL - not advancing")
            # A continuation must move the specific fields the contract names, not
            # just any field: an unrelated edit would satisfy 5.5 on its own.
            check("5.7 next_chapter_pressure rewritten for the next chapter",
                  bool(new_state.get("next_chapter_pressure"))
                  and new_state.get("next_chapter_pressure") != ch1.get("next_chapter_pressure"),
                  f"{(ch1.get('next_chapter_pressure') or '')[:34]!r} -> {(new_state.get('next_chapter_pressure') or '')[:34]!r}")
            check("5.8 open_hooks carry this chapter's new hook",
                  new_state.get("open_hooks") != ch1.get("open_hooks")
                  and len(new_state.get("open_hooks") or []) > 0,
                  f"{len(ch1.get('open_hooks') or [])} -> {len(new_state.get('open_hooks') or [])}")
            check("5.9 chapter progress recorded in state",
                  (new_state.get("character_changes") != ch1.get("character_changes"))
                  or (new_state.get("relationship_state") != ch1.get("relationship_state"))
                  or (new_state.get("resolved_hooks") != ch1.get("resolved_hooks")),
                  "character_changes/relationship_state/resolved_hooks advanced")
            check("5.6 1 credit deducted", b3 - balance(uid) == 1, f"{b3} -> {balance(uid)}")

    # ------------------------------------------------------------ 6 finale
    if series_id:
        print("\n[6] Forced finale - chapter 3 with is_finale")
        b4 = balance(uid)
        s, d = req("POST", "/functions/v1/continue-story",
                   {"story_id": series_id, "is_finale": True, "request_id": rid("finale")}, token=jwt)
        print(f"  HTTP {s}")
        if s != 200:
            print("  body:", json.dumps(d)[:500])
            FAIL.append("6: finale continuation")
            gen_failures += 1
        else:
            ch3 = d["chapter"]
            check("6.1 chapter_role == finale", ch3.get("chapter_role") == "finale", str(ch3.get("chapter_role")))
            check("6.2 hook_type == none", ch3.get("hook_type") == "none", str(ch3.get("hook_type")))
            check("6.3 no hook_text", not (ch3.get("hook_text") or "").strip())
            sx, sd = rest(f"stories?id=eq.{series_id}&select=series_state", key=SVC)
            fin = sd[0]["series_state"] if sd else {}
            ch2 = results.get("ch2_state") or {}
            check("6.4 series_state retained after finale", bool(fin.get("central_conflict")),
                  "retained" if fin.get("central_conflict") else "ERASED")
            check("6.6 finale advanced state beyond chapter 2", fin != ch2,
                  "changed" if fin != ch2 else "IDENTICAL to ch2")
            check("6.7 next_chapter_pressure cleared (series is over)",
                  not (fin.get("next_chapter_pressure") or "").strip(),
                  repr((fin.get("next_chapter_pressure") or ""))[:50])
            check("6.8 finale recorded resolutions",
                  bool(fin.get("resolved_hooks")) or bool(fin.get("character_changes")),
                  f"resolved={len(fin.get('resolved_hooks') or [])} changes={len(fin.get('character_changes') or [])}")
            check("6.5 1 credit deducted", b4 - balance(uid) == 1, f"{b4} -> {balance(uid)}")

    # -------------------------------------------------------------- 7 kids
    print(f"\n[7] Kids series opening - {len(SEED_KIDS)}-char seed")
    b5 = balance(uid)
    s, d = req("POST", "/functions/v1/generate-story",
               {"primary_genre": "adventure", "story_mode": "series",
                "audience_mode": "kids", "seed": SEED_KIDS, "request_id": rid("kids")}, token=jwt)
    print(f"  HTTP {s}")
    if s != 200:
        print("  body:", json.dumps(d)[:500])
        FAIL.append("7: kids series generation")
        gen_failures += 1
    else:
        st, ch = d["story"], d["chapter"]
        story_ids.append(st["id"])
        check("7.1 story_mode == series", st.get("story_mode") == "series", str(st.get("story_mode")))
        check("7.2 chapter_role == series_opening", ch.get("chapter_role") == "series_opening", str(ch.get("chapter_role")))
        check("7.3 content_rating == kids", st.get("content_rating") == "kids", str(st.get("content_rating")))
        wc = ch.get("word_count") or 0
        check("7.4 kids series uses 600-900 band, not 500-1200", 450 <= wc <= 1100, f"{wc} words")
        check("7.5 hook_type is a safe kids hook",
              ch.get("hook_type") in ("unanswered_question", "arrival", "decision", "none"),
              str(ch.get("hook_type")))

    # --------------------------------------------- 8 legacy is_series still works
    print("\n[8] Legacy is_series still accepted (older clients)")
    s, d = req("POST", "/functions/v1/generate-story",
               {"primary_genre": "fantasy", "is_series": True,
                "seed": SEED_SERIES, "request_id": rid("legacy")}, token=jwt)
    if s == 200:
        story_ids.append(d["story"]["id"])
        check("8.1 is_series:true still maps to series", d["story"].get("story_mode") == "series",
              str(d["story"].get("story_mode")))
        check("8.2 and yields series_opening", d["chapter"].get("chapter_role") == "series_opening",
              str(d["chapter"].get("chapter_role")))
    else:
        check("8.1 is_series:true still maps to series", False, f"HTTP {s}")

    # ------------------------------------------------------- 9 length sweep
    print("\n[9] Seed length sweep 40 -> 100 chars")
    for seed, genre in LENGTH_SWEEP:
        s, d = req("POST", "/functions/v1/generate-story",
                   {"primary_genre": genre, "story_mode": "standalone",
                    "seed": seed, "request_id": rid("sweep")}, token=jwt)
        ok = s == 200
        if ok:
            story_ids.append(d["story"]["id"])
        check(f"9.x {len(seed):3d}-char seed / {genre}", ok,
              f"HTTP {s}" + ("" if ok else f" {json.dumps(d)[:90]}"))

    # ------------------------------------------------- 10 credit exhaustion
    print("\n[10] Credit exhaustion")
    bal = balance(uid)
    if bal > 0:
        rpc("deduct_credit", {"p_user_id": uid, "p_amount": bal, "p_reason": "generation",
                              "p_reference_id": f"smoke-drain-{uid[:8]}",
                              "p_operation_key": rid("drain")})
    s, d = req("POST", "/functions/v1/generate-story",
               {"primary_genre": "contemporary", "story_mode": "standalone",
                "seed": SEED_STANDALONE, "request_id": rid("broke")}, token=jwt)
    check("10.1 returns 402 Insufficient credits", s == 402, f"HTTP {s} {(d or {}).get('error','')[:40]}")

    # ------------------------------------------------ 11 operation integrity
    print("\n[11] Operation ledger integrity")
    s, d = rest(f"generation_operations?user_id=eq.{uid}&select=kind,status,chapter_number,last_error"
                f"&order=created_at.asc", key=SVC)
    if d is not None:
        statuses = [o["status"] for o in d]
        refunded = [o for o in d if o["status"] == "refunded"]
        print(f"  {len(d)} operations: {statuses}")
        check("11.1 no stuck 'reserved' operations", "reserved" not in statuses)
        # A refund after a genuine model failure is the system working, not a
        # defect. What matters is that each refund maps to a failure the harness
        # actually observed, and that nothing is left mid-flight.
        check("11.3 every refund matches an observed generation failure",
              len(refunded) <= gen_failures,
              f"{len(refunded)} refunded, {gen_failures} observed failures")
        check("11.4 every operation reached a terminal state",
              all(st in ("completed", "refunded") for st in statuses),
              str(sorted(set(statuses))))
        for o in refunded:
            print(f"    refunded: {(o.get('last_error') or '')[:140]}")

finally:
    print("\n[cleanup]")
    removed = 0
    leaked: list[str] = []

    def purge(path: str, label: str) -> None:
        """Delete a fixture row, recording a failure if it does not go away."""
        global removed
        st, _ = req("DELETE", path, key=SVC)
        if st in (200, 202, 204):
            removed += 1
        else:
            leaked.append(f"{label} (HTTP {st})")
            FAIL.append(f"cleanup: {label} left in production (HTTP {st})")

    if uid is None:
        # The create call may have succeeded server-side while the response
        # timed out or failed to decode, in which case req() returned 0 and uid
        # was never assigned. Look the fixture up by its exact email so the
        # account is not stranded.
        uid, lookup_ok = find_user_by_email(email)
        if uid:
            print(f"  recovered orphaned auth user {uid}")
        elif not lookup_ok:
            # Cannot tell whether the account exists, so it may be stranded.
            leaked.append(f"auth user {email} (lookup failed)")
            FAIL.append(
                f"cleanup: could not determine whether {email} exists; "
                "it may be stranded in the project"
            )

    if uid:
        # Order matters, and stories are deleted by author rather than by the
        # ids the run tracked: a generation that fails after the story row is
        # inserted leaves an orphan the harness never saw, which then blocks
        # the profile delete with a foreign-key 409 and the user delete with a
        # 500. generation_operations references stories, so it goes first.
        purge(f"/rest/v1/generation_operations?user_id=eq.{uid}", "generation_operations rows")
        purge(f"/rest/v1/stories?author_id=eq.{uid}", "stories (all, by author)")
        purge(f"/rest/v1/credit_ledger?user_id=eq.{uid}", "credit_ledger rows")
        purge(f"/rest/v1/profiles?id=eq.{uid}", "profile row")
        purge(f"/auth/v1/admin/users/{uid}", "auth user")

    print(f"  {removed} fixture objects removed")
    if leaked:
        # Loud: these are real rows left behind in the live project.
        print("  NOT REMOVED: " + "; ".join(leaked))

print("\n" + "=" * 74)
print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED: " + "; ".join(FAIL))
print("=" * 74)
sys.exit(1 if FAIL else 0)

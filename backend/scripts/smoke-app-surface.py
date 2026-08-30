#!/usr/bin/env python3
"""Production smoke test for the app-surface edge functions.

Covers library, feed, edit-story, publish-story and audio-status - the
functions the Expo client calls outside generation. Five of these had never
been deployed to the project at all, so this suite exists to keep that from
being discovered by a user again.

Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from the
environment. Never prints key material, story prose, or seeds.
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


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))
    return cond


def req(method, path, body=None, token=None, key=None, timeout=240):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, method=method)
    r.add_header("apikey", key or ANON)
    if token or key:
        r.add_header("Authorization", f"Bearer {token or key}")
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
            return e.code, {"raw": raw[:300]}
    except Exception as e:
        # Never propagate: a raise here would skip cleanup and leave rows in
        # the production project.
        return 0, {"error": f"{type(e).__name__}: {e}"}


def rpc(fn, args):
    return req("POST", f"/rest/v1/rpc/{fn}", args, key=SVC)


def rid(p):
    return f"{p}-{uuid.uuid4().hex[:12]}"


uid = jwt = story_id = chapter_id = None
try:
    # ------------------------------------------------------------ 0 fixtures
    email = f"smoke+{uuid.uuid4().hex[:10]}@kathaai.test"
    pw = "Sm0ke!" + uuid.uuid4().hex[:12]
    print(f"\n[0] Fixtures")
    s, d = req("POST", "/auth/v1/admin/users",
               {"email": email, "password": pw, "email_confirm": True}, key=SVC)
    if s not in (200, 201):
        print("  cannot create user:", s, json.dumps(d)[:200]); sys.exit(1)
    uid = d["id"]
    req("POST", "/rest/v1/profiles",
        {"id": uid, "username": f"smoke_{uid.replace('-', '')[:16]}"}, key=SVC)
    s, d = req("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw})
    if s != 200:
        print("  cannot sign in:", s, json.dumps(d)[:200]); sys.exit(1)
    jwt = d["access_token"]
    gs, gd = rpc("grant_credit", {"p_user_id": uid, "p_amount": 20, "p_reason": "welcome",
                                  "p_reference_id": f"smoke-{uid[:8]}",
                                  "p_operation_key": rid("grant")})
    if gs != 200:
        print("  grant_credit failed:", gs, json.dumps(gd)[:200]); sys.exit(1)
    print(f"  user {uid} ready")

    # ------------------------------------------- 1 every function is deployed
    # A 404 here means the function is missing from the project entirely -
    # exactly the state five of these were in before 2026-08-30.
    print("\n[1] Deployed and gated (unauthenticated must not 404)")
    for name, method, path, body in [
        ("feed",          "GET",  "/functions/v1/feed", None),
        ("audio-status",  "GET",  "/functions/v1/audio-status?job_id=x", None),
        ("edit-story",    "POST", "/functions/v1/edit-story", {}),
        ("publish-story", "POST", "/functions/v1/publish-story", {}),
        ("generate-audio","POST", "/functions/v1/generate-audio", {}),
    ]:
        st, _ = req(method, path, body, key=ANON)
        check(f"1.x {name} is deployed (not 404)", st != 404, f"HTTP {st}")
        check(f"1.x {name} rejects anonymous", st == 401, f"HTTP {st}")

    # library is deliberately public - it filters to is_public/is_curated and
    # has no getUser() gate. Asserting 401 here would be wrong; what matters is
    # that an anonymous caller cannot see a private story. Checked in [3].
    st, _ = req("GET", "/functions/v1/library", key=ANON)
    check("1.x library is deployed and public by design", st == 200, f"HTTP {st}")

    # ---------------------------------------------------------- 2 a story
    print("\n[2] Generate a story to operate on")
    st, gen = req("POST", "/functions/v1/generate-story",
                  {"seed": "a lighthouse keeper finds a door in the sea floor",
                   "genre": "mystery", "request_id": rid("app")}, token=jwt)
    if not check("2.1 generate-story 200", st == 200, f"HTTP {st}"):
        print("  ", json.dumps(gen)[:250]); raise SystemExit
    story_id = gen.get("story", {}).get("id") or gen.get("story_id")
    chapter_id = (gen.get("chapter") or {}).get("id")
    check("2.2 story id returned", bool(story_id))
    check("2.3 chapter id returned", bool(chapter_id))

    # ------------------------------------------------------------ 3 library
    print("\n[3] library")
    st, lib = req("GET", "/functions/v1/library", token=jwt)
    check("3.1 library 200", st == 200, f"HTTP {st}")

    # The story is unpublished at this point, so it must NOT appear to anyone -
    # library filters to is_public/is_curated. This is the assertion that would
    # catch that filter being dropped.
    st2, anon_lib = req("GET", "/functions/v1/library", key=ANON)
    anon_items = (anon_lib or {}).get("stories") or (anon_lib or {}).get("data") or []
    check("3.2 an unpublished story is not exposed anonymously", not any(
        isinstance(i, dict) and i.get("id") == story_id for i in anon_items),
        f"{len(anon_items)} public item(s)")

    # --------------------------------------------------------------- 4 feed
    print("\n[4] feed")
    st, fd = req("GET", "/functions/v1/feed", token=jwt)
    # Regression: feed selected profiles.preferred_genres, a column that did not
    # exist, so PostgREST answered 42703 and every call 500'd. Migration 00017.
    check("4.1 feed 200", st == 200, f"HTTP {st} {json.dumps(fd)[:140]}")
    check("4.2 feed returns a payload", isinstance(fd, dict) and bool(fd),
          ", ".join(list(fd.keys())[:6]) if isinstance(fd, dict) else type(fd).__name__)

    # --------------------------------------------------------- 5 edit-story
    print("\n[5] edit-story")
    st, ed = req("POST", "/functions/v1/edit-story",
                 {"story_id": story_id, "chapter_id": chapter_id,
                  "paragraph_index": 0, "instruction": "shorten"}, token=jwt)
    check("5.1 edit-story 200", st == 200, f"HTTP {st}"
          + ("" if st == 200 else " " + json.dumps(ed)[:180]))
    if st == 200:
        para = (ed or {}).get("updated_paragraph") or ""
        check("5.2 a rewritten paragraph came back",
              isinstance(para, str) and len(para) > 0, f"{len(para)} chars")
        check("5.3 the edit names the model that produced it",
              bool((ed or {}).get("model")), str((ed or {}).get("model")))

    # ------------------------------------------------------ 6 publish-story
    print("\n[6] publish-story (generates a cover - real spend)")
    st, pb = req("POST", "/functions/v1/publish-story", {"story_id": story_id},
                 token=jwt, timeout=300)
    check("6.1 publish-story 200", st == 200, f"HTTP {st}"
          + ("" if st == 200 else " " + json.dumps(pb)[:180]))
    if st == 200:
        st_c, ch = req("GET",
                       f"/rest/v1/chapters?story_id=eq.{story_id}&select=is_published,published_at",
                       key=SVC)
        rows_c = ch if isinstance(ch, list) else []
        check("6.1a publishing a story publishes its chapters",
              bool(rows_c) and all(c.get("is_published") is True for c in rows_c),
              f"{sum(1 for c in rows_c if c.get('is_published'))}/{len(rows_c)} published")
        st2, rows = req("GET", f"/rest/v1/stories?id=eq.{story_id}&select=is_public,cover_image_url",
                        key=SVC)
        row = (rows or [{}])[0] if rows else {}
        check("6.2 story is public", row.get("is_public") is True, str(row.get("is_public")))
        cover = row.get("cover_image_url") or ""
        check("6.3 cover_image_url persisted", bool(cover), "set" if cover else "empty")
        if cover:
            cs, _ = req("GET", cover.replace(URL, ""), key=ANON) if cover.startswith(URL) else (0, None)
            check("6.4 cover is publicly readable", cs in (200, 0),
                  f"HTTP {cs}" if cs else "external URL, skipped")

    # -------------------------------------------------------- 7 audio-status
    print("\n[7] audio-status")
    # It requires job_id and story_id together; either alone is a 400.
    st, aud = req("GET",
                  f"/functions/v1/audio-status?job_id=smoke-none&story_id={story_id}",
                  token=jwt)
    check("7.1 audio-status accepts a well-formed query", st != 400,
          f"HTTP {st} {json.dumps(aud)[:120]}")
    st, aud = req("GET", f"/functions/v1/audio-status?story_id={story_id}", token=jwt)
    check("7.2 audio-status rejects a query with no job_id", st == 400, f"HTTP {st}")

finally:
    print("\n[cleanup]")
    removed = 0
    targets = []
    if uid:
        # Find every story by this author, not just the one the run tracked:
        # a partially-failed run can leave others behind.
        st, rows = req("GET", f"/rest/v1/stories?author_id=eq.{uid}&select=id", key=SVC)
        for r in (rows or []) if isinstance(rows, list) else []:
            targets.append((f"/rest/v1/chapters?story_id=eq.{r['id']}", "chapters"))
            targets.append((f"/rest/v1/stories?id=eq.{r['id']}", "story"))
    if story_id:
        targets.append((f"/rest/v1/chapters?story_id=eq.{story_id}", "chapters"))
        targets.append((f"/rest/v1/stories?id=eq.{story_id}", "story"))
    if uid:
        # Order matters: these reference profiles(id), which references the
        # auth user. Deleting the user first returns 500 and strands the row.
        targets += [
            (f"/rest/v1/generation_operations?user_id=eq.{uid}", "operations"),
            (f"/rest/v1/credit_ledger?user_id=eq.{uid}", "credit ledger"),
            (f"/rest/v1/profiles?id=eq.{uid}", "profile"),
            (f"/auth/v1/admin/users/{uid}", "auth user"),
        ]
    for path, label in targets:
        st, _ = req("DELETE", path, key=SVC)
        if st in (200, 204):
            removed += 1
        else:
            FAIL.append(f"cleanup {label} (HTTP {st})")
            print(f"  [FAIL] cleanup {label} - HTTP {st}")
    print(f"  {removed} fixture group(s) removed")

    print("\n" + "=" * 74)
    print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED: " + "; ".join(FAIL))
    print("=" * 74)
    sys.exit(1 if FAIL else 0)

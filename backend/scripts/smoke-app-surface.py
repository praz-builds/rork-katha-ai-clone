#!/usr/bin/env python3
"""Production smoke test for the app-surface edge functions.

Covers library, feed, edit-story, publish-story and audio-status - the
functions the Expo client calls outside generation. Five of these had never
been deployed to the project at all, so this suite exists to keep that from
being discovered by a user again.

Also covers the three calls every session leans on before any of those:
bootstrap-user (every screen's first load), profile (the You tab) and
shape-story (the premise and "Where does it begin?" chips). They write no
product data -- bootstrap-user is idempotent for an existing account, profile
is asked for `me` and `ledger`, and shape-story spends no user credit -- and
all three were outside this suite until 2026-09-24, which is how an empty
opening screen could go unnoticed. See backend/MONITORING.md.

COST: this suite is not free to run. shape-story makes 2 paid OpenRouter calls
(the shape and the entity classification, run together), on top of the paid
calls the rest of the suite already made: generate-story, edit-story and the
cover image publish-story triggers.

Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from the
environment. Never prints key material, story prose, or seeds.
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid

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
            body_bytes = resp.read()
            # A cover is PNG bytes, not JSON. Decoding it as UTF-8 raised, and
            # the catch-all below turned a served image into "HTTP 0".
            try:
                raw = body_bytes.decode()
            except UnicodeDecodeError:
                return resp.status, {"bytes": len(body_bytes)}
            try:
                return resp.status, (json.loads(raw) if raw.strip() else None)
            except ValueError:
                return resp.status, {"raw": raw[:300]}
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
    print("\n[0] Fixtures")
    s, d = req("POST", "/auth/v1/admin/users",
               {"email": email, "password": pw, "email_confirm": True}, key=SVC)
    if s not in (200, 201):
        print("  cannot create user:", s, json.dumps(d)[:200])
        sys.exit(1)
    uid = d["id"]
    # profiles_username_shape (00060) allows 3-20 characters, so the handle is
    # "smoke_" plus 12 hex. At 16 hex it was 22 and every insert was refused.
    # The status is checked: an ignored refusal only surfaced one step later
    # as a foreign-key error from grant_credit, which reads like a credit bug.
    ps, pd = req("POST", "/rest/v1/profiles",
                 {"id": uid, "username": f"smoke_{uid.replace('-', '')[:12]}"}, key=SVC)
    if ps not in (200, 201):
        print("  cannot create profile:", ps, json.dumps(pd)[:200])
        req("DELETE", f"/auth/v1/admin/users/{uid}", key=SVC)
        sys.exit(1)
    s, d = req("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw})
    if s != 200:
        print("  cannot sign in:", s, json.dumps(d)[:200])
        sys.exit(1)
    jwt = d["access_token"]
    gs, gd = rpc("grant_credit", {"p_user_id": uid, "p_amount": 20, "p_reason": "welcome",
                                  "p_reference_id": f"smoke-{uid[:8]}",
                                  "p_operation_key": rid("grant")})
    if gs != 200:
        print("  grant_credit failed:", gs, json.dumps(gd)[:200])
        sys.exit(1)
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
        ("bootstrap-user","POST", "/functions/v1/bootstrap-user", {}),
        ("profile",       "POST", "/functions/v1/profile", {"action": "me"}),
        ("shape-story",   "POST", "/functions/v1/shape-story", {"idea": "x"}),
    ]:
        st, _ = req(method, path, body, key=ANON)
        check(f"1.x {name} is deployed (not 404)", st != 404, f"HTTP {st}")
        check(f"1.x {name} rejects anonymous", st == 401, f"HTTP {st}")

    # library is deliberately public - it filters to is_public/is_curated and
    # has no getUser() gate. Asserting 401 here would be wrong; what matters is
    # that an anonymous caller cannot see a private story. Checked in [3].
    st, _ = req("GET", "/functions/v1/library", key=ANON)
    check("1.x library is deployed and public by design", st == 200, f"HTTP {st}")

    # ------------------------------------ 1b first load, profile, shaping
    # Read-only calls, made before the generation below so a failure here is
    # reported even when generation is what is broken.
    print("\n[1b] Every screen's first load, the You tab, and shaping")
    t0 = time.time()
    st, boot = req("POST", "/functions/v1/bootstrap-user", {}, token=jwt, timeout=30)
    boot_ms = int((time.time() - t0) * 1000)
    check("1b.1 bootstrap-user 200", st == 200, f"HTTP {st} in {boot_ms}ms")
    check("1b.2 bootstrap-user names this account",
          isinstance(boot, dict) and boot.get("user_id") == uid)
    check("1b.3 bootstrap-user returns a balance",
          isinstance(boot, dict) and isinstance(boot.get("balance"), int),
          str((boot or {}).get("balance")) if isinstance(boot, dict) else "")

    t0 = time.time()
    st, me = req("POST", "/functions/v1/profile", {"action": "me"}, token=jwt, timeout=30)
    check("1b.4 profile me 200", st == 200,
          f"HTTP {st} in {int((time.time() - t0) * 1000)}ms")
    check("1b.5 profile me returns this account's profile",
          isinstance(me, dict) and isinstance(me.get("profile"), dict))
    st, ledger = req("POST", "/functions/v1/profile", {"action": "ledger"},
                     token=jwt, timeout=30)
    check("1b.6 profile ledger 200", st == 200, f"HTTP {st}")

    # The same payload DirectionStep sends. `beats` is what the opening chips
    # are made from, so an empty list here is the empty screen a writer sees.
    t0 = time.time()
    st, shaped = req("POST", "/functions/v1/shape-story",
                     {"idea": "A lighthouse keeper on a remote island finds letters "
                              "from her grandmother describing a shipwreck the "
                              "village will not talk about.",
                      "variant": "create", "genre": "mystery",
                      "characters": [], "moments": [],
                      "chapter_length": "standard",
                      "planned_chapter_count": 3},
                     token=jwt, timeout=60)
    shape_ms = int((time.time() - t0) * 1000)
    shape = shaped.get("shape") if isinstance(shaped, dict) else None
    check("1b.7 shape-story 200", st == 200, f"HTTP {st} in {shape_ms}ms")
    check("1b.8 shape-story returned a shape, not a null",
          isinstance(shape, dict),
          f"reason={shaped.get('reason')}" if isinstance(shaped, dict) and not shape else "")
    check("1b.9 the shape carries opening beats",
          isinstance(shape, dict) and len(shape.get("beats") or []) >= 1,
          f"{len((shape or {}).get('beats') or [])} beats")

    # ---------------------------------------------------------- 2 a story
    print("\n[2] Generate a story to operate on")
    st, gen = req("POST", "/functions/v1/generate-story",
                  {"seed": "a lighthouse keeper finds a door in the sea floor",
                   "genre": "mystery", "request_id": rid("app")}, token=jwt)
    if not check("2.1 generate-story 200", st == 200, f"HTTP {st}"):
        print("  ", json.dumps(gen)[:250])
        raise SystemExit
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
    # A body without `visibility` publishes privately on purpose (a missing
    # field must never make a story public), so the public path is asked for.
    st, pb = req("POST", "/functions/v1/publish-story",
                 {"story_id": story_id, "visibility": "public"},
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
        # The cover is drawn in the background after generation, so it can
        # land after publish returns. Wait for it rather than calling a slow
        # cover a missing one.
        waited = 0
        while not cover and waited < 90:
            time.sleep(5)
            waited += 5
            _, again = req("GET", f"/rest/v1/stories?id=eq.{story_id}&select=cover_image_url",
                           key=SVC)
            cover = ((again or [{}])[0] if isinstance(again, list) and again else {}).get(
                "cover_image_url") or ""
        check("6.3 cover_image_url persisted", bool(cover),
              "set" if cover else "none after 90s")
        if cover:
            # Only a URL on this project can be fetched with the anon key. A
            # transport failure returns status 0, which is a failure - not a
            # reason to pass the check.
            if cover.startswith(URL):
                cs, _ = req("GET", cover.replace(URL, ""), key=ANON)
                check("6.4 cover is publicly readable", cs == 200, f"HTTP {cs}")
            else:
                check("6.4 cover URL is on the project origin", False,
                      f"unexpected host: {cover.split('/')[2] if '//' in cover else cover[:40]}")

    # -------------------------------------------------------- 7 audio-status
    print("\n[7] audio-status")
    # It requires job_id and story_id together; either alone is a 400.
    # Requires job_id, story_id and chapter_id together. A well-formed job id
    # that RunPod has never seen is the expired-job case a real poller hits.
    st, aud = req("GET",
                  f"/functions/v1/audio-status?job_id={uuid.uuid4()}"
                  f"&story_id={story_id}&chapter_id={chapter_id}",
                  token=jwt)
    # Only the defined outcomes pass. `st != 400` would also accept a 500 or a
    # 401, i.e. it would go green while the endpoint was broken or unreachable.
    # 404 is the expected answer here: 502 would tell a poller to keep retrying
    # a job that will never exist.
    check("7.1 an unknown audio job is 404, not a retryable 502",
          st in (200, 202, 404), f"HTTP {st} {json.dumps(aud)[:120]}")
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
            # error_events is not in this list, on purpose. 00023 dropped its
            # foreign key to profiles and 00025 nulls user_id when the profile
            # is deleted, so its rows cannot block the delete below. Only
            # INSERT and SELECT are granted to service_role (00019), so a
            # delete here would be refused with 403 on every run.
            # The profile call in [1b] records a streak row, and streaks
            # reference profiles with no cascade.
            (f"/rest/v1/streaks?user_id=eq.{uid}", "streaks"),
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

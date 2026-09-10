# Backend stress test, 2026-09-10

Five adversarial reviews (auth, money, generation, media, schema) plus live
probing of the production project. Everything below was **verified against
production**, not inferred from reading.

The headline: three shipped features were broken in production and none of
them looked broken, because each one degraded quietly instead of failing
loudly. That pattern — not any single bug — is the finding.

---

## Fixed and deployed

### 1. The home feed returned 500 to every user, on every request

`feed` read `user_blocks` with the **service** client. Migration 00043 ends
with `revoke all on table public.user_blocks from public, anon` and grants only
`authenticated`, so `service_role` had no `SELECT` and the read returned
`42501`. That read runs before any feed is built, so the throw reached the
catch and the handler answered `500` — from the day 00043 was applied until
today.

It was invisible for two compounding reasons: the client falls back to bundled
content on a failed fetch, so Home still looked populated; and the handler
wrote no telemetry at all. `discovery` had been a permitted `error_events`
bucket since 00058 and no code had ever written to it.

Fixed by reading the block list through the caller's own JWT (where RLS scopes
it correctly), granting `service_role` the SELECT so the next service-side
reader does not rediscover this, and wiring the handler's catch to `discovery`.

*Verified: `HTTP 200` for a fresh guest that returned `500` an hour earlier.*

### 2. A provider error mid-stream was saved as a finished chapter, and charged

`streamOnce` recorded `finish_reason` but acted only on `"length"`, treated
only the literal `[DONE]` as terminal, and never looked at the `error` object
OpenRouter sends in-band after a 200. Three shapes all resolved as clean
successes:

- an in-band provider error (429, upstream failure) mid-stream
- a socket that closed with no `[DONE]` and no `finish_reason`
- `finish_reason` of `error` or `content_filter`

Each produced a chapter that stopped mid-sentence, persisted it with
`status = 'complete'`, and kept the credit. On `reimagine-chapter` — which
updates in place and deletes the chapter's narration — a finished chapter was
replaced by the stub, unrecoverably.

Fixed: the stream now distinguishes "the model finished" from "the bytes
stopped arriving". `stop` and `length` are the only acceptable endings. Prose
already shown to the reader stays on screen and the credit is refunded;
nothing half-written is persisted. Five regression tests, including two that
assert the legitimate endings still work.

### 3. Spanish narration was offered and could not work

00053 hid the `edge_tts` pair because the provider was a stub, and said why:
"An unavailable voice is worse than a shorter list." 00059 reactivated them for
a worker that was never deployed — `EDGE_TTS_SERVICE_URL` is not set. So the
picker offered both Spanish voices, `ListenScreen` defaulted every Spanish
story to Elvira, and every tap failed with `edge_tts_service_missing` and filed
a `critical` error event.

Fixed at both levels: the rows are deactivated again (00063), **and**
`_shared/voices.ts` now asks the running deployment whether a provider is
configured at all. An operator flipping `is_active` cannot re-break Spanish
narration while the worker is missing.

Bringing the pair back takes **both** — a configured `EDGE_TTS_SERVICE_URL`
*and* reactivating the rows. The deployment gets a veto here; it does not get
to overrule an administrator who switched a voice off.

*Verified: the endpoint offers 6 working voices; `language=es` returns 0.*

### 4. Every private story's cover and narration was downloadable by anyone

The `covers` and `audio` buckets were created by hand, public-read, with a
SELECT policy broad enough to permit `list`. Confirmed unauthenticated, with
only the anon key that ships inside the app bundle: listing `covers/` returned
story UUIDs, and fetching a **private** story's cover returned 1.9 MB.

Public serving was intended. Listing was not, and listing is what turns "you
need the UUID" into "here are the UUIDs". 00065 removes client-role SELECT on
`storage.objects` for those two buckets; `/object/public/...` does not consult
RLS, so serving is unaffected and no client change was needed.

*Verified: enumeration returns empty; a cover still loads with no auth;
`avatars` untouched.*

**Not fixed by this:** a URL already handed out still works, and anyone who
learns a story UUID by other means can still fetch its media. The real fix is
private buckets with short-lived signed URLs — a client change touching every
cover in the feed, the story page, the reader and Listen. Tracked below.

### 5. The Library's shelves and search were querying a column that does not exist

`stories.bookmark_count` was never created. The client selects it by name in
`SHELF_STORY_COLUMNS` and in search's `STORY_COLUMNS`, so PostgREST rejected
the whole select with `42703`: the Library's Created and Starred shelves
returned empty for every user, and `searchStories` caught the error and fell
back to the bundled seed catalogue — search has never once searched real
stories.

00064 adds the column and, in the same breath, fixes what stood in for it:
`toggle_bookmark` ended with `count(*) ... where story_id`, and `bookmarks` had
no index on `story_id` (its sibling `story_likes` got one in the same 00003).
That was a sequential scan of the whole table on every bookmark tap. The
counter is now maintained incrementally under the lock the function already
takes, matching `toggle_story_follow`.

### 6. Three more service-role grants that were silently failing

Same root cause as the feed. `user_characters`: saved-character lookup catches
the error and drops the id, so a writer who picks a saved character silently
gets a blank one — and `reimagine-chapter` throws outright.
`revenuecat_subscriptions`: the annual credit refresh would fail on its first
run. Granted in 00063, with a test that also asserts the rate-limit tables stay
unreachable — least privilege is the other half of the fix.

### 7. Annual subscribers were going to be short-changed eleven months a year

`refresh-subscription-grants` has existed, secured and idempotent, since 00026,
and **nothing has ever called it**. There is no `pg_cron` in any migration and
no scheduled workflow. An annual plan bills once and delivers its credits every
month; without a caller it delivers them once.

Added a daily scheduled GitHub workflow. Daily rather than monthly on purpose:
the function is a no-op after the first success in a calendar month, so a
missed run cannot cost a subscriber their month. The cron secret was rotated
into both GitHub and Supabase.

### 8. An expiration could wipe credits a subscriber had just paid for

`lapse_credits` empties every bucket — subscription grant, purchased packs and
earned credits alike — and it ran on any `EXPIRATION`, keyed only on the event
id being new. Two ordinary sequences made that destructive: a straggling
expiration from the previous period landing after this period's RENEWAL, and
an upgrade's old-product expiration arriving after the user moved to the new
one. Meanwhile `record_revenuecat_subscription` **is** ordered by
`last_event_at`, so the subscription row correctly ignored the same event — the
user would show an active tier with a zero balance.

Now the row itself is the check: read it back after recording, and lapse only
if this event is the one on record. (The full-wipe rule stays: decision 37,
pending App Review — that one is yours, not mine.)

### 9. A user could write their own profile row before the server created it

00038 and 00060 spent two migrations taking `avatar_url`, `referred_by` and
`account_created_at` away from UPDATE. Neither touched INSERT, which 00002 and
00012 had left open — and the row is created lazily, so there is a window
between signing in and calling bootstrap that belonged to the client. An avatar
pointed at any URL is a tracking pixel served to everyone who reads that user,
which is precisely what `set_avatar` exists to prevent. INSERT is now
server-only.

### 10. Ten telemetry keys were being dropped in silence

`ALLOWED_CONTEXT_KEYS` is an allowlist — correctly, it is what keeps prose and
seeds out of the error log — but it was never extended as new call sites
landed. On production, `streamed_chapter_outside_band` rows carried a `model`
and nothing else: `words`, `band_min`, `band_max` and `truncated` were all
discarded, so the one number the log exists to report was never recorded on a
single row. All ten added (every one a count, boolean or fixed enum). The PII
tests still pass unchanged.

### 11. Missing foreign-key indexes

00041 stated the rule and applied it to one column. 00066 adds thirteen
indexes on the FKs that will actually be walked — comments, story_reads,
saved_phrases, phrase_practice, content_reports, generation_operations,
user_characters, characters, error_events. All non-concurrent, which is safe
now and would not be later; this was the last comfortable moment.

### 12. Smaller ones, same pass

- **Narration had no length cap.** `edit-story` accepts a 200,000-character
  chapter body and the whole thing went to the provider, which bills for all of
  it before the 50 MB ceiling discards the result. Now refused at 40,000
  characters, before spending.
- **A non-base64 `result` crashed the poller.** `atob` throws; it does not
  return null. A provider reporting a failure in a field typed as a result
  produced a 500, then a ten-minute stall mislabelled `generation_timed_out`.
  `edge-tts.ts` already guarded the same call; this copy did not.
- **Raw provider error bodies reached a client-readable row.** RunPod puts a
  Python traceback in `error`; `audio-status` wrote it to `chapter_audio` and
  returned it, and RLS lets any reader of a public story select that row. Now
  classified through `safeErrorCode`.
- **`continue_reading` ignored visibility.** It selected purely on "the caller
  has read it", so a story kept its place on the reader's home screen after the
  author took it private — including one forced private for naming a real
  person. Now gated, with the author keeping their own.
- **Two unbounded `story_reads` selects** would have been silently truncated at
  PostgREST's 1000-row ceiling, so a heavy reader would get an arbitrary slice
  of their history and watch finished stories drift back into the feed. Both
  bounded and ordered.

---

## Verified working after all of it

A real generation on production, end to end:

| | |
|---|---|
| First token | 3.9 s |
| Chapter complete | 43.1 s, 1,146 words |
| Credit | 3 deducted, balance correct |
| Cover | generated and serving |
| Narration | 6.7 MB MP3, row `ready`, no error |
| Entity gate | "Taylor Swift and Elon Musk" → both classified `living_public_figure`, `entity_gate_reason` recorded, story forced private |

Suites: **763 backend function tests, 141 migration tests, 0 failures.**

---

## Not fixed — deliberately, and why

1. **Account deletion cannot succeed.** Ten foreign keys have no `ON DELETE`,
   and every user has a `credit_ledger` row, so `deleteUser` raises `23503` and
   rolls back. The erasure trigger in 00025 therefore never fires. There is no
   deletion path in the code at all. This is an App Store and GDPR requirement,
   and the fix needs a decision per FK — cascade the content, but a credit
   ledger is a financial record and "delete it" is not obviously right. It also
   needs a client screen. **This is the largest remaining gap.**
2. **Signed URLs for media.** Enumeration is closed; direct URL access by UUID
   is not. Needs a client change everywhere a cover is rendered.
3. **`edit-story` and `shape-story` are free and unmetered.** Both run real
   model calls with no credit and no rate limit, and anonymous accounts are
   free to mint. 00055 shows the pattern (12/hour, server-side); neither has it.
   Bounded by attacker effort, not by us.
4. **There is no public content.** Zero public or curated stories exist. Every
   new user's feed is empty and Katha Originals has nothing in it. That is a
   content decision, not a code defect, but it is a launch blocker.
5. **Orphaned audio accumulates.** 00062 records orphans; nothing deletes them.
   Quantified at roughly $0.14/month per thousand — real but negligible, and
   a deletion job that gets it wrong deletes live audio.
6. **The metadata call is a second single point of failure.** After prose
   streams successfully, a second OpenRouter call fetches metadata; if it fails,
   the whole chapter is discarded and refunded. The reader watches a full
   chapter appear and then vanish. Correlated with the first call's failures,
   since Gemini is disabled and the free tier cannot answer in the time left.

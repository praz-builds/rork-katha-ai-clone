# Security triage

A running record of external scanner findings against this repository: what was
fixed, what was dismissed, and why. AGENTS.md asks that medium and low findings
be documented and tracked rather than silently carried, and this is where that
tracking lives.

Anything listed here as accepted should be re-checked when the underlying
dependency next moves.

---

## Hotlist of 2026-09-06 (Code Ants)

The export ranked 30 findings across two repositories under the `praz-builds`
account. Only four of them are ours:

| # | Finding | Where | Outcome |
|---|---------|-------|---------|
| 12 | Automatic backup is enabled | `android-katha-ai/app/src/main/AndroidManifest.xml:7` | **Fixed** |
| 21 | CVE-2025-71329 — image-size JXL infinite loop | `expo/package.json` (transitive) | **Fixed by patch** |
| 22 | CVE-2025-71330 — image-size ICNS infinite loop | `expo/package.json` (transitive) | **Fixed by patch** |
| 19 | GHSA-8x6c-cv3v-vp6g — cacheable-request | `expo/package.json` (transitive) | **Dismissed — advisory withdrawn** |

The remaining 26 findings — ranks 1-11, 13-18, 20, 23-30 — are located in
`praz-builds/story-for-my-kid`. That is a different product and a different
repository; none of the paths they name (`vps/pyproject.toml`,
`src/pages/api/**`, `design-previews/**`, the root `package.json` carrying
astro, svgo, postcss, sharp, js-yaml, undici, nanoid and esbuild) exist here.
They have to be fixed in that repository and are out of scope for this one.

---

### Fixed — Android automatic backup (rank 12)

`android-katha-ai` shipped `android:allowBackup="true"`, the platform default.
That opts the app into Google's cloud backup and, on Android 12 and above, into
device-to-device transfer. Everything the app keeps in private storage — the
reader's session token, story drafts, streak state — was eligible to be copied
off the device and restored onto another one.

The application element now sets `android:allowBackup="false"` and points at two
new resource files that exclude every domain:

- `res/xml/data_extraction_rules.xml` covers Android 12+ (`targetSdk` is 36),
  excluding both `cloud-backup` and `device-transfer`.
- `res/xml/backup_rules.xml` covers Android 11 and below.

The rule files are redundant while `allowBackup` is false. They are there so
that re-enabling backup later is a deliberate act with a safe default, rather
than a one-word change that quietly re-exposes everything.

**Note for the Expo client.** `expo/` has no checked-in Android project — the
manifest is generated at prebuild time from the Expo template, which also sets
`allowBackup="true"`. SDK 54 exposes no `android.allowBackup` config key, and
neither `@expo/config-plugins` nor `expo-build-properties` can set it, so
closing the same hole there needs a small custom config plugin running a
`withAndroidManifest` mod. That is tracked as follow-up work; the scanner did
not flag it, because there is no manifest in the repository for it to read.

---

### Fixed — image-size infinite loops (ranks 21, 22)

`image-size@1.2.1` parses container formats by adding each box's declared length
to a cursor. A file that declares a length of zero leaves the cursor where it
was, so the loop never advances: the parser spins forever while appending to its
results array until the process is killed.

Two parsers are affected:

- `dist/types/icns.js` — the image-header walk (CVE-2025-71330)
- `dist/types/jxl.js` — `extractPartialStreams` over `jxlp` boxes (CVE-2025-71329)

The HEIF path named in the same advisory is already safe in 1.2.1: it goes
through `utils.findBox`, which advances by 8 bytes when a box declares a length
of zero.

**Why a patch and not an upgrade.** There is no fixed release to upgrade to.
GitHub records `first_patched_version: null` for both advisories, and the latest
published version, 2.0.2, is still vulnerable. Separately, `image-size` is not a
direct dependency: metro pins it at `^1.0.2`, so a major-version override would
be rejected regardless. The scanner marked both findings `Fixable: No` for
exactly this reason.

So both loops are patched in place. `expo/patches/image-size@1.2.1.patch` adds a
zero-length break to each, wired up through `patchedDependencies` in
`expo/pnpm-workspace.yaml` — that is where pnpm 11 reads its settings from, not
the `pnpm` block in `package.json`. Two `auditConfig.ignoreGhsas` entries sit
alongside it so `pnpm audit` stays quiet; they are only honest for as long as
the patch is applied, which is what the test below enforces.

The patch itself landed in #56, from parallel work on the same hotlist. This
entry keeps the reasoning, the measurements and the regression test.

**Exposure, honestly stated.** This is a build-time dependency. Metro calls
`image-size` to measure asset dimensions while bundling; nothing from it ships
into the app. Reaching the bug requires a hostile ICNS or JXL file to already be
in the asset tree, and the worst outcome is a build that never finishes. That is
a hung CI job, not a compromised reader — but it is a cheap fix and a real
denial of service against the build, so it is fixed rather than accepted.

Verified before and after: the unpatched parser had to be killed after five
seconds on both inputs; the patched one returns in about a millisecond.
`expo/src/__tests__/image-size-patch.test.ts` keeps it that way — it parses both
hostile buffers in a child process with a hard timeout, so a `pnpm install`
that drops the patch fails the suite instead of hanging it.

---

### Dismissed — cacheable-request (rank 19)

GHSA-8x6c-cv3v-vp6g has been **withdrawn** by GitHub. It reported that
`cacheable-request` depended on a ReDoS-vulnerable `http-cache-semantics`; the
advisory was retracted, and the correct one applies to `http-cache-semantics`
itself. The scanner is reporting a record that is no longer live.

Two things would make it a non-issue even if it stood:

1. It arrives via `@expo/ngrok`, a **devDependency** used only for dev tunnels.
   It is not installed in CI builds and ships nothing to users.
2. The withdrawn advisory's fixed version is `cacheable-request >= 10.2.7`, but
   `got@11.8.6` requires `^7.0.2`. Forcing 10.x would break `got`'s API for a
   vulnerability that does not exist.

No action. Re-check if the scanner keeps surfacing it — that would be a bug in
its advisory feed rather than a change in our tree.

---

## Review of 2026-09-16 (branch `codex/profile-credits-launch`)

A scan of the 00089 surface — the streak ladder, feedback claims, invite codes
and the store reviewer's sign-in — returned nine findings. Five are fixed in
this session; four are recorded here as accepted, with the reasoning, so that
the next scan does not re-open them.

| Finding | Where | Outcome |
|---------|-------|---------|
| `generateLink` could sign up a new auth user | `backend/supabase/functions/reviewer-signin/index.ts` | **Fixed** (see `build-log.md`) |
| `content_reports` reason check was the union of both targets | migration 00090 | **Fixed** |
| `streak_ladder()` missing its revoke/grant pair | migration 00090 | **Fixed** |
| D9's qualifying read trusted a client-supplied duration | migration 00090 | **Fixed** |
| `referral/index.ts` claimed globally unique operation keys | comment only | **Fixed** |
| Per-email lockout on `reviewer-signin` is a denial-of-service on the reviewer | `reviewer_signin_locked` (00089) | **Accepted** |
| `referral` `claim` has no rate limit | `backend/supabase/functions/referral/index.ts` | **Accepted** |
| The upheld-report gate checks `actioned` only, and a claimed comment can be hard-deleted | `comment_credit_block_reason` (00089) | **Accepted** |
| GHSA-2883-xcg3-v3hh — js-yaml | `expo/pnpm-workspace.yaml` | **Fixed by override** |

---

### Accepted — the per-email lockout can lock the store reviewer out

`reviewer_signin_locked` refuses an address after five failures in fifteen
minutes, and the bucket is the sha256 of the address, **not** of the address
and the IP together. So anybody who knows the reviewer's address can send five
wrong codes from anywhere and hold the account shut for a quarter of an hour,
indefinitely, for the cost of five requests. The endpoint is `verify_jwt =
false`, so no account is needed to do it.

**Why this is accepted rather than fixed.**

1. The address is not published. It reaches Google's review team through the
   Play Console's App Access section and Apple's equivalent; neither surface is
   public, and neither is indexed. An attacker has to be given the target
   before they can attack it.
2. The obvious alternative — scoping the lockout to (email, IP) rather than to
   email — is worse. The code is six digits, a space of one million, and
   `x-forwarded-for` is a header the caller writes. An attacker who rotates it
   would get five guesses per rotation and no ceiling at all, which turns a
   nuisance into an actual credential break. The per-IP limit that does exist
   (100 an hour) is a backstop against volume, not an identity.
3. The blast radius is one account for fifteen minutes. It cannot read
   anything, cannot write anything, and cannot extend itself — a locked request
   is refused *before* an attempt row is written, so hammering a locked address
   does not push the window forward.

**The mitigation, if it ever bites.** Rotate the six-digit code, re-seed
`tester_accounts.code_hmac` with
`hmac_sha256(email || ':' || code, REVIEWER_CODE_PEPPER)`, and hand the new
code to the store. A rotation does not clear the lockout; it takes fifteen
minutes of quiet for that, and the rotation is what stops a second round.
Provisioning a second reviewer address is the other lever, and costs nothing.

Re-open this if the reviewer's address ever appears in a public listing, a
support macro, or a screenshot.

---

### Accepted — `referral` `claim` has no rate limit

`claim_referral_code` is reachable once per authenticated caller with no
per-minute ceiling in front of it, so an account can walk the code space and
learn which codes exist. Codes are derived from public usernames, so the
enumeration reveals nothing that a profile page does not, and a claim is
one-shot per account: the first accepted code is recorded and every later
attempt refuses with `already`. An attacker therefore gets one guess that pays,
and the information they can farm before it is already on the profile.

Worth adding a limiter when the referral surface next moves, not worth a
migration of its own.

---

### Accepted — the upheld-report gate, and the deletable claimed comment

Two narrower-than-the-spec behaviours in `comment_credit_block_reason`, both
harmless as built:

**`status = 'actioned'` only.** D9 says a comment that has been reported and
upheld earns nothing. The gate reads `actioned` and ignores `reviewed`, so a
report a moderator has looked at but not yet acted on does not block a claim.
That is the correct direction to be wrong in — `reviewed` means "seen", not
"upheld", and blocking on it would let any reporter suppress a credit by filing
a report and waiting for a triage pass. If `reviewed` ever comes to mean
"upheld, pending action", this becomes a real gap and the gate has to widen.

**A claimed comment can still be hard-deleted.** The owner UPDATE policy
excludes rows with `credit_claimed_at set`, which freezes the *content*, but
the DELETE grant is table-wide, so the row itself can go. It does not reset
anything: every cap in the gate — story, daily, monthly — counts rows in
`credit_ledger`, never rows in `comments`. Deleting the comment therefore
removes the feedback the author was paid for and leaves the payment, the
`reference_id` and all three caps exactly where they were. The dishonest
version of this attack costs the attacker a credit and buys them nothing.

---

### Fixed by override — js-yaml (GHSA-2883-xcg3-v3hh)

Recorded here because it appears alongside the findings above and is **not**
accepted. Both major lines in the Expo tree are pinned past the advisory
through `overrides` in `expo/pnpm-workspace.yaml`: `js-yaml@3` → `3.15.2` and
`js-yaml@4` → `4.3.2`. That is where pnpm 11 reads its settings from, not the
`pnpm` block in `package.json` — the same rule the image-size patch entry
above depends on. No further action; re-check the pins whenever the Expo
toolchain's transitive `js-yaml` range moves.

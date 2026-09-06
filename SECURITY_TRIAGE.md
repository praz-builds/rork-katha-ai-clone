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

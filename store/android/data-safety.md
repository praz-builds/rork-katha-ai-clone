# Data safety — Play Console answers

<!-- markdownlint-disable MD013 -->

**Where:** Play Console → your app → Policy → App content → Data safety.
**Audited against:** `main` at `dbd2168` (2026-09-25). Every answer below cites the code it rests on. If a cited file changes, re-check the row before the next submission.

This replaces `content/data-safety.md` in the `thetractionlabs-site` repo (dated 2026-09-10), which is now stale in five places: it said guests never give an email, Sentry sends nothing, PostHog captures no custom events, the entity gate keeps stories private, and it did not know the OpenRouter training tier was serving.

## Before you paste: three decisions and two dependencies

These change answers below. Each is marked **[D1]**–**[D3]** or **[P1]**–**[P2]** where it applies.

| # | What | Why it matters | Recommendation |
|---|---|---|---|
| **D1** | **OpenRouter training tier.** `OPENROUTER_MODEL` is `meta/muse-spark-1.3-contributor` (`backend/supabase/functions/_shared/llm.ts:63`), a tier priced down *because the provider keeps prompts and completions for training*. `AGENTS.md` (LLM Fallback Chain, "The contributor tier IS serving. Corrected 2026-09-09") says the account setting now allows it. The last-resort `openrouter/free` router is also typically served by models that log prompts. | Google counts a transfer as **sharing** when the recipient uses the data for its own purposes. Training a model on users' story text is the recipient's purpose, not ours. So today, "Other user-generated content" and "Name" (character names are in the prompt) are **shared**. | Turn training off at <https://openrouter.ai/settings/privacy>, drop the contributor id and the free router from the chains, and answer **not shared**. Until that is done, answer **shared** as written below. The privacy policy draft discloses the current state either way. |
| **D2** | **PostHog GeoIP.** PostHog derives a city and country from the IP of every event unless the project discards IPs. `initPostHog()` (`expo/src/lib/analytics.ts:132`) sets nothing to prevent it. | A derived city is **Approximate location**. | In PostHog → Project settings, turn on **Discard client IP data** (a free console switch), then answer Approximate location **not collected**. If you do not, tick Approximate location (Analytics). |
| **D3** | **Partial deletion without deleting the account.** In the app a user can delete a saved character (`deleteSavedCharacter`, `expo/src/lib/api.ts:2267`) but not a story or a comment; there is no unpublish control in the client either. | The form asks whether users can ask for *some* data to be deleted without closing the account. | Answer **Yes**, and handle such requests from the support inbox (the delete page already says so). If nobody will act on those emails, answer **No**. |
| **P1** | **Firebase removal** (P0 row "Firebase / google-services.json"). `@react-native-firebase/analytics` is still in `expo/package.json` and brings the `AD_ID` permission. | "Device or other IDs → Advertising ID: not collected" and the separate **Advertising ID** declaration ("No") are only true once Firebase and `AD_ID` are gone from the merged manifest. | Land the build-config PR first. Check the first AAB's merged manifest has no `com.google.android.gms.permission.AD_ID`. |
| **P2** | **Sentry DSN** (P0 row "Crash reporting"). `sentryDsn` is `""` in `expo/app.json`, so `initSentry()` (`analytics.ts:27`) returns early today. | Crash logs / Diagnostics are answered **collected** below because the reviewed build is meant to ship with the DSN set. | If the first build goes out without a DSN, the answers are still acceptable (declaring more than you collect is allowed; declaring less is not). |

## Section 1 — Data collection and security

| Question | Answer | Grounding |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Everything under Section 2. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Every client call is HTTPS: Supabase (`https://iafeuxgoiknncgyjmugd.supabase.co`), PostHog (`https://eu.i.posthog.com`, `analytics.ts:13`), RevenueCat and Sentry SDKs. Every server-side call is HTTPS: OpenRouter, Gemini (`generativelanguage.googleapis.com`), RunPod (`api.runpod.ai`), Brave Search, Expo push (`exp.host`). No `http://` endpoint exists in `expo/src` or `backend/supabase/functions/_shared`. |
| Which methods of account creation does your app support? | **Other** → "Email address verified with a one-time code (passwordless). A temporary anonymous session is created on first launch and converted in place when the email is verified." | `signInAnonymously` (`expo/src/lib/session.ts:175`), `signInWithOtp` (`session.ts:411`), converted in place so the user id survives (`session.ts:382`). No password, no Google/Apple sign-in. |
| Delete account URL | `https://katha.thetractionlabs.com/delete-account/` | Live page with a request form (thetractionlabs-site `sites/katha/delete-account/`). |
| Can users delete their account in the app? | Yes: **You** tab → **Delete account** (bottom of the screen) → reason → **Delete my account**. | `expo/src/screens/ProfileScreen.tsx:424`, `DeleteAccountSheet.tsx:290`, `deleteAccount()` in `expo/src/lib/profile.ts:770` → `profile` function `action: "delete"` → `delete_account()` (migration `00070_account_deletion.sql`). |
| Do you provide a way for users to request that some or all of their data is deleted, without requiring them to delete their account? | **Yes** **[D3]** | Saved characters in-app; anything else by email to the support inbox. |
| Committed to the Play Families Policy? | Not applicable — do not select. Target audience is 18+ only. | See `content-rating.md`. |
| Independent security review (MASA)? | **No** — leave unticked. | None has been done. |

## Section 2 — Data types

Google's columns: **Collected**, **Shared**, **Processed ephemerally**, **Required or optional**, **Purposes**. "Not shared" below always means the recipient is a service provider processing the data on Katha's behalf (Supabase, RunPod, RevenueCat, Sentry, PostHog, Expo, Brave, and OpenRouter/Gemini when **[D1]** is resolved), which Google exempts from "sharing".

### Location

| Type | Answer | Grounding |
|---|---|---|
| Approximate location | **Not collected** if **[D2]** is done. Otherwise: Collected · Not shared · Not ephemeral · Required · Analytics. | No location permission in `expo/app.json` (`android.permissions` is `POST_NOTIFICATIONS` only). PostHog GeoIP is the only path. |
| Precise location | **Not collected** | No location API or permission anywhere. |

### Personal info

| Type | Collected | Shared | Ephemeral | Required? | Purposes | Grounding |
|---|---|---|---|---|---|---|
| **Name** | Yes | **Yes today [D1]**, No once fixed | No | **Required** | App functionality, Personalization, Account management | The first onboarding question asks the reader's name and will not continue without it (`KathaOnboardingFlowV2.tsx:517`, `ready = name.trim().length > 0`); saved to the profile by `saveDisplayName` (`App.tsx`, `finishCharacterOnboarding`). A handle is also preassigned (`ensure_identity`, migration 00089). Character names typed on a character sheet go into generation prompts, hence the D1 link. |
| **Email address** | Yes | No | No | **Required** | Account management, App functionality | Onboarding W5 asks for it with no skip (`CharacterOnboarding.tsx`, step `w5` → `code`); `sendEmailCode` → `signInWithOtp` (`session.ts:411`). Held by Supabase Auth only; never sent to any AI provider, analytics or marketing tool. |
| **User IDs** | Yes | No | No | **Required** | Account management, App functionality | The Supabase user UUID. Sent to RevenueCat as `appUserID` (`expo/src/lib/revenuecat.ts:92`, `:281`) so a purchase lands on the right account. `identifyUser()` (`analytics.ts:146`) is **never called**, so it does not reach PostHog or Sentry. |
| Address, Phone number, Race and ethnicity, Political or religious beliefs, Sexual orientation, Other info | **Not collected** | | | | | Nothing asks for these. (A story may *mention* such things; that is user-generated content, below.) |

### Financial info

| Type | Collected | Shared | Ephemeral | Required? | Purposes | Grounding |
|---|---|---|---|---|---|---|
| **Purchase history** | Yes | No | No | **Optional** | App functionality, Account management | RevenueCat SDK (`revenuecat.ts`) and the `revenuecat-webhook` function write purchases to `credit_ledger`. Kept after account deletion as a financial record against a scrubbed profile (`00070_account_deletion.sql`, comment above `return v_kept`). |
| User payment info | **Not collected** | | | | | Google Play Billing handles the card. Katha never sees it. |
| Credit score, Other financial info | **Not collected** | | | | | |

### Health and fitness · Messages · Audio · Files and docs · Calendar · Contacts · Web browsing

All **Not collected**.

- **Messages:** comments are public posts on a story, not messages between users. There are no direct messages. They go under "Other user-generated content".
- **Audio:** the app never records. Narration is audio *generated for* the user by RunPod, not collected from them. `expo-av` pulls in `RECORD_AUDIO`; the P0 row "Unjustified Android permissions" blocks it in `app.json` — confirm it is absent from the first AAB's merged manifest.

### Photos and videos

| Type | Collected | Shared | Ephemeral | Required? | Purposes | Grounding |
|---|---|---|---|---|---|---|
| **Photos** | Yes | No | **No** (see note) | **Optional** | App functionality | Two paths, both user-initiated from the system picker. (1) **Profile photo**: resized to JPEG and stored (`pickAndUploadAvatar`, `expo/src/lib/profile.ts:233` → `profile` function `action: "avatar"`); shown on the public profile; deleted with the account. (2) **Character style reference**: `pickReferenceImage` (`expo/src/components/create/CreateBriefFlow.tsx:183`) sends it once as a data URL to `generate-character-image`, which validates it (`parseReferenceImage`, ≤6 MB, JPEG/PNG/WebP) and forwards it to the Google Gemini image models through OpenRouter (`backend/supabase/functions/_shared/image.ts:856-864`). It is not written to storage or to the database. |
| Videos | **Not collected** | | | | | |

> **Note on "ephemeral":** Google lets you tick it only if *all* collection of the type is ephemeral. The reference photo is; the profile photo is not. So leave it unticked. Mention the reference-photo handling in the privacy policy instead (the draft does).

### App activity

| Type | Collected | Shared | Ephemeral | Required? | Purposes | Grounding |
|---|---|---|---|---|---|---|
| **App interactions** | Yes | No | No | **Required** | App functionality, Analytics, Personalization | Server-side: likes, stars/bookmarks, follows, reads and streak days (`story_likes`, `bookmarks`, `story_followers`, `user_followers`, `story_reads`, `activity_days`, `streaks`; all removed by `delete_account`). Onboarding answers (preferred genres, reading/writing purpose) on `profiles`. Client-side: PostHog captures its default lifecycle events (`captureAppLifecycleEvents` defaults to `true` in `posthog-react-native` 4.63) plus the events in `DirectionStep.tsx:234,252`, keyed to PostHog's own random install id. |
| **In-app search history** | Yes | No | No | **Optional** | App functionality | Search terms are sent to Supabase as a filter (`expo/src/lib/search.ts:204-206`). Katha stores no search history table, but request URLs can sit in the hosting provider's logs, so "ephemeral" is not claimed. |
| **Other user-generated content** | Yes | **Yes today [D1]**, No once fixed | No | **Required** | App functionality | Stories, chapters, story ideas, character sheets, comments, chapter feedback (`feedback` function), profile bio, content reports. Onboarding creates a character before sign-in (`AGENTS.md` → Onboarding, W4), so it is not optional. Story text goes to OpenRouter / Gemini to write, to RunPod MiniMax to narrate, and named real places/events in an idea go to Brave Search for grounding (`_shared/grounding-search.ts`; cast names are excluded). Private until published; published work is public by the user's choice. |
| Installed apps, Other actions | **Not collected** | | | | | |

### App info and performance

| Type | Collected | Shared | Ephemeral | Required? | Purposes | Grounding |
|---|---|---|---|---|---|---|
| **Crash logs** | Yes **[P2]** | No | No | **Required** | App functionality, Analytics | Sentry (`initSentry`, `analytics.ts:27`). `captureError` sends identifiers and enums only, never story text (`sanitizeClientContext`, `analytics.ts:58`). |
| **Diagnostics** | Yes **[P2]** | No | No | **Required** | App functionality, Analytics | Sentry performance traces (`tracesSampleRate: 0.2`) and session tracking (`enableAutoSessionTracking: true`), `analytics.ts:29-34`. PostHog's default device properties (model, OS, app version, locale). |
| Other app performance data | **Not collected** | | | | | |

### Device or other IDs

| Type | Collected | Shared | Ephemeral | Required? | Purposes | Grounding |
|---|---|---|---|---|---|---|
| **Device or other IDs** | Yes | No | No | **Required** | Analytics, App functionality | PostHog generates and persists a random anonymous id per install (`initPostHog`, `analytics.ts:132`). If the user allows notifications, the Expo push token and platform are stored (`syncPushToken` in `expo/src/lib/notifications.ts:97-131` → `register-push-token`); deleted with the account. **No advertising ID** once **[P1]** lands. |

## Quick copy list (what to tick)

Assuming **D1 fixed**, **D2 done**, **P1** and **P2** landed:

- **Personal info:** Name, Email address, User IDs — collected, not shared.
- **Financial info:** Purchase history — collected, not shared, optional.
- **Photos and videos:** Photos — collected, not shared, optional.
- **App activity:** App interactions, In-app search history, Other user-generated content — collected, not shared.
- **App info and performance:** Crash logs, Diagnostics — collected, not shared.
- **Device or other IDs:** Device or other IDs — collected, not shared.
- Everything else: not collected.

If **D1 is not fixed**: tick **Shared** on Name and Other user-generated content, purpose "App functionality".
If **D2 is not done**: add **Approximate location** — collected, not shared, Analytics.

## Also in App content (separate forms)

| Form | Answer |
|---|---|
| **Advertising ID** | "Does your app use advertising ID?" → **No** **[P1]**. |
| **Ads** | "Does your app contain ads?" → **No**. No ads SDK in `expo/package.json` (AdMob is listed as "Not yet wired" in `AGENTS.md`, and rewarded-ad credits were removed from the economy). |
| **Government apps / Financial features / Health** | Not applicable. |
| **Photo and video permissions** | Only if the merged manifest carries `READ_MEDIA_IMAGES`. The picker use is one-off (a profile photo, a style reference), which Play expects to go through the system Photo Picker with no permission. Check the first AAB; if the permission is there, block it in `app.json` rather than declaring it. |

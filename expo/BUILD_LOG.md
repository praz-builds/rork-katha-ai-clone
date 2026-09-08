# Katha AI Build Log

<!-- markdownlint-disable MD013 -->

## 2026-09-08: Onboarding preview survives its own failures

### Changed

- The onboarding preview no longer dead-ends. Every empty shape used to land on
  a "Preview needs one more try" screen whose only certain exit was Back to
  details - after the writer had typed an idea, chosen a shelf, entered a cast,
  verified an email and watched a loader. The preview is now built from their
  own words when the model gives us nothing: `fallbackTitle` from the idea, the
  shelf they chose, the cast they entered, and one line naming the chapter plan
  as something written when the story starts.
- A shape already in hand is reused when a later request is refused. The warm
  request is keyed on the whole brief, so walking back to add one moment spends
  another of the six shapes a minute the backend allows; `lastShape` keeps the
  preview the writer already earned instead of losing it to the seventh.
- The retry screen keeps Try again (it is now only reached when a retry can
  succeed) and gains "Continue without it", so no provider outage can hold a
  verified writer on an apology.
- `shape-story` says why a shape is empty: `rate_limited`, `provider_failed` or
  `unavailable`. A refused rate-limit claim used to be indistinguishable from a
  model returning nothing, and the client read both as non-retryable content
  failure - so a capacity ceiling was reported to the user as a bad idea.
- The onboarding opening prompt asks for 90-120 words in exactly two
  paragraphs, down from 120-180 in two or three. The preview renders
  `slice(0, 2)` clamped to three lines and two, and `finish()` never carries
  `opening` into the draft, so everything past the clamp was generated, paid
  for, waited on and dropped. A test now holds the band and the clamp together.
- `generateFastStructuredText` reserves a tail for the runner-up instead of
  splitting its window evenly by model index. `OPENROUTER_MODELS[0]` is 404 by
  account data policy today, so `[1]` inherits the window and the measured
  8-11s shape lands; an even split would have handed `[0]` 13.5s of
  onboarding's 45s the day that policy changes, aborting normal requests near
  the finish. Leader now gets 21s, runner-up 27s.
- Migration 00046 removes both anonymous ceilings on shaped previews: the 500
  a day across the whole project, and the 30 a day per anonymous network scope.
  Onboarding is anonymous, so the first was a cap on how many people could ever
  be shown a shaped preview in a day and the second rationed one office or cafe
  to thirty. Neither could stop an abuser - a shared ceiling only decides which
  innocent user absorbs the abuse - so what survives is the per-user window of
  six a minute, which is scoped to whoever is actually doing the damage.
  `shape-story` stops computing an HMAC of a guest's address for a parameter
  nothing reads any more, and the guest-without-a-scope path that silently
  refused to shape at all is gone with it.

### Loader

- The crafting loader's hold-on-last-stage fix is not in this branch. The bar
  used to fill to 100%, snap back to 4% and re-read stage one - at the 8-11s
  this screen actually waits, a claim the screen then withdrew. The fix was
  written here, picked up by the brand work rebuilding the same file, and
  reached main in PR #82, which also retired the progress bar outright. That
  answers the same complaint more completely than capping the bar did, so
  nothing is owed here; recorded so the fix is not written a second time.

### Still open

- `anonymous_story_shape_rate_limits` and `anonymous_story_shape_global_limits`
  are dead as of 00046 - nothing reads or writes them. Dropping them is a
  destructive change and was deliberately not smuggled in behind a policy one.
- Splitting the refusal reason by which window was hit needs the RPC to return
  more than a boolean. With one window left this matters less than it did.

### Verification

- `pnpm typecheck` clean, `pnpm lint` no new findings, `pnpm test` 444 passed
  across 51 suites (3 rewritten to the new contract, 3 added).
- `deno test -A supabase/functions/` 553 passed, 0 failed (3 added).
- `deno test -A supabase/migrations/` 83 passed, 0 failed (4 added; three in
  00039 and one in 00034 retired with a note in place, because they asserted
  ceilings 00046 deletes and every migration test runs the whole stack).

## 2026-09-08: Writer onboarding preview warming

### Changed

- Warmed the onboarding preview `shape-story` request from the details CTA, as
  soon as the complete writer brief is known, so email/code time overlaps the
  model call and the wait screen only covers the remaining tail.
- Fixed the warmed-request failure race so a failed warm result reaches the
  retry screen once, then clears for a real retry.

### Not shipped

- A Katha app-icon draw/fill animation was built for the crafting loader and
  then removed before this landed, on the product owner's instruction. The
  loader keeps its existing rings, arcs and breathing disc. Recorded here rather
  than silently dropped, so the next person does not rebuild it assuming it was
  an oversight.

### Measurement

- Live onboarding `shape-story` smoke, n=5: shape-only min 10.3s, median 11.3s,
  average 11.7s, max 14.2s.
- End-to-end anonymous auth + bootstrap + shape ranged from 13.4s to 16.8s.
- All five returned title and opening.

### Verification

- `pnpm test -- --runTestsByPath src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: 2 suites passing.
- `pnpm typecheck` clean.
- `pnpm lint` exits with 0 errors and the existing warning set.
- `pnpm exec jest --runInBand`: 34 suites, 331 tests passing.
- `pnpm exec expo-doctor`: 18/18 checks passing with local Node 22 in PATH.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-check` compiled the web bundle.
- Local Expo web started at `http://localhost:8091/`; 8090 was already occupied by another Katha checkout.

## 2026-09-06: Writer onboarding consistency and paywall pass

### Changed

- Resolved the PR review's comments/moderation blockers before merge: comment
  post parsing matches the server response shape, frontend report reasons use
  the backend enum, comment write/vote failures no longer replace a loaded
  thread with a load error, repeated vote taps are serialized per comment, and
  block failures stay on the sheet instead of navigating away as if the block
  worked.
- Brought the writer onboarding prompt, details, preview and paywall screens
  onto one visual rhythm: shared progress rows, compact dark section headers,
  quieter starter prompt cards, bolder selected filter chips and slimmer
  luminous CTAs.
- Replaced the details screen's old chapter segmented controls with Chapter
  Length and Chapters dropdown filter chips on a single row.
- Changed the detail heading to "Shape the Story", the detail CTA to "Create my
  story", the Moments action to an icon-only add button, and the preview CTA to
  "Continue".
- Replaced the raw writer subscription ask with a story-specific preview
  paywall that shows the concept card, credit math, included creation benefits,
  weekly/yearly plans, and the final "Create my story" CTA.

### Verification

- `pnpm typecheck` passed.
- Focused ESLint passed for `WriterOnboarding` and its tests.
- `pnpm test -- --runInBand src/__tests__/writer-onboarding.test.tsx
  src/__tests__/writer-onboarding-interactions.test.tsx` passed: 2 suites, 79
  tests.
- Focused review-fix tests passed: 6 suites, 107 tests.
- Full Jest suite passed: 25 suites, 268 tests.
- `EXPO_NO_DOTENV=1 pnpm exec expo export --platform web --output-dir
  /tmp/katha-writer-onboarding-paywall-export-check` passed.
- `pnpm exec expo-doctor` still passes 15/18 checks; the remaining checks fail
  because this shell cannot spawn `npm` (`spawn npm ENOENT`).
- `pnpm audit --audit-level high` exits cleanly with the two known
  `image-size` advisories ignored only after applying the local parser patch;
  `image-size@2.0.3` is not published, so a direct patched-version upgrade is
  not available.
- Local URL `http://localhost:8090/` was opened and returned `200 OK`.

## 2026-09-06: Single-Screen Main Create Flow

### Changed

- Reworked main Create into one scrollable generation screen: Genre, Kids Mode, story idea, starter chips, optional Premise, characters, More options, brief strength, credits, and `Create · 3 credits` all render together.
- Adjusted hierarchy again after product review: audience mode and Genre now share a compact parent row above the prompt, Genre opens a vertical picker, and Where/when plus Characters follow the starter prompts.
- Refined the parent row after visual review: Genre now sits left with a per-genre icon, Kids Mode is a compact switch on the right, and the genre picker is a narrow vertical menu rather than a full-width list.
- Changed the visible secondary context label from Where/when to `Premise` with an optional hint, removed helper copy under `Who's in it`, and tightened More options into a heading-style disclosure.
- Removed the main-flow `Continue` stage and the pre-story inference call from the Create UI path. The only story-generation call is the final Create action.
- Moved moments and chapter-plan editing into a lighter inline More options disclosure with writing style, chapters, length, language, visibility, spice, avoid, and chapter art.
- Kept Craft character as the only separate surface, presented through a native full-screen `Modal` with Create image/Reimagine/Edit/Delete states.

### Verification

- `jest src/__tests__/create-flow-contract.test.tsx src/__tests__/api-generation-contract.test.ts --runInBand`: passing, 32 tests.
- `tsc --noEmit`: passing.
- `expo export --platform web --output-dir /tmp/katha-single-create-flow-export-check`: passing.
- `expo export --platform web --output-dir /tmp/katha-parent-controls-export-check`: passing.
- `expo export --platform web --output-dir /tmp/katha-create-density-export-check`: passing.

## 2026-09-06: Onboarding/Create Design Consistency Pass

### Changed

- Aligned Create and writer-onboarding section labels to one black uppercase treatment, keeping primary headings separate.
- Standardized onboarding and Create starter prompt rails to mid-size preview chips.
- Replaced writer onboarding chapter segmented controls with wrapping chip groups for chapter count and chapter length.
- Flattened back controls to the same plain leading chevron treatment and normalized primary CTAs to the leaner 56-point style.
- Updated the legacy onboarding OTP screen to use the same single code field as the writer auth path.

### Verification

- `pnpm typecheck`: passing with bundled Node on `PATH`.
- `pnpm test -- --runInBand src/__tests__/create-flow-contract.test.tsx src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: passing, 86 tests.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-design-consistency-export-check`: passing.
- `pnpm exec expo-doctor`: 15/18 checks passed; remaining checks failed because Expo Doctor could not spawn `npm` from this shell.
- Local preview started at `http://localhost:8090/`.

## 2026-09-06: Writer Onboarding Filter Chip Follow-Up

### Changed

- Lightened writer onboarding starter prompt card text to match Create’s muted prompt previews.
- Replaced chapter count and chapter length rows with selected filter chips that open dropdown menus for the other options.
- Updated details-screen section labels to the Create-style black uppercase Hanken treatment.
- Changed the Moments composer action to an icon-only plus button.

### Verification

- `pnpm typecheck`: passing with bundled Node on `PATH`.
- `pnpm test -- --runInBand src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: passing, 79 tests.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-onboarding-filter-chip-export-check`: passing.
## 2026-09-05: Main Create Flow Hierarchy and Character Image Step

### Changed

- Collapsed the main Create setup from Idea → Shape → Review into Idea → Review and start. The final Create button, brief-strength meter, credits, and More options now live on the same reviewed setup surface.
- Shortened the Try one starter cards so they show a clipped three-line preview while tapping still inserts the complete prompt into the story idea field.
- Added Craft character image state: Create image, Creating, Reimagine, Edit, Delete, Image ready, and Image failed. Saving a character returns to Review and start without starting story generation.
- Added a client `generateCharacterImage` API wrapper for the new `generate-character-image` Edge Function and carried `portrait_url` through the final story-generation payload.
- Blocked final Create while a saved character image is still generating, so the story-generation call cannot start before requested character image work completes.

### Verification

- `jest src/__tests__/create-flow-contract.test.tsx src/__tests__/api-generation-contract.test.ts --runInBand`: passing, 31 tests.
- `tsc --noEmit`: passing.
- `expo export --platform web --output-dir /tmp/katha-create-flow-export-check`: passing.
- `pnpm` commands were blocked by the existing ignored-build approval prompt, so verification used the bundled Node runtime and local binaries directly.

## 2026-08-25: Audio Narration System

### Shipped

- Using **MiniMax Speech 02 HD** public endpoint on RunPod (no custom deployment needed). VibeVoice custom endpoint was abandoned (container crash-looped). Chatterbox Turbo was rejected (generative, invented content instead of reading the story).
- Created voice registry with 8 voices: 6 English (Aria, Luna, Zara, Kai, Ravi, Leo) + 2 Spanish (Elvira, Alvaro). Launch uses 2 per language (Aria+Kai for EN, Elvira+Alvaro for ES). Remaining 4 reserved for future Premium Voices feature.
- Built `generate-audio` edge function with language-aware routing: English to MiniMax Speech 02 HD (faithful TTS), Spanish to edge-tts (placeholder pending implementation).
- Built `audio-status` edge function: polls RunPod job status, decodes base64 audio, uploads to Supabase Storage `audio` bucket, updates `chapters.audio_url`.
- Added shared `_shared/edge-tts.ts` utility with voice mappings and language defaults.
- Reader screen voice toggle: shows Aria/Kai for English stories, Elvira/Alvaro for Spanish stories, auto-detected from story language field.
- Audio files stored at `{story_id}/{chapter_id}/{voice_id}.mp3` in Supabase Storage. Both voices generated at publish time and cached permanently. No recurring RunPod cost per playback.
- Input validation and ownership check on generate-audio (story author only).

### Supabase Configuration Applied

- Set `RUNPOD_API_KEY` secret
- Set `ADAPTY_WEBHOOK_SECRET` secret
- Created `audio` storage bucket (public read, service role upload)

### Audio Flow

1. Author publishes story
2. Backend calls `generate-audio` with story text + language
3. EN: submits 2 MiniMax jobs (Wise_Woman for Aria, Deep_Voice_Man for Kai)
4. ES: routed to edge-tts (synthesis pending implementation, returns PENDING_IMPLEMENTATION status)
5. On completion: audio uploaded to Storage, `chapters.audio_url` updated
6. Reader sees play/pause button with voice toggle
7. Paid users: plays instantly. Free users: 1 credit to unlock audio per story.

### Functional Reader (PR #20)

- Audio playback via expo-av (native) with working play/pause
- Like toggle with count increment/decrement
- Bookmark toggle with icon state change
- Share via clipboard (web) / Share API (native)
- Comment input with send button, adds to local list
- Follow author toggle
- Professional design: neutral gray avatars, ink buttons, flat comment layout, 16px icons

### Dual Voice (PR #21)

- Added `audioUrls` (female/male) to Chapter type
- Voice toggle loads correct gender audio
- Fallback: if gender-specific URL missing, uses generic audioUrl

### Cost Model

- MiniMax Speech 02 HD: ~$0.04 per chapter narration, ~30s generation
- 2 voices per story = ~$0.08 per published story
- Audio served from CloudFront (no CORS issues, no storage cost until we copy to Supabase)
- 1,000 stories = ~$80 MiniMax

### Primary Files

- `expo/src/data/voices.ts`: Voice registry, language defaults, genre matching.
- `backend/supabase/functions/generate-audio/index.ts`: TTS orchestrator with language routing.
- `backend/supabase/functions/audio-status/index.ts`: Job poller + Storage uploader.
- `backend/supabase/functions/_shared/edge-tts.ts`: Spanish voice mappings.

## 2026-08-23: Production Infrastructure Setup

### Shipped

- Created EAS build configuration (development/preview/production profiles, Android submit config).
- Installed and configured 12 production SDKs: @sentry/react-native, posthog-react-native, expo-notifications, expo-device, expo-constants, react-native-adapty, expo-localization, expo-splash-screen, expo-updates, expo-tracking-transparency, @react-native-firebase/app, @react-native-firebase/analytics.
- All SDK versions aligned to Expo SDK 54 compatibility via `npx expo install --fix`.
- Created `src/lib/analytics.ts`: Sentry crash reporting + PostHog product analytics with trackEvent/identifyUser/resetAnalytics. Environment from APP_ENV build config.
- Created `src/lib/adapty.ts`: Adapty v4 SDK wrapper for paywall products, purchases, and restore.
- Created `src/lib/notifications.ts`: expo-notifications setup with permission request, push token retrieval, and Android notification channels (default + stories).
- Created `src/lib/firebase-analytics.ts`: Firebase Analytics wrapper with safe dynamic imports (works in Expo Go/web, activates in EAS builds). Pre-defined AppEvents for onboarding, story creation, monetization (Google Ads ROAS), engagement, and acquisition.
- Created `src/lib/tracking-transparency.ts`: iOS App Tracking Transparency wrapper.
- Added i18n infrastructure: i18next + react-i18next + expo-localization with device locale detection. 400+ strings extracted into en.json (English), es.json (Spanish), pt.json (Portuguese).
- Updated app.json with plugins (Sentry, notifications, ATT, updates), OTA update config, and runtime version policy.
- All initialization wired in App.tsx startup (Sentry, PostHog, Adapty, Android channels).
- Created expanded .env.example with all required API key placeholders.

### Configuration Needed (User Setup)

1. `EXPO_PUBLIC_SENTRY_DSN` -- create project at sentry.io
2. `EXPO_PUBLIC_POSTHOG_API_KEY` -- create project at posthog.com
3. `EXPO_PUBLIC_ADAPTY_API_KEY` -- create app at adapty.io
4. `google-services.json` -- create Firebase project, place in `expo/` root, add `@react-native-firebase/app` to app.json plugins and set `android.googleServicesFile` path
5. Run `cd expo && eas init` to configure EAS project ID
6. Run `cd expo && eas build --profile development --platform android` for first dev build

### Verification

- TypeScript: zero errors across all new modules.
- All SDKs compile without API keys (graceful no-op when unconfigured).
- PRs #10, #11, #12 merged to main after CodeRabbit review.

### Primary Files Added

- `eas.json`: EAS Build profiles.
- `src/lib/analytics.ts`: Sentry + PostHog.
- `src/lib/adapty.ts`: Adapty v4 SDK.
- `src/lib/notifications.ts`: Push notifications.
- `src/lib/firebase-analytics.ts`: Firebase Analytics + Google Ads events.
- `src/lib/tracking-transparency.ts`: iOS ATT.
- `src/i18n/index.ts`: i18n initialization.
- `src/i18n/en.json`, `src/i18n/es.json`, `src/i18n/pt.json`: Translations.

## 2026-08-22: Approved Expo Foundation and Onboarding

### Shipped

- Migrated the Katha client into an Expo SDK 54 workspace compatible with Expo Go.
- Preserved the native Rork SwiftUI and Kotlin projects as reference implementations in the GitHub monorepo.
- Established the approved Katha AI identity through one shared `BrandWordmark` component.
- Approved bundled typography: Baloo2 for the brand, Bricolage Grotesque for display text, Hanken Grotesk for product UI, and Literata for reading.
- Built the fixed 390 x 844 animated Create, Publish, and Read introduction.
- Added character typing, generate interaction, story generation, in-place rewrite, reaction chips, real avatars, a 246-like counter, and the continuous cover marquee.
- Built the adaptive onboarding sequence: purpose, name, genres, two persona questions, profile build, notification education, paywall, account save, OTP, success, and Home callback.
- Added independent reader, writer, and mixed-user question, build, paywall, and success messaging.
- Approved `Build my profile` as the profile-completion CTA.
- Rebuilt notification education around a native permission-style center alert and an auto-scrolling, draggable review rail.
- Added a temporary tap-anywhere continuation from notification education to the paywall so product can review the complete purchase flow before native permission wiring. Background taps continue with consent unset/false.
- Personalized the paywall by purpose, top genre, content format, and user routine/blocker.
- Deferred email and OTP until after the paywall or one-time-offer action.
- Consolidated imagery into `assets/covers` and `assets/avatars`; removed the duplicate `assets/images` tree.
- Removed migration-era handoff documents, generated audit bundles, QR screenshots, and local verification artifacts from the deliverable.

### Approved Product Decisions

- `DESIGN.md` is the sole visual and product-flow contract.
- The wordmark, typography, orange/ink/warm-neutral palette, spacing, radii, and CTA hierarchy are approved.
- Purpose is the first profile question.
- Romance remains in the middle of genre discovery; Thriller, Fantasy, and Bedtime Stories lead.
- Reader, writer, and both are distinct personas throughout the flow.
- There is no replay screen after onboarding.
- Email does not block value delivery before the paywall.
- Store prices shown in the prototype are placeholders, not production pricing.

### Revision Verification

- `pnpm typecheck`: passing.
- Expo web production export: passing.
- Expo SDK dependency checks: passing for all checks that completed in the local runtime.
- Mobile browser QA at 390 x 844: completed through intro, reader persona, notification education, personalized paywall, and post-paywall account screen.
- Final visual audit: no blocking findings for rewrite, publish reactions, covers, notification education, reviews, or paywall fit.
- Browser runtime: no application errors; React Native Web reports only legacy shadow-style deprecation warnings from existing cross-platform styles.

### Integration Work Remaining

1. Replace the notification `Allow` callback with `expo-notifications` permission handling. Continue to the paywall after either allow or deny.
2. Connect paywall products, localized prices, trial eligibility, purchases, restore, and receipts through Adapty.
3. Connect email/OTP to Supabase Auth and persist the emitted onboarding profile.
4. Replace placeholder plan prices and legal copy with Adapty/store payload values.
5. Wire the final success callback to the production Home experience and persisted first-run state.
6. Validate the complete flow on physical iOS and Android devices after native integrations.

### Primary Files

- `App.tsx`: app shell, fonts, first-run entry, and Home handoff.
- `src/screens/KathaOnboarding.jsx`: approved animated introduction.
- `src/screens/KathaOnboardingFlowV2.jsx`: adaptive profile, notification, paywall, offer, account, and success flow.
- `src/components/BrandWordmark.tsx`: only approved Katha AI wordmark.
- `DESIGN.md`: canonical visual and product-flow specification.
- `CLAUDE.md`: engineering operating context for future sessions.

## 2026-08-23: Full App Rework -- Navigation, Create Studio, Paywall CRO, Reader Engagement, Backend

### Shipped

- Restructured navigation from 5 tabs to 3: Home | Create (+) | Library. Profile moved to top-right avatar overlay.
- Home screen: write-first CTA for new users, genre-based content rows (Adventure/Mystery/Fantasy), integrated search with genre filter chips, time-based greeting, continue-reading card for returning users.
- Library tab: 4 segments (Saved/History/My Stories/Comments) with empty states and bookmark/message icons.
- Profile screen: overlay with back navigation, centered user card, credits row with chevron, settings list (Notifications, Reading preferences, Katha Plus, Parental controls, Feedback), legal footer.
- CreateStudioScreen (1,653 lines): 3-step create flow -- setup (genre, seed, multi-character with hero toggle, EN/ES/PT language picker) to draft editor (paragraph-level AI actions: rewrite, expand, shorten, change tone, custom prompt, edit, delete; undo toast; pulse animation on processing) to publish (confirmation modal, cover generation simulation).
- Paywall CRO redesign: $59/yr ($4.92/mo), strikethrough $259, feature comparison table (Free vs Plus, 7 features), 3 testimonial cards with avatar photos, social proof stats (4.8 rating, 50K+ stories), sticky bottom CTA, expandable weekly plan, accessible legal links.
- Reader engagement: Substack-style engagement bar (like/comment/save/share), author card with Follow button, comments preview section.
- Intro spacing fix: reduced hero height 522 to 478, stage 360 to 340, grid closer to wordmark, bottom CTA section uses flex layout for proper fit.
- Backend: 3 new Supabase Edge Functions (feed, edit-story, publish-story) and editParagraph() in shared llm.ts.

### Backend Endpoints Added

- `feed/index.ts`: Personalized FYP -- new users get curated stories by like count, returning users get scored feed (genre affinity +3, followed author +5, trending +2, recency +1, engagement +1). Includes continue_reading array.
- `edit-story/index.ts`: Paragraph-level AI editing. Validates story ownership, splits chapter content, builds instruction-specific LLM prompt, replaces paragraph, updates word counts. No credit cost.
- `publish-story/index.ts`: Marks story as public. Validates ownership, status, and published chapter existence. Idempotent.

### Approved Product Decisions

- Write/create is the primary CTA, not read.
- Profile is a top-right avatar, not a bottom tab.
- Library replaces the old Settings/Library tabs.
- Welcome credits: currently 3 in code; product decision to increase to 5 or 10 is pending welcome flow implementation.
- Paywall pricing: $59/yr with 3-day trial (placeholder until Adapty).
- Language picker: English, Spanish, Portuguese at launch.
- Character description clearable with X button.
- Tab bar remains visible during Create Studio (hiding deferred until editor step gains its own bottom toolbar).

### CodeRabbit Review Cycle

- 4 review rounds, all actionable comments addressed.
- Remaining outside-diff comments (hardcoded prices, language forwarding to API) are intentional: Adapty not integrated, api.ts not in PR scope.
- Merged to main via squash merge after CodeRabbit commit status SUCCESS.

### Verification

- `pnpm typecheck`: passing (zero errors).
- Web export: compiles (2.79 MB bundle).
- PR #8 merged to main.

### Integration Work Remaining

1. Wire `expo-notifications` for native permission request (Android 13+ POST_NOTIFICATIONS).
2. Connect Adapty for live pricing, trial eligibility, and purchases.
3. Connect Supabase Auth (email magic link / OTP).
4. Wire CreateStudioScreen to real edit-story and publish-story endpoints (currently mock mode).
5. Forward selected language to generation API.
6. Welcome flow: confetti animation + 10 credits + guided tutorial.
7. Text selection editing (word/sentence level) for draft editor.

### Primary Files

- `App.tsx`: 3-tab shell, Home, Library, Profile overlay, Reader with engagement.
- `src/screens/CreateStudioScreen.tsx`: full create studio with draft editor.
- `src/screens/KathaOnboarding.jsx`: intro with spacing fix.
- `src/screens/KathaOnboardingFlowV2.jsx`: paywall CRO redesign.
- `src/types/domain.ts`: TabKey (home|create|library), Screen (+profile).
- `backend/supabase/functions/feed/index.ts`: FYP endpoint.
- `backend/supabase/functions/edit-story/index.ts`: paragraph AI editing.
- `backend/supabase/functions/publish-story/index.ts`: publish endpoint.

## 2026-08-22: Intro and Paywall Motion Revisions

### Changed

- Rewrote the Create intro sample line so the `dream` to `warning` edit fits a scene where people are visibly observing the hidden door.
- Revised the Read intro marquee to three long rows of slimmer, taller cover cards with longer repeated strips, improving the continuous library motion.
- Removed the paywall trial toggle. Annual is selected by default and is the only plan with a 3-day free trial.
- Kept weekly as a secondary plan revealed through `See weekly option`; selecting it clears the trial state and shows weekly no-trial billing copy.
- Added a paywall close confirmation sheet before routing to the one-time offer.
- Rebuilt the one-time offer in the Katha warm neutral/orange system, removing the loud emoji/gift/blue countdown treatment and using calmer annual-offer copy.
- Routed paywall, weekly option, and one-time-offer pricing through product data objects so future Adapty/store values can replace the reference prices in one place.
- Added reduced-motion paths for intro timelines, cover marquees, loading, paywall entry, offer entry, and button pulse animations.
- Moved the paywall close confirmation into a modal and added explicit close accessibility labels for the paywall and one-time offer.
- Corrected the one-time-offer discount claim to derive from the annual comparison product and offer product prices.
- Updated `DESIGN.md` with the annual-trial and weekly-no-trial contract.

### Verification

- `pnpm typecheck`: passing.
- `pnpm exec expo-doctor`: 18/18 checks passed.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-export-check`: passing with 25 assets.
- Markdown lint passed for `expo/DESIGN.md` and `expo/BUILD_LOG.md`.
- Browser QA at 390 x 844 verified the revised Create line, three-row Read marquee, annual default trial paywall, weekly no-trial option, close confirmation sheet, and revised one-time offer before the review-accessibility patch.
- Code inspection confirmed all three persona branches still route to distinct paywall titles, subtitles, and benefits: read-first, write-first, and balanced read/write.
- Keyboard entry remains on real `TextInput` controls for name, email, OTP, and Other genre. A fresh automated keyboard/browser pass was blocked because Playwright could not install Chromium for this desktop runtime (`mac13` unsupported).
- Narrow-width browser QA beyond 390 x 844 and physical iOS/Android phone validation remain pending before native release.
- Release readiness: this revision is not ready for production release until the full post-patch web flow, keyboard behavior, narrow layouts, reduced-motion behavior, and native iOS/Android builds are validated on supported runners/devices.

## 2026-09-06: Create Flow Density Follow-Up

### Changed

- Kept Create as a single story-generation screen with the character editor in a full-screen native modal.
- Moved Kids Mode to the left of Genre using the platform `Switch`; the label now sits to the right of the toggle.
- Changed the Genre picker from an in-flow expanding block to an absolute overlay, with per-genre icons retained.
- Removed the large brief-strength panel and added compact `strength {percent}%` text below the `Create` CTA.
- Reworked More Options as one compact family: chip rows for chapters and chapter length, consistent field radius, Avoid before Visibility, a native Visibility switch, and icon-based spice chips with the unsupported explicit slot disabled.

### Verification

- `pnpm typecheck`: passing.
- `pnpm test -- src/__tests__/create-flow-contract.test.tsx src/__tests__/api-generation-contract.test.ts --runInBand`: passing, 32 tests.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-create-flow-export-check`: passing.
- `pnpm exec expo-doctor`: passing, 18/18 checks, with the local Node/npm bin path on `PATH`.
- Local dev server is running at `http://localhost:8081/?singleCreateFlow=4`.
## 2026-09-06: Editorial Home, and Explore as its own tab

### Changed

- Split discovery into two tabs. Home is now purely editorial -- named,
  horizontally scrolled rows and no filtering UI at all. Explore is the browse
  surface and absorbs the search field, the genre strip and the filters. Folding
  both jobs into one screen is what left the old Home carrying a search box, a
  chip row, rails AND a vertical list at once, with nothing telling a reader
  which of those was the point of the screen.
- Added `src/components/feed/StoryFeedCard.tsx`, the single card both surfaces
  are built from: cover flush to the leading edge, title, two-line synopsis,
  reads/likes stats, and a decorative circular read chevron. Two variants --
  `rail` (fixed 300px so the next card peeks past the screen edge) and `list`
  (full width). The cover bleeds rather than sitting inset: an inset cover puts
  two radii and a gap between the image and the page and reads as a thumbnail
  pasted onto a card.
- Added `src/components/feed/FeedRail.tsx`. A row's name is an uppercase
  eyebrow, not a title, so it labels the row without out-shouting the story
  titles inside it.
- Added `src/screens/HomeScreen.tsx`, extracted from `App.tsx` and rebuilt.
  Rows come from a pure `buildFeedRows()` helper (Katha Originals, Trending now,
  Most loved, then one row per onboarding genre) so a later swap to a
  server-driven section list never touches the JSX.
- Added `src/screens/ExploreScreen.tsx`: search, genre strip, an inline filter
  panel (sort + multi-select tags), a comfortable/compact density toggle, and a
  `FlatList` with an empty state.
- `TabKey` widened to `home | explore | create | library | profile`; the tab bar
  renders five slots with Create still raised at the centre. Profile was
  promoted from a pushed screen to a real tab and its `Screen` union variant
  removed rather than left dangling.
- Removed the 214-line in-file `HomeScreen` from `App.tsx` along with the
  imports and the 20 style keys the deletion orphaned. 34 other style keys in
  that file were already dead before this change and were deliberately left
  alone.

### Decisions

- Home borrows the reference's hierarchy and card anatomy only. The palette
  stays the existing light system: no new colour values, every colour from
  `colors.*` via the `@/theme` barrel.
- The author/timestamp line and the per-card overflow menu were dropped from the
  card by product decision.
- Explore's second filter axis is `tags`, derived from the passed stories at
  render time. A length/format axis was specified first and then cut: no seed
  story sets `chapterLength` and `storyMode` appears zero times, so Short/Long
  would have been permanently empty options.

### Verification

- `npx tsc --noEmit`: passing, zero errors project-wide.
- `npx eslint App.tsx src/screens/HomeScreen.tsx src/screens/ExploreScreen.tsx src/components/feed`: clean.
- `npx jest`: 18 suites, 219 tests passing, including `app-root.test.tsx`, which
  mounts the whole revised tab tree.
- New: `src/__tests__/feed-card-contract.test.tsx` (2 tests) pins the card
  anatomy and that the card is ONE pressable -- the read chevron is decorative
  and must not announce a second identical action to a screen reader.
- New: `src/__tests__/explore-screen.test.tsx` (4 tests) drives the real
  controls. The search test types one character at a time, because a
  `ListHeaderComponent` whose component type is rebuilt per render remounts the
  `TextInput` on every keystroke and the field silently drops focus after one
  character. The sort test asserts rendered ORDER, not presence -- every story
  is present regardless, so a presence assertion would pass against no sorting
  at all.
- Not yet done: no device or browser QA pass on either screen. Explore is also
  thin against 20 seed stories, and a genre filter cuts that to 1-3 rows; the
  structure is right but the density will not be until the `feed` edge function
  is serving real data.

## 2026-09-06: The story landing page, and Reddit-shaped comments

### Changed

- Added `src/screens/StoryDetailScreen.tsx`. Full-bleed 3:4 hero, floating
  back/overflow controls, title on a gradient scrim, a primary read CTA,
  reads/likes/saves, share, author card, chapter list, metadata, and the comment
  thread at the bottom. No top tab bar: the reference groups Details / Story
  Cards / Comments into tabs and we deliberately do not, because one scroll is
  cheaper to read than three tabs on a page this short.
- Routing now branches on series-ness. `storyMode === "series" ||
  chapters.length > 1` opens the landing page; anything else opens the prose
  directly. The landing page earns its extra tap only when there is something to
  land on - a chapter list, a premise worth reading before committing. For a
  single-chapter story it would be a wall between the reader and the one thing
  they tapped for.
- `ReaderScreen` gained `initialChapterIndex`, so a chapter row on the landing
  page opens that chapter rather than always chapter one.
- Added the comment thread (`src/components/comments/`): threading, tri-state
  voting, collapse, inline reply, per-comment report, Top/New sort. Indent caps
  at depth 3 and deeper chains get a "continue this thread" affordance, because
  past three levels the text column collapses on a 390px screen.
- Added `src/components/moderation/StoryActionsSheet.tsx`: report story and
  block author, both as in-sheet state machines. Deliberately NOT `Alert.alert`
  - this app renders on web in the dev server, where a native modal dialog
  blocks the page and the session stops responding.
- Cover crop unified. The feed card cover was a 116px SQUARE while the reader
  hero was 3:4, so the same file showed two different pictures. The source art is
  portrait (seed 360x480, generated 1024x1536), so the card is now 116x155 and
  Explore's compact row is 56x75. One cover, one crop.
- Added a dev-only `?tab=` deep link (`__DEV__` and web only) so the web dev
  server can open a tab directly. The app boots to `intro`, which put the tabs
  several screens away on every reload.

### Decisions

- The vote control derives its displayed score (`baseScore + voteDelta(state)`)
  rather than mutating a stored score. That makes an up -> down flip move by
  exactly 2 with no special-cased arithmetic, which is the case this control is
  usually written wrong.
- Blocking an author closes the sheet and leaves the story. There is no applied
  `user_blocks` table yet, so a block cannot survive a reload and the author's
  other stories cannot be filtered from the feed. Leaving the reader parked on
  the page of an author they just blocked was the worse of the two available
  lies. When the migration lands: persist it, and filter in
  `backend/supabase/functions/feed/index.ts`.

### Verification

- `npx tsc --noEmit`: passing, zero errors project-wide.
- `npx eslint`: clean on every file added or touched.
- `npx jest`: 20 suites, 238 tests passing.
- New: `story-detail.test.tsx` (4 tests). The load-bearing one asserts a chapter
  row calls `onRead` with the array INDEX, not the chapter number - an off-by-one
  there is invisible in a screenshot and only felt while reading.
- New: `comment-thread.test.tsx` (15 tests), including the up -> down flip
  moving the score by exactly 2 in both directions, and tree immutability.
- Served-bundle check against the running dev server confirmed the new code is
  actually being served, after the discovery that the dev server had been
  running from a different checkout entirely.
- NOT done: no visual QA on either screen. The Chrome extension was not
  connected, so nothing here was verified by looking at a rendered page. Layout
  and spacing at 390px are unconfirmed.
- Known gap: comments are local state only. Nothing survives a reload until
  migration `00043` is applied and an edge function is wired.

## 2026-09-06: Writer Onboarding Preview and Paywall Alignment

- Finished the writer onboarding consistency pass: progress bars now appear on
  the idea and details screens, the details title is shortened to "Shape the
  Story", section labels stay on the black compact eyebrow treatment, and the
  primary details CTA is now "Create my story".
- Kept chapters and chapter length as filter chips with dropdown menus, placed
  chapter length first on the same row as chapters, and left longer chapter
  counts using the existing shaped-beat teaser instead of inventing a separate
  arc field the generation prompt does not consume.
- Polished the idea-strength line, starter prompt cards, genre filter chip
  weight, "Who's in it?" affordance, icon-only moment add button, preview
  entitlements, and minimal CTA glow.
- Replaced the raw Writer paywall with the story summary card, benefit list,
  weekly/yearly plan cards, trial badge, and "Create my story" CTA.
- Verification: `pnpm typecheck` passed, focused writer-onboarding Jest tests
  passed, full Expo Jest suite passed (20 suites / 238 tests), and Expo web
  export compiled. `expo-doctor` still passes 15/18 only because this shell
  cannot spawn `npm` for its dependency-tree checks (`spawn npm ENOENT`).
  Local web was opened at `http://localhost:8090/` and checked at 390 x 844.
  Mandatory security scan completed; it found no new UI/auth issues, and the
  blocking `image-size` audit advisories are locally patched with pnpm
  `patchedDependencies` plus targeted GHSA ignores because the advisory's
  patched `2.0.3` version is not published on npm.

## 2026-09-06: Comments, blocks and reports actually persist

### Changed

- Added `src/lib/comments.ts`, the client half of persistent comments. The
  server returns a thread FLAT (one row per comment carrying its `parentId`)
  and the client assembles the tree. A nested payload would force the server to
  decide the shape of every thread before it knows how the client draws it, and
  would re-send whole subtrees on every poll; a flat list is cheap to page and
  lets the client re-sort Top/New without another round trip.
- `CommentThread` is server-backed when Supabase is configured and keeps its
  mock as the offline path. Writes are optimistic and then reconciled by
  refetching, because `comments.score` is maintained by a database trigger and
  is the only authority on a score.
- Block and report now persist. Blocking files the block, then leaves the
  story; the navigation happens whether or not the write succeeds, because a
  reader who has just blocked someone should not be held on that author's page
  while a request retries.
- Added `findNode` to the comment tree helpers.

### Decisions

- `baseScore = server.score - server.myVote`. The server's score ALREADY
  includes the viewer's own vote, and the UI adds it back at render time via
  `displayScore`. Without that subtraction every voter sees their own vote
  counted twice the instant they cast it.
- A vote sends the state the control LANDS ON, not the direction pressed. The
  control is tri-state, so pressing up on an already-upvoted comment means
  "remove my vote" and must send 0; sending +1 there leaves the row set while
  the UI shows it cleared, and nobody notices until a reload puts the vote back.
- Orphaned replies are PROMOTED to the root, never dropped. A reply whose
  parent falls outside the fetched page would otherwise vanish - a real
  person's words lost to a paging boundary. The worst case of promoting it is a
  comment that reads slightly out of context.
- A failed comment load is stated and made retryable, and the composer stays
  usable. The write path does not depend on the read path.

### Verification

- `npx tsc --noEmit` clean; `npx eslint` clean.
- `npx jest`: 24 suites, 264 tests passing.
- New: `comments-client.test.ts` (9 tests) covers the double-counted vote, the
  dropped orphan, a cycle, tombstones, sorting and relative time.
- New: `comment-thread-remote.test.tsx` (5 tests) covers the server-backed path
  end to end, including that the tri-state vote clears to 0.
- Browser pass at 390x844: 0 clipped nodes; the story page renders hero,
  chapters, metadata and the comment section.
- NOT done: the `comments` edge function is NOT deployed and migration 00043 is
  NOT applied, so a configured client currently shows "Comments could not load"
  and its retry. That is the honest state, not a bug - but comments will not
  work until both are shipped.
## 2026-09-07: Writer onboarding design-system cleanup and backend-status shaping

### Changed

- Reworked `WriterOnboarding` so onboarding shaping starts after the full writer brief is known, not from the idea screen. The request now carries typed characters, moments, writing style, avoid text, chapter length, and planned chapter count.
- Removed the fixed client crafting floor. The loader now stays up for the actual shape request and failed shaping lands on a retry screen that preserves the idea and details.
- Standardized writer onboarding top bars, primary CTAs, form fields, OTP cells, filter chips, and small plus CTAs on shared theme tokens.
- Tightened the preview: chapter plan renders as a teaser with single-line rows, the opening is shorter, and the ownership/benefit rows use named onboarding icons.
- Aligned the legacy onboarding/sign-in OTP and field/button recipes with the same visual geometry.
- Updated theme tests and writer onboarding interaction tests for the new backend-status flow and Hanken-based onboarding body typography.

### Verification

- `pnpm typecheck` clean with Node from the bundled Codex runtime in PATH.
- `pnpm test -- --runTestsByPath src/__tests__/theme.test.ts src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx src/__tests__/api-generation-contract.test.ts`: 4 suites, 144 tests passing. The Expo notifications SDK warning still appears from the existing test import.
- `pnpm exec expo-doctor`: 18/18 checks passing when run with `/Users/mac16/.nvm/versions/node/v22.23.0/bin` in PATH. The bundled Codex Node runtime lacks `npm`, which makes Expo Doctor's npm-spawning checks fail.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-check` compiled the web bundle.
- Not pushed to GitHub per product-review instruction.

## 2026-09-07: Onboarding writer branch and filter-chip overlay polish

### Changed

- Reordered shared onboarding to ask name first, then genre interests, then the
  Reading/Writing/Both purpose question.
- Added the broader genre-interest picker with emoji chips and a stable mapping
  from the first selected create-compatible genre into the writer story flow's
  initial genre chip.
- Routed Writing users through the two writer setup screens before story
  creation: `What do you want to write?` and `What usually stops you?`.
- Changed writer chapter length/count filter menus to absolute overlays so
  opening a menu no longer stretches the section or moves nearby content.
- Updated the onboarding and design-system docs for the new branch contract and
  filter-chip behavior.
- Resolved CodeAnt PR feedback by preserving writer setup context past the
  shared onboarding branch, labelling the actual OTP text input, surfacing
  retryability from shape-story failures, and evicting failed warm shape
  requests so Retry performs a real new request.

### Verification

- `pnpm test -- --runTestsByPath src/__tests__/katha-onboarding-flow.test.jsx src/__tests__/writer-onboarding.test.tsx src/__tests__/writer-onboarding-interactions.test.tsx`: 3 suites, 79 tests passing. The existing React Native `SafeAreaView` deprecation warning still appears in the new onboarding test.
- `pnpm typecheck` clean.
- `pnpm lint` exits with 0 errors and the existing warning set.
- `pnpm exec jest --runInBand`: 27 suites, 270 tests passing.
- `pnpm exec expo-doctor`: 18/18 checks passing with local Node 22 in PATH.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-check` compiled the web bundle.
- `deno test --allow-env --allow-net supabase/functions/_shared/story-shape.test.ts`: 17 tests passing.
- `deno check supabase/functions/shape-story/index.ts` clean.
- Mandatory security scan completed before push: no new hardcoded secrets,
  injection sinks, auth regressions, or PII logging were found in the changed
  surfaces. `pnpm audit` reports 2 high vulnerabilities, both ignored by the
  existing patched advisory policy.

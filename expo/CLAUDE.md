# Katha AI engineering context

## Canonical project

- GitHub source of truth: `praz-builds/rork-katha-ai-clone`.
- The Expo app lives in `expo/` in the monorepo. Run all Expo commands from that directory.
- The native Rork apps remain in the sibling `ios-katha-ai-create-stories/` and `android-katha-ai/` directories. Do not mix Expo source into either native project.
- The backend lives in the sibling `backend/` directory in this monorepo. Keep shared contracts and integration changes in one pull request when they must ship together.

## Onboarding source of truth

- The canonical app and onboarding design contract is `DESIGN.md`.
- Historical migration and handoff files have been removed. `DESIGN.md` and the implementation are the only approved visual/product sources.
- The production onboarding entry point is `src/screens/KathaOnboardingComplete.jsx`.
- It composes `src/screens/KathaOnboarding.jsx` and `src/screens/KathaOnboardingFlowV2.jsx`.
- Preserve the documented 390 x 844 geometry, shared wordmark, fixed intro slots, read/write/both branches, assets, and animation timing unless product explicitly changes the contract.
- Product override: do not restore the prototype's `Replay the flow` action. The success CTA hands off directly to Home.
- Keep asset imports rooted in `assets/covers` and `assets/avatars`.
- Do not recreate `assets/images`; it was removed as a duplicate of the approved cover/avatar directories.
- The app loads bundled fonts under the local names `BricolageGrotesque`, `HankenGrotesk`, and `Baloo2`.

## Required verification workflow

After onboarding or paywall changes:

1. Run `pnpm typecheck`.
2. Run `pnpm exec expo-doctor`.
3. Confirm an Expo web bundle can compile.
4. Open `http://localhost:8090/` automatically in the in-app browser.
5. Keep the browser at a 390 x 844 mobile viewport.
6. Use browser controls to complete the flow, not only inspect screenshots.
7. Verify intro timing, persona branching, form validation, building transition, notification education, personalized paywall, post-paywall OTP entry, success, and Home handoff. **There is no one-time offer step**: it was removed 2026-09-10 and its copy, timer, SKU and `onboarding_offer_*` events are deleted, not deprecated (`../source-of-truth/ONBOARDING_FLOW.md` §14). The welcome grant now fires on declining the paywall.
8. Leave the working mobile preview visible for product review.
9. Set `EXPO_PUBLIC_APP_ENV=development` before testing anything that signs in — see the trap under *Profile, Credits and the launch economy* below.

## Product integration boundaries

- Email/OTP, notification permission, subscriptions, restores, and offer purchases are currently UI handoff points. Keep their callbacks explicit so Supabase, RevenueCat, and native notification wiring can replace the local transitions cleanly.
- Notification education currently advances to the paywall from any tap. Background taps and `Not now` continue with consent unset/false. `Allow` is where the real Apple/Android permission request must be inserted; only a granted native response may set consent true, then continue to the paywall.
- The notification review rail auto-scrolls and remains horizontally draggable.
- Keep email/OTP after the paywall action or first meaningful save; do not reintroduce mandatory authentication before personalization and value delivery.
- `KathaOnboardingFlowV2` emits the collected onboarding result through `onDone`; persist that payload when account/profile wiring is added.
- Do not hard-code localized production pricing when RevenueCat integration begins. Render product and currency values from the store payload.

## Navigation architecture (corrected 2026-09-16)

The 3-tab layout recorded here on 2026-08-23 has not been the shipped shape since
PR #97 (2026-09-14). What is actually there:

- Four icon-only tabs in a floating pill with **Create** beside it on the right: **Home** | **Explore** | **Library** | **You** | **+ Create**. `src/components/BottomTabs.tsx` is the one bar; it sits `TAB_BAR_GAP` above the bottom safe-area inset, caps at `controls.tabBarMaxWidth` on wide windows, and does not animate the switch.
- `TabKey` (`src/types/domain.ts:149`): `"home" | "explore" | "create" | "library" | "profile"`. **Profile is a real tab, not an avatar overlay.** `App.tsx` holds the selected tab in one `useState<TabKey>` and hands it to `BottomTabs`.
- Every tab screen pads its scroll content by `TAB_BAR_CLEARANCE` (exported from `BottomTabs.tsx`), never a literal.
- CreateStudioScreen (`src/screens/CreateStudioScreen.tsx`) has **one** step, not three. It is the brief and the handoff: generation ends in the reader (2026-09-09), editing is a notepad reached from the reader's chrome, and publishing is the "Make it public" toggle in the brief.
- The Reader includes a Substack-style engagement bar, author card, and comments preview.
- The Library has **3** segments: Created, Starred, Notes. The old four (Saved, History, My Stories, Comments) were three inventions and one real shelf.

## Production infrastructure (2026-08-23)

- All SDK initialization runs in App.tsx useEffect: `initSentry()`, `initPostHog()`, `initRevenueCat()`, `setupAndroidChannel()`.
- API keys are read from `Constants.expoConfig.extra` (configured in app.json, populated via env vars or EAS secrets). Convert to `app.config.ts` to map `EXPO_PUBLIC_*` env vars before production.
- Firebase requires `google-services.json` in `expo/` and `@react-native-firebase/app` in app.json plugins with `android.googleServicesFile` path set.
- `src/lib/analytics.ts`: Sentry + PostHog. Use `trackEvent(name, props)` and `identifyUser(id, traits)`.
- `src/lib/revenuecat.ts`: RevenueCat Purchases with offerings/packages, managed paywalls, and Customer Center.
- `src/lib/notifications.ts`: expo-notifications. Use `requestNotificationPermission()` and `getPushToken()`.
- `src/lib/firebase-analytics.ts`: Firebase Analytics with safe dynamic imports. Use `AppEvents.*` helpers.
- `src/lib/tracking-transparency.ts`: iOS ATT. Call `requestTrackingPermission()` before analytics.
- `src/i18n/`: i18next with EN/ES/PT. Not yet wired to components (follow-up task).
- All SDKs gracefully no-op when API keys are empty.

## Audio narration system (2026-08-25)

- Using MiniMax Speech 02 HD public endpoint (`minimax-speech-02-hd`) on RunPod. No custom deployment.
- 2 voices per language at launch: Aria+Kai (EN), Elvira+Alvaro (ES). 4 more EN voices planned. **No voice tiers** — every voice is available on every tier including free (`../source-of-truth/CREDITS_AND_PRICING.md` decision 5).
- Audio generated at publish time (both voices), cached permanently in Supabase Storage bucket `audio`.
- Language routing: EN to RunPod, ES to edge-tts (placeholder). The `generate-audio` endpoint accepts `language` in the request body; callers must pass it explicitly.
- Storage path: `{story_id}/{chapter_id}/{voice_id}.mp3`. Public read, service role upload.
- Reader shows voice toggle (female/male names from `getDefaultVoices(lang)`).
- Audio is **1 credit per chapter, unlocked permanently**, on every tier. Re-listens are free forever. No voice tiers. See `../source-of-truth/CREDITS_AND_PRICING.md` §1.
- Inngest integration for auto-generation on publish is planned but not yet wired. Currently `generate-audio` is called directly.

## Profile, Credits and the launch economy (2026-09-16)

What the Play Store go-live PR established for the client. `BUILD_LOG.md`'s entry
of the same date is the narrative; this is the contract.

- **There are no guests past the email step.** Profile's "Sign in to keep all of this" card is gone because there is nobody left to show it to. **Sign out clears the stored session (`signOutToSignIn` in `src/lib/session.ts`, `scope: "local"`) and lands on the sign-in screen**; it no longer calls `restartGuestSession`, which signed back in anonymously and left a live identity nobody had asked for behind a sign-in screen. Leaving the device with no session is the honest end state; `bootstrapUser` mints a pre-auth anonymous session lazily when a screen actually needs one.
- **The Profile header is the avatar and the handle on one row, with a pencil at the right.** The pencil is the *only* control that opens the identity editor — the "Edit profile" button it replaced was a second door to the same sheet. Avatar precedence is **photo → creature → placeholder**, and the placeholder means "this profile has not loaded", not "this account has no picture".
- **Thirty-six creature avatars live in `assets/creatures` and are resolved through `src/lib/creatures.ts`.** Six body silhouettes × six pastel backgrounds, 256px WebP, ~99 KB for the whole set. Ids (`k01`…`k36`) are stable: **never renumber, only append.** The server preassigns one at bootstrap, so a new account is never a grey circle. A photo clears the creature and a creature clears the photo — the two cannot both answer "what does this person look like".
- **Home greets once, in two Text elements.** `src/lib/greeting.ts` is pure: hand it a `Date`, get a line back, seeded by day-of-year so it does not change under the reader between renders. **No phrase in the rotation addresses the reader**, because the name sits directly beneath it — "Morning, storyteller" over a line reading the person's name greets them twice. The night lines never say "good night": somebody opening the app at 23:40 is about to read.
- **The streak ladder is five rungs and it is server data.** `streak_ladder()` (migration 00089) is the record, delivered through `profile_overview`; `FALLBACK_LADDER` in `src/lib/profile.ts` carries the same five for a deploy that has not answered yet. The amounts live in `../source-of-truth/CREDITS_AND_PRICING.md` §5 and decision 49 — do not hard-code them in a third place. **A milestone is achieved when it has a date, not when it has a row**: the server returns a row per rung whether reached or not, so reading presence lights all five for a brand-new account.
- **The Credits screen (`src/screens/CreditsScreen.tsx`) has one order, and it is deliberate**: balance pill in the top bar → **Paid options** (Plus and the packs, above the fold) → **How credits work** (lifted verbatim from the pricing doc) → **Free credits** (the streak, a claim against a comment you left, an invite code) → **History** (the real `credit_ledger`, not seed data). Prices render from the RevenueCat `priceString` where a package exists, the USD list is fallback copy, and on web Purchase is disabled.
- **The reviewer signs in through the ordinary code screen.** `EmailCodeAuth.tsx` tries the real OTP first and only the *code check* falls through to `reviewerSignIn` (`src/lib/session.ts` → the `reviewer-signin` edge function), so for anyone else this is one extra round trip on a wrong code and nothing else. The plaintext code lives in `backend/.reviewer-code.local`, which is git-ignored; it never goes in the repo.

### The `EXPO_PUBLIC_APP_ENV` trap

`authBypassed()` in `src/lib/session.ts` is `__DEV__ && process.env.EXPO_PUBLIC_APP_ENV === "local"`, and when it is true **`verifyEmailCode` returns without verifying anything**. Every sign-in then silently succeeds — as the guest identity that was already there — and the reviewer path never runs, because nothing ever falls through to it. That looks exactly like a working sign-in and is not one; it cost this session real time.

**Use `EXPO_PUBLIC_APP_ENV=development` when testing auth on web.** `expo/.env` is git-ignored, so this is per-machine and there is nothing in the repo to read it off. The scaffold itself is pre-existing and `__DEV__`-only; it must never be reachable in a release build.

## Session handoff

- Read `BUILD_LOG.md` before starting new feature work.
- Treat the onboarding, shared wordmark, typography, CTA language, personas, notification education, and adaptive paywall as approved product decisions.
- The create studio, paywall CRO, and reader engagement are approved product decisions from the 2026-08-23 session. **The 3-tab navigation from that session is not current** — the shipped bar is four tabs plus Create; see *Navigation architecture* above.
- Do not reopen migration or visual-source discovery unless product explicitly changes the approved system.

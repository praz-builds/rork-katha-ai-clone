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
7. Verify intro timing, persona branching, form validation, building transition, notification education, personalized paywall, post-paywall OTP entry, one-time offer, success, and Home handoff.
8. Leave the working mobile preview visible for product review.

## Product integration boundaries

- Email/OTP, notification permission, subscriptions, restores, and offer purchases are currently UI handoff points. Keep their callbacks explicit so Supabase, RevenueCat, and native notification wiring can replace the local transitions cleanly.
- Notification education currently advances to the paywall from any tap. Background taps and `Not now` continue with consent unset/false. `Allow` is where the real Apple/Android permission request must be inserted; only a granted native response may set consent true, then continue to the paywall.
- The notification review rail auto-scrolls and remains horizontally draggable.
- Keep email/OTP after the paywall action or first meaningful save; do not reintroduce mandatory authentication before personalization and value delivery.
- `KathaOnboardingFlowV2` emits the collected onboarding result through `onDone`; persist that payload when account/profile wiring is added.
- Do not hard-code localized production pricing when RevenueCat integration begins. Render product and currency values from the store payload.

## Navigation architecture (2026-08-23)

- 3-tab layout: Home | Create (+, raised) | Library. Profile is a top-right avatar overlay, not a tab.
- `TabKey`: `"home" | "create" | "library"`. `Screen` includes `{ name: "profile" }`.
- CreateStudioScreen is a standalone component in `src/screens/CreateStudioScreen.tsx`. It manages its own 3-step flow (setup, editor, publish). The tab bar remains visible; hiding it during the editor step is deferred.
- The Reader includes a Substack-style engagement bar, author card, and comments preview.
- The Library has 4 segments: Saved, History, My Stories, Comments.

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
- 2 voices per language at launch: Aria+Kai (EN), Elvira+Alvaro (ES). 4 more EN voices planned. **No voice tiers** — every voice is available on every tier including free (`CREDITS_AND_PRICING.md` decision 5).
- Audio generated at publish time (both voices), cached permanently in Supabase Storage bucket `audio`.
- Language routing: EN to RunPod, ES to edge-tts (placeholder). The `generate-audio` endpoint accepts `language` in the request body; callers must pass it explicitly.
- Storage path: `{story_id}/{chapter_id}/{voice_id}.mp3`. Public read, service role upload.
- Reader shows voice toggle (female/male names from `getDefaultVoices(lang)`).
- Audio is **1 credit per chapter, unlocked permanently**, on every tier. Re-listens are free forever. No voice tiers. See `CREDITS_AND_PRICING.md` §1.
- Inngest integration for auto-generation on publish is planned but not yet wired. Currently `generate-audio` is called directly.

## Session handoff

- Read `BUILD_LOG.md` before starting new feature work.
- Treat the onboarding, shared wordmark, typography, CTA language, personas, notification education, and adaptive paywall as approved product decisions.
- The 3-tab navigation, create studio, paywall CRO, and reader engagement are approved product decisions from the 2026-08-23 session.
- Do not reopen migration or visual-source discovery unless product explicitly changes the approved system.

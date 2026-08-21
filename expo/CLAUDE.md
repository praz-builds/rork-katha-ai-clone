# Katha AI engineering context

## Canonical project

- GitHub source of truth: `praz-builds/rork-katha-ai-clone`.
- The Expo app lives in `expo/` in the monorepo. Run all Expo commands from that directory.
- The native Rork apps remain in the sibling `ios-katha-ai-create-stories/` and `android-katha-ai/` directories. Do not mix Expo source into either native project.
- The backend remains a separate repository: `praz-builds/katha-ai-backend`.

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

- Email/OTP, notification permission, subscriptions, restores, and offer purchases are currently UI handoff points. Keep their callbacks explicit so Supabase, Adapty, and native notification wiring can replace the local transitions cleanly.
- Notification education currently advances to the paywall from any tap. Background taps and `Not now` continue with consent unset/false. `Allow` is where the real Apple/Android permission request must be inserted; only a granted native response may set consent true, then continue to the paywall.
- The notification review rail auto-scrolls and remains horizontally draggable.
- Keep email/OTP after the paywall action or first meaningful save; do not reintroduce mandatory authentication before personalization and value delivery.
- `KathaOnboardingFlowV2` emits the collected onboarding result through `onDone`; persist that payload when account/profile wiring is added.
- Do not hard-code localized production pricing when Adapty integration begins. Render product and currency values from the store payload.

## Session handoff

- Read `BUILD_LOG.md` before starting new feature work.
- Treat the onboarding, shared wordmark, typography, CTA language, personas, notification education, and adaptive paywall as approved product decisions.
- Do not reopen migration or visual-source discovery unless product explicitly changes the approved system.

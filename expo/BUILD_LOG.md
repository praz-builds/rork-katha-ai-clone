# Katha AI Build Log

<!-- markdownlint-disable MD013 -->

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
- Welcome credits: 5 (was 3).
- Paywall pricing: $59/yr with 3-day trial (placeholder until Adapty).
- Language picker: English, Spanish, Portuguese at launch.
- Character description clearable with X button.
- Tab bar hidden during Create Studio editor/publish steps.

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

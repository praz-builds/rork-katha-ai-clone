# Katha AI Expo

Approved Expo implementation of Katha AI. In the GitHub monorepo this workspace lives at `expo/`, alongside the original Rork-generated SwiftUI and Kotlin projects.

## Repository Map

- Product repository: `praz-builds/rork-katha-ai-clone`
- Expo workspace: `expo/`
- Backend workspace: [`../backend/`](../backend/)
- Supabase project: `iafeuxgoiknncgyjmugd`
- Canonical product and visual contract: `DESIGN.md`
- Current shipped-state record: `BUILD_LOG.md`

## Run

```bash
pnpm install
pnpm start
```

Expo Go is suitable only for mock/UI review. RevenueCat uses native modules, so
Expo Go cannot validate purchases, restores, Paywalls, or Customer Center.

## Native RevenueCat development build

```bash
# Build and install a native development client (first time, or after native changes)
eas build --profile development --platform ios
eas build --profile development --platform android

# Start Metro for the installed development client
pnpm exec expo start --dev-client
```

The development profile uses the RevenueCat Test Store. Preview and production
builds intentionally remain unconfigured until the real `appl_`/`goog_` public
SDK keys are issued.

Use `.env.example` to create `.env.local` when wiring real Supabase calls:

```env
EXPO_PUBLIC_SUPABASE_URL=https://iafeuxgoiknncgyjmugd.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

The app runs in mock-first mode when the key is missing. Supabase authentication, native notification permission, and RevenueCat purchases remain explicit integration boundaries documented in `BUILD_LOG.md`.

## Checks

```bash
pnpm typecheck
pnpm exec expo-doctor
pnpm exec expo export --platform ios --output-dir dist-check-ios
pnpm exec expo export --platform android --output-dir dist-check-android
```

For rapid product review, run Expo web on port 8090 and use a 390 x 844 browser viewport.

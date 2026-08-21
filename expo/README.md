# Katha AI Expo

Approved Expo implementation of Katha AI. In the GitHub monorepo this workspace lives at `expo/`, alongside the original Rork-generated SwiftUI and Kotlin projects.

## Repository Map

- Product repository: `praz-builds/rork-katha-ai-clone`
- Expo workspace: `expo/`
- Backend repository: `praz-builds/katha-ai-backend`
- Supabase project: `iafeuxgoiknncgyjmugd`
- Canonical product and visual contract: `DESIGN.md`
- Current shipped-state record: `BUILD_LOG.md`

## Run

```bash
pnpm install
pnpm start
```

Scan the QR code with Expo Go.

Use `.env.example` to create `.env.local` when wiring real Supabase calls:

```env
EXPO_PUBLIC_SUPABASE_URL=https://iafeuxgoiknncgyjmugd.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

The app runs in mock-first mode when the key is missing. Supabase authentication, native notification permission, and Adapty purchases remain explicit integration boundaries documented in `BUILD_LOG.md`.

## Checks

```bash
pnpm typecheck
pnpm exec expo-doctor
pnpm exec expo export --platform ios --output-dir dist-check-ios
pnpm exec expo export --platform android --output-dir dist-check-android
```

For rapid product review, run Expo web on port 8090 and use a 390 x 844 browser viewport.

# Katha AI

Katha AI monorepo containing the original Rork-generated native clients and the approved Expo application.

## Active Product Workspace

The active client is [`expo/`](expo/). Start new product work there.

- Engineering context: [`expo/CLAUDE.md`](expo/CLAUDE.md)
- Approved design and onboarding contract: [`expo/DESIGN.md`](expo/DESIGN.md)
- Shipped state and remaining integrations: [`expo/BUILD_LOG.md`](expo/BUILD_LOG.md)

The `ios-katha-ai-create-stories/` and `android-katha-ai/` directories are preserved native Rork references. The backend is maintained separately in `praz-builds/katha-ai-backend`.

## Run Expo

```bash
cd expo
pnpm install
pnpm start
```

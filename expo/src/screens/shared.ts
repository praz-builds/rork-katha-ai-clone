import { StyleSheet } from "react-native";
import { colors, fonts, radius, spacing } from "@/theme";

export const sharedStyles = StyleSheet.create({
  flex: { flex: 1 },
  pagePad: { padding: spacing.xl, paddingBottom: spacing.huge },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  backText: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },
  eyebrow: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  h1: {
    marginTop: 3,
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 31,
    lineHeight: 35,
  },

  /* ── Avatar in header ── */

  /* ── Write CTA (new user) ── */

  /* ── Write another (returning user) ── */

  /* ── Continue reading card ── */

  /* ── Horizontal rail ── */

  /* ── Search & chips ── */
  stack: { gap: spacing.lg },
  settingsTitle: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 15,
  },
  settingsSubtitle: {
    marginTop: 2,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
  },

  /* ── Create screen ── */
  profileMeta: {
    marginTop: spacing.xs,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700",
  },
});

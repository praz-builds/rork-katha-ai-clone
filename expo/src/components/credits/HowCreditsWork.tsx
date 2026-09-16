import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * "How credits work", lifted from `source-of-truth/CREDITS_AND_PRICING.md`
 * §1, "Every price, in one place".
 *
 * That subsection is written to be lifted verbatim into this screen, and it
 * is: prices only, no cost basis, no margin arithmetic. If a price here and
 * a price in the document ever disagree, the document is the one that is
 * right and this file is the one that changes.
 */
export const ALWAYS_FREE: readonly string[] = [
  "Reading. Anything, as much as you like, forever.",
  "Editing your own draft by hand. Typing, rewriting, restructuring.",
  "Using a character you already made in another story. Their picture exists, so nothing is drawn and nothing is charged.",
  "Uploading your own cover, and keeping the free typographic concept card.",
  "Re-listening to audio you have already unlocked.",
];

export const PRICE_ROWS: readonly { label: string; detail?: string; cost: string }[] = [
  {
    label: "Start a story",
    detail: "Bundles its cast, chapter 1's words, and chapter 1's art, which becomes the cover",
    cost: "1",
  },
  { label: "Write another chapter", cost: "1" },
  { label: "Write another chapter with art", cost: "2" },
  {
    label: "Auto-continue",
    detail: "The story writes ahead without asking. The whole run is bought at once",
    cost: "1 per chapter, or 2 illustrated",
  },
  { label: "Regenerate a cover", detail: "There is no free retry", cost: "1" },
  {
    label: "Create or edit a character image",
    detail: "6 free per account, ever",
    cost: "then 1 each",
  },
  {
    label: "Reimagine a chapter of a story you created",
    detail: "1 free per chapter",
    cost: "then a plan",
  },
  {
    label: "Reimagine a chapter of somebody else's story",
    detail: "It makes you your own copy",
    cost: "1",
  },
  { label: "Unlock a chapter's audio", detail: "Once, and it is yours", cost: "1" },
];

export const PLAIN_NOTES: readonly { lead: string; body: string }[] = [
  {
    lead: "Auto-continue buys its whole run up front.",
    body:
      "When you set a story to write itself, the chapters it is going to write are paid for the moment chapter one lands, as many as your balance affords, and then it stops. It never writes past the length you planned, and it never extends a finished story by itself.",
  },
  {
    lead: "The six free character images are for the life of the account,",
    body:
      "not per story and not per month, and editing one counts. Changing a character's appearance draws a brand-new picture, which costs us exactly what the first one did.",
  },
  {
    lead: "If a paid action fails, its credit comes back automatically.",
    body: "Every time.",
  },
];

export default function HowCreditsWork() {
  return (
    <View style={styles.card} testID="how-credits-work">
      <Text style={styles.lead}>One credit = one AI action. Reading is always free.</Text>

      <Text style={styles.groupTitle}>Always free, on every plan, with no cap</Text>
      {ALWAYS_FREE.map((line) => (
        <View key={line} style={styles.bullet}>
          <Text style={styles.bulletDot}>{"•"}</Text>
          <Text style={styles.bulletText}>{line}</Text>
        </View>
      ))}

      <Text style={styles.groupTitle}>What each thing costs</Text>
      <View style={styles.table}>
        {PRICE_ROWS.map((row, index) => (
          <View
            key={row.label}
            style={[styles.priceRow, index < PRICE_ROWS.length - 1 && styles.priceRowDivided]}
          >
            <View style={styles.priceText}>
              <Text style={styles.priceLabel}>{row.label}</Text>
              {row.detail ? <Text style={styles.priceDetail}>{row.detail}</Text> : null}
            </View>
            <Text style={styles.priceCost}>{row.cost}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.groupTitle}>Worth saying plainly</Text>
      {PLAIN_NOTES.map((note) => (
        <Text key={note.lead} style={styles.note}>
          <Text style={styles.noteLead}>{note.lead} </Text>
          {note.body}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.related,
  },
  lead: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 15, lineHeight: 21 },
  groupTitle: {
    marginTop: spacing.md,
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  bulletDot: { fontFamily: fonts.ui, color: colors.accent, fontSize: 14, lineHeight: 20 },
  bulletText: { flex: 1, fontFamily: fonts.ui, color: colors.muted, fontSize: 14, lineHeight: 20 },
  table: { borderRadius: radius.lg, backgroundColor: colors.surface2, paddingHorizontal: spacing.md },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  priceRowDivided: { borderBottomWidth: 1, borderBottomColor: colors.border },
  priceText: { flex: 1 },
  priceLabel: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "700", fontSize: 14 },
  priceDetail: {
    marginTop: spacing.tight,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  priceCost: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 14,
    textAlign: "right",
    maxWidth: 110,
  },
  note: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, lineHeight: 20 },
  noteLead: { color: colors.ink, fontWeight: "700" },
});

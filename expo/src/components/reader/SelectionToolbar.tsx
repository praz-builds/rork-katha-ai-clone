import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  useReducedMotion,
} from "react-native-reanimated";
import { BookmarkPlus, Copy, Quote } from "lucide-react-native";
import { CHROME } from "@/components/reader/ReaderChrome";
import { fonts, radius, shadows, spacing } from "@/theme";

export type SelectionAction = "save" | "copy" | "share";

export type SelectionToolbarProps = {
  /** How many words are lit, so the reader can see the drag landing. */
  wordCount: number;
  /** True while the phrase save is in flight, so Save cannot be double-fired. */
  saving?: boolean;
  /** True once this exact selection is saved, so Save reads back as done. */
  saved?: boolean;
  onAction: (action: SelectionAction) => void;
};

/**
 * The menu a selection raises.
 *
 * THREE ACTIONS, AND THAT IS THE WHOLE MENU. Every item here has to earn a
 * slot a thumb can reach one-handed; a fourth would push the row past the width
 * where the labels stay readable at 390.
 *
 * - SAVE PHRASE is the one the backend already exists for (`lib/phrases.ts`,
 *   the `phrases` edge function) and the reason the reader was made tappable at
 *   all. It is first because it is the default intent.
 * - COPY is the action every text surface on both platforms is expected to
 *   have. Its absence is not read as a design decision, it is read as a bug.
 * - SHARE QUOTE sends the selected line with the story title and author. It is
 *   here because readers already screenshot lines they like, and a screenshot
 *   carries no link back; this is the same impulse with attribution attached,
 *   and it is the cheapest organic surface the reader has.
 *
 * Rejected, deliberately: "Look up" (no dictionary API exists on React Native
 * without a native module, and shipping a control that silently does nothing on
 * Android is worse than not shipping it) and "Highlight with a note" (a second,
 * competing persistence model beside saved phrases, for a feature nobody has
 * asked for yet).
 *
 * The dark palette is `CHROME`, not the reading theme, on purpose: this is the
 * app operating on the page, the same separation the control sheet draws.
 */
export function SelectionToolbar({
  wordCount,
  saving = false,
  saved = false,
  onAction,
}: SelectionToolbarProps) {
  const reducedMotion = useReducedMotion();
  const items: { key: SelectionAction; label: string; icon: typeof Copy }[] = [
    { key: "save", label: saved ? "Saved" : "Save phrase", icon: BookmarkPlus },
    { key: "copy", label: "Copy", icon: Copy },
    { key: "share", label: "Share quote", icon: Quote },
  ];

  return (
    <Animated.View
      testID="selection-toolbar"
      accessibilityLiveRegion="polite"
      // Reduced motion keeps the fade -- which explains that something
      // appeared -- and drops the slide, which is the part that moves.
      entering={reducedMotion ? FadeIn.duration(120) : SlideInDown.duration(180)}
      exiting={FadeOut.duration(120)}
      style={styles.bar}
    >
      <Text style={styles.hint} testID="selection-toolbar-hint">
        {wordCount} {wordCount === 1 ? "word" : "words"} · keep dragging to adjust
      </Text>
      <View style={styles.row}>
        {items.map((item) => {
          const Icon = item.icon;
          const disabled = item.key === "save" && (saving || saved);
          return (
            <Pressable
              key={item.key}
              onPress={() => onAction(item.key)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ disabled, busy: item.key === "save" && saving }}
              testID={`selection-action-${item.key}`}
              style={({ pressed }) => [
                styles.action,
                pressed && !disabled && styles.actionPressed,
                disabled && styles.actionDisabled,
              ]}
            >
              <Icon size={20} color={CHROME.text} />
              <Text style={styles.actionLabel} numberOfLines={1}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.huge,
    zIndex: 30,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: CHROME.surface,
    borderWidth: 1,
    borderColor: CHROME.border,
    gap: spacing.xs,
    boxShadow: shadows.overlay,
  },
  hint: {
    fontFamily: fonts.ui,
    fontSize: 11,
    textAlign: "center",
    color: CHROME.muted,
    letterSpacing: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  action: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  actionPressed: {
    backgroundColor: CHROME.track,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionLabel: {
    fontFamily: fonts.ui,
    fontSize: 11,
    fontWeight: "700",
    color: CHROME.text,
    letterSpacing: 0,
  },
});

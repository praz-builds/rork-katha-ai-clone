/**
 * Explore's search field — the control Home no longer has.
 *
 * Two things are load-bearing and neither is visible:
 *
 * **The component type must be stable.** This field lives inside Explore's
 * `ListHeaderComponent`. If the header's component TYPE were rebuilt on each
 * render, React would unmount and remount this `TextInput` on every
 * keystroke, the field would drop focus, and a reader could only ever type
 * one character before the keyboard closed. Declaring it here, at module
 * scope, is what guarantees the type never changes — only its props do.
 *
 * **The clear button is a real target, not an inline glyph.** It is 44x44
 * with its own label, because it is the reader's way out of a search that
 * found nothing, and a way out you have to aim for is not a way out.
 */
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Search, X } from "lucide-react-native";
import { colors, fonts, radius, shadows, spacing } from "@/theme";

export const SEARCH_PLACEHOLDER = "Search stories, authors, ideas";

export function SearchField({
  value,
  onChange,
  onClear,
  /** Drawn beside the field while a query is in flight. */
  busy = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  busy?: boolean;
}) {
  const hasValue = value.length > 0;

  return (
    <View style={styles.box}>
      <Search size={18} color={busy ? colors.accent : colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={SEARCH_PLACEHOLDER}
        placeholderTextColor={colors.tertiary}
        style={styles.input}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search stories"
      />
      {hasValue && (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={6}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <X size={16} color={colors.strong} />
        </Pressable>
      )}
      {/* A word, not a spinner. The list below keeps the previous results
          while a new query runs, so the reader needs to know the screen is
          working rather than to watch something rotate over an empty page. */}
      {busy && !hasValue && <Text style={styles.busy}>Searching</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: spacing.xl,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 15,
    // The field is 52 tall and the target is the whole field, so the input
    // itself carries the height rather than relying on the row's alignment.
    paddingVertical: spacing.related,
  },
  clear: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
  busy: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    paddingRight: spacing.sm,
  },
});

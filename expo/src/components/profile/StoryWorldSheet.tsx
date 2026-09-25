import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, X } from "lucide-react-native";
import { STORY_WORLDS, type StoryWorld } from "@/lib/story-world";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Story world: where new stories are rooted when the brief leaves it open.
 *
 * One tap chooses and closes. The explanation says the one thing a reader
 * needs to trust it -- the brief still wins -- because a preference that
 * silently overrode "a heist in 1920s Chicago" would be a bug, not a feature.
 */
export default function StoryWorldSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: StoryWorld;
  onChange: (next: StoryWorld) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet} testID="story-world-sheet">
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Story world</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          <Text style={styles.sub}>
            Where new stories are rooted — names, places, food and everyday
            detail. Your idea always wins: set a story somewhere and it goes
            there.
          </Text>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            accessibilityRole="radiogroup"
          >
            {STORY_WORLDS.map((world) => {
              const selected = world.id === value;
              return (
                <Pressable
                  key={world.id}
                  onPress={() => {
                    onChange(world.id);
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${world.label}. ${world.hint}`}
                  style={[styles.option, selected && styles.optionOn]}
                  testID={`story-world-${world.id}`}
                >
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{world.label}</Text>
                    <Text style={styles.optionHint}>{world.hint}</Text>
                  </View>
                  {selected ? <Check size={18} color={colors.accent} strokeWidth={3} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrimStrong },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
    maxHeight: "88%",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 24 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  sub: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, lineHeight: 20 },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionOn: { borderColor: colors.accent },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontFamily: fonts.ui, color: colors.ink, fontSize: 15, fontWeight: "700" },
  optionHint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13 },
});

import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, X } from "lucide-react-native";
import { COUNTRY_WORLDS, matchesCountryWorld } from "../../../../backend/supabase/functions/_shared/story-world-countries";
import { STORY_WORLDS, type StoryWorld } from "@/lib/story-world";
import { colors, fonts, profileHeading, radius, spacing } from "@/theme";

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
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return STORY_WORLDS;
    return STORY_WORLDS.filter((world) =>
      world.id === "global"
        ? world.label.toLocaleLowerCase().includes(needle)
        : world.id.toLocaleLowerCase().includes(needle) || matchesCountryWorld(COUNTRY_WORLDS[world.id], needle),
    );
  }, [query]);
  const close = () => {
    setQuery("");
    onClose();
  };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet} testID="story-world-sheet">
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Story world</Text>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          <Text style={styles.sub}>
            Choose a country for grounded names, places, food, customs and
            everyday references. Your story brief always wins.
          </Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search countries"
            placeholderTextColor={colors.tertiary}
            accessibilityLabel="Search countries"
            style={styles.search}
          />
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            accessibilityRole="radiogroup"
            data={options}
            keyExtractor={(world) => world.id}
            ListEmptyComponent={<Text style={styles.empty}>No countries found.</Text>}
            renderItem={({ item: world }) => {
              const selected = world.id === value;
              return (
                <Pressable
                  key={world.id}
                  onPress={() => {
                    onChange(world.id);
                    close();
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={world.hint ? `${world.label}. ${world.hint}` : world.label}
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
            }}
          />
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
  title: { ...profileHeading, color: colors.ink, fontSize: 24 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  sub: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, lineHeight: 20 },
  search: { fontFamily: fonts.ui, color: colors.ink, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, minHeight: 44, paddingHorizontal: spacing.md },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.sm },
  empty: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, paddingVertical: spacing.xl, textAlign: "center" },
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

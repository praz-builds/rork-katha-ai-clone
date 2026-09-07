import { Check, Music, X } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MUSIC_TRACKS, orderTracksForGenre } from "@/lib/music-catalogue";
import { colors, fonts, genreLabels, radius, spacing } from "@/theme";
import type { Genre } from "@/types/domain";

export type MusicPickerProps = {
  visible: boolean;
  /** The story's genre. Tracks tagged with it are listed first. */
  genre: Genre;
  /** The currently selected track id, or null for "None". */
  selectedTrackId: string | null;
  onSelect: (trackId: string | null) => void;
  onClose: () => void;
};

/**
 * Reader background-music picker. Reads only from `@/lib/music-catalogue`,
 * so it never needs a code change to gain or lose tracks: dropping a track
 * into that module's MUSIC_TRACKS array is the whole mechanism.
 */
export function MusicPicker({ visible, genre, selectedTrackId, onSelect, onClose }: MusicPickerProps) {
  const orderedTracks = orderTracksForGenre(MUSIC_TRACKS, genre);
  const hasTracks = orderedTracks.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Music</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close music"
              hitSlop={8}
              style={styles.closeButton}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          {hasTracks ? (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              <TrackRow
                label="None"
                detail="Read in silence"
                selected={selectedTrackId === null}
                onPress={() => onSelect(null)}
              />
              {orderedTracks.map((track) => (
                <TrackRow
                  key={track.id}
                  label={track.title}
                  detail={track.genres.map((trackGenre) => genreLabels[trackGenre]).join(" · ")}
                  selected={selectedTrackId === track.id}
                  onPress={() => onSelect(track.id)}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyState}>
              <Music size={28} color={colors.tertiary} />
              <Text style={styles.emptyTitle}>No music yet</Text>
              <Text style={styles.emptyBody}>
                Ambient tracks are not available yet. Check back once Katha adds licensed music for this genre.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function TrackRow({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={selected ? `${label}, selected` : label}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {selected ? <Check size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,14,12,0.26)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22,
    letterSpacing: 0,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowSelected: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 16,
    letterSpacing: 0,
  },
  rowDetail: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 0,
  },
  emptyState: {
    minHeight: 140,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 17,
    letterSpacing: 0,
  },
  emptyBody: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    letterSpacing: 0,
  },
});

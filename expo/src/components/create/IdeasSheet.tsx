import { useCallback } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import { X } from "lucide-react-native";

import { GENRE_EMOJI, GENRE_STARTERS } from "@/lib/genre-content";
import { colors, fonts, genreLabels, radius, spacing, type } from "@/theme";
import type { Genre } from "@/types/domain";

/**
 * The starter ideas, on demand.
 *
 * WHAT CHANGED AND WHY. The brief used to print a "TRY ONE" heading and the
 * three starter cards inline, directly under the idea box. Three cards of
 * two-sentence prose is most of a phone screen, so the fields that actually
 * make the story - premise, cast, length - were pushed below the fold on the
 * one screen where a writer is deciding what to write. Owner feedback on the
 * running screen: "reducing the spacing and keeping this more neat". The
 * ideas did not stop being useful, so they moved behind one control instead
 * of being deleted.
 *
 * WHY A BOTTOM SHEET, and not a dropdown or a screen. A starter is two
 * sentences of prose, and reading three of them is the whole point of opening
 * this - so the surface has to be wide and tall, which rules out the popover
 * `Dropdown` (built for one-line options, capped at 320pt). It is also a
 * DETOUR, not a step: the writer is mid-thought in the idea box and must come
 * back to it with or without a starter, which rules out a pushed screen that
 * makes leaving feel like going back. A sheet over the brief keeps the box
 * they were typing in visible behind the scrim, matches every other
 * disposable surface in the app (`ReimagineSheet`, the comments sheet), and
 * has three ways out - the close button, the scrim, and the hardware back -
 * so dismissing without choosing is never a trap.
 *
 * GENRE IS THE SOURCE OF TRUTH AND IT MOVES. The genre chip sits at the top
 * of the same screen and can be changed at any time, including with this
 * sheet's own suggestion already in the box. So the list is derived from the
 * `genre` prop at render, never copied into state on open: change the genre,
 * reopen, and the ideas are the new genre's. Every `Genre` has starters -
 * `GENRE_STARTERS` is a `Record<Genre, string[]>`, so a genre added to the
 * union does not compile until someone writes them.
 */

export type IdeasSheetProps = {
  visible: boolean;
  /** The brief's current genre. Read at render, so a genre change is picked up. */
  genre: Genre;
  onClose: () => void;
  /** Fired with the chosen starter. The caller fills the idea box and closes. */
  onPick: (starter: string) => void;
};

export function IdeasSheet({ visible, genre, onClose, onPick }: IdeasSheetProps) {
  const insets = useSafeAreaInsets();
  // A reduced-motion reader gets the sheet, not the slide. The sheet still
  // opens; only the travel is dropped.
  const reducedMotion = useReducedMotion();
  const starters = GENRE_STARTERS[genre] ?? [];
  const label = genreLabels[genre];

  const pick = useCallback(
    (starter: string) => {
      onPick(starter);
      // Picking is decisive: the sheet closes on the tap rather than showing a
      // selected state and waiting for a confirm the writer has no reason to
      // give. The announcement is what a screen reader gets in place of
      // watching the idea box fill in behind the sheet.
      AccessibilityInfo.announceForAccessibility?.("Idea added to your story idea.");
    },
    [onPick],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* The scrim is an exit for touch. It is deliberately NOT the screen
            reader's exit: the sheet below declares `accessibilityViewIsModal`,
            which takes everything outside it -- this included -- off the
            reader's path. The named close button is that exit. */}
        <Pressable
          testID="ideas-scrim"
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close ideas"
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{`${GENRE_EMOJI[genre]} ${label} ideas`}</Text>
              <Text style={styles.subtitle}>Tap one to start from it. You can rewrite it after.</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close ideas"
              hitSlop={10}
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {starters.length === 0 ? (
              <Text style={styles.empty}>No starters for this genre yet.</Text>
            ) : (
              starters.map((starter) => (
                <Pressable
                  key={starter}
                  accessibilityRole="button"
                  accessibilityLabel={`Use idea: ${starter}`}
                  onPress={() => pick(starter)}
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                >
                  {/* Never truncated. A clipped starter teaches nothing about
                      what a usable idea looks like, which is half of why the
                      starters exist at all. */}
                  <Text style={styles.cardText}>{starter}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,14,12,0.26)" },
  sheet: {
    maxHeight: "82%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerCopy: { flex: 1, gap: 2 },
  title: { ...type.headline, color: colors.ink },
  subtitle: { ...type.subhead, color: colors.muted },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  list: { gap: spacing.md, paddingBottom: spacing.lg },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  cardPressed: { backgroundColor: colors.accentSoft },
  cardText: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, lineHeight: 21 },
  empty: { ...type.subhead, color: colors.tertiary },
});

export default IdeasSheet;

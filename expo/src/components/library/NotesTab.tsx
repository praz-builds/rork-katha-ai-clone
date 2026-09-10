import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Info, Plus, X } from "lucide-react-native";

import { Toggle } from "@/components/Toggle";
import AddPhrasesSheet from "@/components/library/AddPhrasesSheet";
import { colors, radius, spacing, type } from "@/theme";
import type { CreationLanguage } from "@/types/domain";
import {
  isPhraseReinforcementEnabled,
  listSavedPhrases,
  saveManualPhrases,
  setPhraseReinforcementEnabled,
  unsavePhrase,
  type SavedPhrase,
} from "@/lib/phrases";

type LoadState = "loading" | "ready" | "error";

/**
 * Notes: the reader's phrase list, and the switch that decides what Katha does
 * with it.
 *
 * WHY THIS IS A TAB AND NOT A SETTING. The phrases are the point. A reader
 * learning English through stories wants to see the list grow, add to it from
 * memory, and drop the ones that stuck, and none of that belongs three levels
 * down in a preferences screen. The switch sits above the list because it
 * changes what the list is FOR, and putting it anywhere else would leave a
 * reader guessing whether saving a phrase does anything.
 *
 * WHAT THE SWITCH REACHES is documented on `isPhraseReinforcementEnabled` in
 * `lib/phrases.ts`, and it is less than this screen implies: the preference is
 * kept on the device, and `generate-story` does not read it yet. That gap is
 * named in the build log rather than papered over in the copy.
 */
export default function NotesTab({ onPractice }: { onPractice?: () => void }) {
  const [state, setState] = useState<LoadState>("loading");
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  const [reinforcement, setReinforcement] = useState(true);
  const [showHow, setShowHow] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [saved, enabled] = await Promise.all([
        listSavedPhrases(),
        isPhraseReinforcementEnabled(),
      ]);
      setPhrases(saved);
      setReinforcement(enabled);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [saved, enabled] = await Promise.all([
          listSavedPhrases(),
          isPhraseReinforcementEnabled(),
        ]);
        if (!active) return;
        setPhrases(saved);
        setReinforcement(enabled);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleToggle = (next: boolean) => {
    // The switch moves now and persists behind it. A preference write that
    // takes a frame is not something to make anybody watch a spinner for.
    setReinforcement(next);
    void setPhraseReinforcementEnabled(next);
  };

  const handleSave = async (
    incoming: string[],
    language: CreationLanguage,
  ): Promise<boolean> => {
    const created = await saveManualPhrases(incoming, language);
    if (created.length === 0) return false;
    setPhrases((current) => [...created, ...current]);
    return true;
  };

  const handleRemove = async (phrase: SavedPhrase) => {
    setRemoveError(null);
    // Where it sat, so a failed removal can put it back where it was rather
    // than at the top of the list.
    const index = phrases.findIndex((entry) => entry.id === phrase.id);
    setPhrases((current) => current.filter((entry) => entry.id !== phrase.id));
    const removed = await unsavePhrase(phrase.id);
    if (!removed) {
      // The server still has it. Putting it back is the only honest answer:
      // a phrase that vanishes from the list and returns on next launch is
      // worse than one that never left.
      //
      // ONE PHRASE, NOT A SNAPSHOT. This used to restore the whole list as it
      // stood when the swipe began. Two removals in quick succession both
      // captured that same list, so if the second failed it reinstated the
      // first — which had already succeeded, and whose phrase was gone from
      // storage. The list then showed a phrase that no longer existed until
      // the next launch quietly removed it again. Re-inserting only the one
      // that failed leaves every concurrent removal alone.
      setPhrases((current) =>
        current.some((entry) => entry.id === phrase.id) ? current : [
          ...current.slice(0, Math.max(0, Math.min(index, current.length))),
          phrase,
          ...current.slice(Math.max(0, Math.min(index, current.length))),
        ]
      );
      setRemoveError("That did not save. Check your connection and try again.");
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>Language learning reinforcement</Text>
          <Pressable
            onPress={() => setShowHow((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="How reinforcement works"
            accessibilityState={{ expanded: showHow }}
            testID="notes-info"
            hitSlop={10}
            style={styles.infoButton}
          >
            <Info size={18} color={colors.strong} />
          </Pressable>
          <Toggle
            value={reinforcement}
            onValueChange={handleToggle}
            accessibilityLabel="Weave saved phrases into new stories"
            accessibilityHint="Turns phrase reinforcement on or off"
            testID="notes-reinforcement-toggle"
          />
        </View>

        <Text style={styles.cardBody}>
          Save the phrases you do not know yet while you read. Katha weaves them
          back into the stories you make next, so you meet them again inside a
          scene rather than on a flashcard.
        </Text>

        {showHow ? (
          <View style={styles.howBox} testID="notes-info-panel">
            <Text style={styles.howLine}>
              Repetition, without it feeling like drilling.
            </Text>
            <Text style={styles.howLine}>
              The same phrase in a different context each time it comes back.
            </Text>
            <Text style={styles.howLine}>
              Stronger memory, because the words arrive attached to a story you
              wanted to read.
            </Text>
          </View>
        ) : null}

        {!reinforcement ? (
          <Text style={styles.pausedNote} testID="notes-paused-note">
            Weaving is off. Your phrases stay saved here and new stories will
            leave them alone.
          </Text>
        ) : null}

        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add phrases"
          testID="notes-add-phrases"
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
          ]}
        >
          <Plus size={18} color={colors.surface} />
          <Text style={styles.primaryButtonLabel}>Add phrases</Text>
        </Pressable>
      </View>

      <View style={styles.listHeaderRow}>
        <Text style={styles.listHeader}>Your phrases</Text>
        {onPractice && phrases.length > 0 ? (
          <Pressable
            onPress={onPractice}
            accessibilityRole="button"
            accessibilityLabel="Practise your saved phrases"
            testID="notes-practice"
            hitSlop={8}
          >
            <Text style={styles.listAction}>Practise</Text>
          </Pressable>
        ) : null}
      </View>

      {state === "loading" ? (
        <View style={styles.stateBox} testID="notes-loading">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.stateText}>Loading your phrases</Text>
        </View>
      ) : null}

      {state === "error" ? (
        <View style={styles.stateBox} testID="notes-error">
          <Text style={styles.stateText}>
            We could not load your phrases just now.
          </Text>
          <Pressable
            onPress={() => void load()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {state === "ready" && phrases.length === 0 ? (
        <View style={styles.stateBox} testID="notes-empty">
          <Text style={styles.stateText}>
            Nothing saved yet. Tap a word or a line while you read, or add a few
            here from memory.
          </Text>
        </View>
      ) : null}

      {state === "ready" && phrases.length > 0 ? (
        <View style={styles.phraseList}>
          {removeError ? (
            <Text style={styles.removeError} testID="notes-remove-error">
              {removeError}
            </Text>
          ) : null}
          {phrases.map((phrase) => (
            <View key={phrase.id} style={styles.phraseRow}>
              <View style={styles.phraseBody}>
                <Text style={styles.phraseText}>{phrase.phrase}</Text>
                <Text style={styles.phraseMeta} numberOfLines={1}>
                  {phrase.storyTitle
                    ? `From ${phrase.storyTitle}`
                    : `Added by you · ${phrase.language ?? "English"}`}
                </Text>
              </View>
              <Pressable
                onPress={() => void handleRemove(phrase)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${phrase.phrase}`}
                testID={`notes-remove-${phrase.id}`}
                hitSlop={10}
                style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
              >
                <X size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <AddPhrasesSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        existingPhrases={phrases.map((entry) => ({
          phrase: entry.phrase,
          language: entry.language,
        }))}
        onSave={handleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.betweenGroups },
  pressed: { opacity: 0.7 },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.related,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardTitle: { ...type.headline, color: colors.ink, flex: 1 },
  infoButton: { alignItems: "center", justifyContent: "center" },
  cardBody: { ...type.subhead, color: colors.muted },
  howBox: {
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: spacing.xs,
  },
  howLine: { ...type.caption, color: colors.muted },
  pausedNote: { ...type.caption, color: colors.strong },
  primaryButton: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primaryButtonPressed: { backgroundColor: colors.accentPressed },
  primaryButtonLabel: { ...type.body, fontWeight: "800", color: colors.surface },
  listHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  listHeader: { ...type.headline, color: colors.ink },
  listAction: { ...type.subhead, color: colors.accent, fontWeight: "800" },
  stateBox: {
    paddingVertical: spacing.xxxl,
    alignItems: "center",
    gap: spacing.md,
  },
  stateText: {
    ...type.subhead,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  retryButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryLabel: { ...type.subhead, color: colors.ink, fontWeight: "800" },
  phraseList: { gap: spacing.sm },
  removeError: { ...type.caption, color: colors.premium },
  phraseRow: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  phraseBody: { flex: 1, gap: 2 },
  phraseText: { ...type.body, color: colors.ink, fontWeight: "600" },
  phraseMeta: { ...type.caption, color: colors.tertiary },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
});

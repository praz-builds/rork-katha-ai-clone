import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, GraduationCap, RotateCcw, Sparkles, X } from "lucide-react-native";
import {
  listSavedPhrases,
  recordPracticeOutcome,
  unsavePhrase,
  type SavedPhrase,
} from "@/lib/phrases";
import { sharedStyles } from "@/screens/shared";
import { colors, fonts, radius, spacing } from "@/theme";

export type PracticeScreenProps = {
  onBack: () => void;
  /** Optional: lets a row's story name jump back into that story. */
  onStory?: (storyId: string) => void;
};

function isDue(phrase: SavedPhrase, nowMs: number): boolean {
  return Date.parse(phrase.dueAt) <= nowMs;
}

export default function PracticeScreen({ onBack, onStory }: PracticeScreenProps) {
  const [phrases, setPhrases] = useState<SavedPhrase[] | null>(null);
  const [dueQueue, setDueQueue] = useState<SavedPhrase[]>([]);
  const [cursor, setCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);

  const load = useCallback(async () => {
    const all = await listSavedPhrases();
    setPhrases(all);
    const now = Date.now();
    setDueQueue(all.filter((entry) => isDue(entry, now)));
    setCursor(0);
    setSessionDone(0);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = dueQueue[cursor];

  const answer = useCallback(async (outcome: "know" | "again") => {
    if (!current || submitting) return;
    setSubmitting(true);
    await recordPracticeOutcome(current.id, outcome);
    setSubmitting(false);
    setSessionDone((count) => count + 1);
    setCursor((index) => index + 1);
  }, [current, submitting]);

  const removePhrase = useCallback(async (phraseId: string) => {
    setPhrases((prev) => prev ? prev.filter((entry) => entry.id !== phraseId) : prev);
    // Removing an entry the cursor has already passed shifts the queue left
    // under it, so the cursor then points one PAST the next due phrase and that
    // phrase is silently skipped for the rest of the session. The cursor moves
    // with the queue rather than staying put.
    setDueQueue((prev) => {
      const removedAt = prev.findIndex((entry) => entry.id === phraseId);
      if (removedAt === -1) return prev;
      setCursor((index) => (removedAt < index ? index - 1 : index));
      return prev.filter((entry) => entry.id !== phraseId);
    });
    const ok = await unsavePhrase(phraseId);
    if (!ok) await load();
  }, [load]);

  const isLoading = phrases === null;
  const isEmpty = phrases !== null && phrases.length === 0;
  const queueFinished = phrases !== null && phrases.length > 0 && cursor >= dueQueue.length;

  const sortedPhrases = useMemo(
    () => phrases ? [...phrases].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [],
    [phrases],
  );

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView contentContainerStyle={sharedStyles.pagePad} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityLabel="Back to Library"
          accessibilityRole="button"
          style={sharedStyles.backButton}
        >
          <ChevronLeft size={18} color={colors.ink} />
          <Text style={sharedStyles.backText}>Back</Text>
        </Pressable>
        <Text style={sharedStyles.eyebrow}>Practice</Text>
        <Text style={sharedStyles.h1}>Phrases you saved</Text>

        {isLoading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <>
            {current ? (
              <PracticeCard
                phrase={current}
                position={cursor + 1}
                total={dueQueue.length}
                submitting={submitting}
                onAnswer={answer}
              />
            ) : queueFinished && sessionDone > 0 ? (
              <CaughtUpCard count={sessionDone} />
            ) : (
              <NothingDueCard />
            )}

            <Text style={styles.sectionLabel}>All saved phrases</Text>
            <View style={styles.list}>
              {sortedPhrases.map((phrase) => (
                <PhraseRow key={phrase.id} phrase={phrase} onRemove={removePhrase} onStory={onStory} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <GraduationCap size={32} color={colors.tertiary} />
      <Text style={styles.emptyTitle}>Nothing saved yet</Text>
      <Text style={styles.emptyText}>
        While you are reading, tap a word to save it, or press and hold to save the whole
        sentence. Saved phrases show up here to practise.
      </Text>
    </View>
  );
}

function NothingDueCard() {
  return (
    <View style={styles.statusCard}>
      <Sparkles size={22} color={colors.accent} />
      <Text style={styles.statusTitle}>Nothing due right now</Text>
      <Text style={styles.statusText}>
        Come back once your saved phrases are ready for another round.
      </Text>
    </View>
  );
}

function CaughtUpCard({ count }: { count: number }) {
  return (
    <View style={styles.statusCard}>
      <Sparkles size={22} color={colors.accent} />
      <Text style={styles.statusTitle}>
        {count === 1 ? "1 phrase practised" : `${count} phrases practised`}
      </Text>
      <Text style={styles.statusText}>You are caught up for now.</Text>
    </View>
  );
}

function PracticeCard({
  phrase,
  position,
  total,
  submitting,
  onAnswer,
}: {
  phrase: SavedPhrase;
  position: number;
  total: number;
  submitting: boolean;
  onAnswer: (outcome: "know" | "again") => void;
}) {
  return (
    <View style={styles.practiceCard}>
      <Text style={styles.practiceProgress}>{position} of {total}</Text>
      <Text style={styles.practiceStory} numberOfLines={1}>{phrase.storyTitle}</Text>
      <Text style={styles.practicePhrase}>{phrase.phrase}</Text>
      {phrase.sentence !== phrase.phrase ? (
        <Text style={styles.practiceSentence}>{phrase.sentence}</Text>
      ) : null}
      <View style={styles.practiceActions}>
        <Pressable
          disabled={submitting}
          onPress={() => onAnswer("again")}
          accessibilityLabel="Still learning this phrase"
          accessibilityRole="button"
          style={[styles.practiceButton, styles.practiceButtonGhost]}
        >
          <RotateCcw size={16} color={colors.ink} />
          <Text style={styles.practiceButtonGhostText}>Still learning</Text>
        </Pressable>
        <Pressable
          disabled={submitting}
          onPress={() => onAnswer("know")}
          accessibilityLabel="Got this phrase"
          accessibilityRole="button"
          style={[styles.practiceButton, styles.practiceButtonPrimary]}
        >
          <Text style={styles.practiceButtonPrimaryText}>Got it</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PhraseRow({
  phrase,
  onRemove,
  onStory,
}: {
  phrase: SavedPhrase;
  onRemove: (phraseId: string) => void;
  onStory?: (storyId: string) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.rowPhrase}>{phrase.phrase}</Text>
        {phrase.sentence !== phrase.phrase ? (
          <Text style={styles.rowSentence} numberOfLines={2}>{phrase.sentence}</Text>
        ) : null}
        <Pressable
          disabled={!onStory}
          onPress={() => onStory?.(phrase.storyId)}
          accessibilityLabel={`Open ${phrase.storyTitle}`}
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          style={styles.rowStoryLink}
        >
          <Text style={styles.rowStory} numberOfLines={1}>{phrase.storyTitle}</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => onRemove(phrase.id)}
        accessibilityLabel={`Remove "${phrase.phrase}" from saved phrases`}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.rowRemove}
      >
        <X size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingBlock: { paddingVertical: spacing.huge, alignItems: "center" },
  emptyState: {
    marginTop: spacing.xxl,
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 20,
    letterSpacing: 0,
  },
  emptyText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    letterSpacing: 0,
  },
  statusCard: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing.sm,
  },
  statusTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 18,
    letterSpacing: 0,
  },
  statusText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    letterSpacing: 0,
  },
  practiceCard: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  practiceProgress: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  practiceStory: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
  },
  practicePhrase: {
    marginTop: spacing.xs,
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 24,
    letterSpacing: 0,
  },
  practiceSentence: {
    marginTop: spacing.xs,
    fontFamily: fonts.reader,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  practiceActions: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
  },
  practiceButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  practiceButtonGhost: {
    backgroundColor: colors.surface2,
  },
  practiceButtonGhostText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0,
  },
  practiceButtonPrimary: {
    backgroundColor: colors.accent,
  },
  practiceButtonPrimaryText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
  },
  sectionLabel: {
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  list: { gap: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  rowBody: { flex: 1, gap: 2 },
  rowPhrase: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 16,
    letterSpacing: 0,
  },
  rowSentence: {
    fontFamily: fonts.reader,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
  rowStoryLink: {
    marginTop: spacing.xs,
    alignSelf: "flex-start",
    minHeight: 24,
    justifyContent: "center",
  },
  rowStory: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  rowRemove: {
    width: 44,
    height: 44,
    marginTop: -spacing.sm,
    marginRight: -spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});

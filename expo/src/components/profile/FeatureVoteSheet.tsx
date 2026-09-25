import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronUp, X } from "lucide-react-native";
import {
  type FeedbackTopic,
  loadFeedbackTopics,
  setFeedbackVote,
} from "@/lib/feature-votes";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Vote on what's next, from You.
 *
 * The list is curated (migration 00099): readers rank it, they do not post to
 * it, so there is no public user-written text here to moderate. Anything not
 * on it goes through Send feedback, and the sheet says so.
 */
export default function FeatureVoteSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [topics, setTopics] = useState<FeedbackTopic[] | null | "loading">("loading");
  const [pendingVote, setPendingVote] = useState<string | null>(null);
  // Bumped every time the sheet opens or closes. A vote that resolves after
  // the sheet was closed belongs to a session that is over and must not write
  // its notice or undo counts that were loaded fresh since.
  const session = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    session.current += 1;
    setPendingVote(null);
    if (visible) setNotice(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setTopics("loading");
    void loadFeedbackTopics().then((next) => {
      if (live) setTopics(next);
    });
    return () => {
      live = false;
    };
  }, [visible, reloadKey]);

  const toggleVote = useCallback(async (topic: FeedbackTopic) => {
    if (pendingVote || topic.status === "shipped") return;
    const on = !topic.voted;
    const mine = session.current;
    setPendingVote(topic.id);
    // Optimistic, and put back exactly if the server says no.
    const apply = (voted: boolean, delta: number) =>
      setTopics((current) =>
        Array.isArray(current)
          ? current.map((item) =>
            item.id === topic.id
              ? { ...item, voted, votes: Math.max(0, item.votes + delta) }
              : item
          )
          : current
      );
    apply(on, on ? 1 : -1);
    const result = await setFeedbackVote(topic.id, on);
    if (mine !== session.current) return;
    if (result === "failed") {
      apply(!on, on ? -1 : 1);
      setNotice({ tone: "error", text: "Your vote didn't save. Try again." });
    } else if (result === "stale") {
      // The server already had this vote; the counts on screen were old.
      setReloadKey((key) => key + 1);
    }
    setPendingVote(null);
  }, [pendingVote]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet} testID="feature-vote-sheet">
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Vote on what’s next</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          <Text style={styles.fine}>
            One vote per idea. Tap again to take it back. The team reads the
            counts when deciding what to build.
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {topics === "loading"
              ? <ActivityIndicator color={colors.accent} />
              : topics === null
              ? (
                <Text style={styles.fine} testID="feature-votes-error">
                  The list couldn’t load just now. Try again in a moment.
                </Text>
              )
              : topics.map((topic) => {
                const shipped = topic.status === "shipped";
                return (
                  <Pressable
                    key={topic.id}
                    onPress={() => void toggleVote(topic)}
                    // Every row waits while one vote is in flight, rather
                    // than a second tap being silently dropped.
                    disabled={shipped || pendingVote !== null}
                    accessibilityRole="button"
                    accessibilityLabel={shipped
                      ? `${topic.title}, shipped`
                      : `${topic.title}, ${topic.votes} ${topic.votes === 1 ? "vote" : "votes"}`}
                    accessibilityHint={shipped
                      ? undefined
                      : topic.voted
                      ? "Removes your vote"
                      : "Adds your vote"}
                    accessibilityState={{ selected: topic.voted, disabled: shipped }}
                    style={[styles.topic, topic.voted && styles.topicOn]}
                    testID={`feature-vote-${topic.id}`}
                  >
                    <View style={styles.topicText}>
                      <Text style={styles.topicTitle}>{topic.title}</Text>
                      {topic.detail
                        ? <Text style={styles.topicDetail}>{topic.detail}</Text>
                        : null}
                      {topic.status === "planned"
                        ? <Text style={styles.badge}>Planned</Text>
                        : shipped
                        ? <Text style={styles.badge}>Shipped</Text>
                        : null}
                    </View>
                    <View style={styles.voteBox}>
                      <ChevronUp
                        size={18}
                        color={topic.voted ? colors.accent : colors.tertiary}
                      />
                      <Text style={[styles.voteCount, topic.voted && styles.voteCountOn]}>
                        {topic.votes}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            <Text style={styles.fine}>
              Missing something? Send it through Send feedback on You.
            </Text>
          </ScrollView>

          {notice
            ? (
              <Text
                style={[styles.notice, notice.tone === "error" && styles.noticeError]}
                accessibilityLiveRegion="polite"
                testID="feature-vote-notice"
              >
                {notice.text}
              </Text>
            )
            : null}
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
  title: { fontFamily: fonts.ui, fontWeight: "700", color: colors.ink, fontSize: 24 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  fine: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, lineHeight: 17 },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  topic: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 56,
  },
  topicOn: { borderColor: colors.accent },
  topicText: { flex: 1, gap: spacing.xs },
  topicTitle: { fontFamily: fonts.ui, color: colors.ink, fontSize: 15, fontWeight: "700" },
  topicDetail: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13, lineHeight: 18 },
  badge: {
    alignSelf: "flex-start",
    fontFamily: fonts.ui,
    fontSize: 11,
    fontWeight: "700",
    color: colors.strong,
    backgroundColor: colors.track,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: "hidden",
  },
  voteBox: { alignItems: "center", minWidth: 36 },
  voteCount: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, fontWeight: "700" },
  voteCountOn: { color: colors.accent },
  notice: { fontFamily: fonts.ui, color: colors.strong, fontSize: 13 },
  noticeError: { color: colors.danger },
});

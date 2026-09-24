import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Send } from "lucide-react-native";
import { setAuthorFollow } from "@/lib/api";
import { fetchThread, formatRelativeTime, postComment, type ServerComment } from "@/lib/comments";
import type { ReaderTheme } from "@/lib/reading-themes";
import { colors, fonts, radius, shadows, spacing, type } from "@/theme";

/**
 * The end of a chapter's social layer: who wrote it, and what readers said.
 *
 * THIS IS THE APP, NOT THE BOOK. It used to be drawn straight onto the page --
 * same background as the prose, fenced off by hairline dividers -- so the
 * author row and the comments read as more of the chapter. Each is now a card
 * lifted off the page in the app's own colours (`ReaderTheme.social`), with
 * the elevation drawing the edge rather than a border.
 */

export type ChapterSocialAuthor = { displayName: string; bio?: string; followers?: number };

type Row = { id: string; user: string; text: string; time: string; createdAt: number };

type Status = "loading" | "ready" | "failed";

export type ChapterSocialProps = {
  storyId: string;
  authorId: string;
  /** The chapter a new comment is attached to. */
  chapterId: string;
  author: ChapterSocialAuthor;
  theme: ReaderTheme;
  /**
   * Opens the author's profile. The same seam the story page uses
   * (`onAuthor(story.authorId)`). Omitted and the author row is not a button.
   */
  onAuthor?: (authorId: string) => void;
  /** True when the tap was swallowed by the sign-in prompt. */
  requireSignIn: () => boolean;
  /** Whether the viewer already follows this author, as the story carries it. */
  initialFollowing?: boolean;
};

function toRow(comment: ServerComment, now: number): Row {
  const createdAt = Date.parse(comment.createdAt);
  return {
    id: comment.id,
    user: comment.authorName,
    text: comment.body,
    time: formatRelativeTime(createdAt, now),
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Newest first, so a comment the reader just posted lands where the others are read from. */
function newestFirst(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}

export default function ChapterSocial({
  storyId,
  authorId,
  chapterId,
  author,
  theme,
  onAuthor,
  requireSignIn,
  initialFollowing = false,
}: ChapterSocialProps) {
  const social = theme.social;
  const [comments, setComments] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [isFollowing, setIsFollowing] = useState(initialFollowing);
  const followInFlight = useRef(false);

  /*
    Every reader's comments on this story, from the same endpoint the story
    page reads. The server filters by story and by the viewer's own block list
    only; nothing here narrows it further.

    A FAILED READ IS NOT AN EMPTY THREAD. This used to treat any failure as
    "none yet", so a request that was refused -- no session, offline, a server
    error -- rendered "Comments (0) / No comments yet" over a story that might
    have forty. It now says the comments could not load, with a retry, and the
    count is only shown once the server has actually answered.
  */
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    fetchThread(storyId).then(
      (thread) => {
        if (!alive) return;
        const now = Date.now();
        setComments(
          newestFirst(thread.filter((comment) => !comment.deleted).map((comment) => toRow(comment, now))),
        );
        setStatus("ready");
      },
      () => {
        if (alive) setStatus("failed");
      },
    );
    return () => {
      alive = false;
    };
  }, [storyId, attempt]);

  /*
    Follow is SAVED, the same way the story page saves it (`setAuthorFollow`):
    optimistic, settled by the server's answer, rolled back on a refusal. It
    used to flip local state only, so "Following" was gone on the next screen.
  */
  const handleToggleFollow = useCallback(() => {
    if (requireSignIn()) return;
    if (followInFlight.current) return;
    followInFlight.current = true;
    const previousOn = isFollowing;
    const nextOn = !previousOn;
    setIsFollowing(nextOn);
    const followers = author.followers ?? 0;
    setAuthorFollow(authorId, nextOn, Math.max(0, followers + (nextOn ? 1 : -1)))
      .then((result) => setIsFollowing(result.on))
      .catch(() => setIsFollowing(previousOn))
      .finally(() => {
        followInFlight.current = false;
      });
  }, [author.followers, authorId, isFollowing, requireSignIn]);

  const openAuthor = useCallback(() => {
    onAuthor?.(authorId);
  }, [authorId, onAuthor]);

  /*
    Posted, not just prepended. The row appears at once (keyed `local-`) and is
    replaced by the server's own row when it lands. Anything short of a real row
    coming back -- a refusal, or a reply that is not a comment -- takes the row
    back out and says so: a comment left on screen that the server never kept
    is visible to exactly one person, and that person is told it was posted.
  */
  const handleSubmitComment = useCallback(() => {
    if (requireSignIn()) return;
    const trimmed = commentText.trim();
    if (!trimmed) return;
    const localId = `local-${Date.now()}`;
    setComments((prev) => [
      { id: localId, user: "You", text: trimmed, time: "just now", createdAt: Date.now() },
      ...prev,
    ]);
    setCommentText("");
    const fail = () => {
      setComments((prev) => prev.filter((comment) => comment.id !== localId));
      setCommentText(trimmed);
      Alert.alert(
        "Comment not posted",
        "Katha could not save your comment. Check your connection and try again.",
      );
    };
    postComment(storyId, trimmed, undefined, chapterId)
      .then((posted) => {
        if (!posted) {
          fail();
          return;
        }
        const row = toRow(posted, Date.now());
        setComments((prev) => prev.map((comment) => (comment.id === localId ? row : comment)));
      })
      .catch(fail);
  }, [chapterId, commentText, requireSignIn, storyId]);

  const initial = author.displayName.charAt(0);
  const authorIdentity = (
    <>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <View style={styles.authorInfo}>
        <Text style={[styles.authorName, { color: social.text }]} numberOfLines={1}>
          {author.displayName}
        </Text>
        {author.bio ? (
          <Text style={[styles.authorBio, { color: social.muted }]} numberOfLines={2}>
            {author.bio}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View style={styles.layer} testID="chapter-social">
      <View style={[styles.card, styles.authorCard, { backgroundColor: social.surface }]} testID="reader-author-card">
        {/* Follow is a SIBLING of the tappable identity, not inside it, so one
          * tap can never both follow and navigate. */}
        {onAuthor ? (
          <Pressable
            onPress={openAuthor}
            accessibilityRole="button"
            accessibilityLabel={`View ${author.displayName}'s profile`}
            testID="reader-author"
            style={({ pressed }) => [styles.authorIdentity, pressed && styles.pressed]}
          >
            {authorIdentity}
          </Pressable>
        ) : (
          <View style={styles.authorIdentity}>{authorIdentity}</View>
        )}
        <Pressable
          onPress={handleToggleFollow}
          accessibilityLabel={isFollowing ? "Unfollow author" : "Follow author"}
          accessibilityRole="button"
          testID="reader-follow"
          style={[styles.followButton, { backgroundColor: social.text }]}
        >
          <Text style={[styles.followText, { color: social.surface }]}>
            {isFollowing ? "Following" : "Follow"}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.card, styles.commentsCard, { backgroundColor: social.surface }]} testID="reader-comments-card">
        <Text style={[styles.commentsTitle, { color: social.text }]}>
          {status === "ready" ? `Comments (${comments.length})` : "Comments"}
        </Text>
        <View style={styles.commentInputRow}>
          <TextInput
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Add a comment..."
            placeholderTextColor={social.muted}
            style={[styles.commentInput, { color: social.text, backgroundColor: social.field }]}
            multiline
            maxLength={500}
            accessibilityLabel="Add a comment"
          />
          <Pressable
            onPress={handleSubmitComment}
            accessibilityLabel="Submit comment"
            accessibilityRole="button"
            testID="reader-comment-send"
            style={[styles.commentSendBtn, { backgroundColor: social.text }]}
          >
            <Send size={16} color={social.surface} />
          </Pressable>
        </View>
        {status === "failed" ? (
          <View style={styles.failedRow} testID="reader-comments-failed">
            <Text style={[styles.commentsEmpty, { color: social.muted }]}>
              Comments could not load.
            </Text>
            <Pressable
              onPress={() => setAttempt((n) => n + 1)}
              accessibilityRole="button"
              accessibilityLabel="Retry loading comments"
              testID="reader-comments-retry"
              hitSlop={8}
              style={styles.retry}
            >
              <Text style={[styles.retryText, { color: social.text }]}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {status === "ready" && comments.length === 0 ? (
          <Text style={[styles.commentsEmpty, { color: social.muted }]} testID="reader-comments-empty">
            No comments yet. Be the first to say something.
          </Text>
        ) : null}
        {comments.map((comment) => (
          <View key={comment.id} style={styles.commentItem}>
            <View style={styles.commentAvatar}>
              <Text style={styles.commentAvatarText}>{comment.user.charAt(0)}</Text>
            </View>
            <View style={styles.commentBody}>
              <Text style={[styles.commentMeta, { color: social.muted }]}>
                <Text style={[styles.commentUser, { color: social.text }]}>{comment.user}</Text>
                {`  ${comment.time}`}
              </Text>
              <Text style={[styles.commentText, { color: social.text }]}>{comment.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    borderRadius: radius.md,
    padding: spacing.lg,
    boxShadow: shadows.card,
  },
  authorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  authorIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
  },
  pressed: { opacity: 0.7 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 20,
    letterSpacing: 0,
  },
  authorInfo: { flex: 1 },
  authorName: {
    ...type.headline,
    fontWeight: "700",
    letterSpacing: 0,
  },
  authorBio: {
    ...type.meta,
    lineHeight: 18,
    letterSpacing: 0,
  },
  followButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  followText: {
    ...type.meta,
    fontWeight: "800",
    letterSpacing: 0,
  },
  commentsCard: {
    gap: spacing.md,
  },
  commentsTitle: {
    ...type.headline,
    fontWeight: "700",
    letterSpacing: 0,
  },
  commentInputRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  commentInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...type.subhead,
    lineHeight: 20,
    letterSpacing: 0,
  },
  commentSendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  commentsEmpty: {
    ...type.subhead,
    lineHeight: 20,
    letterSpacing: 0,
  },
  failedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  retry: {
    minHeight: 44,
    justifyContent: "center",
  },
  retryText: {
    ...type.subhead,
    fontWeight: "800",
    textDecorationLine: "underline",
    letterSpacing: 0,
  },
  commentItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  commentAvatarText: {
    ...type.caption,
    fontWeight: "800",
    color: colors.surface,
    letterSpacing: 0,
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  commentMeta: {
    ...type.caption,
    letterSpacing: 0,
  },
  commentUser: {
    fontWeight: "800",
  },
  commentText: {
    ...type.subhead,
    lineHeight: 20,
    letterSpacing: 0,
  },
});

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Send } from "lucide-react-native";
import { Button } from "@/components/Button";
import { setAuthorFollow } from "@/lib/api";
import { fetchThreadPage, formatRelativeTime, postComment, type ServerComment } from "@/lib/comments";
import type { ReaderTheme } from "@/lib/reading-themes";
import type { StoryAuthor } from "@/lib/story-author";
import { colors, fonts, radius, shadows, spacing, type } from "@/theme";

/**
 * The end of a chapter's social layer: who wrote it, and what readers said.
 *
 * THIS IS THE APP, NOT THE BOOK. It used to be drawn straight onto the page --
 * same background as the prose, fenced off by hairline dividers -- so the
 * author row and the comments read as more of the chapter. Each is now a card
 * lifted off the page in the app's own colours (`ReaderTheme.social`), with
 * the elevation drawing the edge rather than a border.
 *
 * Who the author IS comes resolved (`useStoryAuthor`): a real account from its
 * public profile, a seed author only for a seed id, and "You" on your own
 * story. This component only decides what to draw from that.
 */

type Row = { id: string; user: string; text: string; time: string; createdAt: number };

type Status = "loading" | "ready" | "failed";

export type ChapterSocialProps = {
  storyId: string;
  authorId: string;
  /** The chapter a new comment is attached to. */
  chapterId: string;
  author: StoryAuthor;
  theme: ReaderTheme;
  /**
   * Opens the author's profile. Only ever called for a real account
   * (`author.canOpen`), never for "", "me" or a seed id.
   */
  onAuthor?: (authorId: string) => void;
  /** True when the tap was swallowed by the sign-in prompt. */
  requireSignIn: () => boolean;
};

const POST_FAILED = "Your comment was not posted. Check your connection and try again.";

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
}: ChapterSocialProps) {
  const social = theme.social;
  const [comments, setComments] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [postError, setPostError] = useState<string | null>(null);

  /*
    FOLLOW STARTS FROM THE SERVER, AND A TAP OUTRANKS IT. `author.isFollowing`
    arrives from the public profile after this has mounted; applying it
    unconditionally would undo a tap made in the meantime (AGENTS.md, "An async
    restore must never overwrite a choice already made").
  */
  const [isFollowing, setIsFollowing] = useState(author.isFollowing ?? false);
  const followChosenByUserRef = useRef(false);
  const followInFlight = useRef(false);
  useEffect(() => {
    followChosenByUserRef.current = false;
  }, [authorId]);
  useEffect(() => {
    if (followChosenByUserRef.current || author.isFollowing === null) return;
    setIsFollowing(author.isFollowing);
  }, [author.isFollowing]);

  /*
    Every reader's comments on this story, from the same endpoint the story
    page reads. The server filters by story and by the viewer's own block list
    only; nothing here narrows it further.

    A FAILED READ IS NOT AN EMPTY THREAD. Any failure used to render "Comments
    (0) / No comments yet" over a story that might have forty. It now says the
    comments could not load, with a retry. The number shown is the server's
    exact total, or no number at all.
  */
  useEffect(() => {
    let alive = true;
    // Another story's comments must never sit under this one while it loads.
    setComments([]);
    setTotal(null);
    setStatus("loading");
    fetchThreadPage(storyId).then(
      (page) => {
        if (!alive) return;
        const now = Date.now();
        setComments(
          newestFirst(
            page.comments.filter((comment) => !comment.deleted).map((comment) => toRow(comment, now)),
          ),
        );
        setTotal(page.total);
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
    optimistic, settled by the server's answer, rolled back on a refusal. A
    second tap while one is in flight is dropped rather than queued.
  */
  const handleToggleFollow = useCallback(() => {
    if (requireSignIn()) return;
    if (followInFlight.current) return;
    followInFlight.current = true;
    followChosenByUserRef.current = true;
    const previousOn = isFollowing;
    const nextOn = !previousOn;
    setIsFollowing(nextOn);
    setAuthorFollow(authorId, nextOn, Math.max(0, author.followers + (nextOn ? 1 : -1)))
      .then((result) => setIsFollowing(result.on))
      .catch(() => setIsFollowing(previousOn))
      .finally(() => {
        followInFlight.current = false;
      });
  }, [author.followers, authorId, isFollowing, requireSignIn]);

  const openAuthor = useCallback(() => {
    if (author.canOpen) onAuthor?.(authorId);
  }, [author.canOpen, authorId, onAuthor]);

  /*
    Posted, not just prepended. The row appears at once (keyed `local-`) and is
    replaced by the server's own row when it lands. Anything short of a real row
    coming back -- a refusal, or a reply that is not a comment -- takes the row
    back out and says so INLINE: `Alert.alert` does nothing on web, so the
    failure used to be silent there. The words go back in the box only if the
    reader has not started a new comment since.
  */
  const handleSubmitComment = useCallback(() => {
    if (requireSignIn()) return;
    const trimmed = commentText.trim();
    if (!trimmed) return;
    const localId = `local-${Date.now()}`;
    setPostError(null);
    setComments((prev) => [
      { id: localId, user: "You", text: trimmed, time: "just now", createdAt: Date.now() },
      ...prev,
    ]);
    setCommentText("");
    const fail = () => {
      setComments((prev) => prev.filter((comment) => comment.id !== localId));
      setCommentText((current) => (current.trim() ? current : trimmed));
      setPostError(POST_FAILED);
    };
    postComment(storyId, trimmed, undefined, chapterId)
      .then((posted) => {
        if (!posted) {
          fail();
          return;
        }
        const row = toRow(posted, Date.now());
        setComments((prev) => prev.map((comment) => (comment.id === localId ? row : comment)));
        setTotal((prev) => (prev === null ? null : prev + 1));
      })
      .catch(fail);
  }, [chapterId, commentText, requireSignIn, storyId]);

  const authorIdentity = (
    <>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{author.displayName.replace(/^@/, "").charAt(0).toUpperCase()}</Text>
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
        {onAuthor && author.canOpen ? (
          <Pressable
            onPress={openAuthor}
            accessibilityRole="button"
            accessibilityLabel={author.isOwn ? "View your profile" : `View ${author.displayName}'s profile`}
            testID="reader-author"
            style={({ pressed }) => [styles.authorIdentity, pressed && styles.pressed]}
          >
            {authorIdentity}
          </Pressable>
        ) : (
          <View style={styles.authorIdentity}>{authorIdentity}</View>
        )}
        {author.canFollow ? (
          <Button
            label={isFollowing ? "Following" : "Follow"}
            onPress={handleToggleFollow}
            variant={isFollowing ? "secondary" : "primary"}
            size="sm"
            fullWidth={false}
            selected={isFollowing}
            accessibilityLabel={isFollowing ? "Unfollow author" : "Follow author"}
            testID="reader-follow"
          />
        ) : null}
      </View>

      <View style={[styles.card, styles.commentsCard, { backgroundColor: social.surface }]} testID="reader-comments-card">
        <Text style={[styles.commentsTitle, { color: social.text }]}>
          {status === "ready" && total !== null ? `Comments (${total})` : "Comments"}
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
        {postError ? (
          <Text
            style={[styles.commentsEmpty, { color: social.text }]}
            accessibilityLiveRegion="polite"
            testID="reader-comment-failed"
          >
            {postError}
          </Text>
        ) : null}
        {status === "failed" ? (
          <View style={styles.failedRow} testID="reader-comments-failed">
            <Text style={[styles.commentsEmpty, styles.failedText, { color: social.muted }]}>
              Comments could not load.
            </Text>
            <Button
              label="Retry"
              onPress={() => setAttempt((n) => n + 1)}
              variant="secondary"
              size="sm"
              fullWidth={false}
              accessibilityLabel="Retry loading comments"
              testID="reader-comments-retry"
            />
          </View>
        ) : null}
        {status === "ready" && comments.length === 0 ? (
          <Text style={[styles.commentsEmpty, { color: social.muted }]} testID="reader-comments-empty">
            No comments yet. Be the first to say something.
          </Text>
        ) : null}
        {comments.map((comment) => (
          <View key={comment.id} style={styles.commentItem}>
            <View style={[styles.avatar, styles.commentAvatar]}>
              <Text style={styles.commentAvatarText}>{comment.user.charAt(0).toUpperCase()}</Text>
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
  /*
    `colors.muted` behind white initials: 5.7:1. The `tertiary` fill it
    replaces was 2.9:1, under AA for text this size.
  */
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
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
  failedText: { flex: 1 },
  commentItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  commentAvatar: {
    width: 28,
    height: 28,
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

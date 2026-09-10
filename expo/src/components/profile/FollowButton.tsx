import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Check, Plus } from "lucide-react-native";
import { setAuthorFollow } from "@/lib/api";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Follow or unfollow an author, optimistically, and put it back if it failed.
 *
 * Optimism is the right default here -- the tap should look like it worked
 * instantly, because it almost always did -- but optimism without a rollback
 * is just a lie with a delay. So the previous state is captured before the
 * request, and a rejection restores both the flag and the count to exactly what
 * they were. Not "decrement again": restore. Decrementing a counter that the
 * server also decremented is how a follower count drifts.
 *
 * Guests are stopped BEFORE the optimistic flip, not after. A button that
 * turns "Following" and then springs back when the sign-in sheet appears reads
 * as a bug and, worse, teaches the reader that the state on this screen is not
 * to be trusted.
 */
export default function FollowButton({
  authorId,
  following,
  followers,
  canEngage,
  onRequireSignIn,
  onChange,
}: {
  authorId: string;
  following: boolean;
  followers: number;
  /** False for a guest. The tap becomes a sign-in prompt instead of a write. */
  canEngage: boolean;
  onRequireSignIn?: () => void;
  onChange?: (next: { following: boolean; followers: number }) => void;
}) {
  const [on, setOn] = useState(following);
  const [count, setCount] = useState(followers);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The server is the authority whenever it speaks. A fresh fetch of the
  // profile must be able to correct this button, or a stale "Following" would
  // survive every reload.
  useEffect(() => setOn(following), [following]);
  useEffect(() => setCount(followers), [followers]);

  const press = useCallback(async () => {
    if (busy) return;
    if (!canEngage) {
      onRequireSignIn?.();
      return;
    }

    const previousOn = on;
    const previousCount = count;
    const nextOn = !previousOn;
    const nextCount = Math.max(0, previousCount + (nextOn ? 1 : -1));

    setOn(nextOn);
    setCount(nextCount);
    setBusy(true);
    onChange?.({ following: nextOn, followers: nextCount });

    try {
      const result = await setAuthorFollow(authorId, nextOn, nextCount);
      if (!mounted.current) return;
      // The server's own count wins over the guess, even on success: another
      // reader may have followed while this request was in flight.
      setOn(result.on);
      setCount(result.count);
      onChange?.({ following: result.on, followers: result.count });
    } catch {
      if (!mounted.current) return;
      setOn(previousOn);
      setCount(previousCount);
      onChange?.({ following: previousOn, followers: previousCount });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [authorId, busy, canEngage, count, on, onChange, onRequireSignIn]);

  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityState={{ selected: on, busy }}
      accessibilityLabel={on ? "Following" : "Follow"}
      testID="follow-button"
      style={({ pressed }) => [
        styles.button,
        on ? styles.following : styles.follow,
        pressed && styles.pressed,
      ]}
    >
      {on
        ? <Check size={16} color={colors.ink} />
        : <Plus size={16} color={colors.surface} />}
      <Text style={[styles.label, on && styles.labelFollowing]}>
        {on ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  follow: { backgroundColor: colors.accent },
  following: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pressed: { opacity: 0.85 },
  label: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 15,
  },
  labelFollowing: { color: colors.ink },
});

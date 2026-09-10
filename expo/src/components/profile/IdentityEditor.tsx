import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Camera, X } from "lucide-react-native";
import { colors, fonts, radius, spacing } from "@/theme";
import {
  avatarMessage,
  claimUsername,
  normalizeUsername,
  pickAndUploadAvatar,
  saveBio,
  usernameMessage,
  USERNAME_MAX_LENGTH,
  validateUsername,
} from "@/lib/profile";

/**
 * The sheet where a reader picks who they are: a picture, a handle, a line.
 *
 * The handle field is where most of the care went, because it is the one field
 * in the app that can be refused by somebody else's action. Three things follow
 * from that:
 *
 *   * The local rules are checked on every keystroke, so "you typed a space"
 *     never costs a round trip.
 *   * "Taken" can only come back from the server, and when it does the field
 *     keeps the text. Clearing it would make the reader retype a name they
 *     merely have to vary.
 *   * Saving is disabled while a claim is in flight, so a double tap cannot
 *     send two claims and leave the second one's "taken" as the last word on a
 *     handle the first one actually got.
 */
export default function IdentityEditor({
  visible,
  username,
  avatarUrl,
  bio,
  onClose,
  onSaved,
}: {
  visible: boolean;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  onClose: () => void;
  onSaved: (next: {
    username?: string;
    avatarUrl?: string;
    bio?: string | null;
  }) => void;
}) {
  const [handle, setHandle] = useState(username ?? "");
  const [bioText, setBioText] = useState(bio ?? "");
  const [avatar, setAvatar] = useState(avatarUrl);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  /** Whether this person has typed since the sheet last opened. */
  const edited = useRef(false);

  /**
   * Adopt the profile as it currently stands — on open, and again if it
   * arrives late.
   *
   * `useState(username ?? "")` runs once, when the sheet MOUNTS, and this
   * sheet mounts with the screen rather than when it is shown. Profile is
   * fetched asynchronously, so anyone who opened the editor before that
   * fetch landed got a blank handle and a blank bio over a profile that had
   * both — and saving from there would have written the blanks back.
   *
   * The `edited` guard is what keeps this from being a different bug: once
   * somebody has typed, a late-arriving prop must not reach in and overwrite
   * what they are in the middle of writing. Opening the sheet resets the
   * guard, because that is a fresh edit of whatever the profile is now.
   */
  useEffect(() => {
    if (!visible) {
      edited.current = false;
      return;
    }
    if (edited.current) return;
    setHandle(username ?? "");
    setBioText(bio ?? "");
    setAvatar(avatarUrl);
  }, [visible, username, bio, avatarUrl]);

  const editHandle = useCallback((next: string) => {
    edited.current = true;
    setHandle(next);
  }, []);
  const editBio = useCallback((next: string) => {
    edited.current = true;
    setBioText(next);
  }, []);

  const verdict = validateUsername(handle);
  const unchangedHandle = normalizeUsername(handle) === (username ?? "");
  const localMessage = handle.length === 0 && username
    ? null
    : usernameMessage(verdict);

  const chooseAvatar = useCallback(async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setNotice(null);
    const result = await pickAndUploadAvatar();
    setAvatarBusy(false);
    if (result.ok) {
      setAvatar(result.avatarUrl);
      onSaved({ avatarUrl: result.avatarUrl });
      return;
    }
    // Cancelling is not a failure and says nothing.
    const message = avatarMessage(result.reason);
    if (message) setNotice(message);
  }, [avatarBusy, onSaved]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setNotice(null);

    const changes: { username?: string; bio?: string | null } = {};

    if (!unchangedHandle && handle.trim().length > 0) {
      if (!verdict.ok) {
        setNotice(usernameMessage(verdict));
        setSaving(false);
        return;
      }
      const claimed = await claimUsername(handle);
      if (!claimed.ok) {
        setNotice(
          claimed.reason === "taken"
            ? "Someone already has that handle. Try another."
            : claimed.reason === "reserved"
            ? "That one is reserved."
            : claimed.reason === "invalid"
            ? usernameMessage(verdict) ?? "That handle cannot be used."
            : "Your handle could not be saved just now.",
        );
        setSaving(false);
        return;
      }
      changes.username = claimed.username;
    }

    if ((bio ?? "") !== bioText.trim()) {
      const stored = await saveBio(bioText);
      if (stored === undefined) {
        // The handle above may already be claimed on the server. Reporting
        // what DID land before bailing out is the difference between a
        // profile screen that shows the new handle and one that keeps
        // showing the old one while the server disagrees -- and between a
        // second attempt that re-claims a handle the reader already owns and
        // one that skips straight to the bio.
        if (changes.username !== undefined) onSaved({ ...changes });
        setNotice("Your bio could not be saved just now.");
        setSaving(false);
        return;
      }
      changes.bio = stored;
    }

    setSaving(false);
    onSaved(changes);
    onClose();
  }, [
    bio,
    bioText,
    handle,
    onClose,
    onSaved,
    saving,
    unchangedHandle,
    verdict,
  ]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Your profile</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>

          <Pressable
            onPress={chooseAvatar}
            accessibilityRole="button"
            accessibilityLabel="Change your picture"
            testID="avatar-picker"
            style={styles.avatarRow}
          >
            <View style={styles.avatarWrap}>
              {avatar
                ? (
                  <Image
                    source={{ uri: avatar }}
                    style={styles.avatar}
                    accessibilityIgnoresInvertColors
                  />
                )
                : <Camera size={22} color={colors.tertiary} />}
            </View>
            <Text style={styles.avatarLabel}>
              {avatarBusy ? "Working..." : "Change picture"}
            </Text>
          </Pressable>

          <Text style={styles.fieldLabel}>Handle</Text>
          <View style={styles.handleRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={handle}
              onChangeText={(next) => {
                setNotice(null);
                editHandle(normalizeUsername(next));
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={USERNAME_MAX_LENGTH}
              placeholder="yourname"
              placeholderTextColor={colors.tertiary}
              accessibilityLabel="Handle"
              testID="username-input"
              style={styles.input}
            />
          </View>
          {localMessage
            ? <Text style={styles.hint}>{localMessage}</Text>
            : null}

          <Text style={styles.fieldLabel}>About you</Text>
          <TextInput
            value={bioText}
            onChangeText={(next) => editBio(next.slice(0, 200))}
            multiline
            placeholder="A line about what you write."
            placeholderTextColor={colors.tertiary}
            accessibilityLabel="About you"
            testID="bio-input"
            style={[styles.input, styles.bioInput]}
          />

          {notice
            ? (
              <Text style={styles.notice} testID="identity-notice">
                {notice}
              </Text>
            )
            : null}

          <Pressable
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            accessibilityLabel="Save profile"
            testID="identity-save"
            style={({ pressed }) => [
              styles.save,
              (pressed || saving) && styles.savePressed,
            ]}
          >
            <Text style={styles.saveLabel}>
              {saving ? "Saving..." : "Save"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 14, 12, 0.45)",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.related,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 22 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  avatarRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatar: { width: "100%", height: "100%" },
  avatarLabel: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 15,
  },
  fieldLabel: {
    marginTop: spacing.md,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  at: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 16 },
  input: {
    flex: 1,
    minHeight: 46,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 16,
  },
  bioInput: {
    minHeight: 84,
    textAlignVertical: "top",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hint: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12 },
  notice: {
    fontFamily: fonts.ui,
    color: colors.premium,
    fontSize: 13,
    fontWeight: "700",
  },
  save: {
    marginTop: spacing.md,
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  savePressed: { backgroundColor: colors.accentPressed },
  saveLabel: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 16,
  },
});

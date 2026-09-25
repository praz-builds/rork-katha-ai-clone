import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Camera, X } from "lucide-react-native";
import { colors, fonts, profileHeading, radius, spacing } from "@/theme";
import { Button } from "@/components/Button";
import { CREATURES, creatureSource } from "@/lib/creatures";
import {
  avatarMessage,
  chooseCreature,
  claimUsername,
  normalizeUsername,
  pickAndUploadAvatar,
  cacheDisplayName,
  saveBio,
  saveDisplayName,
  usernameMessage,
  USERNAME_MAX_LENGTH,
  validateUsername,
} from "@/lib/profile";

/**
 * The sheet where a reader picks who they are: a creature or a picture, a
 * handle, a line.
 *
 * THE AVATAR (D5/D6). Thirty-six creatures in a grid, and one "Use a photo"
 * control that keeps the upload path. The two are exclusive on the server --
 * picking a creature clears the photo, uploading a photo clears the creature
 * -- and the sheet reports each choice the moment it lands rather than
 * waiting for Save, because the avatar is written by its own action and a
 * choice that sat unsaved behind a second button was the choice most often
 * lost.
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
export type IdentityEdits = {
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  avatarId?: string | null;
  bio?: string | null;
};

export default function IdentityEditor({
  visible,
  username,
  displayName,
  avatarUrl,
  avatarId = null,
  bio,
  onClose,
  onSaved,
}: {
  visible: boolean;
  username: string | null;
  /** What this person is called. Separate from the handle; see `saveDisplayName`. */
  displayName: string | null;
  avatarUrl: string | null;
  /** The creature, `k01`..`k36`, shown when there is no photo. */
  avatarId?: string | null;
  bio: string | null;
  onClose: () => void;
  onSaved: (next: IdentityEdits) => void;
}) {
  const [name, setName] = useState(displayName ?? "");
  const [handle, setHandle] = useState(username ?? "");
  const [bioText, setBioText] = useState(bio ?? "");
  const [avatar, setAvatar] = useState(avatarUrl);
  const [creature, setCreature] = useState(avatarId);
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
    setName(displayName ?? "");
    setHandle(username ?? "");
    setBioText(bio ?? "");
    setAvatar(avatarUrl);
    setCreature(avatarId);
  }, [visible, username, displayName, bio, avatarUrl, avatarId]);

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

  const choosePhoto = useCallback(async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setNotice(null);
    const result = await pickAndUploadAvatar();
    setAvatarBusy(false);
    if (result.ok) {
      // The server cleared the creature when it stored the photo (D6).
      setAvatar(result.avatarUrl);
      setCreature(null);
      onSaved({ avatarUrl: result.avatarUrl, avatarId: null });
      return;
    }
    // Cancelling is not a failure and says nothing.
    const message = avatarMessage(result.reason);
    if (message) setNotice(message);
  }, [avatarBusy, onSaved]);

  const pickCreature = useCallback(async (id: string) => {
    if (avatarBusy || id === creature) return;
    setAvatarBusy(true);
    setNotice(null);
    // Optimistic: the grid highlights the tap at once, and is put back on a
    // refusal, so the choice reads as made rather than as pending.
    const previous = { creature, avatar };
    setCreature(id);
    setAvatar(null);
    const result = await chooseCreature(id);
    setAvatarBusy(false);
    if (result.ok) {
      onSaved({ avatarId: result.avatarId, avatarUrl: null });
      return;
    }
    setCreature(previous.creature);
    setAvatar(previous.avatar);
    setNotice("That creature could not be saved just now. Try again in a moment.");
  }, [avatar, avatarBusy, creature, onSaved]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setNotice(null);

    const changes: {
      username?: string;
      displayName?: string | null;
      bio?: string | null;
    } = {};

    // The name first, because it is the one that cannot fail for a reason the
    // reader has to act on: there is no uniqueness to lose a race over and no
    // reserved list to fall foul of, only a length. Doing it before the handle
    // means the common edit -- somebody fixing their own name -- never has to
    // get past a handle check to land.
    if ((displayName ?? "") !== name.trim()) {
      const stored = await saveDisplayName(name);
      if (stored === undefined) {
        setNotice("Your name could not be saved just now.");
        setSaving(false);
        return;
      }
      changes.displayName = stored;
      // Kept on the device too, so Home greets them correctly on the next
      // cold start without waiting for the profile to come back.
      await cacheDisplayName(stored);
    }

    if (!unchangedHandle && handle.trim().length > 0) {
      if (!verdict.ok) {
        setNotice(usernameMessage(verdict));
        setSaving(false);
        return;
      }
      const claimed = await claimUsername(handle);
      if (!claimed.ok) {
        // The name above has already landed on the server. Reporting it before
        // bailing out is what stops the profile screen showing the old name
        // while the database holds the new one -- the same rule the bio branch
        // below already follows.
        if (changes.displayName !== undefined) onSaved({ ...changes });
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
    displayName,
    handle,
    name,
    onClose,
    onSaved,
    saving,
    unchangedHandle,
    verdict,
  ]);

  const creatureImage = creatureSource(creature);

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

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* The current avatar, and the photo path beside it. A photo wins
                over a creature (D5), so the preview shows whichever is set. */}
            <View style={styles.avatarRow}>
              <View style={styles.avatarWrap} testID="identity-avatar">
                {avatar
                  ? (
                    <Image
                      source={{ uri: avatar }}
                      style={styles.avatar}
                      accessibilityIgnoresInvertColors
                    />
                  )
                  : creatureImage
                  ? (
                    <Image
                      source={creatureImage}
                      style={styles.avatar}
                      accessibilityIgnoresInvertColors
                    />
                  )
                  : <Camera size={22} color={colors.tertiary} />}
              </View>
              <Pressable
                onPress={choosePhoto}
                disabled={avatarBusy}
                accessibilityRole="button"
                accessibilityLabel="Use a photo"
                accessibilityState={{ disabled: avatarBusy }}
                testID="avatar-picker"
                style={({ pressed }) => [
                  styles.photoButton,
                  (pressed || avatarBusy) && styles.photoButtonPressed,
                ]}
              >
                <Camera size={16} color={colors.ink} />
                <Text style={styles.photoLabel}>
                  {avatarBusy ? "Working..." : "Use a photo"}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Or pick a creature</Text>
            <View style={styles.creatureGrid} testID="creature-grid">
              {CREATURES.map((item) => {
                const selected = !avatar && item.id === creature;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => void pickCreature(item.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: avatarBusy }}
                    accessibilityLabel={item.label}
                    testID={`creature-${item.id}`}
                    style={[styles.creatureCell, selected && styles.creatureCellSelected]}
                  >
                    <Image
                      source={item.source}
                      style={styles.creatureImage}
                      accessibilityIgnoresInvertColors
                    />
                  </Pressable>
                );
              })}
            </View>

            {/* Name before handle, and they are different things: this is what
                you are called, the handle is where you are found. Home greets
                somebody by this; a byline shows the handle. */}
            <Text style={styles.fieldLabel}>Your name</Text>
            <TextInput
              value={name}
              onChangeText={(next) => {
                setNotice(null);
                // Marks the form dirty, like the handle and bio fields do. The
                // reset effect uses this to decide whether an incoming prop --
                // an avatar upload landing, say -- may overwrite the fields, and
                // without it a name being typed could be wiped mid-word.
                edited.current = true;
                setName(next.slice(0, 60));
              }}
              autoCapitalize="words"
              maxLength={60}
              placeholder="What should we call you?"
              placeholderTextColor={colors.tertiary}
              accessibilityLabel="Your name"
              testID="display-name-input"
              style={[styles.input, styles.inputBoxed]}
            />

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

            <Button
              label={saving ? "Saving..." : "Save"}
              accessibilityLabel="Save profile"
              onPress={save}
              disabled={saving}
              loading={saving}
              testID="identity-save"
              style={styles.save}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Six across: 36 creatures in six rows, each cell 44pt plus the gap. */
const CREATURE_CELL = 44;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrimStrong,
  },
  sheet: {
    maxHeight: "92%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.related,
  },
  title: { ...profileHeading, color: colors.ink, fontSize: 22 },
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
  photoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  photoButtonPressed: { opacity: 0.7 },
  photoLabel: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 14,
  },
  creatureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  creatureCell: {
    width: CREATURE_CELL,
    height: CREATURE_CELL,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: colors.surface2,
  },
  creatureCellSelected: { borderColor: colors.accent },
  creatureImage: { width: "100%", height: "100%" },
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
  inputBoxed: {
    flex: 0,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bioInput: {
    flex: 0,
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
  /** Layout only; the recipe is `Button`'s. */
  save: { marginTop: spacing.md },
});

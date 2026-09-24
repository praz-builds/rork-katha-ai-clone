import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Plus, X } from "lucide-react-native";

import * as storyApi from "@/lib/api";
import {
  listSavedCharacters,
  saveCharacterToLibrary,
  savedCharacterInputFromDraft,
} from "@/lib/saved-characters";
import {
  CharacterCraftScreen,
  emptyCharacterDraft,
  pickReferenceImage,
} from "@/components/create/CreateBriefFlow";
import { colors, fonts, radius, spacing, type } from "@/theme";
import type { CreateDraft, SavedCharacter } from "@/types/domain";

type DraftCharacter = CreateDraft["characters"][number];

export type SavedCharactersPickerProps = {
  visible: boolean;
  onSelect: (character: SavedCharacter) => void;
  onClose: () => void;
  /**
   * Overrides the library read - the brief already holds the list, and a
   * test can hand in fixtures. Defaults to `listSavedCharacters`.
   */
  loadCharacters?: () => Promise<SavedCharacter[]>;
  /**
   * The brief's *Image style* pick, so a portrait drawn from this sheet is in
   * the same look as the cover. Absent where there is no brief (the Reimagine
   * sheet), which the endpoint reads as `auto`.
   */
  imageStyle?: CreateDraft["imageStyle"];
  /** Overrides the write for the New character path. */
  saveCharacter?: (input: ReturnType<typeof savedCharacterInputFromDraft>) => Promise<SavedCharacter>;
};

/**
 * The saved-character library as a bottom sheet: tap a row to choose it.
 *
 * Opened from the Reimagine sheet's Replace buttons and, in the brief, from
 * the Saved tab's overflow. "New character" opens the same Craft character
 * screen the brief uses, and saving it writes to the library first so the
 * new person is chosen AND reusable next time.
 */
export function SavedCharactersPicker({
  visible,
  onSelect,
  onClose,
  loadCharacters = listSavedCharacters,
  saveCharacter = saveCharacterToLibrary,
  imageStyle,
}: SavedCharactersPickerProps) {
  const insets = useSafeAreaInsets();
  const [characters, setCharacters] = useState<SavedCharacter[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [craftOpen, setCraftOpen] = useState(false);
  const [buffer, setBuffer] = useState<DraftCharacter>(emptyCharacterDraft(false));
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoadFailed(false);
    loadCharacters().then(
      (list) => {
        if (!cancelled) setCharacters(list);
      },
      () => {
        if (!cancelled) {
          setCharacters([]);
          setLoadFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [visible, loadCharacters]);

  const openCraft = useCallback(() => {
    setBuffer(emptyCharacterDraft(false));
    setUnsavedPromptOpen(false);
    setCraftOpen(true);
  }, []);

  const closeCraft = useCallback(() => {
    setUnsavedPromptOpen(false);
    setCraftOpen(false);
  }, []);

  const requestCloseCraft = useCallback(() => {
    const dirty = Boolean(
      buffer.name.trim() || buffer.background?.trim() ||
        buffer.appearance.trim() || buffer.portraitUrl ||
        buffer.referenceImage,
    );
    if (dirty) {
      setUnsavedPromptOpen(true);
      return;
    }
    closeCraft();
  }, [buffer, closeCraft]);

  /**
   * Why the last image attempt was refused, in the server's own words.
   *
   * Same reasoning as the brief's copy of this sheet: "you are out of credits",
   * "you have made a lot of these just now" and "the provider could not draw
   * it" were one silent empty card, and only the server knows which it was.
   */
  const [portraitNotice, setPortraitNotice] = useState<string | null>(null);

  const createImage = useCallback(async () => {
    const name = buffer.name.trim();
    if (!name || buffer.portraitStatus === "generating") return;
    setPortraitNotice(null);
    setBuffer((previous) => ({ ...previous, portraitStatus: "generating" }));
    try {
      const { url } = await storyApi.generateCharacterImage({
        requestId: storyApi.createGenerationRequestId(),
        name,
        appearance: buffer.appearance,
        referenceImage: buffer.referenceImage,
        imageStyle,
      });
      setBuffer((previous) => ({ ...previous, portraitUrl: url, portraitStatus: "ready" }));
    } catch (error) {
      setPortraitNotice(
        error instanceof Error && error.message
          ? error.message
          : "Could not create the character image. Please try again.",
      );
      setBuffer((previous) => ({ ...previous, portraitStatus: "failed" }));
    }
  }, [buffer, imageStyle]);

  const pickReference = useCallback(async () => {
    const picked = await pickReferenceImage();
    if (picked) {
      setBuffer((previous) => ({
        ...previous,
        referenceImage: picked.dataUrl,
        referenceImageName: picked.fileName,
      }));
    }
  }, []);

  const saveNew = useCallback(async () => {
    if (!buffer.name.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await saveCharacter(savedCharacterInputFromDraft(buffer));
      setCharacters((previous) => [saved, ...(previous ?? []).filter((item) => item.id !== saved.id)]);
      closeCraft();
      onSelect(saved);
    } catch (error) {
      Alert.alert(
        "Couldn't save this character",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [buffer, closeCraft, onSelect, saveCharacter, saving]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Saved characters</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close saved characters"
              hitSlop={8}
              style={styles.closeButton}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>

          <Pressable
            onPress={openCraft}
            accessibilityRole="button"
            accessibilityLabel="New character"
            style={styles.newRow}
          >
            <View style={styles.newIcon}>
              <Plus size={20} color={colors.accent} />
            </View>
            <Text style={styles.newLabel}>New character</Text>
          </Pressable>

          {characters === null ? (
            <View style={styles.centered} accessibilityLabel="Loading saved characters">
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : characters.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No saved characters yet</Text>
              <Text style={styles.emptyBody}>
                {loadFailed
                  ? "We couldn't load your saved characters. You can still create a new one."
                  : "Characters you create in a story are saved here automatically."}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {characters.map((character) => (
                <Pressable
                  key={character.id}
                  onPress={() => onSelect(character)}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${character.name}`}
                  style={styles.row}
                >
                  <Portrait name={character.name} uri={character.portraitUrl} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowName}>{character.name}</Text>
                    {character.appearance ? (
                      <Text numberOfLines={1} style={styles.rowDetail}>{character.appearance}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      <Modal animationType="slide" presentationStyle="fullScreen" visible={craftOpen} onRequestClose={requestCloseCraft}>
        <CharacterCraftScreen
          character={buffer}
          onChange={setBuffer}
          onBack={requestCloseCraft}
          onSave={saveNew}
          onCreateImage={createImage}
          portraitNotice={portraitNotice}
          onPickReference={pickReference}
          onClearReference={() => setBuffer((previous) => ({ ...previous, referenceImage: undefined, referenceImageName: undefined }))}
          unsavedPromptOpen={unsavedPromptOpen}
          onKeepEditing={() => setUnsavedPromptOpen(false)}
          onDiscard={closeCraft}
          topInset={insets.top}
          bottomInset={insets.bottom}
        />
      </Modal>
    </Modal>
  );
}

export function Portrait({ name, uri, size = 48 }: { name: string; uri?: string; size?: number }) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        resizeMode="cover"
        style={[styles.portrait, dimension]}
        accessible
        accessibilityLabel={`Portrait of ${name}`}
      />
    );
  }
  return (
    <View style={[styles.portrait, styles.portraitFallback, dimension]}>
      <Text style={[styles.portraitInitial, { fontSize: Math.round(size * 0.42) }]}>
        {name.trim().slice(0, 1).toUpperCase() || "?"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.scrim,
  },
  sheet: {
    maxHeight: "80%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  newRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  newIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  newLabel: {
    ...type.headline,
    color: colors.accent,
  },
  centered: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    paddingVertical: spacing.xxl,
    gap: spacing.xs,
    alignItems: "center",
  },
  emptyTitle: {
    ...type.headline,
    color: colors.ink,
  },
  emptyBody: {
    ...type.subhead,
    color: colors.muted,
    textAlign: "center",
  },
  list: {
    flexGrow: 0,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    ...type.headline,
    color: colors.ink,
  },
  rowDetail: {
    ...type.subhead,
    color: colors.muted,
  },
  portrait: {
    overflow: "hidden",
  },
  portraitFallback: {
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  portraitInitial: {
    color: colors.accent,
    fontFamily: fonts.display,
  },
});

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UserPlus } from "lucide-react-native";

import * as storyApi from "@/lib/api";
import {
  deleteSavedCharacter,
  draftCharacterFromSaved,
  listSavedCharacters,
  nameKey,
  saveCharacterToLibrary,
  savedCharacterInputFromDraft,
  type SavedCharacterInput,
} from "@/lib/saved-characters";
import {
  CharacterCraftScreen,
  emptyCharacterDraft,
  pickReferenceImage,
} from "@/components/create/CreateBriefFlow";
import { Portrait } from "@/components/create/SavedCharactersPicker";
import { colors, radius, spacing, type } from "@/theme";
import type { CreateDraft, SavedCharacter } from "@/types/domain";

type DraftCharacter = CreateDraft["characters"][number];

/** Alert.alert is a no-op on react-native-web, so the browser's own alert stands in. */
function notify(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof globalThis.alert === "function") globalThis.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export type CharactersTabProps = {
  /** Overrides the library read so a test can hand in fixtures. */
  loadCharacters?: () => Promise<SavedCharacter[]>;
  /** Overrides the write behind Save character. */
  saveCharacter?: (input: SavedCharacterInput) => Promise<SavedCharacter>;
  /** Overrides the delete behind Delete character. */
  deleteCharacter?: (id: string) => Promise<void>;
};

/**
 * Library › Characters: the people this writer has saved, and the door to
 * make another.
 *
 * The same library the brief's Saved tab and the Reimagine sheet read
 * (`lib/saved-characters`), reached without starting a story. Tapping a row
 * opens the brief's own Craft character screen on that person; the icon-only
 * UserPlus in the header opens it empty. Both save through
 * `saveCharacterToLibrary`, so a character made here is in the next brief's
 * Saved tab with nothing else to wire.
 */
export default function CharactersTab({
  loadCharacters = listSavedCharacters,
  saveCharacter = saveCharacterToLibrary,
  deleteCharacter = deleteSavedCharacter,
}: CharactersTabProps) {
  const insets = useSafeAreaInsets();
  const [characters, setCharacters] = useState<SavedCharacter[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [craftOpen, setCraftOpen] = useState(false);
  const [buffer, setBuffer] = useState<DraftCharacter>(emptyCharacterDraft(false));
  /** The library row being edited; null while crafting a new character. */
  const [editing, setEditing] = useState<SavedCharacter | null>(null);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [portraitNotice, setPortraitNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, [loadCharacters]);

  const openNew = useCallback(() => {
    setEditing(null);
    setBuffer(emptyCharacterDraft(false));
    setPortraitNotice(null);
    setUnsavedPromptOpen(false);
    setCraftOpen(true);
  }, []);

  const openExisting = useCallback((character: SavedCharacter) => {
    setEditing(character);
    setBuffer(draftCharacterFromSaved(character, false));
    setPortraitNotice(null);
    setUnsavedPromptOpen(false);
    setCraftOpen(true);
  }, []);

  const closeCraft = useCallback(() => {
    setUnsavedPromptOpen(false);
    setCraftOpen(false);
    setEditing(null);
  }, []);

  const requestCloseCraft = useCallback(() => {
    const dirty = editing
      ? buffer.name.trim() !== editing.name
        || (buffer.background ?? "").trim() !== (editing.background ?? "")
        || buffer.appearance.trim() !== (editing.appearance ?? "")
        || (buffer.portraitUrl ?? "") !== (editing.portraitUrl ?? "")
        || Boolean(buffer.referenceImage)
      : Boolean(
        buffer.name.trim() || buffer.background?.trim()
          || buffer.appearance.trim() || buffer.portraitUrl
          || buffer.referenceImage,
      );
    if (dirty) {
      setUnsavedPromptOpen(true);
      return;
    }
    closeCraft();
  }, [buffer, closeCraft, editing]);

  const createImage = useCallback(async () => {
    const name = buffer.name.trim();
    if (!name || buffer.portraitStatus === "generating") return;
    setPortraitNotice(null);
    setBuffer((previous) => ({ ...previous, portraitStatus: "generating" }));
    const appearance = buffer.appearance;
    const referenceImage = buffer.referenceImage;
    try {
      const { url } = await storyApi.generateCharacterImage({
        requestId: storyApi.createGenerationRequestId(),
        name,
        appearance,
        referenceImage,
      });
      // The picture was drawn from the name, appearance and reference photo as
      // they stood when it was asked for. If any of them changed while it was
      // being drawn, it no longer shows this character: drop it and let the
      // writer ask again rather than save a portrait of somebody else.
      setBuffer((previous) => {
        const stale = previous.name.trim() !== name
          || previous.appearance !== appearance
          || previous.referenceImage !== referenceImage;
        return stale
          ? { ...previous, portraitStatus: previous.portraitUrl ? "ready" : "idle" }
          : { ...previous, portraitUrl: url, portraitStatus: "ready" };
      });
    } catch (error) {
      setPortraitNotice(
        error instanceof Error && error.message
          ? error.message
          : "Could not create the character image. Please try again.",
      );
      setBuffer((previous) => ({ ...previous, portraitStatus: "failed" }));
    }
  }, [buffer]);

  const pickReference = useCallback(async () => {
    const referenceImage = await pickReferenceImage();
    if (referenceImage) setBuffer((previous) => ({ ...previous, referenceImage }));
  }, []);

  const save = useCallback(async () => {
    if (!buffer.name.trim() || saving) return;
    /*
      The library upserts by name, so saving under a name another character
      already has would overwrite that character's description and then, on a
      rename, delete the one being edited. Refuse instead of merging two people.
    */
    const key = nameKey(buffer.name);
    const clash = (characters ?? []).find(
      (item) => nameKey(item.name) === key && item.id !== editing?.id,
    );
    if (clash) {
      notify(
        "That name is taken",
        `You already have a character called ${clash.name}. Give this one a different name.`,
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await saveCharacter(savedCharacterInputFromDraft(buffer));
      /*
        The library keys a character by name, so renaming one while editing
        saves under the new name as a different row. The old row goes, or the
        writer would find the person they just renamed still listed under the
        name they changed.
      */
      const renamedFrom = editing && editing.id !== saved.id ? editing.id : null;
      // If the old row cannot be deleted it stays listed, so the list matches
      // what the next load will show rather than hiding it until then.
      const oldRowGone = renamedFrom
        ? await deleteCharacter(renamedFrom).then(() => true, () => false)
        : false;
      setCharacters((previous) => {
        const list = previous ?? [];
        const dropped = oldRowGone ? renamedFrom : null;
        // An edit keeps its place; only a new character goes to the top.
        const at = editing ? list.findIndex((item) => item.id === editing.id) : -1;
        const rest = list.filter((item) => item.id !== saved.id && item.id !== dropped);
        if (at < 0 || (renamedFrom && !oldRowGone)) return [saved, ...rest];
        return [...rest.slice(0, at), saved, ...rest.slice(at)];
      });
      closeCraft();
    } catch (error) {
      notify(
        "Couldn't save this character",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [buffer, characters, closeCraft, deleteCharacter, editing, saveCharacter, saving]);

  const remove = useCallback(() => {
    const target = editing;
    if (!target) return;
    const run = async () => {
      try {
        await deleteCharacter(target.id);
        setCharacters((previous) => (previous ?? []).filter((item) => item.id !== target.id));
        closeCraft();
      } catch (error) {
        notify(
          "Couldn't delete this character",
          error instanceof Error ? error.message : "Please try again.",
        );
      }
    };
    const question = `Delete ${target.name}? Stories already written with them keep them.`;
    // react-native-web's Alert is a no-op, so a confirm with buttons would
    // never resolve there; the browser's own confirm is the web equivalent.
    if (Platform.OS === "web") {
      // No confirm, no delete: a missing dialog must never mean yes.
      if (typeof globalThis.confirm === "function" && globalThis.confirm(question)) void run();
      return;
    }
    Alert.alert("Delete character", question, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run() },
    ]);
  }, [closeCraft, deleteCharacter, editing]);

  const createButton = (
    <Pressable
      onPress={openNew}
      accessibilityRole="button"
      accessibilityLabel="Create new character"
      hitSlop={8}
      testID="characters-create"
      style={styles.createButton}
    >
      <UserPlus size={20} color={colors.accent} />
    </Pressable>
  );

  return (
    <View testID="library-characters" style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Your characters</Text>
        {createButton}
      </View>

      {characters === null ? (
        <View style={styles.centered} accessibilityLabel="Loading your characters">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : characters.length === 0 ? (
        <Text style={styles.emptyBody} testID="characters-empty">
          {loadFailed
            ? "We couldn't load your characters. You can still create a new one."
            : "No characters yet. Make one here, or keep one from any story you write."}
        </Text>
      ) : (
        <View>
          {characters.map((character) => (
            <Pressable
              key={character.id}
              onPress={() => openExisting(character)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${character.name}`}
              testID={`character-row-${character.id}`}
              style={styles.row}
            >
              <Portrait name={character.name} uri={character.portraitUrl} size={56} />
              <View style={styles.rowCopy}>
                <Text style={styles.rowName}>{character.name}</Text>
                {character.appearance || character.background ? (
                  <Text numberOfLines={2} style={styles.rowDetail}>
                    {character.appearance || character.background}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={craftOpen}
        onRequestClose={requestCloseCraft}
      >
        <CharacterCraftScreen
          character={buffer}
          onChange={setBuffer}
          onBack={requestCloseCraft}
          onSave={save}
          onDelete={editing ? remove : undefined}
          onCreateImage={createImage}
          portraitNotice={portraitNotice}
          onPickReference={pickReference}
          onClearReference={() => setBuffer((previous) => ({ ...previous, referenceImage: undefined }))}
          unsavedPromptOpen={unsavedPromptOpen}
          onKeepEditing={() => setUnsavedPromptOpen(false)}
          onDiscard={closeCraft}
          topInset={insets.top}
          bottomInset={insets.bottom}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heading: { ...type.headline, color: colors.ink },
  createButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  centered: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBody: {
    ...type.subhead,
    color: colors.muted,
  },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowName: { ...type.headline, color: colors.ink },
  rowDetail: { ...type.subhead, color: colors.muted },
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type CreationLanguage,
  type CreateDraft,
  normalizeCreationLanguage,
} from "@/types/domain";

const DRAFT_KEY = "katha:create:draft";
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type PersistedDraft = CreateDraft & {
  language: CreationLanguage;
  isSeries: boolean;
  visibility: "private" | "public";
  savedAt: number;
};

export async function saveDraft(
  draft: Omit<PersistedDraft, "savedAt">,
): Promise<void> {
  try {
    const payload: PersistedDraft = { ...draft, savedAt: Date.now() };
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Silent fail — draft persistence is best-effort
  }
}

export async function loadDraft(): Promise<
  Omit<PersistedDraft, "savedAt"> | null
> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: PersistedDraft = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.primaryGenre !== "string" ||
      typeof parsed.seed !== "string" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > STALE_MS) {
      await AsyncStorage.removeItem(DRAFT_KEY);
      return null;
    }
    const { savedAt: _, ...draft } = parsed;
    // Spanish remains readable on existing stories but is no longer a creation
    // choice. A locally cached legacy draft opens in English rather than
    // creating an invalid request.
    const characters = Array.isArray(draft.characters) ? draft.characters : [];
    const leadIndex = characters.findIndex((character) => character?.isHero === true);
    return {
      ...draft,
      characters: characters.map((character, index) => ({
        ...character,
        isHero: index === (leadIndex >= 0 ? leadIndex : 0),
      })),
      language: normalizeCreationLanguage(draft.language),
      isSeries: draft.isSeries !== false,
      visibility: draft.visibility === "public" ? "public" : "private",
    };
  } catch {
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DRAFT_KEY);
  } catch {
    // Silent fail
  }
}

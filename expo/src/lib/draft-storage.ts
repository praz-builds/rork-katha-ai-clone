import AsyncStorage from "@react-native-async-storage/async-storage";

const DRAFT_KEY = "katha:create:draft";
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PersistedDraft {
  primaryGenre: string;
  audienceMode: string;
  spiceLevel: string;
  identityLenses: string[];
  tropeModules: string[];
  seed: string;
  language: string;
  characters: { name: string; description: string; isHero: boolean }[];
  savedAt: number;
}

export async function saveDraft(draft: Omit<PersistedDraft, "savedAt">): Promise<void> {
  try {
    const payload: PersistedDraft = { ...draft, savedAt: Date.now() };
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Silent fail — draft persistence is best-effort
  }
}

export async function loadDraft(): Promise<Omit<PersistedDraft, "savedAt"> | null> {
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
    return draft;
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

import { stories } from "@/data/seed";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { CreateDraft, Genre, Story } from "@/types/domain";

export type LibraryResult = {
  stories: Story[];
  source: "mock" | "supabase";
};

export class GenerationRequestError extends Error {
  constructor(message: string, readonly resetRequestId: boolean) {
    super(message);
    this.name = "GenerationRequestError";
  }
}

export async function getLibrary(query?: { q?: string; genre?: string }): Promise<LibraryResult> {
  if (!isSupabaseConfigured) {
    return { stories: filterLocalStories(query), source: "mock" };
  }

  const params = new URLSearchParams({ page: "1", limit: "20" });
  if (query?.q) params.set("q", query.q);
  if (query?.genre) params.set("genre", query.genre);

  const { data, error } = await supabase.functions.invoke(`library?${params.toString()}`, {
    method: "GET"
  });

  if (error || !data?.stories) {
    return { stories: filterLocalStories(query), source: "mock" };
  }

  return { stories: filterLocalStories(query), source: "supabase" };
}

export async function generateStory(draft: CreateDraft, requestId: string): Promise<Story> {
  if (!isSupabaseConfigured) {
    return localGeneratedStory(draft);
  }

  const { data, error } = await supabase.functions.invoke("generate-story", {
    body: {
      request_id: requestId,
      genre: draft.genre,
      topic: draft.seed,
      characters: draft.characters
    }
  });

  if (error) {
    const failure = await edgeFunctionFailure(error, data);
    throw new GenerationRequestError(failure.message, failure.resetRequestId);
  }
  if (!data?.story) throw new Error("Story generation returned no story");

  return mapGeneratedStory(data, draft);
}

async function edgeFunctionFailure(error: unknown, data: unknown) {
  const dataFailure = objectFailure(data);
  if (dataFailure) return dataFailure;

  const context = error && typeof error === "object"
    ? (error as { context?: { json?: () => Promise<unknown> } }).context
    : undefined;
  if (typeof context?.json === "function") {
    try {
      const responseFailure = objectFailure(await context.json());
      if (responseFailure) return responseFailure;
    } catch {
      // Fall through to the SDK error message when the response is not JSON.
    }
  }
  return {
    message: error instanceof Error ? error.message : "Story generation failed",
    resetRequestId: false
  };
}

function objectFailure(value: unknown): { message: string; resetRequestId: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const message = payload.error;
  if (typeof message !== "string" || !message.trim()) return null;
  return {
    message,
    resetRequestId:
      payload.status === "refunded" ||
      (typeof payload.operation_id === "string" && /refunded|start a new request/i.test(message))
  };
}

function mapGeneratedStory(data: unknown, draft: CreateDraft): Story {
  if (!data || typeof data !== "object") {
    throw new Error("Story generation returned an invalid response");
  }
  const payload = data as Record<string, unknown>;
  const story = asRecord(payload.story);
  const chapter = asRecord(payload.chapter);
  const id = requiredString(story.id, "story id");
  const chapterId = requiredString(chapter.id, "chapter id");
  const content = requiredString(chapter.content, "chapter content");
  const serverGenres = Array.isArray(story.genre) ? story.genre : [];
  const genre = isGenre(serverGenres[0]) ? serverGenres[0] : draft.genre;
  const themes = Array.isArray(story.themes)
    ? story.themes.filter((value): value is string => typeof value === "string")
    : [];

  return {
    id,
    title: requiredString(story.title, "story title"),
    authorId: requiredString(story.author_id, "story author"),
    genre,
    synopsis: typeof story.topic === "string" && story.topic.trim()
      ? story.topic.trim()
      : content.replace(/\s+/g, " ").slice(0, 180),
    chapters: [{
      id: chapterId,
      storyId: id,
      title: typeof chapter.title === "string" && chapter.title.trim()
        ? chapter.title
        : "Chapter one",
      paragraphs: content.split(/\n\s*\n/).filter(Boolean),
      chapterNumber: typeof chapter.chapter_number === "number"
        ? chapter.chapter_number
        : 1,
      isPublished: chapter.is_published === true,
      audioUrl: typeof chapter.audio_url === "string"
        ? chapter.audio_url
        : undefined
    }],
    likes: numberOrZero(story.like_count),
    bookmarks: numberOrZero(story.bookmark_count),
    views: numberOrZero(story.read_count),
    tags: themes.length ? themes : ["new", "draft"],
    publishedOffset: 0,
    isFeatured: story.is_curated === true,
    language: typeof story.language === "string" ? story.language : draft.language
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Story generation returned an invalid response");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Story generation returned no ${field}`);
  }
  return value;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isGenre(value: unknown): value is Genre {
  return typeof value === "string" && [
    "adventure", "comedy", "contemporary", "drama", "fantasy", "historical",
    "horror", "kids", "lgbtq", "motivational", "mystery", "mythology",
    "poetry", "romance", "scifi", "sliceOfLife", "spirituality", "thriller"
  ].includes(value);
}

function filterLocalStories(query?: { q?: string; genre?: string }) {
  const normalized = query?.q?.trim().toLowerCase();
  return stories.filter((story) => {
    const matchesGenre = !query?.genre || story.genre === query.genre;
    const matchesQuery =
      !normalized ||
      story.title.toLowerCase().includes(normalized) ||
      story.synopsis.toLowerCase().includes(normalized) ||
      story.tags.some((tag) => tag.toLowerCase().includes(normalized));
    return matchesGenre && matchesQuery;
  });
}

function localGeneratedStory(draft: CreateDraft): Story {
  const hero = draft.characters.find((character) => character.isHero) ?? draft.characters[0];
  const title = draft.seed.length > 4 ? titleFromSeed(draft.seed) : `The ${hero?.name ?? "Hidden"} Story`;
  return {
    id: `generated-${Date.now()}`,
    title,
    authorId: "me",
    genre: draft.genre,
    synopsis: `A fresh ${draft.genre} story shaped from your seed: ${draft.seed || "a quiet beginning"}.`,
    likes: 0,
    bookmarks: 0,
    views: 0,
    tags: ["new", draft.language.toLowerCase(), "draft"],
    publishedOffset: 0,
    isFeatured: false,
    language: draft.language,
    coverImage: "moonlit-train-platform.jpg",
    chapters: [
      {
        id: `chapter-${Date.now()}`,
        storyId: "generated",
        title: "Chapter one",
        chapterNumber: 1,
        isPublished: false,
        paragraphs: [
          `${hero?.name ?? "Someone"} noticed the world had changed before anyone else did. It was not a loud change. It arrived as a small detail, a misplaced sound, a door left open where no door had been the night before.`,
          `The seed was simple: ${draft.seed || "begin again"}. But Katha turned it over like a warm stone, finding the hidden shape inside it. Soon the first choice appeared, and with it the feeling that this story had been waiting for you.`,
          "You can keep this draft, revise it, or continue it into a series when the backend generation pipeline is fully enabled."
        ]
      }
    ]
  };
}

function titleFromSeed(seed: string) {
  return seed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function createGenerationRequestId() {
  return `generation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

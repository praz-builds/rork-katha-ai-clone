import { stories } from "@/data/seed";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { CreateDraft, Story } from "@/types/domain";

export type LibraryResult = {
  stories: Story[];
  source: "mock" | "supabase";
};

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

export async function generateStory(draft: CreateDraft): Promise<Story> {
  if (!isSupabaseConfigured) {
    return localGeneratedStory(draft);
  }

  const { data, error } = await supabase.functions.invoke("generate-story", {
    body: {
      genre: draft.genre,
      topic: draft.seed,
      characters: draft.characters,
      lengthType: "short"
    }
  });

  if (error || !data?.story) {
    return localGeneratedStory(draft);
  }

  return localGeneratedStory(draft);
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

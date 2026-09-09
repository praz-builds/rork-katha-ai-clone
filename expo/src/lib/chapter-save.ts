/**
 * Saving a whole chapter by hand.
 *
 * The reader's Edit control is a notepad now: one text field holding the whole
 * chapter, plus its title. Nothing in the client had a call shaped like that.
 * `edit-story` rewrites ONE PARAGRAPH with a model and returns the rewrite; it
 * has no idea what "here is the chapter, keep it" means. `publish-story` does
 * persist whole chapter bodies - that is how the old Create-studio editor saved
 * hand edits - but it knows nothing about chapter titles.
 *
 * So this module asks for the call the notepad actually needs, and degrades to
 * the one that exists:
 *
 * 1. `edit-story` with `{ story_id, chapter_number, chapter_body, chapter_title }`.
 *    This is the shape the design handoff specifies and the shape a backend
 *    agent is adding. Today's deployed function refuses it (it requires
 *    `paragraph_index`), so this is expected to fail until that lands.
 * 2. `publish-story` with `{ chapters: [{ id, content }] }` and the story's
 *    CURRENT visibility restated. This is the path that works right now. It
 *    saves the prose and cannot save the title.
 *
 * The result says which happened, so the caller can keep an edited title on
 * screen (the reader holds hand edits in memory anyway) without claiming the
 * server has it.
 *
 * Once the backend's full-text path is deployed, step 2 is dead code and should
 * be deleted along with this comment.
 */

import { publishStory } from "@/lib/api";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type SaveChapterInput = {
  storyId: string;
  chapterId: string;
  chapterNumber: number;
  /** The whole chapter, paragraphs separated by a blank line. */
  body: string;
  /** The chapter's title as the writer left it. Empty for a standalone. */
  title?: string;
  /** Whether the story is public, so the save restates it rather than guessing. */
  isPublished: boolean;
};

export type SaveChapterResult = {
  /** False when the fallback ran and the title was not persisted. */
  titleSaved: boolean;
};

export async function saveChapter(
  input: SaveChapterInput,
): Promise<SaveChapterResult> {
  const { storyId, chapterId, chapterNumber, body, title, isPublished } = input;

  if (!isSupabaseConfigured) {
    // No backend to save to. The reader keeps the edit in memory, which is the
    // same thing every other write does in this configuration.
    return { titleSaved: true };
  }

  try {
    const { error } = await supabase.functions.invoke("edit-story", {
      body: {
        story_id: storyId,
        chapter_id: chapterId,
        chapter_number: chapterNumber,
        chapter_body: body,
        ...(title ? { chapter_title: title } : {}),
      },
    });
    if (!error) return { titleSaved: true };
  } catch {
    // Fall through to the path that exists.
  }

  // The fallback. A failure here is a real failure and is thrown: the writer
  // has unsaved words on screen and must be told, not reassured.
  await publishStory(storyId, {
    chapters: [{ id: chapterId, content: body }],
    visibility: isPublished ? "public" : "private",
  });
  return { titleSaved: false };
}

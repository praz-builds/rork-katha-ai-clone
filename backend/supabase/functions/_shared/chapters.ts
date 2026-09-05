/**
 * Chapter writes that have to survive a concurrent editor.
 *
 * The AI editing path reads a chapter, spends seconds in an LLM call, then
 * writes the whole chapter back. Two overlapping paragraph edits therefore race
 * over the same document and the slower write wins outright, silently
 * discarding the faster one's paragraph. The predicate below turns that into a
 * detectable conflict instead.
 */

/** The narrow slice of the Supabase client this helper needs, so it can be stubbed in tests. */
export interface ChapterUpdateFilter {
  eq(column: string, value: unknown): ChapterUpdateFilter;
  select(columns: string): PromiseLike<
    { data: unknown[] | null; error: unknown }
  >;
}

export interface ChapterUpdateClient {
  from(table: string): {
    update(values: Record<string, unknown>): ChapterUpdateFilter;
  };
}

/**
 * Replace a chapter's content only if it still holds `previousContent`.
 *
 * Matching on the content the caller actually read is compare-and-swap without
 * a version column: it needs no schema change, and it cannot report success on
 * a row somebody else has already rewritten. Returns whether the write landed
 * so the caller can answer 409 rather than pretend the edit was applied.
 */
export async function updateChapterContentIfUnchanged(
  client: ChapterUpdateClient,
  params: {
    chapterId: string;
    previousContent: string;
    nextContent: string;
    wordCount: number;
  },
): Promise<{ updated: boolean }> {
  const { data, error } = await client
    .from("chapters")
    .update({ content: params.nextContent, word_count: params.wordCount })
    .eq("id", params.chapterId)
    .eq("content", params.previousContent)
    .select("id");

  if (error) throw error;
  return { updated: Array.isArray(data) && data.length > 0 };
}

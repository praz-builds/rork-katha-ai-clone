import {
  EMPTY_SERIES_STATE,
  HOOK_TYPES,
  type HookType,
  type SeriesState,
  type StoryGenerationOutput,
} from "./types.ts";

export function parseGeneratedStoryText(
  text: string,
  fallbackTitle: string,
): { title: string; content: string } {
  const lines = text.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim());
  if (titleIndex === -1) return { title: fallbackTitle, content: "" };

  const title = lines[titleIndex].replace(/^#\s*/, "").trim() || fallbackTitle;
  return {
    title,
    content: lines.slice(titleIndex + 1).join("\n").trim(),
  };
}

/**
 * Parse structured JSON output from the LLM.
 *
 * Tries JSON.parse first (handles optional markdown code fences).
 * On any failure, falls back to parseGeneratedStoryText and wraps
 * the result in the StoryGenerationOutput interface.
 */
export function parseStructuredOutput(
  text: string,
  fallbackTitle: string,
): StoryGenerationOutput {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, cleaned.lastIndexOf("```"));
    }
    cleaned = cleaned.trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (
      parsed && typeof parsed === "object" &&
      typeof parsed.chapter_body === "string"
    ) {
      return {
        title: typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : fallbackTitle,
        chapter_title: typeof parsed.chapter_title === "string"
          ? parsed.chapter_title.trim()
          : "Chapter 1",
        chapter_body: parsed.chapter_body,
        word_count: typeof parsed.word_count === "number"
          ? parsed.word_count
          : parsed.chapter_body.split(/\s+/).length,
        themes: Array.isArray(parsed.themes)
          ? parsed.themes.filter((t: unknown): t is string =>
            typeof t === "string"
          )
          : [],
        first_line: typeof parsed.first_line === "string"
          ? parsed.first_line.trim()
          : parsed.chapter_body.split(/\n/)[0]?.trim() ?? "",
        previously_summary: typeof parsed.previously_summary === "string"
          ? parsed.previously_summary.trim()
          : "",
        series_state: parseSeriesState(parsed.series_state),
        hook_type: parseHookType(parsed.hook_type),
        hook_text: typeof parsed.hook_text === "string"
          ? parsed.hook_text.trim().slice(0, 500)
          : "",
      };
    }
  } catch {
    // Fall through to text-based fallback
  }

  // Fallback: use the old text-based parser
  const { title, content } = parseGeneratedStoryText(text, fallbackTitle);
  return {
    title,
    chapter_title: "Chapter 1",
    chapter_body: content,
    word_count: content.split(/\s+/).length,
    themes: [],
    first_line: content.split(/\n/)[0]?.trim() ?? "",
    previously_summary: "",
    series_state: EMPTY_SERIES_STATE,
    hook_type: "none",
    hook_text: "",
  };
}

function parseHookType(value: unknown): HookType {
  if (typeof value === "string" && HOOK_TYPES.has(value)) {
    return value as HookType;
  }
  return "none";
}

/**
 * Normalize an arbitrary value into a `SeriesState`.
 *
 * This is the single normalization contract for series continuity. Both initial
 * generation (model output) and continuation (state read back from the database)
 * must use it so a stored state is never truncated or filtered differently
 * between the two paths.
 */
export function parseSeriesState(value: unknown): SeriesState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_SERIES_STATE;
  }
  const state = value as Record<string, unknown>;
  return {
    central_conflict: stringField(state.central_conflict, 1000),
    protagonist_want: stringField(state.protagonist_want, 500),
    relationship_state: stringField(state.relationship_state, 1000),
    open_hooks: stringList(state.open_hooks, 12, 500),
    resolved_hooks: stringList(state.resolved_hooks, 12, 500),
    promised_payoffs: stringList(state.promised_payoffs, 12, 500),
    world_facts: stringList(state.world_facts, 16, 500),
    character_changes: stringList(state.character_changes, 16, 500),
    next_chapter_pressure: stringField(state.next_chapter_pressure, 1000),
  };
}

/** True when the state carries no continuity information worth persisting. */
export function isEmptySeriesState(state: SeriesState | null | undefined): boolean {
  if (!state) return true;
  return !state.central_conflict &&
    !state.protagonist_want &&
    !state.relationship_state &&
    !state.next_chapter_pressure &&
    state.open_hooks.length === 0 &&
    state.resolved_hooks.length === 0 &&
    state.promised_payoffs.length === 0 &&
    state.world_facts.length === 0 &&
    state.character_changes.length === 0;
}

/**
 * Merge a freshly generated state over the stored one, field by field.
 *
 * An all-or-nothing fallback loses data when the model returns a partial state:
 * a finale that fills `resolved_hooks` but leaves `central_conflict` blank is
 * not "empty", so it would overwrite the stored conflict with "". Preferring the
 * new value per field, and keeping the stored one wherever the model left a
 * blank, keeps continuity intact without discarding real updates.
 */
export function mergeSeriesState(
  prior: SeriesState,
  next: SeriesState,
): SeriesState {
  const text = (a: string, b: string) => a.trim() ? a : b;
  const list = (a: string[], b: string[]) => a.length ? a : b;
  return {
    central_conflict: text(next.central_conflict, prior.central_conflict),
    protagonist_want: text(next.protagonist_want, prior.protagonist_want),
    relationship_state: text(next.relationship_state, prior.relationship_state),
    open_hooks: list(next.open_hooks, prior.open_hooks),
    resolved_hooks: list(next.resolved_hooks, prior.resolved_hooks),
    promised_payoffs: list(next.promised_payoffs, prior.promised_payoffs),
    world_facts: list(next.world_facts, prior.world_facts),
    character_changes: list(next.character_changes, prior.character_changes),
    // Pressure is intentionally NOT carried over: a finale clears it on
    // purpose, and a stale pressure is worse than none.
    next_chapter_pressure: next.next_chapter_pressure,
  };
}

function stringField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

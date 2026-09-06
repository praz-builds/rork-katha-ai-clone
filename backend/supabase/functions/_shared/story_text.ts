import {
  EMPTY_SERIES_STATE,
  HOOK_TYPES,
  type HookType,
  MAX_MOMENTS,
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
        raw_series_state: parsed.series_state,
        structured: true,
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
    raw_series_state: undefined,
    // The structured parse failed and this came from the plain-text fallback,
    // so hook_type and series_state below are placeholders, not model output.
    structured: false,
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
    delivered_moments: stringList(state.delivered_moments, 8, 300),
  };
}

/** True when the state carries no continuity information worth persisting. */
export function isEmptySeriesState(
  state: SeriesState | null | undefined,
): boolean {
  if (!state) return true;
  return !state.central_conflict &&
    !state.protagonist_want &&
    !state.relationship_state &&
    !state.next_chapter_pressure &&
    state.open_hooks.length === 0 &&
    state.resolved_hooks.length === 0 &&
    state.promised_payoffs.length === 0 &&
    state.world_facts.length === 0 &&
    state.character_changes.length === 0 &&
    state.delivered_moments.length === 0;
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
  /**
   * Keys the model actually supplied. Without this an omitted list and a
   * deliberately emptied one look identical, so a finale that clears
   * `open_hooks` would silently keep the stale hooks.
   */
  provided?: ReadonlySet<string>,
  /**
   * The moments the request supplied, if any.
   *
   * `delivered_moments` is the one field where the model is asked to echo user
   * text back rather than write its own, so it is the one field where a
   * hallucinated entry would silently become stored state that every later
   * chapter reads. Passing the supplied list turns the merge into an allowlist:
   * an entry that does not match a supplied moment is dropped. Omitting the
   * list keeps the prior set unchanged, because there is nothing to match
   * against and accepting unverified text would be worse than accepting none.
   */
  suppliedMoments?: readonly string[],
): SeriesState {
  const sent = (key: string) => !provided || provided.has(key);
  const text = (key: string, a: string, b: string) =>
    sent(key) && a.trim() ? a : (a.trim() ? a : b);

  /** Live state: an explicit value replaces, an omitted one keeps the old. */
  const replace = (key: string, a: string[], b: string[]) => sent(key) ? a : b;

  /** History: entries accumulate across chapters and are never dropped. */
  const accumulate = (key: string, a: string[], b: string[]) =>
    sent(key) ? [...new Set([...b, ...a])] : b;

  return {
    central_conflict: text(
      "central_conflict",
      next.central_conflict,
      prior.central_conflict,
    ),
    protagonist_want: text(
      "protagonist_want",
      next.protagonist_want,
      prior.protagonist_want,
    ),
    relationship_state: text(
      "relationship_state",
      next.relationship_state,
      prior.relationship_state,
    ),
    // Open hooks are the live set: a finale that resolves everything must be
    // able to empty them.
    open_hooks: replace("open_hooks", next.open_hooks, prior.open_hooks),
    promised_payoffs: replace(
      "promised_payoffs",
      next.promised_payoffs,
      prior.promised_payoffs,
    ),
    // These only ever grow: losing an earlier world fact or character change
    // would erase established continuity.
    resolved_hooks: accumulate(
      "resolved_hooks",
      next.resolved_hooks,
      prior.resolved_hooks,
    ),
    world_facts: accumulate("world_facts", next.world_facts, prior.world_facts),
    character_changes: accumulate(
      "character_changes",
      next.character_changes,
      prior.character_changes,
    ),
    // Pressure is intentionally NOT carried over: a finale clears it on
    // purpose, and a stale pressure is worse than none.
    next_chapter_pressure: next.next_chapter_pressure,
    // Append-only, and never `replace`. A moment that landed in chapter 2 is a
    // fact about the story; a chapter 5 response that omits it, empties it, or
    // fails to parse cannot unmake it, or the model would be re-handed a
    // moment it has already written.
    delivered_moments: mergeDeliveredMoments(
      prior.delivered_moments,
      next.delivered_moments,
      suppliedMoments,
    ),
  };
}

/**
 * Union the moments a chapter reports delivering into the stored set.
 *
 * Order is preserved - earliest delivery first - because the prompt lists them
 * back to the model as what has already landed, and a stable order makes that
 * block stable across chapters.
 */
function mergeDeliveredMoments(
  prior: readonly string[],
  next: readonly string[],
  suppliedMoments?: readonly string[],
): string[] {
  const allowed = suppliedMoments
    ? new Set(suppliedMoments.map((moment) => moment.trim()).filter(Boolean))
    : undefined;
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...prior, ...next]) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || seen.has(trimmed)) continue;
    // The prior set was written by an earlier run of this same allowlist, so it
    // is trusted; only the model's new claims are checked against the brief.
    if (!prior.includes(value) && allowed && !allowed.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged.slice(0, MAX_MOMENTS);
}

/**
 * Drop any delivered moment the brief never contained.
 *
 * Chapter 1 has no prior state to merge against, so its `delivered_moments`
 * reaches the database exactly as the model wrote it. `delivered_moments` is
 * the one series_state field where the model is asked to echo user text rather
 * than compose its own, which makes an invented entry indistinguishable from a
 * real one to every later chapter that reads the state back. Verifying against
 * the supplied brief is what keeps that channel from being writable.
 */
export function verifyDeliveredMoments(
  state: SeriesState,
  suppliedMoments: readonly string[],
): SeriesState {
  const allowed = new Set(
    suppliedMoments
      .filter((moment): moment is string => typeof moment === "string")
      .map((moment) => moment.trim())
      .filter(Boolean),
  );
  return {
    ...state,
    delivered_moments: state.delivered_moments.filter((moment) =>
      allowed.has(moment.trim())
    ),
  };
}

/** Keys the model supplied in its `series_state`, for merge intent. */
export function providedSeriesStateKeys(raw: unknown): ReadonlySet<string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();
  return new Set(Object.keys(raw as Record<string, unknown>));
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

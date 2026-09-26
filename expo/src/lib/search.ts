/**
 * Explore's search, and the one place a story catalogue query is written.
 *
 * There is no `search` edge function, and adding one would have put a second
 * copy of the feed's visibility rules behind a deploy. So this queries
 * PostgREST directly and mirrors, clause for clause, what
 * `backend/supabase/functions/feed/index.ts` allows a reader to see:
 *
 *   - `status = 'complete'`            — a half-written row is not a result
 *   - `is_public OR is_curated`        — the same disjunction the feed uses,
 *                                        and the same one RLS enforces on
 *                                        `stories` (migration 00002), so the
 *                                        database refuses anything this
 *                                        clause forgot
 *   - `content_rating <> 'explicit'`   — explicit work is never surfaced by
 *                                        browse; it is reachable only from a
 *                                        direct link
 *   - `author_id NOT IN (blocked)`     — the caller's own block list, filtered
 *                                        inside the query rather than after
 *                                        the fetch, so a blocked author cannot
 *                                        silently eat a slot in the page
 *
 * A row the `feed` function would hide is therefore a row this cannot return.
 *
 * FALLING BACK RATHER THAN GOING BLANK. Supabase is not configured in tests,
 * in a bare checkout, or on a device with no network, and a discovery surface
 * that answers an honest question with an empty page is worse than one that
 * answers from what it has. Every failure path filters the local catalogue
 * instead and says so through `source`, so the caller can tell "nothing
 * matched" from "nothing was reachable".
 */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  parseDirectionChooser,
  parseDirectionChosen,
  parseOfferedDirections,
} from "@/lib/chapter-directions";
import { authorFor, stories as seedStories } from "@/data/seed";
import { GENRES } from "@/types/domain";
import type { Genre, Story } from "@/types/domain";

/** How many rows one search asks for. A browse page, not a data export. */
export const SEARCH_PAGE_SIZE = 24;

/**
 * The genre query may include an old row whose `genre` array merely CONTAINS
 * the selected genre. We settle that row on the array's first value before it
 * can become a card, so fetch a bounded extra page before that defensive
 * filter. Explore has no pagination; returning a short page because those
 * false legacy matches consumed its only 24 slots would be worse than the
 * small, fixed metadata read. The result is always clipped back to 24.
 */
export const GENRE_SEARCH_FETCH_SIZE = SEARCH_PAGE_SIZE * 2;

/**
 * How long the field waits after the last keystroke.
 *
 * 220ms is under the ~250ms a reader reads as "instant" and above a fast
 * typist's inter-key gap (~120ms), so a five-letter word costs one request
 * instead of five.
 */
export const SEARCH_DEBOUNCE_MS = 220;

/**
 * Below this, a term matches most of the catalogue and teaches the reader
 * nothing. One letter is not a search; it is the reader still deciding.
 */
export const MIN_QUERY_LENGTH = 2;

/** The longest term that will be sent. Past this it is not a title. */
const MAX_QUERY_LENGTH = 80;

/** How many author handles one term is allowed to resolve to. */
const MAX_AUTHOR_MATCHES = 20;

const STORY_COLUMNS =
  "id, title, author_id, genre, primary_genre, topic, cover_image_url, cover_status, " +
  "content_rating, audience_mode, spice_level, language, story_mode, is_curated, " +
  "is_public, like_count, bookmark_count, read_count, created_at, themes";

/** How many of a story's themes become Explore tags, and how long one may be. */
const MAX_TAGS = 6;
const MAX_TAG_LENGTH = 32;

/**
 * A row's `themes` as Explore tags: trimmed, lower-cased, de-duplicated and
 * capped. The generator writes 3-6 free-form themes per story; a malformed or
 * missing array is no tags, never an error.
 */
export function themeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tag.length > MAX_TAG_LENGTH) continue;
    seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

const GENRE_SET: ReadonlySet<string> = new Set(GENRES);

/**
 * Every primary-genre value the backend can currently persist, mapped to the
 * client label a reader can actually filter by. `cozyFantasy` and
 * `paranormalRomance` are deliberately here even though they are server-only:
 * old stories retain those values and must not render as one genre then vanish
 * when that visible genre is selected. Keep this list in lockstep with the
 * backend's `PrimaryGenre`, not just the picker list.
 */
export const DISPLAY_GENRE_BY_RUNTIME_GENRE: Readonly<Record<string, Genre>> = {
  romance: "romance",
  romantasy: "romantasy",
  darkRomance: "darkRomance",
  cozyFantasy: "fantasy",
  paranormalRomance: "romance",
  fantasy: "fantasy",
  scifi: "scifi",
  thriller: "thriller",
  mystery: "mystery",
  horror: "horror",
  contemporary: "contemporary",
  historical: "historical",
  adventure: "adventure",
  comedy: "comedy",
  poetry: "poetry",
  educational: "educational",
  fanfiction: "fanfiction",
  folktale: "folktale",
  sliceOfLife: "sliceOfLife",
};

function displayGenreForRuntimeGenre(value: unknown): Genre | null {
  return typeof value === "string"
    ? DISPLAY_GENRE_BY_RUNTIME_GENRE[value] ?? null
    : null;
}

function runtimeGenresForDisplayGenre(genre: Genre): string[] {
  const mapped = Object.entries(DISPLAY_GENRE_BY_RUNTIME_GENRE)
    .filter(([, display]) => display === genre)
    .map(([runtime]) => runtime);
  // Keep the ordinary stored value first. It makes the wire clause easy to
  // audit while still including server-only values that share its display.
  return [genre, ...mapped.filter((runtime) => runtime !== genre)];
}

export type SearchInput = {
  /** What the reader typed. May be empty — that is the default browse. */
  text: string;
  /** The selected genre, or null for every genre. */
  genre: Genre | null;
};

export type SearchOutcome = {
  stories: Story[];
  /**
   * Where the rows came from. `local` means the live catalogue could not be
   * reached (or is not configured) and these are the bundled stories — the
   * caller may want to say so rather than present them as the whole library.
   */
  source: "supabase" | "local";
};

/**
 * Strips every character that is STRUCTURAL to a PostgREST filter.
 *
 * `or=(title.ilike.%x%,topic.ilike.%x%)` is parsed by splitting on commas and
 * matching parentheses, and `ilike` treats `%` and `_` as wildcards. A term
 * containing any of those does not merely fail to match — it re-shapes the
 * filter the server parses, which is how a search box becomes a way to read
 * rows the clause was written to exclude. Dropping the characters (rather
 * than escaping them) is deliberate: none of them are things a reader
 * meaningfully searches a story catalogue for, and a rule with no escape
 * hatch cannot be got around by escaping the escape.
 *
 * Exported because the safeguard is the point, and a safeguard nothing can
 * test is a comment.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()%_*\\"'.:{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/** Whether `value` is a genre this app knows how to render. */
export function isKnownGenre(value: unknown): value is Genre {
  return typeof value === "string" && GENRE_SET.has(value);
}

/**
 * Whether this input asks a question at all.
 *
 * An empty text box with no genre is not "no results" — it is the default
 * browse, and it still runs a query (the catalogue, most-loved first). What
 * this rules out is the one-character term.
 */
export function hasUsableTerm(text: string): boolean {
  return sanitizeSearchTerm(text).length >= MIN_QUERY_LENGTH;
}

/**
 * The local catalogue, filtered by the same fields the remote query matches:
 * title, summary, tags, and the author's display name.
 *
 * This is both the offline fallback and the only path the screen tests take,
 * so it is written to agree with the remote clause rather than to be
 * convenient — a fallback that filters differently from the thing it stands
 * in for is a second, undocumented product.
 */
export function searchLocalCatalogue(
  input: SearchInput,
  catalogue: readonly Story[] = seedStories,
): Story[] {
  const term = sanitizeSearchTerm(input.text).toLowerCase();
  return catalogue.filter((story) => {
    if (input.genre && story.genre !== input.genre) return false;
    if (!term) return true;
    return (
      story.title.toLowerCase().includes(term) ||
      story.synopsis.toLowerCase().includes(term) ||
      story.tags.join(" ").toLowerCase().includes(term) ||
      authorFor(story.authorId).displayName.toLowerCase().includes(term)
    );
  });
}

/**
 * One search.
 *
 * Cancellation is the caller's: pass the `signal` of an `AbortController` the
 * caller aborts when a newer keystroke arrives. An aborted request rejects,
 * and this returns the local fallback for it — which the caller discards
 * anyway, because it is holding a newer sequence number.
 */
export async function searchStories(
  input: SearchInput,
  options: { signal?: AbortSignal; catalogue?: readonly Story[] } = {},
): Promise<SearchOutcome> {
  const catalogue = options.catalogue ?? seedStories;
  const local = (): SearchOutcome => ({
    stories: searchLocalCatalogue(input, catalogue),
    source: "local",
  });

  if (!isSupabaseConfigured) return local();

  const term = sanitizeSearchTerm(input.text);
  const genre = isKnownGenre(input.genre) ? input.genre : null;

  try {
    // Author handles resolve first, because a handle lives on `profiles` and
    // a story carries only an `author_id`. One extra indexed lookup, capped,
    // whose result becomes an `author_id.in.(...)` arm of the same `or` as
    // title and summary — so "search by author" is one query with the rest,
    // not a second result list stapled on.
    const authorIds = term.length >= MIN_QUERY_LENGTH
      ? await matchingAuthorIds(term, options.signal)
      : [];

    // A block list that did not load fails the search CLOSED. See
    // `blockedAuthorIds` for why this is the one lookup that is not best
    // effort.
    const blocked = await blockedAuthorIds(options.signal);
    if (!blocked.ok) return local();

    let query = supabase
      .from("stories")
      .select(STORY_COLUMNS)
      .eq("status", "complete")
      .or("is_public.eq.true,is_curated.eq.true")
      .neq("content_rating", "explicit");

    if (blocked.ids.length > 0) {
      query = query.not("author_id", "in", `(${blocked.ids.join(",")})`);
    }

    if (term.length >= MIN_QUERY_LENGTH) {
      const clauses = [`title.ilike.*${term}*`, `topic.ilike.*${term}*`];
      if (authorIds.length > 0) {
        clauses.push(`author_id.in.(${authorIds.join(",")})`);
      }
      query = query.or(clauses.join(","));
    }

    if (genre) {
      // Two columns carry a genre: `primary_genre` (one value, the modern
      // one) and the legacy `genre` text[]. A story published before
      // `primary_genre` existed only has the array, so it is still matched --
      // but ONLY when `primary_genre` is empty. The array also lists a
      // story's secondary genres ({mystery, adventure}), so matching it
      // unconditionally put mysteries, fantasies and sci-fi under Adventure,
      // each card labelled with its real genre.
      query = query.or(genreClause(genre));
    }

    query = query
      .order("like_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(genre ? GENRE_SEARCH_FETCH_SIZE : SEARCH_PAGE_SIZE);

    if (options.signal) query = query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error || !Array.isArray(data)) return local();

    const stories = data
      .map((row) => mapSearchRow(row))
      .filter((story): story is Story => story !== null);
    const visible = genre
      ? stories.filter((story) => story.genre === genre).slice(0, SEARCH_PAGE_SIZE)
      : stories;
    return {
      // The card shows the genre `mapSearchRow` settled on, so that is the
      // one the filter answers to. A legacy row whose array leads with some
      // other genre matched the clause above and would render as that genre.
      stories: visible,
      source: "supabase",
    };
  } catch {
    return local();
  }
}

/**
 * The PostgREST `or` clause for one genre: the story's primary genre, or --
 * for a row that predates `primary_genre` -- the legacy array. Exported so the
 * clause is asserted as written; see the comment at its call site.
 */
export function genreClause(genre: Genre): string {
  const runtimeGenres = runtimeGenresForDisplayGenre(genre);
  const primary = runtimeGenres.length === 1
    ? `primary_genre.eq.${runtimeGenres[0]}`
    : `primary_genre.in.(${runtimeGenres.join(",")})`;
  const legacy = runtimeGenres.map((runtimeGenre) =>
    `and(primary_genre.is.null,genre.cs.{${runtimeGenre}})`
  );
  return [primary, ...legacy].join(",");
}

/** Author ids whose handle contains `term`. Empty on any failure. */
async function matchingAuthorIds(
  term: string,
  signal?: AbortSignal,
): Promise<string[]> {
  let query = supabase
    .from("profiles")
    .select("id")
    .ilike("username", `*${term}*`)
    .limit(MAX_AUTHOR_MATCHES);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data
    .map((row) => (row as Record<string, unknown>).id)
    .filter((id): id is string => typeof id === "string");
}

/**
 * Authors the caller has blocked.
 *
 * Almost always empty. `user_blocks` is keyed `(blocker_id, blocked_id)` and
 * readable by its own blocker (migration 00043), so this is one indexed
 * lookup.
 *
 * A LOOKUP THAT FAILED IS NOT AN EMPTY BLOCK LIST, and this is the one place
 * in the file where that distinction is load-bearing. An earlier version
 * returned `[]` on failure and reasoned that a stale search beats a broken
 * one. That trade is wrong for a block specifically: a block is a promise to
 * one person that they will not have to see another one again, and the
 * failure mode of getting it wrong is showing them exactly the author they
 * asked to be rid of — quietly, with no sign anything went wrong, in the
 * surface they browse most. A degraded search is recoverable; that is not.
 *
 * So `ok: false` propagates and `searchStories` falls back to the bundled
 * catalogue, which is seed fiction with no real authors in it and therefore
 * cannot contain anyone's blocked writer. "Not signed in" and "no rows" are
 * genuinely empty lists and stay `ok: true`.
 */
async function blockedAuthorIds(
  signal?: AbortSignal,
): Promise<{ ok: true; ids: string[] } | { ok: false; ids: string[] }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    // No session is an answer, not a failure: somebody who is not signed in
    // has no block list to fail to load. Treating `getUser`'s missing-session
    // error as a failure would fail-close every signed-out search, which is
    // the opposite of the point.
    if (!userId) return { ok: true, ids: [] };
    let query = supabase
      .from("user_blocks")
      .select("blocked_id")
      .eq("blocker_id", userId);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return { ok: false, ids: [] };
    return {
      ok: true,
      ids: data
        .map((row) => (row as Record<string, unknown>).blocked_id)
        .filter((id): id is string => typeof id === "string"),
    };
  } catch {
    return { ok: false, ids: [] };
  }
}

/**
 * One `stories` row as a `Story` the feed card can render.
 *
 * Deliberately WITHOUT chapters. A search page is twenty-four cards, and
 * every chapter body is a few thousand words; fetching them to render a
 * cover and a title would make the fast surface the expensive one. The
 * chapters are fetched for the one story the reader actually opens — see
 * `loadStoryChapters`.
 */
export function mapSearchRow(row: unknown): Story | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const title = typeof record.title === "string" ? record.title : null;
  if (!id || !title) return null;

  const legacy = Array.isArray(record.genre) ? record.genre : [];
  const genre = displayGenreForRuntimeGenre(record.primary_genre) ??
    displayGenreForRuntimeGenre(legacy[0]) ??
    // Rows with no genre at all predate the catalogue contract. They retain
    // the historic Adventure fallback. A row carrying an unknown genre is
    // deliberately dropped instead: calling it Adventure would make the card
    // lie and make it unqueryable under every exact genre clause.
    (record.primary_genre == null && legacy.length === 0 ? "adventure" : null);
  if (!genre) return null;

  return {
    id,
    title,
    authorId: typeof record.author_id === "string" ? record.author_id : "",
    genre,
    primaryGenre: genre,
    storyMode: record.story_mode === "series" ? "series" : "standalone",
    audienceMode: record.audience_mode === "kids" ? "kids" : "adult",
    spiceLevel: record.spice_level === "steamy" ? "steamy" : "sweet",
    contentRating: typeof record.content_rating === "string"
      ? record.content_rating
      : undefined,
    synopsis: typeof record.topic === "string" ? record.topic.trim() : "",
    chapters: [],
    likes: countOf(record.like_count),
    bookmarks: countOf(record.bookmark_count),
    views: countOf(record.read_count),
    // The generator's themes. These were `[]`, so on live results Explore's
    // tag filter had nothing to offer and the panel's tag section never drew.
    tags: themeTags(record.themes),
    publishedOffset: publishedOffsetFrom(record.created_at),
    isFeatured: record.is_curated === true,
    isPublic: record.is_public === true,
    language: typeof record.language === "string" ? record.language : "English",
    coverImageUrl: typeof record.cover_image_url === "string"
      ? record.cover_image_url
      : undefined,
  };
}

/**
 * The chapters of one story, fetched when the reader opens it.
 *
 * This is the other half of the "cards are cheap" decision above: the list
 * pays for metadata only, and the full text is bought once, for the single
 * story someone chose.
 *
 * WHY THIS REPORTS `ok` RATHER THAN JUST HANDING BACK THE STORY. It used to
 * return the metadata-only story on failure, on the reasoning that an empty
 * page is better than a tap that does nothing. It is not: the caller
 * navigates on whatever comes back, so a failed fetch put the reader inside a
 * story with a title, a cover, and no words — no error, no retry, and no way
 * to tell a network blip from a story that has not been written yet. A tap
 * that says "we could not open this, try again" is the honest version, and
 * that needs the caller to be able to tell the two apart.
 *
 * `ok: true` with zero chapters is a real answer for a story that genuinely
 * has none published; only a transport or query failure is `ok: false`.
 */
export async function loadStoryChapters(
  story: Story,
): Promise<{ ok: boolean; story: Story }> {
  if (!isSupabaseConfigured || story.chapters.length > 0) {
    return { ok: true, story };
  }
  try {
    const { data, error } = await supabase
      .from("chapters")
      // One string literal, not a concatenation: supabase-js infers the row
      // type from the select text at compile time, and a `+` join defeats
      // that inference and degrades the rows to `GenericStringError`.
      .select(
        "id, story_id, chapter_number, title, content, first_line, previously_summary, is_published, directions_offered, direction_chosen, direction_chosen_by",
      )
      .eq("story_id", story.id)
      .eq("is_published", true)
      .order("chapter_number", { ascending: true });
    if (error || !Array.isArray(data)) return { ok: false, story };
    // No published chapters is not a failure. It is a story nobody can read
    // yet, and the reader is told that rather than told to retry forever.
    if (data.length === 0) return { ok: true, story };

    const chapters = data.map((row, index) => {
      const c = row as Record<string, unknown>;
      const content = typeof c.content === "string" ? c.content : "";
      return {
        id: typeof c.id === "string" ? c.id : `${story.id}-chapter-${index}`,
        storyId: story.id,
        title: typeof c.title === "string" && c.title.trim()
          ? c.title
          : "Chapter one",
        paragraphs: content.split(/\n\s*\n/).filter(Boolean),
        chapterNumber: typeof c.chapter_number === "number"
          ? c.chapter_number
          : index + 1,
        chapterRole: "standalone" as const,
        firstLine: typeof c.first_line === "string" ? c.first_line : undefined,
        previouslySummary: typeof c.previously_summary === "string"
          ? c.previously_summary
          : undefined,
        isPublished: true,
        // The paths the story was offered, and the one it took. THIS is the
        // path that matters for the feature: `hydrateForOpen` sends every
        // story opened from Explore, search or a curated rail through here,
        // which is to say somebody ELSE's story -- the only kind whose
        // branching a reader is ever curious about. `fetchMyStories` reads
        // the same columns in `api.ts`; parsing is shared with it rather
        // than restated, so the two paths cannot drift into disagreeing
        // about what a malformed offer means.
        directionsOffered: parseOfferedDirections(c.directions_offered),
        directionChosen: parseDirectionChosen(c.direction_chosen),
        directionChosenBy: parseDirectionChooser(c.direction_chosen_by),
      };
    });

    return { ok: true, story: { ...story, chapters } };
  } catch {
    return { ok: false, story };
  }
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * `created_at` as the whole-days-ago number the rest of the app sorts and
 * dates by.
 *
 * `publishedOffset` is days-before-now (see `types/domain`), which is how the
 * seed catalogue expresses age and what Explore's Newest sort subtracts.
 * Every live row used to arrive as `0`, and the consequences were two:
 * Newest could not tell any two results apart, so it left them in the
 * server's like-count order and silently behaved as a second Most-loved; and
 * Story detail dated every searched story to today.
 *
 * Floor rather than round, so "posted four hours ago" is 0 days old rather
 * than being sorted as if it were published tomorrow. A missing or
 * unparseable timestamp is 0 — the previous behaviour, for the rows that
 * genuinely have nothing to order by.
 */
export function publishedOffsetFrom(
  value: unknown,
  now: number = Date.now(),
): number {
  if (typeof value !== "string") return 0;
  const created = Date.parse(value);
  if (!Number.isFinite(created)) return 0;
  const days = Math.floor((now - created) / 86_400_000);
  return days > 0 ? days : 0;
}

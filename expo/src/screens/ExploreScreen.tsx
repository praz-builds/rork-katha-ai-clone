import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronDown, SlidersHorizontal } from "lucide-react-native";
import { TAB_BAR_CLEARANCE } from "@/components/BottomTabs";
import { dailyFeedSeed, seededShuffle, spreadByKey } from "@/lib/feed-shuffle";
import { getViewerId } from "@/lib/ownership";
import { Chip } from "@/components/KathaPrimitives";
import { StoryFeedCard } from "@/components/feed/StoryFeedCard";
import {
  BEDTIME_CATEGORY,
  BEDTIME_CATEGORY_SHORT_LABEL,
  GenreStrip,
  genreChipLabel,
  type ExploreCategory,
} from "@/components/explore/GenreStrip";
import { SearchField } from "@/components/explore/SearchField";
import {
  useStorySearch,
  type UseStorySearchOptions,
} from "@/components/explore/useStorySearch";
import { hasUsableTerm } from "@/lib/search";
import { useBlockedAuthorIds, withoutBlockedAuthors } from "@/lib/blocks";
import {
  colors,
  fonts,
  genreLabels,
  radius,
  shadows,
  spacing,
  type,
  useLayoutWidth,
} from "@/theme";
import { UI_GENRES } from "@/types/domain";
import type { Genre, Story } from "@/types/domain";

/** How the results are ordered once they arrive. */
type SortOption = "trending" | "loved" | "newest";

/** The rest state. The eyebrow and the filter badge key off leaving it. */
const DEFAULT_SORT: SortOption = "trending";

/** What the eyebrow calls each order. The chips below use the same words. */
const SORT_LABELS: Record<SortOption, string> = {
  trending: "Trending",
  loved: "Most loved",
  newest: "Newest",
};

/**
 * The caption above the results when nothing is typed.
 *
 * With no genre it names the order, because the order is the only thing
 * shaping the list. It used to say "Most loved" while the list was sorted by
 * reads, which is a caption describing a different list.
 *
 * With a genre chosen the genre IS the answer to "what am I looking at", and
 * the default order is not news: "Adventure · Trending" reads as a second
 * filter that was never applied. The order is named only once the reader has
 * picked one themselves.
 */
export function exploreScopeLabel(
  genre: Genre | null,
  category: ExploreCategory | null,
  sort: SortOption,
): string {
  const filters = [
    category ? BEDTIME_CATEGORY_SHORT_LABEL : null,
    genre ? genreLabels[genre] : null,
  ].filter((value): value is string => value !== null);
  if (filters.length === 0) return SORT_LABELS[sort];
  return sort === DEFAULT_SORT
    ? filters.join(" · ")
    : `${filters.join(" · ")} · ${SORT_LABELS[sort]}`;
}

/** A row this dense stops discriminating past a dozen or so choices. */
const MAX_VISIBLE_TAGS = 12;

/** Genres offered as a way out of a search that found nothing. */
const SUGGESTED_GENRES: readonly Genre[] = ["fantasy", "mystery", "romance"];

/**
 * Explore — the discovery surface Home is not.
 *
 * Home is curated, finite and personal: a handful of named rails built from
 * what the reader already chose. Explore is the opposite, and the split is
 * the product decision the owner asked for: **search lives here and only
 * here**, because two search boxes teach a reader that the two screens do the
 * same thing, and a curated home page with a search bar on it is really just
 * a search page with some rails above it.
 *
 * FOUR THINGS MAKE UP THIS SCREEN, in the order a reader meets them:
 *
 * 1. **A search field** that queries the live catalogue — title, summary and
 *    author handle — debounced, cancellable, and race-guarded. See
 *    `components/explore/useStorySearch.ts` for why all three are needed and
 *    why the third is not implied by the first two.
 * 2. **Bedtime stories**, a legacy editorial category. It never expands to
 *    all-ages, which is a different reader promise.
 * 3. **Every genre, as one horizontal strip**, in the create brief's own chip
 *    language. Selecting one filters; selecting it again clears it.
 * 4. **The results**, as `StoryFeedCard`s — the same card Home's rails use,
 *    so a story looks like itself wherever the reader meets it.
 *
 * THE DEFAULT STATE IS NOT BLANK. With nothing typed and no filter chosen,
 * this runs the same query with no filters: the page the server picks by
 * `like_count`, shown in the default Trending order (most read first). That is
 * the right default for a discovery page for a reason worth stating: a reader
 * who opens Explore without a question has not failed to use it, and the
 * honest answer to "show me anything" is the work other readers came back to.
 * The eyebrow names that order rather than the server's. It also means the screen
 * has ONE data path instead of a browse mode and a search mode that can
 * disagree with each other, and it means the genre strip and the sort control
 * do something on first paint rather than waiting for a query.
 *
 * WHERE THE ROWS COME FROM. `useStorySearch` returns `source`, which is
 * `local` whenever the live catalogue could not be reached — no Supabase
 * configuration, no network, a failed request. The bundled catalogue is
 * filtered instead so the page still answers, and the eyebrow says so rather
 * than presenting a handful of seed stories as the whole library.
 *
 * THE HEADER-IN-A-LIST TRAP. Search, the genre strip and the filter panel all
 * live in `ListHeaderComponent` so the whole screen scrolls as one surface.
 * The one way this goes wrong is re-creating the header's REACT COMPONENT
 * TYPE on every render: React treats a changed type as a different component,
 * unmounts the old subtree, and the `TextInput` loses focus mid-keystroke.
 * `ExploreListHeader` is therefore declared at module scope below, as a plain
 * controlled component — its type never changes across renders, only its
 * props do.
 */
export default function ExploreScreen({
  stories,
  onStory,
  onOpenStory,
  searchOptions,
}: {
  /** The bundled catalogue. Also what the offline fallback filters. */
  stories: Story[];
  onStory: (id: string) => void;
  /**
   * Opens a story that is NOT in `stories` — a live result the app has never
   * seen. Search returns metadata only (see `mapSearchRow`), so the caller
   * owns fetching its chapters and putting it somewhere the reader can be
   * navigated to. Without this, a live result would be tapped into a story id
   * nothing can resolve.
   */
  onOpenStory?: (story: Story) => void;
  /** Test seam, forwarded to `useStorySearch`. */
  searchOptions?: UseStorySearchOptions;
}) {
  // The list is the one surface here that has to answer to the window: on a
  // tablet or a desktop browser a full-width row stretches the card until the
  // cover and the stats sit at opposite ends of the eye's travel. `content`
  // caps the column and the gutters are added back so it keeps its margins.
  // Nothing else on this screen changes shape — see `useLayoutWidth`.
  const { content, gutter, band } = useLayoutWidth();

  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<Genre | null>(null);
  const [category, setCategory] = useState<ExploreCategory | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<SortOption>(DEFAULT_SORT);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const {
    status,
    stories: searched,
    pageStarts,
    source,
    hasMore,
    loadingMore,
    loadMore,
  } = useStorySearch(
    { text: query, genre, bedtime: category === BEDTIME_CATEGORY },
    { catalogue: stories, ...searchOptions },
  );
  // The query itself leaves blocked writers out (`search.ts`), but a page
  // fetched before a block would keep showing them until the next keystroke.
  const blocked = useBlockedAuthorIds();
  /**
   * The pages as they arrived, each with blocked writers removed.
   *
   * Sliced BEFORE filtering, not after: `pageStarts` indexes the list the hook
   * returned, and removing a row from page 0 would shift every later boundary
   * by one and slice the wrong rows out of every page after it.
   */
  const pages = useMemo(() => {
    const out: Story[][] = [];
    for (let i = 0; i < pageStarts.length; i += 1) {
      const start = pageStarts[i];
      const end = i + 1 < pageStarts.length ? pageStarts[i + 1] : searched.length;
      if (end > start) {
        out.push(withoutBlockedAuthors(searched.slice(start, end), blocked));
      }
    }
    return out;
  }, [searched, pageStarts, blocked]);
  const results = useMemo(() => pages.flat(), [pages]);

  // Tags are a property of whatever came BACK, not a fixed list this screen
  // knows ahead of time - so the panel always offers choices that narrow the
  // current results rather than emptying them. Live rows carry the story's
  // generated themes (`themeTags` in lib/search.ts); a page with none still
  // hides the panel's tag section rather than drawing an empty one.
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of results) {
      for (const tag of story.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_VISIBLE_TAGS)
      .map(([tag]) => tag);
  }, [results]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag]
    );
  }, []);

  // "Trending" with no tags is the screen's rest state; the badge and the
  // Clear affordance both key off drifting away from it. Search and genre
  // have their own always-visible resets (the clear button, tapping the
  // selected chip) so they are not double-counted here.
  const activeFilterCount = (sort !== DEFAULT_SORT ? 1 : 0) + selectedTags.length;

  const clearFilters = useCallback(() => {
    setSort(DEFAULT_SORT);
    setSelectedTags([]);
  }, []);

  const clearSearch = useCallback(() => setQuery(""), []);
  const clearAll = useCallback(() => {
    setQuery("");
    setGenre(null);
    setCategory(null);
    clearFilters();
  }, [clearFilters]);

  // Sorting and tag-narrowing happen on the page that came back, not in the
  // query. That is deliberate: they refine at most `SEARCH_PAGE_SIZE` rows a
  // reader is already looking at, so doing them here costs one pass over a
  // short array and, crucially, does not spend a round trip - a sort that
  // re-queries makes the cheapest control on the screen the slowest one.
  /**
   * The seed for today's tie-break, fixed once per mount.
   *
   * Read at mount rather than inside the memo: the memo recomputes on a tag
   * change, a sort change and every arriving page, and reading the clock and
   * the session inside it means a recompute that crosses midnight, or lands
   * after a sign-in, silently re-orders the whole feed under the reader.
   */
  const feedSeed = useMemo(() => dailyFeedSeed(getViewerId(), new Date()), []);

  /**
   * What the list renders, ordered PAGE BY PAGE rather than all at once.
   *
   * WHY THE PAGE BOUNDARIES MATTER, and this is the whole reason `pageStarts`
   * exists. The tie-break shuffle and the genre interleave are both whole-list
   * operations: run them over a list that grows and they re-order the rows
   * already on screen. Measured on the first version of this, 4 of the first
   * 24 positions survived a second page arriving -- so the reader reaches the
   * bottom, asks for more, and the screen they were reading is dealt again.
   *
   * Ordering each page among its own rows and concatenating is append-stable
   * by construction: a page that has been rendered is never an input to
   * anything again. The cost is the seam -- two pages can meet on the same
   * genre -- which is one run of two at every 24th card, against the
   * alternative of the whole list moving.
   *
   * IS PER-PAGE SORTING ALSO THE RIGHT RANKING? For **Most loved**, yes: the
   * server pages by `like_count desc`, so sorting within a page refines the
   * decision it already made rather than overriding it. For **Newest**, near
   * enough, because `created_at desc` is the server's second key.
   *
   * For **Trending** it is narrower than it looks, and this is the sentence to
   * read when somebody asks why Trending looks wrong after the counts land.
   * Trending sorts on `views`; the server pages on `like_count`. Different
   * columns, so a high-view story is not guaranteed to be on an early page,
   * and once there are real counts a story on page 3 with 10,000 views will
   * sit below page 0's quieter rows. Invisible today -- every count in this
   * catalogue is zero, which is the premise this whole memo rests on -- and
   * the fix when it matters is to sort Trending on the server, not to go back
   * to re-ordering the list under the reader.
   */
  const visible = useMemo(() => {
    const orderPage = (page: Story[]) => {
      const narrowed = selectedTags.length === 0
        ? page
        // OR, not AND: a reader who checks "noir" and "atmospheric" wants
        // either mood, not the rare story tagged with both.
        : page.filter((story) =>
          story.tags.some((tag) => selectedTags.includes(tag))
        );

      // SHUFFLE FIRST, THEN SORT, as Home does. Every count in this catalogue
      // is still zero, so sorting by views or likes ties on every row; the
      // sort is stable, so the list fell through to the server's
      // `created_at desc`. The Originals were published in genre blocks, so
      // that order IS the genre blocks, reversed. A real count still wins,
      // because the sort runs after.
      const sorted = seededShuffle(narrowed, feedSeed, sort).sort((a, b) => {
        if (sort === "trending") return b.views - a.views;
        if (sort === "loved") return b.likes - a.likes;
        return a.publishedOffset - b.publishedOffset;
      });

      // Then break up whatever clustering survives -- but ONLY for the default
      // browse. A shuffle decides ties and still produces runs, which is what
      // the interleave is for; applied to a sort the reader explicitly chose,
      // it answers a different question than the one they asked.
      //
      // "Newest" is the clear case. `publishedOffset` is days-before-now
      // ascending, so position 0 really is the newest story -- and after the
      // interleave, positions 1..n are the newest of each OTHER genre, ordered
      // by how recently each genre last published. With twelve genres, a
      // reader who taps Newest sees one new story and then up to eleven that
      // may be months old before the second-newest appears. Most loved has the
      // same shape. Discovery wants variety; a chosen sort wants the sort.
      if (sort !== DEFAULT_SORT) return sorted;
      return spreadByKey(sorted, (story) => story.genre ?? "unknown");
    };

    return pages.flatMap(orderPage);
  }, [pages, selectedTags, sort, feedSeed]);

  // A live result is not in the bundled catalogue, and handing its id to a
  // navigator that resolves ids against that catalogue would open the wrong
  // story - or nothing. Ids the caller already knows go the ordinary way;
  // everything else is handed over whole.
  const knownIds = useMemo(
    () => new Set(stories.map((story) => story.id)),
    [stories],
  );

  const open = useCallback((story: Story) => {
    if (knownIds.has(story.id) || !onOpenStory) {
      onStory(story.id);
      return;
    }
    onOpenStory(story);
  }, [knownIds, onOpenStory, onStory]);

  const renderItem = useCallback(({ item }: { item: Story }) => (
    <View style={styles.itemPad}>
      <StoryFeedCard
        story={item}
        variant="list"
        onPress={() => open(item)}
      />
    </View>
  ), [open]);

  const searching = hasUsableTerm(query);

  /**
   * What the reader is looking at, in one line above the results.
   *
   * A results list with no caption is ambiguous in exactly the case that
   * matters: a reader who typed something and got a full page cannot tell a
   * search that matched from a search that was ignored.
   */
  const eyebrow = useMemo(() => {
    if (status === "loading" && visible.length === 0) return "Searching";
    const scope = searching
      ? `${visible.length} ${visible.length === 1 ? "result" : "results"}`
      : exploreScopeLabel(genre, category, sort);
    return source === "local" && !searching
      ? `${scope} · offline catalogue`
      : scope;
  }, [category, genre, searching, sort, source, status, visible.length]);

  /**
   * A page that narrowed to nothing is a dead end, so ask for the next one.
   *
   * The tag filter and the block list are applied on the CLIENT, after the
   * server page. When they leave zero rows, `FlatList` renders the empty state
   * and `onEndReached` never fires -- there is no list to reach the end of --
   * so the reader is told "no stories match" while `hasMore` is true and the
   * page that does match has never been asked for. `searchStories` is already
   * careful about exactly this at the server level (`hasMore` counts the rows
   * the database returned, not the ones that survived the genre narrowing);
   * this is the same care for the half of the narrowing that happens here.
   *
   * WHY IT CANNOT SPIN, and this needs the ref rather than being obvious. A
   * FAILED page now reports `hasMore: true` deliberately -- see `local()` in
   * `search.ts`, because a lost connection is not the end of the catalogue --
   * so "no rows, more exists" is a state that can repeat forever. Advancing
   * only when the row count has actually grown since the last attempt means a
   * page that adds nothing, for any reason, ends the chase; the reader's next
   * scroll still retries, because that path is `onEndReached`, not this.
   */
  const autoAdvancedAt = useRef(-1);
  useEffect(() => {
    if (visible.length > 0) return;
    if (status === "loading" || loadingMore || !hasMore) return;
    if (autoAdvancedAt.current === results.length) return;
    autoAdvancedAt.current = results.length;
    loadMore();
  }, [visible.length, results.length, status, loadingMore, hasMore, loadMore]);

  /**
   * What sits under the last card.
   *
   * Three states and one of them is nothing. A spinner while a page is on the
   * way; a quiet line when the catalogue really has ended, so the bottom of
   * the list is a fact rather than an ambiguity; and nothing at all while more
   * exists but has not been asked for, because a permanent footer under a list
   * that is still growing reads as the end of it.
   *
   * It renders only when there is already a list. Under the empty state the
   * spinner above is doing this job and two would be a bug.
   */
  const listFooter = useMemo(() => {
    if (visible.length === 0) return null;
    if (loadingMore) {
      return (
        <View style={styles.footerWrap} testID="explore-loading-more">
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    if (!hasMore) {
      return (
        <View style={styles.footerWrap} testID="explore-list-end">
          <Text style={styles.footerText}>That is everything for now.</Text>
        </View>
      );
    }
    return null;
  }, [hasMore, loadingMore, visible.length]);

  const listEmpty = useMemo(() => {
    // Still fetching, with nothing to show underneath. A spinner rather than
    // an empty-state headline: telling a reader "no stories match" while the
    // answer is still in flight is simply wrong, and they will have moved on
    // by the time it corrects itself.
    if (status === "loading") {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.emptyBody}>Looking through the catalogue…</Text>
        </View>
      );
    }

    // Nothing typed, a genre chosen, and that genre is empty. Not a search
    // problem, so both the copy and the way out differ from a search miss:
    // this is a gap in the catalogue, it is honest, and it closes as writers
    // publish.
    if (!searching && (genre || category)) {
      const label = category
        ? genre
          ? `${BEDTIME_CATEGORY_SHORT_LABEL.toLowerCase()} in ${genreLabels[genre]}`
          : BEDTIME_CATEGORY_SHORT_LABEL.toLowerCase()
        : `${genreLabels[genre!]} stories`;
      const isOfflineBedtime = category === BEDTIME_CATEGORY && source === "local";
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>
            No {label} yet
          </Text>
          <Text style={styles.emptyBody}>
            {isOfflineBedtime
              ? "Connect to browse published bedtime stories. The offline catalogue does not label stories as bedtime."
              : category
                ? "More bedtime stories will appear as they are published."
                : "This genre is new here. More will appear as writers publish in it."}
          </Text>
          <Pressable
            onPress={clearAll}
            accessibilityRole="button"
            style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
          >
            <Text style={styles.emptyButtonText}>See every story</Text>
          </Pressable>
        </View>
      );
    }

    if (searching) {
      // A search that matched nothing. The reader is told what did not match,
      // and then given somewhere to go: three genres, one tap each. A dead
      // end that only offers "clear your filters" hands the problem back to
      // the person who just told us they do not know what they want.
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No stories match “{query.trim()}”</Text>
          <Text style={styles.emptyBody}>
            Try a different spelling, or start from a genre instead.
          </Text>
          <View style={styles.suggestionRow}>
            {SUGGESTED_GENRES.map((suggested) => (
              <Chip
                key={suggested}
                label={genreChipLabel(suggested)}
                onPress={() => {
                  setQuery("");
                  setGenre(suggested);
                }}
              />
            ))}
          </View>
          <Pressable
            onPress={clearAll}
            accessibilityRole="button"
            style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
          >
            <Text style={styles.emptyButtonText}>Clear search</Text>
          </Pressable>
        </View>
      );
    }

    // No search, no genre, and still nothing: the catalogue itself is empty,
    // or tags have narrowed it to nothing.
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>Nothing to show yet</Text>
        <Text style={styles.emptyBody}>
          {activeFilterCount > 0
            ? "Your filters are narrower than the catalogue. Clear them to see everything."
            : "Stories will appear here as they are published."}
        </Text>
        {activeFilterCount > 0 && (
          <Pressable
            onPress={clearAll}
            accessibilityRole="button"
            style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
          >
            <Text style={styles.emptyButtonText}>Clear filters</Text>
          </Pressable>
        )}
      </View>
    );
  }, [activeFilterCount, category, clearAll, genre, query, searching, source, status]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <FlatList
        testID="explore-list"
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <ExploreListHeader
            query={query}
            onQueryChange={setQuery}
            onClearSearch={clearSearch}
            busy={status === "loading"}
            genre={genre}
            onGenreChange={setGenre}
            category={category}
            onCategoryChange={setCategory}
            eyebrow={eyebrow}
            filtersOpen={filtersOpen}
            onToggleFilters={() => setFiltersOpen((open) => !open)}
            sort={sort}
            onSortChange={setSort}
            availableTags={availableTags}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            activeFilterCount={activeFilterCount}
            onClearFilters={clearFilters}
          />
        }
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        ItemSeparatorComponent={ItemSeparator}
        contentContainerStyle={[
          styles.listContent,
          band === "wide" && {
            width: content + gutter * 2,
            alignSelf: "center",
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={loadMore}
        // Half a screen out. Nearer and the spinner is what the reader sees
        // rather than the next card; further and a fast scroll runs off the
        // end of a list that has not been asked to grow. `loadMore` is a
        // no-op while a page is in flight, at the end, or before the first
        // page lands, so the repeated firing this causes is harmless.
        onEndReachedThreshold={0.5}
        // Explore never set any of these. Each card mounts a cover, and
        // rendering the whole accumulated list at once is what makes a long
        // scroll stutter after the second or third page.
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

/**
 * Every control above the list, as one controlled component. It owns no state
 * of its own — every value comes in as a prop and every change goes out as a
 * callback — which is what keeps its component type stable across
 * `ExploreScreen` re-renders (see the doc comment on `ExploreScreen` above).
 */
function ExploreListHeader({
  query,
  onQueryChange,
  onClearSearch,
  busy,
  genre,
  onGenreChange,
  category,
  onCategoryChange,
  eyebrow,
  filtersOpen,
  onToggleFilters,
  sort,
  onSortChange,
  availableTags,
  selectedTags,
  onToggleTag,
  activeFilterCount,
  onClearFilters,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onClearSearch: () => void;
  busy: boolean;
  genre: Genre | null;
  onGenreChange: (value: Genre | null) => void;
  category: ExploreCategory | null;
  onCategoryChange: (value: ExploreCategory | null) => void;
  eyebrow: string;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  sort: SortOption;
  onSortChange: (value: SortOption) => void;
  availableTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  activeFilterCount: number;
  onClearFilters: () => void;
}) {
  return (
    <View style={styles.headerStack}>
      {/* No title and no header row. The tab bar already says Explore, and
          Profile is its own tab, so a "You" link here was a second door to a
          tab one thumb away -- and read as a stray word in the corner. The
          search field is the first thing on the screen. */}

      {/* 1. Search — the field Home does not have. */}
      <SearchField
        value={query}
        onChange={onQueryChange}
        onClear={onClearSearch}
        busy={busy}
      />

      {/* 2. Bedtime and every genre, in one scrolling row. Bedtime is an
          editorial category rather than a genre and stays independently
          selectable -- a reader can want bedtime comedy -- but it used to sit
          in a row of its own above this one, drawn by the same chip, which
          read as a genre chip left on a shelf rather than as a distinction. */}
      <GenreStrip
        selected={genre}
        onSelect={onGenreChange}
        category={category}
        onCategorySelect={onCategoryChange}
      />

      {/* 4. Filters pill (inline panel, no modal) + what you're looking at. */}
      <View style={styles.controlRow}>
        <Pressable
          onPress={onToggleFilters}
          accessibilityRole="button"
          accessibilityLabel="Filters"
          accessibilityState={{ expanded: filtersOpen }}
          style={[styles.filtersPill, filtersOpen && styles.filtersPillActive]}
        >
          <SlidersHorizontal
            size={16}
            color={filtersOpen ? colors.accent : colors.strong}
          />
          <Text
            style={[
              styles.filtersPillText,
              filtersOpen && styles.filtersPillTextActive,
            ]}
          >
            Filters
          </Text>
          {activeFilterCount > 0 && (
            <View style={styles.filterCountBadge}>
              <Text style={styles.filterCountText}>{activeFilterCount}</Text>
            </View>
          )}
          <ChevronDown
            size={16}
            color={filtersOpen ? colors.accent : colors.strong}
            style={filtersOpen && styles.chevronOpen}
          />
        </Pressable>

        <Text style={styles.eyebrow} numberOfLines={1}>{eyebrow}</Text>
      </View>

      {filtersOpen && (
        <View style={styles.filterPanel}>
          <Text style={styles.filterPanelLabel}>SORT</Text>
          <View style={styles.filterPanelRow}>
            <Chip
              label={SORT_LABELS.trending}
              testID="explore-sort-trending"
              selected={sort === "trending"}
              onPress={() => onSortChange("trending")}
            />
            <Chip
              label={SORT_LABELS.loved}
              testID="explore-sort-loved"
              selected={sort === "loved"}
              onPress={() => onSortChange("loved")}
            />
            <Chip
              label={SORT_LABELS.newest}
              testID="explore-sort-newest"
              selected={sort === "newest"}
              onPress={() => onSortChange("newest")}
            />
          </View>

          {availableTags.length > 0 && (
            <>
              <Text
                style={[styles.filterPanelLabel, styles.filterPanelLabelSpaced]}
              >
                TAGS
              </Text>
              <View style={styles.filterPanelRow}>
                {availableTags.map((tag) => (
                  <Chip
                    key={tag}
                    label={capitalize(tag)}
                    selected={selectedTags.includes(tag)}
                    onPress={() => onToggleTag(tag)}
                  />
                ))}
              </View>
            </>
          )}

          {activeFilterCount > 0 && (
            <>
              <View style={styles.filterPanelDivider} />
              <Pressable
                onPress={onClearFilters}
                accessibilityRole="button"
                style={styles.clearButton}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function capitalize(value: string) {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Exported so a test can assert the strip offers the whole catalogue. */
export const EXPLORE_GENRES = UI_GENRES;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },

  // `paddingBottom: TAB_BAR_CLEARANCE` last, and deliberately its own line: the floating
  // tab bar sits over the last ~100pt of the screen, and this is the only
  // thing standing between it and covering the final row.
  listContent: {
    paddingBottom: TAB_BAR_CLEARANCE,
  },

  itemPad: { paddingHorizontal: spacing.xl },
  separator: { height: spacing.md },

  /* The title used to carry this space with it. Without one the search field
     starts at the very top of the safe area, so the padding the heading was
     implicitly providing is now explicit.

     The bottom padding is the gap between the controls and the results, and
     it has to live here rather than on the first card: `ItemSeparatorComponent`
     only inserts space BETWEEN items, so without this the "Filters / Most
     loved" row sat flush against the first cover with nothing between them.
     `betweenGroups` because that is exactly what this is - the end of the
     control group and the start of the list. */
  headerStack: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.betweenGroups,
  },

  /* ── 3. Filters + eyebrow ── */
  controlRow: {
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  eyebrow: {
    ...type.caption,
    flexShrink: 1,
    textAlign: "right",
    color: colors.muted,
    fontWeight: "700",
  },
  filtersPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  filtersPillActive: { backgroundColor: colors.accentSoft },
  filtersPillText: {
    ...type.subhead,
    fontWeight: "700",
    color: colors.strong,
  },
  filtersPillTextActive: { color: colors.accent },
  filterCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 10,
    fontWeight: "900",
  },
  chevronOpen: { transform: [{ rotate: "180deg" }] },

  /* ── Filter panel (inline, no modal) ── */
  filterPanel: {
    marginTop: spacing.related,
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  filterPanelLabel: {
    ...type.caption,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.tertiary,
    marginBottom: spacing.related,
  },
  filterPanelLabelSpaced: { marginTop: spacing.betweenGroups },
  filterPanelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  filterPanelDivider: {
    height: 1,
    backgroundColor: colors.track,
    marginTop: spacing.betweenGroups,
  },
  clearButton: {
    alignSelf: "flex-end",
    marginTop: spacing.related,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  clearButtonText: {
    ...type.subhead,
    fontWeight: "800",
    color: colors.accent,
  },

  /* ── Empty / loading states ── */
  emptyWrap: {
    paddingHorizontal: spacing.huge,
    paddingTop: spacing.huge,
    alignItems: "center",
    gap: spacing.related,
  },
  footerWrap: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  footerText: {
    fontFamily: fonts.ui,
    color: colors.tertiary,
    fontSize: 13,
  },
  emptyTitle: {
    ...type.headline,
    fontFamily: fonts.display,
    color: colors.ink,
    textAlign: "center",
  },
  emptyBody: {
    ...type.subhead,
    color: colors.muted,
    textAlign: "center",
  },
  suggestionRow: {
    marginTop: spacing.related,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  emptyButton: {
    marginTop: spacing.related,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyButtonText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 14,
  },
});

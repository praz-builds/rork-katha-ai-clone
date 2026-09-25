import { useCallback, useMemo, useState } from "react";
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
import { Chip } from "@/components/KathaPrimitives";
import { StoryFeedCard } from "@/components/feed/StoryFeedCard";
import { GenreStrip, genreChipLabel } from "@/components/explore/GenreStrip";
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
 * THREE THINGS MAKE UP THIS SCREEN, in the order a reader meets them:
 *
 * 1. **A search field** that queries the live catalogue — title, summary and
 *    author handle — debounced, cancellable, and race-guarded. See
 *    `components/explore/useStorySearch.ts` for why all three are needed and
 *    why the third is not implied by the first two.
 * 2. **Every genre, as one horizontal strip**, in the create brief's own chip
 *    language. Selecting one filters; selecting it again clears it.
 * 3. **The results**, as `StoryFeedCard`s — the same card Home's rails use,
 *    so a story looks like itself wherever the reader meets it.
 *
 * THE DEFAULT STATE IS NOT BLANK. With nothing typed and no genre chosen,
 * this runs the same query with no filters, which is the catalogue ordered by
 * `like_count` — most loved first. That is the right default for a discovery
 * page for a reason worth stating: a reader who opens Explore without a
 * question has not failed to use it, and the honest answer to "show me
 * anything" is the work other readers liked most. It also means the screen
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
  onProfile,
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
  onProfile: () => void;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<SortOption>("trending");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const { status, stories: searched, source } = useStorySearch(
    { text: query, genre },
    { catalogue: stories, ...searchOptions },
  );
  // The query itself leaves blocked writers out (`search.ts`), but a page
  // fetched before a block would keep showing them until the next keystroke.
  const blocked = useBlockedAuthorIds();
  const results = useMemo(
    () => withoutBlockedAuthors(searched, blocked),
    [searched, blocked],
  );

  // Tags are a property of whatever came BACK, not a fixed list this screen
  // knows ahead of time - so the panel always offers choices that narrow the
  // current results rather than emptying them. Live rows carry no tags yet,
  // which is why the panel's tag section renders only when there are some.
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
  const activeFilterCount = (sort !== "trending" ? 1 : 0) + selectedTags.length;

  const clearFilters = useCallback(() => {
    setSort("trending");
    setSelectedTags([]);
  }, []);

  const clearSearch = useCallback(() => setQuery(""), []);
  const clearGenre = useCallback(() => setGenre(null), []);

  const clearAll = useCallback(() => {
    setQuery("");
    setGenre(null);
    clearFilters();
  }, [clearFilters]);

  // Sorting and tag-narrowing happen on the page that came back, not in the
  // query. That is deliberate: they refine at most `SEARCH_PAGE_SIZE` rows a
  // reader is already looking at, so doing them here costs one pass over a
  // short array and, crucially, does not spend a round trip - a sort that
  // re-queries makes the cheapest control on the screen the slowest one.
  const visible = useMemo(() => {
    const narrowed = selectedTags.length === 0
      ? results
      // OR, not AND: a reader who checks "noir" and "atmospheric" wants
      // either mood, not the rare story tagged with both.
      : results.filter((story) =>
        story.tags.some((tag) => selectedTags.includes(tag))
      );

    return [...narrowed].sort((a, b) => {
      if (sort === "trending") return b.views - a.views;
      if (sort === "loved") return b.likes - a.likes;
      return a.publishedOffset - b.publishedOffset;
    });
  }, [results, selectedTags, sort]);

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
      : genre
      ? genreLabels[genre]
      : "Most loved";
    return source === "local" && !searching
      ? `${scope} · offline catalogue`
      : scope;
  }, [genre, searching, source, status, visible.length]);

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
    if (!searching && genre) {
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>
            No {genreLabels[genre]} stories yet
          </Text>
          <Text style={styles.emptyBody}>
            This genre is new here. More will appear as writers publish in it —
            you could be the first.
          </Text>
          <Pressable
            onPress={clearGenre}
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
  }, [activeFilterCount, clearAll, clearGenre, genre, query, searching, status]);

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
            onProfile={onProfile}
          />
        }
        ListEmptyComponent={listEmpty}
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
  onProfile,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onClearSearch: () => void;
  busy: boolean;
  genre: Genre | null;
  onGenreChange: (value: Genre | null) => void;
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
  onProfile: () => void;
}) {
  return (
    <View style={styles.headerStack}>
      {/* 1. No title.
          The tab bar already says Explore, in a label the reader just
          tapped, so a heading here only repeats it and pushes the search
          field -- the thing they came for -- further down. What stays is the
          way out to the profile. The result count below the search field is
          a different thing and earns its line: it says what came back, which
          nothing else on screen can. */}
      <View style={[styles.header, styles.headerNoTitle]}>
        <Pressable
          onPress={onProfile}
          accessibilityLabel="Open profile"
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.profileLink, pressed && styles.pressed]}
        >
          <Text style={styles.profileLinkText}>You</Text>
        </Pressable>
      </View>

      {/* 2. Search — the field Home does not have. */}
      <SearchField
        value={query}
        onChange={onQueryChange}
        onClear={onClearSearch}
        busy={busy}
      />

      {/* 3. Every genre, scrollable, one at a time. */}
      <GenreStrip selected={genre} onSelect={onGenreChange} />

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
              label="Trending"
              testID="explore-sort-trending"
              selected={sort === "trending"}
              onPress={() => onSortChange("trending")}
            />
            <Chip
              label="Most loved"
              testID="explore-sort-loved"
              selected={sort === "loved"}
              onPress={() => onSortChange("loved")}
            />
            <Chip
              label="Newest"
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

  /* The title used to carry this space with it. Without one the row starts at
     the very top of the safe area and the profile link is clipped, so the
     padding the heading was implicitly providing is now explicit.

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

  /* ── 1. Header ── */
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  /* With the title gone the row holds one control, which `space-between`
     would park on the left. */
  headerNoTitle: {
    justifyContent: "flex-end",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  h1: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 31,
    lineHeight: 35,
  },
  profileLink: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  profileLinkText: {
    ...type.subhead,
    fontWeight: "800",
    color: colors.accent,
  },

  /* ── 4. Filters + eyebrow ── */
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

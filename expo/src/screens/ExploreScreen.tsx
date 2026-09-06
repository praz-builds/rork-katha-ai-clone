import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  ChevronDown,
  LayoutGrid,
  Rows3,
  Search,
  SlidersHorizontal,
} from "lucide-react-native";
import { Chip, FocalImage, formatNumber } from "@/components/KathaPrimitives";
import { StoryFeedCard } from "@/components/feed/StoryFeedCard";
import { imageAssets } from "@/data/images";
import { authorFor } from "@/data/seed";
import {
  colors,
  fonts,
  genreGradients,
  genreLabels,
  radius,
  shadows,
  spacing,
  type,
} from "@/theme";
import { GENRES } from "@/types/domain";
import type { Genre, Story } from "@/types/domain";

/** How the list is sorted. `newest` reads `publishedOffset` ascending - the
 * seed data's offset is "how long ago", so the smallest number is the most
 * recent story. */
type SortOption = "trending" | "loved" | "newest";

/** Two densities: the wide `StoryFeedCard` a reader browses, and a dense
 * one-line row for a reader who already knows the title they want. */
type Density = "comfortable" | "compact";

/** A row this dense stops being useful past a dozen or so choices - past that
 * point a tag stops discriminating and just becomes noise in the panel. */
const MAX_VISIBLE_TAGS = 12;

/**
 * Explore - the full, filterable catalogue Home's "See everything" row hands
 * off to. Home is curated and finite (a handful of named rails); this screen
 * is the opposite: one flat list, searchable, filterable, sortable, and built
 * to grow past what a rail could ever hold. That is why it is a `FlatList`
 * and not a `ScrollView` - a `ScrollView` renders every row it is given,
 * which is fine for ten curated shelves and wrong for a catalogue that keeps
 * growing.
 *
 * THE HEADER-IN-A-LIST TRAP. Search, the genre strip and the filter panel all
 * live in `ListHeaderComponent` so the whole screen scrolls as one surface -
 * the header travels with the list instead of pinning above it. The one way
 * this goes wrong is re-creating the header's REACT COMPONENT TYPE on every
 * render: if `ExploreListHeader` were declared inside `ExploreScreen`'s body,
 * every keystroke in the search box would re-run `ExploreScreen`, produce a
 * brand-new `ExploreListHeader` function, and hand `FlatList` a component
 * whose *type* differs from the one it rendered last frame. React treats a
 * changed type as a different component and unmounts the old subtree before
 * mounting the new one - which unmounts the `TextInput` mid-keystroke and
 * drops focus. `ExploreListHeader` is therefore declared at module scope
 * below, as a plain controlled component: its type never changes across
 * renders, only its props do, so React reconciles it in place like any other
 * child and the input never loses focus.
 */
export default function ExploreScreen({
  stories,
  onStory,
  onProfile,
}: {
  stories: Story[];
  onStory: (id: string) => void;
  onProfile: () => void;
}) {
  const [query, setQuery] = useState("");
  const [genreFilter, setGenreFilter] = useState<Genre | "all">("all");
  const [density, setDensity] = useState<Density>("comfortable");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<SortOption>("trending");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Tags are a property of the CATALOGUE, not a fixed list this screen knows
  // ahead of time - the panel must offer whatever tags the stories actually
  // carry, ranked by how often they occur, so a reader always sees choices
  // that narrow the list rather than empty it. Capped so the panel stays a
  // panel instead of growing to the size of the tag vocabulary.
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of stories) {
      for (const tag of story.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_VISIBLE_TAGS)
      .map(([tag]) => tag);
  }, [stories]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag]
    );
  }, []);

  // Sort defaulting to "trending" and no tags selected is the screen's rest
  // state; the badge and the "Clear" affordance both key off drifting away
  // from it. Genre and search have their own, always-visible resets (the
  // "All" chip, an empty text field) so they are not double-counted here.
  const activeFilterCount = (sort !== "trending" ? 1 : 0) +
    selectedTags.length;

  const clearFilters = useCallback(() => {
    setSort("trending");
    setSelectedTags([]);
  }, []);

  const clearAll = useCallback(() => {
    setQuery("");
    setGenreFilter("all");
    clearFilters();
  }, [clearFilters]);

  const filteredStories = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = stories.filter((story) => {
      const matchesGenre = genreFilter === "all" || story.genre === genreFilter;
      const matchesQuery = !q ||
        story.title.toLowerCase().includes(q) ||
        story.synopsis.toLowerCase().includes(q) ||
        story.tags.join(" ").toLowerCase().includes(q) ||
        authorFor(story.authorId).displayName.toLowerCase().includes(q);
      // OR, not AND: a reader who checks "noir" and "atmospheric" wants
      // either mood, not the rare story tagged with both. AND over a seed
      // catalogue this small collapses to nothing almost immediately.
      const matchesTags = selectedTags.length === 0 ||
        story.tags.some((tag) => selectedTags.includes(tag));
      return matchesGenre && matchesQuery && matchesTags;
    });

    return [...matches].sort((a, b) => {
      if (sort === "trending") return b.views - a.views;
      if (sort === "loved") return b.likes - a.likes;
      return a.publishedOffset - b.publishedOffset;
    });
  }, [stories, query, genreFilter, selectedTags, sort]);

  const renderItem = useCallback(({ item }: { item: Story }) => (
    <View style={styles.itemPad}>
      {density === "comfortable"
        ? (
          <StoryFeedCard
            story={item}
            variant="list"
            onPress={() => onStory(item.id)}
          />
        )
        : <CompactStoryRow story={item} onPress={() => onStory(item.id)} />}
    </View>
  ), [density, onStory]);

  const listEmpty = useMemo(() => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>No stories match</Text>
      <Text style={styles.emptyBody}>
        Try a different search, or clear your filters to see everything again.
      </Text>
      <Pressable
        onPress={clearAll}
        accessibilityRole="button"
        style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
      >
        <Text style={styles.emptyButtonText}>Clear filters</Text>
      </Pressable>
    </View>
  ), [clearAll]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <FlatList
        data={filteredStories}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <ExploreListHeader
            query={query}
            onQueryChange={setQuery}
            genreFilter={genreFilter}
            onGenreChange={setGenreFilter}
            density={density}
            onDensityChange={setDensity}
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
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

/**
 * Every control above the list, as one controlled component. It owns no
 * state of its own - every value comes in as a prop and every change goes
 * out as a callback - which is what keeps its component type stable across
 * `ExploreScreen` re-renders (see the doc comment on `ExploreScreen` above).
 */
function ExploreListHeader({
  query,
  onQueryChange,
  genreFilter,
  onGenreChange,
  density,
  onDensityChange,
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
  genreFilter: Genre | "all";
  onGenreChange: (value: Genre | "all") => void;
  density: Density;
  onDensityChange: (value: Density) => void;
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
      {/* 1. Title + avatar. Explore has nothing to greet the reader with, so
          unlike Home's time-of-day eyebrow this is one plain title. */}
      <View style={styles.header}>
        <Text style={styles.h1}>Explore</Text>
        <Pressable
          onPress={onProfile}
          accessibilityLabel="Open profile"
          accessibilityRole="button"
          style={styles.avatarButton}
        >
          <Image
            source={require("../../assets/icon.png")}
            style={styles.headerAvatar}
          />
        </Pressable>
      </View>

      {/* 2. Search. Same fields Home used to filter on before this screen
          existed: title, synopsis, tags and the author's display name. */}
      <View style={styles.searchBox}>
        <Search size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search stories, moods, authors"
          placeholderTextColor={colors.tertiary}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>

      {/* 3. Genre strip. "All" plus every UI genre, in the fixed catalogue
          order - unlike the ranked tag list below, a genre isn't something
          the reader should have to re-learn the order of every visit. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.genreRow}
      >
        <Chip
          label="All"
          selected={genreFilter === "all"}
          onPress={() => onGenreChange("all")}
        />
        {GENRES.map((genre) => (
          <Chip
            key={genre}
            label={genreLabels[genre]}
            selected={genreFilter === genre}
            onPress={() => onGenreChange(genre)}
          />
        ))}
      </ScrollView>

      {/* 4. Filters pill (with an inline, no-modal panel) + density toggle. */}
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

        <View style={styles.densityToggle}>
          <Pressable
            onPress={() => onDensityChange("comfortable")}
            accessibilityRole="button"
            accessibilityLabel="Comfortable list"
            accessibilityState={{ selected: density === "comfortable" }}
            style={[
              styles.densitySegment,
              density === "comfortable" && styles.densitySegmentSelected,
            ]}
          >
            <Rows3
              size={16}
              color={density === "comfortable" ? colors.ink : colors.muted}
            />
          </Pressable>
          <Pressable
            onPress={() => onDensityChange("compact")}
            accessibilityRole="button"
            accessibilityLabel="Compact list"
            accessibilityState={{ selected: density === "compact" }}
            style={[
              styles.densitySegment,
              density === "compact" && styles.densitySegmentSelected,
            ]}
          >
            <LayoutGrid
              size={16}
              color={density === "compact" ? colors.ink : colors.muted}
            />
          </Pressable>
        </View>
      </View>

      {filtersOpen && (
        <View style={styles.filterPanel}>
          <Text style={styles.filterPanelLabel}>SORT</Text>
          <View style={styles.filterPanelRow}>
            <Chip
              label="Trending"
              selected={sort === "trending"}
              onPress={() => onSortChange("trending")}
            />
            <Chip
              label="Most loved"
              selected={sort === "loved"}
              onPress={() => onSortChange("loved")}
            />
            <Chip
              label="Newest"
              selected={sort === "newest"}
              onPress={() => onSortChange("newest")}
            />
          </View>

          {availableTags.length > 0 && (
            <>
              <Text style={[styles.filterPanelLabel, styles.filterPanelLabelSpaced]}>
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

/**
 * The dense row `density === "compact"` swaps in. AI Dungeon's compact list
 * trades the wide cover and two-line synopsis for a small square thumbnail
 * and one stat line, so the same screen shows roughly triple the titles at a
 * glance - the point of a density toggle is letting a reader who already
 * knows what they want scan faster, not showing them more prose.
 */
function CompactStoryRow({
  story,
  onPress,
}: {
  story: Story;
  onPress: () => void;
}) {
  const image = story.coverImage ? imageAssets[story.coverImage] : undefined;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Read ${story.title}`}
      style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}
    >
      <View style={styles.compactCover}>
        {image
          ? (
            <FocalImage
              source={image}
              focalX={story.focalX ?? 0.5}
              focalY={story.focalY ?? 0.5}
              style={{ width: "100%", height: "100%" }}
            />
          )
          : (
            <LinearGradient
              colors={genreGradients[story.genre]}
              style={StyleSheet.absoluteFill}
            />
          )}
      </View>
      <View style={styles.compactBody}>
        <Text numberOfLines={1} style={styles.compactTitle}>{story.title}</Text>
        <Text numberOfLines={1} style={styles.compactMeta}>
          {genreLabels[story.genre]} {"·"} {formatNumber(story.views)} reads
        </Text>
      </View>
    </Pressable>
  );
}

function capitalize(value: string) {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },

  // `paddingBottom: 116` last, and deliberately its own line: the floating
  // tab bar sits over the last ~100pt of the screen, and this is the only
  // thing standing between it and covering the final row.
  listContent: {
    paddingBottom: 116,
  },

  itemPad: { paddingHorizontal: spacing.xl },
  separator: { height: spacing.md },

  headerStack: { paddingTop: spacing.related },

  /* ── 1. Header ── */
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  h1: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 31,
    lineHeight: 35,
  },
  avatarButton: { position: "relative" },
  headerAvatar: { width: 40, height: 40, borderRadius: 20 },

  /* ── 2. Search ── */
  searchBox: {
    marginHorizontal: spacing.xl,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 15,
  },

  /* ── 3. Genre strip ── */
  genreRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },

  /* ── 4. Filters + density ── */
  controlRow: {
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  filtersPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 40,
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

  densityToggle: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  densitySegment: {
    width: 34,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  densitySegmentSelected: {
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },

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
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  clearButtonText: {
    ...type.subhead,
    fontWeight: "800",
    color: colors.accent,
  },

  /* ── Compact row ── */
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    boxShadow: shadows.card,
  },
  compactCover: {
    // 3:4, matching the source art and StoryFeedCard. See the note on
    // COVER_WIDTH in components/feed/StoryFeedCard.tsx.
    width: 56,
    height: 75,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.sepiaPlaceholder,
  },
  compactBody: { flex: 1, gap: spacing.xs },
  compactTitle: {
    ...type.subhead,
    fontFamily: fonts.display,
    fontWeight: "600",
    color: colors.ink,
  },
  compactMeta: {
    ...type.caption,
    color: colors.muted,
  },

  /* ── Empty state ── */
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

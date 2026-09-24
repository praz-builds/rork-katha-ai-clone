import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
// `SafeAreaView` from `react-native` is an iOS-only no-op: on Android it
// renders a plain View and the screen starts at y=0, under the status bar.
// The safe-area-context one works on both. `SafeAreaProvider` is already
// mounted in App.tsx, so this is a swap, not new plumbing.
import { SafeAreaView } from "react-native-safe-area-context";
import { PenLine, Star } from "lucide-react-native";

import { TAB_BAR_CLEARANCE } from "@/components/BottomTabs";
import CharactersTab from "@/components/library/CharactersTab";
import StoryShelf, { type ShelfState } from "@/components/library/StoryShelf";
import { fetchCreatedShelf, fetchStarredShelf } from "@/lib/api";
import { useBlockedAuthorIds, withoutBlockedAuthors } from "@/lib/blocks";
import { colors, fonts, radius, spacing, type } from "@/theme";
import type { Story } from "@/types/domain";
import { sharedStyles } from "@/screens/shared";

type LibraryTab = "created" | "starred" | "characters";

/**
 * Library, rebuilt around what can actually be known.
 *
 * WHAT THIS REPLACED. Four segments, three of them inventions. "Saved" was
 * `stories.filter(s => s.bookmarks > 100)` - a popularity filter labelled as
 * the reader's own saves, so it listed stories they had never opened and
 * omitted every one they had actually starred. "History" was `slice(0, 5)` of
 * whatever the feed happened to hold, presented as what they had read.
 * "Comments" was a permanent empty state with nothing behind it at all. Three
 * of four tabs were telling the reader things about themselves that were not
 * true, which is worse than a shorter Library, so this is a shorter Library.
 *
 * The three that remain each have a real source: the writer's own rows
 * (`fetchCreatedShelf`), the `bookmarks` table (`fetchStarredShelf`), and
 * saved characters (`lib/saved-characters`). History is gone until something records
 * reads; it will come back the day `record-read` has a list to answer with.
 */
export default function LibraryScreen({
  generatedStories,
  onStory,
  onCreate,
  onExplore,
}: {
  /**
   * Stories written in THIS session, which the shelf fetch has not
   * necessarily caught up with yet. Merged ahead of the fetched rows so a
   * story someone just made is in Library the moment they land here.
   */
  generatedStories: Story[];
  onStory: (id: string) => void;
  onCreate: () => void;
  /** Somewhere to go from an empty Starred shelf. */
  onExplore?: () => void;
}) {
  const [tab, setTab] = useState<LibraryTab>("created");

  const [createdState, setCreatedState] = useState<ShelfState>("loading");
  const [created, setCreated] = useState<Story[]>([]);
  const [starredState, setStarredState] = useState<ShelfState>("loading");
  const [starred, setStarred] = useState<Story[]>([]);

  const loadCreated = useCallback(async () => {
    setCreatedState("loading");
    const result = await fetchCreatedShelf();
    if (result.ok) {
      setCreated(result.stories);
      setCreatedState("ready");
    } else {
      setCreatedState("error");
    }
  }, []);

  const loadStarred = useCallback(async () => {
    setStarredState("loading");
    const result = await fetchStarredShelf();
    if (result.ok) {
      setStarred(result.stories);
      setStarredState("ready");
    } else {
      setStarredState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchCreatedShelf().then((result) => {
      if (!active) return;
      if (result.ok) {
        setCreated(result.stories);
        setCreatedState("ready");
      } else {
        setCreatedState("error");
      }
    });
    void fetchStarredShelf().then((result) => {
      if (!active) return;
      if (result.ok) {
        setStarred(result.stories);
        setStarredState("ready");
      } else {
        setStarredState("error");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Session stories first, then fetched rows, deduped by id.
   *
   * The session copy wins where both exist: it carries beats and series state
   * the shelf query does not select, and dropping it in favour of the row
   * would strip the continuation UI off a story written a minute ago.
   */
  const createdStories = useMemo(() => {
    const seen = new Set(generatedStories.map((story) => story.id));
    return [
      ...generatedStories,
      ...created.filter((story) => !seen.has(story.id)),
    ];
  }, [generatedStories, created]);

  // A starred story by somebody the reader has since blocked is hidden with
  // the rest of their work. The bookmark itself is kept, so unblocking brings
  // it back rather than asking the reader to find it again.
  const blocked = useBlockedAuthorIds();
  const starredStories = useMemo(
    () => withoutBlockedAuthors(starred, blocked),
    [starred, blocked],
  );

  const tabs: { key: LibraryTab; label: string }[] = [
    { key: "created", label: "Created" },
    { key: "starred", label: "Starred" },
    { key: "characters", label: "Characters" },
  ];

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.withTabs}
        showsVerticalScrollIndicator={false}
      >
        {/* No heading.
            A tab bar already says which tab this is, in a label the reader
            just tapped. Repeating it as a title -- "Library / Your
            collection" -- spends the most valuable strip of the screen
            telling somebody something they did a second ago, and pushes the
            actual collection below the fold. Home keeps a heading because it
            says something the tab bar cannot: the reader's name. */}
        <View style={styles.segmented}>
          {tabs.map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              accessibilityLabel={label}
              testID={`library-tab-${key}`}
              style={[styles.segment, tab === key && styles.segmentSelected]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.segmentText,
                  tab === key && styles.segmentTextSelected,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tabContent}>
          {tab === "created" ? (
            <StoryShelf
              testID="library-created"
              state={createdState}
              stories={createdStories}
              onStory={onStory}
              onRetry={() => void loadCreated()}
              loadingLabel="Loading your stories"
              emptyIcon={<PenLine size={30} color={colors.tertiary} />}
              emptyTitle="Nothing written yet"
              // "Every story you finish", not "every story you make". The
              // shelf reads rows with `status = 'complete'`, so a generation
              // still running and one that failed are not in it -- and they
              // should not be: a card for a story with no chapters opens a
              // reader on nothing. The copy says what the shelf actually
              // holds. What "published or not" promises is VISIBILITY, and
              // that promise is kept: private complete stories are here.
              emptyBody="Every story you finish lands here, published or not. Start with a sentence and see where it goes."
              emptyAction={{ label: "Write a story", onPress: onCreate }}
            />
          ) : null}

          {tab === "starred" ? (
            <StoryShelf
              testID="library-starred"
              state={starredState}
              stories={starredStories}
              onStory={onStory}
              onRetry={() => void loadStarred()}
              loadingLabel="Loading your starred stories"
              emptyIcon={<Star size={30} color={colors.tertiary} />}
              emptyTitle="Nothing starred yet"
              emptyBody="Star a story while you read it and it waits here for you, however long it takes to get back to it."
              emptyAction={
                onExplore ? { label: "Find something to read", onPress: onExplore } : undefined
              }
            />
          ) : null}

          {tab === "characters" ? <CharactersTab /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...sharedStyles,
  ...StyleSheet.create({
    /*
      The heading used to carry the top of this screen. Removing it removed
      the padding with it, and the segmented control ended up flush against
      the status bar -- no gap at all on a notched phone. A screen that starts
      at pixel zero is the one thing every screen here must not do, so the
      inset is explicit now rather than a side effect of having a title.
    */
    withTabs: { paddingTop: spacing.xl, paddingBottom: TAB_BAR_CLEARANCE },
    header: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    segmented: {
      marginHorizontal: spacing.xl,
      padding: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.surface2,
      flexDirection: "row",
      gap: 4,
    },
    segment: {
      flex: 1,
      minHeight: 38,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentSelected: { backgroundColor: colors.surface },
    segmentText: {
      // `type.bodySmall` (15), the genre chips' label size
      // (`KathaOnboardingFlowV2` `chipLabel`). 12 read as fine print for the
      // three things this screen is organised by. Each label is one line
      // (`numberOfLines={1}`), and "Characters", the longest, fits a third of
      // the row at 360pt.
      ...type.bodySmall,
      fontFamily: fonts.ui,
      color: colors.muted,
      fontWeight: "800",
    },
    segmentTextSelected: { color: colors.ink },
    tabContent: { marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  }),
};

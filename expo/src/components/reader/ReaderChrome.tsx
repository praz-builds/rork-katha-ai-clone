import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  ChevronLeft,
  ChevronRight,
  List,
  Music,
  Pause,
  Pencil,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react-native";
import { colors, fonts, motion, radius, spacing } from "@/theme";

export type ReaderChromeProps = {
  visible: boolean;
  storyTitle: string;
  /** Under the story title in the top bar. Omit for a standalone story. */
  chapterTitle?: string;
  /**
   * `full` is the reader's chrome. `top-only` is what a tap shows while the
   * chapter is still being written: the way out and the title, nothing to
   * operate on prose that does not exist yet.
   */
  mode?: "full" | "top-only";
  pageIndex: number;
  pageCount: number;
  searchOpen: boolean;
  searchQuery: string;
  searchMatchCount: number;
  activeSearchMatch: number;
  /** Listen shows Pause instead of Play while narration is running. */
  isPlaying?: boolean;
  onBack: () => void;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearchNext: () => void;
  onSearchPrevious: () => void;
  onPageChange: (pageIndex: number) => void;
  /** Author-only, and only once the chapter is complete. Omit and the control is not rendered at all. */
  onEdit?: () => void;
  /** Anyone, once the chapter is complete. Omit and the control is not rendered at all. */
  onReimagine?: () => void;
  onPreferences: () => void;
  onChapters: () => void;
  onListen: () => void;
  onMusic?: () => void;
};

/**
 * The chrome is dark, on every reading theme.
 *
 * It used to be `colors.bg` / `colors.surface` -- light chrome, which was
 * defensible while the page was near-white and indefensible the moment the
 * default page became warm cream: light controls on a light page, with no
 * edge between the thing you are reading and the thing you are operating. It
 * also stayed light in Night mode, which is the one theme where that is a
 * physical problem rather than an aesthetic one.
 *
 * Dark on every theme is deliberate rather than theme-following. The chrome is
 * a transient overlay summoned by a tap; making it recede on some themes and
 * assert on others would mean the same gesture produced a different-feeling
 * surface depending on a preference set weeks ago. A consistently dark sheet
 * reads as "the app", and the page underneath stays "the book" -- which is
 * exactly the separation the reference design draws.
 */
export const CHROME = {
  surface: "#1C1A17",
  border: "#332F2A",
  text: "#F4F1EC",
  muted: "#B5ADA2",
  track: "#3A352F",
} as const;

/**
 * Screen-reader adjust actions. Declared once so the array identity is stable
 * across renders rather than rebuilt on every one.
 */
const ADJUSTABLE_ACTIONS = [
  { name: "increment" as const },
  { name: "decrement" as const },
];

type ChromeAction = {
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  onPress: () => void;
};

/**
 * The control glyph size.
 *
 * 19 before, when the sheet also carried a "Pages" label taking a whole row's
 * width to say what the readout beside it already said. Deleting that row gave
 * the six controls the vertical space they were short of, and they are the
 * things a reader actually aims at in a dark sheet with a thumb.
 */
const CHROME_ICON_SIZE = 26;

function ChromeButton({ action }: { action: ChromeAction }) {
  const Icon = action.icon;
  return (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.chromeButton,
        pressed && styles.chromeButtonPressed,
      ]}
    >
      <Icon size={CHROME_ICON_SIZE} color={CHROME.text} />
      <Text style={styles.chromeButtonText}>{action.label}</Text>
    </Pressable>
  );
}

/**
 * One end of the page stepper.
 *
 * Both ends are this component so they cannot drift apart: same size, same hit
 * area, same disabled treatment, mirrored glyph. The forward one used to be a
 * `ChevronLeft` rotated 180 degrees through a style prop, which is a
 * transform lucide passes to the SVG root and which does not survive every
 * renderer -- the product owner's screenshot has a back chevron on the left of
 * the slider and empty space on the right. A real `ChevronRight` cannot fail
 * that way.
 *
 * Disabled is rendered, not hidden: at the first and last page the control
 * stays where the thumb expects it and reads as unavailable, rather than the
 * row reflowing under the finger.
 */
function PageStepButton({
  direction,
  disabled,
  onPress,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={direction === "previous" ? "Previous page" : "Next page"}
      accessibilityState={{ disabled }}
      hitSlop={8}
      testID={`page-step-${direction}`}
      style={({ pressed }) => [
        styles.pageStepButton,
        disabled && styles.pageStepButtonDisabled,
        pressed && !disabled && styles.chromeButtonPressed,
      ]}
    >
      {/* `muted`, not `track`: the plate IS `track`, so a track-coloured glyph
        * on it is not a dimmed control, it is an empty circle -- which is the
        * exact thing being fixed here. The recession comes from the 55% on the
        * whole button. */}
      <Icon size={22} color={disabled ? CHROME.muted : CHROME.text} />
    </Pressable>
  );
}

export function ReaderChrome({
  visible,
  storyTitle,
  chapterTitle,
  mode = "full",
  pageIndex,
  pageCount,
  searchOpen,
  searchQuery,
  searchMatchCount,
  activeSearchMatch,
  isPlaying = false,
  onBack,
  onSearchOpen,
  onSearchClose,
  onSearchQueryChange,
  onSearchNext,
  onSearchPrevious,
  onPageChange,
  onEdit,
  onReimagine,
  onPreferences,
  onChapters,
  onListen,
  onMusic = () => {},
}: ReaderChromeProps) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    progress.set(
      withTiming(visible ? 1 : 0, {
        duration: reducedMotion ? motion.fast : motion.base,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [progress, reducedMotion, visible]);

  const headerStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reducedMotion ? 0 : (1 - progress.get()) * -12 }],
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reducedMotion ? 0 : (1 - progress.get()) * 28 }],
  }));

  // Edit is author-only and Reimagine is complete-only: a reader who may not
  // use one is handed `undefined` for it, and the button must not render at
  // all rather than render disabled. A greyed control mid-generation is a
  // question the writer cannot answer; an absent one is not.
  const rowOne: ChromeAction[] = [
    { label: "Music", icon: Music, onPress: onMusic },
    ...(onEdit ? [{ label: "Edit", icon: Pencil, onPress: onEdit }] : []),
    ...(onReimagine
      ? [{ label: "Reimagine", icon: Sparkles, onPress: onReimagine }]
      : []),
  ];
  const rowTwo: ChromeAction[] = [
    { label: "Listen", icon: isPlaying ? Pause : Play, onPress: onListen },
    { label: "Chapters", icon: List, onPress: onChapters },
    { label: "Preferences", icon: SlidersHorizontal, onPress: onPreferences },
  ];
  const sliderPercent = pageCount <= 1 ? 0 : pageIndex / (pageCount - 1);

  // Measured, not assumed: the track is a flexed child, so its width is only
  // known after layout. 0 means "not measured yet" and `seekTo` refuses to act
  // on it -- guessing a width here would send the first touch to the wrong page.
  const [trackWidth, setTrackWidth] = useState(0);
  const seekTo = useCallback(
    (locationX: number) => {
      if (trackWidth <= 0 || pageCount <= 1) return;
      const ratio = Math.min(1, Math.max(0, locationX / trackWidth));
      const next = Math.round(ratio * (pageCount - 1));
      if (next !== pageIndex) onPageChange(next);
    },
    [trackWidth, pageCount, pageIndex, onPageChange],
  );
  const matchText = searchQuery.trim()
    ? `${searchMatchCount === 0 ? 0 : activeSearchMatch + 1} of ${searchMatchCount}`
    : "Find";

  return (
    <>
      <Animated.View pointerEvents={visible ? "auto" : "none"} style={[styles.header, headerStyle]}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.headerIconButton}
        >
          <ChevronLeft size={22} color={CHROME.text} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>{storyTitle}</Text>
          {chapterTitle ? (
            <Text style={styles.headerChapter} numberOfLines={1}>{chapterTitle}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={searchOpen ? onSearchClose : onSearchOpen}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? "Close search" : "Search chapter"}
          hitSlop={8}
          style={styles.headerIconButton}
        >
          {searchOpen ? <X size={20} color={CHROME.text} /> : <Search size={20} color={CHROME.text} />}
        </Pressable>
      </Animated.View>

      {/*
        Gated on `visible` too, not just `searchOpen`: the find bar is part
        of the chrome, so hiding the chrome must hide it with it rather than
        leaving it as an orphaned, still-interactive control on the page.
        `searchOpen` (and the query inside it) is left untouched by this --
        it lives in the reader screen's state, not here -- so the bar comes
        back exactly as the reader left it when the chrome reappears,
        instead of the in-progress search being silently dropped.
      */}
      {visible && searchOpen ? (
        <View style={styles.findBar}>
          <TextInput
            value={searchQuery}
            onChangeText={onSearchQueryChange}
            placeholder="Find in chapter"
            placeholderTextColor={colors.tertiary}
            accessibilityLabel="Find in chapter"
            style={styles.findInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.findCount}>{matchText}</Text>
          <Pressable
            onPress={onSearchPrevious}
            accessibilityRole="button"
            accessibilityLabel="Previous search match"
            hitSlop={8}
            style={styles.findButton}
          >
            <ChevronLeft size={18} color={CHROME.muted} />
          </Pressable>
          <Pressable
            onPress={onSearchNext}
            accessibilityRole="button"
            accessibilityLabel="Next search match"
            hitSlop={8}
            style={styles.findButton}
          >
            <ChevronLeft size={18} color={CHROME.muted} style={{ transform: [{ rotate: "180deg" }] }} />
          </Pressable>
        </View>
      ) : null}

      {mode === "full" ? (
        <Animated.View
          pointerEvents={visible ? "auto" : "none"}
          style={[styles.sheet, sheetStyle]}
          testID="reader-chrome-sheet"
        >
          <View style={styles.controlRow}>
            {rowOne.map((action) => <ChromeButton key={action.label} action={action} />)}
          </View>
          <View style={styles.pageSliderGroup}>
            {/*
              One centred readout, no "Pages" caption beside it.

              The caption spent a whole row's width naming the control it sat
              on, next to a readout that already said "Page 7 of 15". The row is
              gone and its height went to the six controls above and below,
              which are what a thumb actually has to find.
            */}
            <Text style={styles.sliderValue} testID="page-readout">
              Page {pageIndex + 1} of {pageCount}
            </Text>
            <View style={styles.pageStepRow}>
              <PageStepButton
                direction="previous"
                disabled={pageIndex <= 0}
                onPress={() => onPageChange(Math.max(0, pageIndex - 1))}
              />
              {/*
                A real positional control, not a stepper wearing a track.

                Touch x is mapped to a page across the measured width, on press
                and on drag, so tap-to-jump and scrub are the same gesture.
                `onLayout` supplies that width; until it arrives `trackWidth` is
                0 and the handler no-ops rather than dividing by zero and
                jumping to page 1.
              */}
              <View
                testID="page-scrubber"
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Pages"
                accessibilityValue={{ min: 1, max: pageCount, now: pageIndex + 1 }}
                accessibilityActions={ADJUSTABLE_ACTIONS}
                onAccessibilityAction={(event) => {
                  // The screen-reader path stays a stepper on purpose: "increment"
                  // has no position to map, and one page per swipe is what a
                  // VoiceOver user expects from an adjustable.
                  if (event.nativeEvent.actionName === "increment") {
                    onPageChange(Math.min(pageCount - 1, pageIndex + 1));
                  } else if (event.nativeEvent.actionName === "decrement") {
                    onPageChange(Math.max(0, pageIndex - 1));
                  }
                }}
                onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(event) => seekTo(event.nativeEvent.locationX)}
                onResponderMove={(event) => seekTo(event.nativeEvent.locationX)}
                style={styles.sliderTrack}
              >
                <View style={styles.sliderTrackLine} />
                <View style={[styles.sliderFill, { width: `${Math.max(3, sliderPercent * 100)}%` }]} />
                <View style={[styles.sliderThumb, { left: `${sliderPercent * 100}%` }]} />
              </View>
              <PageStepButton
                direction="next"
                disabled={pageIndex >= pageCount - 1}
                onPress={() => onPageChange(Math.min(pageCount - 1, pageIndex + 1))}
              />
            </View>
          </View>
          <View style={styles.controlRow}>
            {rowTwo.map((action) => <ChromeButton key={action.label} action={action} />)}
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    minHeight: 70,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: CHROME.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CHROME.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitles: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 22,
    color: CHROME.text,
    letterSpacing: 0,
  },
  headerChapter: {
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16,
    color: CHROME.muted,
    letterSpacing: 0,
  },
  findBar: {
    position: "absolute",
    top: 72,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 25,
    minHeight: 50,
    borderRadius: radius.lg,
    backgroundColor: CHROME.surface,
    borderWidth: 1,
    borderColor: CHROME.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
  },
  findInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: CHROME.text,
    letterSpacing: 0,
  },
  findCount: {
    minWidth: 48,
    fontFamily: fonts.ui,
    fontSize: 12,
    color: CHROME.muted,
    textAlign: "right",
    letterSpacing: 0,
  },
  findButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    backgroundColor: CHROME.surface,
    /*
      `radius.md` (14), not `radius.xl` (24).

      At 24 on a 390-wide sheet the top corners curve for most of the height of
      the first control row, which is what reads as pill-like rather than as a
      panel sliding up from the bottom edge. 14 is the same radius the app's
      cards use: enough to say "this is a surface with edges", not enough to
      round the sheet into a lozenge.
    */
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderTopWidth: 1,
    borderColor: CHROME.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  chromeButton: {
    flex: 1,
    // 44 was the floor and it was also the ceiling, because a "Pages" caption
    // sat between the two control rows. It does not any more.
    minHeight: 64,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  chromeButtonPressed: {
    backgroundColor: CHROME.track,
  },
  chromeButtonText: {
    fontFamily: fonts.ui,
    fontSize: 11,
    fontWeight: "700",
    color: CHROME.text,
    letterSpacing: 0,
  },
  pageSliderGroup: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sliderValue: {
    fontFamily: fonts.ui,
    fontSize: 12,
    textAlign: "center",
    color: CHROME.muted,
    letterSpacing: 0,
  },
  pageStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pageStepButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: CHROME.track,
    alignItems: "center",
    justifyContent: "center",
  },
  pageStepButtonDisabled: {
    // The plate stays; only the glyph recedes (`PageStepButton` swaps its
    // colour to `CHROME.track`). Removing the fill as well would make the
    // control look like it had gone away, which is the thing the owner
    // reported about the forward one in the first place.
    opacity: 0.55,
  },
  sliderTrack: {
    flex: 1,
    height: 44,
    justifyContent: "center",
  },
  sliderTrackLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: CHROME.track,
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: CHROME.text,
  },
  sliderThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: CHROME.text,
  },
});

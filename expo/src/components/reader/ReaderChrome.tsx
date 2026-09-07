import { useEffect } from "react";
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
  History,
  List,
  Music,
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
  pageIndex: number;
  pageCount: number;
  searchOpen: boolean;
  searchQuery: string;
  searchMatchCount: number;
  activeSearchMatch: number;
  onBack: () => void;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearchNext: () => void;
  onSearchPrevious: () => void;
  onPageChange: (pageIndex: number) => void;
  onHistory?: () => void;
  onEdit?: () => void;
  onReimagine?: () => void;
  onPreferences: () => void;
  onChapters: () => void;
  onListen: () => void;
  onMusic?: () => void;
};

type ChromeAction = {
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  onPress: () => void;
};

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
      <Icon size={19} color={colors.strong} />
      <Text style={styles.chromeButtonText}>{action.label}</Text>
    </Pressable>
  );
}

export function ReaderChrome({
  visible,
  storyTitle,
  pageIndex,
  pageCount,
  searchOpen,
  searchQuery,
  searchMatchCount,
  activeSearchMatch,
  onBack,
  onSearchOpen,
  onSearchClose,
  onSearchQueryChange,
  onSearchNext,
  onSearchPrevious,
  onPageChange,
  onHistory = () => {},
  onEdit = () => {},
  onReimagine = () => {},
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

  const rowOne: ChromeAction[] = [
    { label: "History", icon: History, onPress: onHistory },
    { label: "Edit", icon: Pencil, onPress: onEdit },
    { label: "Reimagine", icon: Sparkles, onPress: onReimagine },
  ];
  const rowTwo: ChromeAction[] = [
    { label: "Preferences", icon: SlidersHorizontal, onPress: onPreferences },
    { label: "Chapters", icon: List, onPress: onChapters },
    { label: "Listen", icon: Play, onPress: onListen },
    { label: "Music", icon: Music, onPress: onMusic },
  ];
  const sliderPercent = pageCount <= 1 ? 0 : pageIndex / (pageCount - 1);
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
          <ChevronLeft size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={2}>{storyTitle}</Text>
        <Pressable
          onPress={searchOpen ? onSearchClose : onSearchOpen}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? "Close search" : "Search chapter"}
          hitSlop={8}
          style={styles.headerIconButton}
        >
          {searchOpen ? <X size={20} color={colors.ink} /> : <Search size={20} color={colors.ink} />}
        </Pressable>
      </Animated.View>

      {searchOpen ? (
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
            <ChevronLeft size={18} color={colors.strong} />
          </Pressable>
          <Pressable
            onPress={onSearchNext}
            accessibilityRole="button"
            accessibilityLabel="Next search match"
            hitSlop={8}
            style={styles.findButton}
          >
            <ChevronLeft size={18} color={colors.strong} style={{ transform: [{ rotate: "180deg" }] }} />
          </Pressable>
        </View>
      ) : null}

      <Animated.View pointerEvents={visible ? "auto" : "none"} style={[styles.sheet, sheetStyle]}>
        <View style={styles.controlRow}>
          {rowOne.map((action) => <ChromeButton key={action.label} action={action} />)}
        </View>
        <View style={styles.pageSliderGroup}>
          <View style={styles.pageSliderHeader}>
            <Text style={styles.sliderLabel}>Pages</Text>
            <Text style={styles.sliderValue}>Page {pageIndex + 1} of {pageCount}</Text>
          </View>
          <View style={styles.pageStepRow}>
            <Pressable
              onPress={() => onPageChange(Math.max(0, pageIndex - 1))}
              accessibilityRole="button"
              accessibilityLabel="Previous page"
              hitSlop={8}
              style={styles.pageStepButton}
            >
              <ChevronLeft size={19} color={colors.strong} />
            </Pressable>
            <Pressable
              onPress={() => {
                const next = pageIndex >= pageCount - 1 ? 0 : pageIndex + 1;
                onPageChange(next);
              }}
              accessibilityRole="adjustable"
              accessibilityLabel="Pages"
              accessibilityValue={{ min: 1, max: pageCount, now: pageIndex + 1 }}
              style={styles.sliderTrack}
            >
              <View style={[styles.sliderFill, { width: `${Math.max(3, sliderPercent * 100)}%` }]} />
              <View style={[styles.sliderThumb, { left: `${sliderPercent * 100}%` }]} />
            </Pressable>
            <Pressable
              onPress={() => onPageChange(Math.min(pageCount - 1, pageIndex + 1))}
              accessibilityRole="button"
              accessibilityLabel="Next page"
              hitSlop={8}
              style={styles.pageStepButton}
            >
              <ChevronLeft size={19} color={colors.strong} style={{ transform: [{ rotate: "180deg" }] }} />
            </Pressable>
          </View>
        </View>
        <View style={styles.controlRow}>
          {rowTwo.map((action) => <ChromeButton key={action.label} action={action} />)}
        </View>
      </Animated.View>
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
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
  headerTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 22,
    color: colors.ink,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
    color: colors.ink,
    letterSpacing: 0,
  },
  findCount: {
    minWidth: 48,
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.muted,
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
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
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  chromeButtonPressed: {
    backgroundColor: colors.surface2,
  },
  chromeButtonText: {
    fontFamily: fonts.ui,
    fontSize: 11,
    fontWeight: "700",
    color: colors.strong,
    letterSpacing: 0,
  },
  pageSliderGroup: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  pageSliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sliderLabel: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: 0,
  },
  sliderValue: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0,
  },
  pageStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pageStepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  sliderTrack: {
    flex: 1,
    height: 44,
    justifyContent: "center",
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  sliderThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
});

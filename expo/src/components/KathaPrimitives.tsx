import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Sparkles } from "lucide-react-native";
import { imageAssets } from "@/data/images";
import { COVER_ACCEPT_HEADERS, coverUrl, isTransformedCover } from "@/lib/cover-url";
import { colors, controls, fonts, genreGradients, genreLabels, radius, spacing } from "@/theme";
import type { Genre, ImageName, Story } from "@/types/domain";

/**
 * Renders an image with focal-point-aware cropping.
 *
 * On web, a native `<img>` with object-fit/object-position, because
 * react-native-web's Image ignores objectPosition. On native, `expo-image`.
 *
 * WHY `expo-image` AND NOT RN's `Image`, and it is not mainly the cache.
 * Supabase decides whether to serve a transformed cover as WebP (70 KB) or as
 * the original format (866 KB) from the request's `Accept` header -- there is
 * no query parameter for it. RN's `Image` gives no way to set one;
 * `expo-image` takes `headers` on the source. See `lib/cover-url.ts` for the
 * measurements. The disk cache and the fade come along with it and are worth
 * having, but the header is the reason.
 *
 * `recyclingKey` is not optional on a `FlatList`: without it a recycled row
 * shows the previous story's cover until the new one decodes.
 */
export function FocalImage({
  source,
  focalX = 0.5,
  focalY = 0.5,
  style,
  onLoad,
  recyclingKey,
}: {
  source: number | { uri: string };
  focalX?: number;
  focalY?: number;
  style?: { width: number | string; height: number | string };
  onLoad?: () => void;
  /** The entity this image belongs to, so a recycled row never shows a stale one. */
  recyclingKey?: string;
}) {
  if (Platform.OS === "web") {
    let uri: string;
    try {
      if (typeof source === "object" && source !== null && "uri" in source) {
        uri = (source as { uri: string }).uri;
      } else if (typeof source === "number") {
        const resolved = Image.resolveAssetSource(source);
        uri = resolved?.uri ?? "";
      } else {
        uri = "";
      }
    } catch {
      uri = "";
    }
    if (!uri) {
      // Fallback to standard RN Image if URI resolution fails
      return (
        <Image source={source as number} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={onLoad} />
      );
    }
    // Absolutely positioned, like the native branch's `absoluteFill`. Callers
    // layer a genre gradient (itself `absoluteFill`) under the art, and CSS
    // paints positioned boxes above in-flow ones whatever the source order -
    // so a static <img> here loaded fine and was hidden behind the gradient.
    return React.createElement("img", {
      // Named so a test can find it. The web branch's failure mode is an
      // invisible cover rather than a slow one, and it is the one surface this
      // client can currently be looked at on.
      testID: "focal-image-web",
      src: uri,
      style: {
        position: "absolute",
        top: 0,
        left: 0,
        width: style?.width ?? "100%",
        height: style?.height ?? "100%",
        objectFit: "cover",
        objectPosition: `${focalX * 100}% ${focalY * 100}%`,
        display: "block",
        // The web half of `transition`. `expo-image`'s prop is on the native
        // branch, which this one returns before ever reaching, so without
        // these three lines the cover pops in at full opacity the instant it
        // decodes -- on the only surface this client can currently be looked
        // at, and with two docblocks claiming it cross-fades.
        //
        // CSS rather than React state, for the same reason the native side
        // uses the library's: the hand-rolled fade this replaced was wrong
        // twice over the ordering of a callback and an effect.
        opacity: 0,
        transition: "opacity 180ms ease-out",
      },
      alt: "",
      // THE CACHED CASE IS WHY THERE IS A REF AS WELL AS AN onLoad, and it is
      // the whole "gradients forever" bug pointing at the DOM instead of at an
      // Animated.Value. An image already in the browser cache can finish
      // loading before React attaches `onLoad`, so the event never fires and
      // an element left at opacity 0 stays invisible for good. `complete` is
      // the browser's own answer to "did this already load", checked the
      // moment the node exists. It skips the fade in that case, which is
      // right: there is nothing to fade from.
      //
      // The only way to stay hidden now is `complete === false` and no load
      // event ever, which means the image genuinely never arrived -- and the
      // gradient underneath is the correct thing to be looking at.
      // `key` on the src, so a REGENERATED cover gets a new element rather
      // than the old one's inline opacity. The opacity here is written
      // imperatively, outside React, and React only rewrites style keys that
      // changed between renders -- `opacity: 0` is in both, so it is never
      // rewritten, and the `1` left over from the previous load would survive.
      // That is the second of the two bugs the native side deleted as a class:
      // the new art would replace the old at full strength the instant it
      // decoded, with no fade. Remounting is the cheapest way to be sure.
      key: uri,
      ref: (node: { complete?: boolean; style?: { opacity: string } } | null) => {
        if (node?.complete && node.style) node.style.opacity = "1";
      },
      onLoad: (event: { currentTarget?: { style?: { opacity: string } } }) => {
        const target = event?.currentTarget;
        if (target?.style) target.style.opacity = "1";
        onLoad?.();
      },
      draggable: false,
    });
  }
  // The header goes on only for a URL `coverUrl` rewrote. A bundled asset
  // gains nothing from it, and somebody's uploaded cover is served by whatever
  // host holds it.
  const uri = typeof source === "object" && source !== null && "uri" in source
    ? source.uri
    : null;
  const expoSource = uri !== null && isTransformedCover(uri)
    ? { uri, headers: COVER_ACCEPT_HEADERS }
    : source;

  return (
    <ExpoImage
      source={expoSource}
      style={StyleSheet.absoluteFill}
      // `contentFit`/`contentPosition` are expo-image's names for what was
      // `resizeMode="cover"` plus the focal point the web branch above has
      // always honoured. Native used to center-crop regardless, so this is the
      // first time a focal point means anything off the web.
      contentFit="cover"
      contentPosition={{ top: `${focalY * 100}%`, left: `${focalX * 100}%` }}
      // A real disk cache, which `Image.prefetch` never provided: it only ever
      // warmed the in-memory/HTTP cache for the session.
      cachePolicy="disk"
      // Cross-fade from whatever is underneath -- callers layer a genre
      // gradient there -- rather than the hand-rolled Animated.Value the feed
      // card used to drive from `onLoad`.
      transition={180}
      recyclingKey={recyclingKey}
      onLoad={onLoad}
      accessible={false}
    />
  );
}

export function ScreenScaffold({ children }: PropsWithChildren) {
  return <View style={styles.screen}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  testID
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /**
   * A handle that is not the label. Chip labels are not unique on a screen
   * -- Explore's eyebrow reads "Most loved" at the same moment its sort chip
   * does -- so anything that needs to address one specific chip addresses it
   * by id rather than by the words on it.
   */
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: selected === true }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Cover({ story, size = "card" }: { story: Story; size?: "card" | "mini" }) {
  // The generated cover first, the bundled seed asset second, as in
  // StoryFeedCard and StoryDetailScreen. Reading only `coverImage` meant every
  // story from the database - every one a user wrote - showed the bare genre
  // gradient on Library shelves and author pages.
  // `size` is already the surface name `COVER_WIDTHS` uses, so the cover is
  // asked for at the size this box draws it. Missing this was a third of the
  // saving: Library's shelves and every author page render `size="mini"` into
  // a 74pt box, which is the worst bytes-to-pixels ratio in the app -- twenty
  // saved stories fetched about 40 MB of full-size PNG to paint twenty
  // thumbnails. It is also where the silent half bites: without the rewrite
  // `isTransformedCover` is false, so `FocalImage` sends no `Accept` header
  // either, and there is nothing on screen to say so.
  const coverUri = coverUrl(story.coverImageUrl, size);
  const image = coverUri
    ? { uri: coverUri }
    : story.coverImage
    ? imageAssets[story.coverImage]
    : undefined;
  const gradient = genreGradients[story.genre];
  const focalX = story.focalX ?? 0.5;
  const focalY = story.focalY ?? 0.5;
  const adjustedY = Math.max(0, focalY - 0.07);

  return (
    <View style={[styles.cover, size === "mini" ? styles.miniCover : styles.cardCover]}>
      {/*
        THE GRADIENT IS ALWAYS UNDER THE ART, never instead of it. These two
        used to be the arms of one ternary, so a story WITH a cover rendered no
        gradient at all -- which was invisible while the image painted at full
        opacity from the first frame, and is not now that it fades in. A shelf
        thumbnail would fade up from flat `sepiaPlaceholder`, and a cover that
        never arrives (a 404, or the `cover://` sentinel written while
        generation is in flight) would leave a flat square with no fallback.
        `StoryFeedCard` and the story hero have always layered them; this is
        the same shape.
      */}
      <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} />
      {image ? (
        <FocalImage
          source={image}
          focalX={focalX}
          focalY={adjustedY}
          style={{ width: "100%", height: "100%" }}
          // Shelves are lists too, and a recycled row otherwise paints the
          // previous story's cover until the new one decodes.
          recyclingKey={story.id}
        />
      ) : null}
    </View>
  );
}

export function StoryCard({ story, onPress, compact }: { story: Story; onPress?: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.storyCardCompact, pressed && styles.pressed]}>
        <Cover story={story} size="mini" />
        <View style={styles.storyCardCompactBody}>
          <Text numberOfLines={2} style={styles.storyCardTitle}>
            {story.title}
          </Text>
          <Text style={styles.storyCardMeta} numberOfLines={1}>
            {genreLabels[story.genre]} {"\u00B7"} {formatNumber(story.views)} reads
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.storyCard, pressed && styles.pressed]}>
      <Cover story={story} size="card" />
      <Text numberOfLines={2} style={styles.storyCardTitle}>
        {story.title}
      </Text>
      <Text style={styles.storyCardMeta} numberOfLines={1}>
        {genreLabels[story.genre]} {"\u00B7"} {formatNumber(story.views)} reads
      </Text>
    </Pressable>
  );
}

/**
 * The credit readout in the Create flow's top bar.
 *
 * Containerless, like Home's and Get credits'. It used to sit on a peach
 * `accentSoft` capsule, which is what the Get credits header also did and
 * what Home did with a white plate -- one number, three costumes, on three
 * screens a person walks straight through. The glyph stays gold and filled,
 * which is the one thing the three always agreed on.
 *
 * Not a `HeaderAction`: this one is a label rather than a control. It does
 * not navigate anywhere, so it is not given a button's role or a touch target
 * it would not answer.
 */
export function CreditPill({ credits }: { credits: number }) {
  return (
    <View style={styles.creditPill}>
      <Sparkles size={16} color={colors.chromeStar} fill={colors.chromeStar} />
      <Text style={styles.creditText}>{credits} credits</Text>
    </View>
  );
}

export function GenreSwatch({ genre }: { genre: Genre }) {
  return <LinearGradient colors={genreGradients[genre]} style={styles.genreSwatch} />;
}

export function formatNumber(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg
  },
  sectionHeader: {
    marginBottom: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  sectionTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 22
  },
  sectionAction: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "700",
    fontSize: 13
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }]
  },
  chip: {
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  chipSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
  },
  chipText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontWeight: "700"
  },
  chipTextSelected: {
    color: colors.surface
  },
  cover: {
    overflow: "hidden",
    backgroundColor: colors.sepiaPlaceholder
  },
  cardCover: {
    width: 172,
    aspectRatio: 1,
    borderRadius: 20,
    shadowColor: "rgba(80,50,20,1)",
    shadowOpacity: 0.20,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8
  },
  miniCover: {
    width: 96,
    aspectRatio: 1,
    borderRadius: 14
  },
  storyCard: {
    width: 172,
  },
  storyCardCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  storyCardCompactBody: {
    flex: 1,
    gap: 4
  },
  storyCardTitle: {
    marginTop: 12,
    fontFamily: fonts.display,
    color: colors.sepiaHeading,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 19
  },
  storyCardMeta: {
    marginTop: 4,
    fontFamily: fonts.ui,
    color: colors.sepiaAccent,
    fontSize: 13,
    fontWeight: "600"
  },
  /* No plate and no fill. See the note on `CreditPill` above. */
  creditPill: {
    minHeight: controls.headerActionTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  creditText: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13
  },
  genreSwatch: {
    width: 32,
    height: 32,
    borderRadius: 10
  }
});

import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { useEffect, useMemo, useState } from "react";
import { initPostHog, initSentry } from "@/lib/analytics";
import { initRevenueCat, revenueCatService } from "@/lib/revenuecat";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { setupAndroidChannel, syncPushToken } from "@/lib/notifications";
import { ActivityIndicator, Alert, Platform, View } from "react-native";
import { stories } from "@/data/seed";
import BottomTabs from "@/components/BottomTabs";
import { ScreenScaffold } from "@/components/KathaPrimitives";
import CreateStudioScreen from "@/screens/CreateStudioScreen";
import AuthorScreen from "@/screens/AuthorScreen";
import CreditsScreen from "@/screens/CreditsScreen";
import LibraryScreen from "@/screens/LibraryScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import ReaderScreen from "@/screens/ReaderScreen";
import ExploreScreen from "@/screens/ExploreScreen";
import StoryDetailScreen from "@/screens/StoryDetailScreen";
import HomeScreen from "@/screens/HomeScreen";
import KathaOnboardingComplete from "@/screens/KathaOnboardingComplete";
import KathaOnboardingFlowV2 from "@/screens/KathaOnboardingFlowV2";
import WriterOnboarding from "@/screens/WriterOnboarding";
import type { WriterOnboardingResult } from "@/screens/WriterOnboarding";
import { sharedStyles } from "@/screens/shared";
import { colors, genreLabels } from "@/theme";
import type { Genre, Screen, Story, TabKey } from "@/types/domain";
import type {
  KathaOnboardingResult,
  KathaWriterPathPayload,
} from "@/screens/KathaOnboardingFlowV2";

/**
 * Dev-only deep link into a tab, e.g. `localhost:8081/?tab=explore`.
 *
 * The app boots to `intro`, so every reload of the web dev server drops you at
 * the top of onboarding and the tabs are several screens away. That makes
 * eyeballing a feed change genuinely tedious, and tedious QA is QA that stops
 * happening. Guarded by `__DEV__` and by the web platform check, so it cannot
 * exist in a shipped native build, and it only ever selects a tab - it grants
 * nothing and skips no paid or permission-gated step.
 */
const DEV_TAB_KEYS: readonly TabKey[] = [
  "home",
  "explore",
  "create",
  "library",
  "profile",
];

function devInitialTab(): TabKey | null {
  if (!__DEV__ || Platform.OS !== "web") return null;
  try {
    const requested = new URLSearchParams(globalThis.location?.search ?? "")
      .get("tab");
    return DEV_TAB_KEYS.find((key) => key === requested) ?? null;
  } catch {
    return null;
  }
}

const GENRE_BY_LABEL = Object.fromEntries(
  Object.entries(genreLabels).map((
    [key, label],
  ) => [label.toLowerCase(), key as Genre]),
) as Record<string, Genre>;

/** Onboarding stores display labels; the app keys everything by Genre. */
const toGenreKeys = (labels: string[] | undefined): Genre[] =>
  (labels ?? []).map((label) => GENRE_BY_LABEL[label.trim().toLowerCase()])
    .filter(Boolean as unknown as (g: Genre | undefined) => g is Genre);

export default function App() {
  const [fontsReady, setFontsReady] = useState(false);
  const bootTab = devInitialTab();
  const [screen, setScreen] = useState<Screen>(
    bootTab ? { name: "tabs" } : { name: "intro" },
  );
  const [tab, setTab] = useState<TabKey>(bootTab ?? "home");
  const [credits, setCredits] = useState(() => isSupabaseConfigured ? 0 : 3);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [generatedStories, setGeneratedStories] = useState<Story[]>([]);
  const [onboarding, setOnboarding] = useState<KathaOnboardingResult | null>(
    null,
  );
  /**
   * The blueprint a writer built in onboarding, waiting to be created.
   *
   * It is handed to the Create studio as a pre-filled draft, not generated on
   * arrival. The user presses Create themselves, which keeps the price on the
   * button and stops a bounce from spending their whole welcome grant on a
   * story nobody opens.
   */
  const [writerBlueprint, setWriterBlueprint] = useState<
    WriterOnboardingResult["draft"] | null
  >(null);

  useEffect(() => {
    Font.loadAsync({
      BricolageGrotesque: require("./assets/fonts/BricolageGrotesque.ttf"),
      HankenGrotesk: require("./assets/fonts/HankenGrotesk.ttf"),
      Baloo2: require("./assets/fonts/Baloo2.ttf"),
      // A static 800 instance, cut from the variable Baloo2.ttf.
      //
      // React Native cannot drive a variable font's weight axis, so a
      // `fontWeight` on the variable family silently renders at its 400
      // default. The loader's K is the one place the brand face is meant to be
      // heavy, and it was quietly not. Named as its own family because that is
      // the only way RN can address it.
      "Baloo2-ExtraBold": require("./assets/fonts/Baloo2-ExtraBold.ttf"),
      Literata: require("./assets/fonts/Literata.ttf"),
      LiterataItalic: require("./assets/fonts/Literata-Italic.ttf"),
      // Inter Tight ships as two STATIC instances, not a variable font. Both
      // faces must be registered under their own family name, and a semibold
      // token must set fontFamily: "InterTightSemiBold" - fontWeight: "600"
      // on "InterTight" will not reach 600. See src/theme/typography.ts.
      InterTight: require("./assets/fonts/InterTight-Regular.ttf"),
      InterTightSemiBold: require("./assets/fonts/InterTight-SemiBold.ttf"),
    }).then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    initSentry();
    initPostHog();
    initRevenueCat();
    setupAndroidChannel();
  }, []);

  useEffect(() => {
    let active = true;
    bootstrapUser().then((user) => {
      if (active && user) {
        setCredits(user.balance);
        setIsAnonymous(user.isAnonymous);
      }
      // Expo tokens rotate on reinstall, on some OS updates, and when a backup
      // is restored onto a new device, and only the app ever learns the new
      // value. This never asks for permission; it re-registers a token the
      // user has already granted, and does nothing at all if they have not.
      void syncPushToken();
    }).catch((error) => {
      // The visible app is intentionally sign-in-free. Leave paid actions
      // unavailable until a later retry can establish their server identity.
      console.warn("Guest bootstrap failed:", error);
    });
    return () => {
      active = false;
    };
  }, []);

  const allStories = useMemo(() => [...generatedStories, ...stories], [
    generatedStories,
  ]);

  if (!fontsReady) {
    return (
      <View style={sharedStyles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  /**
   * A series gets a landing page; a standalone opens straight into its prose.
   *
   * The landing page earns its extra tap only when there is something to land
   * ON - a chapter list to choose from, a series premise to read before
   * committing. For a single-chapter story that page would be a wall between
   * the reader and the one thing they tapped for, so the tap goes where the
   * intent went.
   */
  const isSeries = (story: Story) =>
    story.storyMode === "series" || story.chapters.length > 1;

  const openStory = (storyId: string) => {
    const story = allStories.find((item) => item.id === storyId);
    setScreen(
      story && isSeries(story)
        ? { name: "story", storyId }
        : { name: "reader", storyId },
    );
  };
  const finishOnboarding = (result: KathaOnboardingResult) => {
    setOnboarding(result);
    goTabs("home");
  };
  const finishWriterOnboarding = (result: WriterOnboardingResult) => {
    setWriterBlueprint(result.draft);
    // Straight into Create, not Home. The blueprint is the whole reason they
    // finished the flow, and making them find it again is how it gets lost.
    goTabs("create");
  };
  const startWriterOnboarding = (payload?: KathaWriterPathPayload) => {
    setScreen({
      name: "writer-onboarding",
      initialGenre: payload?.initialGenre,
      entryContext: payload?.onboarding
        ? {
          name: payload.onboarding.name,
          genreInterests: payload.onboarding.genres,
          otherGenre: payload.onboarding.otherGenre,
          format: payload.onboarding.refine,
          blocker: payload.onboarding.moment,
        }
        : undefined,
    });
  };
  const goTabs = (nextTab: TabKey = tab) => {
    setTab(nextTab);
    setScreen({ name: "tabs" });
  };

  const renderTab = () => {
    switch (tab) {
      case "home":
        return (
          <HomeScreen
            credits={credits}
            preferredGenres={toGenreKeys(onboarding?.genres)}
            generatedStories={generatedStories}
            stories={allStories}
            onStory={openStory}
            onProfile={() => goTabs("profile")}
            onCreate={() => goTabs("create")}
            onSeeAll={() => goTabs("explore")}
          />
        );
      case "explore":
        return (
          <ExploreScreen
            stories={allStories}
            onStory={openStory}
            onProfile={() => goTabs("profile")}
          />
        );
      case "create":
        return (
          <CreateStudioScreen
            credits={credits}
            isAnonymous={isAnonymous}
            initialDraft={writerBlueprint ?? undefined}
            onCreditUsed={(amount) =>
              setCredits((value) => Math.max(0, value - amount))}
            onPublished={(story) => {
              setGeneratedStories((current) => [story, ...current]);
              setTab("home");
              setScreen({ name: "reader", storyId: story.id });
            }}
            onBack={() => goTabs("home")}
          />
        );
      case "library":
        return (
          <LibraryScreen
            generatedStories={generatedStories}
            stories={allStories}
            onStory={openStory}
            onCreate={() => goTabs("create")}
          />
        );
      case "profile":
        return (
          <ProfileScreen
            credits={credits}
            onBack={() => goTabs("home")}
            onCredits={() => setScreen({ name: "credits" })}
            onPaywall={() => setScreen({ name: "paywall" })}
            onCustomerCenter={() => {
              revenueCatService
                .presentCustomerCenter()
                .then((presented) => {
                  // Unavailable on web, or the SDK never configured. Send the
                  // user to the paywall rather than leaving the row doing
                  // nothing.
                  if (!presented) setScreen({ name: "paywall" });
                })
                .catch((error) => {
                  Alert.alert(
                    "Subscription management unavailable",
                    "Please try again shortly.",
                  );
                  console.warn("RevenueCat Customer Center failed:", error);
                });
            }}
          />
        );
    }
  };

  return (
    /**
     * Every screen that reads `useSafeAreaInsets` needs this above it, and the
     * hook throws rather than degrading when it is missing - so a screen that
     * asks for insets renders as a blank white page instead of an error.
     *
     * `initialWindowMetrics` is passed so the first frame already knows the
     * notch and the home indicator. Without it the provider measures
     * asynchronously, and the first paint lays out under the status bar before
     * snapping into place.
     */
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ScreenScaffold>
        <StatusBar style="dark" />
      {screen.name === "intro"
        ? (
          <KathaOnboardingComplete
            onDone={finishOnboarding}
            onWriterPath={startWriterOnboarding}
            onSignIn={() => setScreen({ name: "onboarding" })}
          />
        )
        : screen.name === "writer-onboarding"
        ? (
          <WriterOnboarding
            onDone={finishWriterOnboarding}
            onExit={() => goTabs("home")}
            initialGenre={screen.initialGenre}
            entryContext={screen.entryContext}
          />
        )
        : screen.name === "onboarding"
        ? (
          <KathaOnboardingFlowV2
            initialScreen="email"
            onDone={finishOnboarding}
          />
        )
        : screen.name === "story"
        ? (
          <StoryDetailScreen
            story={allStories.find((story) => story.id === screen.storyId) ??
              allStories[0]}
            onBack={() => goTabs(tab)}
            onRead={(chapterIndex) =>
              setScreen({
                name: "reader",
                storyId: screen.storyId,
                chapterIndex,
              })}
            onAuthor={(authorId) => setScreen({ name: "author", authorId })}
          />
        )
        : screen.name === "reader"
        ? (
          <ReaderScreen
            story={allStories.find((story) => story.id === screen.storyId) ??
              allStories[0]}
            initialChapterIndex={screen.chapterIndex ?? 0}
            onBack={() => goTabs(tab)}
          />
        )
        : screen.name === "author"
        ? (
          <AuthorScreen
            authorId={screen.authorId}
            stories={allStories}
            onBack={() => goTabs(tab)}
            onStory={openStory}
          />
        )
        : screen.name === "credits"
        ? <CreditsScreen credits={credits} onBack={() => goTabs(tab)} />
        : screen.name === "paywall"
        ? (
          <KathaOnboardingFlowV2
            initialScreen="paywall"
            onDone={finishOnboarding}
          />
        )
        : (
          <>
            {renderTab()}
            {tab === "create" ? null : (
              <BottomTabs selected={tab} onSelect={(next) => setTab(next)} />
            )}
          </>
        )}
      </ScreenScaffold>
    </SafeAreaProvider>
  );
}

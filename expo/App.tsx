import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { useEffect, useMemo, useRef, useState } from "react";
import { initPostHog, initSentry } from "@/lib/analytics";
import { initRevenueCat, revenueCatService } from "@/lib/revenuecat";
import { fetchMyStories } from "@/lib/api";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";
import { resolveBootstrappedCredits, resolveInitialCredits } from "@/lib/dev-credits";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { setupAndroidChannel, syncPushToken } from "@/lib/notifications";
import { Alert, Platform } from "react-native";
import { stories } from "@/data/seed";
import BottomTabs from "@/components/BottomTabs";
import { LaunchScreen } from "@/components/brand/LaunchScreen";
import LoaderPreview from "@/screens/dev/LoaderPreview";
import NarrationLoaderPreview from "@/screens/dev/NarrationLoaderPreview";
import { ScreenScaffold } from "@/components/KathaPrimitives";
import CreateStudioScreen from "@/screens/CreateStudioScreen";
import AuthorScreen from "@/screens/AuthorScreen";
import CreditsScreen from "@/screens/CreditsScreen";
import LibraryScreen from "@/screens/LibraryScreen";
import ListenScreen from "@/screens/ListenScreen";
import PracticeScreen from "@/screens/PracticeScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import PhraseCaptureReader from "@/components/reader/PhraseCaptureReader";
import ChapterEnd from "@/components/reader/ChapterEnd";
import GeneratingOverlay from "@/components/GeneratingOverlay";
import StoryGatedPrivateModal from "@/components/create/StoryGatedPrivateModal";
import {
  acknowledgeGate,
  adoptReimagineGeneration,
  findStoryGeneration,
  provisionalStory,
  startChapterGeneration,
  useGenerations,
} from "@/lib/generation-session";
import { loadStoryChapters } from "@/lib/search";
import { fetchReadingStreak } from "@/lib/streak";
import ExploreScreen from "@/screens/ExploreScreen";
import StoryDetailScreen from "@/screens/StoryDetailScreen";
import HomeScreen from "@/screens/HomeScreen";
import KathaOnboardingComplete from "@/screens/KathaOnboardingComplete";
import KathaOnboardingFlowV2 from "@/screens/KathaOnboardingFlowV2";
import WriterOnboarding from "@/screens/WriterOnboarding";
import type { WriterOnboardingResult } from "@/screens/WriterOnboarding";
import { genreLabels } from "@/theme";
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

/**
 * Dev-only isolation of a single component, e.g. `localhost:8090/?preview=loader`.
 *
 * The sibling of `devInitialTab`, and guarded the same way. Where that one skips
 * you past onboarding to a tab, this one replaces the app entirely with a
 * harness for one piece of it. The crafting loader is the case it was built for:
 * it lives several screens inside the writer flow and is on screen only while a
 * generation is actually running, so the only way to look at a 1.2s animation
 * twice was to generate two stories.
 */
function devPreview(): string | null {
  if (!__DEV__ || Platform.OS !== "web") return null;
  try {
    return new URLSearchParams(globalThis.location?.search ?? "")
      .get("preview");
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
  const preview = devPreview();
  const [screen, setScreen] = useState<Screen>(
    bootTab ? { name: "tabs" } : { name: "intro" },
  );
  const [tab, setTab] = useState<TabKey>(bootTab ?? "home");
  const [credits, setCredits] = useState(() =>
    resolveInitialCredits(__DEV__, isSupabaseConfigured)
  );
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [generatedStories, setGeneratedStories] = useState<Story[]>([]);
  /**
   * Stories found through Explore's search that are not in the bundled
   * catalogue.
   *
   * Every screen below resolves a story by looking its id up in
   * `allStories`, so a live search result has to be PUT there before the
   * reader can be navigated to it - otherwise the tap resolves to nothing
   * and the reader lands on whatever `allStories[0]` happens to be. Kept
   * separate from `generatedStories` because these are not the writer's own
   * work and must never appear in "Your stories".
   */
  const [discoveredStories, setDiscoveredStories] = useState<Story[]>([]);
  /**
   * The reader's streak in days, or null while it is unknown.
   *
   * Null is the honest starting value and the honest resting value: nothing
   * writes a streak from the client, and `fetchReadingStreak` returns null
   * for every case that is not a real row. Home draws the flame only for a
   * number. See `src/lib/streak.ts`.
   */
  const [streakDays, setStreakDays] = useState<number | null>(null);
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
  const generations = useGenerations();

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
        setCredits(
          resolveBootstrappedCredits(__DEV__, isSupabaseConfigured, user.balance),
        );
        setIsAnonymous(user.isAnonymous);
      }
      // Expo tokens rotate on reinstall, on some OS updates, and when a backup
      // is restored onto a new device, and only the app ever learns the new
      // value. This never asks for permission; it re-registers a token the
      // user has already granted, and does nothing at all if they have not.
      void syncPushToken();

      // The reading streak, once there is an identity to read it for. It
      // rides the same boot as the credit balance and fails to `null`, which
      // Home renders as no flame at all rather than as a zero.
      if (active) {
        void fetchReadingStreak().then((streak) => {
          if (active) setStreakDays(streak?.current ?? null);
        });
      }

      // A writer's own stories, restored.
      //
      // `generatedStories` is session state, so before this the interface
      // forgot every story on reload -- while the rows sat safe in the
      // database. Someone who wrote three stories, closed the tab and came
      // back found an empty library and no way to reach work they had paid
      // credits for.
      //
      // Merged by id rather than replacing: a story generated in THIS session
      // is more complete than its library row (it carries beats and series
      // state the list query does not select), so the local copy wins where
      // both exist.
      if (active) {
        void fetchMyStories().then((mine) => {
          if (!active || mine.length === 0) return;
          setGeneratedStories((current) => {
            const seen = new Set(current.map((story) => story.id));
            return [...current, ...mine.filter((story) => !seen.has(story.id))];
          });
        });
      }
    }).catch((error) => {
      // The visible app is intentionally sign-in-free. Leave paid actions
      // unavailable until a later retry can establish their server identity.
      console.warn("Guest bootstrap failed:", error);
    });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Every generation reaches app state, whoever started it and wherever they
   * went afterwards.
   *
   * A generation outlives the screen that asked for it: the writer can leave
   * Create, or leave the reader, while a chapter is still being written. So the
   * registration lives here, above every screen, watching the store rather than
   * waiting on a callback from a component that may no longer be mounted.
   *
   * A story being written is registered as soon as it has pages, under its
   * SESSION id, so it is in the library and openable the moment there is
   * something to read - which is the promise the live reader makes. When the
   * server's own story arrives it replaces that row, real id and all, and the
   * reader is repointed at it if that is what it happens to be showing.
   */
  useEffect(() => {
    const interesting = generations.filter((session) =>
      session.phase === "complete"
      || (session.kind === "story" && session.revealedProse.length > 0)
    );
    if (interesting.length === 0) return;
    setGeneratedStories((current) => {
      let next = current;
      const upsert = (story: Story, replacingId?: string) => {
        const at = next.findIndex((held) =>
          held.id === story.id || held.id === replacingId
        );
        next = at < 0
          ? [story, ...next]
          : next.map((held, index) => (index === at ? story : held));
      };
      for (const session of interesting) {
        if (session.kind === "story") {
          if (session.phase === "complete" && session.story) {
            upsert(session.story, session.id);
          } else {
            const draftStory = provisionalStory(session);
            if (draftStory) upsert(draftStory);
          }
          continue;
        }
        const { chapter } = session;
        if (session.phase !== "complete" || !chapter || !session.storyId) continue;
        const target = next.find((held) => held.id === session.storyId)
          ?? stories.find((held) => held.id === session.storyId);
        if (!target) {
          // A reader who reimagines somebody else's story is rewriting a
          // PRIVATE COPY the client has never seen, under an id no story in
          // state carries. The session hands the whole copy over; without
          // this it fell through here and the story the reader now owns (and
          // paid for) existed only on the server.
          if (session.story && session.story.id === session.storyId) {
            upsert(session.story);
          }
          continue;
        }
        if (
          target.chapters.some(
            (held) => held.chapterNumber === chapter.chapterNumber,
          )
        ) {
          continue;
        }
        // A seed story being continued is not in `generatedStories` yet, so
        // `upsert` adds it rather than mapping over it.
        upsert({ ...target, chapters: [...target.chapters, chapter] });
      }
      return next;
    });
  }, [generations]);

  /**
   * A finished story takes over the reader that was showing it being written.
   *
   * Until it completes, the reader is pointed at the session id (that is what
   * the provisional story is keyed by). Repointing rather than re-navigating is
   * what keeps the writer on the page they were reading.
   */
  useEffect(() => {
    setScreen((current) => {
      if (current.name !== "reader") return current;
      const session = generations.find((item) =>
        item.id === current.storyId && item.phase === "complete" && item.story
      );
      return session?.story
        ? { ...current, storyId: session.story.id }
        : current;
    });
  }, [generations]);

  /**
   * A rewrite by a reader who does not own the story moves them onto their copy.
   *
   * `reimagine-chapter` forks the story rather than editing somebody else's,
   * so the prose on screen belongs to a story the reader now owns. Leaving the
   * reader pointed at the ORIGINAL meant the rewrite vanished the moment the
   * live session finished and the reader's own copy was never opened.
   */
  useEffect(() => {
    setScreen((current) => {
      if (current.name !== "reader") return current;
      const fork = generations.find((item) =>
        item.phase === "complete"
        && item.story?.forkedFromStoryId === current.storyId
      );
      return fork?.story ? { ...current, storyId: fork.story.id } : current;
    });
  }, [generations]);

  /** The credit each generation charged, deducted once, when it settles. */
  const chargedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const charges = generations.filter((session) =>
      session.phase === "complete"
      && session.creditsCharged > 0
      && !chargedRef.current.has(session.id)
    );
    if (charges.length === 0) return;
    charges.forEach((session) => chargedRef.current.add(session.id));
    const total = charges.reduce(
      (sum, session) => sum + session.creditsCharged,
      0,
    );
    setCredits((value) => Math.max(0, value - total));
  }, [generations]);

  /**
   * The entity gate, explained once.
   *
   * A story naming a living public figure or somebody from the writer's own
   * life is kept private however the toggle was set, and the writer is told
   * why. It is rendered here, above the reader, because by the time the server
   * answers, the writer has already been handed their story to read.
   */
  const gatedSession = generations.find((session) => session.gatedReason);

  const allStories = useMemo(
    () => [...generatedStories, ...discoveredStories, ...stories],
    [generatedStories, discoveredStories],
  );

  /**
   * The generation writing into the story the reader is open on, if any.
   *
   * Derived rather than held in state: a chapter started from the chapter end,
   * a story started from the brief and a story reopened from Library while it
   * is still being written are all the same question - "is anything being
   * written into this story right now" - and the store is the one place that
   * knows the answer.
   */
  const readerStoryId = screen.name === "reader" ? screen.storyId : null;
  const readerSession = readerStoryId
    ? findStoryGeneration(readerStoryId)
    : null;

  if (!fontsReady) return <LaunchScreen />;

  if (preview === "loader") return <LoaderPreview />;
  if (preview === "narration-loader") return <NarrationLoaderPreview />;

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
  /**
   * Opens a story that came back from Explore's search.
   *
   * Two things have to happen before the navigation, and in this order.
   * First the chapters are fetched: search returns metadata only, so the
   * story in hand has an empty `chapters` array and the reader would open on
   * a blank page. Then it is merged into `discoveredStories`, so the id the
   * screen is about to be pointed at actually resolves in `allStories`.
   *
   * The series-or-standalone decision is made on the HYDRATED copy, not on
   * `allStories`: state set a line earlier is not visible to a read on the
   * same tick, so consulting the list here would route every live result as
   * a standalone and drop series readers past their own chapter list.
   *
   * And if the fetch FAILS, nothing is navigated to. Opening the reader on
   * the metadata-only copy put people inside a story with a cover, a title
   * and no words, with nothing to retry — indistinguishable from a story
   * that had never been written. Staying on Explore with an explanation
   * leaves the tap available to try again.
   */
  const openDiscoveredStory = async (story: Story) => {
    const { ok, story: full } = await loadStoryChapters(story);
    if (!ok) {
      Alert.alert(
        "We could not open that story",
        "Check your connection and try again.",
      );
      return;
    }
    setDiscoveredStories((current) =>
      current.some((item) => item.id === full.id)
        ? current.map((item) => (item.id === full.id ? full : item))
        : [...current, full]
    );
    setScreen(
      isSeries(full)
        ? { name: "story", storyId: full.id }
        : { name: "reader", storyId: full.id },
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
            onCredits={() => setScreen({ name: "credits" })}
            onNotifications={() => goTabs("profile")}
            streakDays={streakDays}
          />
        );
      case "explore":
        return (
          <ExploreScreen
            stories={allStories}
            onStory={openStory}
            onOpenStory={(story) => void openDiscoveredStory(story)}
            onProfile={() => goTabs("profile")}
          />
        );
      case "create":
        return (
          <CreateStudioScreen
            credits={credits}
            isAnonymous={isAnonymous}
            initialDraft={writerBlueprint ?? undefined}
            onGenerationStarted={(session) => {
              // Straight to the reader, before a word of the story exists. It
              // shows the crafting screen until there are finished pages and
              // then becomes the reader; the session id is what it is pointed
              // at until the server names the story.
              setTab("home");
              setScreen({ name: "reader", storyId: session.id });
            }}
            onBack={() => goTabs("home")}
          />
        );
      case "library":
        return (
          <LibraryScreen
            generatedStories={generatedStories}
            onStory={openStory}
            onCreate={() => goTabs("create")}
            onExplore={() => goTabs("explore")}
            onPractice={() => setScreen({ name: "practice" })}
          />
        );
      case "profile":
        return (
          <ProfileScreen
            credits={credits}
            isAnonymous={isAnonymous}
            onSignIn={() => setScreen({ name: "onboarding" })}
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
            // `generatedStories` is exactly the set the viewer wrote: restored
            // by author id on boot, prepended on creation.
            isOwn={generatedStories.some((story) => story.id === screen.storyId)}
            onBack={() => goTabs(tab)}
            onRead={(chapterIndex, options) =>
              setScreen({
                name: "reader",
                storyId: screen.storyId,
                chapterIndex,
                // Listen and Read are different intents. The detail screen has
                // always said which one it meant; this call site dropped the
                // options, so Listen opened the reader silently and the reader
                // had no way to know narration had been asked for.
                autoplay: options?.mode === "listen",
              })}
            onAuthor={(authorId) => setScreen({ name: "author", authorId })}
            // Reading is open to a guest; engaging is not. Every gated control
            // on that page stays visible and routes here instead of writing.
            canEngage={!isAnonymous}
            onSignIn={() => setScreen({ name: "onboarding" })}
            // Listen is its own screen now, not a reader with autoplay set: a
            // story with no narration yet has a real wait, and the player owns
            // it. Close comes back here.
            onListen={() =>
              setScreen({
                name: "listen",
                storyId: screen.storyId,
                chapterIndex: 0,
                returnTo: "story",
              })}
          />
        )
        : screen.name === "listen"
        ? (
          <ListenScreen
            story={allStories.find((story) => story.id === screen.storyId) ??
              allStories[0]}
            initialChapterIndex={screen.chapterIndex ?? 0}
            onClose={() => {
              const { storyId, chapterIndex, returnTo } = screen;
              if (returnTo === "story") setScreen({ name: "story", storyId });
              else if (returnTo === "reader") {
                setScreen({ name: "reader", storyId, chapterIndex });
              } else goTabs(tab);
            }}
          />
        )
        : screen.name === "reader"
        ? (
          /*
            The one screen a generation lands on, in both of its states.

            While the chapter has no finished pages yet there is nothing to
            read, so the crafting screen holds the whole window - the same
            screen, unchanged, that the wait has always used. The moment whole
            settled pages exist the reader takes over on page 1 and the rest of
            the chapter arrives behind it. A CONTINUATION never shows the
            crafting screen at all: the reader is already open, so it turns to
            the new chapter's opener and writes into it.
          */
          readerSession?.kind === "story"
              && readerSession.phase === "writing"
              && readerSession.revealedProse.length === 0
            ? <GeneratingOverlay genre={readerSession.genre} mode="story" />
            : (
              <PhraseCaptureReader
                story={allStories.find((story) => story.id === screen.storyId)
                  ?? (readerSession ? provisionalStory(readerSession) : null)
                  ?? allStories[0]}
                initialChapterIndex={screen.chapterIndex ?? 0}
                autoplay={screen.autoplay ?? false}
                liveSessionId={readerSession?.id ?? null}
                // The chrome's Listen control opens the narration player on
                // the chapter being read, and Close returns to this reader on
                // that same chapter.
                onListen={(chapterIndex) =>
                  setScreen({
                    name: "listen",
                    storyId: screen.storyId,
                    chapterIndex,
                    returnTo: "reader",
                  })}
                // Reading is open to everyone; putting your name on somebody
                // else's story is not. A guest who taps Like, Save, Follow or
                // the comment box lands at sign-in instead of at a local
                // state change nothing will ever persist.
                onRequireSignIn={isAnonymous ? () => setScreen({ name: "onboarding" }) : undefined}
                // A rewrite becomes a live session like any other chapter, so
                // it reveals page by page instead of waiting behind a cover.
                // `findStoryGeneration` above then picks it up on the next
                // render and the reader is live on it.
                onReimagineStarted={(run) => {
                  const target = allStories.find((item) => item.id === screen.storyId);
                  if (!target) return;
                  adoptReimagineGeneration({
                    run,
                    story: target,
                    chapterNumber: (screen.chapterIndex ?? 0) + 1,
                  });
                }}
                onBack={() => goTabs(tab)}
                renderChapterEnd={(chapter, { reimagine }) => {
                  const story =
                    allStories.find((item) => item.id === screen.storyId) ??
                      allStories[0];
                  return (
                    <ChapterEnd
                      story={story}
                      chapter={chapter}
                      // A standalone, and a series that has reached its
                      // planned ending, have no next chapter to offer. Rewriting
                      // is the one thing left, so the pill has to be reachable
                      // from the ending itself and not only from the chrome.
                      onReimagine={reimagine ?? undefined}
                      onContinue={(direction) => {
                        const next = chapter.chapterNumber + 1;
                        startChapterGeneration({
                          story,
                          nextChapterNumber: next,
                          isFinale:
                            typeof story.plannedChapterCount === "number"
                              ? next >= story.plannedChapterCount
                              : false,
                          direction,
                        });
                      }}
                    />
                  );
                }}
              />
            )
        )
        : screen.name === "practice"
        ? (
          <PracticeScreen
            onBack={() => goTabs(tab)}
            onStory={openStory}
          />
        )
        : screen.name === "author"
        ? (
          <AuthorScreen
            authorId={screen.authorId}
            stories={allStories}
            canEngage={!isAnonymous}
            onRequireSignIn={() => setScreen({ name: "onboarding" })}
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
        {gatedSession?.gatedReason ? (
          <StoryGatedPrivateModal
            reason={gatedSession.gatedReason}
            onAcknowledge={() => acknowledgeGate(gatedSession.id)}
          />
        ) : null}
      </ScreenScaffold>
    </SafeAreaProvider>
  );
}

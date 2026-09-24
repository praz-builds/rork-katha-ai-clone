import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedValue } from "react-native-reanimated";
import { captureError, initPostHog, initSentry } from "@/lib/analytics";
import { initRevenueCat, revenueCatService } from "@/lib/revenuecat";
import { fetchCreatedShelf, fetchCuratedStories } from "@/lib/api";
import { MAX_PLANNED_CHAPTER_COUNT } from "@/types/domain";
import { bootstrapUser, signOutToSignIn } from "@/lib/session";
import { setEntitlementOverride } from "@/lib/entitlements";
import { isSupabaseConfigured } from "@/lib/supabase";
import { resolveBootstrappedCredits, resolveInitialCredits } from "@/lib/dev-credits";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { setupAndroidChannel, syncPushToken } from "@/lib/notifications";
import { Alert, Platform, View } from "react-native";
import { stories } from "@/data/seed";
import BottomTabs from "@/components/BottomTabs";
import { LaunchScreen } from "@/components/brand/LaunchScreen";
import LoaderPreview from "@/screens/dev/LoaderPreview";
import NarrationLoaderPreview from "@/screens/dev/NarrationLoaderPreview";
import OriginalsCoverPreview from "@/screens/dev/OriginalsCoverPreview";
import { ScreenScaffold } from "@/components/KathaPrimitives";
import CreateStudioScreen, { type StudioDraft } from "@/screens/CreateStudioScreen";
import { seedDraftFromStory } from "@/lib/reimagine-seed";
import AuthorScreen from "@/screens/AuthorScreen";
import CreditsScreen from "@/screens/CreditsScreen";
import LibraryScreen from "@/screens/LibraryScreen";
import ListenScreen from "@/screens/ListenScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import ReaderScreen from "@/screens/ReaderScreen";
import ChapterEnd, {
  deriveContinuationOptions,
} from "@/components/reader/ChapterEnd";
import GeneratingOverlay from "@/components/GeneratingOverlay";
import {
  adoptReimagineGeneration,
  findStoryGeneration,
  provisionalStory,
  startAutoChapterAhead,
  startChapterGeneration,
  useGenerations,
  plannedChapterCountOf,
} from "@/lib/generation-session";
import { loadStoryChapters } from "@/lib/search";
import {
  buildStoryCatalogue,
  hydrateForOpen,
  needsChapters,
  openTarget,
} from "@/lib/story-catalogue";
import {
  cachedDisplayName,
  cacheDisplayName,
  fetchOwnProfile,
  type OwnProfile,
  saveDisplayName,
} from "@/lib/profile";
import JourneyScreen from "@/screens/JourneyScreen";
import VoicesScreen from "@/screens/VoicesScreen";
import { fetchReadingStreak } from "@/lib/streak";
import ExploreScreen from "@/screens/ExploreScreen";
import StoryDetailScreen from "@/screens/StoryDetailScreen";
import HomeScreen from "@/screens/HomeScreen";
import KathaOnboardingComplete from "@/screens/KathaOnboardingComplete";
import CharacterOnboarding from "@/screens/CharacterOnboarding";
import type { CharacterOnboardingResult } from "@/screens/CharacterOnboarding";
import SignInScreen from "@/screens/SignInScreen";
import { OnboardingPaywall } from "@/components/onboarding/OnboardingPaywall";
import {
  bumpCredits,
  WelcomeCreditsFlight,
  type FlightTarget,
} from "@/components/onboarding/WelcomeCreditsFlight";
import {
  hasPlayedWelcomeFlight,
  markWelcomeFlightPlayed,
} from "@/lib/welcome-flight";
import { genreLabels } from "@/theme";
import { loadDraft } from "@/lib/draft-storage";
import type {
  CharacterEntryContext,
  CreateDraft,
  Genre,
  Screen,
  Story,
  TabKey,
} from "@/types/domain";
import type { KathaCharacterPathPayload } from "@/screens/KathaOnboardingFlowV2";

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

/**
 * The pre-filled Create brief onboarding hands over: a shelf and one lead.
 *
 * Deliberately three fields and no seed. The story idea is the one thing the
 * flow no longer asks for, because the aha moved from "read a preview of a
 * story you described" to "meet a person you made", and arriving in Create with
 * somebody else's sentence in the idea box is worse than arriving with an empty
 * one and a character already cast.
 */
type OnboardingDraft = Pick<
  CreateDraft,
  "primaryGenre" | "genres" | "characters"
>;

/** The free welcome grant, per `source-of-truth/CREDITS_AND_PRICING.md`. */
const WELCOME_CREDITS = 3;

/**
 * How many coins fly, always. A subscriber's grant is twenty or fifty credits
 * and neither is a number of coins anybody wants thrown at them.
 */
const WELCOME_COINS = 3;

/**
 * The offline stand-in `generate-character-image` returns when Supabase is not
 * configured. It is not a URL any `<Image>` can load, so it must not be carried
 * into the Create studio's character card as a portrait.
 */
const DRAFT_PORTRAIT_SCHEME = "draft-character://";

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
   * Has the writer's own shelf come back from the server?
   *
   * `fetchMyStories` swallows every failure into an empty array, so the boot
   * read uses `fetchCreatedShelf`, which can say it failed. Without
   * this Home cannot tell "you have written nothing" from "we could not find
   * out", and tells a writer with a bad connection to start their first story.
   */
  const [shelfLoaded, setShelfLoaded] = useState(false);
  /** The genre of the saved, never-generated brief. Undefined until read. */
  const [savedDraftGenre, setSavedDraftGenre] = useState<string | null | undefined>(
    undefined,
  );
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
   * The Katha Originals, read from the database on boot. Metadata only: a
   * tap hydrates the one story chosen (see `openStory`).
   *
   * Empty until the read answers, and empty for good when it fails -- and
   * empty means "show the bundled seed catalogue instead", so an offline
   * first launch still opens onto a Home with something on it. The rule that
   * swaps one for the other lives in `buildStoryCatalogue`.
   */
  const [curatedStories, setCuratedStories] = useState<Story[]>([]);
  /**
   * The reader's streak in days, or null while it is unknown.
   *
   * Null is the honest starting value and the honest resting value: nothing
   * writes a streak from the client, and `fetchReadingStreak` returns null
   * for every case that is not a real row. Home draws the flame only for a
   * number. See `src/lib/streak.ts`.
   */
  const [streakDays, setStreakDays] = useState<number | null>(null);
  /**
   * What to call this reader, for Home's greeting.
   *
   * Read from the device cache first so the greeting has a name on the very
   * first frame, then overwritten by the server's answer. Onboarding asks for
   * this on its opening screen and, until now, threw it away: the value went
   * into React state and the next cold start lost it, so the one line in the
   * app that is about the person has never been able to name them.
   */
  const [displayName, setDisplayName] = useState<string | null>(null);
  /**
   * The profile handed to "Your journey" when it opens.
   *
   * The profile tab has already loaded these rows; passing them across means
   * the journey page draws its streak and its join date immediately instead of
   * showing zeros while it re-fetches the same thing.
   */
  const [journeyProfile, setJourneyProfile] = useState<OwnProfile | null>(null);
  /**
   * What the five onboarding questions collected, kept for the session.
   *
   * Home reads the genre interests to order its shelves, and the character
   * flow's own copy is voiced from the name. It is deliberately not persisted:
   * the durable parts of it (the display name, the saved character) are written
   * to the profile and to the character library as they are collected.
   */
  const [onboardingEntry, setOnboardingEntry] = useState<
    CharacterEntryContext | null
  >(null);
  /**
   * The character somebody made in onboarding, waiting to be written about.
   *
   * It is handed to the Create studio as a pre-filled draft, not generated on
   * arrival. The user presses Create themselves, which keeps the price on the
   * button and stops a bounce from spending their whole welcome grant on a
   * story nobody opens.
   */
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft | null>(
    null,
  );
  /**
   * The brief a reader starts from when they reimagine somebody else's story.
   *
   * Reimagine does not rewrite what they are reading. It opens Create with
   * that story's premise already in the box -- verbatim, so they can read
   * exactly what produced the story they liked and edit any word of it -- and
   * they write their own, with their own characters. Nothing is forked and the
   * original is never written to. See `lib/reimagine-seed.ts` for why.
   *
   * Held here rather than inside the studio because the studio is unmounted
   * while the reader is open: the seed has to survive the tab change that
   * carries the reader to Create.
   *
   * Cleared once the generation is away, so returning to Create later opens on
   * the writer's own persisted draft rather than on a stranger's premise.
   */
  const [reimagineSeed, setReimagineSeed] = useState<Partial<StudioDraft> | null>(
    null,
  );
  /**
   * A reimagine seed belongs to ONE visit to Create, and dies when that visit
   * ends.
   *
   * Without this it outlives the trip that created it: a reader taps Reimagine
   * on somebody else's story, reads the seeded brief, decides against it and
   * backs out -- and the next time they open Create, days later, it opens on a
   * stranger's premise with no explanation of where it came from. Clearing it
   * only when a generation starts covers the happy path and nothing else.
   *
   * Keyed on leaving the tab rather than on the studio's back button, because
   * the tab bar is a second way out and would have missed it. Setting the seed
   * and switching TO Create is safe: this only fires when the tab is not
   * Create, so the arrival it was set for cannot clear it.
   *
   * Declared here, beside the state it clears, and NOT next to `goTabs` where
   * it started: `goTabs` is defined below `if (!fontsReady) return`, so a hook
   * there is called conditionally and breaks the rules-of-hooks order.
   */
  useEffect(() => {
    if (tab !== "create") setReimagineSeed(null);
  }, [tab]);

  /**
   * Did this session just come through onboarding?
   *
   * Read by exactly one thing: the welcome credits flight, which plays once
   * after the hand-off to Home and never on a resumed session. It is cleared
   * the moment that decision has been made.
   */
  const [justOnboarded, setJustOnboarded] = useState(false);
  /** The flight overlay is mounted. Null `shownCredits` means it is not flying. */
  const [flightActive, setFlightActive] = useState(false);
  /**
   * The balance Home DISPLAYS while the coins are in the air, ticking 0 to 3.
   *
   * Separate from `credits`, which is the real balance and is never wrong: a
   * pill that already reads 3 while three coins fly towards it is a pill that
   * has nothing to say, and the flight exists to make the grant land somewhere
   * visible. Null hands the real number straight back.
   */
  const [shownCredits, setShownCredits] = useState<number | null>(null);
  /**
   * How far the flight counts up: the free grant, or the plan's credits when
   * the paywall was answered with a purchase. Held in state because the result
   * arrives at the hand-off and is needed a screen later, when the flight is
   * mounted over Home.
   */
  const [welcomeGrant, setWelcomeGrant] = useState(WELCOME_CREDITS);
  /** Counts taps into `openDiscoveredStory`; see the note there. */
  const openTapRef = useRef(0);
  const creditsPillRef = useRef<View | null>(null);
  const creditsBump = useSharedValue(1);
  const generations = useGenerations();
  /**
   * What is being written right now, for Home's invitation card.
   *
   * `writingStoryId` is the live one; `liveStoryIds` is every story a session
   * has touched, which Home subtracts from its "finish this series" search --
   * a provisional row looks exactly like a part-written series, and telling
   * somebody to finish the story they are watching being written is the one
   * thing that card must never do.
   */
  const writingSession = generations.find((session) => session.phase === "writing")
    ?? null;
  /*
    ONLY THE ONES STILL BEING WRITTEN.

    `home-cta.ts` excludes these from its "Finish your story" search, because a
    provisional row inserted mid-generation is, to the letter, the shape of a
    part-written series. This mapped over EVERY session regardless of phase, so
    a story that finished generating minutes ago stayed excluded until its
    session was pruned -- and the freshest series, the one the writer is most
    likely to want to continue, was the one the card refused to offer.
  */
  /*
    BOTH IDS, NOT `storyId ?? id`.

    A session is knowable by two names and they are live at the same time. The
    provisional row this session puts in `allStories` is keyed by the SESSION
    id and keeps that key for its whole life, while `storyId` is filled in the
    moment the first `meta` event arrives -- long before the writing finishes.
    So `storyId ?? id` names the row that does not exist yet and stops naming
    the row that does, and from that moment the session's own story no longer
    matches itself.

    The visible cost was a story opening its story page while it was still
    being written: a front door with a cover and a Read button, for prose that
    is still arriving. Home only escaped it by accident, passing an id that
    resolved to no story at all and falling through a different branch.

    A session is one story under two names until the server has caught up.
    Both belong in the set.
  */
  const liveStoryIds = generations
    .filter((session) => session.phase === "writing")
    .flatMap((session) => [session.storyId, session.id])
    .filter((id): id is string => Boolean(id));

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
    })
      // Boot even if a face does not arrive.
      //
      // This used to be a bare `.then`. `Font.loadAsync` rejects -- on web it
      // gives up after six seconds -- and an unhandled rejection left
      // `fontsReady` false forever, which renders `LaunchScreen` forever: the
      // splash is the whole app until this resolves. One slow font request on
      // a weak network was therefore an app that never opened, with no error
      // and no way out but a reload. A missing face falls back to the system
      // font, which is a cosmetic loss; never opening is a total one.
      .catch((error) => {
        console.warn("Font loading failed; falling back to system fonts:", error);
        // A boot that silently lost the brand face is worth knowing about:
        // it is invisible to the user (the system font substitutes cleanly)
        // and it is the same failure that used to hang the splash.
        captureError({
          bucket: "client.app",
          severity: "low",
          errorCode: "font_load_failed",
          error,
        });
      })
      .then(() => setFontsReady(true));
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

        // Cache first, then the record. Both are allowed to be null: a reader
        // who never gave a name is greeted by the time of day alone rather
        // than by a placeholder.
        void cachedDisplayName().then((cached) => {
          if (active && cached) setDisplayName(cached);
        });
        void fetchOwnProfile().then((profile) => {
          if (!active || !profile) return;
          setDisplayName(profile.displayName);
          void cacheDisplayName(profile.displayName);
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
        // `fetchCreatedShelf`, not `fetchMyStories`: the latter turns every
        // failure into an empty array, and flagging the shelf loaded off that
        // is precisely the bug `home-cta.ts` documents itself as preventing --
        // a writer with three stories and a bad connection being told to start
        // their first one. "Empty" and "we could not ask" are different
        // answers, and only the first of them licenses that copy.
        void fetchCreatedShelf().then((shelf) => {
          if (!active) return;
          if (!shelf.ok) return;
          setShelfLoaded(true);
          if (shelf.stories.length === 0) return;
          setGeneratedStories((current) => {
            const seen = new Set(current.map((story) => story.id));
            return [
              ...current,
              ...shelf.stories.filter((story) => !seen.has(story.id)),
            ];
          });
        });
      }
    }).catch((error) => {
      // The visible app is intentionally sign-in-free. Leave paid actions
      // unavailable until a later retry can establish their server identity.
      console.warn("Guest bootstrap failed:", error);
    }).finally(() => {
      // The Katha Originals, once the session question is settled either way.
      //
      // After it rather than beside it so the read goes out with whatever
      // identity the boot established, the way the created shelf does. But
      // in `finally`, not in the `then`: RLS lets the anonymous key read
      // curated stories with no session at all, so a failed bootstrap (a
      // rate-limited anonymous sign-in, say) is no reason to show a reader
      // the placeholder catalogue when the real one is readable.
      //
      // `fetchCuratedStories` never rejects and answers `[]` for every
      // failure, and an empty answer is left alone rather than written: the
      // seed catalogue is what an empty `curatedStories` means.
      if (!active) return;
      void fetchCuratedStories().then((curated) => {
        if (active && curated.length > 0) setCuratedStories(curated);
      });
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
        /*
          THE PLAN IS RAISED FROM THE CHAPTER, NOT FROM A FLAG.

          An extension raises `planned_chapter_count` server-side, and the
          client holds its own copy of the story — so without this the local
          plan stayed at 1 after extending a one-chapter story, and every
          surface reading it (the chapter-end chips, `canExtend`, the finish
          card) was working from a number the database had already moved past.
          Offline it never moved at all, so the same extension was offered for
          ever.

          Derived rather than signalled, because a story that HAS chapter N is
          planned for at least N whatever anybody remembered to send. That is
          true of an extension, of a plain continuation, and of a story read
          back from a shelf, which is three fewer things to keep in step.
        */
        // `plannedChapterCountOf`, not `?? 0`: a story with no stored plan
        // falls back to the server's default of 3, and a bare zero would have
        // turned "no plan recorded" into "planned for exactly the chapters it
        // has" -- telling the reader a legacy story was planned for 2 chapters
        // and stopping an auto story one chapter short of what the server
        // would happily have written.
        const planned = Math.max(
          plannedChapterCountOf(target),
          chapter.chapterNumber,
        );
        // A seed story being continued is not in `generatedStories` yet, so
        // `upsert` adds it rather than mapping over it.
        upsert({
          ...target,
          plannedChapterCount: planned,
          chapters: [...target.chapters, chapter],
        });
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
  /**
   * The balance as of the last charge, readable synchronously.
   *
   * `credits` is state and lands a render after the charge that changed it.
   * Anything that decides whether to SPEND needs the number as it is now, not
   * as it was before the chapter that just finished. See the charge effect.
   */
  const availableCreditsRef = useRef(credits);
  useEffect(() => {
    availableCreditsRef.current = credits;
  }, [credits]);
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
    /*
      THE REF IS DECREMENTED SYNCHRONOUSLY, THE STATE IS NOT.

      Both this effect and the auto write-ahead below key on `generations`, so
      the tick a chapter completes runs both -- this one first, in declaration
      order. But `setCredits` is a state update: the `credits` the write-ahead
      closes over in that same pass is still the pre-charge number, one chapter
      too high. Auto mode would then start a chapter the balance could not pay
      for and take a 402, with nobody having tapped anything.

      Too-high is the dangerous direction, and it is the exact failure the
      write-ahead's balance gate exists to prevent. So the gate reads this ref,
      which is correct the instant the charge is known, rather than the state,
      which is correct one render later.
    */
    availableCreditsRef.current = Math.max(0, availableCreditsRef.current - total);
    setCredits((value) => Math.max(0, value - total));
  }, [generations]);

  const allStories = useMemo(
    () =>
      buildStoryCatalogue({
        generated: generatedStories,
        discovered: discoveredStories,
        curated: curatedStories,
        seed: stories,
      }),
    [generatedStories, discoveredStories, curatedStories],
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

  /**
   * Auto-continue writes the next chapter while the reader is still inside
   * this one.
   *
   * WHY IT IS HERE AND NOT IN `ChapterEnd`. That component is mounted only
   * while the reader is physically on the last page of a chapter, which makes
   * it exactly the wrong place to START something early -- by the time it
   * exists, the reader is already at the end and the 7-to-8 second wait for a
   * continuation is theirs to sit through. Above the reader, watching the
   * session store, is the one place that learns a chapter was persisted at the
   * instant it happens, whichever screen asked for it and whether or not that
   * screen still exists. `ChapterEnd` keeps its own fire as the fallback for
   * when this did not run.
   *
   * IT NEEDS SOMEBODY READING. Gated on the reader being open on this story,
   * not merely on a session completing: a writer who started a story and went
   * back to Home has not asked for the rest of the series to be bought in the
   * background. Leaving the reader stops the chain at the chapter in hand, and
   * returning to it picks up again.
   *
   * Every other rule -- auto only, owner only, never past the planned ending,
   * never while a chapter is in flight, never twice for one chapter, never
   * without the credit -- lives in `autoChapterToWriteAhead`, so this and the
   * chapter end cannot drift into disagreeing about them.
   */
  useEffect(() => {
    if (!readerStoryId) return;
    const story = allStories.find((item) => item.id === readerStoryId);
    if (!story) return;
    startAutoChapterAhead({
      story,
      // The ref, not the state: on the tick a chapter completes, the state is
      // still one charge behind. See `availableCreditsRef`.
      credits: availableCreditsRef.current,
      // The same derivation the chapter end shows a reader, off the newest
      // persisted chapter -- but the WHOLE ranked list, not its head. Which
      // one gets written is the server's call: `chooseDirection` reads how the
      // chapter actually ended and takes the direction it earned, where this
      // ranking can only ever say "the plan beat comes first". An empty list
      // is "Katha decides", so an auto story never stalls on a chapter the
      // resolver could not read.
      resolveDirections: () => {
        const latest = story.chapters.reduce(
          (newest, item) =>
            item.chapterNumber > newest.chapterNumber ? item : newest,
          story.chapters[0],
        );
        return latest ? deriveContinuationOptions(story, latest) : [];
      },
    });
  }, [readerStoryId, allStories, credits, generations]);

  /**
   * The saved brief, re-read every time Home comes into view.
   *
   * It is not stable state: `loadDraft` deletes anything older than seven days
   * as it reads, and a completed generation clears it. Reading once on mount
   * would leave Home offering a draft that no longer exists.
   */
  useEffect(() => {
    if (screen.name !== "tabs" || tab !== "home") return;
    let active = true;
    void loadDraft().then((draft) => {
      if (!active) return;
      const seed = typeof draft?.seed === "string" ? draft.seed.trim() : "";
      setSavedDraftGenre(
        seed.length > 0 ? (genreLabels[draft?.primaryGenre as Genre] ?? null) : null,
      );
    }).catch(() => {
      if (active) setSavedDraftGenre(null);
    });
    return () => {
      active = false;
    };
  }, [screen.name, tab]);

  /**
   * Home's credits pill, in window coordinates, for the coins to fly to.
   *
   * `measureInWindow` rather than a guessed rectangle: the pill's position
   * moves with the safe-area inset, with the streak pill beside it and with the
   * width of the credit number. Zeros come back when the view is not laid out
   * or has been collapsed by Android, and zeros are reported as "no target" so
   * the flight fades in place instead of throwing coins into the corner.
   */
  const measureCreditsPill = useCallback(
    () =>
      new Promise<FlightTarget | null>((resolve) => {
        const node = creditsPillRef.current;
        if (!node) {
          resolve(null);
          return;
        }
        node.measureInWindow((x, y, width, height) => {
          resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
        });
      }),
    [],
  );

  /**
   * The welcome credits flight, armed by onboarding and played once ever.
   *
   * Two gates, and both are needed. `justOnboarded` is the session gate: a
   * resumed app has not just been granted anything, and three coins flying at
   * the header on a cold start is an animation with nothing to say.
   * `hasPlayedWelcomeFlight` is the install gate, because onboarding can be
   * walked again after a sign-out. The flag is cleared as soon as the question
   * has been answered, so a tab change cannot ask it a second time.
   */
  useEffect(() => {
    if (!justOnboarded) return;
    if (screen.name !== "tabs" || tab !== "home") return;
    let active = true;
    void hasPlayedWelcomeFlight().then((played) => {
      if (!active) return;
      setJustOnboarded(false);
      if (played) return;
      // Zero, not the real balance: the coins are what deliver the three.
      setShownCredits(0);
      setFlightActive(true);
    });
    return () => {
      active = false;
    };
  }, [justOnboarded, screen.name, tab]);

  if (!fontsReady) return <LaunchScreen />;

  if (preview === "loader") return <LoaderPreview />;
  if (preview === "narration-loader") return <NarrationLoaderPreview />;
  if (preview === "originals") return <OriginalsCoverPreview />;

  // `openTarget` -- whether a tap lands on the story page or straight in the
  // prose -- lives in `lib/story-catalogue.ts` beside the hydrate-on-open
  // decision it has to be made after. BOTH openers below route through it;
  // an inline copy of the rule here is how the two once disagreed.
  const liveStoryIdSet = new Set(liveStoryIds);

  const openStory = (storyId: string) => {
    const story = allStories.find((item) => item.id === storyId);
    // A Katha Original arrives without its chapters (`fetchCuratedStories`
    // is metadata only), and so does anything else read the same way. Every
    // screen hands its taps to this one function -- Home's rails, Tonight,
    // Explore's browse, Story detail's "more like this" -- so this is the
    // single place a chapterless story can be caught before the reader opens
    // onto a cover, a title and no words. It takes the same road Explore's
    // search results do.
    if (
      story &&
      needsChapters(
        story,
        new Set(generatedStories.map((item) => item.id)),
      )
    ) {
      void openDiscoveredStory(story);
      return;
    }
    // An id that resolves to nothing is a story being written whose first
    // page has not landed yet: `allStories` only gains a provisional row once
    // a session has revealed prose. The reader is the screen that knows how
    // to stand in for that (`provisionalStory`), so it keeps those taps.
    setScreen(
      story && openTarget(story, liveStoryIdSet) === "story"
        ? { name: "story", storyId }
        : { name: "reader", storyId },
    );
  };
  /**
   * Opens a story whose chapters the client does not have yet: a result from
   * Explore's search, or a Katha Original tapped anywhere (`openStory` routes
   * every chapterless story here).
   *
   * Two things have to happen before the navigation, and in this order.
   * First the chapters are fetched: both reads return metadata only, so the
   * story in hand has an empty `chapters` array and the reader would open on
   * a blank page. Then it is merged into `discoveredStories`, so the id the
   * screen is about to be pointed at actually resolves in `allStories`.
   *
   * The routing decision is made on the HYDRATED copy, not on `allStories`:
   * state set a line earlier is not visible to a read on the same tick, so
   * consulting the list here would decide on a copy with no chapters in it.
   *
   * And if the fetch FAILS, nothing is navigated to. Opening the reader on
   * the metadata-only copy put people inside a story with a cover, a title
   * and no words, with nothing to retry — indistinguishable from a story
   * that had never been written. Staying on Explore with an explanation
   * leaves the tap available to try again.
   */
  const openDiscoveredStory = async (story: Story) => {
    // Only the most recent tap may navigate. Two taps in quick succession
    // hydrate concurrently and can finish in either order; without this the
    // slower, older one would pull the reader away from what they chose last.
    const tap = ++openTapRef.current;
    const opened = await hydrateForOpen(story, loadStoryChapters);
    if (tap !== openTapRef.current) return;
    if (opened.kind === "unreachable") {
      Alert.alert(
        "We could not open that story",
        "Check your connection and try again.",
      );
      return;
    }
    // A story with no published chapter is a real answer from the server,
    // not a failure to retry -- and still not something to open. The reader
    // and the series page both assume a first chapter, so navigating showed
    // an empty page with no explanation. Say so, and stay where the tap was.
    if (opened.kind === "unpublished") {
      Alert.alert(
        "This story is not ready yet",
        "Its first chapter has not been published. Try another story.",
      );
      return;
    }
    const full = opened.story;
    setDiscoveredStories((current) =>
      current.some((item) => item.id === full.id)
        ? current.map((item) => (item.id === full.id ? full : item))
        : [...current, full]
    );
    setScreen(
      openTarget(full, liveStoryIdSet) === "story"
        ? { name: "story", storyId: full.id }
        : { name: "reader", storyId: full.id },
    );
  };

  /**
   * The questionnaire is done; the character flow begins.
   *
   * One entry for all three purposes. It used to fork here - writers into a
   * separate flow, everybody else into a progress ring and a paywall - and the
   * fork is gone, because making a character is the aha whichever box was
   * ticked. The purpose rides along so the copy downstream can be voiced.
   */
  const startCharacterOnboarding = (payload?: KathaCharacterPathPayload) => {
    if (!payload) return;
    const entryContext: CharacterEntryContext = {
      name: payload.onboarding.name,
      genreInterests: payload.onboarding.genres,
      otherGenre: payload.onboarding.otherGenre,
      refine: payload.onboarding.refine,
      mood: payload.onboarding.mood,
      moment: payload.onboarding.moment,
    };
    setOnboardingEntry(entryContext);
    setScreen({
      name: "character-onboarding",
      purpose: payload.purpose,
      initialGenre: payload.initialGenre,
      entryContext,
    });
  };

  const finishCharacterOnboarding = (result: CharacterOnboardingResult) => {
    // The name is asked for on the first screen of onboarding and belongs to
    // the account, not to this session. Written locally straight away so the
    // greeting is right the moment they land on Home, and to the server in
    // the background so it survives the app being reinstalled.
    const given = onboardingEntry?.name?.trim() ?? "";
    if (given.length > 0) {
      setDisplayName(given);
      void cacheDisplayName(given);
      void saveDisplayName(given);
    }

    // W5 verified the code, so the identity behind every screen from here
    // on is a named one: re-read what the boot read for the guest.
    void completeSignIn();

    const { character } = result;
    // A `draft-character://` stand-in is what the offline path returns. It is
    // an id, not an image, so the studio is handed no portrait at all rather
    // than a card with a broken frame in it.
    const portraitUrl = character.portraitUrl
        && !character.portraitUrl.startsWith(DRAFT_PORTRAIT_SCHEME)
      ? character.portraitUrl
      : undefined;
    setOnboardingDraft({
      primaryGenre: result.primaryGenre,
      genres: [result.primaryGenre],
      characters: [
        {
          name: character.name,
          appearance: character.appearance,
          // The sheet asks for voice and motivation separately and onboarding
          // deliberately does not: a blank background is an empty field the
          // writer can fill in Create, where there is room for it.
          background: "",
          isHero: true,
          portraitUrl,
          portraitStatus: portraitUrl ? "ready" : "idle",
          savedCharacterId: character.savedCharacterId,
        },
      ],
    });

    // What the coins deliver. A subscriber bought fifty credits a minute ago
    // and watching three land instead reads as the purchase not having gone
    // through, so the animation counts up to what they actually got.
    setWelcomeGrant(result.purchasedCredits ?? WELCOME_CREDITS);
    // The flight is armed here and decided on arrival: only a session that came
    // through onboarding may play it, and only once per install.
    setJustOnboarded(true);
    // Straight into Create for a writer, because the character is the whole
    // reason they finished the flow and making them find it again is how it
    // gets lost. A reader lands on Home, where their shelf is.
    goTabs(result.purpose === "write" ? "create" : "home");
  };

  const goTabs = (nextTab: TabKey = tab) => {
    setTab(nextTab);
    setScreen({ name: "tabs" });
  };


  /**
   * The post-auth routine, run once a code has verified.
   *
   * Everything the boot read for the guest is re-read for the account that
   * just signed in: the balance, the streak, the profile (which carries the
   * entitlement override for a tester account, set by `fetchOwnProfile`), and
   * the store identity, so a purchase made on this device lands on this
   * account. Used by the sign-in screen and by onboarding's post-OTP path.
   */
  const completeSignIn = async () => {
    const user = await bootstrapUser().catch(() => null);
    if (user) {
      setCredits(
        resolveBootstrappedCredits(__DEV__, isSupabaseConfigured, user.balance),
      );
      void revenueCatService.logIn?.(user.userId);
    }
    // A verified code means a named session. `user.isAnonymous` says the same
    // thing whenever the bootstrap answered; the fallback is for when it did not.
    setIsAnonymous(user?.isAnonymous ?? false);
    void fetchReadingStreak().then((streak) => setStreakDays(streak?.current ?? null));
    const profile = await fetchOwnProfile().catch(() => null);
    if (profile) {
      setDisplayName(profile.displayName);
      void cacheDisplayName(profile.displayName);
      setJourneyProfile(profile);
      setEntitlementOverride(profile.entitlementOverride);
    }
  };

  /**
   * The session is gone (sign-out or deletion). Every piece of state that
   * belonged to the account is cleared and the app lands on sign-in, never on
   * a fresh guest (D1).
   */
  const leaveAccount = () => {
    void cacheDisplayName(null);
    setIsAnonymous(true);
    setDisplayName(null);
    // The questionnaire's answers belong to the person who just left.
    setOnboardingEntry(null);
    setGeneratedStories([]);
    setCredits(0);
    setStreakDays(null);
    setJourneyProfile(null);
    setEntitlementOverride(null);
    setTab("home");
    // `required`: there is no session behind this screen, so it has no back
    // arrow and no exit to the tabs.
    setScreen({ name: "onboarding", required: true });
  };

  const renderTab = () => {
    switch (tab) {
      case "home":
        return (
          <HomeScreen
            // The ticking number while the coins are in the air, the real
            // balance every other moment of the app's life.
            credits={shownCredits ?? credits}
            creditsPillRef={creditsPillRef}
            creditsBump={creditsBump}
            displayName={displayName}
            shelfLoaded={shelfLoaded}
            savedDraftGenre={savedDraftGenre}
            writingStoryId={writingSession?.storyId ?? writingSession?.id ?? null}
            // The chapter the live session is on, so the card opens the reader
            // where the prose is arriving rather than at chapter one.
            writingChapterIndex={writingSession
              ? Math.max(0, writingSession.chapterNumber - 1)
              : undefined}
            liveStoryIds={liveStoryIds}
            onContinueStory={(storyId, chapterIndex) =>
              setScreen({ name: "reader", storyId, chapterIndex })}
            onPaywall={() => setScreen({ name: "paywall" })}
            preferredGenres={toGenreKeys(onboardingEntry?.genreInterests)}
            // "Tonight only", so it lives for this session and no longer.
            mood={onboardingEntry?.mood ?? null}
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
            /*
              A reimagine seed outranks an onboarding blueprint: the reader
              tapped Reimagine seconds ago, and opening on a months-old
              onboarding draft instead would look like the button did nothing.
            */
            initialDraft={reimagineSeed ?? onboardingDraft ?? undefined}
            onGenerationStarted={(session) => {
              setReimagineSeed(null);
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
          />
        );
      case "profile":
        return (
          <ProfileScreen
            credits={credits}
            onJourney={(loaded) => {
              // Handed the profile the tab already loaded, so the journey page
              // opens with the numbers filled in instead of flashing zeros
              // while it fetches the same rows a second time.
              setJourneyProfile(loaded);
              setScreen({ name: "journey" });
            }}
            onPublicProfile={(authorId) =>
              setScreen({ name: "author", authorId })}
            onVoices={() => setScreen({ name: "voices" })}
            // `signOutToSignIn` has already cleared the session; this is the
            // app catching up with it and routing to sign-in (D1).
            onSignedOut={leaveAccount}
            onDeleted={(storiesKept) => {
              // The account is gone server-side, but its token is still on
              // this device until something removes it. Clearing it is what
              // stops the next launch restoring a session whose user no
              // longer exists, which `bootstrapUser` can only recover from by
              // minting a guest -- the exact identity D1 says must not appear
              // behind the sign-in screen.
              void signOutToSignIn();
              leaveAccount();
              Alert.alert(
                "Your account is deleted",
                storiesKept > 0
                  ? `${storiesKept} published ${
                    storiesKept === 1 ? "story stays" : "stories stay"
                  } readable without your name on ${
                    storiesKept === 1 ? "it" : "them"
                  }. Everything else is gone.`
                  : "Everything has been removed. Thanks for giving Katha a try.",
              );
            }}
            onCredits={() => setScreen({ name: "credits" })}
            onPaywall={() => setScreen({ name: "paywall" })}
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
            onCharacterPath={startCharacterOnboarding}
            onSignIn={() => setScreen({ name: "onboarding" })}
          />
        )
        : screen.name === "character-onboarding"
        ? (
          <CharacterOnboarding
            purpose={screen.purpose}
            initialGenre={screen.initialGenre}
            entryContext={screen.entryContext}
            onDone={finishCharacterOnboarding}
            // Back out of the character flow returns to the questions that
            // fed it, not to Home: leaving is how somebody changes an answer.
            // The answers that fed this attempt go with it, so an abandoned
            // run never leaves a mood behind for Home to act on.
            onExit={() => {
              setOnboardingEntry(null);
              setScreen({ name: "intro" });
            }}
          />
        )
        : screen.name === "onboarding"
        ? (
          /*
            Sign-in, reached from the profile and from every gated control.

            This USED to be the full character flow (bridge, a character
            sheet, a portrait wait, THEN email and code) with `purpose="read"`
            standing in for a bare sign-in. A person who tapped "Sign in" was
            walked through making a character before they were ever asked for
            an address, which is backwards for a returning reader. It is now
            just the email and the code, and either way out lands back on the
            tab they left.
          */
          <SignInScreen
            /*
              Navigate only once the account is rebuilt. `completeSignIn`
              bootstraps the session, refreshes the balance and the streak,
              fetches the profile and applies the entitlement override -- so
              firing it and navigating in the same tick renders the tabs
              against the account that just left. A tester is the clearest
              case: the premium override lands with `fetchOwnProfile`, so the
              paywall would flash before the member state did. `finally`, not
              `then`, because a failed refresh must still let the person in;
              the screens all tolerate a null profile.
            */
            onDone={() => completeSignIn().finally(() => goTabs())}
            /*
              No way out when sign-in IS the destination (D1). Reached from a
              tab, this is a reader who chose to sign in and may change their
              mind. Reached after a sign-out or a deletion, there is no session
              behind it: going back to the tabs would render Home with no
              identity, and the first `bootstrapUser` would mint the guest this
              PR exists to remove. `undefined` also drops the back arrow, so
              the way out is not offered and then refused.
            */
            onExit={screen.required ? undefined : () => goTabs()}
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
              <ReaderScreen
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
                /*
                  A reader's Reimagine leaves the reader entirely: seed the
                  brief from this story and put them in Create. The author's
                  control is Re-prompt and never reaches here -- `ReaderScreen`
                  decides which of the two the viewer gets.
                */
                onReimagineStory={(sourceStory) => {
                  setReimagineSeed(seedDraftFromStory(sourceStory));
                  goTabs("create");
                }}
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
                renderChapterEnd={(chapter, { reimagine, reimagineLabel }) => {
                  const story =
                    allStories.find((item) => item.id === screen.storyId) ??
                      allStories[0];
                  return (
                    <ChapterEnd
                      story={story}
                      chapter={chapter}
                      // The fallback's own balance gate, read from the ref
                      // rather than the state for the same reason the
                      // write-ahead reads it: on the tick a chapter completes
                      // the state is still one charge behind.
                      credits={availableCreditsRef.current}
                      // A standalone, and a series that has reached its
                      // planned ending, have no next chapter to offer. Rewriting
                      // is the one thing left, so the pill has to be reachable
                      // from the ending itself and not only from the chrome.
                      onReimagine={reimagine ?? undefined}
                      reimagineLabel={reimagineLabel}
                      onContinue={(direction, offered, extend) => {
                        const next = chapter.chapterNumber + 1;
                        startChapterGeneration({
                          story,
                          nextChapterNumber: next,
                          // An extension is never a finale. The plan is about
                          // to be raised to exactly this chapter, so the old
                          // test is true of every extension -- and a chapter
                          // written as a finale closes its threads, which is
                          // what the next set of chips is derived from. A
                          // story extendable once would then be extendable
                          // never again.
                          // ...EXCEPT THE ONE THAT REACHES THE CEILING, which
                          // has to be an ending or the story never gets one.
                          // At 15 the chips stop being offered, so a chapter
                          // written as a non-finale there leaves the story
                          // closed for good on an open hook and a
                          // next_chapter_pressure pointing at a chapter that
                          // can never exist. The last chapter a reader is
                          // allowed to buy is the last chapter, and it should
                          // read like one.
                          isFinale: extend
                            ? next >= MAX_PLANNED_CHAPTER_COUNT
                            : typeof story.plannedChapterCount === "number"
                            ? next >= story.plannedChapterCount
                            : false,
                          direction,
                          directionsOffered: offered,
                          extend,
                        });
                      }}
                    />
                  );
                }}
              />
            )
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
        : screen.name === "journey"
        ? (
          <JourneyScreen
            profile={journeyProfile}
            onBack={() => goTabs("profile")}
          />
        )
        : screen.name === "voices"
        ? <VoicesScreen onBack={() => goTabs("profile")} />
        : screen.name === "credits"
        ? (
          <CreditsScreen
            credits={credits}
            onBack={() => goTabs(tab)}
            onPaywall={() => setScreen({ name: "paywall" })}
            onJourney={(loaded) => {
              setJourneyProfile(loaded);
              setScreen({ name: "journey" });
            }}
            onBalance={(balance) =>
              setCredits(
                resolveBootstrappedCredits(__DEV__, isSupabaseConfigured, balance),
              )}
          />
        )
        : screen.name === "paywall"
        ? (
          /*
            The paywall outside onboarding, opened from Home or from Credits.

            The same component onboarding shows, with no character to put in
            its hero: there is one paywall in the app now, so the plan somebody
            is offered from the credits screen is the plan they were offered on
            their first day, at the same price with the same four promises. An
            empty `characterName` is what switches the copy to its no-character
            voice ("Katha is ready when you are"), so this entry never claims a
            character the user has not made. Both exits come back to the tab
            they left.
          */
          <OnboardingPaywall
            characterName=""
            portraitUrl={null}
            purpose="read"
            onSubscribed={() => goTabs(tab)}
            onDismiss={() => goTabs(tab)}
          />
        )
        : (
          <>
            {renderTab()}
            {tab === "create" ? null : (
              <BottomTabs selected={tab} onSelect={(next) => setTab(next)} />
            )}
            {flightActive
              ? (
                <WelcomeCreditsFlight
                  // Three coins whatever the grant is: the stack is the
                  // picture of a gift, the number is what the pill ticks to.
                  coins={WELCOME_COINS}
                  amount={welcomeGrant}
                  measureTarget={measureCreditsPill}
                  onLanded={(shown) => {
                    setShownCredits(shown);
                    bumpCredits(creditsBump);
                  }}
                  onDone={() => {
                    setFlightActive(false);
                    // Back to the real balance, which may already be more than
                    // three if the account had credits before onboarding.
                    setShownCredits(null);
                    void markWelcomeFlightPlayed();
                  }}
                />
              )
              : null}
          </>
        )}
      </ScreenScaffold>
    </SafeAreaProvider>
  );
}

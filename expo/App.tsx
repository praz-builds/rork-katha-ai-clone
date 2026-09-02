import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initSentry, initPostHog } from "@/lib/analytics";
import { initRevenueCat, revenueCatService } from "@/lib/revenuecat";
import { setupAndroidChannel } from "@/lib/notifications";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";
import {
  Bell,
  BookmarkCheck,
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  Home,
  Lock,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  Star,
  User,
  Wand2
} from "lucide-react-native";
import {
  Chip,
  Cover,
  PrimaryButton,
  ScreenScaffold,
  SectionHeader,
  StoryCard,
  FocalImage,
  formatNumber
} from "@/components/KathaPrimitives";
import { authorFor, genres, ledger, stories } from "@/data/seed";
import { imageAssets } from "@/data/images";
import { getDefaultVoices, getVoice } from "@/data/voices";
import CreateStudioScreen from "@/screens/CreateStudioScreen";
import KathaOnboardingComplete from "@/screens/KathaOnboardingComplete";
import KathaOnboardingFlowV2 from "@/screens/KathaOnboardingFlowV2";
import { colors, fonts, genreGradients, genreLabels, radius, spacing } from "@/theme";
import type { Genre, Screen, Story, TabKey } from "@/types/domain";
import type { KathaOnboardingResult } from "@/screens/KathaOnboardingFlowV2";

const GENRE_BY_LABEL = Object.fromEntries(
  Object.entries(genreLabels).map(([key, label]) => [label.toLowerCase(), key as Genre])
) as Record<string, Genre>;

/** Onboarding stores display labels; the app keys everything by Genre. */
const toGenreKeys = (labels: string[] | undefined): Genre[] =>
  (labels ?? []).map((label) => GENRE_BY_LABEL[label.trim().toLowerCase()]).filter(Boolean as unknown as (g: Genre | undefined) => g is Genre);

type LibrarySegment = "saved" | "history" | "myStories" | "comments";

export default function App() {
  const [fontsReady, setFontsReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "intro" });
  const [tab, setTab] = useState<TabKey>("home");
  const [credits, setCredits] = useState(3);
  const [generatedStories, setGeneratedStories] = useState<Story[]>([]);
  const [onboarding, setOnboarding] = useState<KathaOnboardingResult | null>(null);

  useEffect(() => {
    Font.loadAsync({
      BricolageGrotesque: require("./assets/fonts/BricolageGrotesque.ttf"),
      HankenGrotesk: require("./assets/fonts/HankenGrotesk.ttf"),
      Baloo2: require("./assets/fonts/Baloo2.ttf"),
      Literata: require("./assets/fonts/Literata.ttf"),
      LiterataItalic: require("./assets/fonts/Literata-Italic.ttf")
    }).then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    initSentry();
    initPostHog();
    initRevenueCat();
    setupAndroidChannel();
  }, []);

  const allStories = useMemo(() => [...generatedStories, ...stories], [generatedStories]);

  if (!fontsReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const openStory = (storyId: string) => setScreen({ name: "reader", storyId });
  const finishOnboarding = (result: KathaOnboardingResult) => {
    setOnboarding(result);
    goTabs("home");
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
            onProfile={() => setScreen({ name: "profile" })}
            onCreate={() => goTabs("create")}
          />
        );
      case "create":
        return (
          <CreateStudioScreen
            credits={credits}
            onCreditUsed={() => setCredits((value) => Math.max(0, value - 1))}
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
    }
  };

  return (
    <ScreenScaffold>
      <StatusBar style="dark" />
      {screen.name === "intro" ? (
        <KathaOnboardingComplete onDone={finishOnboarding} onSignIn={() => setScreen({ name: "onboarding" })} />
      ) : screen.name === "onboarding" ? (
        <KathaOnboardingFlowV2 initialScreen="email" onDone={finishOnboarding} />
      ) : screen.name === "reader" ? (
        <ReaderScreen story={allStories.find((story) => story.id === screen.storyId) ?? allStories[0]} onBack={() => goTabs(tab)} />
      ) : screen.name === "author" ? (
        <AuthorScreen authorId={screen.authorId} stories={allStories} onBack={() => goTabs(tab)} onStory={openStory} />
      ) : screen.name === "credits" ? (
        <CreditsScreen credits={credits} onBack={() => goTabs(tab)} />
      ) : screen.name === "paywall" ? (
        <KathaOnboardingFlowV2 initialScreen="paywall" onDone={finishOnboarding} />
      ) : screen.name === "profile" ? (
        <ProfileScreen
          credits={credits}
          onBack={() => goTabs(tab)}
          onCredits={() => setScreen({ name: "credits" })}
          onPaywall={() => setScreen({ name: "paywall" })}
          onCustomerCenter={() => {
            revenueCatService
              .presentCustomerCenter()
              .then((presented) => {
                // Unavailable on web, or the SDK never configured. Send the user
                // to the paywall rather than leaving the row doing nothing.
                if (!presented) setScreen({ name: "paywall" });
              })
              .catch((error) => {
                Alert.alert("Subscription management unavailable", "Please try again shortly.");
                console.warn("RevenueCat Customer Center failed:", error);
              });
          }}
        />
      ) : (
        <>
          {renderTab()}
          <BottomTabs selected={tab} onSelect={(next) => setTab(next)} />
        </>
      )}
    </ScreenScaffold>
  );
}

/* ─────────────────────────────── Home Screen ─────────────────────────────── */

function HomeScreen({
  credits,
  generatedStories,
  stories: allStories,
  onStory,
  onProfile,
  onCreate,
  preferredGenres = []
}: {
  credits: number;
  generatedStories: Story[];
  stories: Story[];
  onStory: (id: string) => void;
  onProfile: () => void;
  onCreate: () => void;
  preferredGenres?: Genre[];
}) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<Genre | "all">("all");
  const featured = allStories.filter((story) => story.isFeatured);
  const isNewUser = generatedStories.length === 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const filtered = allStories.filter((story) => {
    const q = query.trim().toLowerCase();
    return (
      (genre === "all" || story.genre === genre) &&
      (!q || story.title.toLowerCase().includes(q) || story.synopsis.toLowerCase().includes(q) || story.tags.join(" ").toLowerCase().includes(q) || authorFor(story.authorId).displayName.toLowerCase().includes(q))
    );
  });

  const showFiltered = query.trim().length > 0 || genre !== "all";

  // Genres the user picked during onboarding. Falls back for users who skipped it.
  const onboardingGenres: Genre[] = preferredGenres.length > 0 ? preferredGenres : ["adventure", "mystery", "fantasy"];
  const genreRows = onboardingGenres
    .map((g) => ({ genre: g, stories: allStories.filter((s) => s.genre === g) }))
    .filter((row) => row.stories.length > 0);

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.withTabs} showsVerticalScrollIndicator={false}>
        {/* Header with avatar */}
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{greeting}</Text>
            <Text style={styles.h1}>Stories for you</Text>
          </View>
          <Pressable onPress={onProfile} accessibilityLabel="Open profile" accessibilityRole="button" style={styles.avatarButton}>
            <Image source={require("./assets/icon.png")} style={styles.headerAvatar} />
            <View style={styles.creditBadge}>
              <Text style={styles.creditBadgeText}>{credits}</Text>
            </View>
          </Pressable>
        </View>

        {/* Search */}
        <View style={styles.searchBox}>
          <Search size={18} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search stories, moods, authors" placeholderTextColor={colors.tertiary} style={styles.searchInput} />
        </View>

        {/* Genre chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="All" selected={genre === "all"} onPress={() => setGenre("all")} />
          {genres.slice(0, 10).map((item) => (
            <Chip key={item} label={genreLabels[item]} selected={genre === item} onPress={() => setGenre(item)} />
          ))}
        </ScrollView>

        {showFiltered ? (
          <View style={styles.stack}>
            {filtered.map((story) => (
              <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
            ))}
          </View>
        ) : isNewUser ? (
          <>
            {/* Primary write CTA */}
            <View style={styles.writeCTACard}>
              <Text style={styles.writeCTATitle}>Start your first story</Text>
              <Text style={styles.writeCTASubtitle}>Genre, characters, your idea. Katha brings it to life</Text>
              <View style={styles.writeCTAButtonWrap}>
                <PrimaryButton onPress={onCreate}>Create a story</PrimaryButton>
              </View>
            </View>

            {/* Or pick one to read */}
            <SectionHeader title="Or pick one to read" />
            <HorizontalStories stories={featured} onStory={onStory} />

            {/* Genre rows */}
            {genreRows.map((row) => (
              <View key={row.genre}>
                <SectionHeader title={genreLabels[row.genre]} />
                <HorizontalStories stories={row.stories} onStory={onStory} />
              </View>
            ))}
          </>
        ) : (
          <>
            {/* Continue reading card */}
            <Pressable onPress={() => onStory(featured[0].id)} style={styles.continueCard}>
              <View style={styles.continueCopy}>
                <Text style={styles.continueEyebrow}>Continue reading</Text>
                <Text style={styles.continueTitle}>{featured[0].title}</Text>
                <Text style={styles.continueMeta}>40% read - Chapter 2 waits</Text>
              </View>
              <Cover story={featured[0]} size="mini" />
            </Pressable>

            {/* Write another CTA (smaller, accentSoft) */}
            <Pressable onPress={onCreate} style={styles.writeAnotherBand}>
              <View style={styles.writeAnotherIcon}>
                <Plus size={20} color={colors.accent} />
              </View>
              <Text style={styles.writeAnotherText}>Write another story</Text>
              <ChevronRight size={18} color={colors.accent} />
            </Pressable>

            {/* Trending */}
            <SectionHeader title="Trending now" action="See all" />
            <HorizontalStories stories={featured} onStory={onStory} />

            {/* Genre rows */}
            {genreRows.map((row) => (
              <View key={row.genre}>
                <SectionHeader title={genreLabels[row.genre]} />
                <HorizontalStories stories={row.stories} onStory={onStory} />
              </View>
            ))}

            {/* For you */}
            <SectionHeader title="For you" />
            <View style={styles.stack}>
              {allStories.slice(2, 7).map((story) => (
                <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────────── Library Screen ─────────────────────────────── */

function LibraryScreen({
  generatedStories,
  stories: allStories,
  onStory,
  onCreate
}: {
  generatedStories: Story[];
  stories: Story[];
  onStory: (id: string) => void;
  onCreate: () => void;
}) {
  const [segment, setSegment] = useState<LibrarySegment>("saved");
  const saved = allStories.filter((story) => story.bookmarks > 100);
  const history = allStories.slice(0, 5);

  const segments: { key: LibrarySegment; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "history", label: "History" },
    { key: "myStories", label: "My Stories" },
    { key: "comments", label: "Comments" }
  ];

  const renderSegmentContent = () => {
    switch (segment) {
      case "saved":
        return saved.length > 0 ? (
          <View style={styles.stack}>
            {saved.map((story) => (
              <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Bookmark size={32} color={colors.tertiary} />
            <Text style={styles.emptyStateText}>Bookmark stories you love</Text>
          </View>
        );
      case "history":
        return history.length > 0 ? (
          <View style={styles.stack}>
            {history.map((story) => (
              <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>Stories you read will appear here</Text>
          </View>
        );
      case "myStories":
        return generatedStories.length > 0 ? (
          <View style={styles.stack}>
            {generatedStories.map((story) => (
              <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No stories yet.{" "}
              <Text style={styles.accentLink} onPress={onCreate}>Create your first!</Text>
            </Text>
          </View>
        );
      case "comments":
        return (
          <View style={styles.emptyState}>
            <MessageCircle size={32} color={colors.tertiary} />
            <Text style={styles.emptyStateText}>Your comments on stories will appear here</Text>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.withTabs} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Library</Text>
            <Text style={styles.h1}>Your collection</Text>
          </View>
          <Bookmark size={28} color={colors.accent} />
        </View>

        {/* Segment selector */}
        <View style={styles.segmented}>
          {segments.map(({ key, label }) => (
            <Pressable key={key} onPress={() => setSegment(key)} style={[styles.segment, segment === key && styles.segmentSelected]}>
              <Text style={[styles.segmentText, segment === key && styles.segmentTextSelected]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.segmentContent}>
          {renderSegmentContent()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────────── Profile Screen (overlay) ─────────────────────────────── */

function ProfileScreen({
  credits,
  onBack,
  onCredits,
  onPaywall,
  onCustomerCenter
}: {
  credits: number;
  onBack: () => void;
  onCredits: () => void;
  onPaywall: () => void;
  onCustomerCenter: () => void;
}) {
  const settingsRows = [
    ["Notifications", "Chapter alerts and streak nudges", Bell],
    ["Reading preferences", "Theme, font size, language", BookOpen],
    ["Katha Plus", "Subscription, voices, ad-free", Star],
    ["Parental controls", "Kids mode and PIN gate", Lock],
    ["Feedback", "Comments, rating, support", MessageCircle]
  ] as const;

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.pagePad} showsVerticalScrollIndicator={false}>
        {/* Header with back button */}
        <View style={styles.profileHeader}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <ChevronLeft size={20} color={colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
          <View style={styles.backButton} />
        </View>

        {/* User card */}
        <View style={styles.profileCard}>
          <Image source={require("./assets/icon.png")} style={styles.profileAvatar} />
          <Text style={styles.profileName}>Reader Writer</Text>
          <Text style={styles.profileMeta}>@you - 3-day streak</Text>
          <View style={styles.profileActions}>
            <View style={styles.profileButtonRow}>
              <View style={styles.profileButtonHalf}>
                <PrimaryButton variant="secondary" onPress={onPaywall}>See Plus</PrimaryButton>
              </View>
              <View style={styles.profileButtonHalf}>
                <PrimaryButton variant="secondary" onPress={() => Alert.alert("Coming soon", "Profile editing will be available soon.")}>Edit Profile</PrimaryButton>
              </View>
            </View>
          </View>
        </View>

        {/* Credits row */}
        <Pressable onPress={onCredits} style={styles.creditsRow}>
          <View style={styles.settingsIcon}>
            <Sparkles size={20} color={colors.accent} />
          </View>
          <View style={styles.settingsText}>
            <Text style={styles.settingsTitle}>Credits</Text>
            <Text style={styles.settingsSubtitle}>{credits} available</Text>
          </View>
          <ChevronRight size={20} color={colors.tertiary} />
        </Pressable>

        {/* Settings rows */}
        <View style={styles.settingsList}>
          {settingsRows.map(([title, subtitle, Icon]) => {
            const handler = title === "Katha Plus" ? onCustomerCenter : () => Alert.alert("Coming soon", `${title} will be available soon.`);
            return (
              <Pressable key={title} onPress={handler} accessibilityRole="button" style={styles.settingsRow}>
                <View style={styles.settingsIcon}>
                  <Icon size={20} color={colors.accent} />
                </View>
                <View style={styles.settingsText}>
                  <Text style={styles.settingsTitle}>{title}</Text>
                  <Text style={styles.settingsSubtitle}>{subtitle}</Text>
                </View>
                <ChevronRight size={16} color={colors.tertiary} />
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.legalFooter}>Privacy Policy - Terms of Service - v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────────── Reader Screen ─────────────────────────────── */

type ReaderComment = { id: number; user: string; text: string; time: string };

const INITIAL_COMMENTS: ReaderComment[] = [
  { id: 1, user: "Mira R.", text: "This story had me hooked from the first line. The lighthouse metaphor is beautiful.", time: "2h ago" },
  { id: 2, user: "Dev S.", text: "Beautiful writing. The ending was unexpected but satisfying.", time: "5h ago" },
  { id: 3, user: "Aanya K.", text: "I want a sequel to this. What happens to the lighthouse?", time: "1d ago" },
];

function ReaderScreen({ story, onBack }: { story: Story; onBack: () => void }) {
  const author = authorFor(story.authorId);
  const [chapterIndex, setChapterIndex] = useState(0);
  const chapter = story.chapters[chapterIndex] ?? story.chapters[0];
  const hasMultipleChapters = story.chapters.length > 1;
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [isPlaying, setIsPlaying] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = windowWidth >= 768;

  // Derive the language code from the story's language field
  const storyLang = story.language === "Spanish" ? "es" : "en";
  const voicePair = getDefaultVoices(storyLang);
  const femaleVoice = getVoice(voicePair[0] ?? "aria");
  const maleVoice = getVoice(voicePair[1] ?? "kai");

  // Audio player state (expo-av)
  const soundRef = useRef<Audio.Sound | null>(null);

  // Local interaction state
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(story.likes);
  const [isSaved, setIsSaved] = useState(false);
  const [comments, setComments] = useState<ReaderComment[]>(INITIAL_COMMENTS);
  const [commentText, setCommentText] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const [shareToast, setShareToast] = useState(false);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const isLoadingAudioRef = useRef(false);

  const getAudioUrl = useCallback((): string | undefined => {
    // Prefer gender-specific audio, fallback to single audioUrl
    const genderUrl = voiceGender === "male" ? chapter.audioUrls?.male : chapter.audioUrls?.female;
    return genderUrl ?? chapter.audioUrl;
  }, [chapter.audioUrl, chapter.audioUrls, voiceGender]);

  const handlePlayTap = useCallback(async () => {
    if (isLoadingAudioRef.current) return;
    const audioUrl = getAudioUrl();
    if (!audioUrl) {
      Alert.alert("Audio narration", "Audio narration will be generated when this story is published.");
      return;
    }
    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
      } else if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      } else {
        isLoadingAudioRef.current = true;
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true },
          (status) => {
            if (status.isLoaded && status.didJustFinish) {
              setIsPlaying(false);
            }
          }
        );
        soundRef.current = sound;
        setIsPlaying(true);
        isLoadingAudioRef.current = false;
      }
    } catch {
      isLoadingAudioRef.current = false;
      Alert.alert("Playback error", "Could not play audio. Please try again.");
      setIsPlaying(false);
    }
  }, [isPlaying, getAudioUrl]);

  const handleVoiceChange = useCallback(async (gender: "female" | "male") => {
    if (gender === voiceGender || isLoadingAudioRef.current) return;
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
    setIsPlaying(false);
    setVoiceGender(gender);
  }, [voiceGender]);

  const handleLike = useCallback(() => {
    setIsLiked((prev) => {
      setLikeCount((count) => prev ? count - 1 : count + 1);
      return !prev;
    });
  }, []);

  const handleSave = useCallback(() => {
    setIsSaved((prev) => !prev);
  }, []);

  const handleShare = useCallback(async () => {
    const text = `${story.title} by ${author.displayName}\n\nRead on Katha AI`;
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(text);
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      } catch {
        Alert.alert("Share", text);
      }
    } else {
      try {
        await Share.share({ message: text });
      } catch {
        // User cancelled share
      }
    }
  }, [story.title, author.displayName]);

  const handleSubmitComment = useCallback(() => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    const newComment: ReaderComment = {
      id: Date.now(),
      user: "You",
      text: trimmed,
      time: "just now",
    };
    setComments((prev) => [newComment, ...prev]);
    setCommentText("");
    Alert.alert("Comment added", "Your comment is saved locally. Comments will persist after authentication is connected.");
  }, [commentText]);

  const handleFollow = useCallback(() => {
    setIsFollowing((prev) => !prev);
  }, []);

  const coverImage = story.coverImage ? imageAssets[story.coverImage] : undefined;
  const focalX = story.focalX ?? 0.5;
  const focalY = story.focalY ?? 0.5;

  // Only show voice toggle when both voices have audio
  const hasBothVoices = !!(chapter.audioUrls?.female && chapter.audioUrls?.male);

  // Shared content blocks
  const renderToolbar = (centered: boolean) => (
    <View style={[styles.readerToolbar, centered && styles.readerToolbarCentered]}>
      <Pressable onPress={handlePlayTap} style={styles.audioPill}>
        {isPlaying ? (
          <Pause size={16} color={colors.surface} />
        ) : (
          <Play size={16} color={colors.surface} />
        )}
        <Text style={styles.audioText}>{isPlaying ? "Playing" : "Listen"}</Text>
      </Pressable>
      {hasBothVoices && (
        <View style={styles.voiceToggle}>
          <Pressable
            onPress={() => handleVoiceChange("female")}
            style={[styles.voiceToggleBtn, voiceGender === "female" && styles.voiceToggleBtnActive]}
          >
            <Text style={[styles.voiceToggleText, voiceGender === "female" && styles.voiceToggleTextActive]}>{femaleVoice.name}</Text>
          </Pressable>
          <Pressable
            onPress={() => handleVoiceChange("male")}
            style={[styles.voiceToggleBtn, voiceGender === "male" && styles.voiceToggleBtnActive]}
          >
            <Text style={[styles.voiceToggleText, voiceGender === "male" && styles.voiceToggleTextActive]}>{maleVoice.name}</Text>
          </Pressable>
        </View>
      )}
      <Pressable onPress={handleSave} accessibilityLabel={isSaved ? "Unsave story" : "Save story"} accessibilityRole="button">
        {isSaved ? (
          <BookmarkCheck size={18} color={colors.sepiaSecondary} />
        ) : (
          <Bookmark size={18} color={colors.sepiaSecondary} />
        )}
      </Pressable>
      <Pressable onPress={handleShare} accessibilityLabel="Share story" accessibilityRole="button">
        <Share2 size={18} color={colors.sepiaSecondary} />
      </Pressable>
    </View>
  );

  const renderBody = () => (
    <>
      {/* Share toast */}
      {shareToast && (
        <View style={styles.shareToast}>
          <Text style={styles.shareToastText}>Copied to clipboard!</Text>
        </View>
      )}

      {/* Chapter navigation */}
      {hasMultipleChapters && (
        <View style={styles.chapterNav}>
          {story.chapters.map((ch, i) => (
            <Pressable
              key={ch.id}
              onPress={() => {
                if (i !== chapterIndex) {
                  if (soundRef.current) {
                    soundRef.current.unloadAsync();
                    soundRef.current = null;
                  }
                  setIsPlaying(false);
                  setChapterIndex(i);
                }
              }}
              style={[styles.chapterNavBtn, i === chapterIndex && styles.chapterNavBtnActive]}
            >
              <Text style={[styles.chapterNavText, i === chapterIndex && styles.chapterNavTextActive]}>
                Ch {ch.chapterNumber}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.chapterTitle}>{chapter.title}</Text>
      {chapter.paragraphs.map((paragraph, index) => (
        <Text key={`${chapter.id}-${index}`} style={[styles.paragraph, isDesktop && styles.paragraphDesktop]}>
          {paragraph}
        </Text>
      ))}

      {/* Engagement bar (Substack-style) */}
      <View style={styles.engagementDivider} />
      <View style={styles.engagementRow}>
        <Pressable onPress={handleLike} accessibilityLabel={`Like, ${formatNumber(likeCount)}`} accessibilityRole="button" style={styles.engagementAction}>
          <Heart size={16} color={isLiked ? colors.heart : colors.sepiaText} fill={isLiked ? colors.heart : "none"} />
          <Text style={styles.engagementCount}>{formatNumber(likeCount)}</Text>
        </Pressable>
        <View style={styles.engagementAction}>
          <MessageCircle size={16} color={colors.sepiaText} />
          <Text style={styles.engagementCount}>{comments.length}</Text>
        </View>
        <Pressable onPress={handleSave} accessibilityLabel={isSaved ? "Unsave" : "Save"} accessibilityRole="button" style={styles.engagementAction}>
          {isSaved ? (
            <BookmarkCheck size={16} color={colors.sepiaText} />
          ) : (
            <Bookmark size={16} color={colors.sepiaText} />
          )}
        </Pressable>
        <Pressable onPress={handleShare} accessibilityLabel="Share" accessibilityRole="button" style={styles.engagementAction}>
          <Share2 size={16} color={colors.sepiaText} />
        </Pressable>
      </View>

      {/* Author section */}
      <View style={styles.authorDivider} />
      <View style={styles.readerAuthorCard}>
        <View style={styles.readerAuthorCardTop}>
          <View style={styles.authorAvatarSmall}>
            <Text style={styles.authorInitialSmall}>{author.displayName.charAt(0)}</Text>
          </View>
          <View style={styles.readerAuthorInfo}>
            <Text style={styles.readerAuthorName}>{author.displayName}</Text>
            <Text style={styles.readerAuthorBio} numberOfLines={2}>{author.bio}</Text>
          </View>
        </View>
        <Pressable onPress={handleFollow} style={[styles.followButton, isFollowing && styles.followButtonFollowing]}>
          <Text style={[styles.followButtonText, isFollowing && styles.followButtonTextFollowing]}>{isFollowing ? "Following" : "Follow"}</Text>
        </Pressable>
      </View>

      {/* Comments section */}
      <View style={styles.authorDivider} />
      <View style={styles.commentsSection}>
        <Text style={styles.commentsSectionTitle}>Comments ({comments.length})</Text>

        {/* Comment input */}
        <View style={styles.commentInputRow}>
          <View style={styles.commentInputAvatar}>
            <Text style={styles.commentInputAvatarText}>Y</Text>
          </View>
          <View style={styles.commentInputWrap}>
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment..."
              placeholderTextColor={colors.tertiary}
              style={styles.commentInput}
              multiline
              maxLength={500}
            />
          </View>
          {commentText.trim().length > 0 && (
            <Pressable onPress={handleSubmitComment} accessibilityLabel="Submit comment" accessibilityRole="button" style={styles.commentSendBtn}>
              <Send size={16} color={colors.surface} />
            </Pressable>
          )}
        </View>

        {/* Comment list */}
        {comments.map((comment) => (
          <View key={comment.id} style={styles.commentItem}>
            <View style={styles.commentItemAvatar}>
              <Text style={styles.commentItemAvatarText}>{comment.user.charAt(0)}</Text>
            </View>
            <View style={styles.commentItemContent}>
              <View style={styles.commentItemMeta}>
                <Text style={styles.commentItemUser}>{comment.user}</Text>
                <Text style={styles.commentItemTime}>{comment.time}</Text>
              </View>
              <Text style={styles.commentItemText}>{comment.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );

  const heroFocalY = Math.max(0, focalY - 0.02);
  const desktopStickyStyle = Platform.OS === "web"
    ? ({ position: "sticky", top: 20 } as unknown as { position: "relative"; top: number })
    : {};

  if (isDesktop) {
    // ── Desktop: two-column layout ──
    return (
      <View style={styles.reader}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.desktopContainer}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <ChevronLeft size={18} color={colors.ink} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>

            <View style={styles.desktopTwoCol}>
              {/* Left column: cover */}
              <View style={[styles.desktopCoverCol, desktopStickyStyle]}>
                <View style={styles.desktopCoverWrap}>
                  {coverImage ? (
                    <FocalImage
                      source={coverImage}
                      focalX={focalX}
                      focalY={focalY}
                      style={{ width: "100%", height: "100%" }}
                            />
                  ) : (
                    <LinearGradient colors={genreGradients[story.genre]} style={StyleSheet.absoluteFill} />
                  )}
                </View>
              </View>

              {/* Right column: text */}
              <View style={styles.desktopTextCol}>
                <Text style={styles.readerGenre}>{genreLabels[story.genre]}</Text>
                <Text style={styles.desktopTitle}>{story.title}</Text>
                <Text style={styles.desktopAuthor}>by <Text style={styles.desktopAuthorName}>{author.displayName}</Text></Text>
                {renderToolbar(false)}
                {renderBody()}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Mobile: full-bleed hero layout ──
  return (
    <View style={styles.reader}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Full-bleed hero image */}
        <View style={styles.mobileHeroWrap}>
          {coverImage ? (
            <FocalImage
              source={coverImage}
              focalX={focalX}
              focalY={heroFocalY}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <LinearGradient colors={genreGradients[story.genre]} style={StyleSheet.absoluteFill} />
          )}
          {/* Fade overlay */}
          <LinearGradient
            colors={["rgba(241,232,214,0)", "rgba(241,232,214,0)", colors.sepia]}
            locations={[0, 0.66, 0.98]}
            style={StyleSheet.absoluteFill}
          />
          {/* Floating back button */}
          <Pressable onPress={onBack} style={styles.mobileHeroBackBtn}>
            <ChevronLeft size={16} color="#2c241d" />
            <Text style={styles.mobileHeroBackText}>Back</Text>
          </Pressable>
        </View>

        {/* Title block below hero */}
        <View style={styles.mobileMetaBlock}>
          <Text style={styles.mobileGenre}>{genreLabels[story.genre].toUpperCase()}</Text>
          <Text style={styles.mobileTitle}>{story.title}</Text>
          <Text style={styles.mobileAuthor}>by <Text style={styles.mobileAuthorName}>{author.displayName}</Text></Text>
          {renderToolbar(true)}
        </View>

        {/* Body content */}
        <View style={styles.mobileBodyPad}>
          {renderBody()}
        </View>
      </ScrollView>
    </View>
  );
}

/* ─────────────────────────────── Credits Screen ─────────────────────────────── */

function CreditsScreen({ credits, onBack }: { credits: number; onBack: () => void }) {
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={18} color={colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>Credits</Text>
        <Text style={styles.h1}>{credits} credits available</Text>
        <View style={styles.creditHero}>
          <Sparkles size={32} color={colors.accent} />
          <Text style={styles.creditHeroTitle}>Credits create stories and chapters</Text>
          <Text style={styles.creditHeroText}>Starting a story is 3 credits: its cast, chapter 1's words, and chapter 1's art, which becomes the cover. Every chapter after that is 1. Audio is 1 credit per chapter, unlocked forever. Reading is always free.</Text>
        </View>
        <SectionHeader title="History" />
        {ledger.map((entry) => (
          <View key={entry.id} style={styles.ledgerRow}>
            <View>
              <Text style={styles.settingsTitle}>{entry.label}</Text>
              <Text style={styles.settingsSubtitle}>{entry.createdAt}</Text>
            </View>
            <Text style={[styles.ledgerAmount, entry.amount > 0 ? styles.positive : styles.negative]}>
              {entry.amount > 0 ? "+" : ""}
              {entry.amount}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────────── Author Screen ─────────────────────────────── */

function AuthorScreen({
  authorId,
  stories: allStories,
  onBack,
  onStory
}: {
  authorId: string;
  stories: Story[];
  onBack: () => void;
  onStory: (id: string) => void;
}) {
  const author = authorFor(authorId);
  const authorStories = allStories.filter((story) => story.authorId === author.id);
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={18} color={colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.authorHeader}>
          <View style={styles.authorAvatar}>
            <Text style={styles.authorInitial}>{author.displayName.charAt(0)}</Text>
          </View>
          <Text style={styles.h1}>{author.displayName}</Text>
          <Text style={styles.profileMeta}>@{author.username}</Text>
          <Text style={styles.authorBio}>{author.bio}</Text>
          <View style={styles.authorStats}>
            <Text style={styles.stat}>{formatNumber(author.followers)} followers</Text>
            <Text style={styles.stat}>{author.storyCount} stories</Text>
          </View>
        </View>
        <View style={styles.stack}>
          {authorStories.map((story) => (
            <StoryCard key={story.id} story={story} compact onPress={() => onStory(story.id)} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────────── Shared Components ─────────────────────────────── */

function HorizontalStories({ stories: items, onStory }: { stories: Story[]; onStory: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalRail}>
      {items.map((story) => (
        <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} />
      ))}
    </ScrollView>
  );
}

function BottomTabs({ selected, onSelect }: { selected: TabKey; onSelect: (tab: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; Icon: typeof Home; raised?: boolean }[] = [
    { key: "home", label: "Home", Icon: Home },
    { key: "create", label: "", Icon: Plus, raised: true },
    { key: "library", label: "Library", Icon: Bookmark }
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map(({ key, label, Icon, raised }) => {
        const active = selected === key;
        return (
          <Pressable key={key} onPress={() => onSelect(key)} accessibilityLabel={raised ? "Create story" : label} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.tabItem}>
            <View style={[raised ? styles.raisedTab : styles.flatTab, active && !raised && styles.flatTabActive]}>
              <Icon size={raised ? 26 : 20} color={raised ? colors.surface : active ? colors.accent : colors.tertiary} />
            </View>
            {!raised && label ? <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─────────────────────────────── Styles ─────────────────────────────── */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  safe: { flex: 1 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  withTabs: { paddingBottom: 116 },
  pagePad: { padding: spacing.xl, paddingBottom: spacing.huge },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  eyebrow: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  h1: {
    marginTop: 3,
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 31,
    lineHeight: 35
  },

  /* ── Avatar in header ── */
  avatarButton: { position: "relative" },
  headerAvatar: { width: 40, height: 40, borderRadius: 20 },
  creditBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4
  },
  creditBadgeText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 10,
    fontWeight: "900"
  },

  /* ── Write CTA (new user) ── */
  writeCTACard: {
    marginHorizontal: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.ink
  },
  writeCTATitle: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 24,
    lineHeight: 28
  },
  writeCTASubtitle: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "700",
    fontSize: 15,
    lineHeight: 21
  },
  writeCTAButtonWrap: { marginTop: spacing.lg },

  /* ── Write another (returning user) ── */
  writeAnotherBand: {
    margin: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: "#FFE0C7",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  writeAnotherIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  writeAnotherText: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink
  },

  /* ── Continue reading card ── */
  continueCard: { marginHorizontal: spacing.xl, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.ink, flexDirection: "row", gap: spacing.md, alignItems: "center" },
  continueCopy: { flex: 1 },
  continueEyebrow: { fontFamily: fonts.ui, color: colors.accent, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  continueTitle: { marginTop: spacing.xs, fontFamily: fonts.display, color: colors.surface, fontSize: 25, lineHeight: 28 },
  continueMeta: { marginTop: spacing.sm, fontFamily: fonts.ui, color: "rgba(255,255,255,0.7)", fontWeight: "700" },

  /* ── Horizontal rail ── */
  horizontalRail: { paddingHorizontal: spacing.xl, gap: 12 },

  /* ── Search & chips ── */
  searchBox: { marginHorizontal: spacing.xl, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  searchInput: { flex: 1, fontFamily: fonts.ui, color: colors.ink, fontSize: 15 },
  chipRow: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.sm },
  chipRowFlush: { gap: spacing.sm, paddingBottom: spacing.lg },

  /* ── Stack ── */
  stack: { gap: spacing.lg },
  accentLink: { color: colors.accent, fontWeight: "800" },

  /* ── Library ── */
  segmented: { marginHorizontal: spacing.xl, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface2, flexDirection: "row", gap: 4 },
  segment: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, fontWeight: "800" },
  segmentTextSelected: { color: colors.ink },
  segmentContent: { marginTop: spacing.xl, paddingHorizontal: spacing.xl },
  emptyState: {
    paddingVertical: spacing.huge,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md
  },
  emptyStateText: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: spacing.xl
  },

  /* ── Profile screen ── */
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xl
  },
  profileHeaderTitle: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 20
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignSelf: "center",
    marginBottom: spacing.md
  },
  profileCard: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
    alignItems: "center",
    marginBottom: spacing.xl
  },
  profileName: { fontFamily: fonts.display, color: colors.surface, fontSize: 24 },
  profileMeta: { marginTop: spacing.xs, fontFamily: fonts.ui, color: colors.muted, fontWeight: "700" },
  profileActions: { marginTop: spacing.lg, width: "100%" },
  profileButtonRow: { flexDirection: "row", gap: spacing.md },
  profileButtonHalf: { flex: 1 },
  creditsRow: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  legalFooter: { marginTop: spacing.xl, marginBottom: spacing.lg, textAlign: "center", fontFamily: fonts.ui, color: colors.tertiary, fontSize: 12 },
  settingsList: { borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  settingsRow: { padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  settingsIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  settingsText: { flex: 1 },
  settingsTitle: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 15 },
  settingsSubtitle: { marginTop: 2, fontFamily: fonts.ui, color: colors.muted, fontSize: 13 },

  /* ── Create screen ── */
  formCard: { margin: spacing.xl, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  fieldLabel: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 13 },
  seedInput: { minHeight: 118, borderRadius: radius.md, backgroundColor: colors.surface2, padding: spacing.lg, color: colors.ink, fontFamily: fonts.ui, fontSize: 16, textAlignVertical: "top" },
  inlineInput: { flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surface2, paddingHorizontal: spacing.lg, color: colors.ink, fontFamily: fonts.ui },
  twoColumn: { flexDirection: "row", gap: spacing.md },
  genreChoice: { minWidth: 132, borderRadius: radius.lg, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  genreChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  genreChoiceText: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },

  /* ── Reader ── */
  reader: { flex: 1, backgroundColor: colors.sepia },

  /* ── Mobile hero layout ── */
  mobileHeroWrap: {
    width: "100%",
    aspectRatio: 3 / 4,
    overflow: "hidden",
    position: "relative",
    backgroundColor: colors.sepiaPlaceholder
  },
  mobileHeroBackBtn: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 14,
    shadowColor: "rgba(60,40,15,1)",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    zIndex: 2
  },
  mobileHeroBackText: {
    fontFamily: fonts.ui,
    color: colors.sepiaHeading,
    fontSize: 13,
    fontWeight: "600"
  },
  mobileMetaBlock: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    marginTop: -4,
    alignItems: "center"
  },
  mobileGenre: {
    fontFamily: fonts.ui,
    color: colors.sepiaAccent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textAlign: "center"
  },
  mobileTitle: {
    marginTop: 8,
    fontFamily: fonts.display,
    color: colors.sepiaHeading,
    fontSize: 24,
    lineHeight: 28,
    textAlign: "center"
  },
  mobileAuthor: {
    marginTop: 7,
    fontFamily: fonts.ui,
    color: colors.sepiaMuted,
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center"
  },
  mobileAuthorName: {
    color: colors.sepiaSecondary,
    fontWeight: "600"
  },
  mobileBodyPad: {
    paddingHorizontal: 20,
    paddingBottom: spacing.huge
  },

  /* ── Desktop two-column layout ── */
  desktopContainer: {
    padding: 34,
    paddingBottom: spacing.huge,
    maxWidth: 700,
    alignSelf: "center",
    width: "100%"
  },
  desktopTwoCol: {
    flexDirection: "row",
    gap: 32,
    alignItems: "flex-start"
  },
  desktopCoverCol: {
    width: 200,
    flexShrink: 0
  },
  desktopCoverWrap: {
    width: 200,
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.sepiaPlaceholder,
    shadowColor: "rgba(60,40,15,1)",
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8
  },
  desktopTextCol: {
    flex: 1,
    minWidth: 0
  },
  desktopTitle: {
    marginTop: 8,
    fontFamily: fonts.display,
    color: colors.sepiaHeading,
    fontSize: 26,
    lineHeight: 30
  },
  desktopAuthor: {
    marginTop: 7,
    fontFamily: fonts.ui,
    color: colors.sepiaMuted,
    fontSize: 14,
    fontWeight: "500"
  },
  desktopAuthorName: {
    color: colors.sepiaSecondary,
    fontWeight: "600"
  },

  /* ── Shared reader styles ── */
  backButton: {
    alignSelf: "flex-start",
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginBottom: spacing.lg
  },
  backText: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },
  readerGenre: { fontFamily: fonts.ui, color: colors.sepiaAccent, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  readerToolbar: { marginVertical: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm + 1 },
  readerToolbarCentered: { justifyContent: "center" },
  audioPill: { height: 38, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.sepiaButton, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  audioText: { fontFamily: fonts.ui, color: colors.surface, fontWeight: "700", fontSize: 13 },
  chapterNav: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  chapterNavBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.sepiaPlaceholder,
  },
  chapterNavBtnActive: {
    backgroundColor: colors.sepiaButton,
  },
  chapterNavText: {
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "600",
    color: colors.sepiaSecondary,
  },
  chapterNavTextActive: {
    color: colors.surface,
  },
  chapterTitle: { fontFamily: fonts.display, color: colors.sepiaText, fontSize: 25, marginBottom: spacing.lg },
  paragraph: { fontFamily: fonts.reader, color: colors.sepiaBody, fontSize: 15, lineHeight: 23, marginBottom: spacing.lg },
  paragraphDesktop: { fontSize: 16, lineHeight: 26 },

  /* ── Reader engagement ── */
  engagementDivider: {
    height: 1,
    backgroundColor: "rgba(74,59,42,0.12)",
    marginTop: spacing.xl,
    marginBottom: spacing.lg
  },
  engagementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    marginBottom: spacing.lg
  },
  engagementAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.xs
  },
  engagementCount: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 13,
    fontWeight: "700"
  },

  /* ── Reader author card ── */
  authorDivider: {
    height: 1,
    backgroundColor: "rgba(74,59,42,0.12)",
    marginBottom: spacing.lg
  },
  readerAuthorCard: {
    marginBottom: spacing.lg,
    gap: spacing.md
  },
  readerAuthorCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  authorAvatarSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center"
  },
  authorInitialSmall: {
    fontFamily: fonts.display,
    color: colors.surface,
    fontSize: 20
  },
  readerAuthorInfo: { flex: 1 },
  readerAuthorName: {
    fontFamily: fonts.display,
    color: colors.sepiaText,
    fontSize: 17
  },
  readerAuthorBio: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    opacity: 0.6,
    fontSize: 13,
    lineHeight: 18
  },
  followButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center"
  },
  followButtonFollowing: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "rgba(74,59,42,0.25)"
  },
  followButtonText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontWeight: "800",
    fontSize: 14
  },
  followButtonTextFollowing: {
    color: colors.sepiaText
  },

  /* ── Reader comments ── */
  commentsSection: {
    gap: 0
  },
  commentsSectionTitle: {
    fontFamily: fonts.display,
    color: colors.sepiaText,
    fontSize: 20,
    marginBottom: spacing.lg
  },
  /* Comment input */
  commentInputRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.lg
  },
  commentInputAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4
  },
  commentInputAvatarText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800"
  },
  commentInputWrap: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: "rgba(74,59,42,0.06)",
    borderWidth: 1,
    borderColor: "rgba(74,59,42,0.12)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center"
  },
  commentInput: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 14,
    lineHeight: 20,
    padding: 0,
    margin: 0
  },
  commentSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4
  },
  /* Comment items */
  commentItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(74,59,42,0.08)"
  },
  commentItemAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tertiary,
    alignItems: "center",
    justifyContent: "center"
  },
  commentItemAvatarText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 12,
    fontWeight: "800"
  },
  commentItemContent: {
    flex: 1
  },
  commentItemMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 2
  },
  commentItemUser: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 12,
    fontWeight: "800"
  },
  commentItemTime: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    opacity: 0.5,
    fontSize: 12
  },
  commentItemText: {
    fontFamily: fonts.ui,
    color: colors.sepiaText,
    fontSize: 14,
    lineHeight: 20
  },
  /* Share toast */
  shareToast: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    marginBottom: spacing.md
  },
  shareToastText: {
    fontFamily: fonts.ui,
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700"
  },

  /* ── Credits screen ── */
  creditHero: { marginTop: spacing.xl, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  creditHeroTitle: { fontFamily: fonts.display, color: colors.ink, fontSize: 24, lineHeight: 28 },
  creditHeroText: { fontFamily: fonts.ui, color: colors.muted, lineHeight: 21 },
  ledgerRow: { marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ledgerAmount: { fontFamily: fonts.ui, fontSize: 18, fontWeight: "900" },
  positive: { color: colors.success },
  negative: { color: colors.premium },

  /* ── Author screen ── */
  authorHeader: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.xl },
  authorAvatar: { width: 86, height: 86, borderRadius: 28, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  authorInitial: { fontFamily: fonts.display, color: colors.surface, fontSize: 42 },
  authorBio: { paddingHorizontal: spacing.lg, textAlign: "center", fontFamily: fonts.ui, color: colors.muted, lineHeight: 21 },
  authorStats: { flexDirection: "row", gap: spacing.lg },
  stat: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },

  /* ── Tab bar ── */
  tabBar: { position: "absolute", left: 10, right: 10, bottom: 10, minHeight: 76, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, shadowColor: "#3D2D1B", shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 8 } },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  flatTab: { width: 38, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  flatTabActive: { backgroundColor: colors.accentSoft },
  raisedTab: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: -26 },
  tabLabel: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 10, fontWeight: "800" },
  tabLabelActive: { color: colors.accent },

  /* ── Legacy / onboarding (kept for reference screens) ── */
  avatar: { width: 46, height: 46, borderRadius: 14 },
  logoRow: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { width: 42, height: 42, borderRadius: 10 },
  wordmark: { fontFamily: fonts.brand, fontSize: 34, color: colors.ink },
  onboarding: { flex: 1 },
  onboardingHero: { margin: spacing.xl, height: 330, borderRadius: 28, overflow: "hidden", justifyContent: "flex-end" },
  onboardingImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" },
  onboardingTitle: { padding: spacing.xl, fontFamily: fonts.display, color: colors.surface, fontSize: 34, lineHeight: 38 },
  optionPanel: { marginHorizontal: spacing.xl, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface, gap: spacing.md },
  optionTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  option: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface2, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  optionSelected: { backgroundColor: colors.ink },
  optionText: { fontFamily: fonts.ui, fontWeight: "800", color: colors.ink },
  optionTextSelected: { color: colors.surface },
  intentSignIn: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: -2 },
  intentSignInText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14.5 },
  intentSignInStrong: { color: colors.ink, fontWeight: "900" },
  circleButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  createBand: { margin: spacing.xl, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: "#FFE0C7", flexDirection: "row", alignItems: "center", gap: spacing.md },
  createBandIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  createBandCopy: { flex: 1 },
  createBandTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  createBandText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13, lineHeight: 18 },

  /* ── Voice toggle ── */
  voiceToggle: {
    flexDirection: "row",
    borderRadius: radius.pill,
    backgroundColor: colors.sepiaToggleTrack,
    padding: 3,
  },
  voiceToggleBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  voiceToggleBtnActive: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  voiceToggleText: {
    fontFamily: fonts.ui,
    color: colors.sepiaSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  voiceToggleTextActive: {
    color: colors.sepiaHeading,
    fontWeight: "600",
  },
});

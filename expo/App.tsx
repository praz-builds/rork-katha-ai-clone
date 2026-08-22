import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  Bell,
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  Home,
  Lock,
  MessageCircle,
  Play,
  Plus,
  Search,
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
  formatNumber
} from "@/components/KathaPrimitives";
import { authorFor, genres, ledger, stories } from "@/data/seed";
import CreateStudioScreen from "@/screens/CreateStudioScreen";
import KathaOnboardingComplete from "@/screens/KathaOnboardingComplete";
import KathaOnboardingFlowV2 from "@/screens/KathaOnboardingFlowV2";
import { colors, fonts, genreLabels, radius, spacing } from "@/theme/theme";
import type { Genre, Screen, Story, TabKey } from "@/types/domain";

type LibrarySegment = "saved" | "history" | "myStories" | "comments";

export default function App() {
  const [fontsReady, setFontsReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "intro" });
  const [tab, setTab] = useState<TabKey>("home");
  const [credits, setCredits] = useState(3);
  const [generatedStories, setGeneratedStories] = useState<Story[]>([]);

  useEffect(() => {
    Font.loadAsync({
      BricolageGrotesque: require("./assets/fonts/BricolageGrotesque.ttf"),
      HankenGrotesk: require("./assets/fonts/HankenGrotesk.ttf"),
      Baloo2: require("./assets/fonts/Baloo2.ttf"),
      Literata: require("./assets/fonts/Literata.ttf"),
      LiterataItalic: require("./assets/fonts/Literata-Italic.ttf")
    }).then(() => setFontsReady(true));
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
        <KathaOnboardingComplete onDone={() => goTabs("home")} onSignIn={() => goTabs("home")} />
      ) : screen.name === "onboarding" ? (
        <KathaOnboardingFlowV2 onDone={() => goTabs("home")} />
      ) : screen.name === "reader" ? (
        <ReaderScreen story={allStories.find((story) => story.id === screen.storyId) ?? allStories[0]} onBack={() => goTabs(tab)} />
      ) : screen.name === "author" ? (
        <AuthorScreen authorId={screen.authorId} stories={allStories} onBack={() => goTabs(tab)} onStory={openStory} />
      ) : screen.name === "credits" ? (
        <CreditsScreen credits={credits} onBack={() => goTabs(tab)} />
      ) : screen.name === "paywall" ? (
        <KathaOnboardingFlowV2 initialScreen="paywall" onDone={() => goTabs("home")} />
      ) : screen.name === "profile" ? (
        <ProfileScreen
          credits={credits}
          onBack={() => goTabs(tab)}
          onCredits={() => setScreen({ name: "credits" })}
          onPaywall={() => setScreen({ name: "paywall" })}
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
  onCreate
}: {
  credits: number;
  generatedStories: Story[];
  stories: Story[];
  onStory: (id: string) => void;
  onProfile: () => void;
  onCreate: () => void;
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
      (!q || story.title.toLowerCase().includes(q) || story.synopsis.toLowerCase().includes(q) || story.tags.join(" ").includes(q))
    );
  });

  const showFiltered = query.trim().length > 0 || genre !== "all";

  // Mock onboarding genres — Adventure, Mystery, Fantasy
  const onboardingGenres: Genre[] = ["adventure", "mystery", "fantasy"];
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
          <Pressable onPress={onProfile} style={styles.avatarButton}>
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
              <Text style={styles.writeCTASubtitle}>Genre, characters, your idea — Katha brings it to life</Text>
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
  onPaywall
}: {
  credits: number;
  onBack: () => void;
  onCredits: () => void;
  onPaywall: () => void;
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
          {settingsRows.map(([title, subtitle, Icon]) => (
            <Pressable key={title} onPress={() => {
              if (title === "Katha Plus") onPaywall();
            }} style={styles.settingsRow}>
              <View style={styles.settingsIcon}>
                <Icon size={20} color={colors.accent} />
              </View>
              <View style={styles.settingsText}>
                <Text style={styles.settingsTitle}>{title}</Text>
                <Text style={styles.settingsSubtitle}>{subtitle}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.legalFooter}>Privacy Policy - Terms of Service - v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────────── Reader Screen ─────────────────────────────── */

function ReaderScreen({ story, onBack }: { story: Story; onBack: () => void }) {
  const author = authorFor(story.authorId);
  const chapter = story.chapters[0];

  const comingSoon = () => Alert.alert("Coming soon", "This feature will be available soon.");

  return (
    <View style={styles.reader}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Cover story={story} size="hero" />
        <View style={styles.readerBody}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <ChevronLeft size={18} color={colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.readerGenre}>{genreLabels[story.genre]}</Text>
          <Text style={styles.readerTitle}>{story.title}</Text>
          <Text style={styles.readerAuthor}>by {author.displayName}</Text>
          <View style={styles.readerToolbar}>
            <View style={styles.audioPill}>
              <Play size={16} color="#FFFFFF" />
              <Text style={styles.audioText}>Narration</Text>
            </View>
            <Bookmark size={21} color={colors.sepiaText} />
            <Share2 size={21} color={colors.sepiaText} />
          </View>
          <Text style={styles.chapterTitle}>{chapter.title}</Text>
          {chapter.paragraphs.map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}

          {/* ── Engagement bar (Substack-style) ── */}
          <View style={styles.engagementDivider} />
          <View style={styles.engagementRow}>
            <Pressable onPress={comingSoon} style={styles.engagementAction}>
              <Heart size={20} color={colors.heart} />
              <Text style={styles.engagementCount}>{formatNumber(story.likes)}</Text>
            </Pressable>
            <Pressable onPress={comingSoon} style={styles.engagementAction}>
              <MessageCircle size={20} color={colors.muted} />
              <Text style={styles.engagementCount}>42</Text>
            </Pressable>
            <Pressable onPress={comingSoon} style={styles.engagementAction}>
              <Bookmark size={20} color={colors.muted} />
              <Text style={styles.engagementLabel}>Save</Text>
            </Pressable>
            <Pressable onPress={comingSoon} style={styles.engagementAction}>
              <Share2 size={20} color={colors.muted} />
              <Text style={styles.engagementLabel}>Share</Text>
            </Pressable>
          </View>

          {/* ── Author card ── */}
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
            <Pressable onPress={comingSoon} style={styles.followButton}>
              <Text style={styles.followButtonText}>Follow</Text>
            </Pressable>
          </View>

          {/* ── Comments preview ── */}
          <View style={styles.commentsSection}>
            <Text style={styles.commentsSectionTitle}>Comments (42)</Text>
            <View style={styles.commentCard}>
              <Text style={styles.commentBody}>"This story had me hooked from the first line"</Text>
              <Text style={styles.commentAuthor}>@reader1</Text>
            </View>
            <View style={styles.commentCard}>
              <Text style={styles.commentBody}>"Beautiful writing. The ending was unexpected."</Text>
              <Text style={styles.commentAuthor}>@reader2</Text>
            </View>
            <Pressable onPress={comingSoon}>
              <Text style={styles.viewAllComments}>View all comments</Text>
            </Pressable>
          </View>
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
          <Text style={styles.creditHeroTitle}>1 credit creates 1 story or chapter</Text>
          <Text style={styles.creditHeroText}>Purchases, rewards, and subscriptions will sync through Supabase and Adapty after the native dev-client phase.</Text>
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
        <Pressable key={story.id} onPress={() => onStory(story.id)} style={styles.railItem}>
          <Cover story={story} />
          <Text numberOfLines={2} style={styles.railTitle}>{story.title}</Text>
          <Text style={styles.railMeta}>{formatNumber(story.views)} reads</Text>
        </Pressable>
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
          <Pressable key={key} onPress={() => onSelect(key)} style={styles.tabItem}>
            <View style={[raised ? styles.raisedTab : styles.flatTab, active && !raised && styles.flatTabActive]}>
              <Icon size={raised ? 26 : 20} color={raised ? "#FFFFFF" : active ? colors.accent : colors.tertiary} />
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
    color: "#FFFFFF",
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
    color: "#FFFFFF",
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
    backgroundColor: "#FFFFFF",
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
  continueEyebrow: { fontFamily: fonts.ui, color: colors.accent, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  continueTitle: { marginTop: spacing.xs, fontFamily: fonts.display, color: "#FFFFFF", fontSize: 25, lineHeight: 28 },
  continueMeta: { marginTop: spacing.sm, fontFamily: fonts.ui, color: "rgba(255,255,255,0.7)", fontWeight: "700" },

  /* ── Horizontal rail ── */
  horizontalRail: { paddingHorizontal: spacing.xl, gap: spacing.md },
  railItem: { width: 108, gap: spacing.sm },
  railTitle: { fontFamily: fonts.display, color: colors.ink, fontSize: 15, lineHeight: 18 },
  railMeta: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, fontWeight: "700" },

  /* ── Search & chips ── */
  searchBox: { marginHorizontal: spacing.xl, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  searchInput: { flex: 1, fontFamily: fonts.ui, color: colors.ink, fontSize: 15 },
  chipRow: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.sm },
  chipRowFlush: { gap: spacing.sm, paddingBottom: spacing.lg },

  /* ── Stack ── */
  stack: { gap: spacing.md },
  accentLink: { color: colors.accent, fontWeight: "800" },

  /* ── Library ── */
  segmented: { marginHorizontal: spacing.xl, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface2, flexDirection: "row", gap: 4 },
  segment: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, fontWeight: "800" },
  segmentTextSelected: { color: colors.ink },
  segmentContent: { marginTop: spacing.xl },
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
  profileName: { fontFamily: fonts.display, color: "#FFFFFF", fontSize: 24 },
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
  readerBody: { padding: spacing.xl, paddingBottom: spacing.huge },
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
  readerGenre: { fontFamily: fonts.ui, color: colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  readerTitle: { marginTop: spacing.sm, fontFamily: fonts.display, color: colors.sepiaText, fontSize: 36, lineHeight: 40 },
  readerAuthor: { marginTop: spacing.sm, fontFamily: fonts.ui, color: colors.sepiaText, opacity: 0.72, fontWeight: "700" },
  readerToolbar: { marginVertical: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  audioPill: { height: 42, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  audioText: { fontFamily: fonts.ui, color: "#FFFFFF", fontWeight: "800" },
  chapterTitle: { fontFamily: fonts.display, color: colors.sepiaText, fontSize: 25, marginBottom: spacing.lg },
  paragraph: { fontFamily: fonts.reader, color: colors.sepiaText, fontSize: 18, lineHeight: 31, marginBottom: spacing.lg },

  /* ── Reader engagement ── */
  engagementDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xl
  },
  engagementRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginBottom: spacing.xl
  },
  engagementAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md
  },
  engagementCount: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700"
  },
  engagementLabel: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700"
  },

  /* ── Reader author card ── */
  readerAuthorCard: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
    gap: spacing.md
  },
  readerAuthorCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  authorAvatarSmall: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  authorInitialSmall: {
    fontFamily: fonts.display,
    color: "#FFFFFF",
    fontSize: 22
  },
  readerAuthorInfo: { flex: 1 },
  readerAuthorName: {
    fontFamily: fonts.display,
    color: colors.ink,
    fontSize: 17
  },
  readerAuthorBio: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  followButton: {
    alignSelf: "flex-start",
    minHeight: 38,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  followButtonText: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 14
  },

  /* ── Reader comments preview ── */
  commentsSection: {
    gap: spacing.md
  },
  commentsSectionTitle: {
    fontFamily: fonts.display,
    color: colors.sepiaText,
    fontSize: 20
  },
  commentCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  commentBody: {
    fontFamily: fonts.reader,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
    fontStyle: "italic"
  },
  commentAuthor: {
    marginTop: spacing.sm,
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  viewAllComments: {
    fontFamily: fonts.ui,
    color: colors.accent,
    fontWeight: "800",
    fontSize: 14
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
  authorInitial: { fontFamily: fonts.display, color: "#FFFFFF", fontSize: 42 },
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
  onboardingTitle: { padding: spacing.xl, fontFamily: fonts.display, color: "#FFFFFF", fontSize: 34, lineHeight: 38 },
  optionPanel: { marginHorizontal: spacing.xl, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface, gap: spacing.md },
  optionTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  option: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface2, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  optionSelected: { backgroundColor: colors.ink },
  optionText: { fontFamily: fonts.ui, fontWeight: "800", color: colors.ink },
  optionTextSelected: { color: "#FFFFFF" },
  intentSignIn: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: -2 },
  intentSignInText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14.5 },
  intentSignInStrong: { color: colors.ink, fontWeight: "900" },
  circleButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  createBand: { margin: spacing.xl, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: "#FFE0C7", flexDirection: "row", alignItems: "center", gap: spacing.md },
  createBandIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  createBandCopy: { flex: 1 },
  createBandTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  createBandText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13, lineHeight: 18 }
});

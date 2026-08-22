import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
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
  Compass,
  CreditCard,
  Home,
  Library,
  Lock,
  MessageCircle,
  Moon,
  Play,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Star,
  User,
  Wand2
} from "lucide-react-native";
import {
  Chip,
  Cover,
  CreditPill,
  GenreSwatch,
  PrimaryButton,
  ScreenScaffold,
  SectionHeader,
  StoryCard,
  formatNumber
} from "@/components/KathaPrimitives";
import { imageAssets } from "@/data/images";
import { authorFor, authors, genres, ledger, stories, storyWordCount } from "@/data/seed";
import {
  createGenerationRequestId,
  generateStory,
  GenerationRequestError,
} from "@/lib/api";
import KathaOnboardingComplete from "@/screens/KathaOnboardingComplete";
import KathaOnboardingFlowV2 from "@/screens/KathaOnboardingFlowV2";
import { colors, fonts, genreLabels, radius, spacing } from "@/theme/theme";
import type { CreateDraft, Genre, Screen, Story, TabKey } from "@/types/domain";

const starterDraft: CreateDraft = {
  genre: "fantasy",
  seed: "",
  language: "English",
  characters: [{ name: "Mira", description: "Curious, stubborn, quietly brave", isHero: true }]
};

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
        return <HomeScreen credits={credits} stories={allStories} onStory={openStory} onCredits={() => setScreen({ name: "credits" })} onCreate={() => goTabs("create")} />;
      case "discover":
        return <DiscoverScreen stories={allStories} onStory={openStory} />;
      case "create":
        return (
          <CreateScreen
            credits={credits}
            onGenerated={(story) => {
              setGeneratedStories((current) => [story, ...current]);
              setCredits((value) => Math.max(0, value - 1));
              setScreen({ name: "reader", storyId: story.id });
            }}
          />
        );
      case "library":
        return <LibraryScreen stories={allStories} onStory={openStory} />;
      case "settings":
        return <SettingsScreen credits={credits} onCredits={() => setScreen({ name: "credits" })} onPaywall={() => setScreen({ name: "paywall" })} />;
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
      ) : (
        <>
          {renderTab()}
          <BottomTabs selected={tab} onSelect={(next) => setTab(next)} />
        </>
      )}
    </ScreenScaffold>
  );
}

function HomeScreen({
  credits,
  stories: allStories,
  onStory,
  onCredits,
  onCreate
}: {
  credits: number;
  stories: Story[];
  onStory: (id: string) => void;
  onCredits: () => void;
  onCreate: () => void;
}) {
  const featured = allStories.filter((story) => story.isFeatured);
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.withTabs} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Good evening</Text>
            <Text style={styles.h1}>Pick up a story</Text>
          </View>
          <Pressable onPress={onCredits}>
            <CreditPill credits={credits} />
          </Pressable>
        </View>
        <Pressable onPress={() => onStory(featured[0].id)} style={styles.continueCard}>
          <View style={styles.continueCopy}>
            <Text style={styles.continueEyebrow}>Continue reading</Text>
            <Text style={styles.continueTitle}>{featured[0].title}</Text>
            <Text style={styles.continueMeta}>40% read • Chapter 2 waits</Text>
          </View>
          <Cover story={featured[0]} size="mini" />
        </Pressable>
        <View style={styles.createBand}>
          <View style={styles.createBandIcon}>
            <Wand2 size={24} color="#FFFFFF" />
          </View>
          <View style={styles.createBandCopy}>
            <Text style={styles.createBandTitle}>Turn a seed into a story</Text>
            <Text style={styles.createBandText}>Genre, characters, language, then Katha drafts the first chapter.</Text>
          </View>
          <Pressable onPress={onCreate} style={styles.circleButton}>
            <Plus size={22} color="#FFFFFF" />
          </Pressable>
        </View>
        <SectionHeader title="Trending now" action="See all" />
        <HorizontalStories stories={featured} onStory={onStory} />
        <SectionHeader title="For you" />
        <View style={styles.stack}>
          {allStories.slice(2, 7).map((story) => (
            <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DiscoverScreen({ stories: allStories, onStory }: { stories: Story[]; onStory: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<Genre | "all">("all");
  const filtered = allStories.filter((story) => {
    const q = query.trim().toLowerCase();
    return (
      (genre === "all" || story.genre === genre) &&
      (!q || story.title.toLowerCase().includes(q) || story.synopsis.toLowerCase().includes(q) || story.tags.join(" ").includes(q))
    );
  });

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.withTabs} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Discover</Text>
            <Text style={styles.h1}>Find your next world</Text>
          </View>
          <Compass size={28} color={colors.accent} />
        </View>
        <View style={styles.searchBox}>
          <Search size={18} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search stories, moods, authors" placeholderTextColor={colors.tertiary} style={styles.searchInput} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="All" selected={genre === "all"} onPress={() => setGenre("all")} />
          {genres.slice(0, 10).map((item) => (
            <Chip key={item} label={genreLabels[item]} selected={genre === item} onPress={() => setGenre(item)} />
          ))}
        </ScrollView>
        <View style={styles.stack}>
          {filtered.map((story) => (
            <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateScreen({ credits, onGenerated }: { credits: number; onGenerated: (story: Story) => void }) {
  const [draft, setDraft] = useState<CreateDraft>(starterDraft);
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const canGenerate = draft.seed.trim().length > 3 && credits > 0 && !busy;

  useEffect(() => {
    requestIdRef.current = null;
  }, [draft]);

  const submit = async () => {
    if (!canGenerate) {
      Alert.alert(credits > 0 ? "Add a story seed" : "Credits needed", credits > 0 ? "Give Katha one clear idea to shape." : "You need 1 credit to generate.");
      return;
    }
    setBusy(true);
    const requestId = requestIdRef.current ?? createGenerationRequestId();
    requestIdRef.current = requestId;
    try {
      const story = await generateStory(draft, requestId);
      onGenerated(story);
      setDraft(starterDraft);
    } catch (error) {
      if (error instanceof GenerationRequestError && error.resetRequestId) {
        requestIdRef.current = null;
      }
      Alert.alert(
        "Could not create story",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.withTabs} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Create</Text>
              <Text style={styles.h1}>Shape a new story</Text>
            </View>
            <CreditPill credits={credits} />
          </View>
          <View style={styles.formCard}>
            <Text style={styles.fieldLabel}>Genre</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowFlush}>
              {genres.slice(0, 12).map((item) => (
                <Pressable key={item} onPress={() => setDraft((current) => ({ ...current, genre: item }))} style={[styles.genreChoice, draft.genre === item && styles.genreChoiceSelected]}>
                  <GenreSwatch genre={item} />
                  <Text style={styles.genreChoiceText}>{genreLabels[item]}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Story seed</Text>
            <TextInput
              multiline
              value={draft.seed}
              onChangeText={(seed) => setDraft((current) => ({ ...current, seed }))}
              placeholder="A lighthouse keeper receives a letter from the future..."
              placeholderTextColor={colors.tertiary}
              style={styles.seedInput}
            />
            <Text style={styles.fieldLabel}>Main character</Text>
            <View style={styles.twoColumn}>
              <TextInput
                value={draft.characters[0].name}
                onChangeText={(name) =>
                  setDraft((current) => ({ ...current, characters: [{ ...current.characters[0], name }] }))
                }
                placeholder="Name"
                placeholderTextColor={colors.tertiary}
                style={styles.inlineInput}
              />
              <TextInput
                value={draft.language}
                onChangeText={(language) => setDraft((current) => ({ ...current, language }))}
                placeholder="Language"
                placeholderTextColor={colors.tertiary}
                style={styles.inlineInput}
              />
            </View>
            <TextInput
              value={draft.characters[0].description}
              onChangeText={(description) =>
                setDraft((current) => ({ ...current, characters: [{ ...current.characters[0], description }] }))
              }
              placeholder="Traits, desire, or secret"
              placeholderTextColor={colors.tertiary}
              style={styles.inlineInput}
            />
            <PrimaryButton onPress={submit}>{busy ? "Generating..." : "Generate for 1 credit"}</PrimaryButton>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LibraryScreen({ stories: allStories, onStory }: { stories: Story[]; onStory: (id: string) => void }) {
  const saved = allStories.filter((story) => story.bookmarks > 100 || story.id.startsWith("generated"));
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.withTabs} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Library</Text>
            <Text style={styles.h1}>Saved and drafted</Text>
          </View>
          <Library size={28} color={colors.accent} />
        </View>
        <View style={styles.segmented}>
          {["Saved", "Generated", "History", "Downloads"].map((label, index) => (
            <View key={label} style={[styles.segment, index === 0 && styles.segmentSelected]}>
              <Text style={[styles.segmentText, index === 0 && styles.segmentTextSelected]}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.stack}>
          {saved.map((story) => (
            <StoryCard key={story.id} story={story} onPress={() => onStory(story.id)} compact />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsScreen({ credits, onCredits, onPaywall }: { credits: number; onCredits: () => void; onPaywall: () => void }) {
  const rows = [
    ["Profile", "Avatar, username, creator bio", User],
    ["Katha Plus", "Subscription, voices, ad-free", Star],
    ["Credits", `${credits} available`, CreditCard],
    ["Reading preferences", "Theme, font size, language", BookOpen],
    ["Notifications", "Chapter alerts and streak nudges", Bell],
    ["Parental controls", "Kids mode and PIN gate", Lock],
    ["Feedback", "Comments, rating, support", MessageCircle]
  ] as const;
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.withTabs} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Settings</Text>
            <Text style={styles.h1}>Your Katha</Text>
          </View>
          <Image source={require("./assets/icon.png")} style={styles.avatar} />
        </View>
        <View style={styles.profileCard}>
          <Text style={styles.profileName}>Reader Writer</Text>
          <Text style={styles.profileMeta}>@you • 3-day streak • {credits} credits</Text>
          <View style={styles.profileActions}>
            <PrimaryButton variant="secondary" onPress={onPaywall}>See Plus</PrimaryButton>
          </View>
        </View>
        <View style={styles.settingsList}>
          {rows.map(([title, subtitle, Icon]) => (
            <Pressable key={title} onPress={title === "Credits" ? onCredits : undefined} style={styles.settingsRow}>
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
      </ScrollView>
    </SafeAreaView>
  );
}

function ReaderScreen({ story, onBack }: { story: Story; onBack: () => void }) {
  const author = authorFor(story.authorId);
  const chapter = story.chapters[0];
  return (
    <View style={styles.reader}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Cover story={story} size="hero" />
        <View style={styles.readerBody}>
          <Pressable onPress={onBack} style={styles.backButton}>
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
              {index === 0 ? paragraph : paragraph}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function CreditsScreen({ credits, onBack }: { credits: number; onBack: () => void }) {
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Pressable onPress={onBack} style={styles.backButton}>
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
    { key: "discover", label: "Discover", Icon: Compass },
    { key: "create", label: "Create", Icon: Plus, raised: true },
    { key: "library", label: "Library", Icon: Bookmark },
    { key: "settings", label: "Settings", Icon: Settings }
  ] as const;
  return (
    <View style={styles.tabBar}>
      {tabs.map(({ key, label, Icon, raised }) => {
        const active = selected === key;
        return (
          <Pressable key={key} onPress={() => onSelect(key)} style={styles.tabItem}>
            <View style={[raised ? styles.raisedTab : styles.flatTab, active && !raised && styles.flatTabActive]}>
              <Icon size={raised ? 26 : 20} color={raised ? "#FFFFFF" : active ? colors.accent : colors.tertiary} />
            </View>
            {!raised ? <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

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
  continueCard: { marginHorizontal: spacing.xl, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.ink, flexDirection: "row", gap: spacing.md, alignItems: "center" },
  continueCopy: { flex: 1 },
  continueEyebrow: { fontFamily: fonts.ui, color: colors.accent, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  continueTitle: { marginTop: spacing.xs, fontFamily: fonts.display, color: "#FFFFFF", fontSize: 25, lineHeight: 28 },
  continueMeta: { marginTop: spacing.sm, fontFamily: fonts.ui, color: "rgba(255,255,255,0.7)", fontWeight: "700" },
  createBand: { margin: spacing.xl, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: "#FFE0C7", flexDirection: "row", alignItems: "center", gap: spacing.md },
  createBandIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  createBandCopy: { flex: 1 },
  createBandTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  createBandText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 13, lineHeight: 18 },
  circleButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  horizontalRail: { paddingHorizontal: spacing.xl, gap: spacing.md },
  railItem: { width: 108, gap: spacing.sm },
  railTitle: { fontFamily: fonts.display, color: colors.ink, fontSize: 15, lineHeight: 18 },
  railMeta: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, fontWeight: "700" },
  stack: { gap: spacing.md },
  searchBox: { marginHorizontal: spacing.xl, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  searchInput: { flex: 1, fontFamily: fonts.ui, color: colors.ink, fontSize: 15 },
  chipRow: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.sm },
  chipRowFlush: { gap: spacing.sm, paddingBottom: spacing.lg },
  formCard: { margin: spacing.xl, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  fieldLabel: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 13 },
  seedInput: { minHeight: 118, borderRadius: radius.md, backgroundColor: colors.surface2, padding: spacing.lg, color: colors.ink, fontFamily: fonts.ui, fontSize: 16, textAlignVertical: "top" },
  inlineInput: { flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surface2, paddingHorizontal: spacing.lg, color: colors.ink, fontFamily: fonts.ui },
  twoColumn: { flexDirection: "row", gap: spacing.md },
  genreChoice: { minWidth: 132, borderRadius: radius.lg, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  genreChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  genreChoiceText: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },
  segmented: { marginHorizontal: spacing.xl, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface2, flexDirection: "row", gap: 4 },
  segment: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: { fontFamily: fonts.ui, color: colors.muted, fontSize: 12, fontWeight: "800" },
  segmentTextSelected: { color: colors.ink },
  avatar: { width: 46, height: 46, borderRadius: 14 },
  profileCard: { margin: spacing.xl, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.ink },
  profileName: { fontFamily: fonts.display, color: "#FFFFFF", fontSize: 24 },
  profileMeta: { marginTop: spacing.xs, fontFamily: fonts.ui, color: colors.muted, fontWeight: "700" },
  profileActions: { marginTop: spacing.lg },
  settingsList: { marginHorizontal: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  settingsRow: { padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  settingsIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  settingsText: { flex: 1 },
  settingsTitle: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800", fontSize: 15 },
  settingsSubtitle: { marginTop: 2, fontFamily: fonts.ui, color: colors.muted, fontSize: 13 },
  reader: { flex: 1, backgroundColor: colors.sepia },
  readerBody: { padding: spacing.xl, paddingBottom: spacing.huge },
  backButton: { alignSelf: "flex-start", minHeight: 38, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  backText: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },
  readerGenre: { fontFamily: fonts.ui, color: colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  readerTitle: { marginTop: spacing.sm, fontFamily: fonts.display, color: colors.sepiaText, fontSize: 36, lineHeight: 40 },
  readerAuthor: { marginTop: spacing.sm, fontFamily: fonts.ui, color: colors.sepiaText, opacity: 0.72, fontWeight: "700" },
  readerToolbar: { marginVertical: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  audioPill: { height: 42, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  audioText: { fontFamily: fonts.ui, color: "#FFFFFF", fontWeight: "800" },
  chapterTitle: { fontFamily: fonts.display, color: colors.sepiaText, fontSize: 25, marginBottom: spacing.lg },
  paragraph: { fontFamily: fonts.reader, color: colors.sepiaText, fontSize: 18, lineHeight: 31, marginBottom: spacing.lg },
  creditHero: { marginTop: spacing.xl, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  creditHeroTitle: { fontFamily: fonts.display, color: colors.ink, fontSize: 24, lineHeight: 28 },
  creditHeroText: { fontFamily: fonts.ui, color: colors.muted, lineHeight: 21 },
  ledgerRow: { marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ledgerAmount: { fontFamily: fonts.ui, fontSize: 18, fontWeight: "900" },
  positive: { color: colors.success },
  negative: { color: colors.premium },
  authorHeader: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.xl },
  authorAvatar: { width: 86, height: 86, borderRadius: 28, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  authorInitial: { fontFamily: fonts.display, color: "#FFFFFF", fontSize: 42 },
  authorBio: { paddingHorizontal: spacing.lg, textAlign: "center", fontFamily: fonts.ui, color: colors.muted, lineHeight: 21 },
  authorStats: { flexDirection: "row", gap: spacing.lg },
  stat: { fontFamily: fonts.ui, color: colors.ink, fontWeight: "800" },
  tabBar: { position: "absolute", left: 10, right: 10, bottom: 10, minHeight: 76, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, shadowColor: "#3D2D1B", shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 8 } },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  flatTab: { width: 38, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  flatTabActive: { backgroundColor: colors.accentSoft },
  raisedTab: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: -26 },
  tabLabel: { fontFamily: fonts.ui, color: colors.tertiary, fontSize: 10, fontWeight: "800" },
  tabLabelActive: { color: colors.accent }
});

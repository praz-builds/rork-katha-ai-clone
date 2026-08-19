//
//  AppState.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - App Phase

enum AppPhase: Equatable {
    case splash
    case onboarding
    case main
}

// MARK: - Username Generator

enum UsernameGenerator {
    static let firstWords = [
        "quiet", "bright", "swift", "calm", "wild", "warm",
        "bold", "soft", "lone", "still", "pale", "dark",
        "fair", "vast", "deep"
    ]
    static let secondWords = [
        "writer", "story", "verse", "tale", "myth", "word",
        "page", "chapter", "novel", "poem", "sonnet",
        "parable", "fable", "ode", "lyric"
    ]

    static let takenUsernames: Set<String> = [
        "kathaai", "aarav", "mayak", "rentakahashi",
        "priyanair", "diegoa", "zoeok", "rahuls",
        "elenar", "kainak"
    ]

    static func isAvailable(_ username: String) -> Bool {
        let lowered = username.lowercased()
        if takenUsernames.contains(lowered) { return false }
        if SeedData.authors.contains(where: { $0.username.lowercased() == lowered }) { return false }
        return true
    }

    static func generate() -> String {
        for _ in 0..<50 {
            let first = firstWords.randomElement() ?? "quiet"
            let second = secondWords.randomElement() ?? "writer"
            let base = "\(first)\(second)"
            if isAvailable(base) { return base }
            let numbered = "\(base)\(Int.random(in: 1...999))"
            if isAvailable(numbered) { return numbered }
        }
        return "writer\(Int.random(in: 1000...9999))"
    }
}

// MARK: - AppState

@Observable
final class AppState {
    // Navigation
    var appPhase: AppPhase = .splash

    // Auth
    var currentUser: UserSession?
    var isAuthenticating = false
    var authError: String?

    // Auth Sheet
    var showAuthSheet = false
    var authSheetIsReaderWall = false
    var pendingStoryForReader: Story?

    // Profile Setup
    var showProfileSetup = false
    var generatedUsername = ""
    var tempDisplayName = ""
    var tempBio = ""

    // Reader
    var selectedStory: Story?
    var showReader = false
    var currentChapterIndex: Int = 0
    var showChapterListSheet: Bool = false

    // Toast
    var toastMessage: String?
    var toastIsWelcome = false

    // Social (persisted)
    var followedAuthorIds: Set<String> = []
    var likedStoryIds: Set<String> = []
    var bookmarkedStoryIds: Set<String> = []

    // Follow story (persisted)
    var followedStoryIds: Set<String> = []
    var storyFollowerOverrides: [String: Int] = [:]

    // New chapter notifications (in-session)
    var newChapterNotifications: [NewChapterNotification] = []
    var dismissedBannerStoryIds: Set<String> = []

    // Reading progress (persisted)
    var readingProgress: [String: ReadingProgress] = [:]

    // Settings
    var readerSepia = false
    var readerFontSize: Int = 18
    var appThemeMode: AppThemeMode = .auto
    var defaultReadingLevel: ReadingLevel = .standard
    var kidsMode = false
    var kidsModePin: String?
    var pinCooldownUntil: Date?
    var kidsReadingLevelCap: ReadingLevel = .standard
    var kidsCommentsEnabled = false
    var kidsShareEnabled = false
    var kidsSearchSuggestionsEnabled = true
    var ageVerified = false

    // Content safety overlays
    var showReadingLevelSheet = false
    var readingLevelSheetForWizard = false
    var readingLevelSheetForCap = false
    var showParentalControls = false
    var showPINSetup = false
    var pinSetupMode: PinSetupMode = .enableKidsMode
    var showPINEntry = false
    var pinEntryContext: PinEntryContext = .disableKidsMode
    var showAgeVerification = false

    // Onboarding selection
    var onboardingSelection: Int? = nil

    // Wizard state (in-session only, not persisted)
    var wizardStep: WizardStep = .genre
    var wizardGenre: Genre?
    var wizardTopic: String = ""
    var wizardCharacters: [WizardCharacter] = []
    var wizardLanguage: StoryLanguage = .en
    var wizardReadingLevel: ReadingLevel = .standard
    var wizardPlanAsSeries: Bool = false
    var wizardSeriesChapterCount: Int = 3
    var isGenerating: Bool = false
    var generationError: String?
    var lastGeneratedStory: GeneratedStory?
    var showOutOfCreditsModal: Bool = false
    var showLanguageSheet: Bool = false
    var showGetIdeasSheet: Bool = false

    // Creation workspace (private draft until explicit publish)
    var creationPhase: CreationPhase = .composer
    var creationRevisionPrompt = ""
    var creationCoverProgress: Double = 0
    var creationIsEditingText = false
    var creationDraftSaved = false
    var creationError: String?
    var isRevising = false
    var showFullScreenPrompt = false

    // User-generated stories (published or private author drafts)
    var publishedStories: [GeneratedStory] = []

    // Continue wizard state (in-session only)
    var showContinueWizard: Bool = false
    var continueWizardStep: ContinueWizardStep = .direction
    var continueWizardStoryId: String? = nil
    var continueWizardDirection: String = ""
    var continueWizardChapterNumber: Int = 2
    var continueWizardGenre: Genre? = nil
    var continueWizardLanguage: StoryLanguage = .en
    var continueWizardPlannedChapterCount: Int? = nil
    var continueWizardStoryTitle: String = ""
    var continueWizardFollowerCount: Int = 0
    var isGeneratingChapter: Bool = false
    var chapterGenerationError: String? = nil
    var lastGeneratedChapter: GeneratedChapter? = nil
    var showChapterGetIdeasSheet: Bool = false
    var showDiscardChapterModal: Bool = false

    // Publish / Delete modals
    var showPublishModal: Bool = false
    var showDeleteDraftModal: Bool = false
    var isPublishing: Bool = false
    var isDeleting: Bool = false
    var pendingPublishStoryId: String? = nil
    var pendingPublishChapterId: String? = nil
    var pendingDeleteStoryId: String? = nil
    var pendingDeleteChapterId: String? = nil

    // Unfollow confirmation
    var showUnfollowStoryModal: Bool = false
    var pendingUnfollowStoryId: String? = nil
    var pendingUnfollowStoryTitle: String = ""
    var hasConfirmedUnfollowThisSession: Bool = false

    // Profile navigation (overlay stack)
    var profileStack: [ProfileRoute] = []

    // Follow author (optimistic follower count overrides)
    var authorFollowerOverrides: [String: Int] = [:]
    var showUnfollowAuthorModal: Bool = false
    var pendingUnfollowAuthorId: String? = nil
    var pendingUnfollowAuthorName: String = ""
    var hasConfirmedAuthorUnfollowThisSession: Bool = false

    // Edit profile
    var isSavingProfile: Bool = false
    var lastUsernameChange: Date? = nil

    // Comment credit tracking (in-session)
    var commentedTodayKeys: Set<String> = []

    // Tab navigation requests from overlays
    var requestedTab: Int? = nil

    // MARK: - Engagement Store (Prompt 6)

    // User-created comments (persisted)
    var userComments: [StoryComment] = []
    // Comment likes (persisted)
    var likedCommentIds: Set<String> = []
    // Soft-deleted comments (persisted)
    var deletedCommentIds: Set<String> = []
    // Reported comments (persisted)
    var reportedCommentIds: Set<String> = []
    // Comment like count overrides (for seed comments)
    var commentLikeOverrides: [String: Int] = [:]

    // Story engagement overrides (likes/shares/books can go up from seed)
    var storyLikeOverrides: [String: Int] = [:]  // storyId -> delta from seed
    var storyShareOverrides: [String: Int] = [:]
    // Chapter likes (persisted)
    var likedChapterIds: Set<String> = []

    // Blocking (persisted)
    var blockedUserIds: Set<String> = []

    // Comments sheet state
    var showCommentsSheet: Bool = false
    var commentsSheetStoryId: String? = nil
    var commentsSheetChapterId: String? = nil
    var commentsSortNewest: Bool = false
    var replyToComment: StoryComment? = nil
    var composerText: String = ""
    var highlightedCommentId: String? = nil

    // Report sheet state
    var showReportSheet: Bool = false
    var pendingReportTarget: ReportTarget? = nil

    // Block modal state
    var showBlockUserModal: Bool = false
    var pendingBlockAuthorId: String? = nil
    var pendingBlockAuthorName: String = ""

    // Share sheet state
    var sharePayload: SharePayload? = nil

    // Discover feed ranking
    var discoverFeedChip: Int = 1  // 0=ForYou, 1=Trending, 2=Rising, 3=New
    var discoverThemeFilter: String? = nil
    var discoverGenreFilter: Genre? = nil

    // Audio mini-bar state (FIX 8)
    var audioReadyStoryIds: Set<String> = []  // persisted
    var audioPreparingStoryId: String? = nil  // in-session
    var audioErrorStoryId: String? = nil  // in-session
    var audioPrepTask: Task<Void, Never>? = nil

    // MARK: - Prompt 12 retention state
    var streak = StreakState.initial
    var notificationPreferences = NotificationPreferences()
    var notificationPermissionGranted = false
    var showStreakScreen = false
    var showNotificationsScreen = false
    var showInviteFriendsScreen = false
    var showStorageScreen = false
    var showPrePermissionModal = false
    var showStreakResetModal = false
    var streakRiskBannerVisible = false
    var referralCode = ""
    var referredByCode: String?
    var referralRecords: [ReferralRecord] = []
    var offlineStoryRecords: [OfflineStoryRecord] = []
    var downloadProgress: Double?
    var downloadStoryTitle = ""
    var audioPlayerStoryId: String?
    var showAudioPlayer = false
    var audioIsPlaying = false
    var audioProgress: Double = 0
    var audioSpeed: Double = 1
    var audioSleepTimerEnd: Date?
    var audioShowingRemaining = false
    var storyGenerationCount = 0
    var activeDayCount = 0
    var ratePromptLastShown: Date?

    // MARK: - Credit Ledger (Prompt 8+9)

    // Credit ledger entries (persisted)
    var creditLedger: [CreditLedgerEntry] = []

    // Premium subscription state (persisted)
    var isPremium: Bool = false
    var subscriptionType: SubscriptionPlan? = nil
    var subscriptionExpiresAt: Date? = nil

    // Ad reward cooldown (persisted)
    var lastAdCreditTimestamp: Date? = nil

    // Credits screen state (in-session)
    var showCreditsScreen: Bool = false
    var showSubscriptionPaywall: Bool = false
    var showCreditPackSheet: Bool = false
    var showSubscriptionManagement: Bool = false
    var showCreditHistory: Bool = false
    var creditPackSheetPreselectedId: String? = nil

    // Ad flow state (in-session)
    var showMockAdScreen: Bool = false
    var adWatchState: AdWatchState = .available
    var isPurchasingSubscription: Bool = false
    var isPurchasingPack: Bool = false
    var isRestoringPurchases: Bool = false
    var showAdRewardToast: Bool = false
    var adRewardBalance: Int = 0

    // Profile route for credits/paywall (overlay)
    var creditsStack: [CreditsRoute] = []

    // MARK: - Analytics (Prompt 10)

    // Analytics overlay state
    var showStoryAnalytics: Bool = false
    var analyticsStory: Story? = nil
    var showDashboard: Bool = false
    var analyticsTimeRangeTrigger: Int = 0

    // Celebration banner + reader-earning toast
    var showReaderEarningToast: Bool = false
    var readerEarningCredits: Int = 0
    var readerEarningStoryTitle: String = ""
    var readerEarningStoryId: String = ""

    // Dev tools
    var showDevTools: Bool = false
    var devTapCount: Int = 0

    // MARK: - Computed

    var isAuthenticated: Bool { currentUser != nil }

    var credits: Int { currentUser?.credits ?? 0 }

    var canCreateStory: Bool { isAuthenticated && credits > 0 && !isGenerating }

    var canGenerateChapter: Bool { isAuthenticated && credits > 0 && !isGeneratingChapter }

    var isWizardDirty: Bool {
        wizardGenre != nil || !wizardTopic.isEmpty || !wizardCharacters.isEmpty || wizardStep != .genre
    }

    var hasCompletedOnboarding: Bool {
        defaults.bool(forKey: "katha.onboarding.completed")
    }

    var hasUnreadNewChapters: Bool {
        !newChapterNotifications.isEmpty && newChapterNotifications.contains { !dismissedBannerStoryIds.contains($0.storyId) }
    }

    var unreadNewChapterNotifications: [NewChapterNotification] {
        newChapterNotifications.filter { !dismissedBannerStoryIds.contains($0.storyId) }
    }

    var currentStreak: Int { streak.current }

    /// If the username was changed within the last 30 days, the date it unlocks; nil otherwise
    var usernameChangeUnlockDate: Date? {
        guard let last = lastUsernameChange else { return nil }
        let unlock = last.addingTimeInterval(30 * 24 * 3600)
        return unlock > Date() ? unlock : nil
    }

    // MARK: - Private

    private let defaults = UserDefaults.standard

    // MARK: - Init

    init() {
        loadPersistedState()
        if readingProgress.isEmpty {
            readingProgress["story-5"] = ReadingProgress(storyId: "story-5", chapterIndex: 0, scrollProgress: 0.40, lastReadOffset: 0)
            readingProgress["story-4"] = ReadingProgress(storyId: "story-4", chapterIndex: 0, scrollProgress: 0.15, lastReadOffset: 0)
        }
    }

    // MARK: - Persistence

    private func loadPersistedState() {
        lastUsernameChange = defaults.object(forKey: "katha.lastUsernameChange") as? Date
        followedAuthorIds = Set(defaults.stringArray(forKey: "katha.followedAuthors") ?? [])
        likedStoryIds = Set(defaults.stringArray(forKey: "katha.likedStories") ?? [])
        bookmarkedStoryIds = Set(defaults.stringArray(forKey: "katha.bookmarkedStories") ?? [])
        followedStoryIds = Set(defaults.stringArray(forKey: "katha.followedStories") ?? [])
        readerSepia = defaults.bool(forKey: "katha.readerSepia")
        readerFontSize = defaults.object(forKey: "katha.readerFontSize") as? Int ?? 18
        appThemeMode = AppThemeMode(rawValue: defaults.string(forKey: "katha.appThemeMode") ?? "auto") ?? .auto
        defaultReadingLevel = ReadingLevel(rawValue: defaults.string(forKey: "katha.defaultReadingLevel") ?? "standard") ?? .standard
        wizardReadingLevel = defaultReadingLevel
        kidsMode = defaults.bool(forKey: "katha.kidsMode")
        kidsModePin = defaults.string(forKey: "katha.kidsModePin")
        pinCooldownUntil = defaults.object(forKey: "katha.pinCooldownUntil") as? Date
        kidsReadingLevelCap = ReadingLevel(rawValue: defaults.string(forKey: "katha.kidsReadingLevelCap") ?? "standard") ?? .standard
        kidsCommentsEnabled = defaults.object(forKey: "katha.kidsCommentsEnabled") as? Bool ?? false
        kidsShareEnabled = defaults.object(forKey: "katha.kidsShareEnabled") as? Bool ?? false
        kidsSearchSuggestionsEnabled = defaults.object(forKey: "katha.kidsSearchSuggestionsEnabled") as? Bool ?? true
        ageVerified = defaults.bool(forKey: "katha.ageVerified")
        audioReadyStoryIds = Set(defaults.stringArray(forKey: "katha.audioReady") ?? [])
        if let data = defaults.data(forKey: "katha.streak"), let decoded = try? JSONDecoder().decode(StreakState.self, from: data) { streak = decoded }
        if let data = defaults.data(forKey: "katha.notificationPreferences"), let decoded = try? JSONDecoder().decode(NotificationPreferences.self, from: data) { notificationPreferences = decoded }
        if let data = defaults.data(forKey: "katha.referrals"), let decoded = try? JSONDecoder().decode([ReferralRecord].self, from: data) { referralRecords = decoded }
        if let data = defaults.data(forKey: "katha.offlineStories"), let decoded = try? JSONDecoder().decode([OfflineStoryRecord].self, from: data) { offlineStoryRecords = decoded }
        referredByCode = defaults.string(forKey: "katha.referredBy")
        referralCode = defaults.string(forKey: "katha.referralCode") ?? ""
        storyGenerationCount = defaults.integer(forKey: "katha.storyGenerationCount")
        activeDayCount = defaults.integer(forKey: "katha.activeDayCount")
        ratePromptLastShown = defaults.object(forKey: "katha.ratePromptLastShown") as? Date
        notificationPermissionGranted = defaults.bool(forKey: "katha.notificationPermissionGranted")
        if isPremium && streak.freezesAvailable == 0 { streak.freezesAvailable = 2 }

        // Credit ledger
        isPremium = defaults.bool(forKey: "katha.isPremium")
        if let planRaw = defaults.string(forKey: "katha.subscriptionType") {
            subscriptionType = SubscriptionPlan(rawValue: planRaw)
        }
        subscriptionExpiresAt = defaults.object(forKey: "katha.subscriptionExpiresAt") as? Date
        lastAdCreditTimestamp = defaults.object(forKey: "katha.lastAdCredit") as? Date
        if let data = defaults.data(forKey: "katha.creditLedger"),
           let decoded = try? JSONDecoder().decode([CreditLedgerEntry].self, from: data) {
            creditLedger = decoded
        }

        // Engagement store
        likedCommentIds = Set(defaults.stringArray(forKey: "katha.likedComments") ?? [])
        deletedCommentIds = Set(defaults.stringArray(forKey: "katha.deletedComments") ?? [])
        reportedCommentIds = Set(defaults.stringArray(forKey: "katha.reportedComments") ?? [])
        likedChapterIds = Set(defaults.stringArray(forKey: "katha.likedChapters") ?? [])
        blockedUserIds = Set(defaults.stringArray(forKey: "katha.blockedUsers") ?? [])
        if let data = defaults.data(forKey: "katha.userComments"),
           let decoded = try? JSONDecoder().decode([StoryComment].self, from: data) {
            userComments = decoded
        }
        if let data = defaults.data(forKey: "katha.creationComposer"),
           let decoded = try? JSONDecoder().decode(PersistedComposerState.self, from: data) {
            wizardGenre = decoded.genre
            wizardTopic = decoded.topic
            wizardCharacters = decoded.characters
            wizardLanguage = decoded.language
            wizardReadingLevel = decoded.readingLevel
            wizardPlanAsSeries = decoded.planAsSeries
            wizardSeriesChapterCount = decoded.seriesChapterCount
            wizardStep = decoded.genre == nil ? .genre : .topic
        }
        if let data = defaults.data(forKey: "katha.creationDraft"),
           let decoded = try? JSONDecoder().decode(PersistedGeneratedStory.self, from: data) {
            let draft = decoded.generatedStory
            lastGeneratedStory = draft
            publishedStories = [draft]
            creationPhase = draft.isPublished ? .published : .draftReady
        }
    }

    private func persistSafetyState() {
        defaults.set(defaultReadingLevel.rawValue, forKey: "katha.defaultReadingLevel")
        defaults.set(kidsMode, forKey: "katha.kidsMode")
        if let kidsModePin { defaults.set(kidsModePin, forKey: "katha.kidsModePin") } else { defaults.removeObject(forKey: "katha.kidsModePin") }
        if let pinCooldownUntil { defaults.set(pinCooldownUntil, forKey: "katha.pinCooldownUntil") } else { defaults.removeObject(forKey: "katha.pinCooldownUntil") }
        defaults.set(kidsReadingLevelCap.rawValue, forKey: "katha.kidsReadingLevelCap")
        defaults.set(kidsCommentsEnabled, forKey: "katha.kidsCommentsEnabled")
        defaults.set(kidsShareEnabled, forKey: "katha.kidsShareEnabled")
        defaults.set(kidsSearchSuggestionsEnabled, forKey: "katha.kidsSearchSuggestionsEnabled")
        defaults.set(ageVerified, forKey: "katha.ageVerified")
    }

    func persistPrompt12State() {
        if let data = try? JSONEncoder().encode(streak) { defaults.set(data, forKey: "katha.streak") }
        if let data = try? JSONEncoder().encode(notificationPreferences) { defaults.set(data, forKey: "katha.notificationPreferences") }
        if let data = try? JSONEncoder().encode(referralRecords) { defaults.set(data, forKey: "katha.referrals") }
        if let data = try? JSONEncoder().encode(offlineStoryRecords) { defaults.set(data, forKey: "katha.offlineStories") }
        defaults.set(referralCode, forKey: "katha.referralCode")
        if let referredByCode { defaults.set(referredByCode, forKey: "katha.referredBy") } else { defaults.removeObject(forKey: "katha.referredBy") }
        defaults.set(storyGenerationCount, forKey: "katha.storyGenerationCount")
        defaults.set(activeDayCount, forKey: "katha.activeDayCount")
        defaults.set(notificationPermissionGranted, forKey: "katha.notificationPermissionGranted")
    }

    private func persistCreationState() {
        let composer = PersistedComposerState(
            genre: wizardGenre,
            topic: wizardTopic,
            characters: wizardCharacters,
            language: wizardLanguage,
            readingLevel: wizardReadingLevel,
            planAsSeries: wizardPlanAsSeries,
            seriesChapterCount: wizardSeriesChapterCount
        )
        if let data = try? JSONEncoder().encode(composer) {
            defaults.set(data, forKey: "katha.creationComposer")
        }
        if let draft = lastGeneratedStory,
           let data = try? JSONEncoder().encode(PersistedGeneratedStory(story: draft)) {
            defaults.set(data, forKey: "katha.creationDraft")
        } else {
            defaults.removeObject(forKey: "katha.creationDraft")
        }
    }

    private func persistSocialState() {
        defaults.set(Array(followedAuthorIds), forKey: "katha.followedAuthors")
        defaults.set(Array(likedStoryIds), forKey: "katha.likedStories")
        defaults.set(Array(bookmarkedStoryIds), forKey: "katha.bookmarkedStories")
        defaults.set(Array(followedStoryIds), forKey: "katha.followedStories")
    }

    private func persistEngagementState() {
        defaults.set(Array(likedCommentIds), forKey: "katha.likedComments")
        defaults.set(Array(deletedCommentIds), forKey: "katha.deletedComments")
        defaults.set(Array(reportedCommentIds), forKey: "katha.reportedComments")
        defaults.set(Array(likedChapterIds), forKey: "katha.likedChapters")
        defaults.set(Array(blockedUserIds), forKey: "katha.blockedUsers")
        if let data = try? JSONEncoder().encode(userComments) {
            defaults.set(data, forKey: "katha.userComments")
        }
    }

    private func persistCreditLedger() {
        defaults.set(isPremium, forKey: "katha.isPremium")
        if let plan = subscriptionType {
            defaults.set(plan.rawValue, forKey: "katha.subscriptionType")
        } else {
            defaults.removeObject(forKey: "katha.subscriptionType")
        }
        if let expires = subscriptionExpiresAt {
            defaults.set(expires, forKey: "katha.subscriptionExpiresAt")
        } else {
            defaults.removeObject(forKey: "katha.subscriptionExpiresAt")
        }
        if let ts = lastAdCreditTimestamp {
            defaults.set(ts, forKey: "katha.lastAdCredit")
        } else {
            defaults.removeObject(forKey: "katha.lastAdCredit")
        }
        if let data = try? JSONEncoder().encode(creditLedger) {
            defaults.set(data, forKey: "katha.creditLedger")
        }
    }

    private func saveSession(_ session: UserSession?) {
        if let session, let data = try? JSONEncoder().encode(session) {
            defaults.set(data, forKey: "katha.session")
        } else {
            defaults.removeObject(forKey: "katha.session")
        }
    }

    private func getStoredSession(forEmail email: String) -> UserSession? {
        guard let data = defaults.data(forKey: "katha.session"),
              let session = try? JSONDecoder().decode(UserSession.self, from: data) else {
            return nil
        }
        return session.email == email ? session : nil
    }

    // MARK: - Splash & Onboarding

    func startSplash() {
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard let self else { return }
            withAnimation(.easeInOut(duration: 0.3)) {
                appPhase = hasCompletedOnboarding ? .main : .onboarding
            }
        }
    }

    func completeOnboarding(purpose: String? = nil) {
        if let purpose { defaults.set(purpose, forKey: "onboarding_purpose") }
        defaults.set(true, forKey: "katha.onboarding.completed")
        withAnimation(.easeInOut(duration: 0.3)) {
            appPhase = .main
        }
    }

    // MARK: - Auth (Mock Mode)

    func signInWithEmail(_ email: String) async {
        guard email.contains("@"), email.contains(".") else {
            authError = "Please enter a valid email address."
            return
        }
        await performMockAuth(email: email, provider: "email")
    }

    func signInWithGoogle() async {
        await performMockAuth(email: "you@gmail.com", provider: "google")
    }

    func signInWithApple() async {
        await performMockAuth(email: "you@privaterelay.appleid.com", provider: "apple")
    }

    private func performMockAuth(email: String, provider: String) async {
        isAuthenticating = true
        authError = nil
        try? await Task.sleep(for: .milliseconds(800))
        isAuthenticating = false

        if let existing = getStoredSession(forEmail: email) {
            currentUser = existing
            finishAuth(needsProfileSetup: false)
            return
        }

        let username = UsernameGenerator.generate()
        let session = UserSession(
            id: UUID().uuidString,
            email: email,
            username: username,
            displayName: "",
            bio: "",
            credits: 3,
            followers: 0,
            following: 4,
            avatarPaletteIndex: AvatarPalette.paletteFor(username: username).id
        )
        currentUser = session
        followedAuthorIds = ["kathaai", "zoeok", "priyanair", "mayak"]
        persistSocialState()
        saveSession(session)
        finishAuth(needsProfileSetup: true)
    }

    private func finishAuth(needsProfileSetup: Bool) {
        showAuthSheet = false
        if needsProfileSetup {
            generatedUsername = currentUser?.username ?? ""
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(400))
                guard let self else { return }
                self.showProfileSetup = true
            }
        } else {
            handlePostAuth()
        }
    }

    func completeProfileSetup(username: String, displayName: String, bio: String) {
        guard let current = currentUser else { return }
        let updated = UserSession(
            id: current.id,
            email: current.email,
            username: username,
            displayName: displayName,
            bio: bio,
            credits: current.credits,
            followers: current.followers,
            following: current.following,
            avatarPaletteIndex: AvatarPalette.paletteFor(username: username).id
        )
        currentUser = updated
        saveSession(updated)
        showProfileSetup = false
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard let self else { return }
            self.handlePostAuth()
        }
    }

    private func handlePostAuth() {
        if let story = pendingStoryForReader {
            selectedStory = story
            showReader = true
            pendingStoryForReader = nil
        }
        ensureWelcomeBonus()
        let name = currentUser?.displayName.isEmpty == false
            ? currentUser?.displayName ?? "friend"
            : "friend"
        showToast("Welcome to Katha, \(name)!", isWelcome: true)
    }

    func signOut() {
        currentUser = nil
        followedAuthorIds = []
        likedStoryIds = []
        bookmarkedStoryIds = []
        followedStoryIds = []
        storyFollowerOverrides = [:]
        authorFollowerOverrides = [:]
        profileStack = []
        newChapterNotifications = []
        userComments = []
        likedCommentIds = []
        deletedCommentIds = []
        reportedCommentIds = []
        commentLikeOverrides = [:]
        storyLikeOverrides = [:]
        storyShareOverrides = [:]
        likedChapterIds = []
        blockedUserIds = []
        showCommentsSheet = false
        showReportSheet = false
        showBlockUserModal = false
        saveSession(nil)
        persistSocialState()
        persistEngagementState()
        showAuthSheet = false
        showProfileSetup = false
        showReader = false
        selectedStory = nil
        resetWizard()
        resetContinueWizard()
        withAnimation(.easeInOut(duration: 0.3)) {
            appPhase = .main
        }
        showToast("Signed out")
    }

    func deleteAccount() {
        currentUser = nil
        followedAuthorIds = []
        likedStoryIds = []
        bookmarkedStoryIds = []
        followedStoryIds = []
        authorFollowerOverrides = [:]
        profileStack = []
        readingProgress = [:]
        userComments = []
        likedCommentIds = []
        deletedCommentIds = []
        reportedCommentIds = []
        commentLikeOverrides = [:]
        storyLikeOverrides = [:]
        storyShareOverrides = [:]
        likedChapterIds = []
        blockedUserIds = []
        defaults.removeObject(forKey: "katha.lastUsernameChange")
        defaults.removeObject(forKey: "katha.session")
        defaults.removeObject(forKey: "katha.followedAuthors")
        defaults.removeObject(forKey: "katha.likedStories")
        defaults.removeObject(forKey: "katha.bookmarkedStories")
        defaults.removeObject(forKey: "katha.followedStories")
        defaults.removeObject(forKey: "katha.likedComments")
        defaults.removeObject(forKey: "katha.deletedComments")
        defaults.removeObject(forKey: "katha.reportedComments")
        defaults.removeObject(forKey: "katha.likedChapters")
        defaults.removeObject(forKey: "katha.blockedUsers")
        defaults.removeObject(forKey: "katha.userComments")
        defaults.set(false, forKey: "katha.onboarding.completed")
        showAuthSheet = false
        showProfileSetup = false
        showReader = false
        selectedStory = nil
        withAnimation(.easeInOut(duration: 0.5)) {
            appPhase = .splash
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self else { return }
            withAnimation(.easeInOut(duration: 0.4)) {
                appPhase = .onboarding
            }
        }
    }

    // MARK: - Auth Sheet

    var authSheetContext: AuthSheetContext = .generic

    func presentAuthSheet(readerWall: Bool, pendingStory: Story? = nil) {
        authSheetIsReaderWall = readerWall
        pendingStoryForReader = pendingStory
        showAuthSheet = true
    }

    func presentAuthSheet(context: AuthSheetContext, pendingStory: Story? = nil) {
        authSheetIsReaderWall = context == .readerWall
        authSheetContext = context
        pendingStoryForReader = pendingStory
        showAuthSheet = true
    }

    func dismissAuthSheet() {
        guard !authSheetIsReaderWall else { return }
        showAuthSheet = false
        pendingStoryForReader = nil
    }

    // MARK: - Story Like (with engagement overrides)

    func toggleLike(storyId: String) {
        guard isAuthenticated else {
            presentAuthSheet(context: .like)
            return
        }
        if likedStoryIds.contains(storyId) {
            likedStoryIds.remove(storyId)
            storyLikeOverrides[storyId] = (storyLikeOverrides[storyId] ?? 0) - 1
        } else {
            likedStoryIds.insert(storyId)
            storyLikeOverrides[storyId] = (storyLikeOverrides[storyId] ?? 0) + 1
            Haptics.light()
        }
        persistSocialState()
    }

    func storyLikeCount(storyId: String, baseCount: Int) -> Int {
        max(0, baseCount + (storyLikeOverrides[storyId] ?? 0))
    }

    func storyShareCount(storyId: String, baseCount: Int) -> Int {
        baseCount + (storyShareOverrides[storyId] ?? 0)
    }

    func isLiked(_ storyId: String) -> Bool {
        likedStoryIds.contains(storyId)
    }

    func toggleBookmark(storyId: String) {
        guard isAuthenticated else {
            presentAuthSheet(readerWall: false)
            return
        }
        if bookmarkedStoryIds.contains(storyId) {
            bookmarkedStoryIds.remove(storyId)
        } else {
            bookmarkedStoryIds.insert(storyId)
            showToast("Saved to library")
            recordStreakActivity(summary: "Bookmarked a story")
        }
        persistSocialState()
    }

    func isBookmarked(_ storyId: String) -> Bool {
        bookmarkedStoryIds.contains(storyId)
    }

    func toggleFollow(authorId: String) {
        toggleFollowAuthor(authorId: authorId, confirmUnfollow: false)
    }

    /// Follow/unfollow an author with optimistic follower count updates.
    /// First unfollow per session shows a confirmation modal when `confirmUnfollow` is true.
    func toggleFollowAuthor(authorId: String, confirmUnfollow: Bool = true) {
        guard isAuthenticated else {
            presentAuthSheet(readerWall: false)
            return
        }
        if followedAuthorIds.contains(authorId) {
            if confirmUnfollow && !hasConfirmedAuthorUnfollowThisSession {
                pendingUnfollowAuthorId = authorId
                pendingUnfollowAuthorName = SeedData.author(id: authorId)?.displayName ?? "this writer"
                showUnfollowAuthorModal = true
            } else {
                unfollowAuthor(authorId)
            }
        } else {
            followedAuthorIds.insert(authorId)
            let base = SeedData.author(id: authorId)?.followers ?? 0
            authorFollowerOverrides[authorId] = authorFollowerCount(authorId: authorId, baseCount: base) + 1
            persistSocialState()
            Haptics.light()
            if let author = SeedData.author(id: authorId) {
                showToast("Following \(author.displayName)")
            }
        }
    }

    private func unfollowAuthor(_ authorId: String) {
        followedAuthorIds.remove(authorId)
        let base = SeedData.author(id: authorId)?.followers ?? 0
        authorFollowerOverrides[authorId] = max(0, authorFollowerCount(authorId: authorId, baseCount: base) - 1)
        persistSocialState()
        Haptics.light()
    }

    func confirmUnfollowAuthor() {
        if let authorId = pendingUnfollowAuthorId {
            unfollowAuthor(authorId)
        }
        showUnfollowAuthorModal = false
        pendingUnfollowAuthorId = nil
        hasConfirmedAuthorUnfollowThisSession = true
    }

    func cancelUnfollowAuthor() {
        showUnfollowAuthorModal = false
        pendingUnfollowAuthorId = nil
    }

    func isFollowing(_ authorId: String) -> Bool {
        followedAuthorIds.contains(authorId)
    }

    func authorFollowerCount(authorId: String, baseCount: Int) -> Int {
        authorFollowerOverrides[authorId] ?? baseCount
    }

    // MARK: - Profile Navigation

    /// Opens an author's profile; routes to own profile if the id matches the current user.
    func openAuthorProfile(_ authorId: String) {
        Haptics.light()
        if let user = currentUser, authorId == user.username || authorId == user.id {
            profileStack.append(ProfileRoute(kind: .profile("me")))
        } else {
            profileStack.append(ProfileRoute(kind: .profile(authorId)))
        }
    }

    func openOwnProfile() {
        Haptics.light()
        profileStack.append(ProfileRoute(kind: .profile("me")))
    }

    func pushProfileRoute(_ kind: ProfileRoute.Kind) {
        profileStack.append(ProfileRoute(kind: kind))
    }

    func popProfileRoute() {
        guard !profileStack.isEmpty else { return }
        profileStack.removeLast()
    }

    func closeAllProfiles() {
        profileStack = []
    }

    /// Writers-to-follow suggestions: not followed, not self, sorted by follower count.
    var suggestedAuthors: [Author] {
        SeedData.authors
            .filter { !followedAuthorIds.contains($0.id) && $0.username != currentUser?.username }
            .sorted { authorFollowerCount(authorId: $0.id, baseCount: $0.followers) > authorFollowerCount(authorId: $1.id, baseCount: $1.followers) }
            .prefix(8)
            .map { $0 }
    }

    // MARK: - Edit Profile

    /// Saves profile edits with a mock 400ms delay. Returns true on success.
    func saveProfile(displayName: String, username: String, bio: String) async -> Bool {
        guard let user = currentUser else { return false }
        isSavingProfile = true
        try? await Task.sleep(for: .milliseconds(400))

        let usernameChanged = username.lowercased() != user.username.lowercased()
        let updated = UserSession(
            id: user.id,
            email: user.email,
            username: username,
            displayName: displayName,
            bio: bio,
            credits: user.credits,
            followers: user.followers,
            following: user.following,
            avatarPaletteIndex: user.avatarPaletteIndex
        )
        currentUser = updated
        saveSession(updated)

        if usernameChanged {
            lastUsernameChange = Date()
            defaults.set(lastUsernameChange, forKey: "katha.lastUsernameChange")
        }

        isSavingProfile = false
        Haptics.success()
        showToast("Profile updated ✨")
        return true
    }

    // MARK: - Follow Story

    func toggleFollowStory(storyId: String, storyTitle: String = "", followerCount: Int = 0) {
        guard isAuthenticated else {
            presentAuthSheet(readerWall: false)
            return
        }
        if followedStoryIds.contains(storyId) {
            if !hasConfirmedUnfollowThisSession {
                pendingUnfollowStoryId = storyId
                pendingUnfollowStoryTitle = storyTitle
                showUnfollowStoryModal = true
            } else {
                unfollowStory(storyId: storyId)
            }
        } else {
            followedStoryIds.insert(storyId)
            storyFollowerOverrides[storyId] = max(0, followerCount) + 1
            persistSocialState()
            Haptics.light()
            showToast("Following \"\(storyTitle)\"")
        }
    }

    func confirmUnfollowStory() {
        if let storyId = pendingUnfollowStoryId {
            unfollowStory(storyId: storyId)
        }
        showUnfollowStoryModal = false
        pendingUnfollowStoryId = nil
        hasConfirmedUnfollowThisSession = true
    }

    func cancelUnfollowStory() {
        showUnfollowStoryModal = false
        pendingUnfollowStoryId = nil
    }

    private func unfollowStory(storyId: String) {
        followedStoryIds.remove(storyId)
        if let count = storyFollowerOverrides[storyId] {
            storyFollowerOverrides[storyId] = max(0, count - 1)
        }
        persistSocialState()
        Haptics.light()
        newChapterNotifications.removeAll { $0.storyId == storyId }
    }

    func isFollowingStory(_ storyId: String) -> Bool {
        followedStoryIds.contains(storyId)
    }

    func storyFollowerCount(storyId: String, baseCount: Int) -> Int {
        storyFollowerOverrides[storyId] ?? baseCount
    }

    // MARK: - Reader

    func openReader(story: Story, chapterIndex: Int = 0) {
        selectedStory = story
        currentChapterIndex = min(chapterIndex, max(0, story.chapters.count - 1))
        showReader = true
    }

    func closeReader() {
        showReader = false
        selectedStory = nil
    }

    func navigateToChapter(index: Int) {
        guard let story = selectedStory else { return }
        guard index >= 0, index < story.chapters.count else { return }
        Haptics.light()
        withAnimation(.easeInOut(duration: 0.3)) {
            currentChapterIndex = index
        }
    }

    func navigateToNextChapter() {
        navigateToChapter(index: currentChapterIndex + 1)
    }

    func navigateToPreviousChapter() {
        navigateToChapter(index: currentChapterIndex - 1)
    }

    func showChapterList() {
        showChapterListSheet = true
    }

    func dismissChapterList() {
        showChapterListSheet = false
    }

    // MARK: - Reading Progress

    func updateReadingProgress(storyId: String, chapterIndex: Int, scrollProgress: Double) {
        readingProgress[storyId] = ReadingProgress(
            storyId: storyId,
            chapterIndex: chapterIndex,
            scrollProgress: scrollProgress,
            lastReadOffset: 0
        )
    }

    func getReadingProgress(storyId: String) -> ReadingProgress? {
        readingProgress[storyId]
    }

    // MARK: - Toast

    func showToast(_ message: String, isWelcome: Bool = false) {
        toastMessage = message
        toastIsWelcome = isWelcome
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self else { return }
            if toastMessage == message {
                toastMessage = nil
            }
        }
    }

    // MARK: - Settings

    func setAppThemeMode(_ mode: AppThemeMode) {
        appThemeMode = mode
        defaults.set(mode.rawValue, forKey: "katha.appThemeMode")
    }

    func setReaderFontSize(_ size: Int) {
        readerFontSize = [15, 17, 18, 20, 22].min(by: { abs($0 - size) < abs($1 - size) }) ?? 18
        defaults.set(readerFontSize, forKey: "katha.readerFontSize")
    }

    func toggleReaderSepia() {
        readerSepia.toggle()
        defaults.set(readerSepia, forKey: "katha.readerSepia")
    }

    func openReadingLevelSheet(forWizard: Bool = false, forCap: Bool = false) {
        readingLevelSheetForWizard = forWizard
        readingLevelSheetForCap = forCap
        showReadingLevelSheet = true
    }

    func setKidsCommentsEnabled(_ enabled: Bool) {
        kidsCommentsEnabled = enabled
        persistSafetyState()
    }

    func setKidsShareEnabled(_ enabled: Bool) {
        kidsShareEnabled = enabled
        persistSafetyState()
    }

    func setKidsSearchSuggestionsEnabled(_ enabled: Bool) {
        kidsSearchSuggestionsEnabled = enabled
        persistSafetyState()
    }

    func selectReadingLevel(_ level: ReadingLevel) {
        if readingLevelSheetForWizard {
            wizardReadingLevel = level
        } else if readingLevelSheetForCap {
            kidsReadingLevelCap = level == .advanced ? .standard : level
            persistSafetyState()
        } else {
            defaultReadingLevel = level
            persistSafetyState()
        }
    }

    func openParentalControls() { showParentalControls = true }

    func beginKidsModeEnable() {
        pinSetupMode = .enableKidsMode
        showPINSetup = true
    }

    func completeKidsModeEnable(pin: String) {
        kidsModePin = pin
        kidsMode = true
        ageVerified = false
        persistSafetyState()
        showPINSetup = false
        showParentalControls = true
        Haptics.success()
        showToast("Kids mode enabled ✨")
    }

    func beginPinChange() {
        pinSetupMode = .changePin
        pinEntryContext = .changePin
        showPINEntry = true
    }

    func beginKidsModeDisable() {
        pinEntryContext = .disableKidsMode
        showPINEntry = true
    }

    func verifyPin(_ pin: String) -> Bool {
        guard let kidsModePin, !kidsModePin.isEmpty else { return false }
        return pin == kidsModePin
    }

    func completePinChange(pin: String) {
        kidsModePin = pin
        showPINSetup = false
        showPINEntry = false
        pinCooldownUntil = nil
        persistSafetyState()
        showToast("PIN updated")
    }

    func completePinEntry() {
        showPINEntry = false
        pinCooldownUntil = nil
        persistSafetyState()
        if pinEntryContext == .disableKidsMode {
            kidsMode = false
            persistSafetyState()
            showToast("Kids mode turned off")
        } else if pinEntryContext == .changePin {
            showPINSetup = true
        }
    }

    func recordPinFailure() {
        pinCooldownUntil = Date().addingTimeInterval(5 * 60)
        persistSafetyState()
    }

    var isPinCooldownActive: Bool {
        guard let pinCooldownUntil else { return false }
        return pinCooldownUntil > Date()
    }

    func confirmAgeVerification() {
        ageVerified = true
        persistSafetyState()
        showAgeVerification = false
        Haptics.light()
    }

    func resetAgeVerification() {
        ageVerified = false
        persistSafetyState()
        showToast("Age verification reset")
    }

    func isStoryVisibleInKidsMode(_ story: Story) -> Bool {
        !kidsMode || story.effectiveContentRating != .mature
    }

    // MARK: - Wizard

    func resetWizard() {
        wizardStep = .genre
        wizardGenre = nil
        wizardTopic = ""
        wizardCharacters = []
        wizardLanguage = .en
        wizardReadingLevel = defaultReadingLevel
        wizardPlanAsSeries = false
        wizardSeriesChapterCount = 3
        isGenerating = false
        generationError = nil
        showOutOfCreditsModal = false
        showLanguageSheet = false
        showGetIdeasSheet = false
        creationPhase = .composer
        creationRevisionPrompt = ""
        creationCoverProgress = 0
        creationIsEditingText = false
        creationDraftSaved = false
        creationError = nil
        isRevising = false
        showFullScreenPrompt = false
        lastGeneratedStory = nil
        publishedStories.removeAll { !$0.isPublished }
        persistCreationState()
    }

    func startCreatingStory() {
        guard isAuthenticated else {
            presentAuthSheet(readerWall: false)
            return
        }
        guard credits > 0 else {
            showOutOfCreditsModal = true
            return
        }
        resetWizard()
    }

    func setWizardGenre(_ genre: Genre) {
        if genre == .erotica && !ageVerified {
            showAgeVerification = true
            return
        }
        if kidsMode && genre == .erotica {
            showToast("Erotica is unavailable in Kids Mode")
            return
        }
        wizardGenre = genre
        wizardStep = .topic
        persistCreationState()
    }

    func addWizardCharacter() {
        let index = wizardCharacters.count + 1
        wizardCharacters.append(WizardCharacter(
            id: UUID().uuidString,
            name: "",
            role: index == 1 ? "Protagonist" : "Supporting",
            description: ""
        ))
    }

    func removeWizardCharacter(id: String) {
        wizardCharacters.removeAll { $0.id == id }
    }

    func updateWizardCharacter(_ character: WizardCharacter) {
        if let index = wizardCharacters.firstIndex(where: { $0.id == character.id }) {
            wizardCharacters[index] = character
        }
    }

    func moveToStep(_ step: WizardStep) {
        wizardStep = step
        persistCreationState()
    }

    func updateCreationTopic(_ topic: String) {
        wizardTopic = String(topic.prefix(1600))
        persistCreationState()
    }

    func setCreationFullScreen(_ isPresented: Bool) {
        showFullScreenPrompt = isPresented
    }

    func generateStory() async {
        guard let genre = wizardGenre, let user = currentUser else { return }
        guard user.credits > 0 else {
            showOutOfCreditsModal = true
            return
        }

        isGenerating = true
        generationError = nil
        creationError = nil
        creationPhase = .generating
        creationCoverProgress = 0
        Haptics.medium()

        do {
            let story = try await MockGeneration.generateStory(
                genre: genre,
                topic: wizardTopic,
                characters: wizardCharacters,
                language: wizardLanguage,
                authorId: user.username,
                plannedChapterCount: wizardPlanAsSeries ? wizardSeriesChapterCount : nil,
                readingLevel: wizardReadingLevel
            )
            lastGeneratedStory = story
            publishedStories.removeAll { $0.id == story.id }
            publishedStories.insert(story, at: 0)
            creationPhase = .coverGenerating
            creationCoverProgress = 0.35
            creationDraftSaved = true
            persistCreationState()

            let updated = UserSession(
                id: user.id,
                email: user.email,
                username: user.username,
                displayName: user.displayName,
                bio: user.bio,
                credits: max(0, user.credits - 1),
                followers: user.followers,
                following: user.following,
                avatarPaletteIndex: user.avatarPaletteIndex
            )
            currentUser = updated
            saveSession(updated)
            addCredits(-1, reason: .generation, referenceId: story.id)
            if referredByCode != nil && !creditLedger.contains(where: { $0.reason == .referralBonus }) {
                addCredits(1, reason: .referralBonus, referenceId: referredByCode)
                referredByCode = nil
                persistPrompt12State()
                showToast("Referral bonus added ✨")
            }
            storyGenerationCount += 1
            recordStreakActivity(summary: "Generated a story")
            maybeRequestRating()
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(5))
                guard let self else { return }
                maybeShowPrePermission()
            }
            Haptics.success()
        } catch {
            let failedStoryId = UUID().uuidString
            addCredits(1, reason: .refund, referenceId: failedStoryId)
            generationError = "Something went wrong while crafting your story. Your credit was refunded. Please try again."
            creationError = generationError
            creationPhase = .composer
        }

        isGenerating = false
        if lastGeneratedStory != nil {
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(1100))
                guard let self, lastGeneratedStory != nil else { return }
                creationCoverProgress = 1
                lastGeneratedStory?.coverStatus = .ready
                lastGeneratedStory?.contentVersion = max(1, lastGeneratedStory?.contentVersion ?? 1)
                creationPhase = .draftReady
                creationDraftSaved = true
                persistCreationState()
            }
        }
    }

    func saveCurrentStoryEdits(title: String, body: String) {
        guard var story = lastGeneratedStory else { return }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, !trimmedBody.isEmpty else {
            creationError = "Add a title and at least one paragraph before saving."
            return
        }
        story.title = trimmedTitle
        story.contentVersion += 1
        story.coverStatus = .generating
        story.body = trimmedBody
        lastGeneratedStory = story
        replaceAuthorStory(story)
        creationPhase = .coverGenerating
        creationCoverProgress = 0.35
        creationIsEditingText = false
        creationError = nil
        persistCreationState()
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(900))
            guard let self, lastGeneratedStory?.id == story.id else { return }
            lastGeneratedStory?.coverStatus = .ready
            creationCoverProgress = 1
            creationPhase = story.isPublished ? .published : .draftReady
            if let refreshed = lastGeneratedStory {
                replaceAuthorStory(refreshed)
            }
            persistCreationState()
        }
    }

    func reviseCurrentStory(with prompt: String) async {
        guard let current = lastGeneratedStory,
              let user = currentUser,
              user.credits > 0,
              !isRevising else { return }
        let instruction = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !instruction.isEmpty else {
            creationError = "Tell Katha what you want to change."
            return
        }
        isRevising = true
        creationPhase = .revising
        creationError = nil
        do {
            try await Task.sleep(for: .milliseconds(900))
            guard lastGeneratedStory?.id == current.id else { return }
            var revised = current
            revised.body += "\n\n" + "The next beat follows the author’s direction: \(instruction)."
            revised.contentVersion += 1
            revised.coverStatus = .generating
            lastGeneratedStory = revised
            replaceAuthorStory(revised)
            updateCreditsAfterCreation(user: user, amount: -1, reason: .generation, referenceId: revised.id + "-revision-\(revised.contentVersion)")
            creationPhase = .coverGenerating
            creationCoverProgress = 0.45
            persistCreationState()
            try await Task.sleep(for: .milliseconds(900))
            guard lastGeneratedStory?.id == revised.id else { return }
            lastGeneratedStory?.coverStatus = .ready
            creationCoverProgress = 1
            creationPhase = revised.isPublished ? .published : .draftReady
            persistCreationState()
            Haptics.success()
        } catch {
            creationError = "The revision could not be completed. Your draft is safe; try again."
            creationPhase = .draftReady
        }
        isRevising = false
    }

    func publishCurrentStory() {
        guard var story = lastGeneratedStory, creationPhase == .draftReady else { return }
        guard story.coverStatus == .ready else {
            creationError = "Your cover is still being prepared."
            return
        }
        story.isPublished = true
        lastGeneratedStory = story
        replaceAuthorStory(story)
        creationPhase = .published
        persistCreationState()
        Haptics.success()
        showToast(story.isSeries ? "Chapter 1 published" : "Story published")
    }

    func endSeriesAndPublish() {
        guard var story = lastGeneratedStory, story.isSeries, story.chapterCount >= 2 else {
            creationError = "A series needs at least two chapters before it can end."
            return
        }
        guard story.coverStatus == .ready, story.chapters.allSatisfy({ $0.coverStatus == .ready }) else {
            creationError = "Every chapter needs a ready cover before you can end the series."
            return
        }
        story.isPublished = true
        story.isSeriesEnded = true
        story.chapters = story.chapters.map { chapter in
            var published = chapter
            published.isPublished = true
            published.publishedAt = published.publishedAt ?? Date()
            return published
        }
        lastGeneratedStory = story
        replaceAuthorStory(story)
        creationPhase = .published
        persistCreationState()
        Haptics.success()
        showToast("Series ended and published")
    }

    func startEditingCurrentStory() {
        creationIsEditingText = true
        creationPhase = .editing
        creationError = nil
    }

    func replaceAuthorStory(_ story: GeneratedStory) {
        publishedStories.removeAll { $0.id == story.id }
        publishedStories.insert(story, at: 0)
    }

    private func updateCreditsAfterCreation(user: UserSession, amount: Int, reason: CreditReason, referenceId: String) {
        let updated = UserSession(
            id: user.id, email: user.email, username: user.username, displayName: user.displayName,
            bio: user.bio, credits: max(0, user.credits + amount), followers: user.followers,
            following: user.following, avatarPaletteIndex: user.avatarPaletteIndex
        )
        currentUser = updated
        saveSession(updated)
        addCredits(amount, reason: reason, referenceId: referenceId)
    }

    func openGeneratedStory(_ story: GeneratedStory) {
        selectedStory = story.asStory
        currentChapterIndex = 0
        showReader = true
    }

    func dismissOutOfCreditsModal() {
        showOutOfCreditsModal = false
    }

    func dismissLanguageSheet() {
        showLanguageSheet = false
    }

    func dismissGetIdeasSheet() {
        showGetIdeasSheet = false
    }

    func buyCreditsMock() {
        addCredits(10, reason: .purchase, referenceId: "mock_pack")
        showOutOfCreditsModal = false
        showToast("10 credits added ✨")
    }

    // MARK: - Continue Wizard

    func startContinueWizard(story: Story) {
        guard let user = currentUser, story.authorId == user.username else { return }
        guard credits > 0 else {
            showOutOfCreditsModal = true
            return
        }
        continueWizardStoryId = story.id
        continueWizardStoryTitle = story.title
        continueWizardGenre = story.genre
        continueWizardChapterNumber = story.chapters.count + 1
        continueWizardPlannedChapterCount = story.plannedChapterCount
        continueWizardFollowerCount = storyFollowerCount(storyId: story.id, baseCount: story.followerCount)
        continueWizardDirection = ""
        continueWizardStep = .direction
        showContinueWizard = true
        Haptics.light()
    }

    func resetContinueWizard() {
        showContinueWizard = false
        continueWizardStep = .direction
        continueWizardStoryId = nil
        continueWizardDirection = ""
        continueWizardGenre = nil
        continueWizardChapterNumber = 2
        continueWizardPlannedChapterCount = nil
        continueWizardStoryTitle = ""
        continueWizardFollowerCount = 0
        isGeneratingChapter = false
        chapterGenerationError = nil
        lastGeneratedChapter = nil
        showChapterGetIdeasSheet = false
        showDiscardChapterModal = false
    }

    func moveContinueWizardToStep(_ step: ContinueWizardStep) {
        continueWizardStep = step
    }

    func generateChapter() async {
        guard let storyId = continueWizardStoryId,
              let genre = continueWizardGenre,
              let user = currentUser else { return }
        guard user.credits > 0 else {
            showOutOfCreditsModal = true
            return
        }

        isGeneratingChapter = true
        chapterGenerationError = nil
        Haptics.medium()

        do {
            let chapter = try await MockGeneration.generateChapter(
                parentStoryId: storyId,
                chapterNumber: continueWizardChapterNumber,
                direction: continueWizardDirection,
                language: continueWizardLanguage,
                parentGenre: genre,
                plannedChapterCount: continueWizardPlannedChapterCount
            )
            lastGeneratedChapter = chapter

            if var story = lastGeneratedStory, story.id == storyId {
                story.chapters.append(chapter)
                lastGeneratedStory = story
                replaceAuthorStory(story)
            } else if let index = publishedStories.firstIndex(where: { $0.id == storyId }) {
                publishedStories[index].chapters.append(chapter)
            }
            persistCreationState()

            let updated = UserSession(
                id: user.id, email: user.email, username: user.username,
                displayName: user.displayName, bio: user.bio,
                credits: max(0, user.credits - 1),
                followers: user.followers, following: user.following,
                avatarPaletteIndex: user.avatarPaletteIndex
            )
            currentUser = updated
            saveSession(updated)
            addCredits(-1, reason: .generation, referenceId: chapter.id)
            Haptics.success()
        } catch {
            chapterGenerationError = "Something went wrong while crafting this chapter. Please try again."
        }

        isGeneratingChapter = false
    }

    func openGeneratedChapterPreview() {
        guard let storyId = continueWizardStoryId,
              let chapter = lastGeneratedChapter else { return }
        if let genStory = publishedStories.first(where: { $0.id == storyId }) {
            let story = genStory.asStory
            let chapterIndex = story.chapters.firstIndex(where: { $0.id == chapter.id }) ?? story.chapters.count - 1
            selectedStory = story
            currentChapterIndex = chapterIndex
            showReader = true
        }
        resetContinueWizard()
    }

    // MARK: - Publish Chapter

    func requestPublishChapter(storyId: String, chapterId: String) {
        pendingPublishStoryId = storyId
        pendingPublishChapterId = chapterId
        showPublishModal = true
    }

    func confirmPublishChapter() {
        guard let storyId = pendingPublishStoryId,
              let chapterId = pendingPublishChapterId else { return }

        isPublishing = true
        Haptics.medium()

        if let storyIndex = publishedStories.firstIndex(where: { $0.id == storyId }) {
            if let chapterIndex = publishedStories[storyIndex].chapters.firstIndex(where: { $0.id == chapterId }) {
                publishedStories[storyIndex].chapters[chapterIndex].isPublished = true
                publishedStories[storyIndex].chapters[chapterIndex].publishedAt = Date()
            }
        }

        let followerCount = continueWizardFollowerCount

        if isFollowingStory(storyId), let story = publishedStories.first(where: { $0.id == storyId }) {
            let chapterNum = story.chapters.filter { $0.isPublished }.count
            newChapterNotifications.append(NewChapterNotification(
                id: UUID().uuidString,
                storyId: storyId,
                storyTitle: story.title,
                chapterNumber: chapterNum,
                coverColors: story.coverColors,
                genre: story.genre,
                publishedAt: Date()
            ))
        }

        isPublishing = false
        showPublishModal = false
        pendingPublishStoryId = nil
        pendingPublishChapterId = nil

        Haptics.success()
        recordStreakActivity(summary: "Published a chapter")

        if followerCount > 0 {
            showToast("Chapter published ✨ \(followerCount) followers notified")
        } else {
            showToast("Chapter published ✨")
        }

        if let story = publishedStories.first(where: { $0.id == storyId }) {
            selectedStory = story.asStory
        }
    }

    func cancelPublishModal() {
        showPublishModal = false
        pendingPublishStoryId = nil
        pendingPublishChapterId = nil
    }

    // MARK: - Delete Draft

    func requestDeleteDraft(storyId: String, chapterId: String) {
        pendingDeleteStoryId = storyId
        pendingDeleteChapterId = chapterId
        showDeleteDraftModal = true
        Haptics.medium()
    }

    func confirmDeleteDraft() {
        guard let storyId = pendingDeleteStoryId,
              let chapterId = pendingDeleteChapterId else { return }

        isDeleting = true
        Haptics.medium()

        if let storyIndex = publishedStories.firstIndex(where: { $0.id == storyId }) {
            publishedStories[storyIndex].chapters.removeAll { $0.id == chapterId }
        }

        isDeleting = false
        showDeleteDraftModal = false
        pendingDeleteStoryId = nil
        pendingDeleteChapterId = nil

        showToast("Draft deleted")
        closeReader()
    }

    func cancelDeleteDraftModal() {
        showDeleteDraftModal = false
        pendingDeleteStoryId = nil
        pendingDeleteChapterId = nil
    }

    // MARK: - New Chapter Notifications

    func dismissNewChapterBanner(storyId: String) {
        dismissedBannerStoryIds.insert(storyId)
    }

    func markChapterAsRead(storyId: String, chapterNumber: Int) {
        newChapterNotifications.removeAll { $0.storyId == storyId && $0.chapterNumber == chapterNumber }
    }

    // MARK: - Comments

    /// All comments for a story (seed + user), excluding blocked authors and soft-deleted.
    func commentsFor(storyId: String) -> [StoryComment] {
        let seed = SeedData.seedComments(forStoryId: storyId)
        let user = userComments.filter { $0.storyId == storyId }
        let all = seed + user
        return all.filter { c in
            !deletedCommentIds.contains(c.id) && !isBlocked(c.authorId)
        }
    }

    /// Comment count for a story (for display on cards / reader).
    func commentCount(storyId: String) -> Int {
        commentsFor(storyId: storyId).count
    }

    /// Like count for a comment (seed + override).
    func commentLikeCount(comment: StoryComment) -> Int {
        let delta = likedCommentIds.contains(comment.id) ? 1 : 0
        return comment.likes + (commentLikeOverrides[comment.id] ?? 0) + delta
    }

    func toggleCommentLike(comment: StoryComment) {
        guard isAuthenticated else {
            presentAuthSheet(context: .comment)
            return
        }
        if likedCommentIds.contains(comment.id) {
            likedCommentIds.remove(comment.id)
        } else {
            likedCommentIds.insert(comment.id)
            Haptics.light()
        }
        persistEngagementState()
    }

    func isCommentLiked(_ commentId: String) -> Bool {
        likedCommentIds.contains(commentId)
    }

    /// Posts a comment. First comment per story per day grants 1 credit.
    func postComment(storyId: String, text: String, replyTo: StoryComment? = nil) {
        guard let user = currentUser else {
            presentAuthSheet(context: .comment)
            return
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Determine if this is the first comment today for this story
        let dayKey = storyId + "|" + Self.dayFormatter.string(from: Date())
        let isFirstToday = !commentedTodayKeys.contains(dayKey)

        let comment = StoryComment(
            id: UUID().uuidString,
            storyId: storyId,
            authorId: user.username,
            username: user.username,
            displayName: user.displayName.isEmpty ? user.username : user.displayName,
            text: trimmed,
            likes: 0,
            postedOffsetHours: 0,
            isVerified: false,
            replyToUsername: replyTo?.username
        )
        userComments.append(comment)
        recordStreakActivity(summary: "Left a comment")

        if isFirstToday {
            commentedTodayKeys.insert(dayKey)
            addCredits(1, reason: .feedback, referenceId: storyId)
            Haptics.success()
            showToast("+1 credit for joining the conversation!")
        } else {
            Haptics.light()
        }

        persistEngagementState()
    }

    func deleteComment(_ commentId: String) {
        deletedCommentIds.insert(commentId)
        persistEngagementState()
        showToast("Comment deleted")
    }

    func openCommentsSheet(storyId: String, chapterId: String? = nil) {
        commentsSheetStoryId = storyId
        commentsSheetChapterId = chapterId
        replyToComment = nil
        composerText = ""
        commentsSortNewest = false
        showCommentsSheet = true
        Haptics.light()
    }

    func closeCommentsSheet() {
        showCommentsSheet = false
        commentsSheetStoryId = nil
        commentsSheetChapterId = nil
        replyToComment = nil
        composerText = ""
        highlightedCommentId = nil
    }

    func startReply(to comment: StoryComment) {
        // If replying to a reply, find the original parent so the reply lands under it
        if let parentUsername = comment.replyToUsername {
            // This is a reply to a reply — prefill @username but keep the original parent
            replyToComment = comment
            composerText = "@\(parentUsername) "
        } else {
            replyToComment = comment
            composerText = "@\(comment.username) "
        }
        Haptics.light()
    }

    func cancelReply() {
        replyToComment = nil
        composerText = ""
    }

    func sendComment() {
        guard let storyId = commentsSheetStoryId else { return }
        let text = composerText
        let reply = replyToComment
        postComment(storyId: storyId, text: text, replyTo: reply)
        replyToComment = nil
        composerText = ""
    }

    // MARK: - Blocking

    func isBlocked(_ authorId: String) -> Bool {
        blockedUserIds.contains(authorId)
    }

    func requestBlockUser(authorId: String, displayName: String) {
        pendingBlockAuthorId = authorId
        pendingBlockAuthorName = displayName
        showBlockUserModal = true
    }

    func confirmBlockUser() {
        guard let authorId = pendingBlockAuthorId else { return }
        blockedUserIds.insert(authorId)
        // Also unfollow if following
        if followedAuthorIds.contains(authorId) {
            unfollowAuthor(authorId)
        }
        persistEngagementState()
        showBlockUserModal = false
        Haptics.medium()
        showToast("@\(pendingBlockAuthorName) has been blocked")
        pendingBlockAuthorId = nil
        pendingBlockAuthorName = ""
    }

    func cancelBlockUser() {
        showBlockUserModal = false
        pendingBlockAuthorId = nil
        pendingBlockAuthorName = ""
    }

    func unblockUser(_ authorId: String) {
        blockedUserIds.remove(authorId)
        persistEngagementState()
        Haptics.light()
        showToast("User unblocked")
    }

    // MARK: - Reporting

    func requestReport(target: ReportTarget) {
        pendingReportTarget = target
        showReportSheet = true
        Haptics.light()
    }

    func submitReport(reason: String) {
        if let target = pendingReportTarget {
            switch target {
            case .comment(let id, _):
                reportedCommentIds.insert(id)
            default:
                break
            }
            persistEngagementState()
            showToast("Thanks — our team will review this shortly.")
        }
        showReportSheet = false
        pendingReportTarget = nil
    }

    func cancelReport() {
        showReportSheet = false
        pendingReportTarget = nil
    }

    // MARK: - Share

    func shareStory(story: Story, chapterId: String? = nil) {
        let authorName = SeedData.author(id: story.authorId)?.displayName ?? ""
        let firstLine = story.chapters.first?.paragraphs.first ?? ""
        let preview = String(firstLine.prefix(100))
        let chapter = chapterId ?? story.chapters.first?.id ?? ""
        let text = """
        \(story.title) by \(authorName)

        \(preview)...

        Read on Katha: https://katha.ai/s/\(story.id)/\(chapter)
        """
        storyShareOverrides[story.id] = (storyShareOverrides[story.id] ?? 0) + 1
        persistEngagementState()
        sharePayload = SharePayload(text: text)
        Haptics.light()
    }

    func clearSharePayload() {
        sharePayload = nil
    }

    // MARK: - Chapter Likes

    func toggleChapterLike(chapterId: String) {
        guard isAuthenticated else {
            presentAuthSheet(context: .like)
            return
        }
        if likedChapterIds.contains(chapterId) {
            likedChapterIds.remove(chapterId)
        } else {
            likedChapterIds.insert(chapterId)
            Haptics.light()
        }
        persistEngagementState()
    }

    func isChapterLiked(_ chapterId: String) -> Bool {
        likedChapterIds.contains(chapterId)
    }

    // MARK: - Discover Feed Ranking

    func discoverFeedStories() -> [Story] {
        var stories = SeedData.stories.filter { isStoryVisibleInKidsMode($0) }
        // Filter by genre
        if let genre = discoverGenreFilter {
            stories = stories.filter { $0.genre == genre }
        }
        // Filter by theme
        if let theme = discoverThemeFilter {
            stories = stories.filter { $0.tags.contains(theme) }
        }
        // Filter out blocked authors
        stories = stories.filter { !isBlocked($0.authorId) }

        switch discoverFeedChip {
        case 0: // For You
            if isAuthenticated {
                return forYouRanking(stories)
            } else {
                return trendingRanking(stories)
            }
        case 2: // Rising
            return risingRanking(stories)
        case 3: // New
            return stories.sorted { $0.publishedOffset < $1.publishedOffset }
        default: // Trending
            return trendingRanking(stories)
        }
    }

    private func forYouRanking(_ stories: [Story]) -> [Story] {
        let followedAuthors = followedAuthorIds
        let readGenres = Set(readingProgress.keys.compactMap { id -> Genre? in
            SeedData.stories.first { $0.id == id }?.genre
        })
        let readThemes = Set(readingProgress.keys.flatMap { id -> [String] in
            SeedData.stories.first { $0.id == id }?.tags ?? []
        })

        return stories.enumerated().map { (index, story) in
            let score = trendingScore(story)
            var boost = 0
            if followedAuthors.contains(story.authorId) { boost += 500 }
            if readGenres.contains(story.genre) { boost += 200 }
            let themeMatch = story.tags.filter { readThemes.contains($0) }.count
            boost += themeMatch * 100
            return (story, score + boost, index)
        }.sorted { $0.1 > $1.1 }.map { $0.0 }
    }

    private func trendingRanking(_ stories: [Story]) -> [Story] {
        stories.enumerated().map { (index, story) in
            (story, trendingScore(story), index)
        }.sorted { $0.1 > $1.1 }.map { $0.0 }
    }

    private func risingRanking(_ stories: [Story]) -> [Story] {
        stories.enumerated().map { (index, story) in
            // Rising = high engagement relative to recency
            let recencyBoost = max(0, 10 - story.publishedOffset)
            let engagementRate = Double(story.likes + story.bookmarks) / max(1, Double(story.views)) * 1000
            let score = Int(engagementRate) + recencyBoost * 50
            return (story, score, index)
        }.sorted { $0.1 > $1.1 }.map { $0.0 }
    }

    private func trendingScore(_ story: Story) -> Int {
        let likes = storyLikeCount(storyId: story.id, baseCount: story.likes)
        let bookmarks = story.bookmarks
        let comments = commentCount(storyId: story.id)
        let shares = storyShareCount(storyId: story.id, baseCount: 0)
        let timeDecay = max(1, 10 - story.publishedOffset)
        return (likes + bookmarks * 2 + comments * 3 + shares * 5) * timeDecay / 10
    }

    func isRisingStory(_ story: Story) -> Bool {
        let recencyBoost = max(0, 10 - story.publishedOffset)
        let engagementRate = Double(story.likes + story.bookmarks) / max(1, Double(story.views)) * 1000
        let score = Int(engagementRate) + recencyBoost * 50
        return score > 50 && story.publishedOffset <= 5
    }

    func isNewStory(_ story: Story) -> Bool {
        story.publishedOffset <= 3
    }

    // MARK: - Theme Filter

    func applyThemeFilter(_ theme: String) {
        discoverThemeFilter = theme
        discoverFeedChip = 1 // Trending
        discoverGenreFilter = nil
        requestedTab = 1
        Haptics.light()
    }

    func clearThemeFilter() {
        discoverThemeFilter = nil
        Haptics.light()
    }

    // MARK: - Profile Comments

    /// Comments authored by a given user (for profile Comments tab)
    func commentsByUser(authorId: String) -> [StoryComment] {
        (SeedData.seedComments + userComments)
            .filter { $0.authorId == authorId }
            .sorted { $0.postedOffsetHours < $1.postedOffsetHours }
    }

    // MARK: - Audio (FIX 8)

    func audioState(for storyId: String) -> AudioBarState {
        if audioErrorStoryId == storyId { return .error }
        if audioReadyStoryIds.contains(storyId) { return .ready }
        if audioPreparingStoryId == storyId { return .preparing }
        // Seed stories are always ready
        if SeedData.stories.contains(where: { $0.id == storyId }) { return .ready }
        // User-generated stories that haven't been prepared yet
        return .preparing
    }

    func startAudioPreparation(storyId: String) {
        guard !audioReadyStoryIds.contains(storyId) else { return }
        guard audioPreparingStoryId != storyId else { return }

        audioPreparingStoryId = storyId
        audioErrorStoryId = nil

        audioPrepTask?.cancel()
        audioPrepTask = Task { [weak self] in
            guard let self else { return }
            let delay = Double.random(in: 8...15)
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            guard self.audioPreparingStoryId == storyId else { return }

            // 3% failure rate
            if Int.random(in: 1...100) <= 3 {
                self.audioErrorStoryId = storyId
                self.audioPreparingStoryId = nil
            } else {
                self.audioReadyStoryIds.insert(storyId)
                self.audioPreparingStoryId = nil
                self.persistAudioState()
                Haptics.light()
            }
        }
    }

    func retryAudio(storyId: String) {
        audioErrorStoryId = nil
        startAudioPreparation(storyId: storyId)
    }

    private func persistAudioState() {
        defaults.set(Array(audioReadyStoryIds), forKey: "katha.audioReady")
    }

    // MARK: - Credit Ledger (Prompt 8+9)

    /// Adds a credit ledger entry and updates the user's balance.
    func addCredits(_ amount: Int, reason: CreditReason, referenceId: String? = nil) {
        guard let user = currentUser else { return }
        let newBalance = max(0, user.credits + amount)
        let entry = CreditLedgerEntry(
            id: UUID().uuidString,
            amount: amount,
            reason: reason,
            referenceId: referenceId,
            timestamp: Date(),
            balanceAfter: newBalance
        )
        creditLedger.append(entry)
        let updated = UserSession(
            id: user.id, email: user.email, username: user.username,
            displayName: user.displayName, bio: user.bio,
            credits: newBalance,
            followers: user.followers, following: user.following,
            avatarPaletteIndex: user.avatarPaletteIndex
        )
        currentUser = updated
        saveSession(updated)
        persistCreditLedger()
    }

    /// Spend a credit (for story generation / chapter continuation)
    func spendCredit(reason: CreditReason, referenceId: String? = nil) {
        addCredits(-1, reason: reason, referenceId: referenceId)
    }

    /// Ensure the welcome bonus ledger entry exists for new users
    func ensureWelcomeBonus() {
        if creditLedger.isEmpty, currentUser != nil {
            addCredits(3, reason: .welcomeBonus)
        }
    }

    /// Recent ledger entries (last 8) for the Credits screen
    var recentLedgerEntries: [CreditLedgerEntry] {
        Array(creditLedger.suffix(8).reversed())
    }

    /// Full ledger (reversed for display)
    var fullLedgerEntries: [CreditLedgerEntry] {
        creditLedger.reversed()
    }

    // MARK: - Credits Screen Navigation

    func openCreditsScreen() {
        creditsStack.append(CreditsRoute(kind: .credits))
        Haptics.light()
    }

    func openSubscriptionPaywall() {
        showSubscriptionPaywall = true
        Haptics.medium()
    }

    func closeSubscriptionPaywall() {
        showSubscriptionPaywall = false
    }

    func openCreditPackSheet(packId: String? = nil) {
        creditPackSheetPreselectedId = packId
        showCreditPackSheet = true
        Haptics.light()
    }

    func closeCreditPackSheet() {
        showCreditPackSheet = false
        creditPackSheetPreselectedId = nil
    }

    func openSubscriptionManagement() {
        showSubscriptionManagement = true
        Haptics.light()
    }

    func closeSubscriptionManagement() {
        showSubscriptionManagement = false
    }

    func openCreditHistory() {
        showCreditHistory = true
        Haptics.light()
    }

    func closeCreditHistory() {
        showCreditHistory = false
    }

    func popCreditsStack() {
        if !creditsStack.isEmpty {
            creditsStack.removeLast()
        }
    }

    // MARK: - Subscription Purchase

    func purchaseSubscription(_ plan: SubscriptionPlan) async {
        isPurchasingSubscription = true
        Haptics.medium()

        let result = await PaymentService.shared.purchaseSubscription(plan)

        isPurchasingSubscription = false

        switch result {
        case .success:
            isPremium = true
            subscriptionType = plan
            subscriptionExpiresAt = Calendar.current.date(byAdding: .month, value: plan == .yearly ? 12 : 1, to: Date())
            addCredits(plan.creditsPerCycle, reason: .subscription, referenceId: plan.productId)
            Haptics.success()
            closeSubscriptionPaywall()
            showToast("Welcome to Katha Premium ✨", isWelcome: true)
        case .failure(let message):
            showToast(message)
        case .cancelled:
            break
        }
    }

    // MARK: - Credit Pack Purchase

    func purchaseCreditPack(_ pack: CreditPack) async {
        isPurchasingPack = true
        Haptics.medium()

        let result = await PaymentService.shared.purchaseCreditPack(pack)

        isPurchasingPack = false

        switch result {
        case .success:
            addCredits(pack.credits, reason: .purchase, referenceId: pack.productId)
            Haptics.success()
            closeCreditPackSheet()
            showToast("\(pack.credits) credits added ✨")
        case .failure(let message):
            showToast(message)
        case .cancelled:
            break
        }
    }

    // MARK: - Restore Purchases

    func restorePurchases() async {
        isRestoringPurchases = true

        let result = await PaymentService.shared.restorePurchases()

        isRestoringPurchases = false

        switch result {
        case .restored(let plan):
            if let plan {
                isPremium = true
                subscriptionType = plan
                if subscriptionExpiresAt == nil {
                    subscriptionExpiresAt = Calendar.current.date(byAdding: .month, value: plan == .yearly ? 12 : 1, to: Date())
                }
                persistCreditLedger()
            }
            showToast("Purchases restored ✨")
        case .noPurchases:
            showToast("No previous purchases found on this account.")
        case .failure(let message):
            showToast(message)
        }
    }

    // MARK: - Cancel Subscription (Mock)

    func cancelSubscription() {
        subscriptionExpiresAt = Calendar.current.date(byAdding: .day, value: 1, to: Date())
        persistCreditLedger()
        showToast("Subscription cancelled. Premium active until renewal date.")
    }

    // MARK: - Ad Reward

    /// Computes whether the user can watch an ad (24hr cooldown)
    var canWatchAd: Bool {
        guard let last = lastAdCreditTimestamp else { return true }
        return Date().timeIntervalSince(last) >= AdConfig.cooldownSeconds
    }

    /// Seconds remaining in cooldown
    var adCooldownRemaining: Int {
        guard let last = lastAdCreditTimestamp else { return 0 }
        let elapsed = Date().timeIntervalSince(last)
        let remaining = AdConfig.cooldownSeconds - elapsed
        return max(0, Int(remaining))
    }

    /// Formats cooldown as "XXh XXm" or "XXm"
    var adCooldownLabel: String {
        let secs = adCooldownRemaining
        if secs <= 0 { return "" }
        let hours = secs / 3600
        let mins = (secs % 3600) / 60
        if hours > 0 {
            return "Next in \(hours)h \(mins)m"
        } else {
            return "Next in \(mins)m"
        }
    }

    /// Triggered when user taps "Watch" on the Credits screen
    func startAdWatch() async {
        guard canWatchAd else { return }
        adWatchState = .loadingAd
        Haptics.light()

        let result = await AdService.shared.loadRewardedAd()

        switch result {
        case .success:
            if AdConfig.mockAds {
                showMockAdScreen = true
                adWatchState = .playingAd
            } else {
                // TODO: Real AdMob integration — show GADRewardedAd
                adWatchState = .playingAd
                showMockAdScreen = true
            }
        case .failure:
            adWatchState = .error
            showToast("Ad unavailable. Try again in a moment.")
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(2))
                guard let self else { return }
                if self.adWatchState == .error {
                    self.adWatchState = .available
                }
            }
        }
    }

    /// Called when the mock ad screen completes (15s elapsed)
    func completeAdWatch() async {
        showMockAdScreen = false

        let result = await AdService.shared.verifyReward()

        switch result {
        case .granted:
            addCredits(1, reason: .adReward)
            lastAdCreditTimestamp = Date()
            persistCreditLedger()
            Haptics.success()
            adWatchState = .justRewarded
            showAdRewardToast = true
            adRewardBalance = credits
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(3))
                guard let self else { return }
                self.showAdRewardToast = false
                self.adWatchState = .onCooldown(remainingSeconds: Int(AdConfig.cooldownSeconds))
            }
        case .ssvPending:
            showToast("Waiting for reward verification…")
        case .ssvTimeout:
            showToast("Couldn't verify ad reward. Contact support if credits are missing.")
            adWatchState = .available
        case .interrupted:
            showToast("Ad was interrupted. Try again later.")
            adWatchState = .available
        }
    }

    /// Called when user backgrounds the app during an ad
    func interruptAdWatch() {
        if adWatchState == .playingAd {
            showMockAdScreen = false
            adWatchState = .available
            showToast("Ad was interrupted. Try again later.")
        }
    }

    // MARK: - Referral Share

    func shareReferralLink() {
        let text = "I've been writing stories on Katha AI. Join me and get an extra credit to start:\n\n\(referralLink)"
        sharePayload = SharePayload(text: text)
        Haptics.light()
    }

    // MARK: - Day Formatter

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    // MARK: - Analytics Navigation (Prompt 10)

    func openStoryAnalytics(story: Story) {
        analyticsStory = story
        showStoryAnalytics = true
        Haptics.light()
    }

    func closeAnalytics() {
        showStoryAnalytics = false
        analyticsStory = nil
    }

    func openDashboard() {
        showDashboard = true
        Haptics.light()
    }

    func closeDashboard() {
        showDashboard = false
    }

    func showReaderEarningToast(credits: Int, storyTitle: String, storyId: String) {
        readerEarningCredits = credits
        readerEarningStoryTitle = storyTitle
        readerEarningStoryId = storyId
        showReaderEarningToast = true
        Haptics.success()
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard let self else { return }
            self.showReaderEarningToast = false
        }
    }

    // MARK: - Dev Tools (Prompt 10)

    func registerDevTap() {
        devTapCount += 1
        if devTapCount >= 5 {
            devTapCount = 0
            Haptics.light()
            showDevTools = true
        }
    }

    func closeDevTools() {
        showDevTools = false
    }

    // MARK: - Analytics Seed

    func ensureAnalyticsSeeded() {
        AnalyticsService.shared.ensureSeeded(stories: SeedData.stories)
    }
}

// MARK: - Wizard Step

enum WizardStep: Int, CaseIterable {
    case genre = 1
    case topic = 2
    case characters = 3
    case review = 4

    var title: String {
        switch self {
        case .genre: "Genre"
        case .topic: "Topic"
        case .characters: "Characters"
        case .review: "Review"
        }
    }

    var number: Int { rawValue }
}

package com.rork.kathaai.viewmodel

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rork.kathaai.data.GenerationException
import com.rork.kathaai.data.MockGeneration
import com.rork.kathaai.data.AnalyticsService
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.data.UsernameGenerator
import com.rork.kathaai.model.AppUiLanguage
import com.rork.kathaai.model.AuthSheetContext
import com.rork.kathaai.model.ContentRating
import com.rork.kathaai.model.ContinueWizardStep
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.GeneratedChapter
import com.rork.kathaai.model.GeneratedStory
import com.rork.kathaai.model.Author
import com.rork.kathaai.model.NewChapterNotification
import com.rork.kathaai.model.ProfileRoute
import com.rork.kathaai.model.ReportTarget
import com.rork.kathaai.model.SharePayload
import com.rork.kathaai.model.Story
import com.rork.kathaai.model.StoryComment
import com.rork.kathaai.model.StoryLanguage
import com.rork.kathaai.model.UserSession
import com.rork.kathaai.model.WizardCharacter
import com.rork.kathaai.model.WizardStep
import com.rork.kathaai.model.CreditLedgerEntry
import com.rork.kathaai.model.CreditReason
import com.rork.kathaai.model.CreditPack
import com.rork.kathaai.model.SubscriptionPlan
import com.rork.kathaai.model.PremiumFeature
import com.rork.kathaai.model.ReadingLevel
import com.rork.kathaai.model.PinSetupMode
import com.rork.kathaai.model.PinEntryContext
import com.rork.kathaai.model.AdWatchState
import com.rork.kathaai.model.AdConfig
import com.rork.kathaai.model.PaymentConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.util.UUID

/** Where the auth sheet was opened from — a reader wall cannot be dismissed by tapping outside. */
enum class AuthSheetOrigin { NONE, READER_WALL, GENERAL }

data class KathaUiState(
    val currentUser: UserSession? = null,
    val isAuthenticating: Boolean = false,
    val authError: String? = null,
    val showAuthSheet: Boolean = false,
    val authSheetOrigin: AuthSheetOrigin = AuthSheetOrigin.NONE,
    val pendingStoryId: String? = null,
    val showProfileSetup: Boolean = false,
    val generatedUsername: String = "",
    val followedAuthorIds: Set<String> = emptySet(),
    val likedStoryIds: Set<String> = emptySet(),
    val bookmarkedStoryIds: Set<String> = emptySet(),
    val readStoryIds: Set<String> = emptySet(),
    val readerSepia: Boolean = false,
    val appLanguage: AppUiLanguage = AppUiLanguage.ENGLISH,
    val defaultReadingLevel: ReadingLevel = ReadingLevel.STANDARD,
    val wizardReadingLevel: ReadingLevel = ReadingLevel.STANDARD,
    val kidsMode: Boolean = false,
    val kidsModePin: String? = null,
    val pinCooldownUntil: Long? = null,
    val kidsReadingLevelCap: ReadingLevel = ReadingLevel.STANDARD,
    val kidsCommentsEnabled: Boolean = false,
    val kidsShareEnabled: Boolean = false,
    val kidsSearchSuggestionsEnabled: Boolean = true,
    val ageVerified: Boolean = false,
    val showUiLanguageSheet: Boolean = false,
    val showReadingLevelSheet: Boolean = false,
    val readingLevelSheetForWizard: Boolean = false,
    val readingLevelSheetForCap: Boolean = false,
    val showParentalControls: Boolean = false,
    val showPinSetup: Boolean = false,
    val pinSetupMode: PinSetupMode = PinSetupMode.ENABLE_KIDS_MODE,
    val showPinEntry: Boolean = false,
    val pinEntryContext: PinEntryContext = PinEntryContext.DISABLE_KIDS_MODE,
    val showAgeVerification: Boolean = false,
    val toastMessage: String? = null,
    val toastIsWelcome: Boolean = false,
    val onboardingCompleted: Boolean = false,
    val reopenStoryId: String? = null,
    val reopenStoryChapterIndex: Int = 0,
    // Wizard state (in-session only)
    val wizardStep: WizardStep = WizardStep.GENRE,
    val wizardGenre: Genre? = null,
    val wizardTopic: String = "",
    val wizardCharacters: List<WizardCharacter> = emptyList(),
    val wizardLanguage: StoryLanguage = StoryLanguage.ENGLISH,
    val wizardPlanAsSeries: Boolean = false,
    val wizardSeriesChapterCount: Int = 3,
    val isGenerating: Boolean = false,
    val generationError: String? = null,
    val lastGeneratedStory: GeneratedStory? = null,
    val showOutOfCreditsModal: Boolean = false,
    val showLanguageSheet: Boolean = false,
    val showGetIdeasSheet: Boolean = false,
    // User-generated stories
    val publishedStories: List<GeneratedStory> = emptyList(),
    // Follow story (persisted)
    val followedStoryIds: Set<String> = emptySet(),
    val storyFollowerOverrides: Map<String, Int> = emptyMap(),
    // New chapter notifications
    val newChapterNotifications: List<NewChapterNotification> = emptyList(),
    val dismissedBannerStoryIds: Set<String> = emptySet(),
    // Reader chapter navigation
    val currentChapterIndex: Int = 0,
    val showChapterListSheet: Boolean = false,
    // Continue wizard state (in-session only)
    val showContinueWizard: Boolean = false,
    val continueWizardStep: ContinueWizardStep = ContinueWizardStep.DIRECTION,
    val continueWizardStoryId: String? = null,
    val continueWizardDirection: String = "",
    val continueWizardChapterNumber: Int = 2,
    val continueWizardGenre: Genre? = null,
    val continueWizardLanguage: StoryLanguage = StoryLanguage.ENGLISH,
    val continueWizardPlannedChapterCount: Int? = null,
    val continueWizardStoryTitle: String = "",
    val continueWizardFollowerCount: Int = 0,
    val isGeneratingChapter: Boolean = false,
    val chapterGenerationError: String? = null,
    val lastGeneratedChapter: GeneratedChapter? = null,
    val showChapterGetIdeasSheet: Boolean = false,
    val showDiscardChapterModal: Boolean = false,
    // Publish / Delete modals
    val showPublishModal: Boolean = false,
    val showDeleteDraftModal: Boolean = false,
    val isPublishing: Boolean = false,
    val isDeleting: Boolean = false,
    val pendingPublishStoryId: String? = null,
    val pendingPublishChapterId: String? = null,
    val pendingDeleteStoryId: String? = null,
    val pendingDeleteChapterId: String? = null,
    // Unfollow confirmation
    val showUnfollowStoryModal: Boolean = false,
    val pendingUnfollowStoryId: String? = null,
    val pendingUnfollowStoryTitle: String = "",
    val hasConfirmedUnfollowThisSession: Boolean = false,
    // Profile navigation (overlay stack)
    val profileStack: List<ProfileRoute> = emptyList(),
    // Follow author (optimistic follower count overrides)
    val authorFollowerOverrides: Map<String, Int> = emptyMap(),
    val showUnfollowAuthorModal: Boolean = false,
    val pendingUnfollowAuthorId: String? = null,
    val pendingUnfollowAuthorName: String = "",
    val hasConfirmedAuthorUnfollowThisSession: Boolean = false,
    // Edit profile
    val isSavingProfile: Boolean = false,
    val lastUsernameChange: Long? = null,
    // Tab navigation requests from overlays (0=Home,1=Discover,2=Create,3=Library,4=Settings)
    val requestedTab: Int? = null,
    // Engagement store (Prompt 6)
    val userComments: List<StoryComment> = emptyList(),
    val likedCommentIds: Set<String> = emptySet(),
    val deletedCommentIds: Set<String> = emptySet(),
    val reportedCommentIds: Set<String> = emptySet(),
    val blockedUserIds: Set<String> = emptySet(),
    val storyLikeOverrides: Map<String, Int> = emptyMap(),
    val storyShareOverrides: Map<String, Int> = emptyMap(),
    val likedChapterIds: Set<String> = emptySet(),
    val commentedTodayKeys: Set<String> = emptySet(),
    // Comments sheet state
    val showCommentsSheet: Boolean = false,
    val commentsSheetStoryId: String? = null,
    val commentsSortNewest: Boolean = false,
    val replyToComment: StoryComment? = null,
    val composerText: String = "",
    val highlightedCommentId: String? = null,
    // Report sheet
    val showReportSheet: Boolean = false,
    val pendingReportTarget: ReportTarget? = null,
    // Block modal
    val showBlockUserModal: Boolean = false,
    val pendingBlockAuthorId: String? = null,
    val pendingBlockAuthorName: String = "",
    // Share
    val sharePayload: SharePayload? = null,
    // Auth sheet context
    val authSheetContext: AuthSheetContext = AuthSheetContext.GENERIC,
    // Discover feed ranking
    val discoverFeedChip: Int = 1,
    val discoverThemeFilter: String? = null,
    val discoverGenreFilter: Genre? = null,
    // Audio mini-bar state (FIX 8)
    val audioReadyStoryIds: Set<String> = emptySet(),
    val audioPreparingStoryId: String? = null,
    val audioErrorStoryId: String? = null,
    // Credit ledger (Prompt 8+9)
    val creditLedger: List<CreditLedgerEntry> = emptyList(),
    val isPremium: Boolean = false,
    val subscriptionType: String? = null,
    val subscriptionExpiresAt: Long? = null,
    val lastAdCreditTimestamp: Long? = null,
    val showCreditsScreen: Boolean = false,
    val showSubscriptionPaywall: Boolean = false,
    val showCreditPackSheet: Boolean = false,
    val showSubscriptionManagement: Boolean = false,
    val showCreditHistory: Boolean = false,
    val creditPackSheetPreselectedId: String? = null,
    val showMockAdScreen: Boolean = false,
    val adWatchState: AdWatchState = AdWatchState.AVAILABLE,
    val isPurchasingSubscription: Boolean = false,
    val isPurchasingPack: Boolean = false,
    val isRestoringPurchases: Boolean = false,
    val showAdRewardToast: Boolean = false,
    // Analytics (Prompt 10)
    val showStoryAnalytics: Boolean = false,
    val analyticsStoryId: String? = null,
    val showDashboard: Boolean = false,
    val showReaderEarningToast: Boolean = false,
    val readerEarningCredits: Int = 0,
    val readerEarningStoryTitle: String = "",
    val readerEarningStoryId: String = "",
    val showDevTools: Boolean = false,
    val devTapCount: Int = 0
) {
    val isPinCooldownActive: Boolean
        get() = (pinCooldownUntil ?: 0L) > System.currentTimeMillis()

    fun isStoryVisibleInKidsMode(story: Story): Boolean = !kidsMode || story.effectiveContentRating != ContentRating.MATURE
    val isAuthenticated: Boolean get() = currentUser != null

    val hasUnreadNewChapters: Boolean
        get() = newChapterNotifications.isNotEmpty() &&
                newChapterNotifications.any { it.storyId !in dismissedBannerStoryIds }

    val unreadNewChapterNotifications: List<NewChapterNotification>
        get() = newChapterNotifications.filter { it.storyId !in dismissedBannerStoryIds }

    /** Mock streak for the current user (real streaks arrive in a later update). */
    val currentStreak: Int get() = if (isAuthenticated) 5 else 0

    /** If the username was changed within the last 30 days, epoch millis it unlocks; null otherwise. */
    val usernameChangeUnlockDate: Long?
        get() {
            val last = lastUsernameChange ?: return null
            val unlock = last + 30L * 24 * 3600 * 1000
            return if (unlock > System.currentTimeMillis()) unlock else null
        }

    fun authorFollowerCount(authorId: String, baseCount: Int): Int =
        authorFollowerOverrides[authorId] ?: baseCount

    fun storyLikeCount(storyId: String, baseCount: Int): Int =
        maxOf(0, baseCount + (storyLikeOverrides[storyId] ?: 0))

    fun storyShareCount(storyId: String, baseCount: Int): Int =
        baseCount + (storyShareOverrides[storyId] ?: 0)

    fun isBlocked(authorId: String): Boolean = authorId in blockedUserIds

    fun commentCount(storyId: String): Int = commentsFor(storyId).size

    fun commentsFor(storyId: String): List<StoryComment> {
        val seed = SeedData.seedComments(storyId)
        val user = userComments.filter { it.storyId == storyId }
        return (seed + user).filter { c ->
            c.id !in deletedCommentIds && c.authorId !in blockedUserIds
        }
    }

    fun commentLikeCount(comment: StoryComment): Int =
        comment.likes + if (comment.id in likedCommentIds) 1 else 0

    fun commentsByUser(authorId: String): List<StoryComment> =
        (SeedData.seedComments + userComments)
            .filter { it.authorId == authorId }
            .sortedBy { it.postedOffsetHours }

    fun isRisingStory(story: Story): Boolean {
        val recencyBoost = maxOf(0, 10 - story.publishedOffset)
        val engagementRate = (story.likes + story.bookmarks).toDouble() / maxOf(1, story.views) * 1000
        val score = engagementRate.toInt() + recencyBoost * 50
        return score > 50 && story.publishedOffset <= 5
    }

    fun isNewStory(story: Story): Boolean = story.publishedOffset <= 3

    fun discoverFeedStories(): List<Story> {
        var stories = SeedData.stories.filter { !isBlocked(it.authorId) && isStoryVisibleInKidsMode(it) }
        discoverGenreFilter?.let { genre -> stories = stories.filter { it.genre == genre } }
        discoverThemeFilter?.let { theme -> stories = stories.filter { it.tags.contains(theme) } }
        return when (discoverFeedChip) {
            0 -> if (isAuthenticated) forYouRanking(stories) else trendingRanking(stories)
            2 -> risingRanking(stories)
            3 -> stories.sortedBy { it.publishedOffset }
            else -> trendingRanking(stories)
        }
    }

    private fun forYouRanking(stories: List<Story>): List<Story> {
        val followed = followedAuthorIds
        return stories.mapIndexed { index, story ->
            Triple(story, trendingScore(story) +
                (if (story.authorId in followed) 500 else 0), index)
        }.sortedByDescending { it.second }.map { it.first }
    }

    private fun trendingRanking(stories: List<Story>): List<Story> =
        stories.mapIndexed { index, story -> Triple(story, trendingScore(story), index) }
            .sortedByDescending { it.second }.map { it.first }

    private fun risingRanking(stories: List<Story>): List<Story> {
        return stories.mapIndexed { index, story ->
            val recencyBoost = maxOf(0, 10 - story.publishedOffset)
            val engagementRate = (story.likes + story.bookmarks).toDouble() / maxOf(1, story.views) * 1000
            Triple(story, engagementRate.toInt() + recencyBoost * 50, index)
        }.sortedByDescending { it.second }.map { it.first }
    }

    private fun trendingScore(story: Story): Int {
        val likes = storyLikeCount(story.id, story.likes)
        val comments = commentCount(story.id)
        val shares = storyShareCount(story.id, 0)
        val timeDecay = maxOf(1, 10 - story.publishedOffset)
        return (likes + story.bookmarks * 2 + comments * 3 + shares * 5) * timeDecay / 10
    }

    /** Writers-to-follow suggestions: not followed, not self, sorted by follower count, top 8. */
    val suggestedAuthors: List<Author>
        get() = SeedData.authors
            .filter { it.id !in followedAuthorIds && it.username != currentUser?.username }
            .sortedByDescending { authorFollowerCount(it.id, it.followers) }
            .take(8)
}

class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val prefs = application.getSharedPreferences("katha", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    private val _uiState = MutableStateFlow(KathaUiState())
    val uiState: StateFlow<KathaUiState> = _uiState.asStateFlow()

    init {
        loadPersistedState()
    }

    // MARK: - Persistence

    private fun loadPersistedState() {
        val storedSession = prefs.getString(KEY_SESSION, null)?.let { raw ->
            runCatching { json.decodeFromString<UserSession>(raw) }.getOrNull()
        }
        _uiState.update {
            it.copy(
                currentUser = storedSession,
                followedAuthorIds = prefs.getStringSet(KEY_FOLLOWED_AUTHORS, emptySet()).orEmpty(),
                likedStoryIds = prefs.getStringSet(KEY_LIKED, emptySet()).orEmpty(),
                bookmarkedStoryIds = prefs.getStringSet(KEY_BOOKMARKED, emptySet()).orEmpty(),
                readStoryIds = prefs.getStringSet(KEY_READ, emptySet()).orEmpty(),
                followedStoryIds = prefs.getStringSet(KEY_FOLLOWED_STORIES, emptySet()).orEmpty(),
                readerSepia = prefs.getBoolean(KEY_SEPIA, false),
                appLanguage = runCatching { com.rork.kathaai.model.AppUiLanguage.valueOf(prefs.getString(KEY_APP_LANGUAGE, "ENGLISH") ?: "ENGLISH") }.getOrDefault(com.rork.kathaai.model.AppUiLanguage.ENGLISH),
                defaultReadingLevel = runCatching { ReadingLevel.valueOf(prefs.getString(KEY_READING_LEVEL, "STANDARD") ?: "STANDARD") }.getOrDefault(ReadingLevel.STANDARD),
                wizardReadingLevel = runCatching { ReadingLevel.valueOf(prefs.getString(KEY_READING_LEVEL, "STANDARD") ?: "STANDARD") }.getOrDefault(ReadingLevel.STANDARD),
                kidsMode = prefs.getBoolean(KEY_KIDS_MODE, false),
                kidsModePin = prefs.getString(KEY_KIDS_PIN, null),
                pinCooldownUntil = prefs.getLong(KEY_PIN_COOLDOWN, 0L).takeIf { it > 0L },
                kidsReadingLevelCap = runCatching { ReadingLevel.valueOf(prefs.getString(KEY_KIDS_CAP, "STANDARD") ?: "STANDARD") }.getOrDefault(ReadingLevel.STANDARD),
                kidsCommentsEnabled = prefs.getBoolean(KEY_KIDS_COMMENTS, false),
                kidsShareEnabled = prefs.getBoolean(KEY_KIDS_SHARE, false),
                kidsSearchSuggestionsEnabled = prefs.getBoolean(KEY_KIDS_SEARCH, true),
                ageVerified = prefs.getBoolean(KEY_AGE_VERIFIED, false),
                onboardingCompleted = prefs.getBoolean(KEY_ONBOARDED, false),
                lastUsernameChange = prefs.getLong(KEY_LAST_USERNAME_CHANGE, 0L).takeIf { ts -> ts > 0L },
                likedCommentIds = prefs.getStringSet(KEY_LIKED_COMMENTS, emptySet()).orEmpty(),
                deletedCommentIds = prefs.getStringSet(KEY_DELETED_COMMENTS, emptySet()).orEmpty(),
                reportedCommentIds = prefs.getStringSet(KEY_REPORTED_COMMENTS, emptySet()).orEmpty(),
                blockedUserIds = prefs.getStringSet(KEY_BLOCKED_USERS, emptySet()).orEmpty(),
                likedChapterIds = prefs.getStringSet(KEY_LIKED_CHAPTERS, emptySet()).orEmpty(),
                audioReadyStoryIds = prefs.getStringSet(KEY_AUDIO_READY, emptySet()).orEmpty(),
                isPremium = prefs.getBoolean(KEY_IS_PREMIUM, false),
                subscriptionType = prefs.getString(KEY_SUB_TYPE, null),
                subscriptionExpiresAt = prefs.getLong(KEY_SUB_EXPIRES, 0L).takeIf { it > 0L },
                lastAdCreditTimestamp = prefs.getLong(KEY_LAST_AD_CREDIT, 0L).takeIf { it > 0L },
                creditLedger = loadCreditLedger()
            )
        }
    }

    private fun persistSafety() {
        val state = _uiState.value
        prefs.edit().apply {
            putString(KEY_APP_LANGUAGE, state.appLanguage.name)
            putString(KEY_READING_LEVEL, state.defaultReadingLevel.name)
            putBoolean(KEY_KIDS_MODE, state.kidsMode)
            if (state.kidsModePin == null) remove(KEY_KIDS_PIN) else putString(KEY_KIDS_PIN, state.kidsModePin)
            if (state.pinCooldownUntil == null) remove(KEY_PIN_COOLDOWN) else putLong(KEY_PIN_COOLDOWN, state.pinCooldownUntil)
            putString(KEY_KIDS_CAP, state.kidsReadingLevelCap.name)
            putBoolean(KEY_KIDS_COMMENTS, state.kidsCommentsEnabled)
            putBoolean(KEY_KIDS_SHARE, state.kidsShareEnabled)
            putBoolean(KEY_KIDS_SEARCH, state.kidsSearchSuggestionsEnabled)
            putBoolean(KEY_AGE_VERIFIED, state.ageVerified)
        }.apply()
    }

    private fun persistSocial() {
        val state = _uiState.value
        prefs.edit()
            .putStringSet(KEY_FOLLOWED_AUTHORS, state.followedAuthorIds)
            .putStringSet(KEY_LIKED, state.likedStoryIds)
            .putStringSet(KEY_BOOKMARKED, state.bookmarkedStoryIds)
            .putStringSet(KEY_READ, state.readStoryIds)
            .putStringSet(KEY_FOLLOWED_STORIES, state.followedStoryIds)
            .apply()
    }

    private fun persistEngagement() {
        val state = _uiState.value
        prefs.edit()
            .putStringSet(KEY_LIKED_COMMENTS, state.likedCommentIds)
            .putStringSet(KEY_DELETED_COMMENTS, state.deletedCommentIds)
            .putStringSet(KEY_REPORTED_COMMENTS, state.reportedCommentIds)
            .putStringSet(KEY_BLOCKED_USERS, state.blockedUserIds)
            .putStringSet(KEY_LIKED_CHAPTERS, state.likedChapterIds)
            .apply()
    }

    private fun persistSession(session: UserSession?) {
        prefs.edit().apply {
            if (session == null) remove(KEY_SESSION)
            else putString(KEY_SESSION, json.encodeToString(session))
        }.apply()
    }

    // MARK: - Onboarding

    fun completeOnboarding() {
        prefs.edit().putBoolean(KEY_ONBOARDED, true).apply()
        _uiState.update { it.copy(onboardingCompleted = true) }
    }

    // MARK: - Auth (mock mode: simulated 800ms round trip)

    fun signInWithEmail(email: String) {
        if (!email.contains("@") || !email.contains(".")) {
            _uiState.update { it.copy(authError = "Please enter a valid email address.") }
            return
        }
        performMockAuth(email)
    }

    fun signInWithGoogle() = performMockAuth("you@gmail.com")

    fun signInWithApple() = performMockAuth("you@privaterelay.appleid.com")

    private fun performMockAuth(email: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isAuthenticating = true, authError = null) }
            delay(800)

            val storedRaw = prefs.getString(KEY_SESSION, null)
            val returning = storedRaw
                ?.let { runCatching { json.decodeFromString<UserSession>(it) }.getOrNull() }
                ?.takeIf { it.email == email && it.displayName.isNotEmpty() }

            if (returning != null) {
                _uiState.update {
                    it.copy(
                        isAuthenticating = false,
                        currentUser = returning,
                        showAuthSheet = false,
                        authSheetOrigin = AuthSheetOrigin.NONE
                    )
                }
                finishAuth(needsProfileSetup = false)
                return@launch
            }

            val username = UsernameGenerator.generate()
            val session = UserSession(
                id = UUID.randomUUID().toString(),
                email = email,
                username = username,
                displayName = "",
                bio = "",
                credits = 3,
                followers = 0,
                following = 4
            )
            persistSession(session)
            _uiState.update {
                it.copy(
                    isAuthenticating = false,
                    currentUser = session,
                    generatedUsername = username,
                    followedAuthorIds = setOf("kathaai", "zoeok", "priyanair", "mayak"),
                    showAuthSheet = false,
                    authSheetOrigin = AuthSheetOrigin.NONE
                )
            }
            persistSocial()
            finishAuth(needsProfileSetup = true)
        }
    }

    private fun finishAuth(needsProfileSetup: Boolean) {
        if (needsProfileSetup) {
            _uiState.update { it.copy(showProfileSetup = true) }
        } else {
            handlePostAuth()
        }
    }

    fun completeProfileSetup(username: String, displayName: String, bio: String) {
        val current = _uiState.value.currentUser ?: return
        val updated = current.copy(
            username = username.trim(),
            displayName = displayName.trim(),
            bio = bio.trim()
        )
        persistSession(updated)
        _uiState.update { it.copy(currentUser = updated, showProfileSetup = false) }
        handlePostAuth()
    }

    private fun handlePostAuth() {
        val state = _uiState.value
        val name = state.currentUser?.displayName?.takeIf { it.isNotEmpty() } ?: "friend"
        ensureWelcomeBonus()
        _uiState.update {
            it.copy(
                reopenStoryId = it.pendingStoryId,
                pendingStoryId = null
            )
        }
        showToast("Welcome to Katha, $name!", isWelcome = true)
    }

    fun consumeReopenStory() {
        _uiState.update { it.copy(reopenStoryId = null) }
    }

    fun signOut() {
        persistSession(null)
        resetWizard()
        resetContinueWizard()
        _uiState.update {
            it.copy(
                currentUser = null,
                followedAuthorIds = emptySet(),
                likedStoryIds = emptySet(),
                bookmarkedStoryIds = emptySet(),
                readStoryIds = emptySet(),
                followedStoryIds = emptySet(),
                storyFollowerOverrides = emptyMap(),
                newChapterNotifications = emptyList(),
                showAuthSheet = false,
                showProfileSetup = false,
                authSheetOrigin = AuthSheetOrigin.NONE,
                publishedStories = emptyList(),
                profileStack = emptyList(),
                authorFollowerOverrides = emptyMap(),
                userComments = emptyList(),
                likedCommentIds = emptySet(),
                deletedCommentIds = emptySet(),
                reportedCommentIds = emptySet(),
                blockedUserIds = emptySet(),
                storyLikeOverrides = emptyMap(),
                storyShareOverrides = emptyMap(),
                likedChapterIds = emptySet(),
                commentedTodayKeys = emptySet(),
                showCommentsSheet = false,
                showReportSheet = false,
                showBlockUserModal = false
            )
        }
        persistSocial()
        showToast("Signed out")
    }

    fun deleteAccount() {
        prefs.edit().clear().apply()
        _uiState.value = KathaUiState()
    }

    // MARK: - Auth sheet

    fun presentAuthSheet(readerWall: Boolean, pendingStoryId: String? = null) {
        _uiState.update {
            it.copy(
                showAuthSheet = true,
                authSheetOrigin = if (readerWall) AuthSheetOrigin.READER_WALL else AuthSheetOrigin.GENERAL,
                authSheetContext = if (readerWall) AuthSheetContext.READER_WALL else AuthSheetContext.GENERIC,
                pendingStoryId = pendingStoryId,
                authError = null
            )
        }
    }

    fun presentAuthSheet(context: AuthSheetContext, pendingStoryId: String? = null) {
        _uiState.update {
            it.copy(
                showAuthSheet = true,
                authSheetOrigin = if (context == AuthSheetContext.READER_WALL) AuthSheetOrigin.READER_WALL else AuthSheetOrigin.GENERAL,
                authSheetContext = context,
                pendingStoryId = pendingStoryId,
                authError = null
            )
        }
    }

    fun dismissAuthSheet(force: Boolean = false) {
        val state = _uiState.value
        if (!force && state.authSheetOrigin == AuthSheetOrigin.READER_WALL) return
        _uiState.update {
            it.copy(
                showAuthSheet = false,
                authSheetOrigin = AuthSheetOrigin.NONE,
                pendingStoryId = null,
                authError = null
            )
        }
    }

    // MARK: - Social actions (all auth-gated)

    fun toggleLike(storyId: String) {
        if (!_uiState.value.isAuthenticated) {
            presentAuthSheet(context = AuthSheetContext.LIKE)
            return
        }
        val state = _uiState.value
        val isLiked = storyId in state.likedStoryIds
        val newOverrides = state.storyLikeOverrides.toMutableMap()
        if (isLiked) {
            newOverrides[storyId] = (newOverrides[storyId] ?: 0) - 1
        } else {
            newOverrides[storyId] = (newOverrides[storyId] ?: 0) + 1
        }
        _uiState.update {
            val next = it.likedStoryIds.toMutableSet()
            if (!next.add(storyId)) next.remove(storyId)
            it.copy(likedStoryIds = next, storyLikeOverrides = newOverrides)
        }
        persistSocial()
    }

    fun toggleBookmark(storyId: String) {
        if (!_uiState.value.isAuthenticated) {
            presentAuthSheet(readerWall = false)
            return
        }
        var added = false
        _uiState.update {
            val next = it.bookmarkedStoryIds.toMutableSet()
            added = next.add(storyId)
            if (!added) next.remove(storyId)
            it.copy(bookmarkedStoryIds = next)
        }
        persistSocial()
        if (added) showToast("Saved to library")
    }

    fun toggleFollow(authorId: String) {
        toggleFollowAuthor(authorId, confirmUnfollow = false)
    }

    /**
     * Follow/unfollow an author with optimistic follower count updates.
     * First unfollow per session shows a confirmation modal when [confirmUnfollow] is true.
     */
    fun toggleFollowAuthor(authorId: String, confirmUnfollow: Boolean = true) {
        val state = _uiState.value
        if (!state.isAuthenticated) {
            presentAuthSheet(readerWall = false)
            return
        }
        if (authorId in state.followedAuthorIds) {
            if (confirmUnfollow && !state.hasConfirmedAuthorUnfollowThisSession) {
                _uiState.update {
                    it.copy(
                        showUnfollowAuthorModal = true,
                        pendingUnfollowAuthorId = authorId,
                        pendingUnfollowAuthorName = SeedData.author(authorId)?.displayName ?: "this writer"
                    )
                }
            } else {
                unfollowAuthor(authorId)
            }
        } else {
            val base = SeedData.author(authorId)?.followers ?: 0
            val newOverrides = state.authorFollowerOverrides.toMutableMap()
            newOverrides[authorId] = state.authorFollowerCount(authorId, base) + 1
            _uiState.update {
                it.copy(
                    followedAuthorIds = it.followedAuthorIds + authorId,
                    authorFollowerOverrides = newOverrides
                )
            }
            persistSocial()
            SeedData.author(authorId)?.let { showToast("Following ${it.displayName}") }
        }
    }

    private fun unfollowAuthor(authorId: String) {
        val state = _uiState.value
        val base = SeedData.author(authorId)?.followers ?: 0
        val newOverrides = state.authorFollowerOverrides.toMutableMap()
        newOverrides[authorId] = maxOf(0, state.authorFollowerCount(authorId, base) - 1)
        _uiState.update {
            it.copy(
                followedAuthorIds = it.followedAuthorIds - authorId,
                authorFollowerOverrides = newOverrides
            )
        }
        persistSocial()
    }

    fun confirmUnfollowAuthor() {
        _uiState.value.pendingUnfollowAuthorId?.let { unfollowAuthor(it) }
        _uiState.update {
            it.copy(
                showUnfollowAuthorModal = false,
                pendingUnfollowAuthorId = null,
                hasConfirmedAuthorUnfollowThisSession = true
            )
        }
    }

    fun cancelUnfollowAuthor() {
        _uiState.update { it.copy(showUnfollowAuthorModal = false, pendingUnfollowAuthorId = null) }
    }

    // MARK: - Profile Navigation

    /** Opens an author's profile; routes to own profile if the id matches the current user. */
    fun openAuthorProfile(authorId: String) {
        val user = _uiState.value.currentUser
        val route = if (user != null && (authorId == user.username || authorId == user.id)) {
            ProfileRoute.Profile("me")
        } else {
            ProfileRoute.Profile(authorId)
        }
        _uiState.update { it.copy(profileStack = it.profileStack + route) }
    }

    fun openOwnProfile() {
        _uiState.update { it.copy(profileStack = it.profileStack + ProfileRoute.Profile("me")) }
    }

    fun pushProfileRoute(route: ProfileRoute) {
        _uiState.update { it.copy(profileStack = it.profileStack + route) }
    }

    fun popProfileRoute() {
        _uiState.update {
            if (it.profileStack.isEmpty()) it
            else it.copy(profileStack = it.profileStack.dropLast(1))
        }
    }

    fun closeAllProfiles() {
        _uiState.update { it.copy(profileStack = emptyList()) }
    }

    fun requestTab(index: Int) {
        _uiState.update { it.copy(requestedTab = index) }
    }

    fun consumeRequestedTab() {
        _uiState.update { it.copy(requestedTab = null) }
    }

    // MARK: - Edit Profile

    /** Saves profile edits with a mock 400ms delay. */
    fun saveProfile(displayName: String, username: String, bio: String, onDone: (Boolean) -> Unit) {
        val user = _uiState.value.currentUser ?: run { onDone(false); return }
        _uiState.update { it.copy(isSavingProfile = true) }
        viewModelScope.launch {
            delay(400)
            val usernameChanged = !username.equals(user.username, ignoreCase = true)
            val updated = user.copy(
                username = username.trim(),
                displayName = displayName.trim(),
                bio = bio.trim()
            )
            persistSession(updated)
            if (usernameChanged) {
                val now = System.currentTimeMillis()
                prefs.edit().putLong(KEY_LAST_USERNAME_CHANGE, now).apply()
                _uiState.update { it.copy(lastUsernameChange = now) }
            }
            _uiState.update { it.copy(currentUser = updated, isSavingProfile = false) }
            showToast("Profile updated \u2728")
            onDone(true)
        }
    }

    fun markStoryRead(storyId: String) {
        if (!_uiState.value.isAuthenticated) return
        _uiState.update { it.copy(readStoryIds = it.readStoryIds + storyId) }
        persistSocial()
    }

    // MARK: - Follow Story

    fun toggleFollowStory(storyId: String, storyTitle: String = "", followerCount: Int = 0) {
        if (!_uiState.value.isAuthenticated) {
            presentAuthSheet(readerWall = false)
            return
        }
        val state = _uiState.value
        if (storyId in state.followedStoryIds) {
            if (!state.hasConfirmedUnfollowThisSession) {
                _uiState.update {
                    it.copy(
                        showUnfollowStoryModal = true,
                        pendingUnfollowStoryId = storyId,
                        pendingUnfollowStoryTitle = storyTitle
                    )
                }
            } else {
                unfollowStory(storyId)
            }
        } else {
            val newFollowed = state.followedStoryIds + storyId
            val newOverrides = state.storyFollowerOverrides.toMutableMap()
            newOverrides[storyId] = maxOf(0, followerCount) + 1
            _uiState.update {
                it.copy(
                    followedStoryIds = newFollowed,
                    storyFollowerOverrides = newOverrides
                )
            }
            persistSocial()
            showToast("Following \"$storyTitle\"")
        }
    }

    fun confirmUnfollowStory() {
        val storyId = _uiState.value.pendingUnfollowStoryId
        if (storyId != null) {
            unfollowStory(storyId)
        }
        _uiState.update {
            it.copy(
                showUnfollowStoryModal = false,
                pendingUnfollowStoryId = null,
                hasConfirmedUnfollowThisSession = true
            )
        }
    }

    fun cancelUnfollowStory() {
        _uiState.update { it.copy(showUnfollowStoryModal = false, pendingUnfollowStoryId = null) }
    }

    private fun unfollowStory(storyId: String) {
        val state = _uiState.value
        val newFollowed = state.followedStoryIds - storyId
        val newOverrides = state.storyFollowerOverrides.toMutableMap()
        newOverrides[storyId]?.let { newOverrides[storyId] = maxOf(0, it - 1) }
        val newNotifications = state.newChapterNotifications.filterNot { it.storyId == storyId }
        _uiState.update {
            it.copy(
                followedStoryIds = newFollowed,
                storyFollowerOverrides = newOverrides,
                newChapterNotifications = newNotifications
            )
        }
        persistSocial()
    }

    fun isFollowingStory(storyId: String): Boolean = storyId in _uiState.value.followedStoryIds

    fun storyFollowerCount(storyId: String, baseCount: Int): Int {
        return _uiState.value.storyFollowerOverrides[storyId] ?: baseCount
    }

    // MARK: - Reader Chapter Navigation

    fun openReader(storyId: String, chapterIndex: Int = 0) {
        _uiState.update {
            it.copy(
                reopenStoryId = storyId,
                reopenStoryChapterIndex = chapterIndex,
                currentChapterIndex = chapterIndex
            )
        }
    }

    fun navigateToChapter(index: Int) {
        _uiState.update { it.copy(currentChapterIndex = index) }
    }

    fun navigateToNextChapter() {
        _uiState.update { it.copy(currentChapterIndex = it.currentChapterIndex + 1) }
    }

    fun navigateToPreviousChapter() {
        _uiState.update { it.copy(currentChapterIndex = maxOf(0, it.currentChapterIndex - 1)) }
    }

    fun showChapterList() {
        _uiState.update { it.copy(showChapterListSheet = true) }
    }

    fun dismissChapterList() {
        _uiState.update { it.copy(showChapterListSheet = false) }
    }

    // MARK: - Settings

    fun toggleReaderSepia() {
        val next = !_uiState.value.readerSepia
        prefs.edit().putBoolean(KEY_SEPIA, next).apply()
        _uiState.update { it.copy(readerSepia = next) }
    }

    // MARK: - Wizard

    fun resetWizard() {
        _uiState.update {
            it.copy(
                wizardStep = WizardStep.GENRE,
                wizardGenre = null,
                wizardTopic = "",
                wizardCharacters = emptyList(),
                wizardLanguage = StoryLanguage.ENGLISH,
                wizardReadingLevel = it.defaultReadingLevel,
                wizardPlanAsSeries = false,
                wizardSeriesChapterCount = 3,
                isGenerating = false,
                generationError = null,
                lastGeneratedStory = null,
                showOutOfCreditsModal = false,
                showLanguageSheet = false,
                showGetIdeasSheet = false
            )
        }
    }

    fun startCreatingStory() {
        if (!_uiState.value.isAuthenticated) {
            presentAuthSheet(readerWall = false)
            return
        }
        if ((_uiState.value.currentUser?.credits ?: 0) <= 0) {
            _uiState.update { it.copy(showOutOfCreditsModal = true) }
            return
        }
        resetWizard()
    }

    fun setWizardGenre(genre: Genre) {
        val state = _uiState.value
        if (genre == Genre.EROTICA && !state.ageVerified) {
            _uiState.update { it.copy(showAgeVerification = true) }
            return
        }
        if (state.kidsMode && genre == Genre.EROTICA) {
            showToast("Erotica is unavailable in Kids Mode")
            return
        }
        _uiState.update { it.copy(wizardGenre = genre, wizardStep = WizardStep.TOPIC) }
    }

    fun addWizardCharacter() {
        _uiState.update { state ->
            val index = state.wizardCharacters.size + 1
            state.copy(
                wizardCharacters = state.wizardCharacters + WizardCharacter(
                    id = UUID.randomUUID().toString(),
                    name = "",
                    role = if (index == 1) "Protagonist" else "Supporting",
                    description = ""
                )
            )
        }
    }

    fun removeWizardCharacter(id: String) {
        _uiState.update { it.copy(wizardCharacters = it.wizardCharacters.filter { c -> c.id != id }) }
    }

    fun updateWizardCharacter(character: WizardCharacter) {
        _uiState.update { state ->
            state.copy(
                wizardCharacters = state.wizardCharacters.map { c -> if (c.id == character.id) character else c }
            )
        }
    }

    fun moveToStep(step: WizardStep) {
        _uiState.update { it.copy(wizardStep = step) }
    }

    fun updateWizardTopic(topic: String) {
        val truncated = topic.take(800)
        _uiState.update { it.copy(wizardTopic = truncated) }
    }

    fun updateWizardPlanAsSeries(planAsSeries: Boolean) {
        _uiState.update { it.copy(wizardPlanAsSeries = planAsSeries) }
    }

    fun updateWizardSeriesChapterCount(delta: Int) {
        _uiState.update {
            it.copy(wizardSeriesChapterCount = (it.wizardSeriesChapterCount + delta).coerceIn(2, 10))
        }
    }

    fun updateWizardLanguage(language: StoryLanguage) {
        _uiState.update { it.copy(wizardLanguage = language) }
    }

    fun updateWizardReadingLevel(level: ReadingLevel) {
        _uiState.update { it.copy(wizardReadingLevel = level) }
    }

    fun showUiLanguageSheet() { _uiState.update { it.copy(showUiLanguageSheet = true) } }
    fun dismissUiLanguageSheet() { _uiState.update { it.copy(showUiLanguageSheet = false) } }

    fun showReadingLevelSheet(forWizard: Boolean = false, forCap: Boolean = false) {
        _uiState.update { it.copy(showReadingLevelSheet = true, readingLevelSheetForWizard = forWizard, readingLevelSheetForCap = forCap) }
    }

    fun dismissReadingLevelSheet() { _uiState.update { it.copy(showReadingLevelSheet = false) } }

    fun selectReadingLevel(level: ReadingLevel) {
        _uiState.update {
            when {
                it.readingLevelSheetForWizard -> it.copy(wizardReadingLevel = level)
                it.readingLevelSheetForCap -> it.copy(kidsReadingLevelCap = if (level == ReadingLevel.ADVANCED) ReadingLevel.STANDARD else level)
                else -> it.copy(defaultReadingLevel = level, wizardReadingLevel = level)
            }
        }
        persistSafety()
    }

    fun openParentalControls() { _uiState.update { it.copy(showParentalControls = true) } }
    fun closeParentalControls() { _uiState.update { it.copy(showParentalControls = false) } }
    fun beginKidsModeEnable() { _uiState.update { it.copy(showPinSetup = true, pinSetupMode = PinSetupMode.ENABLE_KIDS_MODE) } }
    fun beginKidsModeDisable() { _uiState.update { it.copy(showPinEntry = true, pinEntryContext = PinEntryContext.DISABLE_KIDS_MODE) } }
    fun beginPinChange() { _uiState.update { it.copy(showPinEntry = true, pinEntryContext = PinEntryContext.CHANGE_PIN) } }
    fun setKidsCommentsEnabled(value: Boolean) { _uiState.update { it.copy(kidsCommentsEnabled = value) }; persistSafety() }
    fun setKidsShareEnabled(value: Boolean) { _uiState.update { it.copy(kidsShareEnabled = value) }; persistSafety() }
    fun setKidsSearchSuggestionsEnabled(value: Boolean) { _uiState.update { it.copy(kidsSearchSuggestionsEnabled = value) }; persistSafety() }
    fun completeKidsModeEnable(pin: String) {
        _uiState.update { it.copy(kidsModePin = pin, kidsMode = true, ageVerified = false, showPinSetup = false, showParentalControls = true) }
        persistSafety(); showToast("Kids mode enabled ✨")
    }
    fun completePinChange(pin: String) {
        _uiState.update { it.copy(kidsModePin = pin, showPinSetup = false, showPinEntry = false) }
        persistSafety(); showToast("PIN updated")
    }
    fun verifyPin(pin: String): Boolean = _uiState.value.kidsModePin == pin
    fun completePinEntry() {
        val context = _uiState.value.pinEntryContext
        _uiState.update { it.copy(showPinEntry = false, pinCooldownUntil = null, kidsMode = if (context == PinEntryContext.DISABLE_KIDS_MODE) false else it.kidsMode) }
        persistSafety()
        if (context == PinEntryContext.DISABLE_KIDS_MODE) showToast("Kids mode turned off")
        if (context == PinEntryContext.CHANGE_PIN) _uiState.update { it.copy(showPinSetup = true, pinSetupMode = PinSetupMode.CHANGE_PIN) }
    }
    fun dismissPinEntry() { _uiState.update { it.copy(showPinEntry = false) } }
    fun cancelPinSetup() { _uiState.update { it.copy(showPinSetup = false) } }
    fun dismissAgeVerification() { _uiState.update { it.copy(showAgeVerification = false) } }
    fun recordPinFailure() { _uiState.update { it.copy(pinCooldownUntil = System.currentTimeMillis() + 5 * 60 * 1000L) }; persistSafety() }
    fun confirmAgeVerification() { _uiState.update { it.copy(ageVerified = true, showAgeVerification = false) }; persistSafety() }
    fun resetAgeVerification() { _uiState.update { it.copy(ageVerified = false) }; persistSafety(); showToast("Age verification reset") }
    fun showAgeVerification() { _uiState.update { it.copy(showAgeVerification = true) } }
    fun notifyHindiAvailability() { showToast("We'll let you know ✨") }

    fun showLanguageSheet() {
        _uiState.update { it.copy(showLanguageSheet = true) }
    }

    fun dismissLanguageSheet() {
        _uiState.update { it.copy(showLanguageSheet = false) }
    }

    fun showGetIdeasSheet() {
        _uiState.update { it.copy(showGetIdeasSheet = true) }
    }

    fun dismissGetIdeasSheet() {
        _uiState.update { it.copy(showGetIdeasSheet = false) }
    }

    fun showOutOfCreditsModal() {
        _uiState.update { it.copy(showOutOfCreditsModal = true) }
    }

    fun dismissOutOfCreditsModal() {
        _uiState.update { it.copy(showOutOfCreditsModal = false) }
    }

    fun generateStory() {
        val state = _uiState.value
        val genre = state.wizardGenre ?: return
        val user = state.currentUser ?: return
        if (user.credits <= 0) {
            _uiState.update { it.copy(showOutOfCreditsModal = true) }
            return
        }
        _uiState.update { it.copy(isGenerating = true, generationError = null) }
        viewModelScope.launch {
            try {
                val story = MockGeneration.generateStory(
                    genre = genre,
                    topic = state.wizardTopic,
                    characters = state.wizardCharacters,
                    language = state.wizardLanguage,
                    authorId = user.username,
                    plannedChapterCount = if (state.wizardPlanAsSeries) state.wizardSeriesChapterCount else null,
                    readingLevel = state.wizardReadingLevel
                )
                val updated = user.copy(credits = maxOf(0, user.credits - 1))
                persistSession(updated)
                _uiState.update {
                    it.copy(
                        lastGeneratedStory = story,
                        publishedStories = listOf(story) + it.publishedStories,
                        currentUser = updated
                    )
                }
                addCredits(-1, CreditReason.GENERATION, story.id)
            } catch (e: GenerationException) {
                _uiState.update {
                    it.copy(generationError = "Something went wrong while crafting your story. Please try again.")
                }
            }
            _uiState.update { it.copy(isGenerating = false) }
        }
    }

    fun openGeneratedStory(story: GeneratedStory) {
        _uiState.update {
            it.copy(
                reopenStoryId = story.id,
                reopenStoryChapterIndex = 0,
                currentChapterIndex = 0
            )
        }
    }

    fun buyCreditsMock() {
        addCredits(10, CreditReason.PURCHASE, "mock_pack")
        _uiState.update { it.copy(showOutOfCreditsModal = false) }
        showToast("10 credits added ✨")
    }

    // MARK: - Continue Wizard

    fun startContinueWizard(storyId: String, storyTitle: String, genre: Genre, chapterCount: Int, plannedChapterCount: Int?, followerCount: Int) {
        val user = _uiState.value.currentUser ?: return
        if (user.credits <= 0) {
            _uiState.update { it.copy(showOutOfCreditsModal = true) }
            return
        }
        _uiState.update {
            it.copy(
                showContinueWizard = true,
                continueWizardStoryId = storyId,
                continueWizardStoryTitle = storyTitle,
                continueWizardGenre = genre,
                continueWizardChapterNumber = chapterCount + 1,
                continueWizardPlannedChapterCount = plannedChapterCount,
                continueWizardFollowerCount = followerCount,
                continueWizardDirection = "",
                continueWizardStep = ContinueWizardStep.DIRECTION
            )
        }
    }

    fun resetContinueWizard() {
        _uiState.update {
            it.copy(
                showContinueWizard = false,
                continueWizardStep = ContinueWizardStep.DIRECTION,
                continueWizardStoryId = null,
                continueWizardDirection = "",
                continueWizardGenre = null,
                continueWizardChapterNumber = 2,
                continueWizardPlannedChapterCount = null,
                continueWizardStoryTitle = "",
                continueWizardFollowerCount = 0,
                isGeneratingChapter = false,
                chapterGenerationError = null,
                lastGeneratedChapter = null,
                showChapterGetIdeasSheet = false,
                showDiscardChapterModal = false
            )
        }
    }

    fun moveContinueWizardToStep(step: ContinueWizardStep) {
        _uiState.update { it.copy(continueWizardStep = step) }
    }

    fun updateContinueWizardDirection(direction: String) {
        val truncated = if (direction.length > 500) direction.take(500) else direction
        _uiState.update { it.copy(continueWizardDirection = truncated) }
    }

    fun showChapterGetIdeasSheet() {
        _uiState.update { it.copy(showChapterGetIdeasSheet = true) }
    }

    fun dismissChapterGetIdeasSheet() {
        _uiState.update { it.copy(showChapterGetIdeasSheet = false) }
    }

    fun showDiscardChapterModal() {
        _uiState.update { it.copy(showDiscardChapterModal = true) }
    }

    fun dismissDiscardChapterModal() {
        _uiState.update { it.copy(showDiscardChapterModal = false) }
    }

    fun generateChapter() {
        val state = _uiState.value
        val storyId = state.continueWizardStoryId ?: return
        val genre = state.continueWizardGenre ?: return
        val user = state.currentUser ?: return
        if (user.credits <= 0) {
            _uiState.update { it.copy(showOutOfCreditsModal = true) }
            return
        }
        _uiState.update { it.copy(isGeneratingChapter = true, chapterGenerationError = null) }
        viewModelScope.launch {
            try {
                val chapter = MockGeneration.generateChapter(
                    parentStoryId = storyId,
                    chapterNumber = state.continueWizardChapterNumber,
                    direction = state.continueWizardDirection,
                    language = state.continueWizardLanguage,
                    parentGenre = genre,
                    plannedChapterCount = state.continueWizardPlannedChapterCount
                )
                // Append chapter to the parent GeneratedStory
                val updatedStories = state.publishedStories.map { gs ->
                    if (gs.id == storyId) {
                        gs.copy(chapters = (gs.chapters + chapter).toMutableList())
                    } else gs
                }
                val updated = user.copy(credits = maxOf(0, user.credits - 1))
                persistSession(updated)
                _uiState.update {
                    it.copy(
                        lastGeneratedChapter = chapter,
                        publishedStories = updatedStories,
                        currentUser = updated
                    )
                }
                addCredits(-1, CreditReason.GENERATION, chapter.id)
            } catch (e: GenerationException) {
                _uiState.update {
                    it.copy(chapterGenerationError = "Something went wrong while crafting this chapter. Please try again.")
                }
            }
            _uiState.update { it.copy(isGeneratingChapter = false) }
        }
    }

    fun openGeneratedChapterPreview() {
        val state = _uiState.value
        val storyId = state.continueWizardStoryId ?: return
        val chapter = state.lastGeneratedChapter ?: return
        val genStory = state.publishedStories.firstOrNull { it.id == storyId } ?: return
        val story = genStory.asStory()
        val chapterIndex = story.chapters.indexOfFirst { it.id == chapter.id }.let { if (it >= 0) it else story.chapters.lastIndex }
        _uiState.update {
            it.copy(
                reopenStoryId = story.id,
                reopenStoryChapterIndex = chapterIndex,
                currentChapterIndex = chapterIndex
            )
        }
        resetContinueWizard()
    }

    // MARK: - Publish Chapter

    fun requestPublishChapter(storyId: String, chapterId: String) {
        _uiState.update {
            it.copy(
                showPublishModal = true,
                pendingPublishStoryId = storyId,
                pendingPublishChapterId = chapterId
            )
        }
    }

    fun confirmPublishChapter() {
        val state = _uiState.value
        val storyId = state.pendingPublishStoryId ?: return
        val chapterId = state.pendingPublishChapterId ?: return

        _uiState.update { it.copy(isPublishing = true) }

        // Update chapter in publishedStories
        val updatedStories = state.publishedStories.map { gs ->
            if (gs.id == storyId) {
                val updatedChapters = gs.chapters.map { ch ->
                    if (ch.id == chapterId) {
                        ch.copy(isPublished = true, publishedAt = System.currentTimeMillis())
                    } else ch
                }
                gs.copy(chapters = updatedChapters.toMutableList())
            } else gs
        }

        val followerCount = state.continueWizardFollowerCount

        // Mock notification: if user follows this story (self-follow test)
        val newNotifications = state.newChapterNotifications.toMutableList()
        if (storyId in state.followedStoryIds) {
            val genStory = updatedStories.firstOrNull { it.id == storyId }
            if (genStory != null) {
                val chapterNum = genStory.chapters.count { it.isPublished }
                newNotifications.add(
                    NewChapterNotification(
                        id = UUID.randomUUID().toString(),
                        storyId = storyId,
                        storyTitle = genStory.title,
                        chapterNumber = chapterNum,
                        coverColors = genStory.coverColors,
                        genre = genStory.genre,
                        publishedAt = System.currentTimeMillis()
                    )
                )
            }
        }

        _uiState.update {
            it.copy(
                publishedStories = updatedStories,
                newChapterNotifications = newNotifications,
                isPublishing = false,
                showPublishModal = false,
                pendingPublishStoryId = null,
                pendingPublishChapterId = null
            )
        }

        if (followerCount > 0) {
            showToast("Chapter published ✨ $followerCount followers notified")
        } else {
            showToast("Chapter published ✨")
        }
    }

    fun cancelPublishModal() {
        _uiState.update {
            it.copy(
                showPublishModal = false,
                pendingPublishStoryId = null,
                pendingPublishChapterId = null
            )
        }
    }

    // MARK: - Delete Draft

    fun requestDeleteDraft(storyId: String, chapterId: String) {
        _uiState.update {
            it.copy(
                showDeleteDraftModal = true,
                pendingDeleteStoryId = storyId,
                pendingDeleteChapterId = chapterId
            )
        }
    }

    fun confirmDeleteDraft() {
        val state = _uiState.value
        val storyId = state.pendingDeleteStoryId ?: return
        val chapterId = state.pendingDeleteChapterId ?: return

        _uiState.update { it.copy(isDeleting = true) }

        val updatedStories = state.publishedStories.map { gs ->
            if (gs.id == storyId) {
                gs.copy(chapters = gs.chapters.filter { it.id != chapterId }.toMutableList())
            } else gs
        }

        _uiState.update {
            it.copy(
                publishedStories = updatedStories,
                isDeleting = false,
                showDeleteDraftModal = false,
                pendingDeleteStoryId = null,
                pendingDeleteChapterId = null
            )
        }

        showToast("Draft deleted")
    }

    fun cancelDeleteDraftModal() {
        _uiState.update {
            it.copy(
                showDeleteDraftModal = false,
                pendingDeleteStoryId = null,
                pendingDeleteChapterId = null
            )
        }
    }

    // MARK: - New Chapter Notifications

    fun dismissNewChapterBanner(storyId: String) {
        _uiState.update { it.copy(dismissedBannerStoryIds = it.dismissedBannerStoryIds + storyId) }
    }

    fun markChapterAsRead(storyId: String, chapterNumber: Int) {
        _uiState.update {
            it.copy(newChapterNotifications = it.newChapterNotifications.filterNot { notif ->
                notif.storyId == storyId && notif.chapterNumber == chapterNumber
            })
        }
    }

    // MARK: - Comments

    fun toggleCommentLike(comment: StoryComment) {
        if (!_uiState.value.isAuthenticated) {
            presentAuthSheet(context = AuthSheetContext.COMMENT)
            return
        }
        _uiState.update {
            val next = it.likedCommentIds.toMutableSet()
            if (!next.add(comment.id)) next.remove(comment.id)
            it.copy(likedCommentIds = next)
        }
        persistEngagement()
    }

    fun postComment(storyId: String, text: String, replyTo: StoryComment? = null) {
        val user = _uiState.value.currentUser ?: run {
            presentAuthSheet(context = AuthSheetContext.COMMENT)
            return
        }
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return

        val dayKey = storyId + "|" + java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
        val isFirstToday = dayKey !in _uiState.value.commentedTodayKeys

        val comment = StoryComment(
            id = UUID.randomUUID().toString(),
            storyId = storyId,
            authorId = user.username,
            username = user.username,
            displayName = user.displayName.ifEmpty { user.username },
            text = trimmed,
            likes = 0,
            postedOffsetHours = 0,
            isVerified = false,
            replyToUsername = replyTo?.username
        )
        _uiState.update {
            it.copy(
                userComments = it.userComments + comment,
                commentedTodayKeys = if (isFirstToday) it.commentedTodayKeys + dayKey else it.commentedTodayKeys
            )
        }
        if (isFirstToday) {
            addCredits(1, CreditReason.FEEDBACK, storyId)
            showToast("+1 credit for joining the conversation!")
        }
        persistEngagement()
    }

    fun deleteComment(commentId: String) {
        _uiState.update { it.copy(deletedCommentIds = it.deletedCommentIds + commentId) }
        persistEngagement()
        showToast("Comment deleted")
    }

    fun openCommentsSheet(storyId: String) {
        _uiState.update {
            it.copy(
                showCommentsSheet = true,
                commentsSheetStoryId = storyId,
                replyToComment = null,
                composerText = "",
                commentsSortNewest = false
            )
        }
    }

    fun closeCommentsSheet() {
        _uiState.update {
            it.copy(
                showCommentsSheet = false,
                commentsSheetStoryId = null,
                replyToComment = null,
                composerText = "",
                highlightedCommentId = null
            )
        }
    }

    fun startReply(comment: StoryComment) {
        val prefill = if (comment.replyToUsername != null) {
            "@${comment.replyToUsername} "
        } else {
            "@${comment.username} "
        }
        _uiState.update { it.copy(replyToComment = comment, composerText = prefill) }
    }

    fun cancelReply() {
        _uiState.update { it.copy(replyToComment = null, composerText = "") }
    }

    fun updateComposerText(text: String) {
        _uiState.update { it.copy(composerText = text.take(500)) }
    }

    fun sendComment() {
        val storyId = _uiState.value.commentsSheetStoryId ?: return
        val text = _uiState.value.composerText
        val reply = _uiState.value.replyToComment
        postComment(storyId, text, reply)
        _uiState.update { it.copy(replyToComment = null, composerText = "") }
    }

    fun toggleCommentsSort() {
        _uiState.update { it.copy(commentsSortNewest = !it.commentsSortNewest) }
    }

    // MARK: - Blocking

    fun requestBlockUser(authorId: String, displayName: String) {
        _uiState.update {
            it.copy(
                showBlockUserModal = true,
                pendingBlockAuthorId = authorId,
                pendingBlockAuthorName = displayName
            )
        }
    }

    fun confirmBlockUser() {
        val authorId = _uiState.value.pendingBlockAuthorId ?: return
        if (authorId in _uiState.value.followedAuthorIds) {
            unfollowAuthor(authorId)
        }
        _uiState.update {
            it.copy(
                blockedUserIds = it.blockedUserIds + authorId,
                showBlockUserModal = false,
                pendingBlockAuthorId = null,
                pendingBlockAuthorName = ""
            )
        }
        persistEngagement()
        showToast("@${_uiState.value.pendingBlockAuthorName} has been blocked")
    }

    fun cancelBlockUser() {
        _uiState.update {
            it.copy(showBlockUserModal = false, pendingBlockAuthorId = null, pendingBlockAuthorName = "")
        }
    }

    fun unblockUser(authorId: String) {
        _uiState.update { it.copy(blockedUserIds = it.blockedUserIds - authorId) }
        persistEngagement()
        showToast("User unblocked")
    }

    // MARK: - Reporting

    fun requestReport(target: ReportTarget) {
        _uiState.update { it.copy(showReportSheet = true, pendingReportTarget = target) }
    }

    fun submitReport(reason: String) {
        val target = _uiState.value.pendingReportTarget
        if (target is ReportTarget.Comment) {
            _uiState.update { it.copy(reportedCommentIds = it.reportedCommentIds + target.commentId) }
            persistEngagement()
        }
        _uiState.update { it.copy(showReportSheet = false, pendingReportTarget = null) }
        showToast("Thanks — our team will review this shortly.")
    }

    fun cancelReport() {
        _uiState.update { it.copy(showReportSheet = false, pendingReportTarget = null) }
    }

    // MARK: - Share

    fun shareStory(story: Story, chapterId: String? = null) {
        val authorName = SeedData.author(story.authorId)?.displayName ?: ""
        val firstLine = story.chapters.firstOrNull()?.paragraphs?.firstOrNull() ?: ""
        val preview = firstLine.take(100)
        val chapter = chapterId ?: story.chapters.firstOrNull()?.id ?: ""
        val text = "${story.title} by $authorName\n\n$preview...\n\nRead on Katha: https://katha.ai/s/${story.id}/$chapter"
        _uiState.update {
            it.copy(
                storyShareOverrides = it.storyShareOverrides.toMutableMap().apply {
                    this[story.id] = (this[story.id] ?: 0) + 1
                }.toMap(),
                sharePayload = SharePayload(text)
            )
        }
        persistEngagement()
    }

    fun clearSharePayload() {
        _uiState.update { it.copy(sharePayload = null) }
    }

    // MARK: - Chapter Likes

    fun toggleChapterLike(chapterId: String) {
        if (!_uiState.value.isAuthenticated) {
            presentAuthSheet(context = AuthSheetContext.LIKE)
            return
        }
        _uiState.update {
            val next = it.likedChapterIds.toMutableSet()
            if (!next.add(chapterId)) next.remove(chapterId)
            it.copy(likedChapterIds = next)
        }
        persistEngagement()
    }

    // MARK: - Theme Filter

    fun applyThemeFilter(theme: String) {
        _uiState.update {
            it.copy(
                discoverThemeFilter = theme,
                discoverFeedChip = 1,
                discoverGenreFilter = null,
                requestedTab = 1
            )
        }
    }

    fun clearThemeFilter() {
        _uiState.update { it.copy(discoverThemeFilter = null) }
    }

    fun setDiscoverFeedChip(chip: Int) {
        _uiState.update { it.copy(discoverFeedChip = chip) }
    }

    // MARK: - Audio (FIX 8)

    enum class AudioBarState { PREPARING, READY, ERROR }

    fun audioState(storyId: String): AudioBarState {
        val state = _uiState.value
        if (state.audioErrorStoryId == storyId) return AudioBarState.ERROR
        if (storyId in state.audioReadyStoryIds) return AudioBarState.READY
        if (state.audioPreparingStoryId == storyId) return AudioBarState.PREPARING
        // Seed stories are always ready
        if (SeedData.stories.any { it.id == storyId }) return AudioBarState.READY
        return AudioBarState.PREPARING
    }

    fun startAudioPreparation(storyId: String) {
        val state = _uiState.value
        if (storyId in state.audioReadyStoryIds) return
        if (state.audioPreparingStoryId == storyId) return

        _uiState.update {
            it.copy(audioPreparingStoryId = storyId, audioErrorStoryId = null)
        }

        viewModelScope.launch {
            val delay = (8..15).random().toLong()
            kotlinx.coroutines.delay(delay * 1000)

            val current = _uiState.value
            if (current.audioPreparingStoryId != storyId) return@launch

            // 3% failure rate
            if ((1..100).random() <= 3) {
                _uiState.update {
                    it.copy(audioErrorStoryId = storyId, audioPreparingStoryId = null)
                }
            } else {
                val newReady = current.audioReadyStoryIds + storyId
                prefs.edit().putStringSet(KEY_AUDIO_READY, newReady).apply()
                _uiState.update {
                    it.copy(audioReadyStoryIds = newReady, audioPreparingStoryId = null)
                }
            }
        }
    }

    fun retryAudio(storyId: String) {
        _uiState.update { it.copy(audioErrorStoryId = null) }
        startAudioPreparation(storyId)
    }

    // MARK: - Toast

    fun showToast(message: String, isWelcome: Boolean = false) {
        _uiState.update { it.copy(toastMessage = message, toastIsWelcome = isWelcome) }
        viewModelScope.launch {
            delay(3000)
            _uiState.update {
                if (it.toastMessage == message) it.copy(toastMessage = null) else it
            }
        }
    }

    private companion object {
        const val KEY_APP_LANGUAGE = "appLanguage"
        const val KEY_READING_LEVEL = "defaultReadingLevel"
        const val KEY_KIDS_MODE = "kidsMode"
        const val KEY_KIDS_PIN = "kidsModePin"
        const val KEY_PIN_COOLDOWN = "pinCooldownUntil"
        const val KEY_KIDS_CAP = "kidsReadingLevelCap"
        const val KEY_KIDS_COMMENTS = "kidsCommentsEnabled"
        const val KEY_KIDS_SHARE = "kidsShareEnabled"
        const val KEY_KIDS_SEARCH = "kidsSearchSuggestionsEnabled"
        const val KEY_AGE_VERIFIED = "ageVerified"
        const val KEY_SESSION = "session"
        const val KEY_FOLLOWED_AUTHORS = "followedAuthors"
        const val KEY_LIKED = "likedStories"
        const val KEY_BOOKMARKED = "bookmarkedStories"
        const val KEY_READ = "readStories"
        const val KEY_FOLLOWED_STORIES = "followedStories"
        const val KEY_SEPIA = "readerSepia"
        const val KEY_ONBOARDED = "onboardingCompleted"
        const val KEY_LAST_USERNAME_CHANGE = "lastUsernameChange"
        const val KEY_LIKED_COMMENTS = "likedComments"
        const val KEY_DELETED_COMMENTS = "deletedComments"
        const val KEY_REPORTED_COMMENTS = "reportedComments"
        const val KEY_BLOCKED_USERS = "blockedUsers"
        const val KEY_LIKED_CHAPTERS = "likedChapters"
        const val KEY_AUDIO_READY = "audioReady"
        const val KEY_IS_PREMIUM = "isPremium"
        const val KEY_SUB_TYPE = "subscriptionType"
        const val KEY_SUB_EXPIRES = "subscriptionExpiresAt"
        const val KEY_LAST_AD_CREDIT = "lastAdCredit"
        const val KEY_CREDIT_LEDGER = "creditLedger"
    }

    // MARK: - Credit Ledger (Prompt 8+9)

    private fun loadCreditLedger(): List<CreditLedgerEntry> {
        val raw = prefs.getString(KEY_CREDIT_LEDGER, null) ?: return emptyList()
        return runCatching {
            json.decodeFromString<List<CreditLedgerEntry>>(raw)
        }.getOrDefault(emptyList())
    }

    private fun persistCreditLedger() {
        val ledger = _uiState.value.creditLedger
        prefs.edit().putString(KEY_CREDIT_LEDGER, json.encodeToString(ledger)).apply()
        prefs.edit().putBoolean(KEY_IS_PREMIUM, _uiState.value.isPremium).apply()
        val subType = _uiState.value.subscriptionType
        if (subType != null) {
            prefs.edit().putString(KEY_SUB_TYPE, subType).apply()
        } else {
            prefs.edit().remove(KEY_SUB_TYPE).apply()
        }
        val expires = _uiState.value.subscriptionExpiresAt
        if (expires != null) {
            prefs.edit().putLong(KEY_SUB_EXPIRES, expires).apply()
        } else {
            prefs.edit().remove(KEY_SUB_EXPIRES).apply()
        }
        val lastAd = _uiState.value.lastAdCreditTimestamp
        if (lastAd != null) {
            prefs.edit().putLong(KEY_LAST_AD_CREDIT, lastAd).apply()
        } else {
            prefs.edit().remove(KEY_LAST_AD_CREDIT).apply()
        }
    }

    fun addCredits(amount: Int, reason: CreditReason, referenceId: String? = null) {
        val state = _uiState.value
        val user = state.currentUser ?: return
        val newBalance = maxOf(0, user.credits + amount)
        val entry = CreditLedgerEntry(
            id = UUID.randomUUID().toString(),
            amount = amount,
            reason = reason.key,
            referenceId = referenceId,
            timestamp = System.currentTimeMillis(),
            balanceAfter = newBalance
        )
        val updated = user.copy(credits = newBalance)
        persistSession(updated)
        _uiState.update {
            it.copy(
                currentUser = updated,
                creditLedger = it.creditLedger + entry
            )
        }
        persistCreditLedger()
    }

    fun ensureWelcomeBonus() {
        if (_uiState.value.creditLedger.isEmpty() && _uiState.value.currentUser != null) {
            addCredits(3, CreditReason.WELCOME_BONUS)
        }
    }

    val recentLedgerEntries: List<CreditLedgerEntry>
        get() = _uiState.value.creditLedger.takeLast(8).reversed()

    val fullLedgerEntries: List<CreditLedgerEntry>
        get() = _uiState.value.creditLedger.reversed()

    // MARK: - Credits Screen Navigation

    fun openCreditsScreen() { _uiState.update { it.copy(showCreditsScreen = true) } }
    fun closeCreditsScreen() { _uiState.update { it.copy(showCreditsScreen = false) } }
    fun openSubscriptionPaywall() { _uiState.update { it.copy(showSubscriptionPaywall = true) } }
    fun closeSubscriptionPaywall() { _uiState.update { it.copy(showSubscriptionPaywall = false) } }
    fun openCreditPackSheet(packId: String? = null) { _uiState.update { it.copy(showCreditPackSheet = true, creditPackSheetPreselectedId = packId) } }
    fun closeCreditPackSheet() { _uiState.update { it.copy(showCreditPackSheet = false, creditPackSheetPreselectedId = null) } }
    fun openSubscriptionManagement() { _uiState.update { it.copy(showSubscriptionManagement = true) } }
    fun closeSubscriptionManagement() { _uiState.update { it.copy(showSubscriptionManagement = false) } }
    fun openCreditHistory() { _uiState.update { it.copy(showCreditHistory = true) } }
    fun closeCreditHistory() { _uiState.update { it.copy(showCreditHistory = false) } }

    // MARK: - Subscription Purchase

    fun purchaseSubscription(plan: SubscriptionPlan) {
        _uiState.update { it.copy(isPurchasingSubscription = true) }
        viewModelScope.launch {
            delay(800) // Mock payment processing
            val state = _uiState.value
            val user = state.currentUser
            if (user != null) {
                val expires = System.currentTimeMillis() + if (plan == SubscriptionPlan.YEARLY) 365L * 24 * 3600 * 1000 else 30L * 24 * 3600 * 1000
                _uiState.update {
                    it.copy(
                        isPremium = true,
                        subscriptionType = plan.key,
                        subscriptionExpiresAt = expires,
                        isPurchasingSubscription = false,
                        showSubscriptionPaywall = false
                    )
                }
                addCredits(plan.creditsPerCycle, CreditReason.SUBSCRIPTION, plan.productId)
                showToast("Welcome to Katha Premium ✨", isWelcome = true)
            }
        }
    }

    // MARK: - Credit Pack Purchase

    fun purchaseCreditPack(pack: CreditPack) {
        _uiState.update { it.copy(isPurchasingPack = true) }
        viewModelScope.launch {
            delay(800) // Mock payment processing
            addCredits(pack.credits, CreditReason.PURCHASE, pack.productId)
            _uiState.update {
                it.copy(isPurchasingPack = false, showCreditPackSheet = false, creditPackSheetPreselectedId = null)
            }
            showToast("${pack.credits} credits added ✨")
        }
    }

    // MARK: - Restore Purchases

    private var restoreCallCount = 0

    fun restorePurchases() {
        _uiState.update { it.copy(isRestoringPurchases = true) }
        viewModelScope.launch {
            delay(500)
            restoreCallCount++
            if (restoreCallCount % 2 == 0) {
                _uiState.update {
                    it.copy(
                        isPremium = true,
                        subscriptionType = SubscriptionPlan.YEARLY.key,
                        subscriptionExpiresAt = System.currentTimeMillis() + 365L * 24 * 3600 * 1000,
                        isRestoringPurchases = false
                    )
                }
                persistCreditLedger()
                showToast("Purchases restored ✨")
            } else {
                _uiState.update { it.copy(isRestoringPurchases = false) }
                showToast("No previous purchases found on this account.")
            }
        }
    }

    // MARK: - Cancel Subscription (Mock)

    fun cancelSubscription() {
        _uiState.update {
            it.copy(subscriptionExpiresAt = System.currentTimeMillis() + 24 * 3600 * 1000)
        }
        persistCreditLedger()
        showToast("Subscription cancelled. Premium active until renewal date.")
    }

    // MARK: - Ad Reward

    val canWatchAd: Boolean
        get() {
            val last = _uiState.value.lastAdCreditTimestamp ?: return true
            return System.currentTimeMillis() - last >= AdConfig.cooldownMillis
        }

    val adCooldownRemainingSec: Int
        get() {
            val last = _uiState.value.lastAdCreditTimestamp ?: return 0
            val elapsed = System.currentTimeMillis() - last
            val remaining = AdConfig.cooldownMillis - elapsed
            return maxOf(0, (remaining / 1000).toInt())
        }

    val adCooldownLabel: String
        get() {
            val secs = adCooldownRemainingSec
            if (secs <= 0) return ""
            val hours = secs / 3600
            val mins = (secs % 3600) / 60
            return if (hours > 0) "Next in ${hours}h ${mins}m" else "Next in ${mins}m"
        }

    fun startAdWatch() {
        if (!canWatchAd) return
        _uiState.update { it.copy(adWatchState = AdWatchState.LOADING_AD) }
        viewModelScope.launch {
            delay(800) // Mock ad load
            _uiState.update {
                it.copy(adWatchState = AdWatchState.PLAYING_AD, showMockAdScreen = true)
            }
        }
    }

    fun completeAdWatch() {
        _uiState.update { it.copy(showMockAdScreen = false) }
        viewModelScope.launch {
            delay(200) // Mock SSV verification
            addCredits(1, CreditReason.AD_REWARD)
            _uiState.update {
                it.copy(
                    lastAdCreditTimestamp = System.currentTimeMillis(),
                    adWatchState = AdWatchState.JUST_REWARDED,
                    showAdRewardToast = true
                )
            }
            persistCreditLedger()
            delay(3000)
            _uiState.update {
                it.copy(showAdRewardToast = false, adWatchState = AdWatchState.ON_COOLDOWN)
            }
        }
    }

    fun interruptAdWatch() {
        _uiState.update {
            it.copy(showMockAdScreen = false, adWatchState = AdWatchState.AVAILABLE)
        }
        showToast("Ad was interrupted. Try again later.")
    }

    // MARK: - Referral Share

    fun shareReferralLink() {
        val userId = _uiState.value.currentUser?.username ?: "guest"
        val text = "I've been writing stories on Katha AI — join me: https://katha.ai/r/$userId"
        _uiState.update { it.copy(sharePayload = SharePayload(text)) }
    }

    // MARK: - Analytics Navigation (Prompt 10)

    fun openStoryAnalytics(story: Story) {
        _uiState.update { it.copy(showStoryAnalytics = true, analyticsStoryId = story.id) }
    }

    fun closeStoryAnalytics() {
        _uiState.update { it.copy(showStoryAnalytics = false, analyticsStoryId = null) }
    }

    fun openDashboard() {
        _uiState.update { it.copy(showDashboard = true) }
    }

    fun closeDashboard() {
        _uiState.update { it.copy(showDashboard = false) }
    }

    fun showReaderEarningToast(credits: Int, storyTitle: String, storyId: String) {
        _uiState.update {
            it.copy(
                showReaderEarningToast = true,
                readerEarningCredits = credits,
                readerEarningStoryTitle = storyTitle,
                readerEarningStoryId = storyId
            )
        }
        viewModelScope.launch {
            delay(4000)
            _uiState.update { it.copy(showReaderEarningToast = false) }
        }
    }

    fun closeReaderEarningToast() {
        _uiState.update { it.copy(showReaderEarningToast = false) }
    }

    // MARK: - Dev Tools (Prompt 10)

    fun registerDevTap() {
        val count = _uiState.value.devTapCount + 1
        if (count >= 5) {
            _uiState.update { it.copy(devTapCount = 0, showDevTools = true) }
        } else {
            _uiState.update { it.copy(devTapCount = count) }
        }
    }

    fun closeDevTools() {
        _uiState.update { it.copy(showDevTools = false) }
    }

    fun ensureAnalyticsSeeded() {
        AnalyticsService.ensureSeeded(SeedData.stories)
    }
}

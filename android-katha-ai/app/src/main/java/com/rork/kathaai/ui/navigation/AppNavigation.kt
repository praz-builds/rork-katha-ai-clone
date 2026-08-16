package com.rork.kathaai.ui.navigation

import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LibraryBooks
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.ContinueWizardStep
import com.rork.kathaai.ui.components.KathaToast
import com.rork.kathaai.ui.screens.AuthSheetOverlay
import com.rork.kathaai.ui.screens.BlockConfirmationModal
import com.rork.kathaai.ui.screens.BlockedUsersScreen
import com.rork.kathaai.ui.screens.CommentsSheetOverlay
import com.rork.kathaai.ui.screens.ReportSheetOverlay
import com.rork.kathaai.ui.screens.ShareLauncher
import com.rork.kathaai.ui.screens.ChapterGenerationScreen
import com.rork.kathaai.ui.screens.ContinueWizardScreen
import com.rork.kathaai.ui.screens.CreateScreen
import com.rork.kathaai.ui.screens.DeleteDraftModal
import com.rork.kathaai.ui.screens.DiscoverScreen
import com.rork.kathaai.ui.screens.HomeScreen
import com.rork.kathaai.ui.screens.LibraryScreen
import com.rork.kathaai.ui.screens.OnboardingScreen
import com.rork.kathaai.ui.screens.ProfileSetupScreen
import com.rork.kathaai.ui.screens.PublishConfirmationModal
import com.rork.kathaai.ui.screens.ReaderScreen
import com.rork.kathaai.ui.screens.SettingsScreen
import com.rork.kathaai.ui.screens.ProfileRouteHost
import com.rork.kathaai.ui.screens.SplashScreen
import com.rork.kathaai.ui.screens.UnfollowAuthorModal
import com.rork.kathaai.ui.screens.UnfollowStoryModal
import com.rork.kathaai.ui.screens.CreditsScreen
import com.rork.kathaai.ui.screens.SubscriptionPaywall
import com.rork.kathaai.ui.screens.CreditPackSheet
import com.rork.kathaai.ui.screens.SubscriptionManagementScreen
import com.rork.kathaai.ui.screens.CreditHistoryScreen
import com.rork.kathaai.ui.screens.MockAdScreen
import com.rork.kathaai.ui.screens.AdRewardToastView
import com.rork.kathaai.ui.screens.StoryAnalyticsScreen
import com.rork.kathaai.ui.screens.AuthorDashboardScreen
import com.rork.kathaai.ui.screens.CelebrationBanner
import com.rork.kathaai.ui.screens.ReadingLevelSheet
import com.rork.kathaai.ui.screens.ParentalControlsScreen
import com.rork.kathaai.ui.screens.PinSetupScreen
import com.rork.kathaai.ui.screens.PinEntrySheet
import com.rork.kathaai.ui.screens.AgeVerificationSheet
import com.rork.kathaai.ui.screens.ReaderEarningToast
import com.rork.kathaai.ui.screens.DevToolsSheet
import com.rork.kathaai.ui.screens.StreakScreen
import com.rork.kathaai.ui.screens.NotificationsScreen
import com.rork.kathaai.ui.screens.InviteFriendsScreen
import com.rork.kathaai.ui.screens.StorageScreen
import com.rork.kathaai.ui.screens.AudioPlayerSheet
import com.rork.kathaai.ui.screens.PrePermissionModal
import com.rork.kathaai.ui.screens.StreakResetModal
import com.rork.kathaai.ui.screens.DownloadProgressBanner
import com.rork.kathaai.ui.screens.RateAppPrompt
import com.rork.kathaai.data.AnalyticsService
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import com.rork.kathaai.viewmodel.openStreakScreen
import com.rork.kathaai.viewmodel.openNotificationsScreen
import com.rork.kathaai.viewmodel.openInviteFriendsScreen
import com.rork.kathaai.viewmodel.openStorageScreen
import com.rork.kathaai.viewmodel.handleDeepLink
import kotlinx.coroutines.delay

private object Routes {
    const val SPLASH = "splash"
    const val ONBOARDING = "onboarding"
    const val MAIN = "main"
    const val READER = "reader"
}

@Composable
fun AppNavigation(initialDeepLink: Uri? = null) {
    val viewModel: AppViewModel = viewModel()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val navController = rememberNavController()

    LaunchedEffect(initialDeepLink) { initialDeepLink?.let { viewModel.handleDeepLink(it) } }

    var splashFinished by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(1500)
        splashFinished = true
    }

    val phase = when {
        !splashFinished -> Routes.SPLASH
        !state.onboardingCompleted -> Routes.ONBOARDING
        else -> Routes.MAIN
    }

    LaunchedEffect(phase) {
        if (phase == Routes.SPLASH) return@LaunchedEffect
        navController.navigate(phase) {
            popUpTo(0) { inclusive = true }
            launchSingleTop = true
        }
    }

    Box(Modifier.fillMaxSize().background(KathaTheme.canvas)) {
        NavHost(
            navController = navController,
            startDestination = Routes.SPLASH
        ) {
            composable(Routes.SPLASH) { SplashScreen() }

            composable(Routes.ONBOARDING) {
                OnboardingScreen(onContinue = { viewModel.completeOnboarding() })
            }

            composable(Routes.MAIN) {
                MainScreen(
                    state = state,
                    viewModel = viewModel,
                    navController = navController
                )
            }

            composable("${Routes.READER}/{storyId}") { backStackEntry ->
                val storyId = backStackEntry.arguments?.getString("storyId")
                val story = storyId?.let { id ->
                    SeedData.story(id) ?: state.publishedStories.firstOrNull { it.id == id }?.asStory()
                }
                if (story == null) {
                    LaunchedEffect(Unit) { navController.popBackStack() }
                } else {
                    ReaderScreen(
                        story = story,
                        state = state,
                        viewModel = viewModel,
                        onClose = { navController.popBackStack() },
                        onLike = { viewModel.toggleLike(story.id) },
                        onBookmark = { viewModel.toggleBookmark(story.id) },
                        onFollow = { viewModel.toggleFollow(it) },
                        onToggleSepia = { viewModel.toggleReaderSepia() },
                        onSignIn = {
                            viewModel.presentAuthSheet(readerWall = true, pendingStoryId = story.id)
                        },
                        onRead = { viewModel.markStoryRead(story.id) },
                        onContinueStory = {
                            viewModel.startContinueWizard(
                                storyId = story.id,
                                storyTitle = story.title,
                                genre = story.genre,
                                chapterCount = story.chapters.size,
                                plannedChapterCount = story.plannedChapterCount,
                                followerCount = viewModel.storyFollowerCount(story.id, story.followerCount)
                            )
                        },
                        onFollowStory = {
                            viewModel.toggleFollowStory(
                                storyId = story.id,
                                storyTitle = story.title,
                                followerCount = viewModel.storyFollowerCount(story.id, story.followerCount)
                            )
                        },
                        onNavigateChapter = { viewModel.navigateToChapter(it) },
                        onShowChapterList = { viewModel.showChapterList() },
                        onPublishChapter = { chapterId ->
                            viewModel.requestPublishChapter(story.id, chapterId)
                        },
                        onDeleteDraft = { chapterId ->
                            viewModel.requestDeleteDraft(story.id, chapterId)
                        },
                        onOpenAuthor = { viewModel.openAuthorProfile(it) },
                        onOpenComments = { viewModel.openCommentsSheet(it) },
                        onShare = { viewModel.shareStory(story) }
                    )
                }
            }
        }

        // Reopen story with optional chapter index
        LaunchedEffect(state.reopenStoryId) {
            val id = state.reopenStoryId
            if (id != null) {
                navController.navigate("${Routes.READER}/$id") { launchSingleTop = true }
                viewModel.consumeReopenStory()
            }
        }

        // Profile overlay stack (above reader, below auth sheet)
        state.profileStack.forEach { route ->
            key(route.routeId) {
                ProfileRouteHost(
                    route = route,
                    state = state,
                    viewModel = viewModel,
                    onOpenStory = { storyId ->
                        navController.navigate("${Routes.READER}/$storyId") { launchSingleTop = true }
                    }
                )
            }
        }

        // Auth sheet
        if (state.showAuthSheet) {
            AuthSheetOverlay(
                origin = state.authSheetOrigin,
                isAuthenticating = state.isAuthenticating,
                authError = state.authError,
                onDismiss = { viewModel.dismissAuthSheet() },
                onGoogle = { viewModel.signInWithGoogle() },
                onApple = { viewModel.signInWithApple() },
                onEmail = { viewModel.signInWithEmail(it) }
            )
        }

        // Profile setup
        if (state.showProfileSetup) {
            ProfileSetupScreen(
                generatedUsername = state.generatedUsername,
                onComplete = { username, displayName, bio ->
                    viewModel.completeProfileSetup(username, displayName, bio)
                }
            )
        }

        // Out of credits modal
        if (state.showOutOfCreditsModal) {
            com.rork.kathaai.ui.screens.OutOfCreditsModal(
                onBuy = {
                    viewModel.dismissOutOfCreditsModal()
                    viewModel.openSubscriptionPaywall()
                },
                onWatchAd = {
                    viewModel.dismissOutOfCreditsModal()
                    viewModel.openCreditsScreen()
                },
                onDismiss = { viewModel.dismissOutOfCreditsModal() }
            )
        }

        // Credits screen
        if (state.showCreditsScreen) {
            CreditsScreen(
                state = state,
                viewModel = viewModel,
                onBack = { viewModel.closeCreditsScreen() },
                onOpenPaywall = { viewModel.openSubscriptionPaywall() },
                onOpenPackSheet = { viewModel.openCreditPackSheet(it) },
                onOpenManagement = { viewModel.openSubscriptionManagement() },
                onOpenHistory = { viewModel.openCreditHistory() }
            )
        }

        // Subscription paywall
        if (state.showSubscriptionPaywall) {
            SubscriptionPaywall(
                state = state,
                viewModel = viewModel,
                onClose = { viewModel.closeSubscriptionPaywall() }
            )
        }

        // Credit pack sheet
        if (state.showCreditPackSheet) {
            CreditPackSheet(
                state = state,
                viewModel = viewModel,
                preselectedId = state.creditPackSheetPreselectedId,
                onClose = { viewModel.closeCreditPackSheet() }
            )
        }

        // Subscription management
        if (state.showSubscriptionManagement) {
            SubscriptionManagementScreen(
                state = state,
                viewModel = viewModel,
                onBack = { viewModel.closeSubscriptionManagement() }
            )
        }

        // Credit history
        if (state.showCreditHistory) {
            CreditHistoryScreen(
                state = state,
                viewModel = viewModel,
                onBack = { viewModel.closeCreditHistory() }
            )
        }

        // Mock ad screen
        if (state.showMockAdScreen) {
            MockAdScreen(
                viewModel = viewModel,
                onComplete = { viewModel.completeAdWatch() }
            )
        }

        // Ad reward toast
        if (state.showAdRewardToast) {
            Box(
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 140.dp),
                contentAlignment = Alignment.BottomCenter
            ) {
                AdRewardToastView(balance = state.currentUser?.credits ?: 0)
            }
        }

        // Continue wizard
        if (state.showContinueWizard && !state.isGeneratingChapter) {
            ContinueWizardScreen(
                state = state,
                onDirectionChange = { viewModel.updateContinueWizardDirection(it) },
                onMoveStep = { viewModel.moveContinueWizardToStep(it) },
                onShowGetIdeas = { viewModel.showChapterGetIdeasSheet() },
                onGenerate = { viewModel.generateChapter() },
                onPreview = { viewModel.openGeneratedChapterPreview() },
                onPublishNow = {
                    val chapter = state.lastGeneratedChapter
                    val storyId = state.continueWizardStoryId
                    if (chapter != null && storyId != null) {
                        viewModel.requestPublishChapter(storyId, chapter.id)
                    }
                },
                onSaveDraft = { viewModel.resetContinueWizard() },
                onCancel = { viewModel.resetContinueWizard() },
                onDiscard = { viewModel.resetContinueWizard() }
            )
        }

        // Chapter generation screen
        if (state.isGeneratingChapter) {
            ChapterGenerationScreen(
                state = state,
                onPreview = { viewModel.openGeneratedChapterPreview() },
                onPublishNow = {
                    val chapter = state.lastGeneratedChapter
                    val storyId = state.continueWizardStoryId
                    if (chapter != null && storyId != null) {
                        viewModel.requestPublishChapter(storyId, chapter.id)
                    }
                },
                onSaveDraft = { viewModel.resetContinueWizard() }
            )
        }

        // Publish confirmation modal
        if (state.showPublishModal) {
            PublishConfirmationModal(
                state = state,
                onPublish = { viewModel.confirmPublishChapter() },
                onKeepDraft = { viewModel.cancelPublishModal() }
            )
        }

        // Delete draft modal
        if (state.showDeleteDraftModal) {
            DeleteDraftModal(
                state = state,
                onDelete = { viewModel.confirmDeleteDraft() },
                onKeep = { viewModel.cancelDeleteDraftModal() }
            )
        }

        // Unfollow story modal
        if (state.showUnfollowStoryModal) {
            UnfollowStoryModal(
                state = state,
                onConfirm = { viewModel.confirmUnfollowStory() },
                onCancel = { viewModel.cancelUnfollowStory() }
            )
        }

        // Unfollow author modal
        if (state.showUnfollowAuthorModal) {
            UnfollowAuthorModal(
                state = state,
                onConfirm = { viewModel.confirmUnfollowAuthor() },
                onCancel = { viewModel.cancelUnfollowAuthor() }
            )
        }

        // Comments sheet
        if (state.showCommentsSheet) {
            CommentsSheetOverlay(state = state, viewModel = viewModel)
        }

        // Report sheet
        if (state.showReportSheet) {
            ReportSheetOverlay(state = state, viewModel = viewModel)
        }

        // Block confirmation modal
        if (state.showBlockUserModal) {
            BlockConfirmationModal(state = state, viewModel = viewModel)
        }

        // Native share launcher
        state.sharePayload?.let { payload ->
            ShareLauncher(text = payload.text) { viewModel.clearSharePayload() }
        }

        // Story Analytics overlay
        if (state.showStoryAnalytics) {
            val storyId = state.analyticsStoryId
            val story = storyId?.let { id ->
                SeedData.stories.firstOrNull { it.id == id }
                    ?: state.publishedStories.firstOrNull { it.id == id }?.asStory()
            }
            if (story != null) {
                StoryAnalyticsScreen(
                    story = story,
                    state = state,
                    viewModel = viewModel,
                    onBack = { viewModel.closeStoryAnalytics() },
                    onOpenReader = { id, idx -> navController.navigate("${Routes.READER}/$id") },
                    onOpenComments = { viewModel.openCommentsSheet(it) },
                    onShare = { viewModel.shareStory(story) }
                )
            }
        }

        // Author Dashboard overlay
        if (state.showDashboard) {
            AuthorDashboardScreen(
                state = state,
                viewModel = viewModel,
                onBack = { viewModel.closeDashboard() },
                onOpenStoryAnalytics = { s -> viewModel.openStoryAnalytics(s) },
                onNavigateToCreate = {
                    viewModel.closeDashboard()
                    viewModel.requestTab(2)
                }
            )
        }

        // Reader-earning toast (from top)
        if (state.showReaderEarningToast) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 60.dp)
            ) {
                ReaderEarningToast(
                    credits = state.readerEarningCredits,
                    storyTitle = state.readerEarningStoryTitle,
                    onView = {
                        viewModel.closeReaderEarningToast()
                        SeedData.stories.firstOrNull { it.id == state.readerEarningStoryId }?.let { s ->
                            viewModel.openStoryAnalytics(s)
                        }
                    }
                )
            }
        }

        if (state.showReadingLevelSheet) {
            ReadingLevelSheet(state = state, viewModel = viewModel)
        }
        if (state.showParentalControls) {
            ParentalControlsScreen(state = state, viewModel = viewModel)
        }
        if (state.showPinSetup) {
            PinSetupScreen(state = state, viewModel = viewModel)
        }
        if (state.showPinEntry) {
            PinEntrySheet(state = state, viewModel = viewModel)
        }
        if (state.showAgeVerification) {
            AgeVerificationSheet(state = state, viewModel = viewModel)
        }
        if (state.showStreakScreen) StreakScreen(state = state, viewModel = viewModel)
        if (state.showNotificationsScreen) NotificationsScreen(state = state, viewModel = viewModel)
        if (state.showInviteFriendsScreen) InviteFriendsScreen(state = state, viewModel = viewModel)
        if (state.showStorageScreen) StorageScreen(state = state, viewModel = viewModel)
        if (state.showPrePermissionModal) PrePermissionModal(state = state, viewModel = viewModel)
        if (state.showStreakResetModal) StreakResetModal(state = state, viewModel = viewModel)
        if (state.showRatePrompt) RateAppPrompt(state = state, viewModel = viewModel)
        state.downloadProgress?.let { DownloadProgressBanner(state = state, modifier = Modifier.align(Alignment.TopCenter).padding(top = 48.dp)) }
        if (state.showAudioPlayer) {
            val audioStoryId = state.audioPlayerStoryId
            val audioStory = audioStoryId?.let { id -> SeedData.story(id) ?: state.publishedStories.firstOrNull { it.id == id }?.asStory() }
            audioStory?.let { AudioPlayerSheet(state = state, viewModel = viewModel, story = it) }
        }

        // Dev tools sheet
        DevToolsSheet(
            isPresented = state.showDevTools,
            onDismiss = { viewModel.closeDevTools() },
            onTriggerMilestone = {
                val storyId = SeedData.stories.firstOrNull { it.authorId == "aarav" }?.id ?: ""
                val storyTitle = "Late Trains and Longer Nights"
                AnalyticsService.triggerMilestoneCelebration(
                    com.rork.kathaai.model.MilestoneKey.READS_100,
                    storyId,
                    storyTitle
                )
                viewModel.closeDevTools()
                viewModel.requestTab(0)
                viewModel.showToast("Milestone queued — go to Home")
            },
            onTriggerReaderEarning = {
                viewModel.showReaderEarningToast(1, "Late Trains and Longer Nights", SeedData.stories.firstOrNull { it.authorId == "aarav" }?.id ?: "")
                viewModel.closeDevTools()
            },
            onResetMilestones = {
                AnalyticsService.resetAllMilestones()
                viewModel.showToast("Milestones reset")
            },
            onResetAnalytics = {
                AnalyticsService.resetAllAnalytics()
                viewModel.showToast("Analytics reset")
            }
        )

        // Toast
        AnimatedVisibility(
            visible = state.toastMessage != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 130.dp)
        ) {
            state.toastMessage?.let {
                KathaToast(it, state.toastIsWelcome)
            }
        }
    }
}

@Composable
private fun MainScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    navController: NavHostController
) {
    var selectedTab by remember { mutableIntStateOf(0) }

    LaunchedEffect(selectedTab) {
        if (selectedTab != 2) {
            viewModel.resetWizard()
        }
    }

    // Tab navigation requests from overlays (own profile settings icon, empty-state CTAs)
    LaunchedEffect(state.requestedTab) {
        state.requestedTab?.let { tab ->
            selectedTab = tab
            viewModel.consumeRequestedTab()
        }
    }

    val openStory: (String) -> Unit = { storyId ->
        navController.navigate("${Routes.READER}/$storyId")
    }
    val presentAuth: () -> Unit = { viewModel.presentAuthSheet(readerWall = false) }

    Box(Modifier.fillMaxSize()) {
        when (selectedTab) {
            0 -> HomeScreen(
                state = state,
                onOpenStory = openStory,
                onLike = { viewModel.toggleLike(it) },
                onBookmark = { viewModel.toggleBookmark(it) },
                onOpenStoryWithChapter = { storyId, chapterIndex ->
                    viewModel.openReader(storyId, chapterIndex)
                },
                onMarkChapterRead = { storyId, chapterNum ->
                    viewModel.markChapterAsRead(storyId, chapterNum)
                },
                onOpenAuthor = { viewModel.openAuthorProfile(it) },
                onOpenOwnProfile = { viewModel.openOwnProfile() },
                onFollowAuthor = { viewModel.toggleFollowAuthor(it) },
                onSeeMoreWriters = { viewModel.showToast("More writers coming \u2728") },
                onOpenCredits = { viewModel.openCreditsScreen() }
            )
            1 -> DiscoverScreen(
                state = state,
                viewModel = viewModel,
                onOpenStory = openStory,
                onOpenAuthor = { viewModel.openAuthorProfile(it) }
            )
            2 -> CreateScreen(
                state = state,
                viewModel = viewModel,
                onSignIn = presentAuth
            )
            3 -> LibraryScreen(
                state = state,
                onOpenStory = openStory,
                onSignIn = presentAuth
            )
            else -> SettingsScreen(
                state = state,
                onSignIn = presentAuth,
                onSignOut = { viewModel.signOut() },
                onDeleteAccount = { viewModel.deleteAccount() },
                onToggleSepia = { viewModel.toggleReaderSepia() },
                onViewProfile = { viewModel.openOwnProfile() },
                onEditProfile = {
                    viewModel.openOwnProfile()
                    viewModel.pushProfileRoute(com.rork.kathaai.model.ProfileRoute.EditProfile)
                },
                onViewBlockedUsers = {
                    viewModel.pushProfileRoute(com.rork.kathaai.model.ProfileRoute.BlockedUsers)
                },
                onOpenCredits = { viewModel.openCreditsScreen() },
                onOpenPaywall = { viewModel.openSubscriptionPaywall() },
                onOpenSubscriptionManagement = { viewModel.openSubscriptionManagement() },
                onOpenDashboard = { viewModel.openDashboard() },
                onDevTap = { viewModel.registerDevTap() },
                onOpenReadingLevel = { viewModel.showReadingLevelSheet() },
                onOpenParentalControls = { viewModel.openParentalControls() },
                onOpenStreak = { viewModel.openStreakScreen() },
                onOpenNotifications = { viewModel.openNotificationsScreen() },
                onOpenInviteFriends = { viewModel.openInviteFriendsScreen() },
                onOpenStorage = { viewModel.openStorageScreen() }
            )
        }

        KathaTabBar(
            selectedTab = selectedTab,
            modifier = Modifier.align(Alignment.BottomCenter)
        ) { selectedTab = it }
    }
}

@Composable
private fun KathaTabBar(
    selectedTab: Int,
    modifier: Modifier = Modifier,
    onSelect: (Int) -> Unit
) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.s)
            .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
            .background(KathaTheme.surface)
            .navigationBarsPadding()
            .padding(top = 10.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        TabItem(Icons.Outlined.Home, "Home", selectedTab == 0, Modifier.weight(1f)) { onSelect(0) }
        TabItem(Icons.Outlined.Explore, "Discover", selectedTab == 1, Modifier.weight(1f)) { onSelect(1) }

        Box(
            modifier = Modifier.weight(1f),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .offset(y = (-8).dp)
                    .size(56.dp)
                    .shadow(12.dp, CircleShape)
                    .clip(CircleShape)
                    .background(KathaTheme.accent)
                    .clickable {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onSelect(2)
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Outlined.Add,
                    contentDescription = "Create",
                    tint = Color.White,
                    modifier = Modifier.size(26.dp)
                )
            }
        }

        TabItem(Icons.Outlined.LibraryBooks, "Library", selectedTab == 3, Modifier.weight(1f)) { onSelect(3) }
        TabItem(Icons.Outlined.Settings, "Settings", selectedTab == 4, Modifier.weight(1f)) { onSelect(4) }
    }
}

@Composable
private fun TabItem(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    Column(
        modifier = modifier
            .clickable {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onClick()
            }
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = if (isSelected) KathaTheme.accent else KathaTheme.textTertiary,
            modifier = Modifier.size(22.dp)
        )
        Text(
            label,
            color = if (isSelected) KathaTheme.accent else KathaTheme.textTertiary,
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

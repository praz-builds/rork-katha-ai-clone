//
//  ContentView.swift
//  KathaAICreateStories
//

import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            // Main content based on app phase
            if appState.appPhase == .splash {
                SplashView()
                    .transition(.opacity)
            } else if appState.appPhase == .onboarding {
                OnboardingView()
                    .transition(.opacity)
            } else {
                MainTabView()
                    .transition(.opacity)
            }

            // Reader overlay (above main content)
            if appState.showReader, let story = appState.selectedStory {
                ReaderView(story: story)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(1)
            }

            // Profile overlay stack (above reader, below wizard/auth)
            ForEach(Array(appState.profileStack.enumerated()), id: \.element.id) { index, route in
                ProfileRouteHost(route: route)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(1.2 + Double(index) * 0.01)
            }

            // Chapter list sheet
            if appState.showChapterListSheet, let story = appState.selectedStory {
                ChapterListSheet(story: story)
                    .zIndex(1.5)
            }

            // Continue wizard overlay
            if appState.showContinueWizard || appState.isGeneratingChapter {
                ContinueWizardView()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(1.8)
            }

            // Chapter generation screen
            if appState.isGeneratingChapter {
                ChapterGenerationScreen()
                    .zIndex(1.9)
            }

            // Auth sheet overlay (above reader)
            if appState.showAuthSheet {
                AuthSheetOverlay()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(2)
            }

            // Profile setup overlay (above auth sheet)
            if appState.showProfileSetup {
                ProfileSetupView()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(3)
            }

            // Out of credits modal
            if appState.showOutOfCreditsModal {
                OutOfCreditsModal()
                    .transition(.opacity)
                    .zIndex(3)
            }

            // Credits screen overlay
            ForEach(Array(appState.creditsStack.enumerated()), id: \.element.id) { index, route in
                CreditsRouteHost(route: route)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(1.1 + Double(index) * 0.01)
            }

            // Subscription paywall
            if appState.showSubscriptionPaywall {
                SubscriptionPaywall()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(3.2)
            }

            // Subscription management
            if appState.showSubscriptionManagement {
                SubscriptionManagementScreen()
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(3.2)
            }

            // Credit history
            if appState.showCreditHistory {
                CreditHistoryScreen()
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(3.2)
            }

            // Credit pack sheet
            if appState.showCreditPackSheet {
                CreditPackSheet(preselectedId: appState.creditPackSheetPreselectedId)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(3.3)
            }

            // Mock ad screen
            if appState.showMockAdScreen {
                MockAdScreen()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(4.5)
            }

            // Ad reward toast
            if appState.showAdRewardToast {
                VStack {
                    Spacer()
                    AdRewardToastView()
                        .padding(.bottom, 140)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .allowsHitTesting(false)
                .zIndex(4.6)
            }

            // Story Analytics overlay
            if appState.showStoryAnalytics, let story = appState.analyticsStory {
                StoryAnalyticsScreen(story: story)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(3.1)
            }

            // Author Dashboard overlay
            if appState.showDashboard {
                AuthorDashboardScreen()
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(3.1)
            }

            // Reader-earning toast (slides from top)
            if appState.showReaderEarningToast {
                VStack {
                    ReaderEarningToast(
                        credits: appState.readerEarningCredits,
                        storyTitle: appState.readerEarningStoryTitle,
                        storyId: appState.readerEarningStoryId,
                        onView: {
                            appState.showReaderEarningToast = false
                            if let story = SeedData.stories.first(where: { $0.id == appState.readerEarningStoryId }) {
                                appState.openStoryAnalytics(story: story)
                            }
                        }
                    )
                    .padding(.top, 60)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(4.7)
            }

            // Dev tools sheet
            if appState.showDevTools {
                DevToolsSheet(isPresented: Binding(
                    get: { appState.showDevTools },
                    set: { appState.showDevTools = $0 }
                ))
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .zIndex(5)
            }

            // Discard chapter modal
            if appState.showDiscardChapterModal {
                DiscardChapterModal()
                    .transition(.opacity)
                    .zIndex(3)
            }

            // Publish confirmation modal
            if appState.showPublishModal {
                PublishConfirmationModal()
                    .transition(.opacity)
                    .zIndex(3)
            }

            // Delete draft modal
            if appState.showDeleteDraftModal {
                DeleteDraftModal()
                    .transition(.opacity)
                    .zIndex(3)
            }

            // Unfollow story modal
            if appState.showUnfollowStoryModal {
                UnfollowStoryModal()
                    .transition(.opacity)
                    .zIndex(3)
            }

            // Unfollow author modal
            if appState.showUnfollowAuthorModal {
                UnfollowAuthorModal()
                    .transition(.opacity)
                    .zIndex(3)
            }

            // Comments sheet
            if appState.showCommentsSheet {
                CommentsSheetOverlay()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(2.5)
            }

            // Report sheet
            if appState.showReportSheet {
                ReportSheetOverlay()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(3.5)
            }

            // Block confirmation modal
            if appState.showBlockUserModal {
                BlockConfirmationModal()
                    .transition(.opacity)
                    .zIndex(3.5)
            }

            // Native share sheet
            if let payload = appState.sharePayload {
                ShareSheet(text: payload.text)
                    .zIndex(4)
                    .onDisappear { appState.clearSharePayload() }
            }

            // Language selection sheet
            if appState.showUILanguageSheet {
                AppLanguageSelectionSheet()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(5.1)
            }

            // Reading level sheet
            if appState.showReadingLevelSheet {
                ReadingLevelSheet()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(5.2)
            }

            // Parental controls hub
            if appState.showParentalControls {
                ParentalControlsScreen()
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(5.3)
            }

            // PIN setup and verification
            if appState.showPINSetup {
                PINSetupScreen(mode: appState.pinSetupMode)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(5.4)
            }
            if appState.showPINEntry {
                PINEntrySheet(context: appState.pinEntryContext)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(5.5)
            }

            // Age verification
            if appState.showAgeVerification {
                AgeVerificationSheet()
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(5.6)
            }

            // Toast (above everything)
            if let toast = appState.toastMessage {
                VStack {
                    Spacer()
                    ToastView(message: toast, isWelcome: appState.toastIsWelcome)
                        .padding(.bottom, 140)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .allowsHitTesting(false)
                .zIndex(4)
            }
        }
        .onAppear {
            appState.ensureAnalyticsSeeded()
        }
        .animation(.easeInOut(duration: 0.5), value: appState.appPhase)
        .animation(.easeInOut(duration: 0.3), value: appState.showReader)
        .animation(.easeInOut(duration: 0.3), value: appState.showAuthSheet)
        .animation(.easeInOut(duration: 0.3), value: appState.showProfileSetup)
        .animation(.easeInOut(duration: 0.3), value: appState.showOutOfCreditsModal)
        .animation(.easeInOut(duration: 0.3), value: appState.showContinueWizard)
        .animation(.easeInOut(duration: 0.3), value: appState.isGeneratingChapter)
        .animation(.easeInOut(duration: 0.3), value: appState.showDiscardChapterModal)
        .animation(.easeInOut(duration: 0.3), value: appState.showPublishModal)
        .animation(.easeInOut(duration: 0.3), value: appState.showDeleteDraftModal)
        .animation(.easeInOut(duration: 0.3), value: appState.showUnfollowStoryModal)
        .animation(.easeInOut(duration: 0.3), value: appState.showUnfollowAuthorModal)
        .animation(.easeInOut(duration: 0.3), value: appState.showCommentsSheet)
        .animation(.easeInOut(duration: 0.3), value: appState.showReportSheet)
        .animation(.easeInOut(duration: 0.3), value: appState.showBlockUserModal)
        .animation(.easeInOut(duration: 0.3), value: appState.creditsStack)
        .animation(.easeInOut(duration: 0.4), value: appState.showSubscriptionPaywall)
        .animation(.easeInOut(duration: 0.3), value: appState.showSubscriptionManagement)
        .animation(.easeInOut(duration: 0.3), value: appState.showCreditHistory)
        .animation(.easeInOut(duration: 0.3), value: appState.showCreditPackSheet)
        .animation(.easeInOut(duration: 0.4), value: appState.showMockAdScreen)
        .animation(.easeInOut(duration: 0.3), value: appState.showAdRewardToast)
        .animation(.easeInOut(duration: 0.3), value: appState.showStoryAnalytics)
        .animation(.easeInOut(duration: 0.3), value: appState.showDashboard)
        .animation(.easeInOut(duration: 0.3), value: appState.showReaderEarningToast)
        .animation(.easeInOut(duration: 0.3), value: appState.showDevTools)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: appState.showUILanguageSheet)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: appState.showReadingLevelSheet)
        .animation(.easeInOut(duration: 0.3), value: appState.showParentalControls)
        .animation(.easeInOut(duration: 0.3), value: appState.showPINSetup)
        .animation(.easeInOut(duration: 0.3), value: appState.showPINEntry)
        .animation(.easeInOut(duration: 0.3), value: appState.showAgeVerification)
        .animation(.easeInOut(duration: 0.25), value: appState.profileStack)
        .animation(.easeInOut(duration: 0.3), value: appState.showChapterListSheet)
        .animation(.easeInOut(duration: 0.3), value: appState.toastMessage)
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}

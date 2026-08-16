//
//  SettingsView.swift
//  KathaAICreateStories
//

import SwiftUI
import MessageUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var showSignOutConfirm = false
    @State private var showDeleteConfirm1 = false
    @State private var showDeleteConfirm2 = false
    @State private var showMailComposer = false

    var body: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.xl) {
                header

                if appState.isAuthenticated {
                    profileSection
                    rewardsSection
                    preferencesSection
                    readingSection
                    appSection
                    if !appState.blockedUserIds.isEmpty {
                        blockedUsersSection
                    }
                    supportSection
                    aboutSection
                    accountActions
                } else {
                    signInSection
                    preferencesSection
                    readingSection
                    appSection
                    aboutSection
                }

                SafeBottomSpacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
        }
        .themedBackground()
        .scrollIndicators(.hidden)
        .alert("Sign Out", isPresented: $showSignOutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Sign Out", role: .destructive) {
                appState.signOut()
            }
        } message: {
            Text("Are you sure you want to sign out?")
        }
        .alert("Delete Account", isPresented: $showDeleteConfirm1) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) {
                showDeleteConfirm2 = true
            }
        } message: {
            Text("This will permanently delete your account and all associated data. This action cannot be undone.")
        }
        .alert("Are you absolutely sure?", isPresented: $showDeleteConfirm2) {
            Button("Cancel", role: .cancel) {}
            Button("Delete Forever", role: .destructive) {
                appState.deleteAccount()
            }
        } message: {
            Text("All your saved stories, reading history, and credits will be lost. Type 'Delete' to confirm.")
        }
        .sheet(isPresented: $showMailComposer) {
            FeedbackMailComposer(
                appVersion: "1.0",
                username: appState.currentUser?.username ?? "Guest"
            )
        }
    }

    private var header: some View {
        HStack {
            Text("Settings")
                .font(KathaFont.Title1)
                .foregroundStyle(KathaTheme.textPrimary)
            Spacer()
        }
        .padding(.top, KathaTheme.Spacing.s)
    }

    private var profileSection: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            HStack(spacing: KathaTheme.Spacing.m) {
                GeneratedAvatar(
                    username: appState.currentUser?.username ?? "",
                    displayName: appState.currentUser?.displayName ?? "",
                    size: 64
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(appState.currentUser?.displayName ?? "")
                        .font(KathaFont.Title2)
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("@\(appState.currentUser?.username ?? "")")
                        .font(KathaFont.Body)
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                Spacer()
            }

            if let bio = appState.currentUser?.bio, !bio.isEmpty {
                Text(bio)
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: KathaTheme.Spacing.xxl) {
                statItem(value: appState.currentUser?.followers ?? 0, label: "Followers")
                statItem(value: appState.followedAuthorIds.count, label: "Following")
                statItem(value: appState.currentUser?.credits ?? 0, label: "Credits")
            }
            .padding(.top, KathaTheme.Spacing.s)

            HStack(spacing: KathaTheme.Spacing.xl) {
                TextLink(title: "View your profile ▸") {
                    appState.openOwnProfile()
                }
                TextLink(title: "Edit profile ▸") {
                    appState.openOwnProfile()
                    appState.pushProfileRoute(.editProfile)
                }
                Spacer()
            }
            .padding(.top, KathaTheme.Spacing.s)

            KidsModeIndicator()
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(KathaTheme.Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                .fill(KathaTheme.surface)
        )
        .kathaCardShadow()
    }

    private func statItem(value: Int, label: String) -> some View {
        VStack(spacing: 2) {
            Text(formatCount(value))
                .font(KathaFont.Title2)
                .foregroundStyle(KathaTheme.textPrimary)
            Text(label)
                .font(KathaFont.Meta)
                .foregroundStyle(KathaTheme.textSecondary)
        }
    }

    private var signInSection: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            EmptyState(
                icon: "person.crop.circle.badge.questionmark",
                title: "Not signed in",
                message: "Sign in to personalize your experience, save stories, and start writing.",
                ctaTitle: "Sign in",
                ctaAction: { appState.presentAuthSheet(readerWall: false) }
            )
        }
    }

    private var preferencesSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("Preferences")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textSecondary)

            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "book")
                        .foregroundStyle(KathaTheme.textSecondary)
                    Text("Sepia reader")
                        .font(KathaFont.Body)
                        .foregroundStyle(KathaTheme.textPrimary)
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { appState.readerSepia },
                        set: { _ in appState.toggleReaderSepia() }
                    ))
                    .labelsHidden()
                    .tint(KathaTheme.accent)
                }
                .padding(.vertical, KathaTheme.Spacing.m)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
            )
        }
    }

    private var readingSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("Reading")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textSecondary)
            VStack(spacing: 0) {
                Button { appState.openReadingLevelSheet() } label: {
                    HStack {
                        Image(systemName: "text.book.closed").foregroundStyle(KathaTheme.textSecondary).frame(width: 24)
                        Text("Reading level").font(KathaFont.Body).foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        Text(appState.defaultReadingLevel.title).font(KathaFont.Body).foregroundStyle(KathaTheme.textSecondary)
                        Image(systemName: "chevron.right").font(KathaFont.Meta).foregroundStyle(KathaTheme.textTertiary)
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                }
                .buttonStyle(.plain)
                Divider().background(KathaTheme.border)
                settingRow(icon: "book", title: "Sepia reader", value: appState.readerSepia ? "On" : "Off")
                    .contentShape(Rectangle())
                    .onTapGesture { appState.toggleReaderSepia() }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.l).fill(KathaTheme.surface))
        }
    }

    private var appSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("App")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textSecondary)
            VStack(spacing: 0) {
                Button { appState.openParentalControls() } label: {
                    HStack {
                        Image(systemName: "checkmark.shield").foregroundStyle(appState.kidsMode ? KathaTheme.accent : KathaTheme.textSecondary).frame(width: 24)
                        Text("Parental controls").font(KathaFont.Body).foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        if appState.kidsMode {
                            Text("On").font(KathaFont.Meta).foregroundStyle(KathaTheme.accent).padding(.horizontal, 8).frame(height: 22).background(Capsule().fill(KathaTheme.accentSoft))
                        } else {
                            Text("Off").font(KathaFont.Body).foregroundStyle(KathaTheme.textSecondary)
                        }
                        Image(systemName: "chevron.right").font(KathaFont.Meta).foregroundStyle(KathaTheme.textTertiary)
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                }
                .buttonStyle(.plain)
                Divider().background(KathaTheme.border)
                Button { appState.openNotificationsScreen() } label: {
                    settingRow(icon: "bell", title: "Notifications", value: "Manage")
                }.buttonStyle(.plain)
                Divider().background(KathaTheme.border)
                Button { appState.openStorageScreen() } label: {
                    settingRow(icon: "internaldrive", title: "Storage", value: appState.offlineStoryRecords.isEmpty ? "Empty" : "\(appState.offlineStoryRecords.count) saved")
                }.buttonStyle(.plain)
                if appState.ageVerified {
                    Divider().background(KathaTheme.border)
                    Button { appState.resetAgeVerification() } label: {
                        settingRow(icon: "shield.lefthalf.filled", title: "Reset age verification", value: nil)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.l).fill(KathaTheme.surface))
        }
    }

    private var rewardsSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("Rewards")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textSecondary)

            VStack(spacing: 0) {
                Button {
                    Haptics.light()
                    appState.openStreakScreen()
                } label: {
                    settingRow(icon: "flame", title: "Your journey", value: "\(appState.currentStreak) day streak")
                }.buttonStyle(.plain)
                Divider().background(KathaTheme.border)
                Button {
                    Haptics.light()
                    appState.openInviteFriendsScreen()
                } label: {
                    settingRow(icon: "gift", title: "Invite friends", value: nil)
                }.buttonStyle(.plain)
                Divider().background(KathaTheme.border)
                // Dashboard row (above Credits)
                Button {
                    Haptics.light()
                    appState.openDashboard()
                } label: {
                    HStack {
                        Image(systemName: "chart.bar.xaxis")
                            .foregroundStyle(KathaTheme.accent)
                            .frame(width: 24)
                        Text("Your dashboard")
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                }
                .buttonStyle(.plain)

                Divider().background(KathaTheme.border)

                // Credits row
                Button {
                    Haptics.light()
                    appState.openCreditsScreen()
                } label: {
                    HStack {
                        Image(systemName: "credits")
                            .foregroundStyle(KathaTheme.accent)
                            .frame(width: 24)
                        Text("Credits")
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        Text("\(appState.credits)")
                            .font(KathaFont.BodyStrong)
                            .foregroundStyle(KathaTheme.accent)
                        Image(systemName: "chevron.right")
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                }
                .buttonStyle(.plain)

                Divider().background(KathaTheme.border)

                // Katha Premium row
                Button {
                    Haptics.light()
                    if appState.isPremium {
                        appState.openSubscriptionManagement()
                    } else {
                        appState.openSubscriptionPaywall()
                    }
                } label: {
                    HStack {
                        Image(systemName: "crown")
                            .foregroundStyle(appState.isPremium ? KathaTheme.premium : KathaTheme.textSecondary)
                            .frame(width: 24)
                        Text("Katha Premium")
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        Text(appState.isPremium ? "Active" : "Upgrade")
                            .font(KathaFont.Body)
                            .foregroundStyle(appState.isPremium ? KathaTheme.premium : KathaTheme.textTertiary)
                        Image(systemName: "chevron.right")
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
            )
        }
    }

    private var supportSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("Support")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textSecondary)

            VStack(spacing: 0) {
                Button {
                    Haptics.light()
                    if MFMailComposeViewController.canSendMail() {
                        showMailComposer = true
                    } else {
                        appState.showToast("No email app configured. Reach us at feedback@katha.ai")
                    }
                } label: {
                    HStack {
                        Image(systemName: "envelope")
                            .foregroundStyle(KathaTheme.textSecondary)
                            .frame(width: 24)
                        Text("Share feedback")
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
            )
        }
    }

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("About")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textSecondary)

            VStack(spacing: 0) {
                settingRow(icon: "info.circle", title: "Version", value: "1.0.0")
                    .onTapGesture {
                        appState.registerDevTap()
                    }
                Divider().background(KathaTheme.border)
                settingRow(icon: "doc.text", title: "Terms of Service", value: nil)
                Divider().background(KathaTheme.border)
                settingRow(icon: "lock.shield", title: "Privacy Policy", value: nil)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
            )
        }
    }

    private func settingRow(icon: String, title: String, value: String?) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(KathaTheme.textSecondary)
                .frame(width: 24)
            Text(title)
                .font(KathaFont.Body)
                .foregroundStyle(KathaTheme.textPrimary)
            Spacer()
            if let value {
                Text(value)
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.textTertiary)
            } else {
                Image(systemName: "chevron.right")
                    .font(KathaFont.Meta)
                    .foregroundStyle(KathaTheme.textTertiary)
            }
        }
        .padding(.vertical, KathaTheme.Spacing.m)
    }

    private var accountActions: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            DestructiveCTA(title: "Sign Out", icon: "arrow.right.square") {
                showSignOutConfirm = true
            }
            DestructiveCTA(title: "Delete Account", icon: "trash") {
                showDeleteConfirm1 = true
            }
        }
    }

    private var blockedUsersSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("Moderation")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textSecondary)

            VStack(spacing: 0) {
                Button {
                    Haptics.light()
                    appState.pushProfileRoute(.blockedUsers)
                } label: {
                    HStack {
                        Image(systemName: "hand.raised")
                            .foregroundStyle(KathaTheme.textSecondary)
                            .frame(width: 24)
                        Text("Blocked users")
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        Text("\(appState.blockedUserIds.count)")
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textTertiary)
                        Image(systemName: "chevron.right")
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
            )
        }
    }
}

import SwiftUI
import Combine

struct StreakHeroCard: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            ZStack {
                Circle().fill(KathaTheme.accentSoft).frame(width: 100, height: 100).blur(radius: 8)
                Image(systemName: "flame.fill").font(.system(size: 64)).foregroundStyle(KathaTheme.accent)
            }
            .scaleEffect(appState.currentStreak > 0 ? 1.04 : 1)
            .animation(.easeInOut(duration: 2).repeatForever(autoreverses: true), value: appState.currentStreak)
            Text("\(appState.streak.current)")
                .font(.system(size: 52, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
            Text("DAY STREAK")
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(KathaTheme.textTertiary)
            Text(appState.currentStreak == 0 ? "Start a small reading habit today" : "Keep it going — \(appState.streak.nextCreditIn) more days until your next credit")
                .font(.system(size: 15))
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)
            if appState.streak.freezesAvailable > 0 {
                Text("❄️ \(appState.streak.freezesAvailable) FREEZES THIS MONTH")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(KathaTheme.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(KathaTheme.accentSoft))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(32)
        .background(RoundedRectangle(cornerRadius: 20).fill(KathaTheme.surface))
        .kathaCardShadow()
    }
}

struct StreakCalendar: View {
    @Environment(AppState.self) private var appState
    @State private var selectedDay: StreakDay?
    private var days: [StreakDay] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return (0..<30).reversed().compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            return appState.streak.history.first(where: { calendar.isDate($0.date, inSameDayAs: date) }) ?? StreakDay(date: date, active: false, freezeUsed: false, summary: "No activity logged")
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("LAST 30 DAYS").font(.system(size: 11, weight: .semibold)).tracking(1).foregroundStyle(KathaTheme.textTertiary)
            VStack(spacing: KathaTheme.Spacing.m) {
                HStack {
                    ForEach(["S", "M", "T", "W", "T", "F", "S"], id: \.self) { day in
                        Text(day).font(.system(size: 10, weight: .semibold)).foregroundStyle(KathaTheme.textTertiary).frame(maxWidth: .infinity)
                    }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 7), spacing: 12) {
                    ForEach(days) { day in
                        Button { selectedDay = day; Haptics.light() } label: {
                            ZStack {
                                Circle().fill(day.active ? KathaTheme.accent : (day.freezeUsed ? Color.blue.opacity(0.65) : KathaTheme.canvas))
                                if day.active { Image(systemName: "flame.fill").font(.system(size: 11)).foregroundStyle(.white) }
                                if day.freezeUsed { Image(systemName: "snowflake").font(.system(size: 11)).foregroundStyle(.white) }
                            }
                            .frame(width: 32, height: 32)
                            .overlay(Circle().stroke(Calendar.current.isDateInToday(day.date) ? KathaTheme.accent : Color.clear, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
            .background(RoundedRectangle(cornerRadius: 16).fill(KathaTheme.surface).overlay(RoundedRectangle(cornerRadius: 16).stroke(KathaTheme.border)))
            if let selectedDay {
                Text("\(selectedDay.date.formatted(date: .abbreviated, time: .omitted)) · \(selectedDay.summary)")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .transition(.opacity)
            }
        }
    }
}

struct StreakScreen: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        VStack(spacing: 0) {
            Prompt12NavBar(title: "Your journey") { appState.closeStreakScreen() }
            ScrollView {
                VStack(spacing: KathaTheme.Spacing.xxl) {
                    StreakHeroCard()
                    StreakCalendar()
                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                        Text("MILESTONES").font(.system(size: 11, weight: .semibold)).tracking(1).foregroundStyle(KathaTheme.textTertiary)
                        let milestones: [(Int, String)] = [(3, "First 3-day streak"), (7, "One week straight"), (14, "Two weeks strong"), (30, "Month of stories"), (100, "100-day streak legend")]
                        VStack(spacing: 0) {
                            ForEach(milestones, id: \.0) { value, title in
                                HStack(spacing: KathaTheme.Spacing.m) {
                                    Image(systemName: appState.streak.longest >= value ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(appState.streak.longest >= value ? KathaTheme.success : KathaTheme.borderStrong)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary)
                                        Text("\(value) days").font(.system(size: 12)).foregroundStyle(KathaTheme.textSecondary)
                                    }
                                    Spacer()
                                }.padding(.vertical, 14)
                                if value != 100 { Divider().background(KathaTheme.border) }
                            }
                        }
                        .padding(.horizontal, KathaTheme.Spacing.l)
                        .background(RoundedRectangle(cornerRadius: 16).fill(KathaTheme.surface))
                    }
                    Text(appState.streak.current == appState.streak.longest && appState.streak.longest > 0 ? "Your longest streak — keep going ✨" : "Your longest streak: \(appState.streak.longest) days")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(KathaTheme.textTertiary)
                    SafeBottomSpacer()
                }.padding(.horizontal, KathaTheme.Spacing.l)
            }.scrollIndicators(.hidden)
        }.background(KathaTheme.canvas)
    }
}

struct NotificationsScreen: View {
    @Environment(AppState.self) private var appState
    private func toggle(_ title: String, _ key: String, _ value: Bool) -> some View {
        Toggle(isOn: Binding(get: { value }, set: { appState.setNotificationPreference(key, enabled: $0) })) {
            Text(title).font(.system(size: 15)).foregroundStyle(KathaTheme.textPrimary)
        }.tint(KathaTheme.accent).padding(.vertical, 13)
    }
    var body: some View {
        VStack(spacing: 0) {
            Prompt12NavBar(title: "Notifications") { appState.closeNotificationsScreen() }
            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.xl) {
                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                        Text("PERMISSION").sectionMeta()
                        HStack { Image(systemName: "bell.badge").foregroundStyle(KathaTheme.accent); Text("Push notifications").foregroundStyle(KathaTheme.textPrimary); Spacer(); Toggle("", isOn: Binding(get: { appState.notificationPermissionGranted }, set: { _ in appState.requestNotificationPermission() })).labelsHidden().tint(KathaTheme.accent) }
                        if !appState.notificationPermissionGranted { TextLink(title: "Open device settings") { appState.openSystemNotificationSettings() } }
                    }.settingsCard()
                    notificationSection("STORY ACTIVITY", rows: [
                        ("New chapters from stories you follow", "chapters", appState.notificationPreferences.storyNewChapters),
                        ("New stories from writers you follow", "stories", appState.notificationPreferences.storyNewStories),
                        ("Someone commented on your story", "comments", appState.notificationPreferences.storyComments),
                        ("Someone liked your story", "likes", appState.notificationPreferences.storyLikes)
                    ])
                    notificationSection("YOUR PROGRESS", rows: [
                        ("Streak reminders", "streak", appState.notificationPreferences.streakReminders),
                        ("Milestone celebrations", "milestones", appState.notificationPreferences.milestoneCelebrations),
                        ("Credits earned from your stories", "credits", appState.notificationPreferences.creditsEarned)
                    ])
                    notificationSection("RECOMMENDATIONS", rows: [
                        ("Weekly Katha's picks digest", "digest", appState.notificationPreferences.weeklyDigest),
                        ("New writers to follow", "writers", appState.notificationPreferences.newWriters)
                    ])
                    SafeBottomSpacer()
                }.padding(KathaTheme.Spacing.l)
            }.scrollIndicators(.hidden)
        }.background(KathaTheme.canvas)
    }
    private func notificationSection(_ title: String, rows: [(String, String, Bool)]) -> some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text(title).sectionMeta()
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    Toggle(isOn: Binding(get: { row.2 }, set: { appState.setNotificationPreference(row.1, enabled: $0) })) { Text(row.0).font(.system(size: 15)).foregroundStyle(KathaTheme.textPrimary) }.tint(KathaTheme.accent).padding(.vertical, 13)
                    if index < rows.count - 1 { Divider().background(KathaTheme.border) }
                }
            }.padding(.horizontal, KathaTheme.Spacing.l).background(RoundedRectangle(cornerRadius: 16).fill(KathaTheme.surface))
        }
    }
}

struct InviteFriendsScreen: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        VStack(spacing: 0) {
            Prompt12NavBar(title: "Invite friends") { appState.closeInviteFriendsScreen() }
            ScrollView {
                VStack(spacing: KathaTheme.Spacing.xxl) {
                    ZStack { Circle().fill(KathaTheme.accentSoft).frame(width: 140, height: 140).blur(radius: 10); Image(systemName: "gift.fill").font(.system(size: 76)).foregroundStyle(KathaTheme.accent) }
                    VStack(spacing: KathaTheme.Spacing.m) {
                        Text("Give friends a taste of Katha").font(.system(size: 28, weight: .bold)).foregroundStyle(KathaTheme.textPrimary).multilineTextAlignment(.center)
                        Text("You get **3 credits** when they generate their first story. They get **1 extra credit** on top of the welcome bonus.").font(.system(size: 15)).foregroundStyle(KathaTheme.textSecondary).multilineTextAlignment(.center)
                    }
                    HStack(spacing: KathaTheme.Spacing.s) {
                        Text(appState.referralLink).font(.system(size: 13)).foregroundStyle(KathaTheme.textPrimary).lineLimit(1).truncationMode(.middle)
                        Button("Copy") { appState.copyReferralLink() }.font(.system(size: 13, weight: .semibold)).foregroundStyle(KathaTheme.accent)
                    }.padding(12).background(RoundedRectangle(cornerRadius: 14).fill(KathaTheme.surface).overlay(RoundedRectangle(cornerRadius: 14).stroke(KathaTheme.border)))
                    PrimaryCTA(title: "Share your link", icon: "square.and.arrow.up") { appState.shareReferralLink() }
                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                        Text("YOUR REFERRALS").sectionMeta()
                        if appState.referralRecords.isEmpty { EmptyState(icon: "person.2", title: "No referrals yet", message: "Share your link to get started.") }
                        else { ForEach(appState.referralRecords) { referral in ReferralRow(referral: referral) } }
                    }
                    SafeBottomSpacer()
                }.padding(KathaTheme.Spacing.l)
            }.scrollIndicators(.hidden)
        }.background(KathaTheme.canvas)
    }
}

private struct ReferralRow: View {
    let referral: ReferralRecord
    var body: some View { HStack(spacing: 12) { GeneratedAvatar(username: referral.username, displayName: referral.displayName, size: 40); VStack(alignment: .leading) { Text(referral.displayName).font(.system(size: 14, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary); Text(referral.credited ? "Generated their first story · +3 credits earned" : "Joined \(referral.joinedAt.formatted(date: .abbreviated, time: .omitted))").font(.system(size: 12)).foregroundStyle(KathaTheme.textSecondary) }; Spacer(); Image(systemName: referral.credited ? "checkmark.circle.fill" : "hourglass").foregroundStyle(referral.credited ? KathaTheme.success : KathaTheme.textTertiary) }.padding(.vertical, 10) }
}

struct StorageScreen: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 0) {
            Prompt12NavBar(title: "Storage") { appState.closeStorageScreen() }
            if appState.offlineStoryRecords.isEmpty {
                EmptyState(icon: "icloud.slash", title: "No stories downloaded yet", message: "Tap the download icon in any story to save it for offline.")
                    .padding(.horizontal, KathaTheme.Spacing.l)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.xl) {
                        let audio = appState.offlineStoryRecords.reduce(0) { $0 + $1.sizeMB }
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                            Text("\(String(format: "%.1f", audio)) MB")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundStyle(KathaTheme.textPrimary)
                            ProgressView(value: min(1, audio / 100)).tint(KathaTheme.accent)
                            Text("Audio: \(String(format: "%.1f", audio)) MB").font(.system(size: 13)).foregroundStyle(KathaTheme.textSecondary)
                            Text("Images: 0 MB").font(.system(size: 13)).foregroundStyle(KathaTheme.textSecondary)
                        }
                        .padding(KathaTheme.Spacing.l)
                        .background(RoundedRectangle(cornerRadius: 16).fill(KathaTheme.surface))

                        Text("DOWNLOADED STORIES").sectionMeta()
                        ForEach(appState.offlineStoryRecords) { record in
                            HStack {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(KathaTheme.success)
                                Text(record.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary)
                                Spacer()
                                Text("\(String(format: "%.1f", record.sizeMB)) MB").font(.system(size: 12)).foregroundStyle(KathaTheme.textSecondary)
                                Button { appState.removeOfflineStory(record.storyId) } label: { Image(systemName: "trash").foregroundStyle(KathaTheme.error) }
                            }
                            .padding(.vertical, 12)
                        }
                        DestructiveCTA(title: "Clear all downloads", icon: "trash") { appState.clearOfflineStories() }
                        Text("Your bookmarks and history are preserved.")
                            .font(.system(size: 11))
                            .foregroundStyle(KathaTheme.textTertiary)
                            .frame(maxWidth: .infinity, alignment: .center)
                        SafeBottomSpacer()
                    }
                    .padding(KathaTheme.Spacing.l)
                }
            }
        }
        .background(KathaTheme.canvas)
    }
}

struct AudioPlayerSheet: View {
    @Environment(AppState.self) private var appState
    let story: Story
    @State private var showSpeedPicker = false
    @State private var showSleepPicker = false
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private var chapter: Chapter? { story.chapters[safe: appState.currentChapterIndex] ?? story.chapters.first }
    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.35).ignoresSafeArea()
            ScrollView { VStack(spacing: KathaTheme.Spacing.xl) {
                Capsule().fill(KathaTheme.textTertiary.opacity(0.5)).frame(width: 38, height: 4).padding(.top, 10)
                StoryCoverView(story: story, height: 240, titleSize: 20).frame(maxWidth: 300)
                Text(story.title).font(.system(size: 22, weight: .bold)).foregroundStyle(KathaTheme.textPrimary).lineLimit(1)
                Text("Chapter \(appState.currentChapterIndex + 1) · \(chapter?.title ?? "Story")").font(.system(size: 14)).foregroundStyle(KathaTheme.textSecondary)
                Slider(value: Binding(get: { appState.audioProgress }, set: { appState.seekAudio(to: $0) })).tint(KathaTheme.accent)
                HStack { Text(audioTime(appState.audioProgress)).font(.system(size: 11, weight: .semibold)).foregroundStyle(KathaTheme.textSecondary); Spacer(); Button(appState.audioShowingRemaining ? "-\(audioTime(1 - appState.audioProgress))" : "10:00") { appState.audioShowingRemaining.toggle() }.font(.system(size: 11, weight: .semibold)).foregroundStyle(KathaTheme.textSecondary) }
                HStack(spacing: 18) { playerButton("backward.end.fill", enabled: appState.currentChapterIndex > 0) { appState.navigateToPreviousChapter() }; playerButton("gobackward.15", enabled: true) { appState.skipAudio(seconds: -15) }; Button { appState.toggleAudioPlayback() } label: { Image(systemName: appState.audioIsPlaying ? "pause.fill" : "play.fill").font(.system(size: 24)).foregroundStyle(.white).frame(width: 64, height: 64).background(Circle().fill(KathaTheme.accent)) }; playerButton("goforward.30", enabled: true) { appState.skipAudio(seconds: 30) }; playerButton("forward.end.fill", enabled: appState.currentChapterIndex < story.chapters.count - 1) { appState.navigateToNextChapter() } }
                HStack(spacing: 10) { smallPill("\(String(format: "%.2g", appState.audioSpeed))x", "speed") { showSpeedPicker = true }; smallPill(appState.audioSleepTimerEnd.map { timerLabel($0) } ?? "Sleep", "moon.zzz") { showSleepPicker = true }; smallPill("Cast", "airplayaudio") { appState.showToast("Casting coming in the next update ✨") } }
                SecondaryCTA(title: "See chapters", icon: "list.bullet") { appState.showChapterList() }
                SafeBottomSpacer()
            }.padding(.horizontal, KathaTheme.Spacing.xl).padding(.bottom, 18) }.frame(maxWidth: .infinity).frame(maxHeight: UIScreen.main.bounds.height * 0.88).background(KathaTheme.surface).clipShape(.rect(topLeadingRadius: 24, topTrailingRadius: 24))
        }.onReceive(timer) { _ in appState.advanceAudio() }
        .confirmationDialog("Playback speed", isPresented: $showSpeedPicker) { ForEach([0.5, 0.75, 1, 1.25, 1.5, 2], id: \.self) { speed in Button("\(speed, specifier: "%.2g")x") { appState.setAudioSpeed(speed) } } }
        .confirmationDialog("Sleep timer", isPresented: $showSleepPicker) { Button("Off") { appState.setSleepTimer(.off) }; Button("End of chapter") { appState.setSleepTimer(.endOfChapter) }; ForEach([5, 10, 15, 30, 45, 60], id: \.self) { minutes in Button("\(minutes)m") { appState.setSleepTimer(.minutes(minutes)) } } }
    }
    private func playerButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View { Button(action: action) { Image(systemName: icon).font(.system(size: 17)).foregroundStyle(enabled ? KathaTheme.textPrimary : KathaTheme.textTertiary).frame(width: 40, height: 44) }.disabled(!enabled) }
    private func smallPill(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View { Button(action: action) { Label(title, systemImage: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary).padding(.horizontal, 11).frame(height: 36).background(Capsule().fill(KathaTheme.canvas)) } }
    private func audioTime(_ progress: Double) -> String { let seconds = Int(progress * 600); return String(format: "%02d:%02d", seconds / 60, seconds % 60) }
    private func timerLabel(_ date: Date) -> String { let seconds = max(0, Int(date.timeIntervalSinceNow)); return String(format: "%02d:%02d", seconds / 60, seconds % 60) }
}

struct PrePermissionModal: View {
    @Environment(AppState.self) private var appState
    var body: some View { ZStack { Color.black.opacity(0.35).ignoresSafeArea(); VStack(spacing: KathaTheme.Spacing.l) { Image(systemName: "bell.and.waves.left.and.right").font(.system(size: 42)).foregroundStyle(KathaTheme.accent); Text("Stay in the loop").font(.system(size: 24, weight: .bold)).foregroundStyle(KathaTheme.textPrimary); Text("Get notified when writers you follow publish, when your streak needs saving, and when your stories hit milestones.").font(.system(size: 14)).foregroundStyle(KathaTheme.textSecondary).multilineTextAlignment(.center); PrimaryCTA(title: "Enable notifications", icon: "bell") { appState.requestNotificationPermission() }; TextLink(title: "Not now") { appState.dismissPrePermission() } }.padding(KathaTheme.Spacing.xxl).frame(maxWidth: 360).background(RoundedRectangle(cornerRadius: 24).fill(KathaTheme.surface)).padding(KathaTheme.Spacing.xl) } }
}

struct StreakResetModal: View {
    @Environment(AppState.self) private var appState
    var body: some View { ZStack { Color.black.opacity(0.35).ignoresSafeArea(); VStack(spacing: KathaTheme.Spacing.l) { Image(systemName: "sunrise.fill").font(.system(size: 46)).foregroundStyle(KathaTheme.accent); Text("Your streak reset").font(.system(size: 24, weight: .bold)).foregroundStyle(KathaTheme.textPrimary); Text("Every writer starts fresh. Ready for a new one?").font(.system(size: 15)).foregroundStyle(KathaTheme.textSecondary).multilineTextAlignment(.center); PrimaryCTA(title: "Start a new streak", icon: "arrow.right") { appState.showStreakResetModal = false; appState.requestedTab = 0 }; TextLink(title: "Maybe later") { appState.showStreakResetModal = false } }.padding(KathaTheme.Spacing.xxl).frame(maxWidth: 340).background(RoundedRectangle(cornerRadius: 24).fill(KathaTheme.surface)).padding(KathaTheme.Spacing.xl) } }
}

struct DownloadProgressBanner: View {
    @Environment(AppState.self) private var appState
    var body: some View { if let progress = appState.downloadProgress { VStack(alignment: .leading, spacing: 5) { Text("Downloading \(appState.downloadStoryTitle)…").font(.system(size: 13, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary); ProgressView(value: progress).tint(KathaTheme.accent) }.padding(12).frame(maxWidth: .infinity).background(KathaTheme.surface).kathaCardShadow().transition(.move(edge: .top).combined(with: .opacity)) } }
}

struct Prompt12NavBar: View {
    let title: String
    let onBack: () -> Void
    var body: some View { HStack { Button(action: onBack) { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.foregroundStyle(KathaTheme.textPrimary); Text(title).font(.system(size: 22, weight: .bold)).foregroundStyle(KathaTheme.textPrimary); Spacer() }.padding(.horizontal, KathaTheme.Spacing.s).padding(.top, KathaTheme.Spacing.s) }
}

private extension View {
    func sectionMeta() -> some View { self.font(.system(size: 11, weight: .semibold)).tracking(1).foregroundStyle(KathaTheme.textTertiary) }
    func settingsCard() -> some View { self.padding(KathaTheme.Spacing.l).background(RoundedRectangle(cornerRadius: 16).fill(KathaTheme.surface)) }
}

private extension Collection {
    subscript(safe index: Index) -> Element? { indices.contains(index) ? self[index] : nil }
}

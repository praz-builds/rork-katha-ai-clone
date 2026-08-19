import Foundation
import StoreKit
import UIKit
import UserNotifications

extension AppState {
    var referralLink: String {
        let code = referralCode.isEmpty ? String((currentUser?.username ?? "writer").prefix(8)) : referralCode
        return "https://katha.ai/r/\(code)"
    }

    var downloadedStoryIds: Set<String> { Set(offlineStoryRecords.map(\.storyId)) }

    func recordStreakActivity(summary: String = "Story activity") {
        guard isAuthenticated else { return }
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        if let lastDate = streak.lastActivityDate {
            let lastDay = calendar.startOfDay(for: lastDate)
            let gap = calendar.dateComponents([.day], from: lastDay, to: today).day ?? 0
            if gap == 0 {
                updateTodayHistory(summary: summary)
                persistPrompt12State()
                return
            }
            if gap == 1 {
                streak.current += 1
            } else if gap == 2 && isPremium && streak.freezesAvailable > 0 {
                if let freezeDate = calendar.date(byAdding: .day, value: 1, to: lastDay) {
                    streak.history.append(StreakDay(date: freezeDate, active: false, freezeUsed: true, summary: "Streak freeze used"))
                }
                streak.freezesAvailable -= 1
                streak.current += 1
                showToast("Streak freeze used ❄️")
            } else {
                if streak.current > 0 { showStreakResetModal = true }
                streak.current = 1
            }
        } else {
            streak.current = 1
        }
        streak.longest = max(streak.longest, streak.current)
        streak.lastActivityDate = today
        streak.nextCreditIn = streak.current % 3 == 0 ? 3 : 3 - (streak.current % 3)
        updateTodayHistory(summary: summary)
        activeDayCount += 1
        if streak.current > 0 && streak.current % 3 == 0 {
            let reference = "streak-\(today.timeIntervalSince1970)"
            if !creditLedger.contains(where: { $0.referenceId == reference }) {
                addCredits(1, reason: .streak, referenceId: reference)
                showToast("3-day streak reward: +1 credit ✨")
            }
        }
        if [3, 7, 14, 30, 100].contains(streak.current) {
            showToast("\(streak.current)-day streak milestone ✨")
        }
        persistPrompt12State()
    }

    private func updateTodayHistory(summary: String) {
        let today = Calendar.current.startOfDay(for: Date())
        streak.history.removeAll { Calendar.current.isDate($0.date, inSameDayAs: today) }
        streak.history.append(StreakDay(date: today, active: true, freezeUsed: false, summary: summary))
        streak.history = Array(streak.history.sorted { $0.date > $1.date }.prefix(90))
    }

    func beginReaderStreakActivity() {
        guard isAuthenticated else { return }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard let self, !Task.isCancelled else { return }
            self.recordStreakActivity(summary: "Read a story")
        }
    }

    func openStreakScreen() { showStreakScreen = true; Haptics.light() }
    func closeStreakScreen() { showStreakScreen = false }
    func openNotificationsScreen() { showNotificationsScreen = true; Haptics.light() }
    func closeNotificationsScreen() { showNotificationsScreen = false }
    func openInviteFriendsScreen() {
        if referralCode.isEmpty { referralCode = String((currentUser?.username ?? UUID().uuidString).replacingOccurrences(of: "-", with: "").prefix(9)); persistPrompt12State() }
        showInviteFriendsScreen = true
        Haptics.light()
    }
    func closeInviteFriendsScreen() { showInviteFriendsScreen = false }
    func openStorageScreen() { showStorageScreen = true; Haptics.light() }
    func closeStorageScreen() { showStorageScreen = false }

    func copyReferralLink() {
        UIPasteboard.general.string = referralLink
        Haptics.light()
        showToast("Link copied ✨")
    }

    func setNotificationPreference(_ key: String, enabled: Bool) {
        switch key {
        case "chapters": notificationPreferences.storyNewChapters = enabled
        case "stories": notificationPreferences.storyNewStories = enabled
        case "comments": notificationPreferences.storyComments = enabled
        case "likes": notificationPreferences.storyLikes = enabled
        case "streak": notificationPreferences.streakReminders = enabled
        case "milestones": notificationPreferences.milestoneCelebrations = enabled
        case "credits": notificationPreferences.creditsEarned = enabled
        case "digest": notificationPreferences.weeklyDigest = enabled
        case "writers": notificationPreferences.newWriters = enabled
        default: break
        }
        persistPrompt12State()
    }

    func requestNotificationPermission() {
        Task { @MainActor in
            let center = UNUserNotificationCenter.current()
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                notificationPermissionGranted = granted
                persistPrompt12State()
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                    let token = "mock-device-token-\(UUID().uuidString)"
                    print("[Katha] Registered \(token)")
                    // TODO: Send device token to /register-device edge function for push targeting
                    showToast("Notifications enabled ✨")
                    scheduleStreakWarning()
                } else {
                    showToast("Notifications are off. You can enable them in Settings.")
                }
                showPrePermissionModal = false
            } catch {
                showToast("Notifications could not be enabled")
            }
        }
    }

    func openSystemNotificationSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    func scheduleStreakWarning() {
        guard notificationPreferences.streakReminders else { return }
        let content = UNMutableNotificationContent()
        content.title = "Your streak needs saving"
        content.body = "Read one story tonight to keep it alive 🔥"
        content.sound = .default
        var components = DateComponents()
        components.hour = 20
        components.minute = 0
        let request = UNNotificationRequest(identifier: "katha.streak.warning", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true))
        UNUserNotificationCenter.current().add(request)
    }

    func maybeShowPrePermission() {
        guard !notificationPermissionGranted, !defaultsBool("katha.notificationsDenied"), !showPrePermissionModal else { return }
        showPrePermissionModal = true
    }

    func dismissPrePermission() {
        showPrePermissionModal = false
        UserDefaults.standard.set(Date(), forKey: "katha.notificationsDeferred")
    }

    func handleDeepLink(_ url: URL) {
        let components = url.pathComponents.filter { $0 != "/" }
        guard let first = components.first else { return }
        if first == "r", components.count > 1 {
            referredByCode = components[1]
            persistPrompt12State()
        } else if first == "s", let storyId = components.dropFirst().first, let story = SeedData.stories.first(where: { $0.id == storyId }) {
            openReader(story: story, chapterIndex: 0)
        } else if first.hasPrefix("@") {
            openAuthorProfile(String(first.dropFirst()))
        }
    }

    private func defaultsBool(_ key: String) -> Bool { UserDefaults.standard.bool(forKey: key) }

    func downloadStory(_ story: Story) {
        guard !downloadedStoryIds.contains(story.id), downloadProgress == nil else { return }
        Haptics.light()
        downloadStoryTitle = story.title
        downloadProgress = 0
        Task { @MainActor [weak self] in
            guard let self else { return }
            let chapters = max(1, story.chapters.count)
            for index in 1...chapters {
                try? await Task.sleep(for: .milliseconds(180))
                downloadProgress = Double(index) / Double(chapters)
            }
            offlineStoryRecords.removeAll { $0.storyId == story.id }
            offlineStoryRecords.append(OfflineStoryRecord(storyId: story.id, title: story.title, sizeMB: Double(max(1, story.chapters.count)) * 1.8, downloadedAt: Date()))
            persistPrompt12State()
            downloadProgress = nil
            Haptics.success()
            showToast("Downloaded ✨ — now available offline")
        }
    }

    func removeOfflineStory(_ storyId: String) {
        offlineStoryRecords.removeAll { $0.storyId == storyId }
        persistPrompt12State()
        showToast("Removed from downloads")
    }

    func clearOfflineStories() {
        offlineStoryRecords = []
        persistPrompt12State()
        showToast("Downloads cleared")
    }

    func openAudioPlayer(story: Story) {
        guard audioState(for: story.id) == .ready else {
            showToast("Audio preparing — usually ready in 8–15 seconds")
            return
        }
        audioPlayerStoryId = story.id
        showAudioPlayer = true
        Haptics.light()
    }

    func closeAudioPlayer() { showAudioPlayer = false }
    func toggleAudioPlayback() { audioIsPlaying.toggle(); Haptics.light() }
    func seekAudio(to value: Double) { audioProgress = min(1, max(0, value)) }
    func skipAudio(seconds: Double) { audioProgress = min(1, max(0, audioProgress + seconds / 600)) }
    func setAudioSpeed(_ speed: Double) { audioSpeed = speed; Haptics.light() }
    func setSleepTimer(_ option: SleepTimerOption) {
        switch option {
        case .off: audioSleepTimerEnd = nil
        case .endOfChapter: audioSleepTimerEnd = Date().addingTimeInterval(600)
        case .minutes(let minutes): audioSleepTimerEnd = Date().addingTimeInterval(TimeInterval(minutes * 60))
        }
        Haptics.light()
    }
    func advanceAudio() {
        guard audioIsPlaying else { return }
        audioProgress = min(1, audioProgress + audioSpeed / 600)
        if let end = audioSleepTimerEnd, end <= Date() {
            audioSleepTimerEnd = nil
            audioIsPlaying = false
            Haptics.medium()
            showToast("Sleep timer ended")
        }
        if audioProgress >= 1 { audioIsPlaying = false }
    }

    func maybeRequestRating() {
        guard storyGenerationCount >= 3, activeDayCount >= 3 else { return }
        guard likedStoryIds.count >= 5 || userComments.count >= 2 || !storyShareOverrides.isEmpty else { return }
        if let last = ratePromptLastShown, Date().timeIntervalSince(last) < 90 * 24 * 3600 { return }
        ratePromptLastShown = Date()
        UserDefaults.standard.set(ratePromptLastShown, forKey: "katha.ratePromptLastShown")
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            SKStoreReviewController.requestReview()
        }
    }
}

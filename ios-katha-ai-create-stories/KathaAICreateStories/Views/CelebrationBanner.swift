//
//  CelebrationBanner.swift
//  KathaAICreateStories
//

import SwiftUI

struct CelebrationBanner: View {
    @Environment(AppState.self) private var appState

    @State private var sparkleScale: CGFloat = 1.0
    @State private var hasAppeared = false

    private var unseen: UnseenMilestone? {
        AnalyticsService.shared.currentUnseenMilestone
    }

    private var milestone: MilestoneKey? {
        guard let unseen else { return nil }
        return MilestoneKey(rawValue: unseen.milestoneKey)
    }

    var body: some View {
        if let unseen, let milestone {
            HStack(spacing: KathaTheme.Spacing.l) {
                // Sparkle illustration
                Image(systemName: "sparkles")
                    .font(.system(size: 32))
                    .foregroundStyle(KathaTheme.accent)
                    .scaleEffect(sparkleScale)
                    .frame(width: 40, height: 40)

                // Content
                VStack(alignment: .leading, spacing: 4) {
                    Text("MILESTONE ✨")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(KathaTheme.accent)

                    Text(milestone.celebrationTitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .lineLimit(2)

                    Text(milestone.celebrationSubtitle(storyTitle: unseen.storyTitle))
                        .font(.system(size: 12))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                // Action buttons
                VStack(spacing: KathaTheme.Spacing.s) {
                    Button {
                        Haptics.light()
                        dismissCurrent()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(KathaTheme.textTertiary)
                            .frame(width: 28, height: 28)
                    }

                    Button {
                        Haptics.medium()
                        navigateToAnalytics(storyId: unseen.storyId)
                    } label: {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(KathaTheme.accent)
                            .frame(width: 28, height: 28)
                    }
                }
            }
            .padding(KathaTheme.Spacing.xl)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(
                        LinearGradient(
                            colors: [KathaTheme.accentSoft, KathaTheme.accentSoft.opacity(0.3)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                            .stroke(KathaTheme.accent.opacity(0.5), lineWidth: 1.5)
                    )
            )
            .padding(.horizontal, KathaTheme.Spacing.m)
            .padding(.top, KathaTheme.Spacing.m)
            .transition(.move(edge: .top).combined(with: .opacity))
            .onAppear {
                if !hasAppeared {
                    hasAppeared = true
                    Haptics.success()
                    startSparkleAnimation()
                    scheduleAutoDismiss()
                }
            }
        }
    }

    private func startSparkleAnimation() {
        withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
            sparkleScale = 1.15
        }
    }

    private func scheduleAutoDismiss() {
        Task { [weak appState] in
            try? await Task.sleep(for: .seconds(30))
            guard appState != nil else { return }
            await MainActor.run {
                dismissCurrent()
            }
        }
    }

    private func dismissCurrent() {
        withAnimation(.spring(duration: 0.25)) {
            AnalyticsService.shared.dismissCurrentMilestone()
        }
    }

    private func navigateToAnalytics(storyId: String) {
        dismissCurrent()
        if let story = SeedData.stories.first(where: { $0.id == storyId }) {
            appState.openStoryAnalytics(story: story)
        }
    }
}

// MARK: - Reader Earning Toast

struct ReaderEarningToast: View {
    let credits: Int
    let storyTitle: String
    let storyId: String
    let onView: () -> Void

    @State private var sparkleRotation: Double = 0

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            ZStack {
                Image(systemName: "credits")
                    .font(.system(size: 20))
                    .foregroundStyle(KathaTheme.accent)
                Image(systemName: "sparkle")
                    .font(.system(size: 8))
                    .foregroundStyle(KathaTheme.accent)
                    .rotationEffect(.degrees(sparkleRotation))
                    .offset(x: 8, y: -8)
            }
            .frame(width: 28, height: 28)

            Text("+\(credits) credit\(credits > 1 ? "s" : "") from '\(storyTitle)'")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(1)

            Spacer()

            Button {
                Haptics.light()
                onView()
            } label: {
                Text("View")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KathaTheme.accent)
            }
        }
        .padding(KathaTheme.Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                .fill(KathaTheme.surfaceElevated)
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        )
        .padding(.horizontal, KathaTheme.Spacing.m)
        .onAppear {
            withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
                sparkleRotation = 360
            }
        }
    }
}

// MARK: - Dev Tools Sheet

struct DevToolsSheet: View {
    @Environment(AppState.self) private var appState
    @Binding var isPresented: Bool

    @State private var showMilestonePicker = false

    var body: some View {
        VStack(spacing: 0) {
            // Drag handle
            Capsule()
                .fill(KathaTheme.border)
                .frame(width: 36, height: 4)
                .padding(.top, KathaTheme.Spacing.m)
                .padding(.bottom, KathaTheme.Spacing.l)

            Text("Dev tools")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .padding(.bottom, KathaTheme.Spacing.l)

            VStack(spacing: 0) {
                devRow(icon: "flag.checkered", title: "Trigger milestone celebration") {
                    showMilestonePicker = true
                }

                Divider().background(KathaTheme.border)

                devRow(icon: "credits", title: "Trigger reader-earning toast") {
                    triggerReaderEarningToast()
                }

                Divider().background(KathaTheme.border)

                devRow(icon: "arrow.counterclockwise", title: "Reset all milestones") {
                    AnalyticsService.shared.resetAllMilestones()
                    appState.showToast("Milestones reset")
                }

                Divider().background(KathaTheme.border)

                devRow(icon: "trash", title: "Reset all analytics") {
                    AnalyticsService.shared.resetAllAnalytics()
                    appState.showToast("Analytics reset")
                }

                Divider().background(KathaTheme.border)

                devRow(icon: "xmark", title: "Close") {
                    isPresented = false
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)

            SafeBottomSpacer(height: 40)
        }
        .background(KathaTheme.surface)
        .sheet(isPresented: $showMilestonePicker) {
            MilestonePickerSheet { milestone in
                showMilestonePicker = false
                let storyTitle = "Late Trains and Longer Nights"
                let storyId = SeedData.stories.first(where: { $0.authorId == "aarav" })?.id ?? ""
                AnalyticsService.shared.triggerMilestoneCelebration(
                    milestone: milestone,
                    storyId: storyId,
                    storyTitle: storyTitle
                )
                isPresented = false
                appState.requestedTab = 0
                appState.showToast("Milestone queued — go to Home")
            }
        }
    }

    private func devRow(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            HStack(spacing: KathaTheme.Spacing.m) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .frame(width: 24)
                Text(title)
                    .font(.system(size: 15))
                    .foregroundStyle(KathaTheme.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textTertiary)
            }
            .frame(minHeight: 48)
            .padding(.vertical, KathaTheme.Spacing.s)
        }
        .buttonStyle(.plain)
    }

    private func triggerReaderEarningToast() {
        let storyTitle = "Late Trains and Longer Nights"
        let storyId = SeedData.stories.first(where: { $0.authorId == "aarav" })?.id ?? ""
        appState.showReaderEarningToast(credits: 1, storyTitle: storyTitle, storyId: storyId)
        isPresented = false
    }
}

// MARK: - Milestone Picker Sheet

struct MilestonePickerSheet: View {
    let onSelect: (MilestoneKey) -> Void

    var body: some View {
        NavigationStack {
            List(MilestoneKey.allCases) { milestone in
                Button {
                    onSelect(milestone)
                } label: {
                    HStack(spacing: KathaTheme.Spacing.m) {
                        Image(systemName: milestone.icon)
                            .foregroundStyle(KathaTheme.accent)
                        Text(milestone.label)
                            .foregroundStyle(KathaTheme.textPrimary)
                    }
                }
            }
            .navigationTitle("Select milestone")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

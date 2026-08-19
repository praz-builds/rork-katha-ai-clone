//
//  AuthorDashboardScreen.swift
//  KathaAICreateStories
//

import SwiftUI
import Charts

struct AuthorDashboardScreen: View {
    @Environment(AppState.self) private var appState

    @State private var isLoading = true
    @State private var timeRange: AnalyticsTimeRange = .thirtyDays
    @State private var sortMetric: MilestoneSortMetric = .reads

    private var ownStories: [String] {
        let publishedIds = appState.publishedStories.filter { $0.isPublished }.map { $0.id }
        let currentUserAuthorId = appState.currentUser?.username
        let seedStoryIds = SeedData.stories.filter { $0.authorId == currentUserAuthorId }.map { $0.id }
        return publishedIds + seedStoryIds
    }

    private var totalReads: Int {
        AnalyticsService.shared.totalReadsAcrossCatalog(storyIds: ownStories, range: timeRange)
    }

    private var totalCredits: Int {
        AnalyticsService.shared.totalCreditsAcrossCatalog(storyIds: ownStories)
    }

    private var followersGained: Int {
        appState.currentUser?.followers ?? 0
    }

    private var storiesPublished: Int {
        ownStories.count
    }

    private var aggregatedReads: [DailyReads] {
        AnalyticsService.shared.aggregatedDailyReads(storyIds: ownStories, range: timeRange)
    }

    private var topStoryIds: [String] {
        AnalyticsService.shared.topStories(storyIds: ownStories, sortBy: sortMetric, limit: 5)
    }

    private var recentMilestones: [(milestone: MilestoneKey, storyId: String, storyTitle: String, timestamp: Date)] {
        AnalyticsService.shared.recentMilestones(limit: 5)
    }

    var body: some View {
        ZStack(alignment: .top) {
            KathaTheme.canvas.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Color.clear.frame(height: 56)

                    if isLoading {
                        loadingContent
                    } else if ownStories.isEmpty {
                        DashboardEmptyState {
                            appState.closeDashboard()
                            appState.requestedTab = 1
                        }
                    } else {
                        contentSection
                    }

                    SafeBottomSpacer()
                }
            }
            .scrollIndicators(.hidden)

            navBar
        }
        .onAppear {
            timeRange = AnalyticsService.shared.timeRange
            Task {
                try? await Task.sleep(for: .milliseconds(400))
                withAnimation(.easeInOut(duration: 0.25)) {
                    isLoading = false
                }
            }
        }
    }

    // MARK: - Nav Bar

    private var navBar: some View {
        HStack {
            Button {
                Haptics.light()
                appState.closeDashboard()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            Text("Your dashboard")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)

            Spacer()

            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, KathaTheme.Spacing.s)
        .frame(height: 56)
        .background(KathaTheme.canvas.opacity(0.95))
    }

    // MARK: - Content

    private var contentSection: some View {
        VStack(spacing: KathaTheme.Spacing.xxl) {
            TimeRangeSelector()
                .padding(.horizontal, KathaTheme.Spacing.xl)
                .padding(.top, KathaTheme.Spacing.xl)

            statCardsGrid
                .padding(.horizontal, KathaTheme.Spacing.xl)

            readsTrendSection
                .padding(.horizontal, KathaTheme.Spacing.xl)

            topStoriesSection
                .padding(.horizontal, KathaTheme.Spacing.xl)

            followerGrowthSection
                .padding(.horizontal, KathaTheme.Spacing.xl)

            recentMilestonesSection
                .padding(.horizontal, KathaTheme.Spacing.xl)
        }
        .animation(.easeInOut(duration: 0.2), value: appState.analyticsTimeRangeTrigger)
    }

    // MARK: - Stat Cards

    private var statCardsGrid: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: KathaTheme.Spacing.m),
                GridItem(.flexible(), spacing: KathaTheme.Spacing.m)
            ],
            spacing: KathaTheme.Spacing.m
        ) {
            StatCard(label: "TOTAL READS", value: totalReads, trend: nil)
            StatCard(label: "CREDITS EARNED", value: totalCredits, trend: nil, showCoinIcon: true)
            StatCard(label: "FOLLOWERS GAINED", value: followersGained, trend: nil)
            StatCard(label: "STORIES PUBLISHED", value: storiesPublished, trend: nil)
        }
    }

    // MARK: - Reads Trend

    private var readsTrendSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnalyticsSectionLabel(title: "READS OVER TIME")

            VStack(alignment: .leading, spacing: 0) {
                ReadsLineChart(data: aggregatedReads, range: timeRange)
            }
            .padding(KathaTheme.Spacing.xl)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                            .stroke(KathaTheme.border, lineWidth: 1)
                    )
            )
        }
    }

    // MARK: - Top Stories

    private var topStoriesSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            HStack {
                AnalyticsSectionLabel(title: "TOP STORIES")
                Spacer()
                HStack(spacing: KathaTheme.Spacing.s) {
                    ForEach(MilestoneSortMetric.allCases) { metric in
                        FilterChip(
                            title: metric.label,
                            isSelected: sortMetric == metric
                        ) {
                            Haptics.light()
                            withAnimation(.easeInOut(duration: 0.2)) {
                                sortMetric = metric
                            }
                        }
                    }
                }
            }

            VStack(spacing: KathaTheme.Spacing.m) {
                ForEach(topStoryIds, id: \.self) { storyId in
                    if let story = SeedData.stories.first(where: { $0.id == storyId }) {
                        topStoryRow(story: story, storyId: storyId)
                    } else if let genStory = appState.publishedStories.first(where: { $0.id == storyId }) {
                        topStoryRow(story: genStory.asStory, storyId: storyId)
                    }
                }
            }
        }
    }

    private func topStoryRow(story: Story, storyId: String) -> some View {
        let metricValue: Int = {
            switch sortMetric {
            case .reads: return AnalyticsService.shared.totalReads(for: storyId, range: .allTime)
            case .credits: return AnalyticsService.shared.analytics(for: storyId)?.creditsEarnedFromReads ?? 0
            case .followers: return AnalyticsService.shared.analytics(for: storyId)?.followersGainedFromStory ?? 0
            }
        }()

        return Button {
            Haptics.light()
            appState.openStoryAnalytics(story: story)
        } label: {
            HStack(spacing: KathaTheme.Spacing.m) {
                LinearGradient(
                    colors: story.coverColors,
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .frame(width: 48, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 6))

                VStack(alignment: .leading, spacing: 2) {
                    Text(story.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .lineLimit(1)
                    Text(story.genre.displayName)
                        .font(.system(size: 11))
                        .foregroundStyle(KathaTheme.textSecondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text(formatCount(metricValue))
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(KathaTheme.accent)
                    Text(sortMetric.label.replacingOccurrences(of: "By ", with: ""))
                        .font(.system(size: 10))
                        .foregroundStyle(KathaTheme.textTertiary)
                }
            }
            .padding(KathaTheme.Spacing.m)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                    .fill(KathaTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                            .stroke(KathaTheme.border, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Follower Growth

    private var followerGrowthSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnalyticsSectionLabel(title: "FOLLOWER GROWTH")

            VStack(alignment: .leading, spacing: 0) {
                followerGrowthChart
            }
            .padding(KathaTheme.Spacing.xl)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                            .stroke(KathaTheme.border, lineWidth: 1)
                    )
            )
        }
    }

    private var followerGrowthChart: some View {
        let dayCount = timeRange.dayCount ?? 90
        let cal = Calendar.current
        let now = Date()
        let currentFollowers = appState.currentUser?.followers ?? 0
        let startFollowers = max(0, currentFollowers - dayCount / 3)

        let data: [(date: Date, count: Int)] = (0..<dayCount).map { offset in
            let date = cal.date(byAdding: .day, value: -(dayCount - 1 - offset), to: now)!
            let progress = Double(offset) / Double(max(1, dayCount - 1))
            let count = Int(Double(startFollowers) + Double(currentFollowers - startFollowers) * progress)
            return (date, count)
        }

        return Chart(data, id: \.date) { entry in
            LineMark(
                x: .value("Date", entry.date, unit: .day),
                y: .value("Followers", entry.count)
            )
            .foregroundStyle(KathaTheme.accent)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .interpolationMethod(.catmullRom)

            AreaMark(
                x: .value("Date", entry.date, unit: .day),
                y: .value("Followers", entry.count)
            )
            .foregroundStyle(
                LinearGradient(
                    colors: [KathaTheme.accent.opacity(0.15), KathaTheme.accent.opacity(0)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .interpolationMethod(.catmullRom)
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .weekOfMonth)) { _ in
                AxisValueLabel(format: .dateTime.day().month())
                    .font(.system(size: 10))
                    .foregroundStyle(KathaTheme.textTertiary)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                    .foregroundStyle(KathaTheme.border)
            }
        }
        .frame(height: 160)
    }

    // MARK: - Recent Milestones

    private var recentMilestonesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnalyticsSectionLabel(title: "RECENT MILESTONES")

            if recentMilestones.isEmpty {
                VStack(spacing: KathaTheme.Spacing.s) {
                    Image(systemName: "flag")
                        .font(.system(size: 32))
                        .foregroundStyle(KathaTheme.textTertiary)
                    Text("No milestones crossed yet")
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(KathaTheme.Spacing.xl)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                        .fill(KathaTheme.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                                .stroke(KathaTheme.border, lineWidth: 1)
                        )
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(recentMilestones.enumerated()), id: \.offset) { index, item in
                        Button {
                            Haptics.light()
                            if let story = SeedData.stories.first(where: { $0.id == item.storyId }) {
                                appState.openStoryAnalytics(story: story)
                            }
                        } label: {
                            HStack(spacing: KathaTheme.Spacing.m) {
                                Image(systemName: item.milestone.icon)
                                    .font(.system(size: 18))
                                    .foregroundStyle(KathaTheme.accent)
                                    .frame(width: 24)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.milestone.label)
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(KathaTheme.textPrimary)
                                    Text(item.storyTitle.isEmpty ? "Your story" : item.storyTitle)
                                        .font(.system(size: 12))
                                        .foregroundStyle(KathaTheme.textSecondary)
                                }

                                Spacer()

                                Text(timeAgo(0))
                                    .font(.system(size: 11))
                                    .foregroundStyle(KathaTheme.textTertiary)
                            }
                            .frame(minHeight: 48)
                            .padding(.vertical, KathaTheme.Spacing.s)
                        }
                        .buttonStyle(.plain)

                        if index < recentMilestones.count - 1 {
                            Divider().background(KathaTheme.border)
                        }
                    }
                }
                .padding(KathaTheme.Spacing.l)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                        .fill(KathaTheme.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                                .stroke(KathaTheme.border, lineWidth: 1)
                        )
                )
            }
        }
    }

    // MARK: - Loading

    private var loadingContent: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            ForEach(0..<4, id: \.self) { _ in
                Skeleton(height: 108, cornerRadius: 14)
            }
            Skeleton(height: 200, cornerRadius: 16)
        }
        .padding(.horizontal, KathaTheme.Spacing.xl)
        .padding(.top, KathaTheme.Spacing.xxl)
    }
}

//
//  StoryAnalyticsScreen.swift
//  KathaAICreateStories
//

import SwiftUI

struct StoryAnalyticsScreen: View {
    @Environment(AppState.self) private var appState
    let story: Story

    @State private var isLoading = true
    @State private var timeRange: AnalyticsTimeRange = .thirtyDays

    private var analytics: StoryAnalytics? {
        AnalyticsService.shared.analytics(for: story.id)
    }

    private var totalReadsInRange: Int {
        AnalyticsService.shared.totalReads(for: story.id, range: timeRange)
    }

    private var previousPeriodReads: Int {
        AnalyticsService.shared.previousPeriodReads(for: story.id, range: timeRange)
    }

    private var creditsEarned: Int {
        analytics?.creditsEarnedFromReads ?? 0
    }

    private var storyFollowers: Int {
        appState.storyFollowerCount(storyId: story.id, baseCount: story.followerCount)
    }

    private var totalReads: Int {
        story.views
    }

    private var likes: Int {
        appState.storyLikeCount(storyId: story.id, baseCount: story.likes)
    }

    private var shares: Int {
        appState.storyShareCount(storyId: story.id, baseCount: 0)
    }

    private var bookmarks: Int {
        story.bookmarks + (appState.isBookmarked(story.id) ? 1 : 0)
    }

    private var commentCount: Int {
        appState.commentCount(storyId: story.id)
    }

    private var authorFollowers: Int {
        if let author = SeedData.author(id: story.authorId) {
            return appState.authorFollowerCount(authorId: author.id, baseCount: author.followers)
        }
        return appState.currentUser?.followers ?? 0
    }

    private var isEmptyState: Bool {
        totalReads < 3 && story.publishedOffset == 0
    }

    var body: some View {
        ZStack(alignment: .top) {
            KathaTheme.canvas.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Color.clear.frame(height: 56)

                    if isLoading {
                        loadingContent
                    } else if isEmptyState {
                        AnalyticsEmptyState {
                            appState.shareStory(story: story)
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
                appState.closeAnalytics()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            Text("Analytics")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)

            Spacer()

            Button {
                Haptics.light()
                appState.showToast("Sharing analytics coming in a future update ✨")
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.s)
        .frame(height: 56)
        .background(KathaTheme.canvas.opacity(0.95))
    }

    // MARK: - Content

    private var contentSection: some View {
        VStack(spacing: KathaTheme.Spacing.xxl) {
            storyContextCard
                .padding(.horizontal, KathaTheme.Spacing.xl)
                .padding(.top, KathaTheme.Spacing.xl)

            TimeRangeSelector()
                .padding(.horizontal, KathaTheme.Spacing.xl)

            statCardsGrid
                .padding(.horizontal, KathaTheme.Spacing.xl)

            readsChartSection
                .padding(.horizontal, KathaTheme.Spacing.xl)

            if story.isSeries, let chapterReads = analytics?.chapterReads, !chapterReads.isEmpty {
                chapterBreakdownSection
                    .padding(.horizontal, KathaTheme.Spacing.xl)
            }

            milestonesSection
                .padding(.horizontal, KathaTheme.Spacing.xl)

            engagementSection
                .padding(.horizontal, KathaTheme.Spacing.xl)
        }
        .animation(.easeInOut(duration: 0.2), value: appState.analyticsTimeRangeTrigger)
    }

    // MARK: - Story Context Card

    private var storyContextCard: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            // Cover thumbnail
            LinearGradient(
                colors: story.coverColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .frame(width: 56, height: 84)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                Text(story.title)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .lineLimit(1)

                HStack(spacing: KathaTheme.Spacing.s) {
                    Text(story.genre.displayName)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(KathaTheme.accentSoft.opacity(0.5)))

                    Text("EN")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(KathaTheme.border.opacity(0.3)))
                }

                Text("Published \(timeAgo(story.publishedOffset)) · \(story.chapters.count) chapter\(story.chapters.count > 1 ? "s" : "")")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
            }

            Spacer()
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

    // MARK: - Stat Cards

    private var statCardsGrid: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: KathaTheme.Spacing.m),
                GridItem(.flexible(), spacing: KathaTheme.Spacing.m)
            ],
            spacing: KathaTheme.Spacing.m
        ) {
            StatCard(
                label: "READS",
                value: totalReadsInRange,
                trend: StatTrend(delta: totalReadsInRange - previousPeriodReads, isPositive: totalReadsInRange >= previousPeriodReads)
            )
            StatCard(
                label: "LIKES",
                value: likes,
                trend: nil
            )
            StatCard(
                label: "FOLLOWERS",
                value: storyFollowers,
                trend: nil
            )
            StatCard(
                label: "CREDITS EARNED",
                value: creditsEarned,
                trend: nil,
                showCoinIcon: true
            )
        }
    }

    // MARK: - Reads Chart

    private var readsChartSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnalyticsSectionLabel(title: "READS OVER TIME")

            VStack(alignment: .leading, spacing: 0) {
                ReadsLineChart(
                    data: AnalyticsService.shared.dailyReads(for: story.id, range: timeRange),
                    range: timeRange
                )
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

    // MARK: - Chapter Breakdown

    private var chapterBreakdownSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnalyticsSectionLabel(title: "READS BY CHAPTER")

            VStack(alignment: .leading, spacing: 0) {
                if let chapterReads = analytics?.chapterReads {
                    ChapterBarChart(
                        chapters: chapterReads,
                        story: story,
                        onTapChapter: { index in
                            appState.openReader(story: story, chapterIndex: index)
                        }
                    )
                }
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

    // MARK: - Milestones

    private var milestonesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnalyticsSectionLabel(title: "MILESTONES")

            if let analytics {
                MilestonePanel(
                    analytics: analytics,
                    totalReads: totalReads,
                    storyFollowers: storyFollowers,
                    creditsEarned: creditsEarned,
                    isPublished: true,
                    authorFollowers: authorFollowers
                )
            }
        }
    }

    // MARK: - Engagement

    private var engagementSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnalyticsSectionLabel(title: "ENGAGEMENT")

            AnalyticsEngagementPanel(
                story: story,
                commentCount: commentCount,
                shareCount: shares,
                bookmarkCount: bookmarks,
                totalReads: totalReads,
                onViewComments: {
                    appState.openCommentsSheet(storyId: story.id, chapterId: story.chapters.first?.id)
                }
            )
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

//
//  AnalyticsComponents.swift
//  KathaAICreateStories
//

import SwiftUI
import Charts

// MARK: - Time Range Selector

struct TimeRangeSelector: View {
    @Environment(AppState.self) private var appState

    private var currentRange: AnalyticsTimeRange {
        AnalyticsService.shared.timeRange
    }

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.s) {
            ForEach(AnalyticsTimeRange.allCases) { range in
                FilterChip(
                    title: range.label,
                    isSelected: currentRange == range
                ) {
                    Haptics.light()
                    AnalyticsService.shared.setTimeRange(range)
                    appState.analyticsTimeRangeTrigger += 1
                }
            }
            Spacer()
        }
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let label: String
    let value: Int
    let trend: StatTrend?
    var showCoinIcon: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            HStack {
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(KathaTheme.textTertiary)
                Spacer()
                if showCoinIcon {
                    Image(systemName: "credits")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.accent)
                }
            }

            Text(formatCount(value))
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .contentTransition(.numericText())
                .animation(.easeInOut(duration: 0.3), value: value)

            if let trend {
                Text(trend.label)
                    .font(.system(size: 11))
                    .foregroundStyle(
                        trend.delta > 0 ? KathaTheme.success :
                        trend.delta < 0 ? KathaTheme.error : KathaTheme.textSecondary
                    )
            }
        }
        .padding(KathaTheme.Spacing.l)
        .frame(maxWidth: .infinity, minHeight: 108, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(KathaTheme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
        )
    }
}

// MARK: - Reads Line Chart

struct ReadsLineChart: View {
    let data: [DailyReads]
    let range: AnalyticsTimeRange

    @State private var selectedElement: DailyReads? = nil
    @State private var tapLocation: CGPoint = .zero

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if data.isEmpty {
                emptyChart
            } else {
                Chart(data) { entry in
                    LineMark(
                        x: .value("Date", entry.date, unit: .day),
                        y: .value("Reads", entry.reads)
                    )
                    .foregroundStyle(KathaTheme.accent)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.catmullRom)

                    AreaMark(
                        x: .value("Date", entry.date, unit: .day),
                        y: .value("Reads", entry.reads)
                    )
                    .foregroundStyle(
                        LinearGradient(
                            colors: [KathaTheme.accent.opacity(0.15), KathaTheme.accent.opacity(0)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .interpolationMethod(.catmullRom)

                    if let selected = selectedElement, selected.dateISO == entry.dateISO {
                        PointMark(
                            x: .value("Date", entry.date, unit: .day),
                            y: .value("Reads", entry.reads)
                        )
                        .foregroundStyle(KathaTheme.accent)
                        .annotation(position: .top, spacing: 8) {
                            tooltipView(for: selected)
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day)) { _ in
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
        }
    }

    private var emptyChart: some View {
        VStack(spacing: KathaTheme.Spacing.s) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 32))
                .foregroundStyle(KathaTheme.textTertiary)
            Text("No reads data yet")
                .font(.system(size: 13))
                .foregroundStyle(KathaTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }

    private func tooltipView(for entry: DailyReads) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(AnalyticsDateFormatter.displayFormatter.string(from: entry.date))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(KathaTheme.textSecondary)
            Text("\(entry.reads) reads")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(KathaTheme.surfaceElevated)
                .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
        )
    }
}

// MARK: - Chapter Bar Chart

struct ChapterBarChart: View {
    let chapters: [ChapterReads]
    let story: Story
    let onTapChapter: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            ForEach(Array(chapters.enumerated()), id: \.element.chapterId) { index, chapterReads in
                let maxReads = chapters.map { $0.reads }.max() ?? 1
                let ratio = maxReads > 0 ? CGFloat(chapterReads.reads) / CGFloat(maxReads) : 0

                HStack(spacing: KathaTheme.Spacing.m) {
                    Text("Ch. \(index + 1)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .frame(width: 40, alignment: .leading)

                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 6)
                                .fill(KathaTheme.border.opacity(0.3))
                            RoundedRectangle(cornerRadius: 6)
                                .fill(KathaTheme.accent)
                                .frame(width: geo.size.width * ratio)
                        }
                    }
                    .frame(height: 32)

                    Text(formatCount(chapterReads.reads))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .frame(width: 44, alignment: .trailing)
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    Haptics.light()
                    onTapChapter(index)
                }
            }
        }
    }
}

// MARK: - Milestone Panel

struct MilestonePanel: View {
    let analytics: StoryAnalytics
    let totalReads: Int
    let storyFollowers: Int
    let creditsEarned: Int
    let isPublished: Bool
    let authorFollowers: Int

    @State private var showAll = false

    private var visibleMilestones: [MilestoneKey] {
        showAll ? MilestoneKey.allCases : Array(MilestoneKey.allCases.prefix(6))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(visibleMilestones) { milestone in
                MilestoneRow(
                    milestone: milestone,
                    isCrossed: analytics.milestonesCrossed.contains(milestone.rawValue)
                )
                if milestone != visibleMilestones.last {
                    Divider().background(KathaTheme.border)
                }
            }

            if MilestoneKey.allCases.count > 6 && !showAll {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showAll = true
                    }
                } label: {
                    Text("See all milestones")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(KathaTheme.accent)
                }
                .padding(.top, KathaTheme.Spacing.m)
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

// MARK: - Milestone Row

struct MilestoneRow: View {
    let milestone: MilestoneKey
    let isCrossed: Bool

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: milestone.icon)
                .font(.system(size: 18))
                .foregroundStyle(isCrossed ? KathaTheme.accent : KathaTheme.textTertiary)
                .frame(width: 24)

            Text(milestone.label)
                .font(.system(size: 14, weight: isCrossed ? .semibold : .regular))
                .foregroundStyle(isCrossed ? KathaTheme.textPrimary : KathaTheme.textSecondary)

            Spacer()

            if isCrossed {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(KathaTheme.success)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, KathaTheme.Spacing.s)
        .animation(.easeInOut(duration: 0.2), value: isCrossed)
    }
}

// MARK: - Engagement Panel

struct AnalyticsEngagementPanel: View {
    let story: Story
    let commentCount: Int
    let shareCount: Int
    let bookmarkCount: Int
    let totalReads: Int
    let onViewComments: () -> Void

    private var saveRate: String {
        guard totalReads > 0 else { return "0%" }
        let rate = Int(round(Double(bookmarkCount) / Double(totalReads) * 100))
        return "\(rate)%"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: KathaTheme.Spacing.m) {
                Image(systemName: "bubble.left")
                    .font(.system(size: 16))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .frame(width: 24)
                Text("Comments")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                Spacer()
                Text(formatCount(commentCount))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                TextLink(title: "View all comments →") {
                    onViewComments()
                }
            }
            .frame(minHeight: 56)
            .padding(.vertical, KathaTheme.Spacing.s)

            Divider().background(KathaTheme.border)

            HStack(spacing: KathaTheme.Spacing.m) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 16))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .frame(width: 24)
                Text("Shares")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                Spacer()
                Text(formatCount(shareCount))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
            }
            .frame(minHeight: 56)
            .padding(.vertical, KathaTheme.Spacing.s)

            Divider().background(KathaTheme.border)

            HStack(spacing: KathaTheme.Spacing.m) {
                Image(systemName: "bookmark")
                    .font(.system(size: 16))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .frame(width: 24)
                Text("Bookmarks (save rate)")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                Spacer()
                Text("\(formatCount(bookmarkCount)) (\(saveRate) save rate)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
            }
            .frame(minHeight: 56)
            .padding(.vertical, KathaTheme.Spacing.s)
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

// MARK: - Analytics Empty State

struct AnalyticsEmptyState: View {
    let onShare: () -> Void

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 96))
                .foregroundStyle(KathaTheme.accent.opacity(0.4))
                .padding(.top, KathaTheme.Spacing.huge)

            Text("Analytics grow as your story gets read")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .multilineTextAlignment(.center)

            Text("Share your story with friends, or wait for the Discover feed to surface it. New data appears here as it comes in.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KathaTheme.Spacing.huge)

            SecondaryCTA(title: "Share your story", icon: "square.and.arrow.up") {
                onShare()
            }
            .padding(.horizontal, KathaTheme.Spacing.huge)
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, KathaTheme.Spacing.xxxl)
    }
}

// MARK: - Dashboard Empty State

struct DashboardEmptyState: View {
    let onWrite: () -> Void

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            Image(systemName: "sparkles")
                .font(.system(size: 96))
                .foregroundStyle(KathaTheme.accent.opacity(0.4))
                .padding(.top, KathaTheme.Spacing.huge)

            Text("No dashboard yet")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text("Publish your first story to start tracking reads, followers, and earnings.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KathaTheme.Spacing.huge)

            PrimaryCTA(title: "Write your first story ▸") {
                onWrite()
            }
            .padding(.horizontal, KathaTheme.Spacing.huge)
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, KathaTheme.Spacing.xxxl)
    }
}

// MARK: - Section Label

struct AnalyticsSectionLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .tracking(1)
            .foregroundStyle(KathaTheme.textTertiary)
            .padding(.bottom, KathaTheme.Spacing.m)
    }
}


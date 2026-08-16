//
//  AnalyticsService.swift
//  KathaAICreateStories
//

import Foundation

// MARK: - Analytics Service

final class AnalyticsService {
    static let shared = AnalyticsService()

    private let defaults = UserDefaults.standard
    private let analyticsKey = "katha.storyAnalytics"
    private let authorMilestonesKey = "katha.authorMilestonesCrossed"
    private let unseenMilestonesKey = "katha.unseenMilestones"
    private let timeRangeKey = "katha.analyticsTimeRange"

    // In-memory cache
    private(set) var storyAnalytics: [String: StoryAnalytics] = [:]
    private(set) var authorMilestonesCrossed: Set<String> = []
    private(set) var unseenMilestones: [UnseenMilestone] = []

    private var seeded = false

    private init() {
        load()
    }

    // MARK: - Load / Save

    private func load() {
        if let data = defaults.data(forKey: analyticsKey),
           let decoded = try? JSONDecoder().decode([String: StoryAnalytics].self, from: data) {
            storyAnalytics = decoded
            seeded = true
        }
        if let data = defaults.data(forKey: unseenMilestonesKey),
           let decoded = try? JSONDecoder().decode([UnseenMilestone].self, from: data) {
            unseenMilestones = decoded
        }
        authorMilestonesCrossed = Set(defaults.stringArray(forKey: authorMilestonesKey) ?? [])
    }

    private func saveAnalytics() {
        if let data = try? JSONEncoder().encode(storyAnalytics) {
            defaults.set(data, forKey: analyticsKey)
        }
    }

    private func saveUnseenMilestones() {
        if let data = try? JSONEncoder().encode(unseenMilestones) {
            defaults.set(data, forKey: unseenMilestonesKey)
        }
    }

    private func saveAuthorMilestones() {
        defaults.set(Array(authorMilestonesCrossed), forKey: authorMilestonesKey)
    }

    // MARK: - Time Range

    var timeRange: AnalyticsTimeRange {
        AnalyticsTimeRange(rawValue: defaults.integer(forKey: timeRangeKey)) ?? .thirtyDays
    }

    func setTimeRange(_ range: AnalyticsTimeRange) {
        defaults.set(range.rawValue, forKey: timeRangeKey)
    }

    // MARK: - Seed Mock Analytics

    func ensureSeeded(stories: [Story]) {
        guard !seeded else { return }
        seeded = true

        for story in stories {
            guard storyAnalytics[story.id] == nil else { continue }
            storyAnalytics[story.id] = generateMockAnalytics(for: story)
        }

        // Aarav's specific story: 47 reads, 4 credits, milestones
        if let aaravStory = stories.first(where: { $0.authorId == "aarav" }) {
            storyAnalytics[aaravStory.id] = generateAaravAnalytics(for: aaravStory)
        }

        saveAnalytics()
    }

    private func generateMockAnalytics(for story: Story) -> StoryAnalytics {
        let totalReads = story.views
        let dailyReads = generateDailyReads(totalReads: totalReads, publishedOffset: story.publishedOffset)
        let chapterReads = generateChapterReads(story: story, totalReads: totalReads)
        let creditsEarned = totalReads / 12
        let storyFollowers = story.followerCount

        let crossed = computeMilestones(
            totalReads: totalReads,
            storyFollowers: storyFollowers,
            creditsEarned: creditsEarned,
            isPublished: true,
            authorFollowers: SeedData.author(id: story.authorId)?.followers ?? 0
        )

        return StoryAnalytics(
            dailyReads: dailyReads,
            chapterReads: chapterReads,
            milestonesCrossed: crossed,
            creditsEarnedFromReads: creditsEarned,
            followersGainedFromStory: storyFollowers,
            authorFollowersGainedViaStory: max(0, storyFollowers / 3),
            lastUpdated: Date()
        )
    }

    private func generateAaravAnalytics(for story: Story) -> StoryAnalytics {
        let totalReads = 47
        let dailyReads = generateDailyReads(totalReads: totalReads, publishedOffset: 30)
        let chapterReads = generateChapterReads(story: story, totalReads: totalReads)
        let creditsEarned = 4

        let crossed: Set<String> = [
            MilestoneKey.publish.rawValue,
            MilestoneKey.firstRead.rawValue,
            MilestoneKey.reads10.rawValue,
            MilestoneKey.firstCredit.rawValue
        ]

        return StoryAnalytics(
            dailyReads: dailyReads,
            chapterReads: chapterReads,
            milestonesCrossed: crossed,
            creditsEarnedFromReads: creditsEarned,
            followersGainedFromStory: 8,
            authorFollowersGainedViaStory: 12,
            lastUpdated: Date()
        )
    }

    private func generateDailyReads(totalReads: Int, publishedOffset: Int) -> [DailyReads] {
        let cal = Calendar.current
        let now = Date()
        let days = min(max(7, publishedOffset), 90)

        guard totalReads > 0 else {
            // Generate zero entries for 7 days
            return (0..<min(days, 7)).map { offset in
                let date = cal.date(byAdding: .day, value: -offset, to: now)!
                let iso = AnalyticsDateFormatter.shared.string(from: date)
                return DailyReads(dateISO: iso, reads: 0, uniqueReads: 0)
            }.reversed()
        }

        var weights: [Double] = []
        for i in 0..<days {
            let recencyBias = 1.0 + Double(i) / Double(days) * 0.6
            let date = cal.date(byAdding: .day, value: -(days - 1 - i), to: now)!
            let weekday = cal.component(.weekday, from: date)
            let weekendBoost = (weekday == 1 || weekday == 7) ? 1.2 : 1.0
            let noise = 0.7 + Double.random(in: 0...0.6)
            weights.append(recencyBias * weekendBoost * noise)
        }
        let sum = weights.reduce(0, +)
        var normalized = weights.map { max(0, Int(round(Double($0) / sum * Double(totalReads)))) }
        let diff = totalReads - normalized.reduce(0, +)
        if !normalized.isEmpty { normalized[normalized.count - 1] = max(0, normalized[normalized.count - 1] + diff) }

        return normalized.enumerated().map { index, reads in
            let date = cal.date(byAdding: .day, value: -(days - 1 - index), to: now)!
            let iso = AnalyticsDateFormatter.shared.string(from: date)
            return DailyReads(dateISO: iso, reads: reads, uniqueReads: Int(Double(reads) * 0.75))
        }
    }

    private func generateChapterReads(story: Story, totalReads: Int) -> [ChapterReads] {
        guard story.chapters.count > 1 else { return [] }

        let chapterCount = story.chapters.count
        var weights: [Double] = []
        for i in 0..<chapterCount {
            let dropOff = pow(0.72, Double(i))
            weights.append(dropOff)
        }
        let sum = weights.reduce(0, +)
        return story.chapters.enumerated().map { index, chapter in
            let reads = max(0, Int(round(Double(totalReads) * weights[index] / sum)))
            return ChapterReads(
                chapterId: chapter.id,
                reads: reads,
                uniqueReads: Int(Double(reads) * 0.75),
                completionRate: max(0.2, min(0.95, 1.0 - Double(index) * 0.15))
            )
        }
    }

    private func computeMilestones(totalReads: Int, storyFollowers: Int, creditsEarned: Int, isPublished: Bool, authorFollowers: Int) -> Set<String> {
        var crossed: Set<String> = []
        for milestone in MilestoneKey.allCases {
            if milestone.isCrossed(
                totalReads: totalReads,
                storyFollowers: storyFollowers,
                creditsEarned: creditsEarned,
                isPublished: isPublished,
                authorFollowers: authorFollowers
            ) {
                crossed.insert(milestone.rawValue)
            }
        }
        return crossed
    }

    // MARK: - Analytics Access

    func analytics(for storyId: String) -> StoryAnalytics? {
        storyAnalytics[storyId]
    }

    func dailyReads(for storyId: String, range: AnalyticsTimeRange) -> [DailyReads] {
        guard let analytics = storyAnalytics[storyId] else { return [] }
        switch range {
        case .sevenDays:
            return Array(analytics.dailyReads.suffix(7))
        case .thirtyDays:
            return Array(analytics.dailyReads.suffix(30))
        case .allTime:
            return analytics.dailyReads
        }
    }

    func totalReads(for storyId: String, range: AnalyticsTimeRange) -> Int {
        dailyReads(for: storyId, range: range).reduce(0) { $0 + $1.reads }
    }

    func previousPeriodReads(for storyId: String, range: AnalyticsTimeRange) -> Int {
        guard let analytics = storyAnalytics[storyId] else { return 0 }
        let all = analytics.dailyReads
        let dayCount = range.dayCount ?? all.count
        let endIdx = max(0, all.count - dayCount)
        let startIdx = max(0, endIdx - dayCount)
        return all[startIdx..<endIdx].reduce(0) { $0 + $1.reads }
    }

    func creditsEarned(for storyId: String, range: AnalyticsTimeRange) -> Int {
        guard let analytics = storyAnalytics[storyId] else { return 0 }
        return analytics.creditsEarnedFromReads
    }

    // MARK: - Milestone Checking

    func checkMilestones(storyId: String, title: String, totalReads: Int, storyFollowers: Int, creditsEarned: Int, isPublished: Bool, authorFollowers: Int) {
        guard let analytics = storyAnalytics[storyId] else { return }

        let currentCrossed = computeMilestones(
            totalReads: totalReads,
            storyFollowers: storyFollowers,
            creditsEarned: creditsEarned,
            isPublished: isPublished,
            authorFollowers: authorFollowers
        )

        let newlyCrossed = currentCrossed.subtracting(analytics.milestonesCrossed)

        if !newlyCrossed.isEmpty {
            var updated = analytics
            updated.milestonesCrossed = currentCrossed
            updated.lastUpdated = Date()
            storyAnalytics[storyId] = updated
            saveAnalytics()

            for key in newlyCrossed {
                guard let milestone = MilestoneKey(rawValue: key) else { continue }
                let unseen = UnseenMilestone(
                    id: UUID().uuidString,
                    milestoneKey: key,
                    storyId: storyId,
                    storyTitle: title,
                    timestamp: Date()
                )
                unseenMilestones.append(unseen)

                // Also check author-level milestones
                if milestone == .authorFollowers100 {
                    authorMilestonesCrossed.insert(key)
                    saveAuthorMilestones()
                }
            }
            saveUnseenMilestones()
        }
    }

    // MARK: - Unseen Milestones Queue

    var currentUnseenMilestone: UnseenMilestone? {
        unseenMilestones.first
    }

    var hasUnseenMilestones: Bool {
        !unseenMilestones.isEmpty
    }

    func dismissCurrentMilestone() {
        guard !unseenMilestones.isEmpty else { return }
        unseenMilestones.removeFirst()
        saveUnseenMilestones()
    }

    // MARK: - Dev Tools

    func triggerMilestoneCelebration(milestone: MilestoneKey, storyId: String, storyTitle: String) {
        let unseen = UnseenMilestone(
            id: UUID().uuidString,
            milestoneKey: milestone.rawValue,
            storyId: storyId,
            storyTitle: storyTitle,
            timestamp: Date()
        )
        unseenMilestones.append(unseen)
        saveUnseenMilestones()
    }

    func resetAllMilestones() {
        for key in storyAnalytics.keys {
            storyAnalytics[key]?.milestonesCrossed = []
        }
        authorMilestonesCrossed = []
        unseenMilestones = []
        saveAnalytics()
        saveAuthorMilestones()
        saveUnseenMilestones()
    }

    func resetAllAnalytics() {
        storyAnalytics = [:]
        unseenMilestones = []
        authorMilestonesCrossed = []
        seeded = false
        defaults.removeObject(forKey: analyticsKey)
        defaults.removeObject(forKey: unseenMilestonesKey)
        defaults.removeObject(forKey: authorMilestonesKey)
    }

    // MARK: - Aggregated Dashboard Data

    func aggregatedDailyReads(storyIds: [String], range: AnalyticsTimeRange) -> [DailyReads] {
        var merged: [String: Int] = [:]
        var orderedDates: [String] = []

        for storyId in storyIds {
            let reads = dailyReads(for: storyId, range: range)
            for entry in reads {
                if merged[entry.dateISO] == nil { orderedDates.append(entry.dateISO) }
                merged[entry.dateISO, default: 0] += entry.reads
            }
        }

        return orderedDates.map { iso in
            DailyReads(dateISO: iso, reads: merged[iso] ?? 0, uniqueReads: Int(Double(merged[iso] ?? 0) * 0.75))
        }
    }

    func totalReadsAcrossCatalog(storyIds: [String], range: AnalyticsTimeRange) -> Int {
        storyIds.reduce(0) { $0 + totalReads(for: $1, range: range) }
    }

    func totalCreditsAcrossCatalog(storyIds: [String]) -> Int {
        storyIds.reduce(0) { $0 + (storyAnalytics[$1]?.creditsEarnedFromReads ?? 0) }
    }

    func recentMilestones(limit: Int = 5) -> [(milestone: MilestoneKey, storyId: String, storyTitle: String, timestamp: Date)] {
        var results: [(MilestoneKey, String, String, Date)] = []
        for (storyId, analytics) in storyAnalytics {
            for key in analytics.milestonesCrossed {
                guard let milestone = MilestoneKey(rawValue: key) else { continue }
                let story = SeedData.stories.first(where: { $0.id == storyId })
                results.append((milestone, storyId, story?.title ?? "", analytics.lastUpdated))
            }
        }
        return results.sorted { $0.3 > $1.3 }.prefix(limit).map { $0 }
    }

    func topStories(storyIds: [String], sortBy: MilestoneSortMetric, limit: Int = 5) -> [String] {
        switch sortBy {
        case .reads:
            return storyIds.sorted { a, b in
                totalReads(for: a, range: .allTime) > totalReads(for: b, range: .allTime)
            }.prefix(limit).map { $0 }
        case .credits:
            return storyIds.sorted { a, b in
                (storyAnalytics[a]?.creditsEarnedFromReads ?? 0) > (storyAnalytics[b]?.creditsEarnedFromReads ?? 0)
            }.prefix(limit).map { $0 }
        case .followers:
            return storyIds.sorted { a, b in
                (storyAnalytics[a]?.followersGainedFromStory ?? 0) > (storyAnalytics[b]?.followersGainedFromStory ?? 0)
            }.prefix(limit).map { $0 }
        }
    }
}

// MARK: - Sort Metric

enum MilestoneSortMetric: String, CaseIterable, Identifiable {
    case reads
    case credits
    case followers

    var id: String { rawValue }

    var label: String {
        switch self {
        case .reads: "By reads"
        case .credits: "By credits"
        case .followers: "By followers"
        }
    }
}

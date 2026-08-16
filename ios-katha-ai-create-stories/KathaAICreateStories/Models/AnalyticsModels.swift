//
//  AnalyticsModels.swift
//  KathaAICreateStories
//

import Foundation

// MARK: - Time Range

enum AnalyticsTimeRange: Int, CaseIterable, Identifiable {
    case sevenDays = 0
    case thirtyDays = 1
    case allTime = 2

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .sevenDays: "7 days"
        case .thirtyDays: "30 days"
        case .allTime: "All time"
        }
    }

    var dayCount: Int? {
        switch self {
        case .sevenDays: 7
        case .thirtyDays: 30
        case .allTime: nil
        }
    }
}

// MARK: - Daily Reads

struct DailyReads: Identifiable, Codable, Hashable {
    var id: String { dateISO }
    let dateISO: String
    let reads: Int
    let uniqueReads: Int

    var date: Date {
        AnalyticsDateFormatter.shared.date(from: dateISO) ?? Date()
    }
}

// MARK: - Chapter Reads

struct ChapterReads: Codable, Hashable {
    let chapterId: String
    let reads: Int
    let uniqueReads: Int
    let completionRate: Double
}

// MARK: - Story Analytics

struct StoryAnalytics: Codable, Hashable {
    var dailyReads: [DailyReads]
    var chapterReads: [ChapterReads]
    var milestonesCrossed: Set<String>
    var creditsEarnedFromReads: Int
    var followersGainedFromStory: Int
    var authorFollowersGainedViaStory: Int
    var lastUpdated: Date
}

// MARK: - Milestone Key

enum MilestoneKey: String, CaseIterable, Identifiable {
    case publish
    case firstRead
    case reads10
    case reads100
    case reads500
    case reads1000
    case reads10000
    case followers10
    case followers100
    case followers500
    case followers1000
    case firstCredit
    case credits10
    case credits50
    case credits100
    case authorFollowers100

    var id: String { rawValue }

    var label: String {
        switch self {
        case .publish: "Published"
        case .firstRead: "First read ✨"
        case .reads10: "10 reads"
        case .reads100: "100 reads"
        case .reads500: "500 reads"
        case .reads1000: "1,000 reads"
        case .reads10000: "10,000 reads"
        case .followers10: "10 story followers"
        case .followers100: "100 story followers"
        case .followers500: "500 story followers"
        case .followers1000: "1,000 story followers"
        case .firstCredit: "First credit earned ✨"
        case .credits10: "10 credits from reads"
        case .credits50: "50 credits from reads"
        case .credits100: "100 credits from reads"
        case .authorFollowers100: "100 people follow you"
        }
    }

    var icon: String {
        switch self {
        case .publish: "paperplane"
        case .firstRead: "eye"
        case .reads10: "book"
        case .reads100: "book"
        case .reads500: "book"
        case .reads1000: "book"
        case .reads10000: "book"
        case .followers10: "heart"
        case .followers100: "heart"
        case .followers500: "heart"
        case .followers1000: "heart"
        case .firstCredit: "credits"
        case .credits10: "credits"
        case .credits50: "credits"
        case .credits100: "credits"
        case .authorFollowers100: "person.2"
        }
    }

    /// Celebration banner title copy
    var celebrationTitle: String {
        switch self {
        case .publish: "Your story is live ✨"
        case .firstRead: "Your first reader found you"
        case .reads10: "10 reads on your story 📖"
        case .reads100: "100 reads on your story 🎉"
        case .reads500: "500 reads on your story 🔥"
        case .reads1000: "1,000 reads on your story 💫"
        case .reads10000: "10,000 reads. Katha royalty. 👑"
        case .followers10: "10 followers on your story"
        case .followers100: "100 followers ✨"
        case .followers500: "500 followers 🌟"
        case .followers1000: "1,000 followers 👑"
        case .firstCredit: "First credit earned from a reader ✨"
        case .credits10: "10 credits earned 💰"
        case .credits50: "50 credits earned 🌟"
        case .credits100: "100 credits earned 👑"
        case .authorFollowers100: "100 people follow you"
        }
    }

    /// Celebration banner subtitle copy (with story title placeholder)
    func celebrationSubtitle(storyTitle: String) -> String {
        switch self {
        case .publish: "'\(storyTitle)' just went out into the world"
        case .firstRead: "Someone just read '\(storyTitle)'"
        case .reads10: "You're being read."
        case .reads100: "That's a hundred people spent time with your words."
        case .reads500: "You've officially got an audience."
        case .reads1000: "A milestone worth celebrating. Keep writing."
        case .reads10000: "'\(storyTitle)' has hit a rare milestone."
        case .followers10: "Ten people are waiting for your next chapter."
        case .followers100: "A hundred readers are following '\(storyTitle)'."
        case .followers500: "Impressive. '\(storyTitle)' has a real following."
        case .followers1000: "'\(storyTitle)' is one of Katha's most-followed."
        case .firstCredit: "'\(storyTitle)' just paid for its next chapter."
        case .credits10: "'\(storyTitle)' has funded your next 10 generations."
        case .credits50: "'\(storyTitle)' is a real earner. Keep writing."
        case .credits100: "'\(storyTitle)' is bankrolling your creative practice."
        case .authorFollowers100: "You've built a real audience on Katha."
        }
    }

    /// Check if this milestone is crossed given the metrics
    func isCrossed(totalReads: Int, storyFollowers: Int, creditsEarned: Int, isPublished: Bool, authorFollowers: Int) -> Bool {
        switch self {
        case .publish: isPublished
        case .firstRead: totalReads >= 1
        case .reads10: totalReads >= 10
        case .reads100: totalReads >= 100
        case .reads500: totalReads >= 500
        case .reads1000: totalReads >= 1000
        case .reads10000: totalReads >= 10000
        case .followers10: storyFollowers >= 10
        case .followers100: storyFollowers >= 100
        case .followers500: storyFollowers >= 500
        case .followers1000: storyFollowers >= 1000
        case .firstCredit: creditsEarned >= 1
        case .credits10: creditsEarned >= 10
        case .credits50: creditsEarned >= 50
        case .credits100: creditsEarned >= 100
        case .authorFollowers100: authorFollowers >= 100
        }
    }
}

// MARK: - Unseen Milestone (queue for celebration banner)

struct UnseenMilestone: Identifiable, Codable, Hashable {
    let id: String
    let milestoneKey: String
    let storyId: String
    let storyTitle: String
    let timestamp: Date
}

// MARK: - Stat Trend

struct StatTrend: Hashable {
    let delta: Int
    let isPositive: Bool

    var label: String {
        if delta == 0 { return "No change" }
        let prefix = delta > 0 ? "+" : ""
        return "\(prefix)\(delta) vs previous period"
    }

    var color: String {
        if delta > 0 { return "success" }
        if delta < 0 { return "error" }
        return "secondary"
    }
}

// MARK: - Analytics Date Formatter

enum AnalyticsDateFormatter {
    static let shared: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        return f
    }()

    static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        return f
    }()

    static let publishFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()
}

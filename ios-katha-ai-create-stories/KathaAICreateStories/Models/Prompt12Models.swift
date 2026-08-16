import Foundation

struct StreakDay: Codable, Hashable, Identifiable {
    let date: Date
    let active: Bool
    let freezeUsed: Bool
    let summary: String

    var id: Date { date }
}

struct StreakState: Codable, Hashable {
    var current: Int = 0
    var longest: Int = 0
    var lastActivityDate: Date?
    var nextCreditIn: Int = 3
    var freezesAvailable: Int = 0
    var history: [StreakDay] = []

    static let initial = StreakState()
}

struct NotificationPreferences: Codable, Hashable {
    var storyNewChapters = true
    var storyNewStories = true
    var storyComments = true
    var storyLikes = false
    var streakReminders = true
    var milestoneCelebrations = true
    var creditsEarned = true
    var weeklyDigest = true
    var newWriters = false
}

struct ReferralRecord: Codable, Hashable, Identifiable {
    let id: String
    let displayName: String
    let username: String
    let joinedAt: Date
    var firstStoryGeneratedAt: Date?
    var credited: Bool
}

struct OfflineStoryRecord: Codable, Hashable, Identifiable {
    let storyId: String
    let title: String
    let sizeMB: Double
    let downloadedAt: Date

    var id: String { storyId }
}

enum SleepTimerOption: Equatable {
    case off
    case endOfChapter
    case minutes(Int)

    var label: String {
        switch self {
        case .off: return "Off"
        case .endOfChapter: return "End of chapter"
        case .minutes(let minutes): return "\(minutes)m"
        }
    }
}

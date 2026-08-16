//
//  Models.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Genre

enum Genre: String, CaseIterable, Identifiable, Hashable {
    case fiction
    case mystery
    case romance
    case scifi
    case fantasy
    case horror
    case poetry
    case literary
    case adventure
    case folklore
    case thriller
    case sliceOfLife
    case historical
    case contemporary
    case lgbtq
    case comedy
    case drama
    case mythology
    case spirituality
    case motivational
    case kids

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .fiction: "Fiction"
        case .mystery: "Mystery"
        case .romance: "Romance"
        case .scifi: "Sci-Fi"
        case .fantasy: "Fantasy"
        case .horror: "Horror"
        case .poetry: "Poetry"
        case .literary: "Literary"
        case .adventure: "Adventure"
        case .folklore: "Folklore"
        case .thriller: "Thriller"
        case .sliceOfLife: "Slice of Life"
        case .historical: "Historical"
        case .contemporary: "Contemporary"
        case .lgbtq: "LGBTQ+"
        case .comedy: "Comedy"
        case .drama: "Drama"
        case .mythology: "Mythology"
        case .spirituality: "Spirituality"
        case .motivational: "Motivational"
        case .kids: "Kids"
        }
    }

    var coverColors: [Color] {
        switch self {
        case .fiction:      [Color(hex: 0xE89F3D), Color(hex: 0xC8842A), Color(hex: 0x8B5A2A)]
        case .mystery:      [Color(hex: 0x2C3E50), Color(hex: 0x1A2A36), Color(hex: 0x0D1620)]
        case .romance:      [Color(hex: 0xC45B7B), Color(hex: 0x8B2D4B), Color(hex: 0x5A1D33)]
        case .scifi:        [Color(hex: 0x4A3A8E), Color(hex: 0x2D1A5A), Color(hex: 0x1A0D3A)]
        case .fantasy:      [Color(hex: 0x5B8A5B), Color(hex: 0x3A6B3A), Color(hex: 0x1A4A2A)]
        case .horror:       [Color(hex: 0x5A1D1D), Color(hex: 0x3A0D0D), Color(hex: 0x1A0505)]
        case .poetry:       [Color(hex: 0x8E7A9E), Color(hex: 0x6B5B8E), Color(hex: 0x4A3A6B)]
        case .literary:     [Color(hex: 0x5A4A3A), Color(hex: 0x3A2D1D), Color(hex: 0x1A1205)]
        case .adventure:    [Color(hex: 0xE87B4A), Color(hex: 0xC04A2D), Color(hex: 0x8B2A1A)]
        case .folklore:     [Color(hex: 0xB8A03D), Color(hex: 0x8E7A2A), Color(hex: 0x5A4D1A)]
        case .thriller:     [Color(hex: 0x3A3A3A), Color(hex: 0x1A1A1A), Color(hex: 0x0D0D0D)]
        case .sliceOfLife:  [Color(hex: 0xD4A574), Color(hex: 0xA67B52), Color(hex: 0x6B4F35)]
        case .historical:   [Color(hex: 0x8B7355), Color(hex: 0x6B5235), Color(hex: 0x3A2D1A)]
        case .contemporary: [Color(hex: 0x4A9A9A), Color(hex: 0x2D6B6B), Color(hex: 0x1A4A4A)]
        case .lgbtq:        [Color(hex: 0xE84A7B), Color(hex: 0xC42D5B), Color(hex: 0x8B1D3D)]
        case .comedy:       [Color(hex: 0xF0C04A), Color(hex: 0xD4A02D), Color(hex: 0x8B7020)]
        case .drama:        [Color(hex: 0x6B4A6B), Color(hex: 0x4A2D4A), Color(hex: 0x2A1A2A)]
        case .mythology:    [Color(hex: 0xB85A2D), Color(hex: 0x8B3A1A), Color(hex: 0x5A1D0D)]
        case .spirituality: [Color(hex: 0x6B8E6B), Color(hex: 0x4A6B4A), Color(hex: 0x2A4A2A)]
        case .motivational: [Color(hex: 0xE8B83D), Color(hex: 0xC8982A), Color(hex: 0x8B6B1A)]
        case .kids:         [Color(hex: 0xFFB347), Color(hex: 0xFF8C42), Color(hex: 0xCC6A2D)]
        }
    }

    var icon: String {
        switch self {
        case .fiction:      "book"
        case .mystery:      "magnifyingglass"
        case .romance:      "heart"
        case .scifi:        "rocket"
        case .fantasy:      "wand.and.stars"
        case .horror:       "moon.haze"
        case .poetry:       "text.quote"
        case .literary:     "text.book.closed"
        case .adventure:    "mountain.2"
        case .folklore:     "tree"
        case .thriller:     "bolt"
        case .sliceOfLife:  "cup.and.saucer"
        case .historical:   "building.columns"
        case .contemporary: "map"
        case .lgbtq:       "heart.text.square"
        case .comedy:       "face.smiling"
        case .drama:       "theatermasks"
        case .mythology:    "flame"
        case .spirituality: "sun.max"
        case .motivational: "sparkles"
        case .kids:         "figure.child"
        }
    }
}

// MARK: - Author

struct Author: Identifiable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let bio: String
    let followers: Int
    let storyCount: Int
    let isVerified: Bool
    let avatarPaletteIndex: Int
    var followingCount: Int = 0

    var avatarPalette: AvatarPalette {
        AvatarPalette.palettes[avatarPaletteIndex % AvatarPalette.palettes.count]
    }
}

// MARK: - Profile User Item (unified row model for follower/following lists)

struct ProfileUserItem: Identifiable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let bio: String
    let isVerified: Bool
    let isGhost: Bool
}

// MARK: - Profile Route (overlay navigation stack)

struct ProfileRoute: Identifiable, Hashable {
    enum Kind: Hashable {
        /// userId is an author id, or "me" for the current user's own profile
        case profile(String)
        case followers(String)
        case following(String, Int)
        case editProfile
        case blockedUsers
    }

    let id: String
    let kind: Kind

    init(kind: Kind) {
        self.id = UUID().uuidString
        self.kind = kind
    }
}

// MARK: - Chapter

struct Chapter: Identifiable, Hashable {
    let id: String
    let title: String
    let paragraphs: [String]
    var storyId: String? = nil
    var chapterNumber: Int? = nil
    var isPublished: Bool = true
    var publishedAt: Date? = nil
    var createdAt: Date? = nil
    var coverColors: [Color]? = nil

    var wordCount: Int {
        paragraphs.reduce(0) { $0 + $1.split(separator: " ").count }
    }

    var readingTimeMinutes: Int {
        max(1, wordCount / 200)
    }
}

// MARK: - Story

struct Story: Identifiable, Hashable {
    let id: String
    let title: String
    let authorId: String
    let genre: Genre
    let synopsis: String
    let chapters: [Chapter]
    let likes: Int
    let bookmarks: Int
    let views: Int
    let tags: [String]
    let publishedOffset: Int
    let isFeatured: Bool
    var followerCount: Int = 0
    var plannedChapterCount: Int? = nil

    var readingTimeMinutes: Int {
        let totalWords = chapters.reduce(0) { $0 + $1.wordCount }
        return max(1, totalWords / 200)
    }

    var coverColors: [Color] { genre.coverColors }

    var isSeries: Bool {
        chapters.count > 1 || (plannedChapterCount ?? 1) > 1
    }

    var publishedChapterCount: Int {
        chapters.filter { $0.isPublished }.count
    }

    var draftChapterCount: Int {
        chapters.filter { !$0.isPublished }.count
    }
}

// MARK: - Story Comment

struct StoryComment: Identifiable, Hashable, Codable {
    let id: String
    let storyId: String
    /// Seed author id, "me" for the current user, or "ghost-N" for display-only users
    let authorId: String
    let username: String
    let displayName: String
    let text: String
    let likes: Int
    /// Hours since posting (mock)
    let postedOffsetHours: Int
    let isVerified: Bool
    var replyToUsername: String? = nil

    var timeLabel: String {
        if postedOffsetHours < 1 { return "Just now" }
        if postedOffsetHours < 24 { return "\(postedOffsetHours)h ago" }
        let days = postedOffsetHours / 24
        if days < 7 { return "\(days)d ago" }
        return "\(days / 7)w ago"
    }
}

// MARK: - Auth Sheet Context

enum AuthSheetContext: String {
    case generic
    case readerWall
    case like
    case comment
    case bookmark

    var subtitle: String {
        switch self {
        case .generic: "Sign in to like stories, save your reads, and follow your favorite authors."
        case .readerWall: "Sign in to continue reading and save your progress."
        case .like: "Sign in to like this story and show the author some love."
        case .comment: "Sign in to join the conversation on this story."
        case .bookmark: "Sign in to save this story to your library."
        }
    }
}

// MARK: - Report Target

enum ReportTarget: Identifiable {
    case comment(id: String, authorName: String)
    case author(id: String, displayName: String)
    case story(id: String, title: String)

    var id: String {
        switch self {
        case .comment(let id, _): "comment-\(id)"
        case .author(let id, _): "author-\(id)"
        case .story(let id, _): "story-\(id)"
        }
    }

    var label: String {
        switch self {
        case .comment(_, let name): "comment by \(name)"
        case .author(_, let name): "@\(name)"
        case .story(_, let title): "“\(title)”"
        }
    }
}

// MARK: - Share Payload

struct SharePayload: Identifiable {
    let id = UUID()
    let text: String
}

// MARK: - User Session

struct UserSession: Identifiable, Codable {
    let id: String
    let email: String?
    let username: String
    let displayName: String
    let bio: String
    let credits: Int
    let followers: Int
    let following: Int
    let avatarPaletteIndex: Int
}

// MARK: - Story Language

enum StoryLanguage: String, CaseIterable, Identifiable, Hashable {
    case en, hi, es, fr, de, pt, it, ja, ko, zh, ar, ru, id, tr, bn

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .en: "English"
        case .hi: "Hindi"
        case .es: "Spanish"
        case .fr: "French"
        case .de: "German"
        case .pt: "Portuguese"
        case .it: "Italian"
        case .ja: "Japanese"
        case .ko: "Korean"
        case .zh: "Mandarin"
        case .ar: "Arabic"
        case .ru: "Russian"
        case .id: "Indonesian"
        case .tr: "Turkish"
        case .bn: "Bengali"
        }
    }

    var nativeName: String {
        switch self {
        case .en: "English"
        case .hi: "हिन्दी"
        case .es: "Español"
        case .fr: "Français"
        case .de: "Deutsch"
        case .pt: "Português"
        case .it: "Italiano"
        case .ja: "日本語"
        case .ko: "한국어"
        case .zh: "中文"
        case .ar: "العربية"
        case .ru: "Русский"
        case .id: "Bahasa Indonesia"
        case .tr: "Türkçe"
        case .bn: "বাংলা"
        }
    }

    var flagEmoji: String {
        switch self {
        case .en: "🇺🇸"
        case .hi: "🇮🇳"
        case .es: "🇪🇸"
        case .fr: "🇫🇷"
        case .de: "🇩🇪"
        case .pt: "🇵🇹"
        case .it: "🇮🇹"
        case .ja: "🇯🇵"
        case .ko: "🇰🇷"
        case .zh: "🇨🇳"
        case .ar: "🇸🇦"
        case .ru: "🇷🇺"
        case .id: "🇮🇩"
        case .tr: "🇹🇷"
        case .bn: "🇧🇩"
        }
    }

    var code: String { rawValue.uppercased() }
}

// MARK: - Wizard Character

struct WizardCharacter: Identifiable, Hashable {
    let id: String
    var name: String
    var role: String
    var description: String
}

// MARK: - Generated Story (user-created)

struct GeneratedChapter: Identifiable, Hashable {
    let id: String
    let storyId: String
    let chapterNumber: Int
    let title: String
    let body: String
    let coverColors: [Color]
    var isPublished: Bool
    var publishedAt: Date?
    let createdAt: Date

    var wordCount: Int { body.split(separator: " ").count }
    var readingTimeMinutes: Int { max(1, wordCount / 200) }
    var paragraphs: [String] { body.components(separatedBy: "\n\n") }

    var asChapter: Chapter {
        Chapter(
            id: id,
            title: title,
            paragraphs: paragraphs,
            storyId: storyId,
            chapterNumber: chapterNumber,
            isPublished: isPublished,
            publishedAt: publishedAt,
            createdAt: createdAt,
            coverColors: coverColors
        )
    }
}

struct GeneratedStory: Identifiable, Hashable {
    let id: String
    let title: String
    let authorId: String
    let genre: Genre
    let language: StoryLanguage
    let themes: [String]
    let coverColors: [Color]
    let firstLine: String
    let body: String
    let wordCount: Int
    let readingTime: Int
    let plannedChapterCount: Int?
    let isPublished: Bool
    let createdAt: Date
    var followerCount: Int = 0
    var chapters: [GeneratedChapter] = []

    var synopsis: String { String(firstLine.prefix(120)) }

    var allChapters: [Chapter] {
        var result: [Chapter] = [
            Chapter(
                id: "\(id)-c1",
                title: "Chapter 1",
                paragraphs: body.components(separatedBy: "\n\n"),
                storyId: id,
                chapterNumber: 1,
                isPublished: true,
                createdAt: createdAt,
                coverColors: coverColors
            )
        ]
        result.append(contentsOf: chapters.map { $0.asChapter })
        return result
    }

    var asStory: Story {
        Story(
            id: id,
            title: title,
            authorId: authorId,
            genre: genre,
            synopsis: synopsis,
            chapters: allChapters,
            likes: 0, bookmarks: 0, views: 0,
            tags: themes, publishedOffset: 0, isFeatured: false,
            followerCount: followerCount,
            plannedChapterCount: plannedChapterCount
        )
    }

    var chapterCount: Int { 1 + chapters.count }

    var publishedChapterCount: Int {
        1 + chapters.filter { $0.isPublished }.count
    }
}

// MARK: - Reading Progress

struct ReadingProgress: Hashable, Codable {
    let storyId: String
    let chapterIndex: Int
    let scrollProgress: Double
    let lastReadOffset: Int
}

// MARK: - Continue Wizard Step

enum ContinueWizardStep: Int, CaseIterable {
    case direction = 1
    case review = 2

    var number: Int { rawValue }
}

// MARK: - New Chapter Notification

struct NewChapterNotification: Identifiable, Hashable {
    let id: String
    let storyId: String
    let storyTitle: String
    let chapterNumber: Int
    let coverColors: [Color]
    let genre: Genre
    let publishedAt: Date
    var isRead: Bool = false
}

// MARK: - Credits Route (overlay navigation)

struct CreditsRoute: Identifiable, Hashable {
    enum Kind: Hashable {
        case credits
        case paywall
        case packSheet(packId: String?)
        case management
        case history
    }

    let id: String
    let kind: Kind

    init(kind: Kind) {
        self.id = UUID().uuidString
        self.kind = kind
    }
}

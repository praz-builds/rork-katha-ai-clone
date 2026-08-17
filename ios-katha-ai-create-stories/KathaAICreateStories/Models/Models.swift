//
//  Models.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Genre

enum Genre: String, CaseIterable, Identifiable, Hashable {
    case mystery
    case romance
    case scifi
    case fantasy
    case horror
    case poetry
    case adventure
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
    case erotica

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .contemporary: "Contemporary"
        case .mystery: "Mystery"
        case .romance: "Romance"
        case .scifi: "Sci-Fi"
        case .fantasy: "Fantasy"
        case .horror: "Horror"
        case .poetry: "Poetry"
        case .drama: "Drama"
        case .adventure: "Adventure"
        case .mythology: "Mythology"
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
        case .erotica: "Erotica"
        }
    }

    var coverColors: [Color] {
        KathaTheme.coverColors(for: self)
    }

    var icon: String {
        switch self {
        case .contemporary: "map"
        case .mystery:      "magnifyingglass"
        case .romance:      "heart"
        case .scifi:        "rocket"
        case .fantasy:      "wand.and.stars"
        case .horror:       "moon.haze"
        case .poetry:       "text.quote"
        case .drama:        "theatermasks"
        case .adventure:    "mountain.2"
        case .mythology:    "flame"
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
        case .erotica:      "lock.shield"
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

// MARK: - Content Safety

enum ContentRating: String, CaseIterable, Codable, Hashable {
    case kids
    case teen
    case mature
}

enum ReadingLevel: String, CaseIterable, Codable, Hashable, Identifiable {
    case simple
    case standard
    case advanced

    var id: String { rawValue }

    var title: String {
        switch self {
        case .simple: "Simple"
        case .standard: "Standard"
        case .advanced: "Advanced"
        }
    }

    var subtitle: String {
        switch self {
        case .simple: "Short sentences, common words. Great for younger readers or English learners."
        case .standard: "Balanced vocabulary and sentence structure. Suits most readers."
        case .advanced: "Rich vocabulary, complex sentences. For confident readers who want depth."
        }
    }

    var icon: String {
        switch self {
        case .simple: "book"
        case .standard: "book.closed"
        case .advanced: "books.vertical"
        }
    }
}

enum AppThemeMode: String, CaseIterable, Identifiable {
    case auto, light, dark
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self { case .auto: nil; case .light: .light; case .dark: .dark }
    }
}

enum PinSetupMode: String {
    case enableKidsMode
    case changePin
}

enum PinEntryContext: String {
    case disableKidsMode
    case changePin
    case allowedContent
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
    var contentRating: ContentRating? = nil
    var languageCode: String = "EN"
    /// ISO 639-1 language code used by filters and language chips.
    var language: String = "en"
    var commentCount: Int = 0

    var effectiveContentRating: ContentRating {
        if let contentRating { return contentRating }
        if genre == .kids { return .kids }
        if genre == .horror || genre == .erotica { return .mature }
        if tags.contains(where: { ["violence", "substance", "sexual"].contains($0.lowercased()) }) { return .mature }
        return .teen
    }

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
    var readingLevel: ReadingLevel = .standard
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
            plannedChapterCount: plannedChapterCount,
            contentRating: genre == .kids ? .kids : (genre == .horror || genre == .erotica ? .mature : .teen),
            languageCode: language.code,
            language: language.code.lowercased()
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

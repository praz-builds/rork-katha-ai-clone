package com.rork.kathaai.model

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ChildCare
import androidx.compose.material.icons.outlined.Coffee

import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Fireplace
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.HistoryEdu
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Park
import androidx.compose.material.icons.outlined.Rocket
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SelfImprovement
import androidx.compose.material.icons.outlined.SentimentSatisfied
import androidx.compose.material.icons.outlined.Spa
import androidx.compose.material.icons.outlined.Terrain
import androidx.compose.material.icons.outlined.TheaterComedy
import androidx.compose.material.icons.outlined.Thunderstorm
import androidx.compose.material.icons.outlined.Transgender
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import kotlinx.serialization.Serializable
import com.rork.kathaai.ui.theme.KathaTheme

enum class Genre(
    val displayName: String,
    val icon: ImageVector
) {
    MYSTERY("Mystery", Icons.Outlined.Search),
    ROMANCE("Romance", Icons.Outlined.FavoriteBorder),
    SCIFI("Sci-Fi", Icons.Outlined.Rocket),
    FANTASY("Fantasy", Icons.Outlined.AutoAwesome),
    HORROR("Horror", Icons.Outlined.DarkMode),
    POETRY("Poetry", Icons.Outlined.FormatQuote),
    ADVENTURE("Adventure", Icons.Outlined.Terrain),
    THRILLER("Thriller", Icons.Outlined.Bolt),
    SLICE_OF_LIFE("Slice of Life", Icons.Outlined.Coffee),
    HISTORICAL("Historical", Icons.Outlined.HistoryEdu),
    CONTEMPORARY("Contemporary", Icons.Outlined.Map),
    LGBTQ("LGBTQ+", Icons.Outlined.Transgender),
    COMEDY("Comedy", Icons.Outlined.SentimentSatisfied),
    DRAMA("Drama", Icons.Outlined.TheaterComedy),
    MYTHOLOGY("Mythology", Icons.Outlined.Fireplace),
    SPIRITUALITY("Spirituality", Icons.Outlined.Spa),
    MOTIVATIONAL("Motivational", Icons.Outlined.Lightbulb),
    KIDS("Kids", Icons.Outlined.ChildCare),
    EROTICA("Erotica", Icons.Outlined.Lock);

    val coverColors: List<Color>
        get() = KathaTheme.coverColors(this)
}

enum class ContentRating { KIDS, TEEN, MATURE }

enum class CreationPhase { COMPOSER, GENERATING, COVER_GENERATING, DRAFT_READY, EDITING, REVISING, PUBLISHED }

enum class CoverGenerationStatus { GENERATING, READY, STALE, FAILED }

data class CoverAssetMetadata(
    val assetId: String,
    val contentVersion: Int,
    val status: CoverGenerationStatus = CoverGenerationStatus.READY,
    val focalX: Float = 0.5f,
    val focalY: Float = 0.42f,
    val thumbnailUrl: String? = null,
    val cardUrl: String? = null,
    val readerUrl: String? = null
)

enum class ReadingLevel(val title: String, val subtitle: String) {
    SIMPLE("Simple", "Short sentences, common words. Great for younger readers or English learners."),
    STANDARD("Standard", "Balanced vocabulary and sentence structure. Suits most readers."),
    ADVANCED("Advanced", "Rich vocabulary, complex sentences. For confident readers who want depth.")
}

enum class PinSetupMode { ENABLE_KIDS_MODE, CHANGE_PIN }
enum class PinEntryContext { DISABLE_KIDS_MODE, CHANGE_PIN, ALLOWED_CONTENT }

data class Author(
    val id: String,
    val username: String,
    val displayName: String,
    val bio: String,
    val followers: Int,
    val storyCount: Int,
    val isVerified: Boolean,
    val followingCount: Int = 0
)

/** Unified row model for followers/following lists (real seed authors + display-only ghost users). */
data class ProfileUserItem(
    val id: String,
    val username: String,
    val displayName: String,
    val bio: String,
    val isVerified: Boolean,
    val isGhost: Boolean
)

/** Overlay navigation routes for the profile stack. */
sealed class ProfileRoute {
    val routeId: String = java.util.UUID.randomUUID().toString()

    /** userId is an author id, or "me" for the current user's own profile */
    data class Profile(val userId: String) : ProfileRoute()
    data class Followers(val userId: String) : ProfileRoute()
    data class Following(val userId: String, val initialTab: Int = 0) : ProfileRoute()
    data object EditProfile : ProfileRoute()
    data object Settings : ProfileRoute()
    data object BlockedUsers : ProfileRoute()
}

data class Chapter(
    val id: String,
    val title: String,
    val paragraphs: List<String>,
    val storyId: String? = null,
    val chapterNumber: Int? = null,
    val isPublished: Boolean = true,
    val publishedAt: Long? = null,
    val createdAt: Long? = null,
    val coverColors: List<Color>? = null,
    val contentVersion: Int = 1,
    val coverAsset: CoverAssetMetadata? = null
) {
    val wordCount: Int get() = paragraphs.sumOf { it.split(" ").size }
    val readingTimeMinutes: Int get() = maxOf(1, wordCount / 200)
}

data class Story(
    val id: String,
    val title: String,
    val authorId: String,
    val genre: Genre,
    val synopsis: String,
    val chapters: List<Chapter>,
    val likes: Int,
    val bookmarks: Int,
    val views: Int,
    val tags: List<String>,
    val publishedOffset: Int,
    val isFeatured: Boolean,
    val followerCount: Int = 0,
    val plannedChapterCount: Int? = null,
    val contentRating: ContentRating? = null,
    val languageCode: String = "EN",
    /** ISO 639-1 language code used by filters and language chips. */
    val language: String = "en",
    val commentCount: Int = 0
) {
    val effectiveContentRating: ContentRating
        get() = contentRating ?: when {
            genre == Genre.KIDS -> ContentRating.KIDS
            genre == Genre.HORROR || genre == Genre.EROTICA -> ContentRating.MATURE
            tags.any { it.lowercase() in setOf("violence", "substance", "sexual") } -> ContentRating.MATURE
            else -> ContentRating.TEEN
        }
    val readingTimeMinutes: Int
        get() = maxOf(1, chapters.sumOf { it.wordCount } / 200)

    val coverColors: List<Color> get() = genre.coverColors

    val isSeries: Boolean
        get() = chapters.size > 1 || (plannedChapterCount ?: 1) > 1

    val publishedChapterCount: Int
        get() = chapters.count { it.isPublished }

    val draftChapterCount: Int
        get() = chapters.count { !it.isPublished }
}

data class StoryComment(
    val id: String,
    val storyId: String,
    val authorId: String,
    val username: String,
    val displayName: String,
    val text: String,
    val likes: Int,
    val postedOffsetHours: Int,
    val isVerified: Boolean,
    val replyToUsername: String? = null
) {
    val timeLabel: String
        get() = when {
            postedOffsetHours < 1 -> "Just now"
            postedOffsetHours < 24 -> "${postedOffsetHours}h ago"
            postedOffsetHours / 24 < 7 -> "${postedOffsetHours / 24}d ago"
            else -> "${postedOffsetHours / 24 / 7}w ago"
        }
}

enum class AuthSheetContext {
    GENERIC, READER_WALL, LIKE, COMMENT, BOOKMARK;

    val subtitle: String
        get() = when (this) {
            GENERIC -> "Sign in to like stories, save your reads, and follow your favorite authors."
            READER_WALL -> "Sign in to continue reading and save your progress."
            LIKE -> "Sign in to like this story and show the author some love."
            COMMENT -> "Sign in to join the conversation on this story."
            BOOKMARK -> "Sign in to save this story to your library."
        }
}

sealed class ReportTarget {
    abstract val id: String
    abstract val label: String

    data class Comment(val commentId: String, val authorName: String) : ReportTarget() {
        override val id: String get() = "comment-$commentId"
        override val label: String get() = "comment by $authorName"
    }
    data class Author(val authorId: String, val displayName: String) : ReportTarget() {
        override val id: String get() = "author-$authorId"
        override val label: String get() = "@$displayName"
    }
    data class Story(val storyId: String, val title: String) : ReportTarget() {
        override val id: String get() = "story-$storyId"
        override val label: String get() = "\u201c$title\u201d"
    }
}

data class SharePayload(val text: String)

@Serializable
data class UserSession(
    val id: String,
    val email: String?,
    val username: String,
    val displayName: String,
    val bio: String,
    val credits: Int,
    val followers: Int,
    val following: Int
)

enum class StoryLanguage(
    val displayName: String,
    val nativeName: String,
    val flagEmoji: String,
    val code: String
) {
    ENGLISH("English", "English", "\uD83C\uDDFA\uD83C\uDDF8", "EN"),
    HINDI("Hindi", "\u0939\u093F\u0928\u094D\u0926\u0940", "\uD83C\uDDEE\uD83C\uDDF3", "HI"),
    SPANISH("Spanish", "Espa\u00F1ol", "\uD83C\uDDEA\uD83C\uDDF8", "ES"),
    FRENCH("French", "Fran\u00E7ais", "\uD83C\uDDEB\uD83C\uDDF7", "FR"),
    GERMAN("German", "Deutsch", "\uD83C\uDDE9\uD83C\uDDEA", "DE"),
    PORTUGUESE("Portuguese", "Portugu\u00EAs", "\uD83C\uDDF5\uD83C\uDDF9", "PT"),
    ITALIAN("Italian", "Italiano", "\uD83C\uDDEE\uD83C\uDDF9", "IT"),
    JAPANESE("Japanese", "\u65E5\u672C\u8A9E", "\uD83C\uDDEF\uD83C\uDDF5", "JA"),
    KOREAN("Korean", "\uD55C\uAD6D\uC5B4", "\uD83C\uDDF0\uD83C\uDDF7", "KO"),
    MANDARIN("Mandarin", "\u4E2D\u6587", "\uD83C\uDDE8\uD83C\uDDF3", "ZH"),
    ARABIC("Arabic", "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", "\uD83C\uDDF8\uD83C\uDDE6", "AR"),
    RUSSIAN("Russian", "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", "\uD83C\uDDF7\uD83C\uDDFA", "RU"),
    INDONESIAN("Indonesian", "Bahasa Indonesia", "\uD83C\uDDEE\uD83C\uDDE9", "ID"),
    TURKISH("Turkish", "T\u00FCrk\u00E7e", "\uD83C\uDDF9\uD83C\uDDF7", "TR"),
    BENGALI("Bengali", "\u09AC\u09BE\u0982\u09B2\u09BE", "\uD83C\uDDE7\uD83C\uDDE9", "BN")
}

data class WizardCharacter(
    val id: String,
    val name: String = "",
    val role: String = "",
    val description: String = ""
)

data class GeneratedChapter(
    val id: String,
    val storyId: String,
    val chapterNumber: Int,
    val title: String,
    val body: String,
    val coverColors: List<Color>,
    var isPublished: Boolean = false,
    var publishedAt: Long? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val contentVersion: Int = 1,
    val coverStatus: CoverGenerationStatus = CoverGenerationStatus.READY,
    val coverAsset: CoverAssetMetadata? = null
) {
    val wordCount: Int get() = body.split(" ").size
    val readingTimeMinutes: Int get() = maxOf(1, wordCount / 200)
    val paragraphs: List<String> get() = body.split("\n\n")

    fun asChapter(): Chapter = Chapter(
        id = id,
        title = title,
        paragraphs = paragraphs,
        storyId = storyId,
        chapterNumber = chapterNumber,
        isPublished = isPublished,
        publishedAt = publishedAt,
        createdAt = createdAt,
        coverColors = coverColors,
        contentVersion = contentVersion,
        coverAsset = coverAsset ?: CoverAssetMetadata("cover-$id-v$contentVersion", contentVersion, coverStatus)
    )
}

data class GeneratedStory(
    val id: String,
    val title: String,
    val authorId: String,
    val genre: Genre,
    val language: StoryLanguage,
    val themes: List<String>,
    val coverColors: List<Color>,
    val firstLine: String,
    val body: String,
    val wordCount: Int,
    val readingTime: Int,
    val plannedChapterCount: Int? = null,
    val isPublished: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    var followerCount: Int = 0,
    val chapters: MutableList<GeneratedChapter> = mutableListOf(),
    val readingLevel: ReadingLevel = ReadingLevel.STANDARD,
    val isSeriesEnded: Boolean = false,
    val contentVersion: Int = 1,
    val coverStatus: CoverGenerationStatus = CoverGenerationStatus.READY
) {
    val synopsis: String get() = firstLine.take(120)
    val isSeries: Boolean get() = chapterCount > 1 || (plannedChapterCount ?: 1) > 1

    val allChapters: List<Chapter>
        get() {
            val result = mutableListOf(
                Chapter(
                    id = "$id-c1",
                    title = "Chapter 1",
                    paragraphs = body.split("\n\n"),
                    storyId = id,
                    chapterNumber = 1,
                    isPublished = isPublished,
                    createdAt = createdAt,
                    coverColors = coverColors,
                    contentVersion = contentVersion,
                    coverAsset = CoverAssetMetadata("cover-$id-v$contentVersion", contentVersion, coverStatus)
                )
            )
            result.addAll(chapters.map { it.asChapter() })
            return result
        }

    fun asStory(): Story = Story(
        id = id,
        title = title,
        authorId = authorId,
        genre = genre,
        synopsis = synopsis,
        chapters = allChapters,
        likes = 0,
        bookmarks = 0,
        views = 0,
        tags = themes,
        publishedOffset = 0,
        isFeatured = false,
        followerCount = followerCount,
        plannedChapterCount = plannedChapterCount,
        contentRating = when (genre) {
            Genre.KIDS -> ContentRating.KIDS
            Genre.HORROR, Genre.EROTICA -> ContentRating.MATURE
            else -> ContentRating.TEEN
        },
        languageCode = language.code,
        language = language.code.lowercase()
    )

    val chapterCount: Int get() = 1 + chapters.size
    val publishedChapterCount: Int get() = (if (isPublished) 1 else 0) + chapters.count { it.isPublished }
}

@Serializable
data class SavedCreationChapter(
    val id: String,
    val storyId: String,
    val chapterNumber: Int,
    val title: String,
    val body: String,
    val isPublished: Boolean,
    val publishedAt: Long?,
    val createdAt: Long,
    val contentVersion: Int,
    val coverStatus: String
)

@Serializable
data class SavedCreationDraft(
    val id: String,
    val title: String,
    val authorId: String,
    val genre: String,
    val language: String,
    val themes: List<String>,
    val firstLine: String,
    val body: String,
    val plannedChapterCount: Int?,
    val isPublished: Boolean,
    val createdAt: Long,
    val readingLevel: String,
    val followerCount: Int,
    val chapters: List<SavedCreationChapter>,
    val isSeriesEnded: Boolean,
    val contentVersion: Int,
    val coverStatus: String
)

fun GeneratedStory.toSavedCreationDraft(): SavedCreationDraft = SavedCreationDraft(
    id = id,
    title = title,
    authorId = authorId,
    genre = genre.name,
    language = language.name,
    themes = themes,
    firstLine = firstLine,
    body = body,
    plannedChapterCount = plannedChapterCount,
    isPublished = isPublished,
    createdAt = createdAt,
    readingLevel = readingLevel.name,
    followerCount = followerCount,
    chapters = chapters.map { chapter ->
        SavedCreationChapter(chapter.id, chapter.storyId, chapter.chapterNumber, chapter.title, chapter.body, chapter.isPublished, chapter.publishedAt, chapter.createdAt, chapter.contentVersion, chapter.coverStatus.name)
    },
    isSeriesEnded = isSeriesEnded,
    contentVersion = contentVersion,
    coverStatus = coverStatus.name
)

fun SavedCreationDraft.toGeneratedStory(): GeneratedStory {
    val resolvedGenre = runCatching { Genre.valueOf(genre) }.getOrDefault(Genre.CONTEMPORARY)
    val resolvedLanguage = runCatching { StoryLanguage.valueOf(language) }.getOrDefault(StoryLanguage.ENGLISH)
    val resolvedLevel = runCatching { ReadingLevel.valueOf(readingLevel) }.getOrDefault(ReadingLevel.STANDARD)
    val resolvedCoverStatus = runCatching { CoverGenerationStatus.valueOf(coverStatus) }.getOrDefault(CoverGenerationStatus.READY)
    return GeneratedStory(
        id = id,
        title = title,
        authorId = authorId,
        genre = resolvedGenre,
        language = resolvedLanguage,
        themes = themes,
        coverColors = resolvedGenre.coverColors,
        firstLine = firstLine,
        body = body,
        wordCount = body.split(" ").size,
        readingTime = maxOf(1, body.split(" ").size / 200),
        plannedChapterCount = plannedChapterCount,
        isPublished = isPublished,
        createdAt = createdAt,
        followerCount = followerCount,
        chapters = chapters.map { chapter ->
            val chapterStatus = runCatching { CoverGenerationStatus.valueOf(chapter.coverStatus) }.getOrDefault(CoverGenerationStatus.READY)
            GeneratedChapter(chapter.id, chapter.storyId, chapter.chapterNumber, chapter.title, chapter.body, resolvedGenre.coverColors, chapter.isPublished, chapter.publishedAt, chapter.createdAt, chapter.contentVersion, chapterStatus)
        }.toMutableList(),
        readingLevel = resolvedLevel,
        isSeriesEnded = isSeriesEnded,
        contentVersion = contentVersion,
        coverStatus = resolvedCoverStatus
    )
}

enum class WizardStep(val title: String, val number: Int) {
    GENRE("Genre", 1),
    TOPIC("Topic", 2),
    CHARACTERS("Characters", 3),
    REVIEW("Review", 4)
}

enum class ContinueWizardStep(val number: Int) {
    DIRECTION(1),
    REVIEW(2)
}

data class NewChapterNotification(
    val id: String,
    val storyId: String,
    val storyTitle: String,
    val chapterNumber: Int,
    val coverColors: List<Color>,
    val genre: Genre,
    val publishedAt: Long,
    var isRead: Boolean = false
)

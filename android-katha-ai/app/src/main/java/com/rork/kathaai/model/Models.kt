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

enum class Genre(
    val displayName: String,
    val coverColors: List<Color>,
    val icon: ImageVector
) {
    FICTION("Fiction", listOf(Color(0xFFE89F3D), Color(0xFFC8842A), Color(0xFF8B5A2A)), Icons.Outlined.MenuBook),
    MYSTERY("Mystery", listOf(Color(0xFF2C3E50), Color(0xFF1A2A36), Color(0xFF0D1620)), Icons.Outlined.Search),
    ROMANCE("Romance", listOf(Color(0xFFC45B7B), Color(0xFF8B2D4B), Color(0xFF5A1D33)), Icons.Outlined.FavoriteBorder),
    SCIFI("Sci-Fi", listOf(Color(0xFF4A3A8E), Color(0xFF2D1A5A), Color(0xFF1A0D3A)), Icons.Outlined.Rocket),
    FANTASY("Fantasy", listOf(Color(0xFF5B8A5B), Color(0xFF3A6B3A), Color(0xFF1A4A2A)), Icons.Outlined.AutoAwesome),
    HORROR("Horror", listOf(Color(0xFF5A1D1D), Color(0xFF3A0D0D), Color(0xFF1A0505)), Icons.Outlined.DarkMode),
    POETRY("Poetry", listOf(Color(0xFF8E7A9E), Color(0xFF6B5B8E), Color(0xFF4A3A6B)), Icons.Outlined.FormatQuote),
    LITERARY("Literary", listOf(Color(0xFF5A4A3A), Color(0xFF3A2D1D), Color(0xFF1A1205)), Icons.AutoMirrored.Outlined.MenuBook),
    ADVENTURE("Adventure", listOf(Color(0xFFE87B4A), Color(0xFFC04A2D), Color(0xFF8B2A1A)), Icons.Outlined.Terrain),
    FOLKLORE("Folklore", listOf(Color(0xFFB8A03D), Color(0xFF8E7A2A), Color(0xFF5A4D1A)), Icons.Outlined.Park),
    THRILLER("Thriller", listOf(Color(0xFF3A3A3A), Color(0xFF1A1A1A), Color(0xFF0D0D0D)), Icons.Outlined.Bolt),
    SLICE_OF_LIFE("Slice of Life", listOf(Color(0xFFD4A574), Color(0xFFA67B52), Color(0xFF6B4F35)), Icons.Outlined.Coffee),
    HISTORICAL("Historical", listOf(Color(0xFF8B7355), Color(0xFF6B5235), Color(0xFF3A2D1A)), Icons.Outlined.HistoryEdu),
    CONTEMPORARY("Contemporary", listOf(Color(0xFF4A9A9A), Color(0xFF2D6B6B), Color(0xFF1A4A4A)), Icons.Outlined.Map),
    LGBTQ("LGBTQ+", listOf(Color(0xFFE84A7B), Color(0xFFC42D5B), Color(0xFF8B1D3D)), Icons.Outlined.Transgender),
    COMEDY("Comedy", listOf(Color(0xFFF0C04A), Color(0xFFD4A02D), Color(0xFF8B7020)), Icons.Outlined.SentimentSatisfied),
    DRAMA("Drama", listOf(Color(0xFF6B4A6B), Color(0xFF4A2D4A), Color(0xFF2A1A2A)), Icons.Outlined.TheaterComedy),
    MYTHOLOGY("Mythology", listOf(Color(0xFFB85A2D), Color(0xFF8B3A1A), Color(0xFF5A1D0D)), Icons.Outlined.Fireplace),
    SPIRITUALITY("Spirituality", listOf(Color(0xFF6B8E6B), Color(0xFF4A6B4A), Color(0xFF2A4A2A)), Icons.Outlined.Spa),
    MOTIVATIONAL("Motivational", listOf(Color(0xFFE8B83D), Color(0xFFC8982A), Color(0xFF8B6B1A)), Icons.Outlined.Lightbulb),
    KIDS("Kids", listOf(Color(0xFFFFB347), Color(0xFFFF8C42), Color(0xFFCC6A2D)), Icons.Outlined.ChildCare)
}

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
    val coverColors: List<Color>? = null
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
    val plannedChapterCount: Int? = null
) {
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
    val createdAt: Long = System.currentTimeMillis()
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
        coverColors = coverColors
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
    val isPublished: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
    var followerCount: Int = 0,
    val chapters: MutableList<GeneratedChapter> = mutableListOf()
) {
    val synopsis: String get() = firstLine.take(120)

    val allChapters: List<Chapter>
        get() {
            val result = mutableListOf(
                Chapter(
                    id = "$id-c1",
                    title = "Chapter 1",
                    paragraphs = body.split("\n\n"),
                    storyId = id,
                    chapterNumber = 1,
                    isPublished = true,
                    createdAt = createdAt,
                    coverColors = coverColors
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
        plannedChapterCount = plannedChapterCount
    )

    val chapterCount: Int get() = 1 + chapters.size
    val publishedChapterCount: Int get() = 1 + chapters.count { it.isPublished }
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

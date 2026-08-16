package com.rork.kathaai.model

import kotlinx.serialization.Serializable

// MARK: - Time Range

enum class AnalyticsTimeRange(val label: String, val dayCount: Int?) {
    SEVEN_DAYS("7 days", 7),
    THIRTY_DAYS("30 days", 30),
    ALL_TIME("All time", null);
}

// MARK: - Daily Reads

@Serializable
data class DailyReads(
    val dateISO: String,
    val reads: Int,
    val uniqueReads: Int
)

// MARK: - Chapter Reads

@Serializable
data class ChapterReads(
    val chapterId: String,
    val reads: Int,
    val uniqueReads: Int,
    val completionRate: Double
)

// MARK: - Story Analytics

@Serializable
data class StoryAnalytics(
    val dailyReads: List<DailyReads> = emptyList(),
    val chapterReads: List<ChapterReads> = emptyList(),
    val milestonesCrossed: Set<String> = emptySet(),
    val creditsEarnedFromReads: Int = 0,
    val followersGainedFromStory: Int = 0,
    val authorFollowersGainedViaStory: Int = 0,
    val lastUpdated: Long = System.currentTimeMillis()
)

// MARK: - Milestone Key

enum class MilestoneKey(val key: String, val label: String, val icon: String) {
    PUBLISH("publish", "Published", "paperplane"),
    FIRST_READ("first_read", "First read ✨", "eye"),
    READS_10("reads_10", "10 reads", "book"),
    READS_100("reads_100", "100 reads", "book"),
    READS_500("reads_500", "500 reads", "book"),
    READS_1000("reads_1000", "1,000 reads", "book"),
    READS_10000("reads_10000", "10,000 reads", "book"),
    FOLLOWERS_10("followers_10", "10 story followers", "heart"),
    FOLLOWERS_100("followers_100", "100 story followers", "heart"),
    FOLLOWERS_500("followers_500", "500 story followers", "heart"),
    FOLLOWERS_1000("followers_1000", "1,000 story followers", "heart"),
    FIRST_CREDIT("first_credit", "First credit earned ✨", "credits"),
    CREDITS_10("credits_10", "10 credits from reads", "credits"),
    CREDITS_50("credits_50", "50 credits from reads", "credits"),
    CREDITS_100("credits_100", "100 credits from reads", "credits"),
    AUTHOR_FOLLOWERS_100("author_followers_100", "100 people follow you", "person_2");

    companion object {
        fun fromKey(key: String): MilestoneKey? = entries.firstOrNull { it.key == key }
    }

    fun isCrossed(totalReads: Int, storyFollowers: Int, creditsEarned: Int, isPublished: Boolean, authorFollowers: Int): Boolean {
        return when (this) {
            PUBLISH -> isPublished
            FIRST_READ -> totalReads >= 1
            READS_10 -> totalReads >= 10
            READS_100 -> totalReads >= 100
            READS_500 -> totalReads >= 500
            READS_1000 -> totalReads >= 1000
            READS_10000 -> totalReads >= 10000
            FOLLOWERS_10 -> storyFollowers >= 10
            FOLLOWERS_100 -> storyFollowers >= 100
            FOLLOWERS_500 -> storyFollowers >= 500
            FOLLOWERS_1000 -> storyFollowers >= 1000
            FIRST_CREDIT -> creditsEarned >= 1
            CREDITS_10 -> creditsEarned >= 10
            CREDITS_50 -> creditsEarned >= 50
            CREDITS_100 -> creditsEarned >= 100
            AUTHOR_FOLLOWERS_100 -> authorFollowers >= 100
        }
    }

    fun celebrationTitle(): String = when (this) {
        PUBLISH -> "Your story is live ✨"
        FIRST_READ -> "Your first reader found you"
        READS_10 -> "10 reads on your story 📖"
        READS_100 -> "100 reads on your story 🎉"
        READS_500 -> "500 reads on your story 🔥"
        READS_1000 -> "1,000 reads on your story 💫"
        READS_10000 -> "10,000 reads. Katha royalty. 👑"
        FOLLOWERS_10 -> "10 followers on your story"
        FOLLOWERS_100 -> "100 followers ✨"
        FOLLOWERS_500 -> "500 followers 🌟"
        FOLLOWERS_1000 -> "1,000 followers 👑"
        FIRST_CREDIT -> "First credit earned from a reader ✨"
        CREDITS_10 -> "10 credits earned 💰"
        CREDITS_50 -> "50 credits earned 🌟"
        CREDITS_100 -> "100 credits earned 👑"
        AUTHOR_FOLLOWERS_100 -> "100 people follow you"
    }

    fun celebrationSubtitle(storyTitle: String): String = when (this) {
        PUBLISH -> "'$storyTitle' just went out into the world"
        FIRST_READ -> "Someone just read '$storyTitle'"
        READS_10 -> "You're being read."
        READS_100 -> "That's a hundred people spent time with your words."
        READS_500 -> "You've officially got an audience."
        READS_1000 -> "A milestone worth celebrating. Keep writing."
        READS_10000 -> "'$storyTitle' has hit a rare milestone."
        FOLLOWERS_10 -> "Ten people are waiting for your next chapter."
        FOLLOWERS_100 -> "A hundred readers are following '$storyTitle'."
        FOLLOWERS_500 -> "Impressive. '$storyTitle' has a real following."
        FOLLOWERS_1000 -> "'$storyTitle' is one of Katha's most-followed."
        FIRST_CREDIT -> "'$storyTitle' just paid for its next chapter."
        CREDITS_10 -> "'$storyTitle' has funded your next 10 generations."
        CREDITS_50 -> "'$storyTitle' is a real earner. Keep writing."
        CREDITS_100 -> "'$storyTitle' is bankrolling your creative practice."
        AUTHOR_FOLLOWERS_100 -> "You've built a real audience on Katha."
    }
}

// MARK: - Unseen Milestone

@Serializable
data class UnseenMilestone(
    val id: String,
    val milestoneKey: String,
    val storyId: String,
    val storyTitle: String,
    val timestamp: Long = System.currentTimeMillis()
)

// MARK: - Stat Trend

data class StatTrend(val delta: Int) {
    val isPositive: Boolean get() = delta > 0
    val label: String get() = if (delta == 0) "No change" else "${if (delta > 0) "+" else ""}$delta vs previous period"
}

// MARK: - Sort Metric

enum class MilestoneSortMetric(val label: String) {
    READS("By reads"),
    CREDITS("By credits"),
    FOLLOWERS("By followers")
}

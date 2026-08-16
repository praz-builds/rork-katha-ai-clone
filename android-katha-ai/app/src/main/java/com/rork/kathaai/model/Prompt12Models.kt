package com.rork.kathaai.model

import kotlinx.serialization.Serializable

@Serializable
data class StreakDay(
    val date: Long,
    val active: Boolean,
    val freezeUsed: Boolean = false,
    val summary: String = ""
)

@Serializable
data class StreakState(
    val current: Int = 0,
    val longest: Int = 0,
    val lastActivityDate: Long? = null,
    val nextCreditIn: Int = 3,
    val freezesAvailable: Int = 0,
    val history: List<StreakDay> = emptyList()
)

@Serializable
data class NotificationPreferences(
    val storyNewChapters: Boolean = true,
    val storyNewStories: Boolean = true,
    val storyComments: Boolean = true,
    val storyLikes: Boolean = false,
    val streakReminders: Boolean = true,
    val milestoneCelebrations: Boolean = true,
    val creditsEarned: Boolean = true,
    val weeklyDigest: Boolean = true,
    val newWriters: Boolean = false
)

@Serializable
data class ReferralRecord(
    val id: String,
    val displayName: String,
    val username: String,
    val joinedAt: Long,
    val firstStoryGeneratedAt: Long? = null,
    val credited: Boolean = false
)

@Serializable
data class OfflineStoryRecord(
    val storyId: String,
    val title: String,
    val sizeMb: Double,
    val downloadedAt: Long
)

sealed class SleepTimerOption {
    data object OFF : SleepTimerOption()
    data object END_OF_CHAPTER : SleepTimerOption()
    data class MINUTES(val minutes: Int) : SleepTimerOption()
}

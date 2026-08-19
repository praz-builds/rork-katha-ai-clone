package com.rork.kathaai.viewmodel

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.viewModelScope
import androidx.core.content.ContextCompat
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.CreditReason
import com.rork.kathaai.model.OfflineStoryRecord
import com.rork.kathaai.model.ReferralRecord
import com.rork.kathaai.model.SleepTimerOption
import com.rork.kathaai.model.StreakDay
import java.util.Calendar
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.content.BroadcastReceiver

/** Prompt 12 retention, notification, referral, offline, and player behavior. */
fun AppViewModel.recordStreakActivity(summary: String = "Story activity") {
    val state = uiState.value
    if (!state.isAuthenticated) return
    val today = startOfDay(System.currentTimeMillis())
    val currentStreak = state.streak
    val nextCurrent: Int
    val nextFreezes: Int
    val updatedHistory = currentStreak.history.toMutableList()
    val last = currentStreak.lastActivityDate
    val gap = if (last == null) 0 else ((today - startOfDay(last)) / DAY_MS).toInt()
    var usedFreeze = false
    when {
        last == null -> nextCurrent = 1
        gap <= 0 -> {
            val existing = updatedHistory.indexOfFirst { startOfDay(it.date) == today }
            if (existing >= 0) updatedHistory[existing] = StreakDay(today, true, updatedHistory[existing].freezeUsed, summary)
            else updatedHistory.add(StreakDay(today, true, false, summary))
            _replacePrompt12State(state.copy(streak = currentStreak.copy(history = trimHistory(updatedHistory))))
            return
        }
        gap == 1 -> nextCurrent = currentStreak.current + 1
        gap == 2 && state.isPremium && currentStreak.freezesAvailable > 0 -> {
            updatedHistory.add(StreakDay(today - DAY_MS, false, true, "Streak freeze used"))
            usedFreeze = true
            nextCurrent = currentStreak.current + 1
        }
        else -> {
            if (currentStreak.current > 0) showToast("Your streak reset — start a new one today")
            nextCurrent = 1
        }
    }
    nextFreezes = if (usedFreeze) currentStreak.freezesAvailable - 1 else currentStreak.freezesAvailable
    updatedHistory.removeAll { startOfDay(it.date) == today }
    updatedHistory.add(StreakDay(today, true, false, summary))
    val longest = maxOf(currentStreak.longest, nextCurrent)
    val nextCredit = if (nextCurrent % 3 == 0) 3 else 3 - (nextCurrent % 3)
    val nextState = state.copy(
        streak = currentStreak.copy(current = nextCurrent, longest = longest, lastActivityDate = today, nextCreditIn = nextCredit, freezesAvailable = nextFreezes, history = trimHistory(updatedHistory)),
        activeDayCount = state.activeDayCount + 1,
        showStreakResetModal = state.showStreakResetModal || (gap > 2 && currentStreak.current > 0)
    )
    _replacePrompt12State(nextState)
    if (usedFreeze) showToast("Streak freeze used ❄️")
    if (nextCurrent % 3 == 0 && state.creditLedger.none { it.reason == CreditReason.STREAK.key && it.referenceId == "streak-$today" }) {
        addCredits(1, CreditReason.STREAK, "streak-$today")
        showToast("3-day streak reward: +1 credit ✨")
    }
    if (nextCurrent in listOf(3, 7, 14, 30, 100)) showToast("$nextCurrent-day streak milestone ✨")
}

private fun AppViewModel._replacePrompt12State(next: KathaUiState) {
    replaceState(next)
    persistPrompt12StateInternal()
}

private fun AppViewModel.replaceState(next: KathaUiState) {
    setPrompt12State(next)
}

private fun startOfDay(timestamp: Long): Long {
    val calendar = Calendar.getInstance().apply { timeInMillis = timestamp; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
    return calendar.timeInMillis
}

private fun trimHistory(history: List<StreakDay>): List<StreakDay> = history.distinctBy { startOfDay(it.date) }.sortedByDescending { it.date }.take(90)
private const val DAY_MS = 86_400_000L

fun AppViewModel.openStreakScreen() = setPrompt12State(uiState.value.copy(showStreakScreen = true))
fun AppViewModel.closeStreakScreen() = setPrompt12State(uiState.value.copy(showStreakScreen = false))
fun AppViewModel.openNotificationsScreen() = setPrompt12State(uiState.value.copy(showNotificationsScreen = true))
fun AppViewModel.closeNotificationsScreen() = setPrompt12State(uiState.value.copy(showNotificationsScreen = false))
fun AppViewModel.openInviteFriendsScreen() {
    val code = uiState.value.referralCode.ifEmpty { (uiState.value.currentUser?.username ?: UUID.randomUUID().toString()).replace("-", "").take(9) }
    setPrompt12State(uiState.value.copy(showInviteFriendsScreen = true, referralCode = code))
}
fun AppViewModel.closeInviteFriendsScreen() = setPrompt12State(uiState.value.copy(showInviteFriendsScreen = false))
fun AppViewModel.openStorageScreen() = setPrompt12State(uiState.value.copy(showStorageScreen = true))
fun AppViewModel.closeStorageScreen() = setPrompt12State(uiState.value.copy(showStorageScreen = false))

fun AppViewModel.referralLink(): String = "https://katha.ai/r/${uiState.value.referralCode.ifEmpty { "writer" }}"
fun AppViewModel.copyReferralLink(context: Context) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Katha referral link", referralLink()))
    showToast("Link copied ✨")
}
fun AppViewModel.shareReferralLink() {
    setPrompt12State(uiState.value.copy(sharePayload = com.rork.kathaai.model.SharePayload("I've been writing stories on Katha AI. Join me and get an extra credit to start:\n\n${referralLink()}")))
}

fun AppViewModel.setNotificationPreference(key: String, enabled: Boolean) {
    val old = uiState.value.notificationPreferences
    val next = when (key) {
        "chapters" -> old.copy(storyNewChapters = enabled)
        "stories" -> old.copy(storyNewStories = enabled)
        "comments" -> old.copy(storyComments = enabled)
        "likes" -> old.copy(storyLikes = enabled)
        "streak" -> old.copy(streakReminders = enabled)
        "milestones" -> old.copy(milestoneCelebrations = enabled)
        "credits" -> old.copy(creditsEarned = enabled)
        "digest" -> old.copy(weeklyDigest = enabled)
        "writers" -> old.copy(newWriters = enabled)
        else -> old
    }
    setPrompt12State(uiState.value.copy(notificationPreferences = next))
}

fun AppViewModel.requestNotificationPermission(context: Context) {
    if (Build.VERSION.SDK_INT >= 33 && context is Activity && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        context.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1201)
    }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("katha_progress", "Katha progress", NotificationManager.IMPORTANCE_DEFAULT))
    scheduleStreakReminder(context)
    val token = "mock-device-token-${UUID.randomUUID()}"
    println("[Katha] Registered $token")
    // TODO: Send device token to /register-device edge function for push targeting
    setPrompt12State(uiState.value.copy(notificationPermissionGranted = true, showPrePermissionModal = false))
    showToast("Notifications enabled ✨")
}

private fun AppViewModel.scheduleStreakReminder(context: Context) {
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = Intent(context, StreakReminderReceiver::class.java)
    val pending = PendingIntent.getBroadcast(context, 1202, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val calendar = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 20); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1) }
    alarm.setInexactRepeating(AlarmManager.RTC_WAKEUP, calendar.timeInMillis, DAY_MS, pending)
}

fun AppViewModel.handleDeepLink(uri: Uri) {
    val parts = uri.pathSegments
    val first = parts.firstOrNull() ?: return
    when {
        first == "r" && parts.size > 1 -> setPrompt12State(uiState.value.copy(referredByCode = parts[1]))
        first == "s" && parts.size > 1 -> openReader(parts[1], 0)
        first.startsWith("@") -> openAuthorProfile(first.removePrefix("@"))
    }
}

fun AppViewModel.openSystemNotificationSettings(context: Context) {
    context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply { putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName) })
}
fun AppViewModel.dismissPrePermission() = setPrompt12State(uiState.value.copy(showPrePermissionModal = false))

fun AppViewModel.downloadStory(storyId: String) {
    val state = uiState.value
    if (state.offlineStoryRecords.any { it.storyId == storyId } || state.downloadProgress != null) return
    val story = SeedData.story(storyId) ?: state.publishedStories.firstOrNull { it.id == storyId }?.asStory() ?: return
    viewModelScope.launch {
        for (step in 1..maxOf(1, story.chapters.size)) {
            delay(180)
            setPrompt12State(uiState.value.copy(downloadProgress = step.toFloat() / maxOf(1, story.chapters.size), downloadStoryTitle = story.title))
        }
        val record = OfflineStoryRecord(story.id, story.title, maxOf(1, story.chapters.size) * 1.8, System.currentTimeMillis())
        setPrompt12State(uiState.value.copy(offlineStoryRecords = uiState.value.offlineStoryRecords.filterNot { it.storyId == story.id } + record, downloadProgress = null))
        showToast("Downloaded ✨ — now available offline")
    }
}
fun AppViewModel.removeOfflineStory(storyId: String) = setPrompt12State(uiState.value.copy(offlineStoryRecords = uiState.value.offlineStoryRecords.filterNot { it.storyId == storyId }))
fun AppViewModel.clearOfflineStories() = setPrompt12State(uiState.value.copy(offlineStoryRecords = emptyList()))

fun AppViewModel.openAudioPlayer(storyId: String) {
    if (audioState(storyId) != AppViewModel.AudioBarState.READY) { showToast("Audio preparing — usually ready in 8–15 seconds"); return }
    setPrompt12State(uiState.value.copy(audioPlayerStoryId = storyId, showAudioPlayer = true))
}
fun AppViewModel.closeAudioPlayer() = setPrompt12State(uiState.value.copy(showAudioPlayer = false))
fun AppViewModel.toggleAudioPlayback() = setPrompt12State(uiState.value.copy(audioIsPlaying = !uiState.value.audioIsPlaying))
fun AppViewModel.seekAudio(value: Float) = setPrompt12State(uiState.value.copy(audioProgress = value.coerceIn(0f, 1f)))
fun AppViewModel.skipAudio(seconds: Int) = setPrompt12State(uiState.value.copy(audioProgress = (uiState.value.audioProgress + seconds / 600f).coerceIn(0f, 1f)))
fun AppViewModel.setAudioSpeed(speed: Float) = setPrompt12State(uiState.value.copy(audioSpeed = speed))
fun AppViewModel.setSleepTimer(option: SleepTimerOption) {
    val end = when (option) { SleepTimerOption.OFF -> null; SleepTimerOption.END_OF_CHAPTER -> System.currentTimeMillis() + 600_000; is SleepTimerOption.MINUTES -> System.currentTimeMillis() + option.minutes * 60_000L }
    setPrompt12State(uiState.value.copy(audioSleepTimerEnd = end))
}
fun AppViewModel.advanceAudio() {
    val state = uiState.value
    if (!state.audioIsPlaying) return
    val progress = (state.audioProgress + state.audioSpeed / 600f).coerceAtMost(1f)
    val expired = state.audioSleepTimerEnd?.let { it <= System.currentTimeMillis() } == true
    setPrompt12State(state.copy(audioProgress = progress, audioIsPlaying = progress < 1f && !expired, audioSleepTimerEnd = if (expired) null else state.audioSleepTimerEnd))
    if (expired) showToast("Sleep timer ended")
}

fun AppViewModel.maybeRequestRating() {
    val state = uiState.value
    if (state.storyGenerationCount < 3 || state.activeDayCount < 3 || (state.likedStoryIds.size < 5 && state.userComments.size < 2 && state.storyShareOverrides.isEmpty())) return
    if (state.ratePromptLastShown != null && System.currentTimeMillis() - state.ratePromptLastShown < 90L * DAY_MS) return
    setPrompt12State(state.copy(ratePromptLastShown = System.currentTimeMillis(), showRatePrompt = true))
}

private fun AppViewModel.setPrompt12State(next: KathaUiState) {
    updatePrompt12State(next)
    persistPrompt12StateInternal()
}

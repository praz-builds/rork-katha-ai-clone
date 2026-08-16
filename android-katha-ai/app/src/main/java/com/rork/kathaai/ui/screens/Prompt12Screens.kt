package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AcUnit
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FastForward
import androidx.compose.material.icons.outlined.FastRewind
import androidx.compose.material.icons.outlined.Fireplace
import androidx.compose.material.icons.outlined.GifBox
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.util.Calendar
import com.rork.kathaai.data.SeedData
import com.google.android.play.core.review.ReviewManagerFactory
import com.rork.kathaai.model.SleepTimerOption
import com.rork.kathaai.model.StreakDay
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.components.DestructiveCTA
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.components.StoryCover
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import com.rork.kathaai.viewmodel.closeAudioPlayer
import com.rork.kathaai.viewmodel.closeInviteFriendsScreen
import com.rork.kathaai.viewmodel.closeNotificationsScreen
import com.rork.kathaai.viewmodel.closeStreakScreen
import com.rork.kathaai.viewmodel.closeStorageScreen
import com.rork.kathaai.viewmodel.copyReferralLink
import com.rork.kathaai.viewmodel.openSystemNotificationSettings
import com.rork.kathaai.viewmodel.openAudioPlayer
import com.rork.kathaai.viewmodel.referralLink
import com.rork.kathaai.viewmodel.removeOfflineStory
import com.rork.kathaai.viewmodel.clearOfflineStories
import com.rork.kathaai.viewmodel.setNotificationPreference
import com.rork.kathaai.viewmodel.requestNotificationPermission
import com.rork.kathaai.viewmodel.dismissPrePermission
import com.rork.kathaai.viewmodel.seekAudio
import com.rork.kathaai.viewmodel.skipAudio
import com.rork.kathaai.viewmodel.toggleAudioPlayback
import com.rork.kathaai.viewmodel.setAudioSpeed
import com.rork.kathaai.viewmodel.setSleepTimer
import com.rork.kathaai.viewmodel.advanceAudio

@Composable
fun Prompt12NavBar(title: String, onBack: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp).navigationBarsPadding(), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.ChevronLeft, "Back", tint = KathaTheme.textPrimary, modifier = Modifier.size(44.dp).clickable(onClick = onBack).padding(10.dp))
        Text(title, color = KathaTheme.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun StreakHeroCard(state: KathaUiState, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(KathaTheme.surface).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(100.dp).clip(CircleShape).background(KathaTheme.accentSoft), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Fireplace, "Streak", tint = KathaTheme.accent, modifier = Modifier.size(64.dp)) }
        Text("${state.streak.current}", color = KathaTheme.textPrimary, fontSize = 52.sp, fontWeight = FontWeight.SemiBold)
        Text("DAY STREAK", color = KathaTheme.textTertiary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Text(if (state.streak.current == 0) "Start a small reading habit today" else "Keep it going — ${state.streak.nextCreditIn} more days until your next credit", color = KathaTheme.textSecondary, fontSize = 15.sp, textAlign = TextAlign.Center)
        if (state.streak.freezesAvailable > 0) Text("❄️ ${state.streak.freezesAvailable} FREEZES THIS MONTH", color = KathaTheme.accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(KathaTheme.accentSoft).padding(horizontal = 10.dp, vertical = 7.dp))
    }
}

@Composable
fun StreakCalendar(state: KathaUiState, modifier: Modifier = Modifier) {
    val today = remember { startOfDay(System.currentTimeMillis()) }
    var selected by remember { mutableStateOf<StreakDay?>(null) }
    val days = remember(state.streak.history) { (29 downTo 0).map { offset -> val date = today - offset * 86_400_000L; state.streak.history.firstOrNull { startOfDay(it.date) == date } ?: StreakDay(date, false, false, "No activity logged") } }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("LAST 30 DAYS", color = KathaTheme.textTertiary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface).border(1.dp, KathaTheme.border, RoundedCornerShape(16.dp)).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth()) { listOf("S", "M", "T", "W", "T", "F", "S").forEach { Text(it, color = KathaTheme.textTertiary, fontSize = 10.sp, modifier = Modifier.weight(1f), textAlign = TextAlign.Center) } }
            LazyVerticalGrid(columns = GridCells.Fixed(7), modifier = Modifier.height(190.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp), userScrollEnabled = false) {
                items(days) { day ->
                    Box(Modifier.size(32.dp).clip(CircleShape).background(if (day.active) KathaTheme.accent else if (day.freezeUsed) Color(0xFF7BA3E8) else KathaTheme.canvas).clickable { selected = day }, contentAlignment = Alignment.Center) {
                        if (day.active) Icon(Icons.Outlined.Fireplace, null, tint = Color.White, modifier = Modifier.size(12.dp))
                        if (day.freezeUsed) Icon(Icons.Outlined.AcUnit, null, tint = Color.White, modifier = Modifier.size(12.dp))
                    }
                }
            }
        }
        selected?.let { Text("${java.text.SimpleDateFormat("MMM d", java.util.Locale.getDefault()).format(it.date)} · ${it.summary}", color = KathaTheme.textSecondary, fontSize = 12.sp) }
    }
}

@Composable
fun StreakScreen(state: KathaUiState, viewModel: AppViewModel, modifier: Modifier = Modifier) {
    LazyColumn(modifier.fillMaxSize().background(KathaTheme.canvas), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        item { Prompt12NavBar("Your journey", { viewModel.closeStreakScreen() }) }
        item { StreakHeroCard(state) }
        item { StreakCalendar(state) }
        item {
            Text("MILESTONES", color = KathaTheme.textTertiary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            val milestones = listOf(3 to "First 3-day streak", 7 to "One week straight", 14 to "Two weeks strong", 30 to "Month of stories", 100 to "100-day streak legend")
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface).padding(horizontal = 16.dp)) {
                milestones.forEachIndexed { index, item ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(if (state.streak.longest >= item.first) Icons.Outlined.CheckCircle else Icons.Outlined.Fireplace, null, tint = if (state.streak.longest >= item.first) KathaTheme.success else KathaTheme.borderStrong, modifier = Modifier.size(20.dp))
                        Column(Modifier.weight(1f)) { Text(item.second, color = KathaTheme.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold); Text("${item.first} days", color = KathaTheme.textSecondary, fontSize = 12.sp) }
                    }
                    if (index < milestones.lastIndex) Divider(color = KathaTheme.border)
                }
            }
        }
        item { Text(if (state.streak.current > 0 && state.streak.current == state.streak.longest) "Your longest streak — keep going ✨" else "Your longest streak: ${state.streak.longest} days", color = KathaTheme.textTertiary, fontSize = 12.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
        item { SafeBottomSpacer() }
    }
}

@Composable
fun NotificationsScreen(state: KathaUiState, viewModel: AppViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    LazyColumn(modifier.fillMaxSize().background(KathaTheme.canvas), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item { Prompt12NavBar("Notifications", { viewModel.closeNotificationsScreen() }) }
        item {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                NotificationToggle("Push notifications", state.notificationPermissionGranted, { viewModel.requestNotificationPermission(context) })
                if (!state.notificationPermissionGranted) TextLink("Open device settings") { viewModel.openSystemNotificationSettings(context) }
            }
        }
        item { NotificationSection("STORY ACTIVITY", state, viewModel, listOf("New chapters from stories you follow" to "chapters", "New stories from writers you follow" to "stories", "Someone commented on your story" to "comments", "Someone liked your story" to "likes")) }
        item { NotificationSection("YOUR PROGRESS", state, viewModel, listOf("Streak reminders" to "streak", "Milestone celebrations" to "milestones", "Credits earned from your stories" to "credits")) }
        item { NotificationSection("RECOMMENDATIONS", state, viewModel, listOf("Weekly Katha's picks digest" to "digest", "New writers to follow" to "writers")) }
        item { SafeBottomSpacer() }
    }
}

@Composable
private fun NotificationSection(title: String, state: KathaUiState, viewModel: AppViewModel, rows: List<Pair<String, String>>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, color = KathaTheme.textTertiary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface).padding(horizontal = 16.dp)) {
            rows.forEachIndexed { index, row ->
                val checked = when (row.second) { "chapters" -> state.notificationPreferences.storyNewChapters; "stories" -> state.notificationPreferences.storyNewStories; "comments" -> state.notificationPreferences.storyComments; "likes" -> state.notificationPreferences.storyLikes; "streak" -> state.notificationPreferences.streakReminders; "milestones" -> state.notificationPreferences.milestoneCelebrations; "credits" -> state.notificationPreferences.creditsEarned; "digest" -> state.notificationPreferences.weeklyDigest; else -> state.notificationPreferences.newWriters }
                NotificationToggle(row.first, checked, { viewModel.setNotificationPreference(row.second, it) })
                if (index < rows.lastIndex) Divider(color = KathaTheme.border)
            }
        }
    }
}

@Composable
private fun NotificationToggle(title: String, checked: Boolean, onChanged: (Boolean) -> Unit) { Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { Text(title, color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f)); Switch(checked, onCheckedChange = onChanged) } }

@Composable
fun InviteFriendsScreen(state: KathaUiState, viewModel: AppViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    LazyColumn(modifier.fillMaxSize().background(KathaTheme.canvas), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        item { Prompt12NavBar("Invite friends", { viewModel.closeInviteFriendsScreen() }) }
        item { Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) { Icon(Icons.Outlined.CardGiftcard, null, tint = KathaTheme.accent, modifier = Modifier.size(96.dp)); Text("Give friends a taste of Katha", color = KathaTheme.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center); Text("You get 3 credits when they generate their first story. They get 1 extra credit on top of the welcome bonus.", color = KathaTheme.textSecondary, fontSize = 15.sp, textAlign = TextAlign.Center) } }
        item { Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(KathaTheme.surface).border(1.dp, KathaTheme.border, RoundedCornerShape(14.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Text(viewModel.referralLink(), color = KathaTheme.textPrimary, fontSize = 13.sp, modifier = Modifier.weight(1f), maxLines = 1); TextButton({ viewModel.copyReferralLink(context) }) { Text("Copy", color = KathaTheme.accent) } } }
        item { PrimaryCTA("Share your link", onClick = { viewModel.shareReferralLink() }) }
        item { Text("YOUR REFERRALS", color = KathaTheme.textTertiary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
        if (state.referralRecords.isEmpty()) item { EmptyState(Icons.Outlined.Group, "No referrals yet", "Share your link to get started.") }
        else items(state.referralRecords) { referral -> Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { GeneratedAvatar(referral.username, referral.displayName, 40.dp); Column(Modifier.weight(1f)) { Text(referral.displayName, color = KathaTheme.textPrimary, fontWeight = FontWeight.SemiBold); Text(if (referral.credited) "Generated their first story · +3 credits earned" else "Joined", color = KathaTheme.textSecondary, fontSize = 12.sp) }; Icon(if (referral.credited) Icons.Outlined.CheckCircle else Icons.Outlined.HourglassEmpty, null, tint = if (referral.credited) KathaTheme.success else KathaTheme.textTertiary) } }
        item { SafeBottomSpacer() }
    }
}

@Composable
fun StorageScreen(state: KathaUiState, viewModel: AppViewModel, modifier: Modifier = Modifier) {
    LazyColumn(modifier.fillMaxSize().background(KathaTheme.canvas), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item { Prompt12NavBar("Storage", { viewModel.closeStorageScreen() }) }
        if (state.offlineStoryRecords.isEmpty()) item { EmptyState(Icons.Outlined.CloudOff, "No stories downloaded yet", "Tap the download icon in any story to save it for offline.") }
        else {
            val total = state.offlineStoryRecords.sumOf { it.sizeMb }
            item { Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(KathaTheme.surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Text("${"%.1f".format(total)} MB", color = KathaTheme.textPrimary, fontSize = 30.sp, fontWeight = FontWeight.Bold); LinearProgressIndicator(progress = { (total / 100).toFloat().coerceIn(0f, 1f) }, color = KathaTheme.accent, modifier = Modifier.fillMaxWidth()); Text("Audio: ${"%.1f".format(total)} MB", color = KathaTheme.textSecondary, fontSize = 13.sp); Text("Images: 0 MB", color = KathaTheme.textSecondary, fontSize = 13.sp) } }
            item { Text("DOWNLOADED STORIES", color = KathaTheme.textTertiary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
            items(state.offlineStoryRecords) { record -> Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.CheckCircle, null, tint = KathaTheme.success); Text(record.title, color = KathaTheme.textPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).padding(start = 10.dp)); Text("${"%.1f".format(record.sizeMb)} MB", color = KathaTheme.textSecondary, fontSize = 12.sp); Icon(Icons.Outlined.Delete, "Remove", tint = KathaTheme.error, modifier = Modifier.padding(start = 12.dp).clickable { viewModel.removeOfflineStory(record.storyId) }) } }
            item { DestructiveCTA("Clear all downloads", icon = Icons.Outlined.Delete) { viewModel.clearOfflineStories() } }
            item { Text("Your bookmarks and history are preserved.", color = KathaTheme.textTertiary, fontSize = 11.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
        }
        item { SafeBottomSpacer() }
    }
}

@Composable
fun AudioPlayerSheet(state: KathaUiState, viewModel: AppViewModel, story: Story, modifier: Modifier = Modifier) {
    var showSpeed by remember { mutableStateOf(false) }
    var showSleep by remember { mutableStateOf(false) }
    LaunchedEffect(state.audioIsPlaying) { while (state.audioIsPlaying) { delay(1000); viewModel.advanceAudio() } }
    Box(modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f))) {
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(KathaTheme.surface).padding(horizontal = 20.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.width(38.dp).height(4.dp).clip(RoundedCornerShape(4.dp)).background(KathaTheme.textTertiary.copy(alpha = 0.5f)))
            StoryCover(story, height = 220.dp, titleSize = 20)
            Text(story.title, color = KathaTheme.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text("Chapter ${state.currentChapterIndex + 1} · ${story.chapters.getOrNull(state.currentChapterIndex)?.title ?: "Story"}", color = KathaTheme.textSecondary, fontSize = 14.sp)
            Slider(state.audioProgress, onValueChange = viewModel::seekAudio, colors = androidx.compose.material3.SliderDefaults.colors(thumbColor = KathaTheme.accent, activeTrackColor = KathaTheme.accent))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(audioTime(state.audioProgress), color = KathaTheme.textSecondary, fontSize = 11.sp); Text(audioTime(1f), color = KathaTheme.textSecondary, fontSize = 11.sp) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlayerButton(Icons.Outlined.SkipPrevious, state.currentChapterIndex > 0) { viewModel.navigateToPreviousChapter() }; PlayerButton(Icons.Outlined.FastRewind, true) { viewModel.skipAudio(-15) }; Icon(if (state.audioIsPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, "Play", tint = Color.White, modifier = Modifier.size(64.dp).clip(CircleShape).background(KathaTheme.accent).clickable { viewModel.toggleAudioPlayback() }.padding(20.dp)); PlayerButton(Icons.Outlined.FastForward, true) { viewModel.skipAudio(30) }; PlayerButton(Icons.Outlined.SkipNext, state.currentChapterIndex < story.chapters.lastIndex) { viewModel.navigateToNextChapter() }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { TextButton({ showSpeed = true }) { Text("${state.audioSpeed}x") }; TextButton({ showSleep = true }) { Text(if (state.audioSleepTimerEnd == null) "Sleep" else "Timer") }; TextButton({ viewModel.showToast("Casting coming in the next update ✨") }) { Text("Cast") } }
            SecondaryCTA("See chapters", onClick = { viewModel.showChapterList() })
            SafeBottomSpacer()
        }
    }
    if (showSpeed) AlertDialog(onDismissRequest = { showSpeed = false }, title = { Text("Playback speed") }, text = { Column { listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f).forEach { speed -> TextButton({ viewModel.setAudioSpeed(speed); showSpeed = false }) { Text("${speed}x") } } } }, confirmButton = {})
    if (showSleep) AlertDialog(onDismissRequest = { showSleep = false }, title = { Text("Sleep timer") }, text = { Column { TextButton({ viewModel.setSleepTimer(SleepTimerOption.OFF); showSleep = false }) { Text("Off") }; TextButton({ viewModel.setSleepTimer(SleepTimerOption.END_OF_CHAPTER); showSleep = false }) { Text("End of chapter") }; listOf(5, 10, 15, 30, 45, 60).forEach { minutes -> TextButton({ viewModel.setSleepTimer(SleepTimerOption.MINUTES(minutes)); showSleep = false }) { Text("${minutes}m") } } } }, confirmButton = {})
}

@Composable
private fun PlayerButton(icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, onClick: () -> Unit) { Icon(icon, null, tint = if (enabled) KathaTheme.textPrimary else KathaTheme.textTertiary, modifier = Modifier.size(44.dp).clickable(enabled = enabled, onClick = onClick).padding(10.dp)) }
private fun audioTime(progress: Float): String { val seconds = (progress * 600).toInt(); return "%02d:%02d".format(seconds / 60, seconds % 60) }
private fun startOfDay(timestamp: Long): Long { val c = Calendar.getInstance().apply { timeInMillis = timestamp; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }; return c.timeInMillis }

@Composable
fun PrePermissionModal(state: KathaUiState, viewModel: AppViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Box(modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) { Column(Modifier.padding(24.dp).clip(RoundedCornerShape(24.dp)).background(KathaTheme.surface).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) { Icon(Icons.Outlined.Notifications, null, tint = KathaTheme.accent, modifier = Modifier.size(48.dp)); Text("Stay in the loop", color = KathaTheme.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold); Text("Get notified when writers you follow publish, when your streak needs saving, and when your stories hit milestones.", color = KathaTheme.textSecondary, textAlign = TextAlign.Center); PrimaryCTA("Enable notifications", onClick = { viewModel.requestNotificationPermission(context) }); TextLink("Not now") { viewModel.dismissPrePermission() } } }
}

@Composable
fun StreakResetModal(state: KathaUiState, viewModel: AppViewModel, modifier: Modifier = Modifier) { Box(modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) { Column(Modifier.padding(24.dp).clip(RoundedCornerShape(24.dp)).background(KathaTheme.surface).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) { Icon(Icons.Outlined.Fireplace, null, tint = KathaTheme.accent, modifier = Modifier.size(48.dp)); Text("Your streak reset", color = KathaTheme.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold); Text("Every writer starts fresh. Ready for a new one?", color = KathaTheme.textSecondary, textAlign = TextAlign.Center); PrimaryCTA("Start a new streak", onClick = { viewModel.updatePrompt12State(state.copy(showStreakResetModal = false, requestedTab = 0)) }); TextLink("Maybe later") { viewModel.updatePrompt12State(state.copy(showStreakResetModal = false)) } } } }

@Composable
fun DownloadProgressBanner(state: KathaUiState, modifier: Modifier = Modifier) { state.downloadProgress?.let { progress -> Column(modifier.fillMaxWidth().background(KathaTheme.surface).padding(12.dp)) { Text("Downloading ${state.downloadStoryTitle}…", color = KathaTheme.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold); LinearProgressIndicator(progress = { progress }, color = KathaTheme.accent, modifier = Modifier.fillMaxWidth()) } } }

@Composable
fun RateAppPrompt(state: KathaUiState, viewModel: AppViewModel) {
    val context = LocalContext.current
    LaunchedEffect(state.showRatePrompt) {
        if (!state.showRatePrompt) return@LaunchedEffect
        val activity = context as? android.app.Activity
        if (activity != null) {
            val manager = ReviewManagerFactory.create(activity)
            manager.requestReviewFlow().addOnCompleteListener { task ->
                if (task.isSuccessful) manager.launchReviewFlow(activity, task.result)
                viewModel.updatePrompt12State(state.copy(showRatePrompt = false))
            }
        } else {
            viewModel.updatePrompt12State(state.copy(showRatePrompt = false))
        }
    }
}

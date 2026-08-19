package com.rork.kathaai.ui.screens

import android.content.Intent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import com.rork.kathaai.viewmodel.openAudioPlayer

// MARK: - Audio Mini Bar (FIX 8)

@Composable
fun AudioMiniBar(
    story: Story,
    state: KathaUiState,
    viewModel: AppViewModel
) {
    val audioState = viewModel.audioState(story.id)
    val context = LocalContext.current

    when (audioState) {
        AppViewModel.AudioBarState.PREPARING -> PreparingBar(story, state, viewModel, context)
        AppViewModel.AudioBarState.READY -> ReadyBar(story, viewModel)
        AppViewModel.AudioBarState.ERROR -> ErrorBar(story, viewModel)
    }
}

@Composable
private fun PreparingBar(
    story: Story,
    state: KathaUiState,
    viewModel: AppViewModel,
    context: android.content.Context
) {
    val transition = rememberInfiniteTransition(label = "pulse")
    val pulseAlpha by transition.animateFloat(
        initialValue = 0.4f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(tween(1200), RepeatMode.Reverse),
        label = "pulseAlpha"
    )
    var hasTapped by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(KathaTheme.surface)
            .clickable {
                if (!hasTapped) {
                    hasTapped = true
                    viewModel.showToast("Audio preparing — usually ready in 8–15 seconds")
                }
            }
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Box(
            modifier = Modifier
                .size(24.dp)
                .clip(CircleShape)
                .background(KathaTheme.accent.copy(alpha = pulseAlpha))
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                story.title,
                color = KathaTheme.textPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
            Text(
                "Preparing audio…",
                color = KathaTheme.textSecondary,
                fontSize = 12.sp
            )
        }
        Icon(
            Icons.Outlined.KeyboardArrowUp, null,
            tint = KathaTheme.textTertiary.copy(alpha = 0.4f),
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun ReadyBar(story: Story, viewModel: AppViewModel) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(KathaTheme.surface)
            .clickable { viewModel.openAudioPlayer(story.id) }
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(KathaTheme.accent),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Outlined.PlayArrow, "Play",
                tint = Color.White,
                modifier = Modifier.size(14.dp)
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                story.title,
                color = KathaTheme.textPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(2.dp)
                    .clip(RoundedCornerShape(1.dp))
                    .background(KathaTheme.accent)
            ) {}
        }
        Icon(
            Icons.Outlined.KeyboardArrowUp, null,
            tint = KathaTheme.textSecondary,
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun ErrorBar(story: Story, viewModel: AppViewModel) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(KathaTheme.surface)
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Icon(
            Icons.Outlined.Error, null,
            tint = KathaTheme.error,
            modifier = Modifier.size(20.dp)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                story.title,
                color = KathaTheme.textPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
            Text(
                "Audio unavailable",
                color = KathaTheme.error,
                fontSize = 12.sp
            )
        }
        TextLink(title = "Retry") {
            viewModel.retryAudio(story.id)
        }
    }
}

// MARK: - Share Feedback Helper (FIX 7)

// TODO: Replace with real feedback email address before launch
const val FEEDBACK_EMAIL = "feedback@katha.ai"

fun launchFeedbackEmail(
    context: android.content.Context,
    appVersion: String,
    username: String
) {
    val deviceModel = android.os.Build.MODEL
    val osVersion = android.os.Build.VERSION.RELEASE
    val body = """

---
App version: $appVersion
Platform: Android
Device: $deviceModel
OS: $osVersion
User: $username
"""
    val intent = Intent(Intent.ACTION_SENDTO).apply {
        data = android.net.Uri.parse("mailto:$FEEDBACK_EMAIL")
        putExtra(Intent.EXTRA_SUBJECT, "Katha AI Feedback — v$appVersion")
        putExtra(Intent.EXTRA_TEXT, body)
    }
    try {
        context.startActivity(Intent.createChooser(intent, "Share feedback"))
    } catch (e: Exception) {
        // Fallback handled by caller
    }
}

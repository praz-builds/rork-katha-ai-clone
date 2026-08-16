package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.model.AdConfig
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.AppViewModel
import kotlinx.coroutines.delay

@Composable
fun MockAdScreen(
    viewModel: AppViewModel,
    onComplete: () -> Unit
) {
    var countdown by remember { mutableIntStateOf(AdConfig.mockAdDurationSec) }
    var canSkip by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        while (countdown > 0) {
            delay(1000)
            countdown--
        }
        canSkip = 1
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        Column(modifier = Modifier.fillMaxSize()) {
            // AD watermark
            Box(modifier = Modifier.fillMaxWidth().padding(top = 20.dp, end = 20.dp), contentAlignment = Alignment.TopEnd) {
                Text("AD", fontSize = KathaTypography.Meta.fontSize, fontWeight = KathaTypography.Title1.fontWeight, color = Color.White.copy(alpha = 0.6f), modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 4.dp))
            }

            Spacer(Modifier.weight(1f))

            // Fake ad card
            Box(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 40.dp).height(400.dp).clip(RoundedCornerShape(16.dp)).background(
                    Brush.linearGradient(listOf(KathaTheme.info, KathaTheme.premium))
                ),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("This is a simulated ad", fontSize = KathaTypography.Title1.fontSize, fontWeight = KathaTypography.Title1.fontWeight, color = Color.White, textAlign = TextAlign.Center)
                    Text("Watch to earn 1 credit", fontSize = KathaTypography.Body.fontSize, color = Color.White.copy(alpha = 0.8f), textAlign = TextAlign.Center)
                }
            }

            Text("PROMOTED BY KATHA", fontSize = KathaTypography.Meta.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight, color = Color.White.copy(alpha = 0.5f), modifier = Modifier.fillMaxWidth().padding(top = 12.dp), textAlign = TextAlign.Center)

            Spacer(Modifier.weight(1f))

            // Countdown / Skip
            Column(modifier = Modifier.fillMaxWidth().padding(bottom = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    modifier = Modifier.size(56.dp).clickable {
                        if (canSkip == 1) { onComplete() }
                    },
                    contentAlignment = Alignment.Center
                ) {
                    val progress = (AdConfig.mockAdDurationSec - countdown).toFloat() / AdConfig.mockAdDurationSec.toFloat()
                    Box(modifier = Modifier.size(56.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.1f)))
                    Box(modifier = Modifier.size(56.dp).clip(CircleShape).background(KathaTheme.accent.copy(alpha = progress)))
                    if (canSkip == 1) {
                        Icon(Icons.Outlined.PlayArrow, null, tint = Color.White, modifier = Modifier.size(20.dp))
                    } else {
                        Text("$countdown", fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.Title1.fontWeight, color = Color.White)
                    }
                }
                Text(if (canSkip == 1) "Skip Ad ▸" else "You can close this ad in $countdown s", fontSize = KathaTypography.Caption.fontSize, fontWeight = if (canSkip == 1) FontWeight.SemiBold else FontWeight.Normal, color = Color.White.copy(alpha = 0.8f))
            }
        }
    }
}

@Composable
fun AdRewardToastView(balance: Int) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(20.dp)).background(KathaTheme.surfaceElevated).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(Icons.Outlined.PlayArrow, null, tint = KathaTheme.accent, modifier = Modifier.size(22.dp))
        Column {
            Text("+1 credit earned ✨", fontSize = KathaTypography.Body.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight, color = KathaTheme.textPrimary)
            Text("Balance: $balance", fontSize = KathaTypography.Meta.fontSize, color = KathaTheme.textSecondary)
        }
    }
}

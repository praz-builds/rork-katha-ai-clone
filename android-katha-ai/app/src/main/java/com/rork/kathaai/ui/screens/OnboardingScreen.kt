package com.rork.kathaai.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.ModeEdit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography

private data class OnboardingOption(
    val icon: ImageVector,
    val title: String,
    val description: String
)

private val onboardingOptions = listOf(
    OnboardingOption(Icons.Outlined.MenuBook, "Read stories", "Curated tales from AI and human authors"),
    OnboardingOption(Icons.Outlined.ModeEdit, "Write my own", "Create stories with AI assistance"),
    OnboardingOption(Icons.Outlined.Explore, "Discover new voices", "Explore genres and follow authors"),
    OnboardingOption(Icons.Outlined.AutoAwesome, "All of the above", "Read, write, and discover — everything Katha offers")
)

@Composable
fun OnboardingScreen(
    modifier: Modifier = Modifier,
    onContinue: () -> Unit
) {
    var selected by remember { mutableIntStateOf(-1) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = KathaTheme.Spacing.l,
                end = KathaTheme.Spacing.l,
                top = KathaTheme.Spacing.xxxl,
                bottom = KathaTheme.Spacing.l
            ),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
        ) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = KathaTheme.Spacing.l),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                ) {
                    Text("Katha", style = KathaTypography.Wordmark, color = KathaTheme.textPrimary)
                    Text(
                        "What brings you here?",
                        color = KathaTheme.textPrimary,
                        style = KathaTypography.Title1
                    )
                    Text(
                        "Pick one — you can always change your mind.",
                        color = KathaTheme.textSecondary,
                        style = KathaTypography.Body,
                        textAlign = TextAlign.Center
                    )
                }
            }

            items(onboardingOptions) { option ->
                val index = onboardingOptions.indexOf(option)
                val isSelected = selected == index
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(KathaTheme.Radius.l))
                        .background(KathaTheme.surface)
                        .border(
                            width = if (isSelected) 2.dp else 1.dp,
                            color = if (isSelected) KathaTheme.accent else KathaTheme.border,
                            shape = RoundedCornerShape(KathaTheme.Radius.l)
                        )
                        .clickable { selected = index }
                        .padding(KathaTheme.Spacing.l),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                ) {
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(
                                if (isSelected) KathaTheme.accent.copy(alpha = 0.15f)
                                else KathaTheme.canvas
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            option.icon, null,
                            tint = if (isSelected) KathaTheme.accent else KathaTheme.textSecondary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    Column(Modifier.weight(1f)) {
                        Text(
                            option.title,
                            color = KathaTheme.textPrimary,
                            style = KathaTypography.BodyStrong
                        )
                        Text(option.description, color = KathaTheme.textSecondary, style = KathaTypography.Caption)
                    }
                    Icon(
                        if (isSelected) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                        contentDescription = null,
                        tint = if (isSelected) KathaTheme.accent else KathaTheme.textTertiary,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }

            item { SafeBottomSpacer(100.dp) }
        }

        AnimatedVisibility(
            visible = selected >= 0,
            enter = slideInVertically(initialOffsetY = { it }),
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(KathaTheme.surface)
                    .padding(KathaTheme.Spacing.l)
            ) {
                PrimaryCTA("Get started", onClick = onContinue)
            }
        }
    }
}

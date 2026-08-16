package com.rork.kathaai.ui.screens

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.AnalyticsService
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.AnalyticsTimeRange
import com.rork.kathaai.model.ChapterReads
import com.rork.kathaai.model.DailyReads
import com.rork.kathaai.model.MilestoneKey
import com.rork.kathaai.model.MilestoneSortMetric
import com.rork.kathaai.model.Story
import com.rork.kathaai.model.StoryAnalytics
import com.rork.kathaai.model.UnseenMilestone
import com.rork.kathaai.ui.components.FilterChip
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.components.Skeleton
import com.rork.kathaai.ui.components.formatCount
import com.rork.kathaai.ui.components.timeAgo
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay

// MARK: - Time Range Selector

@Composable
fun TimeRangeSelector(
    currentRange: AnalyticsTimeRange,
    onSelect: (AnalyticsTimeRange) -> Unit
) {
    val haptics = LocalHapticFeedback.current
    Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
        AnalyticsTimeRange.entries.forEach { range ->
            FilterChip(
                title = range.label,
                isSelected = currentRange == range
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onSelect(range)
            }
        }
        Spacer(Modifier.weight(1f))
    }
}

// MARK: - Stat Card

@Composable
fun StatCard(
    label: String,
    value: Int,
    modifier: Modifier = Modifier,
    trendText: String? = null,
    trendPositive: Boolean? = null,
    showCoinIcon: Boolean = false
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(14.dp))
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                label,
                color = KathaTheme.textTertiary,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold
            )
            if (showCoinIcon) {
                Icon(Icons.Outlined.Star, null, tint = KathaTheme.accent, modifier = Modifier.size(16.dp))
            }
        }
        Text(
            formatCount(value),
            color = KathaTheme.textPrimary,
            fontSize = 30.sp,
            fontWeight = FontWeight.SemiBold
        )
        if (trendText != null) {
            val trendColor = when (trendPositive) {
                true -> KathaTheme.success
                false -> KathaTheme.error
                null -> KathaTheme.textSecondary
            }
            Text(trendText, color = trendColor, fontSize = 11.sp)
        }
    }
}

// MARK: - Reads Line Chart (Canvas-based)

@Composable
fun ReadsLineChart(data: List<DailyReads>, modifier: Modifier = Modifier) {
    if (data.isEmpty()) {
        Column(
            modifier = modifier.fillMaxWidth().height(160.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(Icons.Outlined.Insights, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(32.dp))
            Text("No reads data yet", color = KathaTheme.textSecondary, fontSize = 13.sp)
        }
        return
    }

    val maxReads = maxOf(1, data.maxOf { it.reads })
    val accentColor = KathaTheme.accent
    val borderColor = KathaTheme.border

    Canvas(
        modifier = modifier.fillMaxWidth().height(160.dp)
    ) {
        val w = size.width
        val h = size.height
        val stepX = if (data.size > 1) w / (data.size - 1) else w

        // Grid lines
        for (i in 0..4) {
            val y = h * i / 4f
            drawLine(
                color = borderColor.copy(alpha = 0.3f),
                start = Offset(0f, y),
                end = Offset(w, y),
                strokeWidth = 0.5f
            )
        }

        // Build line path
        val linePath = Path()
        val points = data.mapIndexed { index, entry ->
            val x = index * stepX
            val y = h - (entry.reads.toFloat() / maxReads) * h * 0.85f - h * 0.075f
            Offset(x, y)
        }

        points.forEachIndexed { index, point ->
            if (index == 0) linePath.moveTo(point.x, point.y)
            else linePath.lineTo(point.x, point.y)
        }

        // Fill area
        val fillPath = Path().apply {
            addPath(linePath)
            lineTo(points.last().x, h)
            lineTo(points.first().x, h)
            close()
        }
        drawPath(
            path = fillPath,
            brush = Brush.verticalGradient(
                colors = listOf(accentColor.copy(alpha = 0.15f), accentColor.copy(alpha = 0f))
            )
        )

        // Line
        drawPath(
            path = linePath,
            color = accentColor,
            style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
        )
    }
}

// MARK: - Chapter Bar Chart

@Composable
fun ChapterBarChart(
    chapters: List<ChapterReads>,
    onChapterTap: (Int) -> Unit
) {
    val haptics = LocalHapticFeedback.current
    val maxReads = maxOf(1, chapters.maxOf { it.reads })

    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
        chapters.forEachIndexed { index, chapterReads ->
            val ratio = chapterReads.reads.toFloat() / maxReads
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onChapterTap(index)
                    }
                    .padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
            ) {
                Text(
                    "Ch. ${index + 1}",
                    color = KathaTheme.textSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.width(40.dp)
                )
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(32.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(KathaTheme.border.copy(alpha = 0.3f))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(6.dp))
                            .fractionalBackground(KathaTheme.accent, ratio)
                    )
                }
                Text(
                    formatCount(chapterReads.reads),
                    color = KathaTheme.textPrimary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.width(44.dp),
                    textAlign = TextAlign.End
                )
            }
        }
    }
}

// Helper extension for fractional fill
private fun Modifier.fractionalBackground(color: Color, fraction: Float): Modifier =
    this.then(
        Modifier.drawWithContent {
            drawRect(color = color, size = Size(size.width * fraction, size.height))
            drawContent()
        }
    )

// MARK: - Milestone Panel

@Composable
fun MilestonePanel(analytics: StoryAnalytics) {
    var showAll by remember { mutableStateOf(false) }
    val visible = if (showAll) MilestoneKey.entries else MilestoneKey.entries.take(6)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(KathaTheme.Radius.l))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
            .padding(KathaTheme.Spacing.l)
    ) {
        visible.forEachIndexed { index, milestone ->
            val isCrossed = analytics.milestonesCrossed.contains(milestone.key)
            MilestoneRow(milestone = milestone, isCrossed = isCrossed)
            if (index < visible.size - 1) {
                HorizontalDivider(color = KathaTheme.border)
            }
        }
        if (MilestoneKey.entries.size > 6 && !showAll) {
            Text(
                "See all milestones",
                color = KathaTheme.accent,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clickable { showAll = true }
                    .padding(top = KathaTheme.Spacing.m)
            )
        }
    }
}

@Composable
fun MilestoneRow(milestone: MilestoneKey, isCrossed: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = KathaTheme.Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Icon(
            Icons.Outlined.AutoAwesome,
            contentDescription = null,
            tint = if (isCrossed) KathaTheme.accent else KathaTheme.textTertiary,
            modifier = Modifier.size(18.dp)
        )
        Text(
            milestone.label,
            color = if (isCrossed) KathaTheme.textPrimary else KathaTheme.textSecondary,
            fontSize = 14.sp,
            fontWeight = if (isCrossed) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f)
        )
        if (isCrossed) {
            Icon(
                Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = KathaTheme.success,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

// MARK: - Section Label

@Composable
fun AnalyticsSectionLabel(title: String) {
    Text(
        title,
        color = KathaTheme.textTertiary,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(bottom = KathaTheme.Spacing.m)
    )
}

// MARK: - Empty States

@Composable
fun AnalyticsEmptyState(onShare: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 40.dp, bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Icon(
            Icons.Outlined.Insights,
            contentDescription = null,
            tint = KathaTheme.accent.copy(alpha = 0.4f),
            modifier = Modifier.size(96.dp)
        )
        Text(
            "Analytics grow as your story gets read",
            color = KathaTheme.textPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center
        )
        Text(
            "Share your story with friends, or wait for the Discover feed to surface it. New data appears here as it comes in.",
            color = KathaTheme.textSecondary,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 40.dp)
        )
        SecondaryCTA(title = "Share your story", onClick = onShare)
    }
}

@Composable
fun DashboardEmptyState(onWrite: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 40.dp, bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Icon(
            Icons.Outlined.AutoAwesome,
            contentDescription = null,
            tint = KathaTheme.accent.copy(alpha = 0.4f),
            modifier = Modifier.size(96.dp)
        )
        Text(
            "No dashboard yet",
            color = KathaTheme.textPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            "Publish your first story to start tracking reads, followers, and earnings.",
            color = KathaTheme.textSecondary,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 40.dp)
        )
        PrimaryCTA(title = "Write your first story ▸", onClick = onWrite)
    }
}

// MARK: - Story Analytics Screen

@Composable
fun StoryAnalyticsScreen(
    story: Story,
    state: KathaUiState,
    viewModel: AppViewModel,
    onBack: () -> Unit,
    onOpenReader: (String, Int) -> Unit,
    onOpenComments: (String) -> Unit,
    onShare: () -> Unit
) {
    var isLoading by remember { mutableStateOf(true) }
    var timeRange by remember { mutableStateOf(AnalyticsService.getTimeRange()) }

    LaunchedEffect(Unit) {
        delay(400)
        isLoading = false
    }

    val analytics = AnalyticsService.analyticsFor(story.id)
    val totalReadsInRange = AnalyticsService.totalReadsFor(story.id, timeRange)
    val previousPeriodReads = AnalyticsService.previousPeriodReads(story.id, timeRange)
    val creditsEarned = analytics?.creditsEarnedFromReads ?: 0
    val storyFollowers = viewModel.storyFollowerCount(story.id, story.followerCount)
    val likes = state.storyLikeCount(story.id, story.likes)
    val shares = state.storyShareCount(story.id, 0)
    val bookmarks = story.bookmarks + (if (story.id in state.bookmarkedStoryIds) 1 else 0)
    val commentCount = state.commentCount(story.id)
    val isEmptyState = story.views < 3 && story.publishedOffset == 0

    Box(
        modifier = Modifier.fillMaxSize().background(KathaTheme.canvas)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 120.dp)
        ) {
            item { Spacer(Modifier.height(56.dp)) }

            if (isLoading) {
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.xxl),
                        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        repeat(4) { Skeleton(height = 108.dp, cornerRadius = 14.dp) }
                        Skeleton(height = 200.dp, cornerRadius = 16.dp)
                    }
                }
            } else if (isEmptyState) {
                item { AnalyticsEmptyState(onShare = onShare) }
            } else {
                // Story context card
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l)
                            .clip(RoundedCornerShape(KathaTheme.Radius.l))
                            .background(KathaTheme.surface)
                            .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                            .padding(KathaTheme.Spacing.l),
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .width(56.dp)
                                .height(84.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Brush.linearGradient(story.coverColors))
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                            Text(
                                story.title,
                                color = KathaTheme.textPrimary,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                                Text(story.genre.displayName, color = KathaTheme.textSecondary, fontSize = 11.sp)
                                Text("EN", color = KathaTheme.textSecondary, fontSize = 11.sp)
                            }
                            Text(
                                "Published ${timeAgo(story.publishedOffset)} · ${story.chapters.size} chapter${if (story.chapters.size > 1) "s" else ""}",
                                color = KathaTheme.textSecondary,
                                fontSize = 12.sp
                            )
                        }
                    }
                }

                // Time range selector
                item {
                    Box(modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l)) {
                        TimeRangeSelector(currentRange = timeRange) { newRange ->
                            timeRange = newRange
                            AnalyticsService.setTimeRange(newRange)
                        }
                    }
                }

                // Stat cards
                item {
                    val trendDelta = totalReadsInRange - previousPeriodReads
                    val trendText = if (trendDelta == 0) "No change" else "${if (trendDelta > 0) "+" else ""}$trendDelta vs previous period"

                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl),
                        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            StatCard(
                                label = "READS",
                                value = totalReadsInRange,
                                modifier = Modifier.weight(1f),
                                trendText = trendText,
                                trendPositive = if (trendDelta > 0) true else if (trendDelta < 0) false else null
                            )
                            StatCard(label = "LIKES", value = likes, modifier = Modifier.weight(1f))
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            StatCard(label = "FOLLOWERS", value = storyFollowers, modifier = Modifier.weight(1f))
                            StatCard(label = "CREDITS EARNED", value = creditsEarned, modifier = Modifier.weight(1f), showCoinIcon = true)
                        }
                    }
                }

                // Reads chart
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        AnalyticsSectionLabel("READS OVER TIME")
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                .background(KathaTheme.surface)
                                .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                                .padding(KathaTheme.Spacing.xl)
                        ) {
                            ReadsLineChart(data = AnalyticsService.dailyReadsFor(story.id, timeRange))
                        }
                    }
                }

                // Chapter breakdown
                if (story.chapters.size > 1 && analytics?.chapterReads?.isNotEmpty() == true) {
                    item {
                        Column(
                            modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
                            verticalArrangement = Arrangement.spacedBy(0.dp)
                        ) {
                            AnalyticsSectionLabel("READS BY CHAPTER")
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                    .background(KathaTheme.surface)
                                    .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                                    .padding(KathaTheme.Spacing.xl)
                            ) {
                                ChapterBarChart(chapters = analytics.chapterReads) { index ->
                                    onOpenReader(story.id, index)
                                }
                            }
                        }
                    }
                }

                // Milestones
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        AnalyticsSectionLabel("MILESTONES")
                        analytics?.let { MilestonePanel(it) }
                    }
                }

                // Engagement
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        AnalyticsSectionLabel("ENGAGEMENT")
                        val saveRate = if (story.views > 0) "${(bookmarks * 100 / story.views)}%" else "0%"
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                .background(KathaTheme.surface)
                                .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                                .padding(KathaTheme.Spacing.l)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = KathaTheme.Spacing.s),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Comments", color = KathaTheme.textSecondary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                                Text(formatCount(commentCount), color = KathaTheme.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    "View all →",
                                    color = KathaTheme.accent,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.clickable { onOpenComments(story.id) }.padding(start = 8.dp)
                                )
                            }
                            HorizontalDivider(color = KathaTheme.border)
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = KathaTheme.Spacing.s),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Shares", color = KathaTheme.textSecondary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                                Text(formatCount(shares), color = KathaTheme.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            }
                            HorizontalDivider(color = KathaTheme.border)
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = KathaTheme.Spacing.s),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Bookmarks (save rate)", color = KathaTheme.textSecondary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                                Text("${formatCount(bookmarks)} ($saveRate save rate)", color = KathaTheme.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
            item { SafeBottomSpacer() }
        }

        // Nav bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(KathaTheme.canvas.copy(alpha = 0.95f))
                .padding(horizontal = KathaTheme.Spacing.s, vertical = KathaTheme.Spacing.s)
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Outlined.ArrowBack,
                contentDescription = "Back",
                tint = KathaTheme.textPrimary,
                modifier = Modifier.size(20.dp).clickable { onBack() }.padding(4.dp)
            )
            Spacer(Modifier.weight(1f))
            Text("Analytics", color = KathaTheme.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Outlined.Share,
                contentDescription = "Share",
                tint = KathaTheme.textPrimary,
                modifier = Modifier.size(20.dp).clickable {
                    viewModel.showToast("Sharing analytics coming in a future update ✨")
                }.padding(4.dp)
            )
        }
    }
}

// MARK: - Author Dashboard Screen

@Composable
fun AuthorDashboardScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    onBack: () -> Unit,
    onOpenStoryAnalytics: (Story) -> Unit,
    onNavigateToCreate: () -> Unit
) {
    var isLoading by remember { mutableStateOf(true) }
    var timeRange by remember { mutableStateOf(AnalyticsService.getTimeRange()) }
    var sortMetric by remember { mutableStateOf(MilestoneSortMetric.READS) }

    LaunchedEffect(Unit) {
        delay(400)
        isLoading = false
    }

    val publishedIds = state.publishedStories.filter { it.isPublished }.map { it.id }
    val seedStoryIds = SeedData.stories.filter { it.authorId == state.currentUser?.username }.map { it.id }
    val ownStoryIds = publishedIds + seedStoryIds

    val totalReads = AnalyticsService.totalReadsAcrossCatalog(ownStoryIds, timeRange)
    val totalCredits = AnalyticsService.totalCreditsAcrossCatalog(ownStoryIds)
    val followersGained = state.currentUser?.followers ?: 0
    val storiesPublished = ownStoryIds.size
    val aggregatedReads = AnalyticsService.aggregatedDailyReads(ownStoryIds, timeRange)
    val topStoryIds = AnalyticsService.topStories(ownStoryIds, sortMetric)
    val recentMilestones = AnalyticsService.recentMilestones(5)

    Box(
        modifier = Modifier.fillMaxSize().background(KathaTheme.canvas)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 120.dp)
        ) {
            item { Spacer(Modifier.height(56.dp)) }

            if (isLoading) {
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.xxl),
                        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        repeat(4) { Skeleton(height = 108.dp, cornerRadius = 14.dp) }
                        Skeleton(height = 200.dp, cornerRadius = 16.dp)
                    }
                }
            } else if (ownStoryIds.isEmpty()) {
                item { DashboardEmptyState(onWrite = onNavigateToCreate) }
            } else {
                // Time range
                item {
                    Box(modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l)) {
                        TimeRangeSelector(currentRange = timeRange) { newRange ->
                            timeRange = newRange
                            AnalyticsService.setTimeRange(newRange)
                        }
                    }
                }

                // Stat cards
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl),
                        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            StatCard(label = "TOTAL READS", value = totalReads, modifier = Modifier.weight(1f))
                            StatCard(label = "CREDITS EARNED", value = totalCredits, modifier = Modifier.weight(1f), showCoinIcon = true)
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            StatCard(label = "FOLLOWERS GAINED", value = followersGained, modifier = Modifier.weight(1f))
                            StatCard(label = "STORIES PUBLISHED", value = storiesPublished, modifier = Modifier.weight(1f))
                        }
                    }
                }

                // Reads trend
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        AnalyticsSectionLabel("READS OVER TIME")
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                .background(KathaTheme.surface)
                                .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                                .padding(KathaTheme.Spacing.xl)
                        ) {
                            ReadsLineChart(data = aggregatedReads)
                        }
                    }
                }

                // Top stories
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            AnalyticsSectionLabel("TOP STORIES")
                            Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                                MilestoneSortMetric.entries.forEach { metric ->
                                    FilterChip(
                                        title = metric.label,
                                        isSelected = sortMetric == metric
                                    ) { sortMetric = metric }
                                }
                            }
                        }
                        topStoryIds.forEach { storyId ->
                            val story = SeedData.stories.firstOrNull { it.id == storyId }
                                ?: state.publishedStories.firstOrNull { it.id == storyId }?.asStory()
                            story?.let { s ->
                                val metricValue = when (sortMetric) {
                                    MilestoneSortMetric.READS -> AnalyticsService.totalReadsFor(s.id, AnalyticsTimeRange.ALL_TIME)
                                    MilestoneSortMetric.CREDITS -> AnalyticsService.analyticsFor(s.id)?.creditsEarnedFromReads ?: 0
                                    MilestoneSortMetric.FOLLOWERS -> AnalyticsService.analyticsFor(s.id)?.followersGainedFromStory ?: 0
                                }
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(KathaTheme.Radius.m))
                                        .background(KathaTheme.surface)
                                        .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.m))
                                        .clickable { onOpenStoryAnalytics(s) }
                                        .padding(KathaTheme.Spacing.m),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .width(48.dp)
                                            .height(72.dp)
                                            .clip(RoundedCornerShape(6.dp))
                                            .background(Brush.linearGradient(s.coverColors))
                                    )
                                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(s.title, color = KathaTheme.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(s.genre.displayName, color = KathaTheme.textSecondary, fontSize = 11.sp)
                                    }
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(formatCount(metricValue), color = KathaTheme.accent, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                        Text(sortMetric.label.removePrefix("By "), color = KathaTheme.textTertiary, fontSize = 10.sp)
                                    }
                                }
                            }
                        }
                    }
                }

                // Recent milestones
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        AnalyticsSectionLabel("RECENT MILESTONES")
                        if (recentMilestones.isEmpty()) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                    .background(KathaTheme.surface)
                                    .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                                    .padding(KathaTheme.Spacing.xl),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                            ) {
                                Text("No milestones crossed yet", color = KathaTheme.textSecondary, fontSize = 13.sp)
                            }
                        } else {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                    .background(KathaTheme.surface)
                                    .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                                    .padding(KathaTheme.Spacing.l)
                            ) {
                                recentMilestones.forEachIndexed { index, (milestone, storyId, storyTitle) ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                SeedData.stories.firstOrNull { it.id == storyId }?.let { onOpenStoryAnalytics(it) }
                                            }
                                            .padding(vertical = KathaTheme.Spacing.s),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                                    ) {
                                        Icon(Icons.Outlined.AutoAwesome, null, tint = KathaTheme.accent, modifier = Modifier.size(18.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(milestone.label, color = KathaTheme.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                                            Text(storyTitle.ifEmpty { "Your story" }, color = KathaTheme.textSecondary, fontSize = 12.sp)
                                        }
                                    }
                                    if (index < recentMilestones.size - 1) {
                                        HorizontalDivider(color = KathaTheme.border)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            item { SafeBottomSpacer() }
        }

        // Nav bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(KathaTheme.canvas.copy(alpha = 0.95f))
                .padding(horizontal = KathaTheme.Spacing.s, vertical = KathaTheme.Spacing.s)
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Outlined.ArrowBack,
                contentDescription = "Back",
                tint = KathaTheme.textPrimary,
                modifier = Modifier.size(20.dp).clickable { onBack() }.padding(4.dp)
            )
            Spacer(Modifier.weight(1f))
            Text("Your dashboard", color = KathaTheme.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.size(20.dp))
        }
    }
}

// MARK: - Celebration Banner

@Composable
fun CelebrationBanner(
    onDismiss: () -> Unit,
    onNavigate: (String) -> Unit
) {
    val unseen = AnalyticsService.currentUnseenMilestone()
    val milestone = unseen?.let { MilestoneKey.fromKey(it.milestoneKey) }

    if (unseen != null && milestone != null) {
        val transition = rememberInfiniteTransition(label = "sparkle")
        val scale by transition.animateFloat(
            initialValue = 1f,
            targetValue = 1.15f,
            animationSpec = infiniteRepeatable(tween(1000), RepeatMode.Reverse),
            label = "sparkleScale"
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KathaTheme.Spacing.m, vertical = KathaTheme.Spacing.m)
                .clip(RoundedCornerShape(KathaTheme.Radius.l))
                .background(
                    Brush.verticalGradient(
                        listOf(KathaTheme.accentSoft, KathaTheme.accentSoft.copy(alpha = 0.3f))
                    )
                )
                .border(1.5.dp, KathaTheme.accent.copy(alpha = 0.5f), RoundedCornerShape(KathaTheme.Radius.l))
                .padding(KathaTheme.Spacing.xl),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            Icon(
                Icons.Outlined.AutoAwesome,
                contentDescription = null,
                tint = KathaTheme.accent,
                modifier = Modifier.size(32.dp).then(Modifier.padding(end = 4.dp))
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text("MILESTONE ✨", color = KathaTheme.accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    milestone.celebrationTitle(),
                    color = KathaTheme.textPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    milestone.celebrationSubtitle(unseen.storyTitle),
                    color = KathaTheme.textSecondary,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
            ) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = "Dismiss",
                    tint = KathaTheme.textTertiary,
                    modifier = Modifier.size(18.dp).clickable { onDismiss() }.padding(2.dp)
                )
            }
        }
    }
}

// MARK: - Reader Earning Toast

@Composable
fun ReaderEarningToast(
    credits: Int,
    storyTitle: String,
    onView: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.m)
            .clip(RoundedCornerShape(KathaTheme.Radius.l))
            .background(KathaTheme.surfaceElevated)
            .padding(KathaTheme.Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Icon(Icons.Outlined.Star, null, tint = KathaTheme.accent, modifier = Modifier.size(22.dp))
        Text(
            "+$credits credit${if (credits > 1) "s" else ""} from '$storyTitle'",
            color = KathaTheme.textPrimary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Text(
            "View",
            color = KathaTheme.accent,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable { onView() }.padding(4.dp)
        )
    }
}

// MARK: - Dev Tools Sheet

@Composable
fun DevToolsSheet(
    isPresented: Boolean,
    onDismiss: () -> Unit,
    onTriggerMilestone: () -> Unit,
    onTriggerReaderEarning: () -> Unit,
    onResetMilestones: () -> Unit,
    onResetAnalytics: () -> Unit
) {
    if (isPresented) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.4f))
                .clickable { onDismiss() }
        ) {
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                    .background(KathaTheme.surface)
                    .padding(KathaTheme.Spacing.l),
                verticalArrangement = Arrangement.spacedBy(0.dp)
            ) {
                Box(
                    modifier = Modifier
                        .width(36.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(KathaTheme.border)
                        .align(Alignment.CenterHorizontally)
                )
                Spacer(Modifier.height(KathaTheme.Spacing.l))
                Text("Dev tools", color = KathaTheme.textPrimary, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(KathaTheme.Spacing.l))

                DevToolRow("Trigger milestone celebration") { onTriggerMilestone() }
                HorizontalDivider(color = KathaTheme.border)
                DevToolRow("Trigger reader-earning toast") { onTriggerReaderEarning() }
                HorizontalDivider(color = KathaTheme.border)
                DevToolRow("Reset all milestones") { onResetMilestones() }
                HorizontalDivider(color = KathaTheme.border)
                DevToolRow("Reset all analytics") { onResetAnalytics() }
                HorizontalDivider(color = KathaTheme.border)
                DevToolRow("Close") { onDismiss() }

                Spacer(Modifier.height(KathaTheme.Spacing.l))
            }
        }
    }
}

@Composable
private fun DevToolRow(title: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, color = KathaTheme.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Icon(Icons.Outlined.Close, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(16.dp))
    }
}

package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WorkspacePremium
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import com.rork.kathaai.data.AnalyticsService
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.Genre
import com.rork.kathaai.ui.components.CompactStoryCard
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.GenreChip
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SectionHeader
import com.rork.kathaai.ui.components.StoryCard
import com.rork.kathaai.ui.components.StoryCardSkeleton
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.serif
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay

@Composable
fun HomeScreen(
    state: KathaUiState,
    modifier: Modifier = Modifier,
    onOpenStory: (String) -> Unit,
    onLike: (String) -> Unit,
    onBookmark: (String) -> Unit,
    onOpenStoryWithChapter: (String, Int) -> Unit = { id, _ -> onOpenStory(id) },
    onMarkChapterRead: (String, Int) -> Unit = { _, _ -> },
    onOpenAuthor: (String) -> Unit = {},
    onOpenOwnProfile: () -> Unit = {},
    onFollowAuthor: (String) -> Unit = {},
    onSeeMoreWriters: () -> Unit = {},
    onOpenCredits: () -> Unit = {}
) {
    var isLoading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(500)
        isLoading = false
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = KathaTheme.Spacing.l,
                bottom = KathaTheme.Spacing.l
            ),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xxl)
        ) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = KathaTheme.Spacing.l),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Katha",
                        style = serif(28, FontWeight.Bold),
                        color = KathaTheme.textPrimary
                    )
                    Spacer(Modifier.weight(1f))
                    state.currentUser?.let { user ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(50))
                                    .background(KathaTheme.surface)
                                    .clickable { onOpenCredits() }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (state.isPremium) {
                                    Icon(Icons.Outlined.WorkspacePremium, null, tint = KathaTheme.premium, modifier = Modifier.size(10.dp))
                                }
                                Text("${user.credits}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = KathaTheme.textPrimary)
                            }
                            GeneratedAvatar(
                                user.username, user.displayName, 36.dp,
                                Modifier.clickable { onOpenOwnProfile() }
                            )
                        }
                    }
                }
            }

            // Celebration banner (top, above new chapters)
            if (AnalyticsService.hasUnseenMilestones()) {
                item {
                    CelebrationBanner(
                        onDismiss = { AnalyticsService.dismissCurrentMilestone() },
                        onNavigate = { storyId ->
                            AnalyticsService.dismissCurrentMilestone()
                            SeedData.stories.firstOrNull { it.id == storyId }?.let { /* TODO: open analytics */ }
                        }
                    )
                }
            }

            // New chapter banner
            if (state.hasUnreadNewChapters) {
                item {
                    NewChapterBanner(
                        state = state,
                        onDismiss = { storyId -> /* handled by VM via callback */ },
                        onTap = { }
                    )
                }
            }

            // New chapters section
            if (state.hasUnreadNewChapters) {
                item {
                    NewChaptersHomeSection(
                        state = state,
                        onTapStory = { story, chapterIndex ->
                            onOpenStoryWithChapter(story.id, chapterIndex)
                        },
                        onMarkRead = { storyId, chapterNum ->
                            onMarkChapterRead(storyId, chapterNum)
                        }
                    )
                }
            }

            if (isLoading) {
                items(3) {
                    Box(Modifier.padding(horizontal = KathaTheme.Spacing.l)) {
                        StoryCardSkeleton()
                    }
                }
            } else {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        SectionHeader(
                            title = "Featured",
                            modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l),
                            subtitle = "Handpicked stories for you"
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = KathaTheme.Spacing.l),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            items(SeedData.featured.filter { state.isStoryVisibleInKidsMode(it) }, key = { it.id }) { story ->
                                Box(Modifier.width(320.dp)) {
                                    StoryCard(
                                        story = story,
                                        isLiked = story.id in state.likedStoryIds,
                                        isBookmarked = story.id in state.bookmarkedStoryIds,
                                        onLike = { onLike(story.id) },
                                        onBookmark = { onBookmark(story.id) },
                                        onTap = { onOpenStory(story.id) },
                                        onAuthorTap = { onOpenAuthor(story.authorId) }
                                    )
                                }
                            }
                        }
                    }
                }

                item {
                    SectionHeader(
                        title = "Trending",
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l),
                        subtitle = "Most loved this week"
                    )
                }
                items(SeedData.trending.filter { state.isStoryVisibleInKidsMode(it) }.take(5), key = { it.id }) { story ->
                    Box(Modifier.padding(horizontal = KathaTheme.Spacing.l)) {
                        StoryCard(
                            story = story,
                            isLiked = story.id in state.likedStoryIds,
                            isBookmarked = story.id in state.bookmarkedStoryIds,
                            onLike = { onLike(story.id) },
                            onBookmark = { onBookmark(story.id) },
                            onTap = { onOpenStory(story.id) },
                            onAuthorTap = { onOpenAuthor(story.authorId) }
                        )
                    }
                }

                // Writers to follow (authenticated only)
                if (state.isAuthenticated) {
                    item {
                        WritersToFollowSection(
                            state = state,
                            onOpenAuthor = onOpenAuthor,
                            onFollow = onFollowAuthor,
                            onSeeMore = onSeeMoreWriters
                        )
                    }
                }

                item {
                    SectionHeader(
                        title = "New This Week",
                        modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l),
                        subtitle = "Fresh from our authors"
                    )
                }
                items(SeedData.newest.filter { state.isStoryVisibleInKidsMode(it) }.take(6).chunked(2)) { pair ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = KathaTheme.Spacing.l),
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        pair.forEach { story ->
                            Box(Modifier.weight(1f)) {
                                CompactStoryCard(
                                    story,
                                    onAuthorTap = { onOpenAuthor(story.authorId) }
                                ) { onOpenStory(story.id) }
                            }
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        SectionHeader(
                            title = "Browse by Genre",
                            modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l)
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = KathaTheme.Spacing.l),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                        ) {
                            items(Genre.entries.filter { !(state.kidsMode && it == Genre.EROTICA) }) { genre ->
                                GenreChip(genre = genre, isSelected = false) {}
                            }
                        }
                    }
                }
            }

            item { SafeBottomSpacer() }
        }
    }
}

package com.rork.kathaai.ui.screens

import android.content.Context
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Close
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.ui.components.CompactStoryCard
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.KathaToast
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SectionHeader
import com.rork.kathaai.ui.components.StoryCard
import com.rork.kathaai.ui.components.StoryCardSkeleton
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay

@Composable
fun HomeScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
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
    onOpenCredits: () -> Unit = {},
    onSignIn: () -> Unit = {}
) {
    val context = LocalContext.current
    val preferences = remember { context.getSharedPreferences("katha_home", Context.MODE_PRIVATE) }
    var isLoading by remember { mutableStateOf(true) }
    var welcomeDismissed by remember { mutableStateOf(false) }
    val previousOpen = remember { preferences.getLong("last_open_timestamp", 0L) }
    val shouldShowWelcome = previousOpen > 0L &&
        System.currentTimeMillis() - previousOpen > 3L * 24L * 60L * 60L * 1000L &&
        !welcomeDismissed

    val forYouStories: List<com.rork.kathaai.model.Story> = remember(state) { state.discoverFeedStories().take(5) }
    val followedWriterStories = remember(state) {
        SeedData.stories
            .filter { it.authorId in state.followedAuthorIds && state.isStoryVisibleInKidsMode(it) }
            .sortedBy { it.publishedOffset }
            .take(3)
    }
    val risingStories = remember(state) {
        SeedData.trending
            .filter { state.isStoryVisibleInKidsMode(it) }
            .sortedBy { it.publishedOffset }
            .take(6)
    }
    val kathaPicks = remember(state) {
        SeedData.stories
            .filter { it.authorId == "kathaai" && state.isStoryVisibleInKidsMode(it) }
            .take(3)
    }
    val continueStories = remember(state) {
        SeedData.stories.filter { it.id in state.readStoryIds && state.isStoryVisibleInKidsMode(it) }
    }

    LaunchedEffect(Unit) {
        preferences.edit().putLong("last_open_timestamp", System.currentTimeMillis()).apply()
        delay(350)
        isLoading = false
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = KathaTheme.Spacing.mdLg, bottom = KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xxxl)
        ) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = KathaTheme.Spacing.l),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Katha", style = KathaTypography.Wordmark, color = KathaTheme.accent)
                    Spacer(Modifier.weight(1f))
                    if (state.isAuthenticated) {
                        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m), verticalAlignment = Alignment.CenterVertically) {
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(KathaTheme.Radius.full))
                                    .background(KathaTheme.surface)
                                    .clickable { onOpenCredits() }
                                    .padding(horizontal = KathaTheme.Spacing.m, vertical = KathaTheme.Spacing.s),
                                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (state.isPremium) Icon(Icons.Outlined.WorkspacePremium, null, tint = KathaTheme.premium, modifier = Modifier.size(KathaTheme.Spacing.s))
                                Text("${state.currentUser?.credits ?: 0}", style = KathaTypography.BodyStrong, color = KathaTheme.textPrimary)
                            }
                            state.currentUser?.let { user ->
                                GeneratedAvatar(user.username, user.displayName, 36.dp, Modifier.clickable { onOpenOwnProfile() })
                            }
                        }
                    } else {
                        Text("Sign in", style = KathaTypography.BodyStrong, color = KathaTheme.textPrimary, modifier = Modifier.clip(RoundedCornerShape(KathaTheme.Radius.xl)).background(KathaTheme.surface).border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.xl)).clickable { onSignIn() }.padding(horizontal = KathaTheme.Spacing.mdLg, vertical = KathaTheme.Spacing.s))
                    }
                }
            }

            if (shouldShowWelcome) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = KathaTheme.Spacing.l)
                            .clip(RoundedCornerShape(KathaTheme.Radius.m))
                            .background(KathaTheme.accentSoft)
                            .padding(KathaTheme.Spacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Icon(Icons.Outlined.AutoAwesome, null, tint = KathaTheme.accent, modifier = Modifier.size(18.dp))
                        Text("Welcome back. Here's what's popular right now.", style = KathaTypography.BodyStrong, color = KathaTheme.textPrimary, modifier = Modifier.weight(1f))
                        Icon(Icons.Outlined.Close, "Dismiss", tint = KathaTheme.textTertiary, modifier = Modifier.size(14.dp).clickable { welcomeDismissed = true })
                    }
                }
            }

            if (state.hasUnreadNewChapters) {
                item { NewChapterBanner(state = state, onDismiss = { }, onTap = { }) }
                item {
                    NewChaptersHomeSection(
                        state = state,
                        onTapStory = { story, chapterIndex -> onOpenStoryWithChapter(story.id, chapterIndex) },
                        onMarkRead = onMarkChapterRead
                    )
                }
            }

            if (!isLoading && continueStories.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        SectionHeader("Continue reading", modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l))
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = KathaTheme.Spacing.l),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            items(continueStories, key = { it.id }) { story ->
                                CompactStoryCard(story = story, progress = 0.5f, onAuthorTap = { onOpenAuthor(story.authorId) }, onTap = { onOpenStory(story.id) })
                            }
                        }
                    }
                }
            }

            if (isLoading) {
                items(3) { Box(Modifier.padding(horizontal = KathaTheme.Spacing.l)) { StoryCardSkeleton() } }
            } else {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        SectionHeader("For you", modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l))
                        forYouStories.forEach { story ->
                            StoryCard(
                                story = story,
                                isLiked = story.id in state.likedStoryIds,
                                isBookmarked = story.id in state.bookmarkedStoryIds,
                                onLike = { onLike(story.id) },
                                onBookmark = { onBookmark(story.id) },
                                onTap = { onOpenStory(story.id) },
                                onAuthorTap = { onOpenAuthor(story.authorId) },
                                modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l)
                            )
                        }
                    }
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        SectionHeader("Stories from writers you follow", modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l))
                        if (followedWriterStories.isEmpty()) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = KathaTheme.Spacing.l)
                                    .clip(RoundedCornerShape(KathaTheme.Radius.l))
                                    .background(KathaTheme.surface)
                                    .padding(KathaTheme.Spacing.xl),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                            ) {
                                Text("Follow writers you enjoy to see their new stories here.", style = KathaTypography.Body, color = KathaTheme.textSecondary, textAlign = TextAlign.Center)
                                TextLink("Discover writers ▸") { onSeeMoreWriters() }
                            }
                        } else {
                            followedWriterStories.forEach { story ->
                                StoryCard(
                                    story = story,
                                    isLiked = story.id in state.likedStoryIds,
                                    isBookmarked = story.id in state.bookmarkedStoryIds,
                                    onLike = { onLike(story.id) },
                                    onBookmark = { onBookmark(story.id) },
                                    onTap = { onOpenStory(story.id) },
                                    onAuthorTap = { onOpenAuthor(story.authorId) },
                                    modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l)
                                )
                            }
                        }
                    }
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        SectionHeader("Rising this week", modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l))
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = KathaTheme.Spacing.l),
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            items(risingStories, key = { it.id }) { story ->
                                CompactStoryCard(story = story, badge = "🔥 Rising", onAuthorTap = { onOpenAuthor(story.authorId) }, onTap = { onOpenStory(story.id) })
                            }
                        }
                    }
                }

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
                    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                        SectionHeader("Katha's picks", modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l))
                        kathaPicks.forEach { story ->
                            StoryCard(
                                story = story,
                                isLiked = story.id in state.likedStoryIds,
                                isBookmarked = story.id in state.bookmarkedStoryIds,
                                onLike = { onLike(story.id) },
                                onBookmark = { onBookmark(story.id) },
                                onTap = { onOpenStory(story.id) },
                                onAuthorTap = { onOpenAuthor(story.authorId) },
                                modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l)
                            )
                        }
                    }
                }
            }

            item { SafeBottomSpacer() }
        }
    }
}

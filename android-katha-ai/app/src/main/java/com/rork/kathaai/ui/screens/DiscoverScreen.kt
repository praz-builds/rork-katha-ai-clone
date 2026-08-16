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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.ChatBubble
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.FilterChip
import com.rork.kathaai.ui.components.GenreChip
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.StoryCover
import com.rork.kathaai.ui.components.formatCount
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState

@Composable
fun DiscoverScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    modifier: Modifier = Modifier,
    onOpenStory: (String) -> Unit,
    onOpenAuthor: (String) -> Unit = {}
) {
    var query by remember { mutableStateOf("") }
    var selectedGenre by remember { mutableStateOf<Genre?>(null) }

    val results = remember(query, selectedGenre, state.discoverFeedChip, state.discoverThemeFilter, state.userComments, state.blockedUserIds) {
        val baseList = state.discoverFeedStories()
        val filtered = if (query.isNotBlank()) {
            val q = query.trim().lowercase()
            baseList.filter { story ->
                story.title.lowercase().contains(q) ||
                    story.synopsis.lowercase().contains(q) ||
                    story.tags.any { it.lowercase().contains(q) } ||
                    story.genre.displayName.lowercase().contains(q) ||
                    (SeedData.author(story.authorId)?.displayName?.lowercase()?.contains(q) ?: false)
            }
        } else {
            baseList
        }
        if (selectedGenre != null) filtered.filter { it.genre == selectedGenre } else filtered
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = KathaTheme.Spacing.l,
                end = KathaTheme.Spacing.l,
                top = KathaTheme.Spacing.l,
                bottom = KathaTheme.Spacing.l
            ),
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(
                    "Discover",
                    color = KathaTheme.textPrimary,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search stories, authors, genres") },
                    leadingIcon = {
                        Icon(
                            Icons.Outlined.Search, null,
                            tint = KathaTheme.textSecondary,
                            modifier = Modifier.size(18.dp)
                        )
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = KathaTheme.accent,
                        unfocusedBorderColor = KathaTheme.border,
                        focusedContainerColor = KathaTheme.surface,
                        unfocusedContainerColor = KathaTheme.surface,
                        focusedTextColor = KathaTheme.textPrimary,
                        unfocusedTextColor = KathaTheme.textPrimary
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                    item {
                        FilterChip("All", selectedGenre == null) { selectedGenre = null }
                    }
                    items(Genre.entries.filter { !(state.kidsMode && it == Genre.EROTICA) }) { genre ->
                        GenreChip(genre, selectedGenre == genre) {
                            selectedGenre = if (selectedGenre == genre) null else genre
                        }
                    }
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                    item { FeedChip("For You", state.discoverFeedChip == 0, Icons.Outlined.AutoAwesome) { viewModel.setDiscoverFeedChip(0) } }
                    item { FeedChip("Trending", state.discoverFeedChip == 1, Icons.Outlined.LocalFireDepartment) { viewModel.setDiscoverFeedChip(1) } }
                    item { FeedChip("Rising", state.discoverFeedChip == 2, Icons.Outlined.TrendingUp) { viewModel.setDiscoverFeedChip(2) } }
                    item { FeedChip("New", state.discoverFeedChip == 3, Icons.Outlined.Schedule) { viewModel.setDiscoverFeedChip(3) } }
                }
            }

            // Theme filter bar
            state.discoverThemeFilter?.let { theme ->
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.m))
                            .background(KathaTheme.accentSoft.copy(alpha = 0.3f))
                            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.s),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                    ) {
                        Icon(Icons.Outlined.Tag, null, tint = KathaTheme.accent, modifier = Modifier.size(12.dp))
                        Text("Theme: $theme", color = KathaTheme.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.weight(1f))
                        Icon(Icons.Outlined.Close, "Clear", tint = KathaTheme.textTertiary, modifier = Modifier.size(16.dp).clickable { viewModel.clearThemeFilter() })
                    }
                }
            }

            if (results.isEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    EmptyState(
                        icon = Icons.Outlined.Search,
                        title = "No stories found",
                        message = "Try a different search term or genre filter."
                    )
                }
            } else {
                items(results, key = { it.id }) { story ->
                    DiscoverStoryCard(story, state, viewModel, onOpenStory, onOpenAuthor)
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) { SafeBottomSpacer() }
        }
    }
}

@Composable
private fun FeedChip(
    title: String,
    isSelected: Boolean,
    icon: ImageVector,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (isSelected) KathaTheme.accent else KathaTheme.surface)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Icon(icon, null, tint = if (isSelected) Color.White else KathaTheme.textSecondary, modifier = Modifier.size(12.dp))
        Text(title, color = if (isSelected) Color.White else KathaTheme.textSecondary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun DiscoverStoryCard(
    story: Story,
    state: KathaUiState,
    viewModel: AppViewModel,
    onOpenStory: (String) -> Unit,
    onOpenAuthor: (String) -> Unit
) {
    Column(
        modifier = Modifier.clickable { onOpenStory(story.id) },
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        Box {
            StoryCover(story, height = 130.dp, titleSize = 14)
            Column(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                if (state.isRisingStory(story)) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(KathaTheme.accent)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp)
                    ) {
                        Icon(Icons.Outlined.TrendingUp, null, tint = Color.White, modifier = Modifier.size(9.dp))
                        Text("Rising", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                if (state.isNewStory(story)) {
                    Text(
                        "NEW",
                        color = Color.White,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(KathaTheme.success)
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }

        Text(
            story.title,
            color = KathaTheme.textPrimary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )

        SeedData.author(story.authorId)?.let { author ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
                modifier = Modifier.clickable { onOpenAuthor(author.id) }
            ) {
                Text(author.displayName, color = KathaTheme.textSecondary, fontSize = 12.sp)
                if (author.isVerified) {
                    Icon(Icons.Outlined.Verified, null, tint = KathaTheme.accent, modifier = Modifier.size(9.dp))
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            story.tags.take(2).forEach { tag ->
                Text(
                    tag,
                    color = KathaTheme.accent,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(KathaTheme.accentSoft.copy(alpha = 0.5f))
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .clickable { viewModel.applyThemeFilter(tag) }
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
            IconCount(Icons.Outlined.FavoriteBorder, formatCount(state.storyLikeCount(story.id, story.likes)))
            IconCount(Icons.Outlined.BookmarkBorder, formatCount(story.bookmarks))
            IconCount(Icons.Outlined.ChatBubble, formatCount(state.commentCount(story.id)))
        }
    }
}

@Composable
private fun IconCount(icon: ImageVector, value: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Icon(icon, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(12.dp))
        Text(value, color = KathaTheme.textTertiary, fontSize = 11.sp)
    }
}

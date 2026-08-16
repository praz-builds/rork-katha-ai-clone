package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.LibraryBooks
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.ui.components.CompactStoryCard
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SegmentedControl
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.KathaUiState

@Composable
fun LibraryScreen(
    state: KathaUiState,
    modifier: Modifier = Modifier,
    onOpenStory: (String) -> Unit,
    onSignIn: () -> Unit
) {
    var tabIndex by remember { mutableIntStateOf(0) }

    val stories = when (tabIndex) {
        0 -> SeedData.stories.filter { it.id in state.bookmarkedStoryIds && state.isStoryVisibleInKidsMode(it) }
        1 -> SeedData.stories.filter { it.id in state.likedStoryIds && state.isStoryVisibleInKidsMode(it) }
        2 -> state.publishedStories.map { it.asStory() }
        3 -> SeedData.stories.filter { it.id in state.readStoryIds && state.isStoryVisibleInKidsMode(it) }
        else -> state.offlineStoryRecords.mapNotNull { record -> SeedData.story(record.storyId)?.takeIf { state.isStoryVisibleInKidsMode(it) } }
    }

    val emptyMessage = when (tabIndex) {
        0 -> "Stories you bookmark will appear here."
        1 -> "Stories you like will appear here."
        2 -> "Stories you generate will appear here."
        3 -> "Stories you've read will appear here."
        else -> "Tap the download icon in any story to save it for offline."
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(KathaTheme.Spacing.l),
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            // New chapter banner
            if (state.hasUnreadNewChapters) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    NewChapterBanner(
                        state = state,
                        onDismiss = { },
                        onTap = { }
                    )
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(
                    "Library",
                    color = KathaTheme.textPrimary,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            if (!state.isAuthenticated) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    EmptyState(
                        icon = Icons.Outlined.LibraryBooks,
                        title = "Your library is waiting",
                        message = "Sign in to save stories, track your reading, and keep everything in one place.",
                        ctaTitle = "Sign in",
                        onCta = onSignIn
                    )
                }
            } else {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    SegmentedControl(listOf("Saved", "Liked", "Published", "History", "Downloads"), tabIndex) { tabIndex = it }
                }

                if (stories.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        EmptyState(
                            icon = Icons.Outlined.Inbox,
                            title = "Nothing here yet",
                            message = emptyMessage
                        )
                    }
                } else {
                    items(stories, key = { it.id }) { story ->
                        CompactStoryCard(story) { onOpenStory(story.id) }
                    }
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) { SafeBottomSpacer() }
        }
    }
}

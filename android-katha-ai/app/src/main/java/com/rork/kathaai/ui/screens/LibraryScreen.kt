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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.LibraryBooks
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.rork.kathaai.model.GeneratedStory
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SegmentedControl
import com.rork.kathaai.ui.components.StoryCard
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    modifier: Modifier = Modifier,
    onOpenStory: (String) -> Unit,
    onSignIn: () -> Unit
) {
    val context = LocalContext.current
    val preferences = remember { context.getSharedPreferences("katha_library", Context.MODE_PRIVATE) }
    var tabIndex by remember { mutableIntStateOf(0) }
    var showSortSheet by remember { mutableStateOf(false) }
    var sortOrder by remember { mutableStateOf(preferences.getString("library_saved_sort_order", "recentlySaved") ?: "recentlySaved") }
    var removedStoryId by remember { mutableStateOf<String?>(null) }
    var showUndo by remember { mutableStateOf(false) }

    val savedStories = remember(state, sortOrder) {
        val saved = SeedData.stories.filter { it.id in state.bookmarkedStoryIds && state.isStoryVisibleInKidsMode(it) }
        when (sortOrder) {
            "alphabetical" -> saved.sortedBy { it.title.lowercase() }
            "byAuthor" -> saved.sortedBy { SeedData.author(it.authorId)?.displayName?.lowercase() ?: "" }
            else -> saved
        }
    }
    val historyStories = remember(state) { SeedData.stories.filter { it.id in state.readStoryIds && state.isStoryVisibleInKidsMode(it) } }
    val downloadedStories = remember(state) { state.offlineStoryRecords.mapNotNull { record -> SeedData.story(record.storyId)?.takeIf { state.isStoryVisibleInKidsMode(it) } } }

    LaunchedEffect(showUndo) {
        if (showUndo) {
            delay(3_000)
            showUndo = false
            removedStoryId = null
        }
    }

    Box(modifier = modifier.fillMaxSize().background(KathaTheme.canvas)) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            if (state.hasUnreadNewChapters) item { NewChapterBanner(state = state, onDismiss = {}, onTap = {}) }
            item { Text("Library", style = KathaTypography.Title1, color = KathaTheme.textPrimary) }

            if (!state.isAuthenticated) {
                item {
                    EmptyState(
                        icon = Icons.Outlined.LibraryBooks,
                        title = "Your library is waiting",
                        message = "Sign in to save stories, track your reading, and keep everything in one place.",
                        ctaTitle = "Sign in",
                        onCta = onSignIn
                    )
                }
            } else {
                item { SegmentedControl(listOf("Saved", "History", "Downloads", "My stories"), tabIndex) { tabIndex = it } }
                when (tabIndex) {
                    0 -> {
                        item {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = KathaTheme.Spacing.s),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("${savedStories.size} saved stories", style = KathaTypography.Meta, color = KathaTheme.textSecondary)
                                Spacer(Modifier.weight(1f))
                                TextLink("Sort: ${sortLabel(sortOrder)} ▾") { showSortSheet = true }
                            }
                        }
                        if (savedStories.isEmpty()) {
                            item { EmptyState(icon = Icons.Outlined.Inbox, title = "Nothing here yet", message = "Stories you bookmark will appear here.") }
                        } else {
                            items(savedStories, key = { it.id }) { story ->
                                val dismissState = rememberSwipeToDismissBoxState(confirmValueChange = { value ->
                                    if (value == SwipeToDismissBoxValue.EndToStart) {
                                        viewModel.toggleBookmark(story.id)
                                        removedStoryId = story.id
                                        showUndo = true
                                        false
                                    } else true
                                })
                                SwipeToDismissBox(
                                    state = dismissState,
                                    backgroundContent = {
                                        Box(
                                            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(KathaTheme.Radius.l)).background(KathaTheme.error).padding(KathaTheme.Spacing.m),
                                            contentAlignment = Alignment.CenterEnd
                                        ) {
                                            Text("Remove", style = KathaTypography.Caption, color = Color.White)
                                        }
                                    },
                                    enableDismissFromStartToEnd = false
                                ) {
                                    StoryCard(
                                        story = story,
                                        isLiked = story.id in state.likedStoryIds,
                                        isBookmarked = true,
                                        onLike = { viewModel.toggleLike(story.id) },
                                        onBookmark = { viewModel.toggleBookmark(story.id) },
                                        onTap = { onOpenStory(story.id) },
                                        onAuthorTap = { viewModel.openAuthorProfile(story.authorId) },
                                        onLongClick = {
                                            viewModel.toggleBookmark(story.id)
                                            removedStoryId = story.id
                                            showUndo = true
                                        }
                                    )
                                }
                            }
                        }
                    }
                    1 -> {
                        item { storyList(historyStories, "Stories you've read will appear here.", onOpenStory, viewModel) }
                    }
                    2 -> {
                        if (downloadedStories.isEmpty()) {
                            item { EmptyState(icon = Icons.Outlined.Inbox, title = "No stories downloaded yet", message = "Tap the download icon in any story to save it for offline.") }
                        } else {
                            items(downloadedStories, key = { it.id }) { story ->
                                StoryCard(story = story, onTap = { onOpenStory(story.id) }, onAuthorTap = { viewModel.openAuthorProfile(story.authorId) })
                            }
                        }
                    }
                    else -> {
                        item { MyStoriesContent(state = state, viewModel = viewModel) }
                    }
                }
            }
            item { SafeBottomSpacer() }
        }

        if (showUndo && removedStoryId != null) {
            Row(
                modifier = Modifier.align(Alignment.BottomCenter).padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.xxxl).clip(RoundedCornerShape(KathaTheme.Radius.m)).background(KathaTheme.surfaceElevated).padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
            ) {
                Text("Removed from Library", style = KathaTypography.BodyStrong, color = KathaTheme.textPrimary)
                TextLink("Undo") {
                    removedStoryId?.let { viewModel.toggleBookmark(it) }
                    showUndo = false
                    removedStoryId = null
                }
            }
        }
    }

    if (showSortSheet) {
        ModalBottomSheet(onDismissRequest = { showSortSheet = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(modifier = Modifier.fillMaxWidth().padding(bottom = KathaTheme.Spacing.xxxl)) {
                Text("Sort saved stories", style = KathaTypography.Title2, color = KathaTheme.textPrimary, modifier = Modifier.padding(KathaTheme.Spacing.l))
                listOf("recentlySaved", "alphabetical", "byAuthor").forEach { order ->
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable {
                            sortOrder = order
                            preferences.edit().putString("library_saved_sort_order", order).apply()
                            showSortSheet = false
                        }.padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(sortLabel(order), style = KathaTypography.Body, color = KathaTheme.textPrimary)
                        Spacer(Modifier.weight(1f))
                        if (order == sortOrder) Text("✓", style = KathaTypography.BodyStrong, color = KathaTheme.accent)
                    }
                }
            }
        }
    }
}

private fun sortLabel(order: String): String = when (order) {
    "alphabetical" -> "Alphabetical (A–Z)"
    "byAuthor" -> "By author (A–Z)"
    else -> "Recently saved"
}

@Composable
private fun storyList(stories: List<Story>, emptyMessage: String, onOpenStory: (String) -> Unit, viewModel: AppViewModel) {
    if (stories.isEmpty()) {
        EmptyState(icon = Icons.Outlined.Inbox, title = "Nothing here yet", message = emptyMessage)
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
            stories.forEach { story ->
                StoryCard(story = story, onTap = { onOpenStory(story.id) }, onAuthorTap = { viewModel.openAuthorProfile(story.authorId) })
            }
        }
    }
}

@Composable
private fun MyStoriesContent(state: KathaUiState, viewModel: AppViewModel) {
    val all = state.publishedStories
    val published = all.filter { it.isPublished && it.chapters.none { chapter -> !chapter.isPublished } }
    val drafts = all.filter { !it.isPublished || it.chapters.any { chapter -> !chapter.isPublished } }
    if (published.isEmpty() && drafts.isEmpty()) {
        EmptyState(icon = Icons.Outlined.Inbox, title = "Nothing here yet", message = "Write your first story ▸", ctaTitle = "Write your first story ▸", onCta = { viewModel.requestTab(1) })
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
            if (published.isNotEmpty()) {
                Text("PUBLISHED", style = KathaTypography.Meta, color = KathaTheme.textTertiary)
                published.forEach { generated -> GeneratedStoryRow(generated, false, viewModel) }
            }
            if (drafts.isNotEmpty()) {
                Text("DRAFTS", style = KathaTypography.Meta, color = KathaTheme.textTertiary)
                drafts.forEach { generated -> GeneratedStoryRow(generated, true, viewModel) }
            }
        }
    }
}

@Composable
private fun GeneratedStoryRow(generated: GeneratedStory, isDraft: Boolean, viewModel: AppViewModel) {
    Box {
        StoryCard(story = generated.asStory(), onTap = { viewModel.openGeneratedStory(generated) }, onAuthorTap = { viewModel.openOwnProfile() })
        if (isDraft) {
            Text("Draft", style = KathaTypography.Meta, color = KathaTheme.accent, modifier = Modifier.align(Alignment.TopEnd).padding(KathaTheme.Spacing.s).clip(RoundedCornerShape(KathaTheme.Radius.xl)).background(KathaTheme.accentSoft).padding(horizontal = KathaTheme.Spacing.s, vertical = KathaTheme.Spacing.xs))
        }
    }
}

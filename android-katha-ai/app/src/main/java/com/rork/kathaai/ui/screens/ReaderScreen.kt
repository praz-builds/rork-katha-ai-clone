package com.rork.kathaai.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.ChatBubble
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.List
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.Chapter
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.components.AuthorRow
import com.rork.kathaai.ui.components.DestructiveCTA
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.components.SectionHeader
import com.rork.kathaai.ui.components.StoryCover
import com.rork.kathaai.ui.components.formatCount
import com.rork.kathaai.ui.components.timeAgo
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import com.rork.kathaai.viewmodel.recordStreakActivity
import com.rork.kathaai.viewmodel.openAudioPlayer
import com.rork.kathaai.viewmodel.downloadStory
import com.rork.kathaai.viewmodel.removeOfflineStory
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun ReaderScreen(
    story: Story,
    state: KathaUiState,
    viewModel: AppViewModel,
    modifier: Modifier = Modifier,
    onClose: () -> Unit,
    onLike: () -> Unit,
    onBookmark: () -> Unit,
    onFollow: (String) -> Unit,
    onToggleSepia: () -> Unit,
    onSignIn: () -> Unit,
    onRead: () -> Unit,
    onContinueStory: () -> Unit = {},
    onFollowStory: () -> Unit = {},
    onNavigateChapter: (Int) -> Unit = {},
    onShowChapterList: () -> Unit = {},
    onPublishChapter: (String) -> Unit = {},
    onDeleteDraft: (String) -> Unit = {},
    onOpenAuthor: (String) -> Unit = {},
    onOpenComments: (String) -> Unit = {},
    onShare: () -> Unit = {}
) {
    val sepia = state.readerSepia
    val bg = if (sepia) KathaTheme.sepiaCanvas else KathaTheme.canvas
    val textColor = if (sepia) KathaTheme.sepiaText else KathaTheme.textPrimary
    val textSecondary = if (sepia) KathaTheme.sepiaTextSecondary else KathaTheme.textSecondary
    val surface = if (sepia) KathaTheme.sepiaSurface else KathaTheme.surface

    val isLiked = story.id in state.likedStoryIds
    val isBookmarked = story.id in state.bookmarkedStoryIds
    val isCurrentUserAuthor = state.isAuthenticated && story.authorId == state.currentUser?.username

    val currentChapterIndex = state.currentChapterIndex.coerceIn(0, maxOf(0, story.chapters.size - 1))
    val currentChapter = story.chapters.getOrNull(currentChapterIndex) ?: story.chapters.firstOrNull()
    val isDraftChapter = currentChapter?.isPublished == false
    val scrollState = rememberLazyListState()
    var navVisible by remember { mutableStateOf(true) }
    var progressVisible by remember { mutableStateOf(false) }
    var likeBurst by remember { mutableStateOf(false) }
    var heartPulse by remember { mutableStateOf(false) }
    val progress = remember(scrollState.firstVisibleItemIndex, scrollState.firstVisibleItemScrollOffset, currentChapter?.paragraphs?.size) {
        val totalItems = 12 + (currentChapter?.paragraphs?.size ?: 1)
        ((scrollState.firstVisibleItemIndex + scrollState.firstVisibleItemScrollOffset / 1000f) / maxOf(1, totalItems - 1)).coerceIn(0f, 1f)
    }

    LaunchedEffect(scrollState) {
        var previousPosition = 0
        snapshotFlow { scrollState.firstVisibleItemIndex * 1000 + scrollState.firstVisibleItemScrollOffset }.collect { position ->
            val delta = position - previousPosition
            previousPosition = position
            navVisible = if (!state.isAuthenticated || position <= 8) true else if (abs(delta) >= 8) delta < 0 else navVisible
            progressVisible = true
            delay(1_000)
            progressVisible = false
        }
    }

    LaunchedEffect(likeBurst) {
        if (likeBurst) {
            delay(240)
            likeBurst = false
            heartPulse = false
        }
    }
    val heartScale by animateFloatAsState(
        targetValue = if (heartPulse) 1.15f else 1f,
        animationSpec = androidx.compose.animation.core.spring(dampingRatio = 0.55f, stiffness = 500f),
        label = "readerHeartScale"
    )

    LaunchedEffect(story.id, state.isAuthenticated) {
        if (state.isAuthenticated) {
            onRead()
            delay(30_000)
            viewModel.recordStreakActivity("Read a story")
        }
    }

    if (state.kidsMode && story.effectiveContentRating == com.rork.kathaai.model.ContentRating.MATURE) {
        RestrictedStoryPlaceholder(viewModel = viewModel, modifier = modifier)
        return
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(bg)
    ) {
        LazyColumn(
            state = scrollState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = KathaTheme.Spacing.l,
                end = KathaTheme.Spacing.l,
                top = 64.dp,
                bottom = KathaTheme.Spacing.l
            ),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            // Draft banner
            if (isDraftChapter && isCurrentUserAuthor) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(0.dp))
                            .background(KathaTheme.accentSoft)
                            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Icon(Icons.Outlined.Edit, null, tint = KathaTheme.accent, modifier = Modifier.size(18.dp))
                        Text(
                            "This chapter is a draft. Not visible to readers.",
                            color = KathaTheme.textPrimary,
                            fontSize = KathaTypography.Body.fontSize,
                            fontWeight = KathaTypography.BodyStrong.fontWeight
                        )
                    }
                }
            }

            item { StoryCover(story, height = 260.dp, titleSize = 24) }

            // Metadata with series progress badge
            item {
                Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                    Text(story.title, style = KathaTypography.ReaderStoryTitle, color = textColor)
                    Text(
                        if (story.isSeries) {
                            "${story.genre.displayName}  ·  ${story.language.uppercase()}  ·  Chapter ${currentChapterIndex + 1} of ${story.chapters.size}  ·  ${timeAgo(story.publishedOffset)}"
                        } else {
                            "${story.genre.displayName}  ·  ${story.language.uppercase()}  ·  ${story.readingTimeMinutes} min read  ·  ${timeAgo(story.publishedOffset)}"
                        },
                        color = textSecondary,
                        style = KathaTypography.Meta
                    )
                    Text(story.synopsis, style = KathaTypography.Body, color = textSecondary)

                    if (story.isSeries) {
                        SeriesProgressBadge(story = story, isAuthor = isCurrentUserAuthor)
                    }
                }
            }

            // Author section
            if (isCurrentUserAuthor) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.m))
                            .background(surface)
                            .padding(KathaTheme.Spacing.l),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        val user = state.currentUser!!
                        GeneratedAvatar(user.username, user.displayName, 44.dp)
                        Column(Modifier.weight(1f)) {
                            Text(
                                user.displayName.ifEmpty { user.username },
                                color = textColor,
                                fontSize = KathaTypography.Body.fontSize,
                                fontWeight = KathaTypography.BodyStrong.fontWeight
                            )
                            Text("@${user.username} · You", color = textSecondary, fontSize = KathaTypography.Meta.fontSize)
                        }
                    }
                }
            } else {
                SeedData.author(story.authorId)?.let { author ->
                    item {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(KathaTheme.Radius.m))
                                .background(surface)
                                .padding(KathaTheme.Spacing.l),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            Row(
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { onOpenAuthor(author.id) },
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                            ) {
                                GeneratedAvatar(author.username, author.displayName, 44.dp)
                                Column {
                                    Text(
                                        author.displayName,
                                        color = textColor,
                                        fontSize = KathaTypography.Body.fontSize,
                                        fontWeight = KathaTypography.BodyStrong.fontWeight
                                    )
                                    Text(
                                        "@${author.username}",
                                        color = textSecondary,
                                        fontSize = KathaTypography.Meta.fontSize
                                    )
                                }
                            }
                            // Reader hero skips the unfollow confirmation modal
                            FollowButton(
                                isFollowing = author.id in state.followedAuthorIds
                            ) { onFollow(author.id) }
                        }
                    }
                }
            }

            if (state.isAuthenticated) {
                // Current chapter content
                currentChapter?.let { chapter ->
                    item {
                        Text(
                            chapter.title,
                            style = KathaTypography.ReaderChapterTitle,
                            color = textColor,
                            modifier = Modifier.padding(top = KathaTheme.Spacing.m)
                        )
                    }
                    val firstProseIndex = chapter.paragraphs.indexOfFirst { paragraph ->
                        val trimmed = paragraph.trim()
                        trimmed.isNotEmpty() && trimmed != "· · ·"
                    }
                    itemsIndexed(chapter.paragraphs) { index, para ->
                        if (index == firstProseIndex) {
                            ReaderDropCapParagraph(para, textColor, if (sepia) KathaTheme.sepiaAccent else KathaTheme.accent)
                        } else {
                            Text(
                                para,
                                style = KathaTypography.readerBody(18),
                                color = textColor,
                                lineHeight = 28.sp
                            )
                        }
                    }
                }

                // End of chapter section
                if (isDraftChapter && isCurrentUserAuthor) {
                    // Draft state - author view
                    currentChapter?.let { chapter ->
                        item { DraftEndOfChapter(story = story, chapter = chapter, state = state, onPublish = onPublishChapter, onDelete = onDeleteDraft, onContinue = onContinueStory) }
                    }
                } else if (isCurrentUserAuthor) {
                    // Author view - published chapter
                    currentChapter?.let { chapter ->
                        item { AuthorEndOfChapter(story = story, chapter = chapter, state = state, onContinue = onContinueStory) }
                    }
                } else {
                    // Reader view
                    item { ReaderEndOfChapter(story = story, state = state, onFollowStory = onFollowStory) }
                }

                // Comments preview (only for non-draft)
                if (!isDraftChapter) {
                    item {
                        val commentCount = state.commentCount(story.id)
                        Column(
                            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m),
                            modifier = Modifier.padding(top = KathaTheme.Spacing.l)
                        ) {
                            SectionHeader("Comments")
                            if (commentCount == 0) {
                                Text(
                                    "No comments yet. Be the first to share your thoughts.",
                                    color = textSecondary,
                                    fontSize = KathaTypography.Body.fontSize
                                )
                            } else {
                                val comments = state.commentsFor(story.id)
                                    .sortedByDescending { state.commentLikeCount(it) }
                                    .take(2)
                                comments.forEach { comment ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(KathaTheme.Radius.s))
                                            .background(surface)
                                            .padding(KathaTheme.Spacing.m),
                                        verticalAlignment = Alignment.Top,
                                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                                    ) {
                                        GeneratedAvatar(comment.username, comment.displayName, 28.dp)
                                        Column(modifier = Modifier.weight(1f)) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                                            ) {
                                                Text(
                                                    comment.displayName,
                                                    color = textColor,
                                                    style = KathaTypography.Meta,
                                                    fontWeight = KathaTypography.BodyStrong.fontWeight
                                                )
                                                if (comment.isVerified) {
                                                    Icon(Icons.Outlined.Verified, null, tint = KathaTheme.accent, modifier = Modifier.size(9.dp))
                                                }
                                                Text(comment.timeLabel, color = KathaTheme.textTertiary, fontSize = KathaTypography.Meta.fontSize)
                                            }
                                            Text(comment.text, color = textColor, style = KathaTypography.Meta, maxLines = 2)
                                        }
                                    }
                                }
                                if (commentCount > 2) {
                                    Text(
                                        "View all $commentCount comments",
                                        color = KathaTheme.accent,
                                        style = KathaTypography.Meta,
                                        fontWeight = KathaTypography.BodyStrong.fontWeight,
                                        modifier = Modifier.clickable { onOpenComments(story.id) }
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                // Unauthenticated readers get roughly the first 40% of chapter one
                val firstChapter = story.chapters.firstOrNull()
                val cutoff = firstChapter?.let { maxOf(1, (it.paragraphs.size * 0.4).toInt()) } ?: 0
                if (firstChapter != null) {
                    item {
                        Text(
                            firstChapter.title,
                            style = KathaTypography.ReaderChapterTitle,
                            color = textColor,
                            modifier = Modifier.padding(top = KathaTheme.Spacing.m)
                        )
                    }
                    val visibleParagraphs = firstChapter.paragraphs.take(cutoff)
                    val firstProseIndex = visibleParagraphs.indexOfFirst { paragraph ->
                        val trimmed = paragraph.trim()
                        trimmed.isNotEmpty() && trimmed != "· · ·"
                    }
                    itemsIndexed(visibleParagraphs) { index, para ->
                        if (index == firstProseIndex) {
                            ReaderDropCapParagraph(para, textColor, if (sepia) KathaTheme.sepiaAccent else KathaTheme.accent)
                        } else {
                            Text(
                                para,
                                style = KathaTypography.readerBody(18),
                                color = textColor,
                                lineHeight = 28.sp
                            )
                        }
                    }
                }

                item {
                    Column(Modifier.fillMaxWidth()) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(72.dp)
                                .background(bg.copy(alpha = 0.96f))
                                .blur(4.dp)
                        )
                        Column(
                            modifier = Modifier.fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)
                        ) {
                            firstChapter?.paragraphs?.drop(cutoff).orEmpty().forEachIndexed { index, paragraph ->
                                Text(
                                    paragraph,
                                    style = KathaTypography.readerBody(18),
                                    color = textColor,
                                    lineHeight = 28.sp,
                                    modifier = Modifier.blur((index + 1).coerceAtMost(20).times(3).dp)
                                )
                            }
                        }
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = KathaTheme.Spacing.xxl),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            Icon(
                                Icons.Outlined.Lock, null,
                                tint = KathaTheme.textTertiary,
                                modifier = Modifier.size(32.dp)
                            )
                            Text(
                                "Keep reading",
                                color = KathaTheme.textPrimary,
                                fontSize = KathaTypography.Title2.fontSize,
                                fontWeight = KathaTypography.BodyStrong.fontWeight
                            )
                            Text(
                                "Sign in to continue this story and save your progress.",
                                color = KathaTheme.textSecondary,
                                fontSize = KathaTypography.Body.fontSize,
                                textAlign = TextAlign.Center
                            )
                            PrimaryCTA(
                                "Sign in to continue",
                                Modifier.padding(horizontal = KathaTheme.Spacing.xl),
                                onClick = onSignIn
                            )
                        }
                    }
                }
            }

            item { SafeBottomSpacer(80.dp) }
        }

        // Reader progress remains independent from the auto-hidden navigation.
        val progressAlpha by androidx.compose.animation.core.animateFloatAsState(
            targetValue = if (progressVisible) 1f else 0f,
            animationSpec = tween(300),
            label = "readerProgressAlpha"
        )
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .padding(top = KathaTheme.Spacing.xxl48)
                .height(2.dp)
                .alpha(progressAlpha)
                .background(KathaTheme.borderStrong.copy(alpha = 0.4f))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(progress)
                    .fillMaxHeight()
                    .background(if (sepia) KathaTheme.sepiaAccent else KathaTheme.accent)
            )
        }

        // Floating top controls
        Row(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .padding(KathaTheme.Spacing.l)
                .alpha(if (navVisible) 1f else 0f)
                .offset(y = if (navVisible) 0.dp else (-80).dp)
                .animateContentSize(animationSpec = tween(250)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            CircleIconButton(Icons.Outlined.Close, "Close", surface, textColor, onClose)
            Spacer(Modifier.weight(1f))

            // DRAFT pill
            if (isDraftChapter && isCurrentUserAuthor) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(KathaTheme.accent)
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text("DRAFT", color = Color.White, fontSize = KathaTypography.Meta.fontSize, fontWeight = KathaTypography.Title1.fontWeight)
                }
            }

            CircleIconButton(
                Icons.Outlined.MenuBook,
                "Sepia mode",
                surface,
                if (sepia) KathaTheme.accent else textColor,
                onToggleSepia
            )
            CircleIconButton(
                if (isBookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                "Save",
                surface,
                if (isBookmarked) KathaTheme.accent else textColor,
                onBookmark
            )
            CircleIconButton(
                Icons.Outlined.MenuBook,
                "Audio",
                surface,
                textColor,
                { viewModel.openAudioPlayer(story.id) }
            )
            CircleIconButton(
                Icons.Outlined.CloudOff,
                "Offline",
                surface,
                if (state.offlineStoryRecords.any { it.storyId == story.id }) KathaTheme.success else textColor,
                { if (state.offlineStoryRecords.any { it.storyId == story.id }) viewModel.removeOfflineStory(story.id) else viewModel.downloadStory(story.id) }
            )
            // Chapter list button
            CircleIconButton(
                Icons.Outlined.List,
                "Chapters",
                surface,
                textColor,
                onShowChapterList
            )
        }

        // Chapter navigation buttons (series only)
        if (story.isSeries && state.isAuthenticated) {
            // Left button
            if (currentChapterIndex > 0) {
                Row(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = 4.dp)
                        .alpha(if (navVisible) 1f else 0f)
                ) {
                    ChapterNavButton(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Previous") {
                        onNavigateChapter(currentChapterIndex - 1)
                    }
                }
            }
            // Right button
            val canGoNext = if (isCurrentUserAuthor) {
                currentChapterIndex < story.chapters.size - 1
            } else {
                val nextIndex = currentChapterIndex + 1
                nextIndex < story.chapters.size && story.chapters[nextIndex].isPublished
            }
            if (canGoNext) {
                Row(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(end = 4.dp)
                        .alpha(if (navVisible) 1f else 0f)
                ) {
                    ChapterNavButton(Icons.AutoMirrored.Outlined.KeyboardArrowRight, "Next") {
                        onNavigateChapter(currentChapterIndex + 1)
                    }
                }
            }
        }

        // Audio mini-bar + engagement bar
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
        ) {
            if (!isDraftChapter) {
                AudioMiniBar(story = story, state = state, viewModel = viewModel)
            }
            // Bottom engagement bar (hidden in draft state)
            if (!isDraftChapter || !isCurrentUserAuthor) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(surface)
                        .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
                ) {
                Box(
                    modifier = Modifier.clickable {
                        if (isCurrentUserAuthor) {
                            /* analytics toast */
                        } else {
                            val wasLiked = isLiked
                            onLike()
                            if (state.isAuthenticated && !wasLiked) {
                                heartPulse = true
                                likeBurst = true
                            }
                        }
                    }
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.scale(heartScale)
                    ) {
                        Icon(
                            if (isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                            "Like",
                            tint = if (isLiked) KathaTheme.heart else textSecondary,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            formatCount(state.storyLikeCount(story.id, story.likes)),
                            color = if (isLiked) KathaTheme.heart else textSecondary,
                            fontSize = KathaTypography.Body.fontSize,
                            fontWeight = if (isLiked) FontWeight.SemiBold else FontWeight.Normal
                        )
                    }
                    if (likeBurst) ReaderLikeParticleBurst()
                }
                // Comment button
                if (!state.kidsMode || state.kidsCommentsEnabled) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.clickable { onOpenComments(story.id) }
                    ) {
                        Icon(
                            Icons.Outlined.ChatBubble, "Comments",
                            tint = textSecondary,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            formatCount(state.commentCount(story.id)),
                            color = textSecondary,
                            fontSize = KathaTypography.Body.fontSize
                        )
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.clickable { onBookmark() }
                ) {
                    Icon(
                        if (isBookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                        "Save",
                        tint = if (isBookmarked) KathaTheme.accent else textSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                    Text(
                        formatCount(story.bookmarks + if (isBookmarked) 1 else 0),
                        color = if (isBookmarked) KathaTheme.accent else textSecondary,
                        fontSize = KathaTypography.Body.fontSize
                    )
                }
                if (!state.kidsMode || state.kidsShareEnabled) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.clickable { onShare() }
                    ) {
                        Icon(
                            Icons.Outlined.Share, "Share",
                            tint = textSecondary,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        Icons.Outlined.MenuBook, null,
                        tint = KathaTheme.textTertiary,
                        modifier = Modifier.size(18.dp)
                    )
                    Text(formatCount(story.views), color = KathaTheme.textTertiary, fontSize = KathaTypography.Body.fontSize)
                }
            }
        }
        }
    }
}

@Composable
private fun ReaderDropCapParagraph(text: String, textColor: Color, accent: Color) {
    val letterIndex = text.indexOfFirst { it.isLetter() }
    if (letterIndex < 0) {
        Text(text, style = KathaTypography.readerBody(18), color = textColor, lineHeight = 28.sp)
        return
    }
    val prefix = text.take(letterIndex)
    val letter = text.substring(letterIndex, letterIndex + 1)
    val remainder = text.drop(letterIndex + 1)
    Row(verticalAlignment = Alignment.Top) {
        if (prefix.isNotEmpty()) {
            Text(prefix, style = KathaTypography.readerBody(18), color = textColor, lineHeight = 28.sp)
        }
        Text(
            letter,
            style = KathaTypography.readerBody(54),
            color = accent,
            lineHeight = 54.sp,
            modifier = Modifier
                .height(84.dp)
                .padding(end = KathaTheme.Spacing.xs)
        )
        Text(remainder, style = KathaTypography.readerBody(18), color = textColor, lineHeight = 28.sp)
    }
}

@Composable
private fun ReaderLikeParticleBurst() {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(1f, animationSpec = tween(200))
    }
    Box(Modifier.fillMaxSize()) {
        repeat(6) { index ->
            val angle = index * Math.PI / 3.0
            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(6.dp)
                    .offset(
                        x = (cos(angle) * 26.0 * progress.value).dp,
                        y = (sin(angle) * 26.0 * progress.value).dp
                    )
                    .scale(1f - progress.value * 0.4f)
                    .alpha(1f - progress.value)
                    .clip(CircleShape)
                    .background(KathaTheme.heart)
            )
        }
    }
}

@Composable
private fun ChapterNavButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(surface().copy(alpha = 0.8f))
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, description, tint = KathaTheme.textPrimary, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun surface(): Color = KathaTheme.surface

@Composable
private fun AuthorEndOfChapter(
    story: Story,
    chapter: Chapter,
    state: KathaUiState,
    onContinue: () -> Unit
) {
    val chapterCount = story.chapters.size
    val planned = story.plannedChapterCount
    val ctaLabel = when {
        planned != null && chapterCount < planned -> "Continue this story ▸ (Chapter ${chapterCount + 1})"
        planned != null && chapterCount == planned -> "Add another chapter ▸"
        else -> "Continue this story ▸"
    }
    val followerCount = state.storyFollowerOverrides[story.id] ?: story.followerCount

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = KathaTheme.Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        // Divider
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(KathaTheme.border))

        // Engagement row (display-only for author)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { },
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Icon(Icons.Outlined.FavoriteBorder, null, tint = KathaTheme.textSecondary, modifier = Modifier.size(16.dp))
                Text(formatCount(story.likes), color = KathaTheme.textSecondary, style = KathaTypography.Meta)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Icon(Icons.Outlined.BookmarkBorder, null, tint = KathaTheme.textSecondary, modifier = Modifier.size(16.dp))
                Text(formatCount(story.bookmarks), color = KathaTheme.textSecondary, style = KathaTypography.Meta)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Icon(Icons.Outlined.MenuBook, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(16.dp))
                Text(formatCount(story.views), color = KathaTheme.textTertiary, style = KathaTypography.Meta)
            }
            Spacer(Modifier.weight(1f))
        }

        PrimaryCTA(title = ctaLabel, onClick = onContinue)

        if (followerCount > 0) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(KathaTheme.accentSoft)
                    .padding(KathaTheme.Spacing.l)
            ) {
                val followerText = "**$followerCount** followers are waiting for your next chapter."
                val annotatedString = androidx.compose.ui.text.buildAnnotatedString {
                    append(followerCount.toString())
                    append(" followers are waiting for your next chapter.")
                }
                Text(
                    annotatedString,
                    color = KathaTheme.textPrimary,
                    fontSize = KathaTypography.Body.fontSize
                )
            }
        }
    }
}

@Composable
private fun DraftEndOfChapter(
    story: Story,
    chapter: Chapter,
    state: KathaUiState,
    onPublish: (String) -> Unit,
    onDelete: (String) -> Unit,
    onContinue: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = KathaTheme.Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(KathaTheme.border))

        Text(
            "Preview complete.",
            color = KathaTheme.textPrimary,
            fontSize = KathaTypography.Title2.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center
        )
        Text(
            "Publish when you're ready — followers will be notified.",
            color = KathaTheme.textSecondary,
            fontSize = KathaTypography.Body.fontSize,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        PrimaryCTA(
            title = "Publish chapter",
            isLoading = state.isPublishing,
            onClick = { onPublish(chapter.id) }
        )

        Text(
            "Continue writing without publishing yet",
            color = KathaTheme.accent,
            fontSize = KathaTypography.Body.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onContinue() },
            textAlign = TextAlign.Center
        )

        DestructiveCTA(title = "Delete draft", onClick = { onDelete(chapter.id) })
    }
}

@Composable
private fun ReaderEndOfChapter(
    story: Story,
    state: KathaUiState,
    onFollowStory: () -> Unit
) {
    val isFollowing = story.id in state.followedStoryIds
    val followerCount = state.storyFollowerOverrides[story.id] ?: story.followerCount
    val chapterCount = story.chapters.size
    val planned = story.plannedChapterCount

    val followLabel = if (isFollowing) {
        "Following this story ✓"
    } else if (planned != null && chapterCount < planned) {
        "Get notified when Chapter ${chapterCount + 1} drops"
    } else if (followerCount > 0) {
        "Follow this story ($followerCount)"
    } else {
        "Follow this story"
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = KathaTheme.Spacing.xl),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(KathaTheme.border))

        // Follow story button
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(if (isFollowing) KathaTheme.accentSoft else KathaTheme.surface)
                .border(1.dp, KathaTheme.border, RoundedCornerShape(14.dp))
                .clickable { onFollowStory() }
                .padding(vertical = 12.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                followLabel,
                color = if (isFollowing) KathaTheme.accent else KathaTheme.textPrimary,
                fontSize = KathaTypography.Body.fontSize,
                fontWeight = KathaTypography.BodyStrong.fontWeight
            )
        }

        // Follow author
        SeedData.author(story.authorId)?.let { author ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.surface)
                    .padding(KathaTheme.Spacing.l)
            ) {
                AuthorRow(
                    author = author,
                    isFollowing = author.id in state.followedAuthorIds
                ) { /* handled by parent */ }
            }
        }

        // Write yours cross-sell
        PrimaryCTA(title = "Write yours ▸", onClick = { })
    }
}

@Composable
private fun CircleIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    background: Color,
    tint: Color,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(background.copy(alpha = 0.9f))
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, description, tint = tint, modifier = Modifier.size(18.dp))
    }
}

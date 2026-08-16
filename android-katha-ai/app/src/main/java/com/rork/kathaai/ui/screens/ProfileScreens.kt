package com.rork.kathaai.ui.screens

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.data.UsernameGenerator
import com.rork.kathaai.model.Author
import com.rork.kathaai.model.GeneratedStory
import com.rork.kathaai.model.ProfileRoute
import com.rork.kathaai.model.ProfileUserItem
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.components.DestructiveCTA
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.components.SegmentedControl
import com.rork.kathaai.ui.components.Skeleton
import com.rork.kathaai.ui.components.StoryCard
import com.rork.kathaai.ui.components.StoryCardSkeleton
import com.rork.kathaai.ui.components.TextLink
import com.rork.kathaai.ui.components.formatCount
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// MARK: - Follow Button

enum class FollowButtonSize(val height: Int, val hPad: Int, val fontSize: Int) {
    SMALL(32, 12, 13),
    MEDIUM(44, 32, 15)
}

@Composable
fun FollowButton(
    isFollowing: Boolean,
    modifier: Modifier = Modifier,
    size: FollowButtonSize = FollowButtonSize.SMALL,
    isLoading: Boolean = false,
    fullWidth: Boolean = false,
    onClick: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    Box(
        modifier = modifier
            .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
            .height(size.height.dp)
            .clip(RoundedCornerShape(50))
            .background(if (isFollowing) KathaTheme.accentSoft else KathaTheme.accent)
            .then(
                if (isFollowing) Modifier.border(1.dp, KathaTheme.accent, RoundedCornerShape(50))
                else Modifier
            )
            .alpha(if (isLoading) 0.4f else 1f)
            .then(
                if (!isLoading) Modifier.clickable {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onClick()
                } else Modifier
            )
            .padding(horizontal = size.hPad.dp),
        contentAlignment = Alignment.Center
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                color = if (isFollowing) KathaTheme.accent else Color.White,
                modifier = Modifier.size(16.dp)
            )
        } else {
            Text(
                text = if (isFollowing) "Following \u2713" else "Follow",
                color = if (isFollowing) KathaTheme.accent else Color.White,
                fontSize = size.fontSize.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
        }
    }
}

// MARK: - Verified Badge

@Composable
fun VerifiedBadge(modifier: Modifier = Modifier, size: Int = 24) {
    Box(
        modifier = modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(Color.White),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            Icons.Outlined.Check,
            contentDescription = "Verified",
            tint = KathaTheme.accent,
            modifier = Modifier.size((size * 0.55f).dp)
        )
    }
}

// MARK: - Streak Badge

@Composable
fun StreakBadge(days: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = modifier
            .height(28.dp)
            .clip(RoundedCornerShape(50))
            .background(KathaTheme.accentSoft)
            .clickable {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onClick()
            }
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Icon(
            Icons.Outlined.LocalFireDepartment,
            contentDescription = null,
            tint = KathaTheme.accent,
            modifier = Modifier.size(14.dp)
        )
        Text(
            "$days-day streak",
            color = KathaTheme.accent,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}

// MARK: - Profile Stats Row

@Composable
fun ProfileStatsRow(
    followers: Int,
    following: Int,
    stories: Int,
    modifier: Modifier = Modifier,
    onFollowers: () -> Unit = {},
    onFollowing: () -> Unit = {},
    onStories: () -> Unit = {}
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xxxl)
    ) {
        StatBlock(followers, "FOLLOWERS", onFollowers)
        StatBlock(following, "FOLLOWING", onFollowing)
        StatBlock(stories, "STORIES", onStories)
    }
}

@Composable
private fun StatBlock(number: Int, label: String, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Column(
        modifier = Modifier.clickable {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onClick()
        },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(
            formatCount(number),
            color = KathaTheme.textPrimary,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            label,
            color = KathaTheme.textTertiary,
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 0.8.sp
        )
    }
}

// MARK: - Author Card (160×220)

@Composable
fun AuthorCard(
    author: Author,
    followerCount: Int,
    isFollowing: Boolean,
    modifier: Modifier = Modifier,
    onTap: () -> Unit,
    onFollow: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    Column(
        modifier = modifier
            .width(160.dp)
            .height(220.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(16.dp))
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .clickable {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onTap()
                },
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            GeneratedAvatar(author.username, author.displayName, 72.dp, Modifier.padding(top = 12.dp))
            Text(
                author.displayName,
                color = KathaTheme.textPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 12.dp)
            )
            Text(
                "@${author.username}",
                color = KathaTheme.textSecondary,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp)
            )
            Text(
                "${formatCount(followerCount)} followers",
                color = KathaTheme.textTertiary,
                fontSize = 10.sp,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
        FollowButton(isFollowing = isFollowing, fullWidth = true, onClick = onFollow)
    }
}

@Composable
fun AuthorCardSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .width(160.dp)
            .height(220.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(KathaTheme.surface)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Skeleton(width = 72.dp, height = 72.dp, cornerRadius = 36.dp, modifier = Modifier.padding(top = 12.dp))
        Skeleton(width = 100.dp, height = 14.dp)
        Skeleton(width = 70.dp, height = 10.dp)
        Spacer(Modifier.weight(1f))
        Skeleton(height = 32.dp, cornerRadius = 16.dp)
    }
}

// MARK: - User List Row (72dp)

@Composable
fun UserListRow(
    user: ProfileUserItem,
    isCurrentUser: Boolean,
    isFollowing: Boolean,
    modifier: Modifier = Modifier,
    onTap: () -> Unit,
    onFollow: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(71.dp)
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clickable {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onTap()
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                GeneratedAvatar(user.username, user.displayName, 48.dp)
                Column {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp)
                    ) {
                        Text(
                            user.displayName,
                            color = KathaTheme.textPrimary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (user.isVerified) {
                            Icon(
                                Icons.Outlined.Verified, null,
                                tint = KathaTheme.accent,
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }
                    Text(
                        "@${user.username}",
                        color = KathaTheme.textSecondary,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (user.bio.isNotEmpty()) {
                        Text(
                            user.bio,
                            color = KathaTheme.textTertiary,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }

            if (!user.isGhost && !isCurrentUser) {
                FollowButton(isFollowing = isFollowing, onClick = onFollow)
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp)
                .height(1.dp)
                .background(KathaTheme.border)
        )
    }
}

@Composable
fun UserListRowSkeleton(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(72.dp)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Skeleton(width = 48.dp, height = 48.dp, cornerRadius = 24.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Skeleton(width = 130.dp, height = 13.dp)
            Skeleton(width = 90.dp, height = 11.dp)
        }
        Skeleton(width = 70.dp, height = 32.dp, cornerRadius = 16.dp)
    }
}

// MARK: - Profile Search Bar

@Composable
fun ProfileSearchBar(
    text: String,
    placeholder: String,
    modifier: Modifier = Modifier,
    onTextChange: (String) -> Unit
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .height(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            Icons.Outlined.Search, null,
            tint = KathaTheme.textTertiary,
            modifier = Modifier.size(16.dp)
        )
        TextField(
            value = text,
            onValueChange = onTextChange,
            placeholder = { Text(placeholder, fontSize = 15.sp, color = KathaTheme.textTertiary) },
            singleLine = true,
            modifier = Modifier.weight(1f),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                focusedTextColor = KathaTheme.textPrimary,
                unfocusedTextColor = KathaTheme.textPrimary
            )
        )
        if (text.isNotEmpty()) {
            Icon(
                Icons.Outlined.Close, "Clear",
                tint = KathaTheme.textTertiary,
                modifier = Modifier
                    .size(16.dp)
                    .clickable { onTextChange("") }
            )
        }
    }
}

// MARK: - Shared list nav bar

@Composable
private fun ProfileListNavBar(title: String, onBack: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(56.dp)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            Icons.AutoMirrored.Outlined.ArrowBack,
            contentDescription = "Back",
            tint = KathaTheme.textPrimary,
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .clickable {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onBack()
                }
                .padding(10.dp)
        )
        Text(
            title,
            color = KathaTheme.textPrimary,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.size(44.dp))
    }
}

// MARK: - Profile Route Host

@Composable
fun ProfileRouteHost(
    route: ProfileRoute,
    state: KathaUiState,
    viewModel: AppViewModel,
    onOpenStory: (String) -> Unit
) {
    when (route) {
        is ProfileRoute.Profile -> AuthorProfileScreen(route.userId, state, viewModel, onOpenStory)
        is ProfileRoute.Followers -> FollowersListScreen(route.userId, state, viewModel)
        is ProfileRoute.Following -> FollowingListScreen(route.userId, route.initialTab, state, viewModel, onOpenStory)
        is ProfileRoute.EditProfile -> EditProfileScreen(state, viewModel)
        is ProfileRoute.BlockedUsers -> BlockedUsersScreen(state, viewModel) { viewModel.popProfileRoute() }
    }
}

// MARK: - Author Profile Screen (own + other)

@Composable
fun AuthorProfileScreen(
    userId: String,
    state: KathaUiState,
    viewModel: AppViewModel,
    onOpenStory: (String) -> Unit
) {
    val isOwn = userId == "me"
    val author: Author? = if (isOwn) null else SeedData.author(userId)
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var isLoading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(450)
        isLoading = false
    }

    val displayName = if (isOwn) {
        state.currentUser?.displayName?.ifEmpty { state.currentUser.username } ?: ""
    } else author?.displayName ?: ""
    val username = if (isOwn) state.currentUser?.username ?: "" else author?.username ?: ""
    val bio = if (isOwn) state.currentUser?.bio ?: "" else author?.bio ?: ""
    val isVerified = author?.isVerified == true
    val followerCount = if (isOwn) state.currentUser?.followers ?: 0
    else state.authorFollowerCount(author?.id ?: "", author?.followers ?: 0)
    val followingCount = if (isOwn) state.followedAuthorIds.size else author?.followingCount ?: 0

    val seedStories: List<Story> = if (isOwn) emptyList() else SeedData.storiesByAuthor(userId)
    val ownPublished: List<GeneratedStory> = if (isOwn) state.publishedStories else emptyList()
    val ownDrafts = ownPublished.filter { gs -> gs.chapters.any { !it.isPublished } }
    val storyCount = if (isOwn) ownPublished.size else author?.storyCount ?: seedStories.size

    val streakIndexOffset = if (isOwn && state.currentStreak > 0) 1 else 0
    val storiesHeaderIndex = 1 + streakIndexOffset

    Box(
        Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        Column(Modifier.fillMaxSize()) {
            // Nav bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .height(56.dp)
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = "Back",
                    tint = KathaTheme.textPrimary,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .clickable {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            viewModel.popProfileRoute()
                        }
                        .padding(10.dp)
                )
                Text(
                    "@$username",
                    color = KathaTheme.textPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    if (isOwn) Icons.Outlined.Settings else Icons.Outlined.Share,
                    contentDescription = if (isOwn) "Settings" else "Share",
                    tint = KathaTheme.textPrimary,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .clickable {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            if (isOwn) {
                                viewModel.closeAllProfiles()
                                viewModel.requestTab(4)
                            } else {
                                viewModel.showToast("Sharing coming in the next update \u2728")
                            }
                        }
                        .padding(11.dp)
                )
            }

            if (isLoading) {
                ProfileLoadingContent()
            } else {
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    // Hero
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    Brush.verticalGradient(
                                        listOf(
                                            KathaTheme.canvas,
                                            KathaTheme.accentSoft.copy(alpha = 0.55f),
                                            KathaTheme.canvas
                                        )
                                    )
                                )
                                .padding(vertical = KathaTheme.Spacing.xxl),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Box {
                                GeneratedAvatar(username, displayName, 96.dp)
                                if (isVerified) {
                                    VerifiedBadge(Modifier.align(Alignment.BottomEnd))
                                }
                            }
                            Text(
                                displayName,
                                color = KathaTheme.textPrimary,
                                fontSize = 26.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 8.dp)
                            )
                            Text(
                                "@$username",
                                color = KathaTheme.textSecondary,
                                fontSize = 15.sp,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                            if (bio.isNotEmpty()) {
                                Text(
                                    bio,
                                    color = KathaTheme.textPrimary,
                                    fontSize = 15.sp,
                                    textAlign = TextAlign.Center,
                                    maxLines = 3,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 12.dp, start = 40.dp, end = 40.dp)
                                )
                            }
                            ProfileStatsRow(
                                followers = followerCount,
                                following = followingCount,
                                stories = storyCount,
                                modifier = Modifier.padding(top = 20.dp),
                                onFollowers = { viewModel.pushProfileRoute(ProfileRoute.Followers(userId)) },
                                onFollowing = { viewModel.pushProfileRoute(ProfileRoute.Following(userId, 0)) },
                                onStories = {
                                    scope.launch { listState.animateScrollToItem(storiesHeaderIndex) }
                                }
                            )
                            Spacer(Modifier.height(20.dp))
                            if (isOwn) {
                                Row(
                                    modifier = Modifier.padding(horizontal = KathaTheme.Spacing.xl),
                                    horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                                ) {
                                    SecondaryCTA("Edit profile", Modifier.weight(1f)) {
                                        viewModel.pushProfileRoute(ProfileRoute.EditProfile)
                                    }
                                    SecondaryCTA("Share profile", Modifier.weight(1f)) {
                                        viewModel.showToast("Sharing coming in the next update \u2728")
                                    }
                                }
                            } else if (author != null) {
                                FollowButton(
                                    isFollowing = author.id in state.followedAuthorIds,
                                    size = FollowButtonSize.MEDIUM
                                ) {
                                    viewModel.toggleFollowAuthor(author.id)
                                }
                            }
                        }
                    }

                    // Streak (own only)
                    if (isOwn && state.currentStreak > 0) {
                        item {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(top = KathaTheme.Spacing.l),
                                contentAlignment = Alignment.Center
                            ) {
                                StreakBadge(state.currentStreak) {
                                    viewModel.showToast("Your journey coming in the next update \u2728")
                                }
                            }
                        }
                    }

                    // Stories
                    if (isOwn) {
                        if (ownPublished.isEmpty()) {
                            item { StoriesSectionLabel("STORIES") }
                            item {
                                EmptyState(
                                    icon = Icons.Outlined.Edit,
                                    title = "No stories yet",
                                    message = "You haven't written a story yet. It only takes a minute.",
                                    ctaTitle = "Write your first story \u25b8",
                                    onCta = {
                                        viewModel.closeAllProfiles()
                                        viewModel.requestTab(2)
                                    }
                                )
                            }
                        } else {
                            item { StoriesSectionLabel("PUBLISHED") }
                            items(ownPublished, key = { it.id }) { genStory ->
                                OwnStoryCard(genStory, isDraft = false, state = state) {
                                    viewModel.openGeneratedStory(genStory)
                                }
                            }
                            if (ownDrafts.isNotEmpty()) {
                                item {
                                    Spacer(Modifier.height(KathaTheme.Spacing.xxl))
                                    StoriesSectionLabel("DRAFTS")
                                }
                                items(ownDrafts, key = { "draft-${it.id}" }) { genStory ->
                                    OwnStoryCard(genStory, isDraft = true, state = state) {
                                        viewModel.openGeneratedStory(genStory)
                                    }
                                }
                            }
                        }
                    } else {
                        item { StoriesSectionLabel("STORIES") }
                        if (seedStories.isEmpty()) {
                            item {
                                EmptyState(
                                    icon = Icons.Outlined.MenuBook,
                                    title = "Nothing yet",
                                    message = "This writer hasn't published anything yet."
                                )
                            }
                        } else {
                            items(seedStories, key = { it.id }) { story ->
                                Box(
                                    Modifier.padding(
                                        horizontal = KathaTheme.Spacing.l,
                                        vertical = KathaTheme.Spacing.s
                                    )
                                ) {
                                    StoryCard(
                                        story = story,
                                        isLiked = story.id in state.likedStoryIds,
                                        isBookmarked = story.id in state.bookmarkedStoryIds,
                                        onLike = { viewModel.toggleLike(story.id) },
                                        onBookmark = { viewModel.toggleBookmark(story.id) },
                                        onTap = { onOpenStory(story.id) }
                                    )
                                }
                            }
                        }
                    }

                    item { SafeBottomSpacer() }
                }
            }
        }
    }
}

@Composable
private fun StoriesSectionLabel(title: String) {
    Text(
        title,
        color = KathaTheme.textTertiary,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.sp,
        modifier = Modifier.padding(start = 20.dp, top = 32.dp, bottom = 12.dp)
    )
}

@Composable
private fun OwnStoryCard(
    genStory: GeneratedStory,
    isDraft: Boolean,
    state: KathaUiState,
    onTap: () -> Unit
) {
    Box(
        Modifier.padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.s)
    ) {
        val story = genStory.asStory()
        StoryCard(
            story = story,
            isLiked = false,
            isBookmarked = false,
            onLike = {},
            onBookmark = {},
            onTap = onTap
        )
        if (isDraft) {
            Text(
                "Draft",
                color = Color.White,
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(KathaTheme.Spacing.m)
                    .clip(RoundedCornerShape(50))
                    .background(KathaTheme.accent)
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
    }
}

@Composable
private fun ProfileLoadingContent() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Skeleton(width = 96.dp, height = 96.dp, cornerRadius = 48.dp, modifier = Modifier.padding(top = 24.dp))
        Skeleton(width = 160.dp, height = 20.dp)
        Skeleton(width = 100.dp, height = 14.dp)
        Skeleton(width = 240.dp, height = 12.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xxxl)) {
            repeat(3) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Skeleton(width = 44.dp, height = 16.dp)
                    Skeleton(width = 60.dp, height = 9.dp)
                }
            }
        }
        Spacer(Modifier.height(KathaTheme.Spacing.l))
        repeat(3) {
            Box(Modifier.padding(horizontal = KathaTheme.Spacing.l)) {
                StoryCardSkeleton()
            }
        }
    }
}

// MARK: - Followers List Screen

@Composable
fun FollowersListScreen(
    userId: String,
    state: KathaUiState,
    viewModel: AppViewModel
) {
    var query by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(400)
        isLoading = false
    }

    val ownerName = if (userId == "me") {
        state.currentUser?.displayName?.ifEmpty { state.currentUser.username } ?: ""
    } else SeedData.author(userId)?.displayName ?: ""

    val allFollowers = if (userId == "me") emptyList() else SeedData.followersList(userId)
    val filtered = if (query.isEmpty()) allFollowers
    else allFollowers.filter { it.displayName.contains(query, ignoreCase = true) }

    Column(
        Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        ProfileListNavBar("$ownerName's followers") { viewModel.popProfileRoute() }

        ProfileSearchBar(query, "Search followers", Modifier.padding(top = 8.dp)) { query = it }

        when {
            isLoading -> {
                Column(Modifier.padding(top = KathaTheme.Spacing.m)) {
                    repeat(6) { UserListRowSkeleton() }
                }
            }
            allFollowers.isEmpty() -> {
                EmptyState(
                    icon = Icons.Outlined.Group,
                    title = "No followers yet",
                    message = if (userId == "me") "When writers follow you, they'll show up here." else "No followers yet."
                )
            }
            filtered.isEmpty() -> {
                EmptyState(
                    icon = Icons.Outlined.Search,
                    title = "No matches",
                    message = "No followers match \"$query\""
                )
            }
            else -> {
                LazyColumn(contentPadding = PaddingValues(top = KathaTheme.Spacing.m)) {
                    items(filtered, key = { it.id }) { user ->
                        UserListRow(
                            user = user,
                            isCurrentUser = user.username == state.currentUser?.username,
                            isFollowing = user.id in state.followedAuthorIds,
                            onTap = {
                                if (user.isGhost) {
                                    viewModel.showToast("This writer's profile is private")
                                } else {
                                    viewModel.openAuthorProfile(user.id)
                                }
                            },
                            onFollow = { viewModel.toggleFollowAuthor(user.id) }
                        )
                    }
                    item { SafeBottomSpacer() }
                }
            }
        }
    }
}

// MARK: - Following List Screen (Writers | Stories)

@Composable
fun FollowingListScreen(
    userId: String,
    initialTab: Int,
    state: KathaUiState,
    viewModel: AppViewModel,
    onOpenStory: (String) -> Unit
) {
    val isOwn = userId == "me"
    var tab by remember { mutableIntStateOf(initialTab) }
    var query by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(400)
        isLoading = false
    }

    val ownerName = if (isOwn) {
        state.currentUser?.displayName?.ifEmpty { state.currentUser.username } ?: ""
    } else SeedData.author(userId)?.displayName ?: ""

    val followedWriters: List<ProfileUserItem> = if (isOwn) {
        state.followedAuthorIds.mapNotNull { id ->
            SeedData.author(id)?.let {
                ProfileUserItem(it.id, it.username, it.displayName, it.bio, it.isVerified, isGhost = false)
            }
        }.sortedBy { it.displayName }
    } else SeedData.followingList(userId)

    val followedStories: List<Story> = if (isOwn) {
        state.followedStoryIds.mapNotNull { id ->
            SeedData.story(id) ?: state.publishedStories.firstOrNull { it.id == id }?.asStory()
        }
    } else emptyList()

    val filteredWriters = if (query.isEmpty()) followedWriters
    else followedWriters.filter { it.displayName.contains(query, ignoreCase = true) }
    val filteredStories = if (query.isEmpty()) followedStories
    else followedStories.filter { it.title.contains(query, ignoreCase = true) }

    Column(
        Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        ProfileListNavBar("$ownerName follows") { viewModel.popProfileRoute() }

        SegmentedControl(
            options = listOf("Writers", "Stories"),
            selectedIndex = tab,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
        ) { tab = it }

        ProfileSearchBar(
            query,
            if (tab == 0) "Search writers" else "Search stories"
        ) { query = it }

        when {
            isLoading -> {
                Column(Modifier.padding(top = KathaTheme.Spacing.m)) {
                    repeat(6) { UserListRowSkeleton() }
                }
            }
            tab == 0 -> {
                when {
                    followedWriters.isEmpty() -> EmptyState(
                        icon = Icons.Outlined.Group,
                        title = "No writers yet",
                        message = "$ownerName doesn't follow any writers yet.",
                        ctaTitle = if (isOwn) "Discover writers \u25b8" else null,
                        onCta = if (isOwn) {
                            {
                                viewModel.closeAllProfiles()
                                viewModel.requestTab(1)
                            }
                        } else null
                    )
                    filteredWriters.isEmpty() -> EmptyState(
                        icon = Icons.Outlined.Search,
                        title = "No matches",
                        message = "No writers match \"$query\""
                    )
                    else -> LazyColumn(contentPadding = PaddingValues(top = KathaTheme.Spacing.m)) {
                        items(filteredWriters, key = { it.id }) { user ->
                            UserListRow(
                                user = user,
                                isCurrentUser = user.username == state.currentUser?.username,
                                isFollowing = user.id in state.followedAuthorIds,
                                onTap = {
                                    if (user.isGhost) {
                                        viewModel.showToast("This writer's profile is private")
                                    } else {
                                        viewModel.openAuthorProfile(user.id)
                                    }
                                },
                                onFollow = { viewModel.toggleFollowAuthor(user.id) }
                            )
                        }
                        item { SafeBottomSpacer() }
                    }
                }
            }
            else -> {
                when {
                    followedStories.isEmpty() -> EmptyState(
                        icon = Icons.Outlined.MenuBook,
                        title = "No stories yet",
                        message = "$ownerName doesn't follow any stories yet.",
                        ctaTitle = if (isOwn) "Explore stories \u25b8" else null,
                        onCta = if (isOwn) {
                            {
                                viewModel.closeAllProfiles()
                                viewModel.requestTab(1)
                            }
                        } else null
                    )
                    filteredStories.isEmpty() -> EmptyState(
                        icon = Icons.Outlined.Search,
                        title = "No matches",
                        message = "No stories match \"$query\""
                    )
                    else -> LazyColumn(
                        contentPadding = PaddingValues(
                            start = KathaTheme.Spacing.l,
                            end = KathaTheme.Spacing.l,
                            top = KathaTheme.Spacing.m
                        ),
                        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        items(filteredStories, key = { it.id }) { story ->
                            Box {
                                StoryCard(
                                    story = story,
                                    isLiked = story.id in state.likedStoryIds,
                                    isBookmarked = story.id in state.bookmarkedStoryIds,
                                    onLike = { viewModel.toggleLike(story.id) },
                                    onBookmark = { viewModel.toggleBookmark(story.id) },
                                    onTap = { onOpenStory(story.id) },
                                    onAuthorTap = { viewModel.openAuthorProfile(story.authorId) }
                                )
                                if (isOwn) {
                                    Box(
                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .padding(KathaTheme.Spacing.m)
                                            .size(28.dp)
                                            .clip(CircleShape)
                                            .background(KathaTheme.surfaceElevated)
                                            .border(1.dp, KathaTheme.border, CircleShape)
                                            .clickable {
                                                viewModel.toggleFollowStory(
                                                    storyId = story.id,
                                                    storyTitle = story.title,
                                                    followerCount = story.followerCount
                                                )
                                            },
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(
                                            Icons.Outlined.Close, "Unfollow story",
                                            tint = KathaTheme.textSecondary,
                                            modifier = Modifier.size(12.dp)
                                        )
                                    }
                                }
                            }
                        }
                        item { SafeBottomSpacer() }
                    }
                }
            }
        }
    }
}

// MARK: - Edit Profile Screen

@Composable
fun EditProfileScreen(
    state: KathaUiState,
    viewModel: AppViewModel
) {
    val originalDisplayName = state.currentUser?.displayName ?: ""
    val originalUsername = state.currentUser?.username ?: ""
    val originalBio = state.currentUser?.bio ?: ""

    var displayName by remember { mutableStateOf(originalDisplayName) }
    var username by remember { mutableStateOf(originalUsername) }
    var bio by remember { mutableStateOf(originalBio) }
    var usernameStatus by remember { mutableStateOf("idle") } // idle/checking/available/taken/invalid
    var showDiscardModal by remember { mutableStateOf(false) }
    var showAvatarSheet by remember { mutableStateOf(false) }
    var showRegenerateConfirm by remember { mutableStateOf(false) }

    val hasChanges = displayName != originalDisplayName || username != originalUsername || bio != originalBio
    val cooldownUnlock = state.usernameChangeUnlockDate
    val usernameLocked = cooldownUnlock != null
    val isUsernameFormatValid = username.length in 3..20 && username.all { it.isLetterOrDigit() || it == '_' }

    val canSave = hasChanges && !state.isSavingProfile &&
        displayName.trim().isNotEmpty() && displayName.length <= 30 &&
        bio.length <= 160 &&
        (username == originalUsername || (!usernameLocked && isUsernameFormatValid && usernameStatus != "taken"))

    // Debounced username availability check
    LaunchedEffect(username) {
        if (username == originalUsername || username.isEmpty()) {
            usernameStatus = "idle"
            return@LaunchedEffect
        }
        delay(500)
        if (!isUsernameFormatValid) {
            usernameStatus = "invalid"
            return@LaunchedEffect
        }
        usernameStatus = "checking"
        delay(300)
        usernameStatus = if (UsernameGenerator.isAvailable(username)) "available" else "taken"
    }

    val haptics = LocalHapticFeedback.current

    Box(
        Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        Column(Modifier.fillMaxSize()) {
            // Nav bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .height(56.dp)
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Cancel",
                    color = KathaTheme.textSecondary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .width(70.dp)
                        .clickable {
                            if (hasChanges) showDiscardModal = true
                            else viewModel.popProfileRoute()
                        }
                )
                Text(
                    "Edit profile",
                    color = KathaTheme.textPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f)
                )
                Box(Modifier.width(70.dp), contentAlignment = Alignment.CenterEnd) {
                    if (state.isSavingProfile) {
                        CircularProgressIndicator(color = KathaTheme.accent, modifier = Modifier.size(18.dp))
                    } else {
                        Text(
                            "Save",
                            color = if (canSave) KathaTheme.accent else KathaTheme.textTertiary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clickable(enabled = canSave) {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                viewModel.saveProfile(displayName.trim(), username, bio) { success ->
                                    if (success) viewModel.popProfileRoute()
                                }
                            }
                        )
                    }
                }
            }

            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
            ) {
                // Avatar
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(Modifier.clickable { showAvatarSheet = true }) {
                        GeneratedAvatar(originalUsername, displayName, 96.dp)
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(KathaTheme.surface)
                                .border(1.5.dp, KathaTheme.accent, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Outlined.Edit, "Change avatar",
                                tint = KathaTheme.accent,
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }
                    TextLink("Change photo") { showAvatarSheet = true }
                }

                Spacer(Modifier.height(32.dp))

                // Display name
                FieldLabel("DISPLAY NAME")
                EditField(
                    value = displayName,
                    placeholder = "Your name",
                    isError = false
                ) { if (it.length <= 30) displayName = it }
                CharCounter(displayName.length, 30)

                Spacer(Modifier.height(KathaTheme.Spacing.xxl))

                // Username
                FieldLabel("USERNAME")
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(KathaTheme.surface)
                        .border(
                            1.dp,
                            if (usernameStatus == "taken" || usernameStatus == "invalid") KathaTheme.error
                            else KathaTheme.border,
                            RoundedCornerShape(12.dp)
                        )
                        .alpha(if (usernameLocked) 0.4f else 1f)
                        .padding(start = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("@", color = KathaTheme.textTertiary, fontSize = 15.sp)
                    TextField(
                        value = username,
                        onValueChange = { if (it.length <= 20) username = it },
                        enabled = !usernameLocked,
                        singleLine = true,
                        keyboardOptions = KeyboardOptions.Default,
                        modifier = Modifier.weight(1f),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                            disabledContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            disabledIndicatorColor = Color.Transparent,
                            focusedTextColor = KathaTheme.textPrimary,
                            unfocusedTextColor = KathaTheme.textPrimary
                        )
                    )
                }
                if (usernameLocked && cooldownUnlock != null) {
                    val dateText = remember(cooldownUnlock) {
                        SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(cooldownUnlock))
                    }
                    Text(
                        "You can change your username again on $dateText.",
                        color = KathaTheme.textTertiary,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(top = 6.dp)
                    )
                } else {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        when (usernameStatus) {
                            "taken" -> Text("This username is already taken.", color = KathaTheme.error, fontSize = 11.sp)
                            "invalid" -> Text("3-20 characters, letters and numbers only.", color = KathaTheme.error, fontSize = 11.sp)
                            "available" -> Text("Available \u2713", color = KathaTheme.success, fontSize = 11.sp)
                            else -> Text("${username.length}/20", color = KathaTheme.textTertiary, fontSize = 11.sp)
                        }
                        Spacer(Modifier.weight(1f))
                        if (username != originalUsername && username.isNotEmpty()) {
                            if (usernameStatus == "checking") {
                                CircularProgressIndicator(
                                    color = KathaTheme.accent,
                                    modifier = Modifier
                                        .size(12.dp)
                                        .padding(end = 4.dp)
                                )
                            }
                            TextLink("Check availability") {
                                usernameStatus = if (!isUsernameFormatValid) "invalid"
                                else if (UsernameGenerator.isAvailable(username)) "available" else "taken"
                            }
                        }
                    }
                }

                Spacer(Modifier.height(KathaTheme.Spacing.xxl))

                // Bio
                FieldLabel("BIO")
                TextField(
                    value = bio,
                    onValueChange = { bio = it },
                    placeholder = {
                        Text(
                            "A sentence or two about your writing. Warm and specific works best.",
                            fontSize = 15.sp,
                            color = KathaTheme.textTertiary
                        )
                    },
                    minLines = 4,
                    maxLines = 6,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .border(
                            1.dp,
                            if (bio.length > 160) KathaTheme.error else KathaTheme.border,
                            RoundedCornerShape(12.dp)
                        ),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = KathaTheme.surface,
                        unfocusedContainerColor = KathaTheme.surface,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        focusedTextColor = KathaTheme.textPrimary,
                        unfocusedTextColor = KathaTheme.textPrimary
                    )
                )
                CharCounter(bio.length, 160, isError = bio.length > 160)

                Spacer(Modifier.height(48.dp))

                // Account section
                FieldLabel("ACCOUNT")
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(KathaTheme.surface)
                        .border(1.dp, KathaTheme.border, RoundedCornerShape(12.dp))
                        .clickable { viewModel.showToast("Email management coming in the next update \u2728") }
                        .padding(horizontal = KathaTheme.Spacing.l),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Change email", color = KathaTheme.textPrimary, fontSize = 15.sp)
                    Spacer(Modifier.weight(1f))
                    Icon(
                        Icons.Outlined.ChevronRight, null,
                        tint = KathaTheme.textTertiary,
                        modifier = Modifier.size(16.dp)
                    )
                }

                SafeBottomSpacer()
            }
        }

        // Discard changes modal
        if (showDiscardModal) {
            ProfileModal(
                title = "Discard changes?",
                message = "Your edits won't be saved.",
                confirmTitle = "Discard",
                cancelTitle = "Keep editing",
                onConfirm = {
                    showDiscardModal = false
                    viewModel.popProfileRoute()
                },
                onCancel = { showDiscardModal = false }
            )
        }

        // Avatar action sheet (simple modal)
        if (showAvatarSheet) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.4f))
                    .clickable { showAvatarSheet = false },
                contentAlignment = Alignment.Center
            ) {
                Column(
                    modifier = Modifier
                        .padding(horizontal = KathaTheme.Spacing.xxxl)
                        .clip(RoundedCornerShape(20.dp))
                        .background(KathaTheme.surface)
                        .padding(KathaTheme.Spacing.xxl),
                    verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                ) {
                    Text(
                        "Change avatar",
                        color = KathaTheme.textPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(bottom = KathaTheme.Spacing.s)
                    )
                    SecondaryCTA("Take photo") {
                        showAvatarSheet = false
                        viewModel.showToast("Photo upload coming in the next update \u2728")
                    }
                    SecondaryCTA("Choose from library") {
                        showAvatarSheet = false
                        viewModel.showToast("Photo upload coming in the next update \u2728")
                    }
                    SecondaryCTA("Regenerate") {
                        showAvatarSheet = false
                        showRegenerateConfirm = true
                    }
                    TextLink("Cancel", Modifier.align(Alignment.CenterHorizontally)) {
                        showAvatarSheet = false
                    }
                }
            }
        }

        // Regenerate confirm
        if (showRegenerateConfirm) {
            ProfileModal(
                title = "Regenerate avatar?",
                message = "This gives you a new random look based on your username.",
                confirmTitle = "Regenerate",
                cancelTitle = "Cancel",
                isDestructive = false,
                onConfirm = {
                    showRegenerateConfirm = false
                    viewModel.showToast("New look, same you \u2728")
                },
                onCancel = { showRegenerateConfirm = false }
            )
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(
        text,
        color = KathaTheme.textTertiary,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.sp,
        modifier = Modifier.padding(bottom = 8.dp)
    )
}

@Composable
private fun EditField(
    value: String,
    placeholder: String,
    isError: Boolean,
    onValueChange: (String) -> Unit
) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, fontSize = 15.sp, color = KathaTheme.textTertiary) },
        singleLine = true,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .border(
                1.dp,
                if (isError) KathaTheme.error else KathaTheme.border,
                RoundedCornerShape(12.dp)
            ),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = KathaTheme.surface,
            unfocusedContainerColor = KathaTheme.surface,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            focusedTextColor = KathaTheme.textPrimary,
            unfocusedTextColor = KathaTheme.textPrimary
        )
    )
}

@Composable
private fun CharCounter(count: Int, max: Int, isError: Boolean = false) {
    Text(
        "$count/$max",
        color = if (isError) KathaTheme.error else KathaTheme.textTertiary,
        fontSize = 11.sp,
        textAlign = TextAlign.End,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
    )
}

@Composable
private fun ProfileModal(
    title: String,
    message: String,
    confirmTitle: String,
    cancelTitle: String,
    isDestructive: Boolean = true,
    onConfirm: () -> Unit,
    onCancel: () -> Unit
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable { onCancel() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = KathaTheme.Spacing.xxxl)
                .clip(RoundedCornerShape(20.dp))
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.xxl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            Text(
                title,
                color = KathaTheme.textPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center
            )
            Text(
                message,
                color = KathaTheme.textSecondary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center
            )
            Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                if (isDestructive) {
                    DestructiveCTA(confirmTitle, onClick = onConfirm)
                } else {
                    SecondaryCTA(confirmTitle, onClick = onConfirm)
                }
                SecondaryCTA(cancelTitle, onClick = onCancel)
            }
        }
    }
}

// MARK: - Unfollow Author Modal

@Composable
fun UnfollowAuthorModal(
    state: KathaUiState,
    onConfirm: () -> Unit,
    onCancel: () -> Unit
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable { onCancel() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = KathaTheme.Spacing.xxxl)
                .clip(RoundedCornerShape(20.dp))
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.xxl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            Text(
                "Stop following ${state.pendingUnfollowAuthorName}?",
                color = KathaTheme.textPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center
            )
            Text(
                "You won't see new stories in your feed.",
                color = KathaTheme.textSecondary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center
            )
            Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                DestructiveCTA("Unfollow", onClick = onConfirm)
                SecondaryCTA("Keep following", onClick = onCancel)
            }
        }
    }
}

// MARK: - Writers To Follow Section (Home)

@Composable
fun WritersToFollowSection(
    state: KathaUiState,
    modifier: Modifier = Modifier,
    onOpenAuthor: (String) -> Unit,
    onFollow: (String) -> Unit,
    onSeeMore: () -> Unit
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KathaTheme.Spacing.l),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Writers to follow",
                color = KathaTheme.textPrimary,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.weight(1f))
            TextLink("See more \u2192") { onSeeMore() }
        }

        val suggestions = state.suggestedAuthors
        if (suggestions.isEmpty()) {
            Text(
                "You already follow all the writers we'd suggest. New writers coming soon.",
                color = KathaTheme.textSecondary,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m)
            )
        } else {
            LazyRow(
                contentPadding = PaddingValues(horizontal = KathaTheme.Spacing.l),
                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
            ) {
                items(suggestions, key = { it.id }) { author ->
                    AuthorCard(
                        author = author,
                        followerCount = state.authorFollowerCount(author.id, author.followers),
                        isFollowing = author.id in state.followedAuthorIds,
                        onTap = { onOpenAuthor(author.id) },
                        onFollow = { onFollow(author.id) }
                    )
                }
            }
        }
    }
}

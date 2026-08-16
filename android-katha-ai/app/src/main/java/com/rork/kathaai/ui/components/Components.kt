package com.rork.kathaai.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.RemoveRedEye
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.Author
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.theme.AvatarPalettes
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.ui.theme.kathaShadow

// MARK: - Formatting helpers

fun formatCount(n: Int): String = when {
    n >= 10_000_000 -> "${n / 1_000_000}M"
    n >= 1_000_000 -> String.format("%.1fM", n / 1_000_000.0)
    n >= 10_000 -> "${n / 1000}K"
    n >= 1000 -> String.format("%.1fK", n / 1000.0)
    else -> n.toString()
}

fun timeAgo(days: Int): String = when {
    days == 0 -> "Today"
    days == 1 -> "Yesterday"
    days < 7 -> "$days days ago"
    days < 30 -> "${days / 7}w ago"
    else -> "${days / 30}mo ago"
}

// MARK: - Press feedback

@Composable
private fun Modifier.pressable(onClick: () -> Unit): Modifier {
    val haptics = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    return this
        .scale(if (pressed) 0.97f else 1f)
        .clickable(interactionSource = interaction, indication = null) {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onClick()
        }
}

// MARK: - CTAs

@Composable
fun PrimaryCTA(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    isLoading: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val bgColor = if (pressed && enabled && !isLoading) KathaTheme.accentPressed else KathaTheme.accent

    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(horizontal = 0.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(bgColor)
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
            .shadow(
                elevation = if (pressed) 5.dp else 8.dp,
                shape = RoundedCornerShape(12.dp),
                ambientColor = KathaTheme.accent.copy(alpha = if (pressed) 0.17f else 0.28f),
                spotColor = KathaTheme.accent.copy(alpha = if (pressed) 0.17f else 0.28f)
            )
            .alpha(if (enabled && !isLoading) 1f else 0.5f)
            .then(if (enabled && !isLoading) Modifier.clickable(interactionSource = interaction, indication = null) {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onClick()
            } else Modifier),
        contentAlignment = Alignment.Center
    ) {
        if (isLoading) {
            CircularProgressIndicator(color = Color.White, modifier = Modifier.size(22.dp))
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp)
            ) {
                Text(title, color = Color.White, fontSize = KathaTypography.Body.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight)
                icon?.let { Icon(it, null, tint = Color.White, modifier = Modifier.size(18.dp)) }
            }
        }
    }
}

@Composable
fun SecondaryCTA(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(14.dp))
            .pressable(onClick),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            icon?.let { Icon(it, null, tint = KathaTheme.textPrimary, modifier = Modifier.size(18.dp)) }
            Text(title, color = KathaTheme.textPrimary, fontSize = KathaTypography.BodyStrong.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight)
        }
    }
}

@Composable
fun DestructiveCTA(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    isLoading: Boolean = false,
    onClick: () -> Unit
) {
    val error = KathaTheme.error
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(error.copy(alpha = 0.08f))
            .border(1.dp, error.copy(alpha = 0.2f), RoundedCornerShape(14.dp))
            .then(if (!isLoading) Modifier.pressable(onClick) else Modifier),
        contentAlignment = Alignment.Center
    ) {
        if (isLoading) {
            CircularProgressIndicator(color = error, modifier = Modifier.size(22.dp))
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                icon?.let { Icon(it, null, tint = error, modifier = Modifier.size(18.dp)) }
                Text(title, color = error, fontSize = KathaTypography.BodyStrong.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight)
            }
        }
    }
}

@Composable
fun TextLink(title: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        text = title,
        color = KathaTheme.accent,
        fontSize = KathaTypography.Body.fontSize,
        fontWeight = KathaTypography.BodyStrong.fontWeight,
        modifier = modifier.clickable { onClick() }
    )
}

// MARK: - Generated avatar

@Composable
fun GeneratedAvatar(
    username: String,
    displayName: String = "",
    size: Dp = 44.dp,
    modifier: Modifier = Modifier
) {
    val palette = remember(username) { AvatarPalettes.forUsername(username) }
    val source = displayName.ifEmpty { username }
    val initial = source.take(1).uppercase()

    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(Brush.linearGradient(palette)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = initial,
            color = Color.White,
            style = KathaTypography.AvatarInitial.copy(fontSize = (size.value * 0.42f).sp)
        )
    }
}

// MARK: - Story cover (gradient + serif title, no stock art)

@Composable
fun StoryCover(
    story: Story,
    modifier: Modifier = Modifier,
    height: Dp = 200.dp,
    titleSize: Int = 20
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(KathaTheme.Radius.l))
            .background(Brush.linearGradient(story.coverColors))
    ) {
        Icon(
            imageVector = story.genre.icon,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.10f),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(12.dp)
                .size(56.dp)
        )
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(90.dp)
                .background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, Color.Black.copy(alpha = 0.45f))
                    )
                )
        )
        Text(
            text = story.title,
            style = KathaTypography.Title2,
            color = Color.White,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(14.dp)
        )
    }
}

// MARK: - Story cards

@Composable
fun StoryCard(
    story: Story,
    isLiked: Boolean = false,
    isBookmarked: Boolean = false,
    onLike: () -> Unit = {},
    onBookmark: () -> Unit = {},
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    onAuthorTap: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null
) {
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(KathaTheme.Radius.l)
    val firstLine = story.chapters.firstOrNull()?.paragraphs?.firstOrNull() ?: story.synopsis
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(KathaTheme.surface)
            .kathaShadow(KathaTheme.shadowSoft, shape)
            .combinedClickable(onClick = onTap, onLongClick = onLongClick)
            .padding(KathaTheme.Spacing.md)
            .heightIn(min = 132.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.smMd)
    ) {
        StoryCover(story, modifier = Modifier.size(width = 72.dp, height = 108.dp))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)
        ) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)) {
                Text(
                    story.title,
                    style = KathaTypography.Title2,
                    color = KathaTheme.textPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    if (isBookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                    "Save",
                    tint = if (isBookmarked) KathaTheme.accent else KathaTheme.textTertiary,
                    modifier = Modifier
                        .size(28.dp)
                        .clickable { onBookmark() }
                        .padding(KathaTheme.Spacing.xs)
                )
            }
            SeedData.author(story.authorId)?.let { author ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = onAuthorTap != null) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            onAuthorTap?.invoke()
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)
                ) {
                    GeneratedAvatar(author.username, author.displayName, 16.dp)
                    Text(
                        author.displayName,
                        style = KathaTypography.Caption,
                        color = KathaTheme.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (author.isVerified) {
                        Icon(Icons.Outlined.Verified, null, tint = KathaTheme.accent, modifier = Modifier.size(10.dp))
                    }
                }
            }
            Text(
                firstLine,
                style = KathaTypography.Body,
                color = KathaTheme.textSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = KathaTheme.Spacing.s)
            )
            EngagementRow(
                story = story,
                isLiked = isLiked,
                isBookmarked = isBookmarked,
                onLike = onLike,
                onBookmark = onBookmark,
                modifier = Modifier.padding(top = KathaTheme.Spacing.s)
            )
        }
    }
}

@Composable
fun CompactStoryCard(
    story: Story,
    modifier: Modifier = Modifier,
    onAuthorTap: (() -> Unit)? = null,
    onTap: () -> Unit,
    progress: Float? = null,
    badge: String? = null
) {
    val haptics = LocalHapticFeedback.current
    Column(
        modifier = modifier
            .width(140.dp)
            .clickable { onTap() },
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        Box {
            StoryCover(story, modifier = Modifier.size(width = 140.dp, height = 180.dp), titleSize = 14)
            progress?.let { value ->
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth(value.coerceIn(0f, 1f))
                        .height(2.dp)
                        .background(KathaTheme.accent)
                )
            }
            badge?.let { label ->
                Text(
                    label,
                    style = KathaTypography.Meta,
                    color = Color.White,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(KathaTheme.Spacing.s)
                        .clip(RoundedCornerShape(KathaTheme.Radius.xl))
                        .background(KathaTheme.error)
                        .padding(horizontal = KathaTheme.Spacing.s)
                        .height(22.dp)
                )
            }
        }
        Text(
            story.title,
            style = KathaTypography.Title2,
            color = KathaTheme.textPrimary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        SeedData.author(story.authorId)?.let { author ->
            Text(
                author.displayName,
                style = KathaTypography.Caption,
                color = KathaTheme.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable(enabled = onAuthorTap != null) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onAuthorTap?.invoke()
                }
            )
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
        Text(value, color = KathaTheme.textTertiary, fontSize = KathaTypography.Meta.fontSize)
    }
}

// MARK: - Engagement row

@Composable
fun EngagementRow(
    story: Story,
    isLiked: Boolean,
    isBookmarked: Boolean,
    onLike: () -> Unit,
    onBookmark: () -> Unit,
    modifier: Modifier = Modifier,
    commentCount: Int = 0,
    onComment: (() -> Unit)? = null
) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.smMd)
    ) {
        Metric(icon = Icons.Outlined.RemoveRedEye, value = formatCount(story.views), tint = KathaTheme.textSecondary)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs),
            modifier = Modifier.clickable {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onLike()
            }
        ) {
            Icon(
                if (isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                contentDescription = "Like",
                tint = if (isLiked) KathaTheme.heart else KathaTheme.textSecondary,
                modifier = Modifier.size(14.dp)
            )
            Text(
                formatCount(story.likes + if (isLiked) 1 else 0),
                style = if (isLiked) KathaTypography.BodyStrong else KathaTypography.Meta,
                color = if (isLiked) KathaTheme.heart else KathaTheme.textSecondary
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs),
            modifier = Modifier.clickable(enabled = onComment != null) {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onComment?.invoke()
            }
        ) {
            Icon(Icons.Outlined.ChatBubbleOutline, "Comments", tint = KathaTheme.textSecondary, modifier = Modifier.size(14.dp))
            Text(formatCount(commentCount), style = KathaTypography.Meta, color = KathaTheme.textSecondary)
        }
        Spacer(Modifier.weight(1f))
        Text(
            story.languageCode.uppercase(),
            style = KathaTypography.Meta,
            color = KathaTheme.textTertiary,
            modifier = Modifier
                .clip(RoundedCornerShape(KathaTheme.Radius.xl))
                .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.xl))
                .padding(horizontal = KathaTheme.Spacing.s)
                .height(18.dp)
        )
    }
}

@Composable
private fun Metric(icon: ImageVector, value: String, tint: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(14.dp))
        Text(value, style = KathaTypography.Meta, color = tint)
    }
}

// MARK: - Author row

@Composable
fun AuthorRow(
    author: Author,
    isFollowing: Boolean,
    modifier: Modifier = Modifier,
    onFollow: () -> Unit
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        GeneratedAvatar(author.username, author.displayName, 44.dp)
        Column(Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Text(
                    author.displayName,
                    color = KathaTheme.textPrimary,
                    fontSize = KathaTypography.Body.fontSize,
                    fontWeight = KathaTypography.BodyStrong.fontWeight
                )
                if (author.isVerified) {
                    Icon(
                        Icons.Outlined.Verified, null,
                        tint = KathaTheme.accent,
                        modifier = Modifier.size(13.dp)
                    )
                }
            }
            Text("@${author.username}", color = KathaTheme.textSecondary, fontSize = KathaTypography.Meta.fontSize)
        }
        Text(
            text = if (isFollowing) "Following" else "Follow",
            color = if (isFollowing) KathaTheme.textSecondary else Color.White,
            fontSize = KathaTypography.Caption.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(if (isFollowing) KathaTheme.border else KathaTheme.accent)
                .clickable { onFollow() }
                .padding(horizontal = 16.dp, vertical = 7.dp)
        )
    }
}

// MARK: - Chips

@Composable
fun GenreChip(
    genre: Genre,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(if (isSelected) KathaTheme.accent else KathaTheme.surface)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Icon(
            genre.icon, null,
            tint = if (isSelected) Color.White else KathaTheme.textSecondary,
            modifier = Modifier.size(14.dp)
        )
        Text(
            genre.displayName,
            color = if (isSelected) Color.White else KathaTheme.textSecondary,
            fontSize = KathaTypography.Caption.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight
        )
    }
}

@Composable
fun FilterChip(
    title: String,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Text(
        text = title,
        color = if (isSelected) Color.White else KathaTheme.textSecondary,
        fontSize = KathaTypography.Caption.fontSize,
        fontWeight = KathaTypography.BodyStrong.fontWeight,
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(if (isSelected) KathaTheme.accent else KathaTheme.surface)
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 8.dp)
    )
}

// MARK: - Section header & segmented control

@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(title, color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.Title1.fontWeight)
        subtitle?.let {
            Text(it, color = KathaTheme.textSecondary, fontSize = KathaTypography.Caption.fontSize)
        }
    }
}

@Composable
fun SegmentedControl(
    options: List<String>,
    selectedIndex: Int,
    modifier: Modifier = Modifier,
    onSelect: (Int) -> Unit
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(KathaTheme.border.copy(alpha = 0.35f))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        options.forEachIndexed { index, label ->
            val selected = index == selectedIndex
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (selected) KathaTheme.surface else Color.Transparent)
                    .clickable { onSelect(index) }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    label,
                    color = if (selected) KathaTheme.textPrimary else KathaTheme.textSecondary,
                    fontSize = KathaTypography.Body.fontSize,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
                )
            }
        }
    }
}

// MARK: - Empty / loading states

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    ctaTitle: String? = null,
    onCta: (() -> Unit)? = null
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(KathaTheme.Spacing.xxxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Icon(icon, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(44.dp))
        Text(title, color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight)
        Text(
            message,
            color = KathaTheme.textSecondary,
            fontSize = KathaTypography.Body.fontSize,
            textAlign = TextAlign.Center
        )
        if (ctaTitle != null && onCta != null) {
            PrimaryCTA(ctaTitle, Modifier.padding(horizontal = KathaTheme.Spacing.xxl), onClick = onCta)
        }
    }
}

@Composable
fun Skeleton(
    modifier: Modifier = Modifier,
    height: Dp = 16.dp,
    width: Dp? = null,
    cornerRadius: Dp = 8.dp
) {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val alpha by transition.animateFloat(
        initialValue = 0.3f,
        targetValue = 0.6f,
        animationSpec = infiniteRepeatable(tween(1000), RepeatMode.Reverse),
        label = "shimmerAlpha"
    )
    Box(
        modifier = modifier
            .then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth())
            .height(height)
            .clip(RoundedCornerShape(cornerRadius))
            .background(KathaTheme.border.copy(alpha = alpha))
    )
}

@Composable
fun StoryCardSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(KathaTheme.Radius.l))
            .background(KathaTheme.surface)
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Skeleton(height = 200.dp, cornerRadius = 14.dp)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            Skeleton(width = 32.dp, height = 32.dp, cornerRadius = 16.dp)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Skeleton(width = 120.dp, height = 12.dp)
                Skeleton(width = 80.dp, height = 10.dp)
            }
        }
        Skeleton(height = 14.dp)
        Skeleton(width = 200.dp, height = 14.dp)
    }
}

// MARK: - Toast

@Composable
fun KathaToast(message: String, isWelcome: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(KathaTheme.Radius.m))
            .background(KathaTheme.surfaceElevated)
            .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        if (isWelcome) {
            Icon(
                Icons.Outlined.Verified, null,
                tint = KathaTheme.accent,
                modifier = Modifier.size(16.dp)
            )
        }
        Text(message, color = KathaTheme.textPrimary, fontSize = KathaTypography.Body.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight)
    }
}

/** Keeps content clear of the floating tab bar. */
@Composable
fun SafeBottomSpacer(height: Dp = 120.dp) {
    Spacer(Modifier.height(height))
}

@Composable
fun ScreenBackground(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(KathaTheme.canvas)) { content() }
}

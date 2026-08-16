package com.rork.kathaai.ui.screens

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.ChatBubble
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.ReportTarget
import com.rork.kathaai.model.StoryComment
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.GeneratedAvatar
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.components.formatCount
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState

// MARK: - Comments Sheet Overlay

@Composable
fun CommentsSheetOverlay(
    state: KathaUiState,
    viewModel: AppViewModel
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.5f))
            .clickable { viewModel.closeCommentsSheet() }
    ) {
        state.commentsSheetStoryId?.let { storyId ->
            Box(modifier = Modifier.align(Alignment.BottomCenter)) {
                CommentsBottomSheet(storyId = storyId, state = state, viewModel = viewModel)
            }
        }
    }
}

@Composable
private fun CommentsBottomSheet(
    storyId: String,
    state: KathaUiState,
    viewModel: AppViewModel
) {
    val allComments = remember(state.userComments, state.deletedCommentIds, state.blockedUserIds, state.commentsSortNewest) {
        val comments = state.commentsFor(storyId)
        if (state.commentsSortNewest) {
            comments.sortedBy { it.postedOffsetHours }
        } else {
            comments.sortedByDescending { viewModel.uiState.value.commentLikeCount(it) }
        }
    }
    val topLevel = allComments.filter { it.replyToUsername == null }
    val expandedReplies = remember { mutableStateOf(setOf<String>()) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
            .background(KathaTheme.surface)
            .navigationBarsPadding()
    ) {
        // Drag handle
        Box(
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .padding(top = 8.dp)
                .width(40.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(KathaTheme.border)
        )

        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    "Comments",
                    color = KathaTheme.textPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "${allComments.size} ${if (allComments.size == 1) "comment" else "comments"}",
                    color = KathaTheme.textSecondary,
                    fontSize = 12.sp
                )
            }
            Spacer(Modifier.weight(1f))
            Text(
                if (state.commentsSortNewest) "Newest" else "Top",
                color = KathaTheme.accent,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { viewModel.toggleCommentsSort() }
            )
        }

        // Comment list
        if (allComments.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.ChatBubble,
                title = "No comments yet",
                message = "Be the first to share your thoughts on this story.",
                modifier = Modifier.padding(vertical = KathaTheme.Spacing.xxxl)
            )
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = KathaTheme.Spacing.l,
                    end = KathaTheme.Spacing.l,
                    top = KathaTheme.Spacing.m
                ),
                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
            ) {
                items(topLevel, key = { it.id }) { comment ->
                    val replies = allComments.filter { it.replyToUsername == comment.username && it.id != comment.id }
                    val isExpanded = comment.id in expandedReplies.value
                    CommentCard(
                        comment = comment,
                        replies = replies,
                        isExpanded = isExpanded,
                        state = state,
                        viewModel = viewModel,
                        onToggleReplies = {
                            expandedReplies.value = if (isExpanded) {
                                expandedReplies.value - comment.id
                            } else {
                                expandedReplies.value + comment.id
                            }
                        },
                        onLike = { viewModel.toggleCommentLike(comment) },
                        onReply = { viewModel.startReply(comment) },
                        onReport = { viewModel.requestReport(ReportTarget.Comment(comment.id, comment.displayName)) },
                        onBlock = { viewModel.requestBlockUser(comment.authorId, comment.displayName) },
                        onAuthorTap = { viewModel.openAuthorProfile(comment.authorId) },
                        onDelete = { viewModel.deleteComment(comment.id) }
                    )
                }
                item { SafeBottomSpacer(100.dp) }
            }
        }

        // Composer
        CommentComposer(state = state, viewModel = viewModel)
    }
}

@Composable
private fun CommentCard(
    comment: StoryComment,
    replies: List<StoryComment>,
    isExpanded: Boolean,
    state: KathaUiState,
    viewModel: AppViewModel,
    onToggleReplies: () -> Unit,
    onLike: () -> Unit,
    onReply: () -> Unit,
    onReport: () -> Unit,
    onBlock: () -> Unit,
    onAuthorTap: () -> Unit,
    onDelete: () -> Unit
) {
    val isOwn = comment.authorId == state.currentUser?.username
    val isLiked = comment.id in state.likedCommentIds
    val likeCount = state.commentLikeCount(comment)
    val isHighlighted = state.highlightedCommentId == comment.id
    var showMenu by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(KathaTheme.Radius.m))
            .background(if (isHighlighted) KathaTheme.accentSoft.copy(alpha = 0.3f) else KathaTheme.canvas.copy(alpha = 0.5f))
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            GeneratedAvatar(comment.username, comment.displayName, 36.dp, Modifier.clickable { onAuthorTap() })
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    Text(
                        comment.displayName,
                        color = KathaTheme.textPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    if (comment.isVerified) {
                        Icon(Icons.Outlined.Verified, null, tint = KathaTheme.accent, modifier = Modifier.size(10.dp))
                    }
                }
                Text("@${comment.username}", color = KathaTheme.textSecondary, fontSize = 11.sp)
            }
            Text(comment.timeLabel, color = KathaTheme.textTertiary, fontSize = 11.sp)

            if (isOwn) {
                Icon(
                    Icons.Outlined.Delete, "Delete",
                    tint = KathaTheme.textTertiary,
                    modifier = Modifier.size(16.dp).clickable { onDelete() }
                )
            } else {
                Box {
                    Icon(
                        Icons.Outlined.MoreVert, "More",
                        tint = KathaTheme.textTertiary,
                        modifier = Modifier.size(16.dp).clickable { showMenu = true }
                    )
                    DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                        DropdownMenuItem(
                            text = { Text("Reply") },
                            leadingIcon = { Icon(Icons.Outlined.ChatBubbleOutline, null, modifier = Modifier.size(16.dp)) },
                            onClick = { showMenu = false; onReply() }
                        )
                        DropdownMenuItem(
                            text = { Text("Report", color = KathaTheme.error) },
                            leadingIcon = { Icon(Icons.Outlined.Flag, null, modifier = Modifier.size(16.dp)) },
                            onClick = { showMenu = false; onReport() }
                        )
                        DropdownMenuItem(
                            text = { Text("Block @${comment.username}", color = KathaTheme.error) },
                            leadingIcon = { Icon(Icons.Outlined.PersonOff, null, modifier = Modifier.size(16.dp)) },
                            onClick = { showMenu = false; onBlock() }
                        )
                    }
                }
            }
        }

        Text(comment.text, color = KathaTheme.textPrimary, fontSize = 14.sp)

        Row(
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.clickable { onLike() }
            ) {
                Icon(
                    if (isLiked) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                    "Like",
                    tint = if (isLiked) KathaTheme.accent else KathaTheme.textSecondary,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    formatCount(likeCount),
                    color = if (isLiked) KathaTheme.accent else KathaTheme.textSecondary,
                    fontSize = 12.sp,
                    fontWeight = if (isLiked) FontWeight.SemiBold else FontWeight.Normal
                )
            }
            Text(
                "Reply",
                color = KathaTheme.textSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { onReply() }
            )
        }

        if (replies.isNotEmpty()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.clickable { onToggleReplies() }
            ) {
                Icon(
                    if (isExpanded) Icons.Outlined.ExpandMore else Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    null,
                    tint = KathaTheme.accent,
                    modifier = Modifier.size(12.dp)
                )
                Text(
                    "${replies.size} ${if (replies.size == 1) "reply" else "replies"}",
                    color = KathaTheme.accent,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
            }

            AnimatedVisibility(visible = isExpanded) {
                Column(
                    modifier = Modifier.padding(start = KathaTheme.Spacing.xl),
                    verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                ) {
                    replies.forEach { reply ->
                        ReplyCard(
                            reply = reply,
                            state = state,
                            viewModel = viewModel,
                            onLike = { viewModel.toggleCommentLike(reply) },
                            onReply = { viewModel.startReply(reply) },
                            onReport = { viewModel.requestReport(ReportTarget.Comment(reply.id, reply.displayName)) },
                            onBlock = { viewModel.requestBlockUser(reply.authorId, reply.displayName) },
                            onAuthorTap = { viewModel.openAuthorProfile(reply.authorId) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReplyCard(
    reply: StoryComment,
    state: KathaUiState,
    viewModel: AppViewModel,
    onLike: () -> Unit,
    onReply: () -> Unit,
    onReport: () -> Unit,
    onBlock: () -> Unit,
    onAuthorTap: () -> Unit
) {
    val isLiked = reply.id in state.likedCommentIds
    val likeCount = state.commentLikeCount(reply)
    var showMenu by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(KathaTheme.Radius.s))
            .background(KathaTheme.canvas.copy(alpha = 0.5f))
            .padding(KathaTheme.Spacing.m),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            GeneratedAvatar(reply.username, reply.displayName, 28.dp)
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    Text(reply.displayName, color = KathaTheme.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    if (reply.isVerified) {
                        Icon(Icons.Outlined.Verified, null, tint = KathaTheme.accent, modifier = Modifier.size(9.dp))
                    }
                }
                Text("@${reply.username} \u2022 ${reply.timeLabel}", color = KathaTheme.textTertiary, fontSize = 10.sp)
            }
            var replyMenu by remember { mutableStateOf(false) }
            Box {
                Icon(Icons.Outlined.MoreVert, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(12.dp).clickable { replyMenu = true })
                DropdownMenu(expanded = replyMenu, onDismissRequest = { replyMenu = false }) {
                    DropdownMenuItem(text = { Text("Reply") }, leadingIcon = { Icon(Icons.Outlined.ChatBubbleOutline, null, modifier = Modifier.size(16.dp)) }, onClick = { replyMenu = false; onReply() })
                    DropdownMenuItem(text = { Text("Report", color = KathaTheme.error) }, onClick = { replyMenu = false; onReport() })
                    DropdownMenuItem(text = { Text("Block @${reply.username}", color = KathaTheme.error) }, leadingIcon = { Icon(Icons.Outlined.PersonOff, null, modifier = Modifier.size(16.dp)) }, onClick = { replyMenu = false; onBlock() })
                }
            }
        }
        Text(reply.text, color = KathaTheme.textPrimary, fontSize = 13.sp)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.clickable { onLike() }
        ) {
            Icon(
                if (isLiked) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                null,
                tint = if (isLiked) KathaTheme.accent else KathaTheme.textTertiary,
                modifier = Modifier.size(12.dp)
            )
            Text(formatCount(likeCount), color = if (isLiked) KathaTheme.accent else KathaTheme.textTertiary, fontSize = 11.sp)
        }
    }
}

@Composable
private fun CommentComposer(
    state: KathaUiState,
    viewModel: AppViewModel
) {
    val isActive = state.replyToComment != null || state.composerText.isNotEmpty()
    val remaining = 500 - state.composerText.length

    Column {
        AnimatedVisibility(visible = state.replyToComment != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = KathaTheme.Spacing.l)
                    .padding(top = KathaTheme.Spacing.s),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Replying to @${state.replyToComment?.username}",
                    color = KathaTheme.textSecondary,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    Icons.Outlined.Close, "Cancel",
                    tint = KathaTheme.textTertiary,
                    modifier = Modifier.size(14.dp).clickable { viewModel.cancelReply() }
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(KathaTheme.surface)
                .padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.m),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            state.currentUser?.let { user ->
                GeneratedAvatar(user.username, user.displayName, 32.dp)
            }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(20.dp))
                    .background(KathaTheme.canvas)
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                if (state.composerText.isEmpty() && state.replyToComment == null) {
                    Text("Add a comment...", color = KathaTheme.textTertiary, fontSize = 14.sp)
                }
                BasicTextField(
                    value = state.composerText,
                    onValueChange = { viewModel.updateComposerText(it) },
                    textStyle = TextStyle(color = KathaTheme.textPrimary, fontSize = 14.sp),
                    modifier = Modifier.fillMaxWidth()
                )
            }
            if (isActive) {
                if (remaining < 100) {
                    Text(
                        "$remaining",
                        color = if (remaining < 0) KathaTheme.error else KathaTheme.textTertiary,
                        fontSize = 11.sp
                    )
                }
                Icon(
                    Icons.AutoMirrored.Outlined.Send, "Send",
                    tint = if (state.composerText.trim().isNotEmpty()) KathaTheme.accent else KathaTheme.textTertiary,
                    modifier = Modifier.size(20.dp).clickable {
                        if (state.composerText.trim().isNotEmpty()) viewModel.sendComment()
                    }
                )
            }
        }
    }
}

// MARK: - Report Sheet Overlay

@Composable
fun ReportSheetOverlay(
    state: KathaUiState,
    viewModel: AppViewModel
) {
    val target = state.pendingReportTarget ?: return
    var selectedReason by remember { mutableStateOf<String?>(null) }
    val reasons = listOf("Spam or misleading", "Harassment or hate speech", "Inappropriate content", "Plagiarism", "Other")

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.5f))
            .clickable { viewModel.cancelReport() }
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                .background(KathaTheme.surface)
                .navigationBarsPadding()
                .padding(horizontal = KathaTheme.Spacing.xl, vertical = KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
        ) {
            Box(
                modifier = Modifier
                    .width(40.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(KathaTheme.border)
                    .align(Alignment.CenterHorizontally)
            )
            Text("Report ${target.label}", color = KathaTheme.textPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(
                "Help us keep Katha safe. Our team will review this shortly.",
                color = KathaTheme.textSecondary,
                fontSize = 13.sp
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.canvas.copy(alpha = 0.5f))
                    .padding(horizontal = KathaTheme.Spacing.l)
            ) {
                reasons.forEachIndexed { index, reason ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedReason = reason }
                            .padding(vertical = KathaTheme.Spacing.m),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(reason, color = KathaTheme.textPrimary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                        if (selectedReason == reason) {
                            Icon(Icons.Outlined.CheckCircle, null, tint = KathaTheme.accent, modifier = Modifier.size(18.dp))
                        }
                    }
                    if (index < reasons.lastIndex) {
                        Box(Modifier.fillMaxWidth().height(1.dp).background(KathaTheme.border))
                    }
                }
            }
            PrimaryCTA(
                "Submit report",
                icon = Icons.Outlined.Flag,
                enabled = selectedReason != null,
                onClick = { selectedReason?.let { viewModel.submitReport(it) } }
            )
            SecondaryCTA("Cancel") { viewModel.cancelReport() }
        }
    }
}

// MARK: - Block Confirmation Modal

@Composable
fun BlockConfirmationModal(
    state: KathaUiState,
    viewModel: AppViewModel
) {
    AlertDialog(
        onDismissRequest = { viewModel.cancelBlockUser() },
        icon = { Icon(Icons.Outlined.Block, null, tint = KathaTheme.error) },
        title = { Text("Block @${state.pendingBlockAuthorName}?") },
        text = {
            Text(
                "They won't be able to see your comments or stories. You won't see their content anywhere on Katha.",
                color = KathaTheme.textSecondary,
                fontSize = 14.sp
            )
        },
        confirmButton = {
            TextButton(onClick = { viewModel.confirmBlockUser() }) {
                Text("Block", color = KathaTheme.error, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = { viewModel.cancelBlockUser() }) { Text("Cancel") }
        }
    )
}

// MARK: - Blocked Users Screen

@Composable
fun BlockedUsersScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    onBack: () -> Unit
) {
    val blockedUsers = state.blockedUserIds.mapNotNull { id ->
        SeedData.author(id)?.let {
            com.rork.kathaai.model.ProfileUserItem(it.id, it.username, it.displayName, it.bio, it.isVerified, false)
        }
    }

    Box(
        modifier = Modifier.fillMaxSize().background(KathaTheme.canvas)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = KathaTheme.Spacing.s, vertical = KathaTheme.Spacing.s)
                    .height(56.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack, "Back",
                    tint = KathaTheme.textPrimary,
                    modifier = Modifier.size(20.dp).clickable { onBack() }.padding(8.dp)
                )
                Spacer(Modifier.weight(1f))
                Text("Blocked users", color = KathaTheme.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Spacer(Modifier.size(36.dp))
            }

            if (blockedUsers.isEmpty()) {
                EmptyState(
                    icon = Icons.Outlined.CheckCircle,
                    title = "No blocked users",
                    message = "When you block someone, they'll appear here."
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(top = KathaTheme.Spacing.m)
                ) {
                    items(blockedUsers) { user ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp)
                                .height(72.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                        ) {
                            GeneratedAvatar(user.username, user.displayName, 44.dp)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(user.displayName, color = KathaTheme.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                Text("@${user.username}", color = KathaTheme.textSecondary, fontSize = 12.sp)
                            }
                            SecondaryCTA("Unblock", onClick = { viewModel.unblockUser(user.id) })
                        }
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(1.dp)
                                .background(KathaTheme.border)
                                .padding(start = 20.dp)
                        )
                    }
                    item { SafeBottomSpacer() }
                }
            }
        }
    }
}

// MARK: - Share Launcher (Android Intent.ACTION_SEND)

@Composable
fun ShareLauncher(
    text: String,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    LaunchedEffect(text) {
        val sendIntent = Intent().apply {
            action = Intent.ACTION_SEND
            putExtra(Intent.EXTRA_TEXT, text)
            type = "text/plain"
        }
        context.startActivity(Intent.createChooser(sendIntent, "Share story"))
        onDismiss()
    }
}

// MARK: - User Comment Row (for Profile Comments tab)

@Composable
fun UserCommentRow(
    comment: StoryComment,
    state: KathaUiState,
    onClick: () -> Unit
) {
    val story = SeedData.story(comment.storyId)
    val likeCount = state.commentLikeCount(comment)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(KathaTheme.Radius.m))
            .background(KathaTheme.surface)
            .clickable { onClick() }
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        story?.let { s ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
            ) {
                Box(
                    modifier = Modifier
                        .size(width = 36.dp, height = 48.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(androidx.compose.ui.graphics.Brush.linearGradient(s.coverColors)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(s.genre.icon, null, tint = Color.White.copy(alpha = 0.3f), modifier = Modifier.size(16.dp))
                }
                Column {
                    Text(s.title, color = KathaTheme.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    Text(comment.timeLabel, color = KathaTheme.textTertiary, fontSize = 11.sp)
                }
            }
        }
        Text(comment.text, color = KathaTheme.textPrimary, fontSize = 14.sp, maxLines = 3)
        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                Icon(Icons.Outlined.FavoriteBorder, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(12.dp))
                Text(formatCount(likeCount), color = KathaTheme.textTertiary, fontSize = 12.sp)
            }
            comment.replyToUsername?.let {
                Text("Reply to @$it", color = KathaTheme.textTertiary, fontSize = 11.sp)
            }
        }
    }
}

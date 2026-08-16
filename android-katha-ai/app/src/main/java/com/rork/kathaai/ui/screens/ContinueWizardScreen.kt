package com.rork.kathaai.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.ChapterStarters
import com.rork.kathaai.data.DirectionPlaceholders
import com.rork.kathaai.data.SeedData
import com.rork.kathaai.model.ContinueWizardStep
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.NewChapterNotification
import com.rork.kathaai.model.Story
import com.rork.kathaai.ui.components.DestructiveCTA
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay

@Composable
fun ContinueWizardScreen(
    state: KathaUiState,
    onDirectionChange: (String) -> Unit,
    onMoveStep: (ContinueWizardStep) -> Unit,
    onShowGetIdeas: () -> Unit,
    onGenerate: () -> Unit,
    onPreview: () -> Unit,
    onPublishNow: () -> Unit,
    onSaveDraft: () -> Unit,
    onCancel: () -> Unit,
    onDiscard: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        // Header
        ContinueWizardHeader(state)

        // Content
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = KathaTheme.Spacing.l)
                .padding(top = KathaTheme.Spacing.s),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            when (state.continueWizardStep) {
                ContinueWizardStep.DIRECTION -> ChapterDirectionStep(
                    state = state,
                    onDirectionChange = onDirectionChange,
                    onShowGetIdeas = onShowGetIdeas
                )
                ContinueWizardStep.REVIEW -> ChapterReviewStep(state, onMoveStep)
            }
            SafeBottomSpacer(120.dp)
        }

        // Bottom bar
        ContinueWizardBottomBar(
            state = state,
            onGenerate = onGenerate,
            onMoveStep = onMoveStep,
            onCancel = onCancel
        )
    }

    if (state.showChapterGetIdeasSheet) {
        ChapterGetIdeasSheet(
            state = state,
            onDismiss = { /* handled by ViewModel */ },
            onPick = { starter ->
                onDirectionChange(starter)
                /* close sheet handled by ViewModel */
            }
        )
    }

    if (state.showDiscardChapterModal) {
        DiscardChapterModal(onDiscard = onDiscard, onKeep = { })
    }
}

@Composable
private fun ContinueWizardHeader(state: KathaUiState) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(KathaTheme.canvas)
            .padding(horizontal = KathaTheme.Spacing.l)
            .padding(top = KathaTheme.Spacing.s)
            .padding(bottom = KathaTheme.Spacing.m),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    "Continue story",
                    color = KathaTheme.textPrimary,
                    fontSize = KathaTypography.Title1.fontSize,
                    fontWeight = KathaTypography.Title1.fontWeight
                )
                Text(
                    "Step ${state.continueWizardStep.number} of ${ContinueWizardStep.entries.size}",
                    color = KathaTheme.textSecondary,
                    fontSize = KathaTypography.Caption.fontSize
                )
            }
            // Locked language chip
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(KathaTheme.surface)
                    .border(1.dp, KathaTheme.border, CircleShape)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.Lock, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(11.dp))
                Text(
                    state.continueWizardLanguage.code,
                    color = KathaTheme.textTertiary,
                    fontSize = KathaTypography.Caption.fontSize,
                    fontWeight = KathaTypography.BodyStrong.fontWeight
                )
            }
        }

        // Progress dots
        Row(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
            ContinueWizardStep.entries.forEach { step ->
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(
                            if (step.number <= state.continueWizardStep.number) KathaTheme.accent
                            else KathaTheme.border
                        )
                )
            }
        }
    }
}

@Composable
private fun ChapterDirectionStep(
    state: KathaUiState,
    onDirectionChange: (String) -> Unit,
    onShowGetIdeas: () -> Unit
) {
    var placeholder by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        placeholder = 1f
    }

    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)) {
        Text(
            "What happens next?",
            color = KathaTheme.textPrimary,
            fontSize = KathaTypography.Title2.fontSize,
            fontWeight = KathaTypography.Title1.fontWeight
        )
        Text(
            "A hint, a theme, a scene — or leave it open.",
            color = KathaTheme.textSecondary,
            fontSize = KathaTypography.Body.fontSize
        )

        // Recap card
        RecapCard(
            storyId = state.continueWizardStoryId ?: "",
            chapterNumber = state.continueWizardChapterNumber - 1
        )

        // Direction input
        Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
            Text(
                "Chapter direction (optional)",
                color = KathaTheme.textSecondary,
                fontSize = KathaTypography.Caption.fontSize,
                fontWeight = KathaTypography.BodyStrong.fontWeight
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp)
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.canvas)
                    .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.m))
                    .padding(KathaTheme.Spacing.m)
            ) {
                if (state.continueWizardDirection.isEmpty()) {
                    Text(
                        DirectionPlaceholders.random(),
                        color = KathaTheme.textTertiary,
                        fontSize = KathaTypography.Body.fontSize
                    )
                }
                TextField(
                    value = state.continueWizardDirection,
                    onValueChange = onDirectionChange,
                    modifier = Modifier.fillMaxSize(),
                    placeholder = {
                        Text(
                            DirectionPlaceholders.random(),
                            color = KathaTheme.textTertiary
                        )
                    },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent
                    )
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "${state.continueWizardDirection.length} / 500",
                color = KathaTheme.textTertiary,
                fontSize = KathaTypography.Meta.fontSize
            )
            Row(
                modifier = Modifier.clickable { onShowGetIdeas() },
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.Lightbulb, null, tint = KathaTheme.accent, modifier = Modifier.size(16.dp))
                Text("Get ideas", color = KathaTheme.accent, fontSize = KathaTypography.Caption.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight)
            }
        }
    }
}

@Composable
private fun RecapCard(storyId: String, chapterNumber: Int) {
    val story = SeedData.story(storyId)
    val chapter = story?.chapters?.lastOrNull()
    val fullText = chapter?.paragraphs?.joinToString(" ") ?: "The story so far..."
    val sentences = fullText.split(". ")
    val recap = if (sentences.size > 3) sentences.takeLast(3).joinToString(". ") + "." else fullText

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(14.dp))
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        Text(
            "PREVIOUSLY",
            color = KathaTheme.textTertiary,
            fontSize = KathaTypography.Meta.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight
        )
        Text(
            recap,
            style = KathaTypography.Recap,
            color = KathaTheme.textSecondary
        )
    }
}

@Composable
private fun ChapterReviewStep(
    state: KathaUiState,
    onMoveStep: (ContinueWizardStep) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)) {
        Text(
            "Ready to spin Chapter ${state.continueWizardChapterNumber}?",
            color = KathaTheme.textPrimary,
            fontSize = KathaTypography.Title2.fontSize,
            fontWeight = KathaTypography.Title1.fontWeight
        )
        Text(
            "We'll keep the voice, characters, and world consistent.",
            color = KathaTheme.textSecondary,
            fontSize = KathaTypography.Body.fontSize
        )

        // Summary card
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(KathaTheme.surface)
                .border(1.dp, KathaTheme.border, RoundedCornerShape(16.dp))
                .padding(KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)) {
                Text(
                    "CHAPTER ${state.continueWizardChapterNumber} OF ${state.continueWizardStoryTitle.uppercase()}",
                    color = KathaTheme.textTertiary,
                    fontSize = KathaTypography.Meta.fontSize,
                    fontWeight = KathaTypography.BodyStrong.fontWeight
                )
                Text(
                    state.continueWizardStoryTitle,
                    color = KathaTheme.accent,
                    fontSize = KathaTypography.Body.fontSize,
                    fontWeight = KathaTypography.BodyStrong.fontWeight
                )
            }
            Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(KathaTheme.border))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Genre", color = KathaTheme.textSecondary, fontSize = KathaTypography.Body.fontSize)
                Text(
                    state.continueWizardGenre?.displayName ?: "—",
                    color = KathaTheme.textPrimary,
                    fontSize = KathaTypography.Body.fontSize,
                    fontWeight = KathaTypography.BodyStrong.fontWeight
                )
            }
            Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(KathaTheme.border))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Language", color = KathaTheme.textSecondary, fontSize = KathaTypography.Body.fontSize)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Lock, null, tint = KathaTheme.textTertiary, modifier = Modifier.size(10.dp))
                    Text(
                        state.continueWizardLanguage.displayName,
                        color = KathaTheme.textPrimary,
                        fontSize = KathaTypography.Body.fontSize,
                        fontWeight = KathaTypography.BodyStrong.fontWeight
                    )
                }
            }
            Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(KathaTheme.border))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column {
                    Text("Direction", color = KathaTheme.textSecondary, fontSize = KathaTypography.Body.fontSize)
                    if (state.continueWizardDirection.isEmpty()) {
                        Text(
                            "Surprise me — let the AI decide",
                            color = KathaTheme.textSecondary,
                            fontSize = KathaTypography.Body.fontSize,
                            fontStyle = androidx.compose.ui.text.font.FontStyle.Italic
                        )
                    } else {
                        Text(
                            state.continueWizardDirection,
                            color = KathaTheme.textPrimary,
                            fontSize = KathaTypography.Body.fontSize,
                            maxLines = 3
                        )
                    }
                }
                Text(
                    "Change",
                    color = KathaTheme.accent,
                    fontSize = KathaTypography.Body.fontSize,
                    fontWeight = KathaTypography.BodyStrong.fontWeight,
                    modifier = Modifier.clickable { onMoveStep(ContinueWizardStep.DIRECTION) }
                )
            }
        }

        // Series awareness note
        state.continueWizardPlannedChapterCount?.let { planned ->
            val remaining = planned - state.continueWizardChapterNumber
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(KathaTheme.surface)
                    .border(1.dp, KathaTheme.border, RoundedCornerShape(12.dp))
                    .padding(KathaTheme.Spacing.m)
            ) {
                Text(
                    "Chapter ${state.continueWizardChapterNumber} of $planned planned. ${maxOf(0, remaining)} more after this one.",
                    color = KathaTheme.textSecondary,
                    fontSize = KathaTypography.Body.fontSize,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        state.chapterGenerationError?.let { error ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.error.copy(alpha = 0.08f))
                    .padding(KathaTheme.Spacing.m),
                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.ErrorOutline, null, tint = KathaTheme.error)
                Text(error, color = KathaTheme.error, fontSize = KathaTypography.Body.fontSize)
            }
        }
    }
}

@Composable
private fun ContinueWizardBottomBar(
    state: KathaUiState,
    onGenerate: () -> Unit,
    onMoveStep: (ContinueWizardStep) -> Unit,
    onCancel: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(KathaTheme.canvas.copy(alpha = 0.95f))
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        if (state.continueWizardStep == ContinueWizardStep.REVIEW) {
            PrimaryCTA(
                title = "Generate chapter (1 credit)",
                isLoading = state.isGeneratingChapter,
                onClick = onGenerate
            )
            Text(
                "You have ${state.currentUser?.credits ?: 0} credits",
                color = KathaTheme.textSecondary,
                fontSize = KathaTypography.Meta.fontSize,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center
            )
        } else {
            PrimaryCTA(
                title = "Next",
                onClick = { onMoveStep(ContinueWizardStep.REVIEW) }
            )
        }

        Text(
            if (state.continueWizardStep == ContinueWizardStep.DIRECTION) "Cancel" else "Back",
            color = KathaTheme.textSecondary,
            fontSize = KathaTypography.Body.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight,
            modifier = Modifier
                .fillMaxWidth()
                .clickable {
                    if (state.continueWizardStep == ContinueWizardStep.DIRECTION) {
                        if (state.continueWizardDirection.isNotEmpty()) {
                            /* show discard modal */
                        } else {
                            onCancel()
                        }
                    } else {
                        onMoveStep(ContinueWizardStep.DIRECTION)
                    }
                },
            textAlign = TextAlign.Center
        )
    }
}

@Composable
fun ChapterGetIdeasSheet(
    state: KathaUiState,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit
) {
    val genre = state.continueWizardGenre ?: Genre.FICTION
    val starters = remember(genre, state.continueWizardChapterNumber) {
        ChapterStarters.starters(genre, state.continueWizardChapterNumber, state.continueWizardPlannedChapterCount)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
            .verticalScroll(rememberScrollState())
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Text("Chapter starters", color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.Title1.fontWeight)
        Text("Tap any to use it as your direction.", color = KathaTheme.textSecondary, fontSize = KathaTypography.Body.fontSize)
        starters.forEach { starter ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.surface)
                    .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.m))
                    .clickable { onPick(starter) }
                    .padding(KathaTheme.Spacing.m)
            ) {
                Text(starter, color = KathaTheme.textPrimary, fontSize = KathaTypography.Body.fontSize)
            }
        }
    }
}

@Composable
fun DiscardChapterModal(onDiscard: () -> Unit, onKeep: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable { onKeep() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = KathaTheme.Spacing.xl)
                .clip(RoundedCornerShape(20.dp))
                .background(KathaTheme.canvas)
                .padding(KathaTheme.Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(Icons.Outlined.Delete, null, tint = KathaTheme.error, modifier = Modifier.size(40.dp))
            Text("Discard this chapter draft?", color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.Title1.fontWeight)
            Text(
                "You'll lose what you've typed and return to the story.",
                color = KathaTheme.textSecondary,
                fontSize = KathaTypography.Body.fontSize,
                textAlign = TextAlign.Center
            )
            DestructiveCTA(title = "Discard draft", onClick = onDiscard)
            SecondaryCTA(title = "Keep editing", onClick = onKeep)
        }
    }
}

@Composable
fun PublishConfirmationModal(
    state: KathaUiState,
    onPublish: () -> Unit,
    onKeepDraft: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable { onKeepDraft() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = KathaTheme.Spacing.xl)
                .clip(RoundedCornerShape(20.dp))
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Icon with accentSoft circle
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(KathaTheme.accentSoft),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    null,
                    tint = KathaTheme.accent,
                    modifier = Modifier.size(28.dp)
                )
            }

            Text(
                "Publish Chapter ${state.continueWizardChapterNumber}?",
                color = KathaTheme.textPrimary,
                fontSize = KathaTypography.Title2.fontSize,
                fontWeight = KathaTypography.Title1.fontWeight
            )

            if (state.continueWizardFollowerCount > 0) {
                Text(
                    "${state.continueWizardFollowerCount} followers will be notified this chapter is live.",
                    color = KathaTheme.textSecondary,
                    fontSize = KathaTypography.Body.fontSize,
                    textAlign = TextAlign.Center
                )
            } else {
                Text(
                    "This chapter will be visible to everyone on Katha.",
                    color = KathaTheme.textSecondary,
                    fontSize = KathaTypography.Body.fontSize,
                    textAlign = TextAlign.Center
                )
            }

            Text(
                "Published chapters can't be edited in the current version.",
                color = KathaTheme.textTertiary,
                fontSize = KathaTypography.Meta.fontSize,
                textAlign = TextAlign.Center
            )

            PrimaryCTA(
                title = "Publish now",
                isLoading = state.isPublishing,
                onClick = onPublish
            )
            SecondaryCTA(title = "Keep as draft", onClick = onKeepDraft)
        }
    }
}

@Composable
fun DeleteDraftModal(
    state: KathaUiState,
    onDelete: () -> Unit,
    onKeep: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable { onKeep() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = KathaTheme.Spacing.xl)
                .clip(RoundedCornerShape(20.dp))
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(KathaTheme.error.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Outlined.ErrorOutline,
                    null,
                    tint = KathaTheme.error,
                    modifier = Modifier.size(28.dp)
                )
            }

            Text("Delete this draft?", color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.Title1.fontWeight)
            Text(
                "This can't be undone. Your credit was already spent.",
                color = KathaTheme.textSecondary,
                fontSize = KathaTypography.Body.fontSize,
                textAlign = TextAlign.Center
            )

            DestructiveCTA(
                title = "Delete draft",
                isLoading = state.isDeleting,
                onClick = onDelete
            )
            SecondaryCTA(title = "Keep draft", onClick = onKeep)
        }
    }
}

@Composable
fun UnfollowStoryModal(
    state: KathaUiState,
    onConfirm: () -> Unit,
    onCancel: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable { onCancel() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = KathaTheme.Spacing.xl)
                .clip(RoundedCornerShape(20.dp))
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            DestructiveCTA(title = "Stop following", onClick = onConfirm)
            SecondaryCTA(title = "Keep following", onClick = onCancel)
        }
    }
}

@Composable
fun ChapterGenerationScreen(
    state: KathaUiState,
    onPreview: () -> Unit,
    onPublishNow: () -> Unit,
    onSaveDraft: () -> Unit
) {
    var progress by remember { mutableFloatStateOf(0f) }
    val statuses = listOf(
        "Picking up where we left off…",
        "Maintaining voice and tone…",
        "Weaving the next thread…",
        "Painting the chapter cover…",
        "Almost there…"
    )
    val statusIndex = minOf((progress * statuses.size).toInt(), statuses.size - 1)

    LaunchedEffect(Unit) {
        while (progress < 1f) {
            delay(100)
            progress = (progress + 0.01f).coerceAtMost(1f)
        }
    }

    val animatedProgress by animateFloatAsState(
        targetValue = progress,
        animationSpec = tween(1000),
        label = "progress"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(KathaTheme.canvas),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.padding(KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Progress circle
            Box(
                modifier = Modifier.size(140.dp),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    progress = { animatedProgress },
                    modifier = Modifier.size(140.dp),
                    color = KathaTheme.accent,
                    strokeWidth = 6.dp,
                    trackColor = KathaTheme.border
                )
                Icon(Icons.Outlined.AutoAwesome, null, tint = KathaTheme.accent, modifier = Modifier.size(44.dp))
            }

            if (state.lastGeneratedChapter != null) {
                Text("Chapter ${state.continueWizardChapterNumber} is ready!", color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.Title1.fontWeight)
                PrimaryCTA(title = "Preview chapter", onClick = onPreview)
                SecondaryCTA(title = "Publish now", onClick = onPublishNow)
                Text(
                    "Save as draft",
                    color = KathaTheme.textSecondary,
                    fontSize = KathaTypography.Body.fontSize,
                    fontWeight = KathaTypography.BodyStrong.fontWeight,
                    modifier = Modifier.clickable { onSaveDraft() }
                )
            } else {
                Text(statuses.getOrElse(statusIndex) { statuses.last() }, color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.BodyStrong.fontWeight)
                Text("This usually takes 10–14 seconds", color = KathaTheme.textSecondary, fontSize = KathaTypography.Body.fontSize)
            }
        }
    }
}

// MARK: - New Chapter Banner

@Composable
fun NewChapterBanner(
    state: KathaUiState,
    onDismiss: (String) -> Unit,
    onTap: () -> Unit
) {
    val notifications = state.unreadNewChapterNotifications
    if (notifications.isEmpty()) return

    val count = notifications.size
    val first = notifications.first()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.m)
            .padding(top = KathaTheme.Spacing.m)
            .clip(RoundedCornerShape(12.dp))
            .background(KathaTheme.accentSoft)
            .clickable { onTap() }
            .padding(KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Icon(Icons.Outlined.AutoAwesome, null, tint = KathaTheme.accent, modifier = Modifier.size(18.dp))
        Text(
            if (count == 1) "Chapter ${first.chapterNumber} of '${first.storyTitle}' is here"
            else "$count new chapters from stories you follow",
            color = KathaTheme.textPrimary,
            fontSize = KathaTypography.Body.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight,
            modifier = Modifier.weight(1f),
            maxLines = 2
        )
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            null,
            tint = KathaTheme.textTertiary,
            modifier = Modifier.size(18.dp)
        )
        Icon(
            Icons.Outlined.Close,
            "Dismiss",
            tint = KathaTheme.textTertiary,
            modifier = Modifier
                .size(20.dp)
                .clickable { onDismiss(first.storyId) }
        )
    }
}

// MARK: - New Chapters Home Section

@Composable
fun NewChaptersHomeSection(
    state: KathaUiState,
    onTapStory: (Story, Int) -> Unit,
    onMarkRead: (String, Int) -> Unit
) {
    val notifications = state.unreadNewChapterNotifications.sortedByDescending { it.publishedAt }
    if (notifications.isEmpty()) return

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Text("New chapters ✨", color = KathaTheme.textPrimary, fontSize = KathaTypography.Title2.fontSize, fontWeight = KathaTypography.Title1.fontWeight)

        LazyRow(
            contentPadding = PaddingValues(horizontal = KathaTheme.Spacing.l),
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
        ) {
            items(notifications) { notif ->
                NewChapterCard(
                    notification = notif,
                    onTap = {
                        val story = SeedData.story(notif.storyId)
                        if (story != null) {
                            val chapterIndex = minOf(notif.chapterNumber - 1, maxOf(0, story.chapters.size - 1))
                            onTapStory(story, chapterIndex)
                            onMarkRead(notif.storyId, notif.chapterNumber)
                        }
                    }
                )
            }
        }
    }
}

@Composable
private fun NewChapterCard(
    notification: NewChapterNotification,
    onTap: () -> Unit
) {
    Column(
        modifier = Modifier
            .width(140.dp)
            .clickable { onTap() },
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        // Cover with NEW pill
        Box(
            modifier = Modifier
                .height(180.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    androidx.compose.ui.graphics.Brush.linearGradient(notification.coverColors)
                )
        ) {
            // NEW pill
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(KathaTheme.accent)
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text("NEW", color = Color.White, fontSize = KathaTypography.Meta.fontSize, fontWeight = KathaTypography.Title1.fontWeight)
            }
            // Title
            Text(
                notification.storyTitle,
                color = Color.White,
                fontSize = KathaTypography.Meta.fontSize,
                fontWeight = KathaTypography.BodyStrong.fontWeight,
                maxLines = 2,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(8.dp)
            )
        }
        Text(
            "Chapter ${notification.chapterNumber} just dropped",
            color = KathaTheme.accent,
            fontSize = KathaTypography.Meta.fontSize,
            fontWeight = KathaTypography.BodyStrong.fontWeight,
            maxLines = 1
        )
    }
}

// MARK: - Series Progress Badge

@Composable
fun SeriesProgressBadge(
    story: Story,
    isAuthor: Boolean
) {
    val chapterCount = story.chapters.size
    val planned = story.plannedChapterCount
    val badgeText = when {
        planned != null && chapterCount >= planned -> "SERIES COMPLETE ✨"
        planned != null && chapterCount < planned -> if (isAuthor) "CHAPTER $chapterCount OF $planned PLANNED" else "MORE CHAPTERS COMING ✨"
        chapterCount > 1 -> "ONGOING SERIES"
        else -> ""
    }
    val useAccent = when {
        planned != null && chapterCount >= planned -> true
        planned != null && chapterCount < planned && !isAuthor -> true
        else -> false
    }

    if (badgeText.isNotEmpty()) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(20.dp))
                .background(if (useAccent) KathaTheme.accentSoft else Color.Transparent)
                .border(
                    if (useAccent) 0.dp else 1.dp,
                    if (useAccent) Color.Transparent else KathaTheme.border,
                    RoundedCornerShape(20.dp)
                )
                .padding(horizontal = 10.dp, vertical = 5.dp)
        ) {
            Text(
                badgeText,
                color = if (useAccent) KathaTheme.accent else KathaTheme.textTertiary,
                fontSize = KathaTypography.Meta.fontSize,
                fontWeight = KathaTypography.BodyStrong.fontWeight
            )
        }
    }
}

package com.rork.kathaai.ui.screens

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Expand
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.ModeEdit
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.unit.dp
import com.rork.kathaai.model.CoverGenerationStatus
import com.rork.kathaai.model.CreationPhase
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.GeneratedStory
import com.rork.kathaai.model.ReadingLevel
import com.rork.kathaai.model.StoryLanguage
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.ui.theme.KathaTypography
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState

@Composable
fun CreateScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    modifier: Modifier = Modifier,
    onSignIn: () -> Unit
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
    ) {
        when {
            !state.isAuthenticated -> UnauthenticatedCreateState(onSignIn = onSignIn)
            (state.currentUser?.credits ?: 0) <= 0 && state.lastGeneratedStory == null -> EmptyCreditsState(onGetCredits = viewModel::showOutOfCreditsModal)
            state.isGenerating || state.lastGeneratedStory != null -> AuthorWorkspace(state = state, viewModel = viewModel)
            else -> PromptFirstComposer(state = state, viewModel = viewModel)
        }

        if (state.showOutOfCreditsModal) {
            OutOfCreditsModal(
                onBuy = viewModel::buyCreditsMock,
                onDismiss = viewModel::dismissOutOfCreditsModal
            )
        }
    }
}

@Composable
private fun PromptFirstComposer(
    state: KathaUiState,
    viewModel: AppViewModel,
    modifier: Modifier = Modifier
) {
    var showDiscard by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    var showReadingDialog by remember { mutableStateOf(false) }
    val hasInput = state.wizardTopic.isNotBlank() || state.wizardGenre != null

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = KathaTheme.Spacing.l)
                .padding(top = KathaTheme.Spacing.s, bottom = 140.dp),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)) {
                    Text("Create a story", color = KathaTheme.textPrimary, style = KathaTypography.Title1)
                    Text("Start with the feeling, conflict, or moment you can't stop thinking about.", color = KathaTheme.textSecondary, style = KathaTypography.Body)
                }
                TextButton(onClick = { if (hasInput) showDiscard = true else viewModel.requestTab(0) }) {
                    Text("Cancel", color = KathaTheme.accent, style = KathaTypography.BodyStrong)
                }
            }

            Text("Choose a tone", color = KathaTheme.textPrimary, style = KathaTypography.BodyStrong)
            androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                items(Genre.entries.filter { !(state.kidsMode && it == Genre.EROTICA) }, key = { it.name }) { genre ->
                    val selected = genre == state.wizardGenre
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (selected) KathaTheme.accent else KathaTheme.surface)
                            .border(1.dp, if (selected) KathaTheme.accent else KathaTheme.border, CircleShape)
                            .clickable { viewModel.setWizardGenre(genre) }
                            .padding(horizontal = KathaTheme.Spacing.m, vertical = KathaTheme.Spacing.s)
                    ) {
                        Text(genre.displayName, color = if (selected) Color.White else KathaTheme.textPrimary, style = KathaTypography.Caption)
                    }
                }
            }

            StoryIdeaEditor(state = state, viewModel = viewModel)

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.l))
                    .background(KathaTheme.surface)
                    .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.l))
                    .padding(KathaTheme.Spacing.m),
                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { showLanguageDialog = true }) {
                    Text(state.wizardLanguage.flagEmoji, style = KathaTypography.Title2)
                    Spacer(Modifier.width(KathaTheme.Spacing.m))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Language", color = KathaTheme.textSecondary, style = KathaTypography.Caption)
                        Text(state.wizardLanguage.displayName, color = KathaTheme.textPrimary, style = KathaTypography.BodyStrong)
                    }
                    Icon(Icons.Outlined.Language, contentDescription = "Choose language", tint = KathaTheme.textTertiary)
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Plan as a series", color = KathaTheme.textPrimary, style = KathaTypography.BodyStrong)
                        Text("Build one chapter at a time, then choose when to end it.", color = KathaTheme.textSecondary, style = KathaTypography.Caption)
                    }
                    Switch(
                        checked = state.wizardPlanAsSeries,
                        onCheckedChange = viewModel::updateWizardPlanAsSeries,
                        colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = KathaTheme.accent)
                    )
                }
                if (state.wizardPlanAsSeries) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("Target chapters", color = KathaTheme.textSecondary, style = KathaTypography.Body)
                        Spacer(Modifier.weight(1f))
                        IconButton(onClick = { viewModel.updateWizardSeriesChapterCount(-1) }) { Text("−", style = KathaTypography.Title2) }
                        Text(state.wizardSeriesChapterCount.toString(), color = KathaTheme.textPrimary, style = KathaTypography.BodyStrong)
                        IconButton(onClick = { viewModel.updateWizardSeriesChapterCount(1) }) { Text("+", style = KathaTypography.Title2) }
                    }
                }
                Row(modifier = Modifier.fillMaxWidth().clickable { showReadingDialog = true }, verticalAlignment = Alignment.CenterVertically) {
                    Text("Reading level", color = KathaTheme.textPrimary, style = KathaTypography.BodyStrong, modifier = Modifier.weight(1f))
                    Text(state.wizardReadingLevel.title, color = KathaTheme.accent, style = KathaTypography.BodyStrong)
                }
            }
            SafeBottomSpacer()
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(KathaTheme.canvas.copy(alpha = 0.96f))
                .navigationBarsPadding()
                .padding(KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            state.creationError?.let { Text(it, color = KathaTheme.error, style = KathaTypography.Caption) }
            val valid = state.wizardGenre != null && state.wizardTopic.trim().length >= 8
            PrimaryCTA(
                title = "Generate privately • 1 credit",
                icon = Icons.Outlined.AutoAwesome,
                isLoading = state.isGenerating,
                enabled = valid && !state.isGenerating
            ) { viewModel.generateStory() }
            Text("Your story stays private until you publish it.", color = KathaTheme.textSecondary, style = KathaTypography.Meta, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }

    if (showDiscard) {
        AlertDialog(
            onDismissRequest = { showDiscard = false },
            title = { Text("Discard your story idea?") },
            text = { Text("Your prompt and settings will be cleared.") },
            confirmButton = { TextButton(onClick = { showDiscard = false; viewModel.resetWizard(); viewModel.requestTab(0) }) { Text("Discard", color = KathaTheme.error) } },
            dismissButton = { TextButton(onClick = { showDiscard = false }) { Text("Keep editing") } }
        )
    }
    if (showLanguageDialog) LanguageDialog(selected = state.wizardLanguage, onSelect = { viewModel.updateWizardLanguage(it); showLanguageDialog = false }, onDismiss = { showLanguageDialog = false })
    if (showReadingDialog) ReadingLevelDialog(selected = state.wizardReadingLevel, onSelect = { viewModel.updateWizardReadingLevel(it); showReadingDialog = false }, onDismiss = { showReadingDialog = false })
    if (state.showFullScreenPrompt) FullScreenPromptEditor(state = state, viewModel = viewModel)
}

@Composable
private fun StoryIdeaEditor(state: KathaUiState, viewModel: AppViewModel) {
    val placeholder = "A retired astronaut receives a signal from a colleague who died on a mission 40 years ago..."
    Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Your story idea", color = KathaTheme.textPrimary, style = KathaTypography.BodyStrong, modifier = Modifier.weight(1f))
            Text("${state.wizardTopic.length} / 1600", color = KathaTheme.textTertiary, style = KathaTypography.Meta)
        }
        Box {
            OutlinedTextField(
                value = state.wizardTopic,
                onValueChange = viewModel::updateWizardTopic,
                placeholder = { Text(placeholder, color = KathaTheme.textTertiary, style = KathaTypography.Body) },
                minLines = 12,
                maxLines = 16,
                shape = RoundedCornerShape(KathaTheme.Radius.l),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = KathaTheme.accent,
                    unfocusedBorderColor = KathaTheme.border,
                    focusedContainerColor = KathaTheme.canvas,
                    unfocusedContainerColor = KathaTheme.canvas,
                    focusedTextColor = KathaTheme.textPrimary,
                    unfocusedTextColor = KathaTheme.textPrimary
                ),
                modifier = Modifier.fillMaxWidth()
            )
            IconButton(onClick = { viewModel.setFullScreenPrompt(true) }, modifier = Modifier.align(Alignment.TopEnd).padding(KathaTheme.Spacing.s)) {
                Icon(Icons.Outlined.Expand, contentDescription = "Expand story idea editor", tint = KathaTheme.textSecondary)
            }
        }
        Text("More detail gives Katha more to work with. You can change it after generation.", color = KathaTheme.textTertiary, style = KathaTypography.Caption)
    }
}

@Composable
private fun FullScreenPromptEditor(state: KathaUiState, viewModel: AppViewModel) {
    Dialog(onDismissRequest = { viewModel.setFullScreenPrompt(false) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(modifier = Modifier.fillMaxSize().background(KathaTheme.canvas).padding(KathaTheme.Spacing.l)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Your story idea", color = KathaTheme.textPrimary, style = KathaTypography.Title2, modifier = Modifier.weight(1f))
                TextButton(onClick = { viewModel.setFullScreenPrompt(false) }) { Text("Done", color = KathaTheme.accent) }
            }
            OutlinedTextField(
                value = state.wizardTopic,
                onValueChange = viewModel::updateWizardTopic,
                placeholder = { Text("Write freely…") },
                modifier = Modifier.fillMaxSize().padding(top = KathaTheme.Spacing.m),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = KathaTheme.accent, unfocusedBorderColor = KathaTheme.border, focusedContainerColor = KathaTheme.canvas, unfocusedContainerColor = KathaTheme.canvas, focusedTextColor = KathaTheme.textPrimary, unfocusedTextColor = KathaTheme.textPrimary)
            )
        }
    }
}

@Composable
private fun AuthorWorkspace(state: KathaUiState, viewModel: AppViewModel) {
    val story = state.lastGeneratedStory
    if (story == null) {
        GenerationProgress(state = state)
        return
    }
    var showRevision by remember { mutableStateOf(false) }
    var showEditor by remember { mutableStateOf(false) }
    var showEndConfirmation by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = KathaTheme.Spacing.l, vertical = KathaTheme.Spacing.s), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xs)) {
                Text(if (story.isPublished) "Your published story" else "Your private draft", color = KathaTheme.textPrimary, style = KathaTypography.Title1)
                Text(if (story.isSeriesEnded) "Series ended" else if (story.isSeries) "Series in progress" else "One-shot story", color = KathaTheme.textSecondary, style = KathaTypography.Caption)
            }
            Text(if (story.isPublished) "PUBLISHED" else "DRAFT", color = if (story.isPublished) KathaTheme.success else KathaTheme.accent, style = KathaTypography.Meta)
        }

        MockCover(story = story, progress = state.creationCoverProgress)

        Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
            Text(story.title, color = KathaTheme.textPrimary, style = KathaTypography.Title1)
            Text(story.synopsis, color = KathaTheme.textSecondary, style = KathaTypography.Body)
            Text("${story.wordCount} words  •  ${story.readingTime} min  •  v${story.contentVersion}", color = KathaTheme.textTertiary, style = KathaTypography.Meta)
        }

        state.creationError?.let { Text(it, color = KathaTheme.error, style = KathaTypography.Caption, modifier = Modifier.fillMaxWidth().background(KathaTheme.error.copy(alpha = 0.08f), RoundedCornerShape(KathaTheme.Radius.m)).padding(KathaTheme.Spacing.m)) }

        Text(if (story.isPublished) "Keep shaping it" else "Make it yours", color = KathaTheme.textPrimary, style = KathaTypography.Title2)
        SecondaryCTA(title = "Revise with a prompt", icon = Icons.Outlined.AutoAwesome) { showRevision = true }
        SecondaryCTA(title = "Edit text directly", icon = Icons.Outlined.ModeEdit) { showEditor = true }

        if (story.isSeries) {
            if (!story.isPublished) {
                PrimaryCTA(title = "Publish Chapter 1", icon = Icons.AutoMirrored.Filled.Send, enabled = state.creationPhase == CreationPhase.DRAFT_READY) { viewModel.publishCurrentStory() }
            }
            SecondaryCTA(title = "Continue to the next chapter", icon = Icons.Outlined.ArrowForward) {
                viewModel.startContinueWizard(story.id, story.title, story.genre, story.chapterCount, story.plannedChapterCount, story.followerCount)
            }
            if (story.chapterCount >= 2 && !story.isSeriesEnded) {
                SecondaryCTA(title = "End series", icon = Icons.Outlined.Flag) { showEndConfirmation = true }
            } else if (story.isSeriesEnded) {
                Text("Ended stories stay editable. Continue can reopen the series with a new draft chapter.", color = KathaTheme.textSecondary, style = KathaTypography.Caption)
            }
        } else if (!story.isPublished) {
            PrimaryCTA(title = "Publish story", icon = Icons.AutoMirrored.Filled.Send, enabled = state.creationPhase == CreationPhase.DRAFT_READY) { viewModel.publishCurrentStory() }
        }

        if (story.isPublished) SecondaryCTA(title = "Create another story", icon = Icons.Outlined.Add) { viewModel.resetWizard() }
        SafeBottomSpacer()
    }

    if (showRevision) RevisionDialog(state = state, viewModel = viewModel, onDismiss = { showRevision = false })
    if (showEditor) DirectEditorDialog(story = story, viewModel = viewModel, onDismiss = { showEditor = false })
    if (showEndConfirmation) {
        AlertDialog(onDismissRequest = { showEndConfirmation = false }, title = { Text("End this series?") }, text = { Text("This publishes the ready chapters and marks the story as ended. You can reopen it later.") }, confirmButton = { TextButton(onClick = { showEndConfirmation = false; viewModel.endSeriesAndPublish() }) { Text("End and publish") } }, dismissButton = { TextButton(onClick = { showEndConfirmation = false }) { Text("Keep drafting") } })
    }
}

@Composable
private fun MockCover(story: GeneratedStory, progress: Float) {
    Box(modifier = Modifier.fillMaxWidth().height(300.dp).clip(RoundedCornerShape(KathaTheme.Radius.xl)).background(Brush.linearGradient(story.coverColors)), contentAlignment = Alignment.BottomStart) {
        Box(modifier = Modifier.size(160.dp).align(Alignment.TopEnd).offset(x = 35.dp, y = (-45).dp).clip(CircleShape).background(Color.White.copy(alpha = 0.1f)))
        Icon(story.genre.icon, contentDescription = null, tint = Color.White.copy(alpha = 0.16f), modifier = Modifier.align(Alignment.TopEnd).padding(KathaTheme.Spacing.l).size(58.dp))
        Column(modifier = Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.58f)))).padding(KathaTheme.Spacing.l), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
            Text("MOCK COVER • ${story.genre.displayName.uppercase()}", color = Color.White.copy(alpha = 0.78f), style = KathaTypography.Meta)
            Text(story.title, color = Color.White, style = KathaTypography.Title1, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
                if (progress < 1f) {
                    CircularProgressIndicator(progress = { progress }, color = Color.White, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text("Preparing cover…", color = Color.White, style = KathaTypography.Caption)
                } else {
                    Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                    Text(if (story.coverStatus == CoverGenerationStatus.READY) "Cover ready" else "Cover needs attention", color = Color.White, style = KathaTypography.Caption)
                }
            }
        }
    }
}

@Composable
private fun GenerationProgress(state: KathaUiState) {
    Column(modifier = Modifier.fillMaxSize().padding(KathaTheme.Spacing.l), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = KathaTheme.accent, modifier = Modifier.size(52.dp))
        Spacer(Modifier.height(KathaTheme.Spacing.l))
        Text("Imagining your world…", color = KathaTheme.textPrimary, style = KathaTypography.Title2)
        Text("Katha is drafting your private story.", color = KathaTheme.textSecondary, style = KathaTypography.Body)
    }
}

@Composable
private fun RevisionDialog(state: KathaUiState, viewModel: AppViewModel, onDismiss: () -> Unit) {
    var prompt by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Revise with a prompt") }, text = { Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) { Text("Describe one change. Katha creates a new private version and prepares a matching cover."); OutlinedTextField(value = prompt, onValueChange = { prompt = it.take(500) }, minLines = 4, placeholder = { Text("Make the ending more hopeful…") }) } }, confirmButton = { TextButton(enabled = prompt.isNotBlank() && !state.isRevising && (state.currentUser?.credits ?: 0) > 0, onClick = { viewModel.reviseCurrentStory(prompt); onDismiss() }) { Text("Revise • 1 credit") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

@Composable
private fun DirectEditorDialog(story: GeneratedStory, viewModel: AppViewModel, onDismiss: () -> Unit) {
    var title by remember { mutableStateOf(story.title) }
    var body by remember { mutableStateOf(story.body) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Edit draft") }, text = { Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) { OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, singleLine = true); OutlinedTextField(value = body, onValueChange = { body = it }, label = { Text("Chapter 1") }, minLines = 7) } }, confirmButton = { TextButton(onClick = { viewModel.saveCurrentStoryEdits(title, body); onDismiss() }) { Text("Save") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

@Composable
private fun LanguageDialog(selected: StoryLanguage, onSelect: (StoryLanguage) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Language") }, text = { Column(modifier = Modifier.verticalScroll(rememberScrollState())) { StoryLanguage.entries.forEach { language -> Row(modifier = Modifier.fillMaxWidth().clickable { onSelect(language) }.padding(KathaTheme.Spacing.s), verticalAlignment = Alignment.CenterVertically) { Text(language.flagEmoji); Spacer(Modifier.width(KathaTheme.Spacing.m)); Text(language.displayName, color = KathaTheme.textPrimary, style = KathaTypography.Body, modifier = Modifier.weight(1f)); if (language == selected) Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = KathaTheme.accent) } } } }, confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } })
}

@Composable
private fun ReadingLevelDialog(selected: ReadingLevel, onSelect: (ReadingLevel) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Reading level") }, text = { Column { ReadingLevel.entries.forEach { level -> Row(modifier = Modifier.fillMaxWidth().clickable { onSelect(level) }.padding(KathaTheme.Spacing.s), verticalAlignment = Alignment.CenterVertically) { Column(modifier = Modifier.weight(1f)) { Text(level.title, color = KathaTheme.textPrimary, style = KathaTypography.BodyStrong); Text(level.subtitle, color = KathaTheme.textSecondary, style = KathaTypography.Caption) }; if (level == selected) Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = KathaTheme.accent) } } } }, confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } })
}

@Composable
private fun CreateHeader(modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
        Text("Create", color = KathaTheme.textPrimary, style = KathaTypography.Title1)
        Text("Turn a spark into a story worth returning to.", color = KathaTheme.textSecondary, style = KathaTypography.Body)
    }
}

@Composable
private fun UnauthenticatedCreateState(onSignIn: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(KathaTheme.Spacing.l), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)) {
        CreateHeader(modifier = Modifier.padding(top = KathaTheme.Spacing.s))
        EmptyState(icon = Icons.Outlined.ModeEdit, title = "Start writing", message = "Sign in to create AI-powered stories. You'll get 3 welcome credits to begin.", ctaTitle = "Sign in to start", onCta = onSignIn, modifier = Modifier.padding(top = KathaTheme.Spacing.xxxl))
        SafeBottomSpacer()
    }
}

@Composable
private fun EmptyCreditsState(onGetCredits: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(KathaTheme.Spacing.l), verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)) {
        CreateHeader(modifier = Modifier.padding(top = KathaTheme.Spacing.s))
        EmptyState(icon = Icons.Outlined.CardGiftcard, title = "Out of credits", message = "You've used all your credits. Get more to keep creating stories.", ctaTitle = "Get more credits", onCta = onGetCredits, modifier = Modifier.padding(top = KathaTheme.Spacing.xxxl))
        SafeBottomSpacer()
    }
}

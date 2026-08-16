package com.rork.kathaai.ui.screens

import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.data.StoryStarters
import com.rork.kathaai.model.Genre
import com.rork.kathaai.model.GeneratedStory
import com.rork.kathaai.model.ReadingLevel
import com.rork.kathaai.model.StoryLanguage
import com.rork.kathaai.model.WizardCharacter
import com.rork.kathaai.model.WizardStep
import com.rork.kathaai.ui.components.PrimaryCTA
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.components.SecondaryCTA
import com.rork.kathaai.ui.theme.KathaTheme
import com.rork.kathaai.viewmodel.AppViewModel
import com.rork.kathaai.viewmodel.KathaUiState
import kotlinx.coroutines.delay

private val statusMessages = listOf(
    "Imagining your world...",
    "Sketching characters...",
    "Weaving the plot...",
    "Polishing the prose...",
    "Almost there..."
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WizardScreen(
    state: KathaUiState,
    viewModel: AppViewModel,
    modifier: Modifier = Modifier
) {
    val haptics = LocalHapticFeedback.current
    var showDiscardDialog by remember { mutableStateOf(false) }
    val hasInput = state.wizardTopic.isNotBlank() || state.wizardCharacters.isNotEmpty() || state.wizardGenre != null
    Box(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            WizardHeader(
                step = state.wizardStep,
                onBack = { viewModel.moveToStep(previousStep(state.wizardStep)) },
                onCancel = {
                    if (hasInput) showDiscardDialog = true
                    else { viewModel.resetWizard(); viewModel.requestTab(0) }
                }
            )

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = KathaTheme.Spacing.l,
                    end = KathaTheme.Spacing.l,
                    top = KathaTheme.Spacing.s,
                    bottom = 140.dp
                ),
                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
            ) {
                item {
                    when (state.wizardStep) {
                        WizardStep.GENRE -> GenreStep(
                            selectedGenre = state.wizardGenre,
                            kidsMode = state.kidsMode,
                            readingLevelCap = state.kidsReadingLevelCap,
                            onSelect = { viewModel.setWizardGenre(it) }
                        )

                        WizardStep.TOPIC -> TopicStep(
                            topic = state.wizardTopic,
                            language = state.wizardLanguage,
                            readingLevel = state.wizardReadingLevel,
                            planAsSeries = state.wizardPlanAsSeries,
                            chapterCount = state.wizardSeriesChapterCount,
                            onTopicChange = { viewModel.updateWizardTopic(it) },
                            onShowLanguageSheet = { viewModel.showLanguageSheet() },
                            onShowReadingLevelSheet = { viewModel.showReadingLevelSheet(forWizard = true) },
                            onShowGetIdeasSheet = { viewModel.showGetIdeasSheet() },
                            onPlanAsSeriesChange = { viewModel.updateWizardPlanAsSeries(it) },
                            onChapterCountChange = { viewModel.updateWizardSeriesChapterCount(it) }
                        )

                        WizardStep.CHARACTERS -> CharactersStep(
                            characters = state.wizardCharacters,
                            onAdd = { viewModel.addWizardCharacter() },
                            onRemove = { viewModel.removeWizardCharacter(it) },
                            onUpdate = { viewModel.updateWizardCharacter(it) }
                        )

                        WizardStep.REVIEW -> ReviewStep(
                            state = state
                        )
                    }
                }
            }
        }

        // Bottom action bar
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(KathaTheme.canvas.copy(alpha = 0.95f))
                .navigationBarsPadding()
                .padding(KathaTheme.Spacing.l),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
        ) {
            if (state.wizardStep == WizardStep.REVIEW) {
                PrimaryCTA(
                    title = "Generate Story • 1 credit",
                    icon = Icons.Outlined.AutoAwesome,
                    isLoading = state.isGenerating,
                    enabled = (state.currentUser?.credits ?: 0) > 0 && !state.isGenerating
                ) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    viewModel.generateStory()
                }
            } else {
                val canProceed = when (state.wizardStep) {
                    WizardStep.GENRE -> state.wizardGenre != null
                    else -> true
                }
                PrimaryCTA(
                    title = nextButtonTitle(state.wizardStep),
                    icon = Icons.AutoMirrored.Outlined.ArrowForward,
                    enabled = canProceed
                ) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    goNext(state.wizardStep, viewModel)
                }
            }

            if (state.wizardStep != WizardStep.GENRE) {
                TextButton(
                    onClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.moveToStep(previousStep(state.wizardStep))
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        "Back",
                        color = KathaTheme.textSecondary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        if (state.showLanguageSheet) {
            LanguageSelectorSheet(
                selected = state.wizardLanguage,
                onSelect = {
                    viewModel.updateWizardLanguage(it)
                    viewModel.dismissLanguageSheet()
                },
                onDismiss = { viewModel.dismissLanguageSheet() }
            )
        }

        if (state.showGetIdeasSheet) {
            GetIdeasSheet(
                genre = state.wizardGenre ?: Genre.FICTION,
                onSelect = {
                    viewModel.updateWizardTopic(it)
                    viewModel.dismissGetIdeasSheet()
                },
                onDismiss = { viewModel.dismissGetIdeasSheet() }
            )
        }

        if (showDiscardDialog) {
            AlertDialog(
                onDismissRequest = { showDiscardDialog = false },
                title = { Text("Discard your story idea?") },
                text = { Text("Your genre, topic, and characters will be cleared.") },
                confirmButton = {
                    TextButton(onClick = {
                        showDiscardDialog = false
                        viewModel.resetWizard()
                        viewModel.requestTab(0)
                    }) { Text("Discard", color = KathaTheme.error) }
                },
                dismissButton = {
                    TextButton(onClick = { showDiscardDialog = false }) { Text("Keep editing") }
                }
            )
        }
    }
}

@Composable
private fun WizardHeader(
    step: WizardStep,
    onBack: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    val haptics = LocalHapticFeedback.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(KathaTheme.canvas)
            .padding(horizontal = KathaTheme.Spacing.l)
            .padding(top = KathaTheme.Spacing.s, bottom = KathaTheme.Spacing.m)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (step != WizardStep.GENRE) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clickable {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            onBack()
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
                        contentDescription = "Back",
                        tint = KathaTheme.textPrimary,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "Create a story",
                    color = KathaTheme.textPrimary,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Step ${step.number} of ${WizardStep.entries.size}",
                    color = KathaTheme.textSecondary,
                    fontSize = 13.sp
                )
            }
            TextButton(onClick = onCancel) {
                Text(
                    "Cancel",
                    color = KathaTheme.accent,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = KathaTheme.Spacing.m),
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            WizardStep.entries.forEach {
                val active = it.number <= step.number
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(if (active) KathaTheme.accent else KathaTheme.border)
                )
            }
        }
    }
}

@Composable
private fun GenreStep(
    selectedGenre: Genre?,
    kidsMode: Boolean,
    readingLevelCap: ReadingLevel,
    onSelect: (Genre) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Text(
            "What kind of story do you want to tell?",
            color = KathaTheme.textPrimary,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )
        Text(
            "Choose a genre. We'll shape the tone, setting, and style around your pick.",
            color = KathaTheme.textSecondary,
            fontSize = 14.sp
        )

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m),
            modifier = Modifier.height(1200.dp)
        ) {
            items(Genre.entries.filter { !(kidsMode && it == Genre.EROTICA) && !(kidsMode && readingLevelCap == ReadingLevel.SIMPLE && it == Genre.HORROR) }, key = { it.name }) { genre ->
                GenreGridCard(
                    genre = genre,
                    isSelected = selectedGenre == genre,
                    onClick = { onSelect(genre) }
                )
            }
        }
    }
}

@Composable
private fun GenreGridCard(
    genre: Genre,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val haptics = LocalHapticFeedback.current
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(88.dp)
            .clip(RoundedCornerShape(KathaTheme.Radius.m))
            .background(if (isSelected) KathaTheme.accent else KathaTheme.surface)
            .border(
                width = 1.dp,
                color = if (isSelected) KathaTheme.accent else KathaTheme.border,
                shape = RoundedCornerShape(KathaTheme.Radius.m)
            )
            .clickable {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onClick()
            }
            .padding(KathaTheme.Spacing.m)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = genre.icon,
                    contentDescription = null,
                    tint = if (isSelected) Color.White else KathaTheme.textPrimary,
                    modifier = Modifier.size(22.dp)
                )
                if (isSelected) {
                    Icon(
                        imageVector = Icons.Outlined.Check,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            Text(
                genre.displayName,
                color = if (isSelected) Color.White else KathaTheme.textPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun TopicStep(
    topic: String,
    language: StoryLanguage,
    readingLevel: ReadingLevel,
    planAsSeries: Boolean,
    chapterCount: Int,
    onTopicChange: (String) -> Unit,
    onShowLanguageSheet: () -> Unit,
    onShowReadingLevelSheet: () -> Unit,
    onShowGetIdeasSheet: () -> Unit,
    onPlanAsSeriesChange: (Boolean) -> Unit,
    onChapterCountChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Text(
            "What's your story about?",
            color = KathaTheme.textPrimary,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )
        Text(
            "Describe the premise, setting, or a moment you want to explore. Be as brief or detailed as you like.",
            color = KathaTheme.textSecondary,
            fontSize = 14.sp
        )

        Column(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)) {
            Text(
                "Story idea",
                color = KathaTheme.textSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium
            )
            val placeholderText = remember {
                listOf(
                    "Two rival food truck owners are forced to share a parking spot for the whole summer. Neither will move first. Something has to give.",
                    "The librarian discovers a book that writes itself, and the words are describing her life — in real time. She's on page 47.",
                    "A retired astronaut receives a signal from a colleague who died on a mission 40 years ago. The message is 12 hours old.",
                    "A late-night phone call from a number that doesn't exist. The voice on the other end sounds exactly like your mother — who is standing right next to you.",
                    "The old woman found the wolf at the bottom of the well. It looked up at her with eyes she recognized.",
                    "Two estranged sisters meet to bury their father. Neither can remember why they stopped talking twenty years ago.",
                    "A wedding officiant realizes mid-ceremony that they hate the couple they're marrying. There's an hour left in the ceremony.",
                    "The photograph shows five people. There were only four of you that day."
                ).random()
            }
            OutlinedTextField(
                value = topic,
                onValueChange = onTopicChange,
                placeholder = { Text(placeholderText, color = KathaTheme.textTertiary, fontSize = 15.sp) },
                minLines = 10,
                shape = RoundedCornerShape(KathaTheme.Radius.m),
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
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "${topic.length} / 800",
                color = KathaTheme.textTertiary,
                fontSize = 12.sp
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.clickable { onShowGetIdeasSheet() }
            ) {
                Icon(
                    Icons.Outlined.Lightbulb,
                    contentDescription = null,
                    tint = KathaTheme.accent,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    "Get ideas",
                    color = KathaTheme.accent,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }

        LanguageSelectorRow(
            language = language,
            onClick = onShowLanguageSheet
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(KathaTheme.Radius.m))
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.m),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        "Plan as a series",
                        color = KathaTheme.textPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        "We'll structure this as the first chapter of a multi-chapter story.",
                        color = KathaTheme.textSecondary,
                        fontSize = 13.sp
                    )
                }
                Switch(
                    checked = planAsSeries,
                    onCheckedChange = onPlanAsSeriesChange,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color.White,
                        checkedTrackColor = KathaTheme.accent
                    )
                )
            }

            if (planAsSeries) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Chapters",
                        color = KathaTheme.textSecondary,
                        fontSize = 14.sp
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
                    ) {
                        CounterButton(
                            icon = Icons.Outlined.Remove,
                            onClick = { onChapterCountChange(-1) },
                            enabled = chapterCount > 2
                        )
                        Text(
                            chapterCount.toString(),
                            color = KathaTheme.textPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.width(32.dp),
                            textAlign = TextAlign.Center
                        )
                        CounterButton(
                            icon = Icons.Outlined.Add,
                            onClick = { onChapterCountChange(1) },
                            enabled = chapterCount < 10
                        )
                    }
                }
            }
        }

        Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(KathaTheme.Radius.m)).background(KathaTheme.surface).clickable { onShowReadingLevelSheet() }.padding(KathaTheme.Spacing.m), verticalAlignment = Alignment.CenterVertically) {
            Text("Reading level", color = KathaTheme.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text("${readingLevel.title} ▾", color = KathaTheme.accent, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun LanguageSelectorRow(
    language: StoryLanguage,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(KathaTheme.Radius.m))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.m))
            .clickable { onClick() }
            .padding(KathaTheme.Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Text(language.flagEmoji, fontSize = 22.sp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "Language",
                color = KathaTheme.textSecondary,
                fontSize = 13.sp
            )
            Text(
                language.displayName,
                color = KathaTheme.textPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = KathaTheme.textTertiary,
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun CounterButton(
    icon: ImageVector,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(if (enabled) KathaTheme.surface else KathaTheme.border)
            .alpha(if (enabled) 1f else 0.5f)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, tint = KathaTheme.textPrimary, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun CharactersStep(
    characters: List<WizardCharacter>,
    onAdd: () -> Unit,
    onRemove: (String) -> Unit,
    onUpdate: (WizardCharacter) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "Who is in your story?",
                color = KathaTheme.textPrimary,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                "Optional. Add characters to shape the plot and voice.",
                color = KathaTheme.textSecondary,
                fontSize = 14.sp
            )
        }

        characters.forEach { character ->
            CharacterCard(
                character = character,
                onUpdate = { onUpdate(it) },
                onDelete = { onRemove(character.id) }
            )
        }

        SecondaryCTA(
            title = if (characters.isEmpty()) "Add a character" else "Add another character",
            icon = Icons.Outlined.Add,
            onClick = onAdd
        )
    }
}

@Composable
private fun CharacterCard(
    character: WizardCharacter,
    onUpdate: (WizardCharacter) -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(KathaTheme.Radius.m))
            .background(KathaTheme.surface)
            .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.m))
            .padding(KathaTheme.Spacing.m),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Character",
                color = KathaTheme.textSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium
            )
            IconButton(onClick = onDelete, modifier = Modifier.size(24.dp)) {
                Icon(
                    Icons.Outlined.Delete,
                    contentDescription = "Delete",
                    tint = KathaTheme.error,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        KathaTextField(
            title = "Name",
            value = character.name,
            placeholder = "e.g. Elena",
            onValueChange = { onUpdate(character.copy(name = it)) }
        )
        KathaTextField(
            title = "Role",
            value = character.role,
            placeholder = "e.g. Protagonist",
            onValueChange = { onUpdate(character.copy(role = it)) }
        )
        KathaTextField(
            title = "Description",
            value = character.description,
            placeholder = "Brief personality or backstory...",
            minLines = 3,
            onValueChange = { onUpdate(character.copy(description = it)) }
        )
    }
}

@Composable
private fun KathaTextField(
    title: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    minLines: Int = 1
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            title,
            color = KathaTheme.textSecondary,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium
        )
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = { Text(placeholder) },
            minLines = minLines,
            shape = RoundedCornerShape(KathaTheme.Radius.s),
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
    }
}

@Composable
private fun ReviewStep(
    state: KathaUiState,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
    ) {
        Text(
            "Ready to generate?",
            color = KathaTheme.textPrimary,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )
        Text(
            "Review your choices before Katha crafts your story.",
            color = KathaTheme.textSecondary,
            fontSize = 14.sp
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(KathaTheme.Radius.m))
                .background(KathaTheme.surface)
                .padding(KathaTheme.Spacing.m),
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            ReviewRow(label = "Genre", value = state.wizardGenre?.displayName ?: "—")
            ReviewRow(label = "Language", value = state.wizardLanguage.displayName)
            ReviewRow(
                label = "Series",
                value = if (state.wizardPlanAsSeries) "Yes, ${state.wizardSeriesChapterCount} chapters" else "One-shot"
            )
            ReviewRow(
                label = "Characters",
                value = if (state.wizardCharacters.isEmpty()) "None added" else "${state.wizardCharacters.count()}"
            )
        }

        if (state.wizardTopic.isNotBlank()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.surface)
                    .padding(KathaTheme.Spacing.m),
                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
            ) {
                Text(
                    "Story idea",
                    color = KathaTheme.textSecondary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    state.wizardTopic,
                    color = KathaTheme.textPrimary,
                    fontSize = 15.sp,
                    lineHeight = 22.sp
                )
            }
        }

        state.generationError?.let { error ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.error.copy(alpha = 0.08f))
                    .padding(KathaTheme.Spacing.m),
                horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    tint = KathaTheme.error,
                    modifier = Modifier.size(18.dp)
                )
                Text(
                    error,
                    color = KathaTheme.error,
                    fontSize = 14.sp
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(KathaTheme.Radius.m))
                .background(KathaTheme.accentSoft.copy(alpha = 0.3f))
                .padding(KathaTheme.Spacing.m),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
        ) {
            Icon(
                Icons.Outlined.CardGiftcard,
                contentDescription = null,
                tint = KathaTheme.accent,
                modifier = Modifier.size(18.dp)
            )
            val credits = state.currentUser?.credits ?: 0
            Text(
                "$credits credit${if (credits == 1) "" else "s"} remaining",
                color = KathaTheme.textSecondary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

@Composable
private fun ReviewRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = KathaTheme.textSecondary, fontSize = 14.sp)
        Text(
            value,
            color = KathaTheme.textPrimary,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LanguageSelectorSheet(
    selected: StoryLanguage,
    onSelect: (StoryLanguage) -> Unit,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = KathaTheme.canvas
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KathaTheme.Spacing.l)
                .padding(bottom = KathaTheme.Spacing.xl)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Language",
                    color = KathaTheme.textPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                IconButton(onClick = onDismiss) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = KathaTheme.textSecondary
                    )
                }
            }
            Spacer(Modifier.height(KathaTheme.Spacing.m))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(StoryLanguage.entries.size, key = { StoryLanguage.entries[it].name }) { index ->
                    val language = StoryLanguage.entries[index]
                    val isSelected = language == selected
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.m))
                            .background(if (isSelected) KathaTheme.accentSoft.copy(alpha = 0.3f) else Color.Transparent)
                            .clickable { onSelect(language) }
                            .padding(KathaTheme.Spacing.m),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
                    ) {
                        Text(language.flagEmoji, fontSize = 24.sp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                language.displayName,
                                color = KathaTheme.textPrimary,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                language.nativeName,
                                color = KathaTheme.textSecondary,
                                fontSize = 13.sp
                            )
                        }
                        if (isSelected) {
                            Icon(
                                Icons.Outlined.Check,
                                contentDescription = null,
                                tint = KathaTheme.accent,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GetIdeasSheet(
    genre: Genre,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val starters = StoryStarters.starters[genre] ?: StoryStarters.starters[Genre.FICTION]!!
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = KathaTheme.canvas
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = KathaTheme.Spacing.l)
                .padding(bottom = KathaTheme.Spacing.xl)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Story starters",
                    color = KathaTheme.textPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                IconButton(onClick = onDismiss) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = KathaTheme.textSecondary
                    )
                }
            }
            Text(
                "Tap any idea to use it as your story premise.",
                color = KathaTheme.textSecondary,
                fontSize = 14.sp,
                modifier = Modifier.padding(bottom = KathaTheme.Spacing.l)
            )

            LazyColumn(verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)) {
                items(starters.size, key = { it }) { index ->
                    val starter = starters[index]
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(KathaTheme.Radius.m))
                            .background(KathaTheme.surface)
                            .border(1.dp, KathaTheme.border, RoundedCornerShape(KathaTheme.Radius.m))
                            .clickable { onSelect(starter) }
                            .padding(KathaTheme.Spacing.m)
                    ) {
                        Text(
                            starter,
                            color = KathaTheme.textPrimary,
                            fontSize = 15.sp,
                            lineHeight = 22.sp
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun OutOfCreditsModal(
    onBuy: () -> Unit,
    onDismiss: () -> Unit,
    onWatchAd: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable(onClick = onDismiss)
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
                .padding(horizontal = KathaTheme.Spacing.xl)
                .clip(RoundedCornerShape(KathaTheme.Radius.xl))
                .background(KathaTheme.canvas)
                .padding(KathaTheme.Spacing.xl)
                .clickable(enabled = false) {},
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.l)
        ) {
            Icon(
                Icons.Outlined.CardGiftcard,
                contentDescription = null,
                tint = KathaTheme.accent,
                modifier = Modifier.size(48.dp)
            )
            Text(
                "You're out of credits",
                color = KathaTheme.textPrimary,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                "Get more credits to keep creating stories with Katha.",
                color = KathaTheme.textSecondary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(KathaTheme.Radius.m))
                    .background(KathaTheme.surface)
                    .border(2.dp, KathaTheme.accent, RoundedCornerShape(KathaTheme.Radius.m))
                    .padding(KathaTheme.Spacing.m),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "10 credits",
                    color = KathaTheme.textPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    "$4.99",
                    color = KathaTheme.accent,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            PrimaryCTA(
                title = "Get credits \u25b8",
                onClick = onBuy
            )
            SecondaryCTA(
                title = "Watch an ad for 1 credit",
                onClick = onWatchAd
            )
            SecondaryCTA(
                title = "Maybe later",
                onClick = onDismiss
            )
        }
    }
}

@Composable
fun GenerationScreen(
    state: KathaUiState,
    onOpenStory: () -> Unit,
    modifier: Modifier = Modifier
) {
    var progress by remember { mutableFloatStateOf(0f) }
    var statusIndex by remember { mutableIntStateOf(0) }
    val animatedProgress by animateFloatAsState(
        targetValue = progress,
        animationSpec = tween(1000),
        label = "progress"
    )
    val story = state.lastGeneratedStory

    // Breathing sparkle animations
    val transition = rememberInfiniteTransition(label = "breathing")
    val breatheLarge by transition.animateFloat(
        initialValue = 1f, targetValue = 1.15f,
        animationSpec = infiniteRepeatable(tween(2400), RepeatMode.Reverse),
        label = "large"
    )
    val breatheMedium by transition.animateFloat(
        initialValue = 1f, targetValue = 1.2f,
        animationSpec = infiniteRepeatable(tween(1800), RepeatMode.Reverse, StartOffset(300)),
        label = "medium"
    )
    val breatheSmall by transition.animateFloat(
        initialValue = 1f, targetValue = 1.25f,
        animationSpec = infiniteRepeatable(tween(2100), RepeatMode.Reverse, StartOffset(600)),
        label = "small"
    )
    val glowPulse by transition.animateFloat(
        initialValue = 0.95f, targetValue = 1.05f,
        animationSpec = infiniteRepeatable(tween(3000), RepeatMode.Reverse),
        label = "glow"
    )

    LaunchedEffect(Unit) {
        progress = 0f
        statusIndex = 0
        while (progress < 1f) {
            delay(100)
            progress = (progress + 0.01f).coerceAtMost(1f)
            statusIndex = minOf((progress * statusMessages.size).toInt(), statusMessages.size - 1)
        }
    }

    LaunchedEffect(story?.id) {
        story ?: return@LaunchedEffect
        delay(5000)
        onOpenStory()
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KathaTheme.canvas)
            .padding(KathaTheme.Spacing.l)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier.size(140.dp),
                contentAlignment = Alignment.Center
            ) {
                // Glow
                Box(
                    modifier = Modifier
                        .size(140.dp)
                        .clip(CircleShape)
                        .background(KathaTheme.accentSoft.copy(alpha = 0.3f))
                        .scale(glowPulse)
                )
                // Small sparkle
                Icon(
                    Icons.Outlined.AutoAwesome,
                    contentDescription = null,
                    tint = KathaTheme.accent.copy(alpha = 0.6f),
                    modifier = Modifier.size(14.dp).offset(x = (-22).dp, y = 18.dp).scale(breatheSmall)
                )
                // Medium sparkle
                Icon(
                    Icons.Outlined.AutoAwesome,
                    contentDescription = null,
                    tint = KathaTheme.accent.copy(alpha = 0.8f),
                    modifier = Modifier.size(20.dp).offset(x = 20.dp, y = (-24).dp).scale(breatheMedium)
                )
                // Large sparkle
                Icon(
                    Icons.Outlined.AutoAwesome,
                    contentDescription = null,
                    tint = KathaTheme.accent,
                    modifier = Modifier.size(40.dp).scale(breatheLarge)
                )
            }

            Spacer(Modifier.height(KathaTheme.Spacing.xl))
            Text(
                statusMessages[statusIndex],
                color = KathaTheme.textPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(KathaTheme.Spacing.s))
            Text(
                "This usually takes 10–14 seconds",
                color = KathaTheme.textSecondary,
                fontSize = 14.sp
            )
        }

        // Thin progress line at bottom
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 40.dp),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .width(240.dp)
                    .height(2.dp)
                    .clip(RoundedCornerShape(1.dp))
                    .background(KathaTheme.border)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(animatedProgress)
                        .height(2.dp)
                        .clip(RoundedCornerShape(1.dp))
                        .background(KathaTheme.accent)
                )
            }
        }

        if (story != null) {
            Column(
                modifier = Modifier.align(Alignment.BottomCenter),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.m)
            ) {
                Text(
                    "Your story is ready!",
                    color = KathaTheme.textPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                PrimaryCTA(
                    title = "Read now",
                    icon = Icons.Outlined.MenuBook,
                    onClick = onOpenStory
                )
            }
        }
    }
}

private fun nextButtonTitle(step: WizardStep): String = when (step) {
    WizardStep.GENRE -> "Choose genre"
    WizardStep.TOPIC -> "Add characters"
    WizardStep.CHARACTERS -> "Review story"
    WizardStep.REVIEW -> "Continue"
}

private fun goNext(step: WizardStep, viewModel: AppViewModel) {
    when (step) {
        WizardStep.GENRE -> viewModel.moveToStep(WizardStep.TOPIC)
        WizardStep.TOPIC -> viewModel.moveToStep(WizardStep.CHARACTERS)
        WizardStep.CHARACTERS -> viewModel.moveToStep(WizardStep.REVIEW)
        WizardStep.REVIEW -> {}
    }
}

private fun previousStep(step: WizardStep): WizardStep = when (step) {
    WizardStep.GENRE -> WizardStep.GENRE
    WizardStep.TOPIC -> WizardStep.GENRE
    WizardStep.CHARACTERS -> WizardStep.TOPIC
    WizardStep.REVIEW -> WizardStep.CHARACTERS
}

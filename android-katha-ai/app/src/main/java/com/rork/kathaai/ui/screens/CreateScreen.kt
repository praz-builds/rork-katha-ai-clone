package com.rork.kathaai.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.ModeEdit
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.kathaai.ui.components.EmptyState
import com.rork.kathaai.ui.components.SafeBottomSpacer
import com.rork.kathaai.ui.theme.KathaTheme
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
            state.isGenerating || state.lastGeneratedStory != null -> {
                GenerationScreen(
                    state = state,
                    onOpenStory = {
                        state.lastGeneratedStory?.let { viewModel.openGeneratedStory(it) }
                    }
                )
            }

            !state.isAuthenticated -> UnauthenticatedCreateState(onSignIn = onSignIn)

            (state.currentUser?.credits ?: 0) <= 0 -> EmptyCreditsState(
                onGetCredits = { viewModel.showOutOfCreditsModal() }
            )

            else -> WizardScreen(state = state, viewModel = viewModel)
        }

        if (state.showOutOfCreditsModal) {
            OutOfCreditsModal(
                onBuy = { viewModel.buyCreditsMock() },
                onDismiss = { viewModel.dismissOutOfCreditsModal() }
            )
        }
    }
}

@Composable
private fun CreateHeader(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.s)
    ) {
        Text(
            "Create",
            color = KathaTheme.textPrimary,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold
        )
        Text(
            "Turn your ideas into stories with AI",
            color = KathaTheme.textSecondary,
            fontSize = 14.sp
        )
    }
}

@Composable
private fun UnauthenticatedCreateState(
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)
    ) {
        CreateHeader(modifier = Modifier.padding(top = KathaTheme.Spacing.s))
        EmptyState(
            icon = Icons.Outlined.ModeEdit,
            title = "Start writing",
            message = "Sign in to create AI-powered stories. You'll get 3 welcome credits to begin.",
            ctaTitle = "Sign in to start",
            onCta = onSignIn,
            modifier = Modifier.padding(top = KathaTheme.Spacing.xxxl)
        )
        SafeBottomSpacer()
    }
}

@Composable
private fun EmptyCreditsState(
    onGetCredits: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(KathaTheme.Spacing.l),
        verticalArrangement = Arrangement.spacedBy(KathaTheme.Spacing.xl)
    ) {
        CreateHeader(modifier = Modifier.padding(top = KathaTheme.Spacing.s))
        EmptyState(
            icon = Icons.Outlined.CardGiftcard,
            title = "Out of credits",
            message = "You've used all your credits. Get more to keep creating stories.",
            ctaTitle = "Get more credits",
            onCta = onGetCredits,
            modifier = Modifier.padding(top = KathaTheme.Spacing.xxxl)
        )
        SafeBottomSpacer()
    }
}

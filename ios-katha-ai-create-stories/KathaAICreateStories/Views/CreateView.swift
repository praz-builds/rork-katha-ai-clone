//
//  CreateView.swift
//  KathaAICreateStories
//

import SwiftUI

struct CreateView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if appState.isGenerating || appState.lastGeneratedStory != nil {
                GenerationScreen()
            } else if !appState.isAuthenticated {
                unauthenticatedState
            } else if appState.credits <= 0 {
                emptyCreditsState
            } else {
                WizardView()
            }
        }
        .themedBackground()
    }

    private var unauthenticatedState: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.xl) {
                header
                EmptyState(
                    icon: "pencil.line",
                    title: "Start writing",
                    message: "Sign in to create AI-powered stories. You'll get 3 welcome credits to begin.",
                    ctaTitle: "Sign in to start",
                    ctaAction: { appState.presentAuthSheet(readerWall: false) }
                )
                .padding(.top, KathaTheme.Spacing.xxxl)
                SafeBottomSpacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
        }
        .scrollIndicators(.hidden)
    }

    private var emptyCreditsState: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.xl) {
                header
                EmptyState(
                    icon: "gift",
                    title: "Out of credits",
                    message: "You've used all your credits. Get more to keep creating stories.",
                    ctaTitle: "Get more credits",
                    ctaAction: { appState.showOutOfCreditsModal = true }
                )
                .padding(.top, KathaTheme.Spacing.xxxl)
                SafeBottomSpacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
        }
        .scrollIndicators(.hidden)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            Text("Create")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)
            Text("Turn your ideas into stories with AI")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
        }
        .padding(.top, KathaTheme.Spacing.s)
    }
}

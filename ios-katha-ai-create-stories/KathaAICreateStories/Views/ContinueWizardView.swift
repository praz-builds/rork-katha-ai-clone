//
//  ContinueWizardView.swift
//  KathaAICreateStories
//

import SwiftUI

struct ContinueWizardView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                ContinueWizardHeader()

                ScrollView {
                    VStack(spacing: KathaTheme.Spacing.l) {
                        stepContent
                            .padding(.horizontal, KathaTheme.Spacing.l)
                            .padding(.top, KathaTheme.Spacing.s)

                        SafeBottomSpacer(height: 120)
                    }
                }
                .scrollIndicators(.hidden)
            }
            .themedBackground()

            bottomBar
        }
        .sheet(isPresented: Binding(
            get: { appState.showChapterGetIdeasSheet },
            set: { if !$0 { appState.showChapterGetIdeasSheet = false } }
        )) {
            GetIdeasChapterSheet()
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch appState.continueWizardStep {
        case .direction: ChapterDirectionStep()
        case .review: ChapterReviewStep()
        }
    }

    private var bottomBar: some View {
        VStack {
            Spacer()
            VStack(spacing: KathaTheme.Spacing.m) {
                if appState.continueWizardStep == .review {
                    PrimaryCTA(
                        title: "Generate chapter (1 credit)",
                        icon: "sparkles",
                        isLoading: appState.isGeneratingChapter,
                        action: {
                            Task { await appState.generateChapter() }
                        }
                    )
                    .disabled(appState.credits <= 0 || appState.isGeneratingChapter)

                    Text("You have \(appState.credits) credit\(appState.credits == 1 ? "" : "s")")
                        .font(.system(size: 12))
                        .foregroundStyle(KathaTheme.textSecondary)
                } else {
                    PrimaryCTA(
                        title: "Next",
                        icon: "arrow.right",
                        action: {
                            Haptics.light()
                            appState.moveContinueWizardToStep(.review)
                        }
                    )
                }

                Button(appState.continueWizardStep == .direction ? "Cancel" : "Back") {
                    Haptics.light()
                    if appState.continueWizardStep == .direction {
                        if !appState.continueWizardDirection.isEmpty {
                            appState.showDiscardChapterModal = true
                        } else {
                            appState.resetContinueWizard()
                        }
                    } else {
                        appState.moveContinueWizardToStep(.direction)
                    }
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(KathaTheme.textSecondary)
            }
            .padding(KathaTheme.Spacing.l)
            .background(
                Rectangle()
                    .fill(KathaTheme.canvas.opacity(0.95))
                    .background(.ultraThinMaterial)
                    .ignoresSafeArea(edges: .bottom)
            )
        }
    }
}

// MARK: - Header

struct ContinueWizardHeader: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Continue story")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("Step \(appState.continueWizardStep.number) of \(ContinueWizardStep.allCases.count)")
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                Spacer()

                // Locked language chip
                HStack(spacing: 4) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 11))
                    Text(appState.continueWizardLanguage.code)
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(KathaTheme.textTertiary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(KathaTheme.surface))
                .overlay(Capsule().stroke(KathaTheme.border, lineWidth: 1))
            }

            HStack(spacing: KathaTheme.Spacing.s) {
                ForEach(ContinueWizardStep.allCases, id: \.self) { step in
                    let isActive = step.rawValue <= appState.continueWizardStep.rawValue
                    RoundedRectangle(cornerRadius: 2)
                        .fill(isActive ? KathaTheme.accent : KathaTheme.border)
                        .frame(height: 4)
                }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.s)
        .padding(.bottom, KathaTheme.Spacing.m)
        .background(KathaTheme.canvas)
    }
}

// MARK: - Step 1: Direction

struct ChapterDirectionStep: View {
    @Environment(AppState.self) private var appState
    @State private var placeholder: String = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        @Bindable var appState = appState
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            Text("What happens next?")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text("A hint, a theme, a scene — or leave it open.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)

            // Recap card
            RecapCard(
                storyId: appState.continueWizardStoryId ?? "",
                chapterNumber: appState.continueWizardChapterNumber - 1
            )

            // Direction input
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                Text("Chapter direction (optional)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(KathaTheme.textSecondary)

                ZStack(alignment: .topLeading) {
                    if appState.continueWizardDirection.isEmpty {
                        Text(placeholder)
                            .font(.system(size: 15))
                            .foregroundStyle(KathaTheme.textTertiary)
                            .padding(KathaTheme.Spacing.m)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $appState.continueWizardDirection)
                        .font(.system(size: 15))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .frame(minHeight: 120)
                        .padding(KathaTheme.Spacing.m)
                        .focused($isFocused)
                        .onChange(of: appState.continueWizardDirection) { _, newValue in
                            if newValue.count > 500 {
                                appState.continueWizardDirection = String(newValue.prefix(500))
                            }
                        }
                }
                .background(KathaTheme.canvas)
                .overlay(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.m))
            }

            HStack {
                Text("\(appState.continueWizardDirection.count) / 500")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textTertiary)
                Spacer()
                Button {
                    Haptics.light()
                    appState.showChapterGetIdeasSheet = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "lightbulb")
                        Text("Get ideas")
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(KathaTheme.accent)
                }
            }
        }
        .onAppear {
            placeholder = DirectionPlaceholders.random()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isFocused = true
            }
        }
    }
}

// MARK: - Recap Card

struct RecapCard: View {
    let storyId: String
    let chapterNumber: Int

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            Text("PREVIOUSLY")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(KathaTheme.textTertiary)
                .tracking(0.5)

            Text(recapText)
                .font(KathaFont.serifItalic(15))
                .foregroundStyle(KathaTheme.textSecondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(KathaTheme.Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(KathaTheme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(KathaTheme.border, lineWidth: 1)
        )
    }

    private var recapText: String {
        // Get last 2-3 sentences of previous chapter
        if let story = SeedData.stories.first(where: { $0.id == storyId }) {
            let chapter = story.chapters.last
            let fullText = chapter?.paragraphs.joined(separator: " ") ?? ""
            let sentences = fullText.components(separatedBy: ". ")
            let recap = sentences.suffix(3).joined(separator: ". ")
            return recap.isEmpty ? fullText : recap + "."
        }
        return "The story so far..."
    }
}

// MARK: - Step 2: Review

struct ChapterReviewStep: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            Text("Ready to spin Chapter \(appState.continueWizardChapterNumber)?")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text("We'll keep the voice, characters, and world consistent.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)

            // Summary card
            VStack(spacing: KathaTheme.Spacing.l) {
                // Chapter label
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.xs) {
                    Text("CHAPTER \(appState.continueWizardChapterNumber) OF \(appState.continueWizardStoryTitle)")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(KathaTheme.textTertiary)
                    Text(appState.continueWizardStoryTitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.accent)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Divider().overlay(KathaTheme.border)

                // Genre
                HStack {
                    Text("Genre")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)
                    Spacer()
                    Text(appState.continueWizardGenre?.displayName ?? "—")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(KathaTheme.border.opacity(0.3)))
                }

                Divider().overlay(KathaTheme.border)

                // Language
                HStack {
                    Text("Language")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)
                    Spacer()
                    HStack(spacing: 4) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 10))
                        Text(appState.continueWizardLanguage.displayName)
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(KathaTheme.textPrimary)
                }

                Divider().overlay(KathaTheme.border)

                // Direction
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Direction")
                            .font(.system(size: 14))
                            .foregroundStyle(KathaTheme.textSecondary)
                        if appState.continueWizardDirection.isEmpty {
                            Text("Surprise me — let the AI decide")
                                .font(.system(size: 14))
                                .italic()
                                .foregroundStyle(KathaTheme.textSecondary)
                        } else {
                            Text(appState.continueWizardDirection)
                                .font(.system(size: 14))
                                .foregroundStyle(KathaTheme.textPrimary)
                                .lineLimit(3)
                        }
                    }
                    Spacer()
                    Button("Change") {
                        Haptics.light()
                        appState.moveContinueWizardToStep(.direction)
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(KathaTheme.accent)
                }
            }
            .padding(KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(KathaTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(KathaTheme.border, lineWidth: 1)
            )

            // Series awareness note
            if let planned = appState.continueWizardPlannedChapterCount {
                let remaining = planned - appState.continueWizardChapterNumber
                VStack(spacing: 2) {
                    Text("Chapter \(appState.continueWizardChapterNumber) of \(planned) planned. \(max(0, remaining)) more after this one.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(KathaTheme.Spacing.m)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(KathaTheme.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
            }

            if let error = appState.chapterGenerationError {
                HStack(spacing: KathaTheme.Spacing.s) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(KathaTheme.error)
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.error)
                }
                .padding(KathaTheme.Spacing.m)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                        .fill(KathaTheme.error.opacity(0.08))
                )
            }
        }
    }
}

// MARK: - Get Ideas Chapter Sheet

struct GetIdeasChapterSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
                    Text("Chapter starters")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)

                    Text("Tap any to use it as your direction.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)

                    let genre = appState.continueWizardGenre ?? .fiction
                    let starters = ChapterStarters.starters(
                        for: genre,
                        chapterNumber: appState.continueWizardChapterNumber,
                        plannedTotal: appState.continueWizardPlannedChapterCount
                    )

                    ForEach(starters, id: \.self) { starter in
                        Button {
                            Haptics.light()
                            appState.continueWizardDirection = starter
                            appState.showChapterGetIdeasSheet = false
                        } label: {
                            Text(starter)
                                .font(.system(size: 15))
                                .foregroundStyle(KathaTheme.textPrimary)
                                .multilineTextAlignment(.leading)
                                .padding(KathaTheme.Spacing.m)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                                        .fill(KathaTheme.surface)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                                        .stroke(KathaTheme.border, lineWidth: 1)
                                )
                        }
                        .buttonStyle(PressScaleStyle())
                    }
                }
                .padding(KathaTheme.Spacing.l)
            }
            .themedBackground()
            .navigationTitle("Get ideas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        appState.showChapterGetIdeasSheet = false
                    }
                }
            }
        }
    }
}

// MARK: - Discard Chapter Modal

struct DiscardChapterModal: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { appState.showDiscardChapterModal = false }

            VStack(spacing: KathaTheme.Spacing.l) {
                Image(systemName: "trash")
                    .font(.system(size: 40))
                    .foregroundStyle(KathaTheme.error)

                Text("Discard this chapter draft?")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)

                Text("You'll lose what you've typed and return to the story.")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: KathaTheme.Spacing.s) {
                    DestructiveCTA(title: "Discard draft") {
                        Haptics.light()
                        appState.showDiscardChapterModal = false
                        appState.resetContinueWizard()
                    }

                    SecondaryCTA(title: "Keep editing") {
                        Haptics.light()
                        appState.showDiscardChapterModal = false
                    }
                }
            }
            .padding(KathaTheme.Spacing.xl)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.xl)
                    .fill(KathaTheme.canvas)
            )
            .padding(.horizontal, KathaTheme.Spacing.xl)
        }
    }
}

// MARK: - Publish Confirmation Modal

struct PublishConfirmationModal: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { appState.cancelPublishModal() }

            VStack(spacing: KathaTheme.Spacing.l) {
                // Icon
                ZStack {
                    Circle()
                        .fill(KathaTheme.accentSoft)
                        .frame(width: 72, height: 72)
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(KathaTheme.accent)
                }

                Text("Publish Chapter \(appState.continueWizardChapterNumber)?")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)

                if appState.continueWizardFollowerCount > 0 {
                    Text("**\(appState.continueWizardFollowerCount)** followers will be notified this chapter is live.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .multilineTextAlignment(.center)
                } else {
                    Text("This chapter will be visible to everyone on Katha.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }

                Text("Published chapters can't be edited in the current version.")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textTertiary)
                    .multilineTextAlignment(.center)

                VStack(spacing: KathaTheme.Spacing.s) {
                    PrimaryCTA(
                        title: "Publish now",
                        isLoading: appState.isPublishing
                    ) {
                        appState.confirmPublishChapter()
                    }

                    SecondaryCTA(title: "Keep as draft") {
                        Haptics.light()
                        appState.cancelPublishModal()
                    }
                }
            }
            .padding(KathaTheme.Spacing.xl)
            .frame(maxWidth: 340)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(KathaTheme.surface)
            )
            .padding(.horizontal, KathaTheme.Spacing.xl)
        }
        .transition(.opacity)
    }
}

// MARK: - Delete Draft Modal

struct DeleteDraftModal: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { appState.cancelDeleteDraftModal() }

            VStack(spacing: KathaTheme.Spacing.l) {
                ZStack {
                    Circle()
                        .fill(KathaTheme.error.opacity(0.12))
                        .frame(width: 72, height: 72)
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(KathaTheme.error)
                }

                Text("Delete this draft?")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)

                Text("This can't be undone. Your credit was already spent.")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: KathaTheme.Spacing.s) {
                    DestructiveCTA(
                        title: "Delete draft",
                        isLoading: appState.isDeleting
                    ) {
                        appState.confirmDeleteDraft()
                    }

                    SecondaryCTA(title: "Keep draft") {
                        Haptics.light()
                        appState.cancelDeleteDraftModal()
                    }
                }
            }
            .padding(KathaTheme.Spacing.xl)
            .frame(maxWidth: 340)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(KathaTheme.surface)
            )
            .padding(.horizontal, KathaTheme.Spacing.xl)
        }
    }
}

// MARK: - Unfollow Story Modal

struct UnfollowStoryModal: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { appState.cancelUnfollowStory() }

            VStack(spacing: KathaTheme.Spacing.l) {
                Image(systemName: "bell.slash")
                    .font(.system(size: 36))
                    .foregroundStyle(KathaTheme.textTertiary)

                Text("Stop following?")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)

                Text("Stop following \"\(appState.pendingUnfollowStoryTitle)\"? You won't be notified of new chapters.")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: KathaTheme.Spacing.s) {
                    DestructiveCTA(title: "Stop following") {
                        appState.confirmUnfollowStory()
                    }

                    SecondaryCTA(title: "Keep following") {
                        Haptics.light()
                        appState.cancelUnfollowStory()
                    }
                }
            }
            .padding(KathaTheme.Spacing.xl)
            .frame(maxWidth: 340)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(KathaTheme.surface)
            )
            .padding(.horizontal, KathaTheme.Spacing.xl)
        }
    }
}

// MARK: - Chapter Generation Screen

struct ChapterGenerationScreen: View {
    @Environment(AppState.self) private var appState
    @State private var progress: CGFloat = 0
    @State private var statusIndex = 0
    @State private var autoOpenTimer: Timer?

    private let statuses = [
        "Picking up where we left off…",
        "Maintaining voice and tone…",
        "Weaving the next thread…",
        "Painting the chapter cover…",
        "Almost there…"
    ]

    var body: some View {
        ZStack {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: KathaTheme.Spacing.xl) {
                Spacer()

                ZStack {
                    Circle()
                        .stroke(KathaTheme.border, lineWidth: 6)
                        .frame(width: 140, height: 140)

                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(KathaTheme.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .frame(width: 140, height: 140)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeInOut(duration: 1), value: progress)

                    Image(systemName: "sparkles")
                        .font(.system(size: 44))
                        .foregroundStyle(KathaTheme.accent)
                }

                Text(statuses[statusIndex])
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .animation(.easeInOut, value: statusIndex)

                Text("This usually takes 10–14 seconds")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)

                Spacer()

                if appState.lastGeneratedChapter != nil {
                    VStack(spacing: KathaTheme.Spacing.m) {
                        Text("Chapter \(appState.continueWizardChapterNumber) is ready!")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(KathaTheme.textPrimary)

                        PrimaryCTA(title: "Preview chapter", icon: "book.open") {
                            appState.openGeneratedChapterPreview()
                        }

                        SecondaryCTA(title: "Publish now") {
                            Haptics.light()
                            if let chapter = appState.lastGeneratedChapter,
                               let storyId = appState.continueWizardStoryId {
                                appState.requestPublishChapter(storyId: storyId, chapterId: chapter.id)
                            }
                        }

                        Button("Save as draft") {
                            Haptics.light()
                            appState.resetContinueWizard()
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(KathaTheme.textSecondary)
                    }
                    .padding(.bottom, KathaTheme.Spacing.xl)
                }
            }
            .padding(KathaTheme.Spacing.l)
        }
        .onAppear {
            startProgressAnimation()
        }
        .onDisappear {
            autoOpenTimer?.invalidate()
        }
        .onChange(of: appState.lastGeneratedChapter) { _, newValue in
            if newValue != nil {
                autoOpenTimer = Timer.scheduledTimer(withTimeInterval: 6.0, repeats: false) { _ in
                    if appState.lastGeneratedChapter != nil {
                        appState.openGeneratedChapterPreview()
                    }
                }
            }
        }
    }

    private func startProgressAnimation() {
        progress = 0
        statusIndex = 0
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            progress += 0.01
            statusIndex = min(Int(progress * Double(statuses.count)), statuses.count - 1)
            if progress >= 1 {
                timer.invalidate()
            }
        }
    }
}

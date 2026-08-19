//
//  CreateView.swift
//  KathaAICreateStories
//

import SwiftUI

struct CreateView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if !appState.isAuthenticated {
                unauthenticatedState
            } else if appState.credits <= 0 && appState.lastGeneratedStory == nil {
                emptyCreditsState
            } else if appState.isGenerating || appState.lastGeneratedStory != nil {
                AuthorWorkspace()
            } else {
                PromptFirstComposer()
            }
        }
        .themedBackground()
    }

    private var unauthenticatedState: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.xl) {
                createHeader
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
                createHeader
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

    private var createHeader: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            Text("Create")
                .font(KathaFont.Title1)
                .foregroundStyle(KathaTheme.textPrimary)
            Text("Turn a spark into a story worth returning to.")
                .font(KathaFont.Body)
                .foregroundStyle(KathaTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, KathaTheme.Spacing.s)
    }
}

// MARK: - Prompt-first composer

private struct PromptFirstComposer: View {
    @Environment(AppState.self) private var appState
    @FocusState private var promptFocused: Bool
    @State private var showDiscard = false

    private let placeholder = "A retired astronaut receives a signal from a colleague who died on a mission 40 years ago..."

    var body: some View {
        @Bindable var appState = appState
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.lg) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.xs) {
                            Text("Create a story")
                                .font(KathaFont.Title1)
                                .foregroundStyle(KathaTheme.textPrimary)
                            Text("Start with the feeling, conflict, or moment you can't stop thinking about.")
                                .font(KathaFont.Body)
                                .foregroundStyle(KathaTheme.textSecondary)
                        }
                        Spacer()
                        Button {
                            if appState.isWizardDirty { showDiscard = true } else { appState.requestedTab = 0 }
                        } label: {
                            Text("Cancel")
                                .font(KathaFont.BodyStrong)
                                .foregroundStyle(KathaTheme.accent)
                                .frame(minWidth: 64, minHeight: 44)
                        }
                    }

                    genreStrip

                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                        HStack {
                            Text("Your story idea")
                                .font(KathaFont.BodyStrong)
                                .foregroundStyle(KathaTheme.textPrimary)
                            Spacer()
                            Text("\(appState.wizardTopic.count) / 1600")
                                .font(KathaFont.Meta)
                                .foregroundStyle(KathaTheme.textTertiary)
                        }

                        ZStack(alignment: .topLeading) {
                            if appState.wizardTopic.isEmpty {
                                Text(placeholder)
                                    .font(KathaFont.Body)
                                    .foregroundStyle(KathaTheme.textTertiary)
                                    .padding(KathaTheme.Spacing.md)
                                    .allowsHitTesting(false)
                            }
                            TextEditor(text: Binding(
                                get: { appState.wizardTopic },
                                set: { appState.updateCreationTopic($0) }
                            ))
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textPrimary)
                            .focused($promptFocused)
                            .frame(minHeight: 280)
                            .padding(KathaTheme.Spacing.s)
                            .scrollContentBackground(.hidden)

                            Button {
                                Haptics.light()
                                appState.setCreationFullScreen(true)
                            } label: {
                                Image(systemName: "arrow.up.left.and.arrow.down.right")
                                    .font(KathaFont.BodyStrong)
                                    .foregroundStyle(KathaTheme.textSecondary)
                                    .frame(width: 44, height: 44)
                                    .background(.thinMaterial)
                                    .clipShape(Circle())
                            }
                            .accessibilityLabel("Expand story idea editor")
                            .padding(KathaTheme.Spacing.s)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        }
                        .background(KathaTheme.canvas)
                        .overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.l).stroke(promptFocused ? KathaTheme.accent : KathaTheme.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.l))

                        HStack {
                            Text("More detail gives Katha more to work with. You can change it after generation.")
                                .font(KathaFont.Caption)
                                .foregroundStyle(KathaTheme.textTertiary)
                            Spacer()
                            Button {
                                appState.showGetIdeasSheet = true
                            } label: {
                                Label("Ideas", systemImage: "lightbulb")
                                    .font(KathaFont.Caption)
                                    .foregroundStyle(KathaTheme.accent)
                            }
                        }
                    }

                    settingsCard
                    SafeBottomSpacer(height: 132)
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.top, KathaTheme.Spacing.s)
            }
            .scrollIndicators(.hidden)

            VStack(spacing: KathaTheme.Spacing.s) {
                if let error = appState.creationError ?? appState.generationError {
                    Text(error)
                        .font(KathaFont.Caption)
                        .foregroundStyle(KathaTheme.error)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                PrimaryCTA(
                    title: "Generate privately • 1 credit",
                    icon: "sparkles",
                    isLoading: appState.isGenerating
                ) {
                    guard appState.wizardGenre != nil else {
                        appState.creationError = "Choose a genre first."
                        return
                    }
                    guard appState.wizardTopic.trimmingCharacters(in: .whitespacesAndNewlines).count >= 8 else {
                        appState.creationError = "Add a little more to your story idea so Katha has a clear direction."
                        return
                    }
                    Task { await appState.generateStory() }
                }
                .disabled(appState.isGenerating || appState.wizardGenre == nil || appState.wizardTopic.trimmingCharacters(in: .whitespacesAndNewlines).count < 8)
                Text("Your story stays private until you publish it.")
                    .font(KathaFont.Meta)
                    .foregroundStyle(KathaTheme.textSecondary)
            }
            .padding(KathaTheme.Spacing.l)
            .background(KathaTheme.canvas.opacity(0.96))
        }
        .sheet(isPresented: Binding(get: { appState.showFullScreenPrompt }, set: { appState.showFullScreenPrompt = $0 })) {
            FullScreenPromptEditor()
        }
        .sheet(isPresented: Binding(get: { appState.showLanguageSheet }, set: { appState.showLanguageSheet = $0 })) {
            LanguageSelectorSheet()
        }
        .sheet(isPresented: Binding(get: { appState.showGetIdeasSheet }, set: { appState.showGetIdeasSheet = $0 })) {
            GetIdeasSheet()
        }
        .sheet(isPresented: $showDiscard) {
            DiscardWizardModal(onDiscard: {
                showDiscard = false
                appState.resetWizard()
                appState.requestedTab = 0
            }, onKeep: { showDiscard = false })
        }
    }

    private var genreStrip: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            Text("Choose a tone")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textPrimary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: KathaTheme.Spacing.s) {
                    ForEach(Genre.allCases.filter { !appState.kidsMode || $0 != .erotica }) { genre in
                        Button {
                            appState.setWizardGenre(genre)
                        } label: {
                            HStack(spacing: KathaTheme.Spacing.xs) {
                                Image(systemName: genre.icon)
                                Text(genre.displayName)
                            }
                            .font(KathaFont.Caption)
                            .foregroundStyle(appState.wizardGenre == genre ? Color.white : KathaTheme.textPrimary)
                            .padding(.horizontal, KathaTheme.Spacing.mdLg)
                            .frame(minHeight: 40)
                            .background(Capsule().fill(appState.wizardGenre == genre ? Color.black : KathaTheme.surface))
                            .overlay(Capsule().stroke(appState.wizardGenre == genre ? Color.black : KathaTheme.borderStrong, lineWidth: 1))
                        }
                    }
                }
            }
        }
    }

    private var settingsCard: some View {
        @Bindable var appState = appState
        return VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("Story settings")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textPrimary)
            Button {
                appState.showLanguageSheet = true
            } label: {
                HStack(spacing: KathaTheme.Spacing.m) {
                    Text(appState.wizardLanguage.flagEmoji).font(.system(size: 22))
                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.xs) {
                        Text("Language").font(KathaFont.Caption).foregroundStyle(KathaTheme.textSecondary)
                        Text(appState.wizardLanguage.displayName).font(KathaFont.BodyStrong).foregroundStyle(KathaTheme.textPrimary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(KathaTheme.textTertiary)
                }
            }
            .buttonStyle(.plain)

            Toggle(isOn: $appState.wizardPlanAsSeries) {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.xs) {
                    Text("Plan as a series").font(KathaFont.BodyStrong).foregroundStyle(KathaTheme.textPrimary)
                    Text("Build one chapter at a time, then choose when to end it.").font(KathaFont.Caption).foregroundStyle(KathaTheme.textSecondary)
                }
            }
            .tint(KathaTheme.accent)

            if appState.wizardPlanAsSeries {
                HStack {
                    Text("Target chapters").font(KathaFont.Body).foregroundStyle(KathaTheme.textSecondary)
                    Spacer()
                    Stepper(value: $appState.wizardSeriesChapterCount, in: 2...10) {
                        Text("\(appState.wizardSeriesChapterCount)").font(KathaFont.BodyStrong).foregroundStyle(KathaTheme.textPrimary)
                    }
                    .labelsHidden()
                }
            }

            Button {
                appState.openReadingLevelSheet(forWizard: true)
            } label: {
                HStack {
                    Text("Reading level").font(KathaFont.BodyStrong).foregroundStyle(KathaTheme.textPrimary)
                    Spacer()
                    Text(appState.wizardReadingLevel.title).font(KathaFont.BodyStrong).foregroundStyle(KathaTheme.accent)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(KathaTheme.Spacing.md)
        .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.l).fill(KathaTheme.surface))
        .overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.l).stroke(KathaTheme.border, lineWidth: 1))
    }
}

private struct FullScreenPromptEditor: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var appState = appState
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                TextEditor(text: Binding(get: { appState.wizardTopic }, set: { appState.updateCreationTopic($0) }))
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.textPrimary)
                    .focused($focused)
                    .padding(KathaTheme.Spacing.m)
                    .scrollContentBackground(.hidden)
                    .background(KathaTheme.canvas)
                Text("\(appState.wizardTopic.count) / 1600")
                    .font(KathaFont.Meta)
                    .foregroundStyle(KathaTheme.textTertiary)
                    .padding(KathaTheme.Spacing.l)
            }
            .navigationTitle("Your story idea")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        appState.setCreationFullScreen(false)
                        dismiss()
                    }
                    .font(KathaFont.BodyStrong)
                }
            }
        }
        .onAppear { focused = true }
    }
}

// MARK: - Private author workspace

private struct AuthorWorkspace: View {
    @Environment(AppState.self) private var appState
    @State private var showRevision = false
    @State private var showEditor = false
    @State private var showEndConfirmation = false

    var body: some View {
        guard let story = appState.lastGeneratedStory else {
            return AnyView(PromptFirstComposer())
        }
        return AnyView(
            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.lg) {
                    HStack {
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.xs) {
                            Text(story.isPublished ? "Your published story" : "Your private draft")
                                .font(KathaFont.Title1)
                                .foregroundStyle(KathaTheme.textPrimary)
                            Text(story.isSeriesEnded ? "Series ended" : (story.isSeries ? "Series in progress" : "One-shot story"))
                                .font(KathaFont.Caption)
                                .foregroundStyle(KathaTheme.textSecondary)
                        }
                        Spacer()
                        Text(story.isPublished ? "PUBLISHED" : "DRAFT")
                            .font(KathaFont.Meta)
                            .foregroundStyle(story.isPublished ? KathaTheme.success : KathaTheme.accent)
                            .padding(.horizontal, KathaTheme.Spacing.s)
                            .padding(.vertical, KathaTheme.Spacing.xs)
                            .background(Capsule().fill(story.isPublished ? KathaTheme.success.opacity(0.12) : KathaTheme.accentSoft))
                    }

                    AuthorCoverPreview(story: story, progress: appState.creationCoverProgress)

                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                        Text(story.title)
                            .font(KathaFont.Title1)
                            .foregroundStyle(KathaTheme.textPrimary)
                        Text(story.synopsis)
                            .font(KathaFont.Body)
                            .foregroundStyle(KathaTheme.textSecondary)
                        HStack(spacing: KathaTheme.Spacing.m) {
                            Label("\(story.wordCount) words", systemImage: "text.alignleft")
                            Label("\(story.readingTime) min", systemImage: "clock")
                            Label("v\(story.contentVersion)", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .font(KathaFont.Meta)
                        .foregroundStyle(KathaTheme.textTertiary)
                    }

                    if let error = appState.creationError {
                        Text(error)
                            .font(KathaFont.Caption)
                            .foregroundStyle(KathaTheme.error)
                            .padding(KathaTheme.Spacing.m)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(KathaTheme.error.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.m))
                    }

                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                        Text(story.isPublished ? "Keep shaping it" : "Make it yours")
                            .font(KathaFont.Title2)
                            .foregroundStyle(KathaTheme.textPrimary)
                        SecondaryCTA(title: "Revise with a prompt", icon: "sparkles") { showRevision = true }
                        SecondaryCTA(title: "Edit text directly", icon: "square.and.pencil") { showEditor = true }
                    }

                    if story.isSeries {
                        seriesActions(story: story)
                    } else if !story.isPublished {
                        PrimaryCTA(title: "Publish story", icon: "paperplane") {
                            appState.publishCurrentStory()
                        }
                        .disabled(appState.creationPhase != .draftReady)
                    }

                    if story.isPublished {
                        SecondaryCTA(title: "Create another story", icon: "plus") {
                            appState.resetWizard()
                        }
                    }
                    SafeBottomSpacer()
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.top, KathaTheme.Spacing.s)
            }
            .scrollIndicators(.hidden)
            .sheet(isPresented: $showRevision) { RevisionSheet() }
            .sheet(isPresented: $showEditor) { DirectStoryEditor(story: story) }
            .confirmationDialog("End this series?", isPresented: $showEndConfirmation, titleVisibility: .visible) {
                Button("End and publish all chapters") { appState.endSeriesAndPublish() }
                Button("Keep drafting", role: .cancel) { }
            } message: {
                Text("This will publish the ready chapters and mark the current story as ended. You can still reopen it later.")
            }
        )
    }

    @ViewBuilder
    private func seriesActions(story: GeneratedStory) -> some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            Text("Series actions")
                .font(KathaFont.Title2)
                .foregroundStyle(KathaTheme.textPrimary)
            if !story.isPublished {
                PrimaryCTA(title: "Publish Chapter 1", icon: "paperplane") { appState.publishCurrentStory() }
                    .disabled(appState.creationPhase != .draftReady)
            }
            SecondaryCTA(title: "Continue to the next chapter", icon: "arrow.right") {
                appState.startContinueWizard(story: story.asStory)
            }
            if story.chapterCount >= 2 && !story.isSeriesEnded {
                DestructiveCTA(title: "End series", icon: "flag") { showEndConfirmation = true }
            } else if story.isSeriesEnded {
                Text("Ended stories stay editable. Continue can reopen the series with a new draft chapter.")
                    .font(KathaFont.Caption)
                    .foregroundStyle(KathaTheme.textSecondary)
            }
        }
    }
}

private struct AuthorCoverPreview: View {
    let story: GeneratedStory
    let progress: Double

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: story.coverColors, startPoint: .topLeading, endPoint: .bottomTrailing)
            Circle()
                .fill(.white.opacity(0.10))
                .frame(width: 150, height: 150)
                .offset(x: 130, y: -60)
            Circle()
                .stroke(.white.opacity(0.18), lineWidth: 1)
                .frame(width: 190, height: 190)
                .offset(x: -70, y: 90)
            Image(systemName: story.genre.icon)
                .font(.system(size: 62, weight: .ultraLight))
                .foregroundStyle(.white.opacity(0.16))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(KathaTheme.Spacing.l)
            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                Text("MOCK COVER • \(story.genre.displayName.uppercased())")
                    .font(KathaFont.Meta)
                    .tracking(1)
                    .foregroundStyle(.white.opacity(0.76))
                Text(story.title)
                    .font(KathaFont.literata(size: 25, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(3)
                HStack(spacing: KathaTheme.Spacing.s) {
                    if progress < 1 {
                        ProgressView(value: progress)
                            .tint(.white)
                            .frame(width: 90)
                        Text("Preparing cover…")
                    } else {
                        Image(systemName: "checkmark.circle.fill")
                        Text(story.coverStatus == .ready ? "Cover ready" : "Cover needs attention")
                    }
                }
                .font(KathaFont.Caption)
                .foregroundStyle(.white.opacity(0.9))
            }
            .padding(KathaTheme.Spacing.l)
        }
        .frame(height: 300)
        .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.xl))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Portrait mock cover for \(story.title). \(progress < 1 ? "Cover is being prepared" : "Cover is ready")")
    }
}

private struct RevisionSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var prompt = ""

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            Text("Revise with a prompt")
                .font(KathaFont.Title1)
                .foregroundStyle(KathaTheme.textPrimary)
            Text("Describe one change. Katha creates a new private version and prepares a matching cover.")
                .font(KathaFont.Body)
                .foregroundStyle(KathaTheme.textSecondary)
            TextEditor(text: $prompt)
                .font(KathaFont.Body)
                .foregroundStyle(KathaTheme.textPrimary)
                .frame(minHeight: 150)
                .padding(KathaTheme.Spacing.s)
                .background(KathaTheme.canvas)
                .overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).stroke(KathaTheme.border, lineWidth: 1))
                .scrollContentBackground(.hidden)
            Text("Example: make the ending more hopeful")
                .font(KathaFont.Caption)
                .foregroundStyle(KathaTheme.textTertiary)
            PrimaryCTA(title: "Create private revision • 1 credit", icon: "sparkles", isLoading: appState.isRevising) {
                Task {
                    await appState.reviseCurrentStory(with: prompt)
                    dismiss()
                }
            }
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || appState.isRevising || appState.credits <= 0)
        }
        .padding(KathaTheme.Spacing.l)
        .presentationDetents([.medium])
    }
}

private struct DirectStoryEditor: View {
    @Environment(\.dismiss) private var dismiss
    let story: GeneratedStory
    @Environment(AppState.self) private var appState
    @State private var title: String
    @State private var chapterBody: String

    init(story: GeneratedStory) {
        self.story = story
        _title = State(initialValue: story.title)
        _chapterBody = State(initialValue: story.body)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
                    KathaTextField(title: "Title", text: $title, placeholder: "Story title")
                    KathaTextEditor(title: "Chapter 1", text: $chapterBody, placeholder: "Write your chapter…")
                    Text("Manual edits create a new private content version. The current cover will be refreshed before publishing.")
                        .font(KathaFont.Caption)
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                .padding(KathaTheme.Spacing.l)
            }
            .navigationTitle("Edit draft")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        appState.saveCurrentStoryEdits(title: title, body: chapterBody)
                        dismiss()
                    }
                    .font(KathaFont.BodyStrong)
                }
            }
        }
    }
}

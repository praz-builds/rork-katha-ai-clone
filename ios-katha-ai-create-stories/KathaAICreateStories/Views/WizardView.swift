//
//  WizardView.swift
//  KathaAICreateStories
//

import SwiftUI

struct WizardView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                WizardHeader()

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
        .sheet(isPresented: sheetBinding) {
            if appState.showLanguageSheet {
                LanguageSelectorSheet()
            } else if appState.showGetIdeasSheet {
                GetIdeasSheet()
            }
        }
    }

    private var sheetBinding: Binding<Bool> {
        Binding(
            get: { appState.showLanguageSheet || appState.showGetIdeasSheet },
            set: { isPresented in
                if !isPresented {
                    appState.showLanguageSheet = false
                    appState.showGetIdeasSheet = false
                }
            }
        )
    }

    @ViewBuilder
    private var stepContent: some View {
        switch appState.wizardStep {
        case .genre:
            GenreStep()
        case .topic:
            TopicStep()
        case .characters:
            CharactersStep()
        case .review:
            ReviewStep()
        }
    }

    private var bottomBar: some View {
        VStack {
            Spacer()
            VStack(spacing: KathaTheme.Spacing.m) {
                if appState.wizardStep == .review {
                    PrimaryCTA(
                        title: "Generate Story • 1 credit",
                        icon: "sparkles",
                        isLoading: appState.isGenerating,
                        action: {
                            Task { await appState.generateStory() }
                        }
                    )
                    .disabled(!appState.canCreateStory || appState.isGenerating)
                } else {
                    PrimaryCTA(
                        title: nextButtonTitle,
                        icon: "arrow.right",
                        action: goNext
                    )
                    .disabled(!canProceed)
                }

                if appState.wizardStep != .genre {
                    Button("Back") {
                        Haptics.light()
                        appState.moveToStep(WizardStep(rawValue: appState.wizardStep.rawValue - 1) ?? .genre)
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(KathaTheme.textSecondary)
                }
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

    private var nextButtonTitle: String {
        switch appState.wizardStep {
        case .genre: "Choose genre"
        case .topic: "Add characters"
        case .characters: "Review story"
        default: "Continue"
        }
    }

    private var canProceed: Bool {
        switch appState.wizardStep {
        case .genre: appState.wizardGenre != nil
        case .topic: true
        case .characters: true
        default: false
        }
    }

    private func goNext() {
        Haptics.light()
        switch appState.wizardStep {
        case .genre:
            if appState.wizardGenre != nil { appState.wizardStep = .topic }
        case .topic:
            appState.wizardStep = .characters
        case .characters:
            appState.wizardStep = .review
        default:
            break
        }
    }
}

// MARK: - Header

struct WizardHeader: View {
    @Environment(AppState.self) private var appState
    @State private var showDiscardModal = false

    private var hasInput: Bool {
        !appState.wizardTopic.isEmpty || !appState.wizardCharacters.isEmpty || appState.wizardGenre != nil
    }

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            HStack {
                if appState.wizardStep != .genre {
                    Button {
                        Haptics.light()
                        appState.moveToStep(WizardStep(rawValue: appState.wizardStep.rawValue - 1) ?? .genre)
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(KathaTheme.textPrimary)
                            .frame(width: 44, height: 44)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Create a story")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("Step \(appState.wizardStep.number) of \(WizardStep.allCases.count)")
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                Spacer()
                Button {
                    Haptics.light()
                    if hasInput {
                        showDiscardModal = true
                    } else {
                        appState.resetWizard()
                        appState.requestedTab = 0
                    }
                } label: {
                    Text("Cancel")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.accent)
                        .frame(minWidth: 44, minHeight: 44)
                }
            }

            HStack(spacing: KathaTheme.Spacing.s) {
                ForEach(WizardStep.allCases, id: \.self) { step in
                    let isActive = step.rawValue <= appState.wizardStep.rawValue
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
        .sheet(isPresented: $showDiscardModal) {
            DiscardWizardModal(onDiscard: {
                showDiscardModal = false
                appState.resetWizard()
                appState.requestedTab = 0
            }, onKeep: {
                showDiscardModal = false
            })
        }
    }
}

struct DiscardWizardModal: View {
    let onDiscard: () -> Void
    let onKeep: () -> Void

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            Text("Discard your story idea?")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
            Text("Your genre, topic, and characters will be cleared.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)
            VStack(spacing: KathaTheme.Spacing.s) {
                DestructiveCTA(title: "Discard", icon: "trash") { onDiscard() }
                SecondaryCTA(title: "Keep editing") { onKeep() }
            }
        }
        .padding(KathaTheme.Spacing.xxl)
        .frame(maxWidth: .infinity)
        .presentationDetents([.height(280)])
        .background(KathaTheme.surface)
    }
}

// MARK: - Genre Step

struct GenreStep: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            Text("What kind of story do you want to tell?")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text("Choose a genre. We'll shape the tone, setting, and style around your pick.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)

            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible())],
                spacing: KathaTheme.Spacing.m
            ) {
                ForEach(Genre.allCases.filter { genre in
                    if appState.kidsMode && genre == .erotica { return false }
                    if appState.kidsMode && appState.kidsReadingLevelCap == .simple && genre == .horror { return false }
                    return true
                }) { genre in
                    GenreGridCard(
                        genre: genre,
                        isSelected: appState.wizardGenre == genre
                    ) {
                        appState.setWizardGenre(genre)
                    }
                }
            }
        }
    }
}

struct GenreGridCard: View {
    let genre: Genre
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: { Haptics.light(); action() }) {
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                HStack {
                    Image(systemName: genre.icon)
                        .font(.system(size: 22))
                        .foregroundStyle(isSelected ? .white : KathaTheme.textPrimary)
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(.white)
                    }
                }

                Text(genre.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(isSelected ? .white : KathaTheme.textPrimary)
                    .lineLimit(1)
            }
            .padding(KathaTheme.Spacing.m)
            .frame(height: 88)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                    .fill(isSelected ? KathaTheme.accent : KathaTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                    .stroke(isSelected ? KathaTheme.accent : KathaTheme.border, lineWidth: 1)
            )
        }
        .buttonStyle(PressScaleStyle())
    }
}

// MARK: - Topic Step

struct TopicStep: View {
    @Environment(AppState.self) private var appState

    static let placeholders: [String] = [
        "Two rival food truck owners are forced to share a parking spot for the whole summer. Neither will move first. Something has to give.",
        "The librarian discovers a book that writes itself, and the words are describing her life — in real time. She's on page 47.",
        "A retired astronaut receives a signal from a colleague who died on a mission 40 years ago. The message is 12 hours old.",
        "A late-night phone call from a number that doesn't exist. The voice on the other end sounds exactly like your mother — who is standing right next to you.",
        "The old woman found the wolf at the bottom of the well. It looked up at her with eyes she recognized.",
        "Two estranged sisters meet to bury their father. Neither can remember why they stopped talking twenty years ago.",
        "A wedding officiant realizes mid-ceremony that they hate the couple they're marrying. There's an hour left in the ceremony.",
        "The photograph shows five people. There were only four of you that day."
    ]
    static var placeholderIndex: Int = Int.random(in: 0..<8)

    var body: some View {
        @Bindable var appState = appState
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            Text("What's your story about?")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text("Describe the premise, setting, or a moment you want to explore. Be as brief or detailed as you like.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)

            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                Text("Story idea")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(KathaTheme.textSecondary)

                ZStack(alignment: .topLeading) {
                    if appState.wizardTopic.isEmpty {
                        Text(TopicStep.placeholders[TopicStep.placeholderIndex])
                            .font(.system(size: 15))
                            .foregroundStyle(KathaTheme.textTertiary)
                            .padding(KathaTheme.Spacing.m)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: Binding(
                        get: { String(appState.wizardTopic.prefix(800)) },
                        set: { appState.wizardTopic = String($0.prefix(800)) }
                    ))
                        .font(.system(size: 15))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .frame(minHeight: 240)
                        .padding(KathaTheme.Spacing.m)
                        .background(KathaTheme.canvas)
                        .overlay(
                            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                                .stroke(KathaTheme.border, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.m))
                        .scrollContentBackground(.hidden)
                }
            }

            HStack {
                Text("\(appState.wizardTopic.count) / 800")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textTertiary)
                Spacer()
                Button {
                    Haptics.light()
                    appState.showGetIdeasSheet = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "lightbulb")
                        Text("Get ideas")
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(KathaTheme.accent)
                }
            }

            languageSelector

            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                Toggle(isOn: $appState.wizardPlanAsSeries) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Plan as a series")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(KathaTheme.textPrimary)
                        Text("We'll structure this as the first chapter of a multi-chapter story.")
                            .font(.system(size: 13))
                            .foregroundStyle(KathaTheme.textSecondary)
                    }
                }
                .tint(KathaTheme.accent)

                if appState.wizardPlanAsSeries {
                    HStack(spacing: KathaTheme.Spacing.m) {
                        Text("Chapters")
                            .font(.system(size: 14))
                            .foregroundStyle(KathaTheme.textSecondary)
                        Spacer()
                        HStack(spacing: KathaTheme.Spacing.s) {
                            Button {
                                Haptics.light()
                                appState.wizardSeriesChapterCount = max(2, appState.wizardSeriesChapterCount - 1)
                            } label: {
                                Image(systemName: "minus")
                                    .frame(width: 32, height: 32)
                                    .background(KathaTheme.surface)
                                    .clipShape(Circle())
                                    .foregroundStyle(KathaTheme.textPrimary)
                            }

                            Text("\(appState.wizardSeriesChapterCount)")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(KathaTheme.textPrimary)
                                .frame(minWidth: 32)

                            Button {
                                Haptics.light()
                                appState.wizardSeriesChapterCount = min(10, appState.wizardSeriesChapterCount + 1)
                            } label: {
                                Image(systemName: "plus")
                                    .frame(width: 32, height: 32)
                                    .background(KathaTheme.surface)
                                    .clipShape(Circle())
                                    .foregroundStyle(KathaTheme.textPrimary)
                            }
                        }
                    }
                    .padding(.top, KathaTheme.Spacing.s)
                }
            }
            .padding(KathaTheme.Spacing.m)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                    .fill(KathaTheme.surface)
            )

            Button {
                appState.openReadingLevelSheet(forWizard: true)
            } label: {
                HStack {
                    Text("Reading level").font(.system(size: 15, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary)
                    Spacer()
                    Text("\(appState.wizardReadingLevel.title) ▾").font(.system(size: 14, weight: .medium)).foregroundStyle(KathaTheme.accent)
                }
                .padding(KathaTheme.Spacing.m)
                .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).fill(KathaTheme.surface))
            }
            .buttonStyle(.plain)
        }
    }

    private var languageSelector: some View {
        Button {
            Haptics.light()
            appState.showLanguageSheet = true
        } label: {
            HStack(spacing: KathaTheme.Spacing.m) {
                Text(appState.wizardLanguage.flagEmoji)
                    .font(.system(size: 22))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Language")
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.textSecondary)
                    Text(appState.wizardLanguage.displayName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textTertiary)
            }
            .padding(KathaTheme.Spacing.m)
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

// MARK: - Characters Step

struct CharactersStep: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Who is in your story?")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("Optional. Add characters to shape the plot and voice.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                Spacer()
            }

            ForEach($appState.wizardCharacters) { $character in
                CharacterCard(character: $character) {
                    appState.removeWizardCharacter(id: character.id)
                }
            }

            SecondaryCTA(
                title: appState.wizardCharacters.isEmpty ? "Add a character" : "Add another character",
                icon: "plus"
            ) {
                Haptics.light()
                appState.addWizardCharacter()
            }
        }
    }
}

struct CharacterCard: View {
    @Binding var character: WizardCharacter
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            HStack {
                Text("Character")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(KathaTheme.textSecondary)
                Spacer()
                Button {
                    Haptics.light()
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.error)
                }
            }

            KathaTextField(title: "Name", text: $character.name, placeholder: "e.g. Elena")
            KathaTextField(title: "Role", text: $character.role, placeholder: "e.g. Protagonist")
            KathaTextEditor(title: "Description", text: $character.description, placeholder: "Brief personality or backstory...")
        }
        .padding(KathaTheme.Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .fill(KathaTheme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .stroke(KathaTheme.border, lineWidth: 1)
        )
    }
}

// MARK: - Review Step

struct ReviewStep: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            Text("Ready to generate?")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text("Review your choices before Katha crafts your story.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)

            VStack(spacing: KathaTheme.Spacing.s) {
                ReviewRow(label: "Genre", value: appState.wizardGenre?.displayName ?? "—")
                ReviewRow(label: "Language", value: appState.wizardLanguage.displayName)
                ReviewRow(label: "Series", value: appState.wizardPlanAsSeries ? "Yes, \(appState.wizardSeriesChapterCount) chapters" : "One-shot")
                ReviewRow(label: "Characters", value: appState.wizardCharacters.isEmpty ? "None added" : "\(appState.wizardCharacters.count)")
            }
            .padding(KathaTheme.Spacing.m)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                    .fill(KathaTheme.surface)
            )

            if !appState.wizardTopic.isEmpty {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                    Text("Story idea")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(KathaTheme.textSecondary)
                    Text(appState.wizardTopic)
                        .font(.system(size: 15))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .lineSpacing(4)
                }
                .padding(KathaTheme.Spacing.m)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                        .fill(KathaTheme.surface)
                )
            }

            if let error = appState.generationError {
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

            creditBadge
        }
    }

    private var creditBadge: some View {
        HStack(spacing: KathaTheme.Spacing.s) {
            Image(systemName: "gift.fill")
                .foregroundStyle(KathaTheme.accent)
            Text("\(appState.credits) credit\(appState.credits == 1 ? "" : "s") remaining")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(KathaTheme.textSecondary)
            Spacer()
        }
        .padding(KathaTheme.Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .fill(KathaTheme.accentSoft.opacity(0.3))
        )
    }
}

struct ReviewRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Sheets

struct LanguageSelectorSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(StoryLanguage.allCases, id: \.self) { language in
                Button {
                    Haptics.light()
                    appState.wizardLanguage = language
                    appState.showLanguageSheet = false
                } label: {
                    HStack(spacing: KathaTheme.Spacing.m) {
                        Text(language.flagEmoji)
                            .font(.system(size: 24))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(language.displayName)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(KathaTheme.textPrimary)
                            Text(language.nativeName)
                                .font(.system(size: 13))
                                .foregroundStyle(KathaTheme.textSecondary)
                        }
                        Spacer()
                        if appState.wizardLanguage == language {
                            Image(systemName: "checkmark")
                                .foregroundStyle(KathaTheme.accent)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Language")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        appState.showLanguageSheet = false
                    }
                }
            }
        }
    }
}

struct GetIdeasSheet: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
                    Text("Story starters")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)

                    Text("Tap any idea to use it as your story premise.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)

                    let genre = appState.wizardGenre ?? .fiction
                    let starters = StoryStarters.starters[genre] ?? StoryStarters.starters[.fiction]!

                    ForEach(starters, id: \.self) { starter in
                        Button {
                            Haptics.light()
                            appState.wizardTopic = starter
                            appState.showGetIdeasSheet = false
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
                        appState.showGetIdeasSheet = false
                    }
                }
            }
        }
    }
}

// MARK: - Out of Credits Modal

struct OutOfCreditsModal: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { appState.dismissOutOfCreditsModal() }

            VStack(spacing: KathaTheme.Spacing.l) {
                Image(systemName: "gift.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(KathaTheme.accent)

                Text("You're out of credits")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)

                Text("Get more credits to keep creating stories with Katha.")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: KathaTheme.Spacing.s) {
                    PremiumCTA(title: "Get credits ▸") {
                        Haptics.light()
                        appState.dismissOutOfCreditsModal()
                        appState.openSubscriptionPaywall()
                    }

                    SecondaryCTA(title: "Watch an ad for 1 credit") {
                        Haptics.light()
                        appState.dismissOutOfCreditsModal()
                        appState.openCreditsScreen()
                    }

                    SecondaryCTA(title: "Maybe later") {
                        Haptics.light()
                        appState.dismissOutOfCreditsModal()
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

// MARK: - Generation Screen

struct GenerationScreen: View {
    @Environment(AppState.self) private var appState
    @State private var progress: CGFloat = 0
    @State private var statusIndex = 0
    @State private var autoOpenTimer: Timer?
    @State private var breatheLarge = false
    @State private var breatheMedium = false
    @State private var breatheSmall = false
    @State private var glowPulse = false

    private let statuses = [
        "Imagining your world...",
        "Sketching characters...",
        "Weaving the plot...",
        "Polishing the prose...",
        "Almost there..."
    ]

    var body: some View {
        ZStack {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: KathaTheme.Spacing.xl) {
                Spacer()

                // Breathing sparkle cluster
                ZStack {
                    // Glow behind cluster
                    Circle()
                        .fill(KathaTheme.accentSoft.opacity(0.3))
                        .frame(width: 140, height: 140)
                        .blur(radius: 40)
                        .scaleEffect(glowPulse ? 1.05 : 0.95)
                        .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: glowPulse)

                    // Small sparkle (bottom-left)
                    Image(systemName: "sparkle")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.accent.opacity(0.6))
                        .offset(x: -22, y: 18)
                        .scaleEffect(breatheSmall ? 1.25 : 1.0)
                        .opacity(breatheSmall ? 0.75 : 0.6)
                        .animation(.easeInOut(duration: 2.1).repeatForever(autoreverses: true), value: breatheSmall)

                    // Medium sparkle (top-right)
                    Image(systemName: "sparkle")
                        .font(.system(size: 20))
                        .foregroundStyle(KathaTheme.accent.opacity(0.8))
                        .offset(x: 20, y: -24)
                        .scaleEffect(breatheMedium ? 1.2 : 1.0)
                        .opacity(breatheMedium ? 0.95 : 0.8)
                        .animation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true), value: breatheMedium)

                    // Large sparkle (center)
                    Image(systemName: "sparkle")
                        .font(.system(size: 40))
                        .foregroundStyle(KathaTheme.accent)
                        .scaleEffect(breatheLarge ? 1.15 : 1.0)
                        .opacity(breatheLarge ? 1.0 : 0.85)
                        .animation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true), value: breatheLarge)
                }

                Text(statuses[statusIndex])
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .animation(.easeInOut, value: statusIndex)

                Text("This usually takes 10–14 seconds")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)

                Spacer()

                if appState.lastGeneratedStory != nil {
                    VStack(spacing: KathaTheme.Spacing.m) {
                        Text("Your story is ready!")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(KathaTheme.textPrimary)

                        PrimaryCTA(title: "Read now", icon: "book.open") {
                            if let story = appState.lastGeneratedStory {
                                appState.openGeneratedStory(story)
                            }
                        }
                    }
                    .padding(.bottom, KathaTheme.Spacing.xl)
                }
            }
            .padding(KathaTheme.Spacing.l)

            // Thin progress line at bottom
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    RoundedRectangle(cornerRadius: 1)
                        .fill(KathaTheme.border)
                        .frame(width: UIScreen.main.bounds.width * 0.6, height: 2)
                        .overlay(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 1)
                                .fill(KathaTheme.accent)
                                .frame(width: UIScreen.main.bounds.width * 0.6 * progress, height: 2)
                                .animation(.easeInOut(duration: 0.5), value: progress)
                        }
                    Spacer()
                }
                .padding(.bottom, 40)
            }
        }
        .onAppear {
            breatheLarge = true
            breatheMedium = true
            breatheSmall = true
            glowPulse = true
            startProgressAnimation()
        }
        .onDisappear {
            autoOpenTimer?.invalidate()
        }
        .onChange(of: appState.lastGeneratedStory) { _, newValue in
            if newValue != nil {
                autoOpenTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { _ in
                    if let story = appState.lastGeneratedStory {
                        appState.openGeneratedStory(story)
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

// MARK: - Helper Fields

struct KathaTextField: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(KathaTheme.textSecondary)
            TextField(placeholder, text: $text)
                .font(.system(size: 15))
                .foregroundStyle(KathaTheme.textPrimary)
                .padding(KathaTheme.Spacing.s)
                .background(KathaTheme.canvas)
                .overlay(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.s)
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
        }
    }
}

struct KathaTextEditor: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(KathaTheme.textSecondary)
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .font(.system(size: 15))
                        .foregroundStyle(KathaTheme.textTertiary)
                        .padding(KathaTheme.Spacing.s)
                }
                TextEditor(text: $text)
                    .font(.system(size: 15))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .frame(minHeight: 80)
                    .padding(KathaTheme.Spacing.s)
            }
            .background(KathaTheme.canvas)
            .overlay(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.s)
                    .stroke(KathaTheme.border, lineWidth: 1)
            )
        }
    }
}

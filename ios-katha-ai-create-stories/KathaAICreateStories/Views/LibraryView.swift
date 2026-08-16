import SwiftUI

enum LibrarySavedSortOrder: String, CaseIterable, Identifiable {
    case recentlySaved
    case alphabetical
    case byAuthor

    var id: String { rawValue }
    var label: String {
        switch self {
        case .recentlySaved: "Recently saved"
        case .alphabetical: "Alphabetical (A–Z)"
        case .byAuthor: "By author (A–Z)"
        }
    }
}

struct LibraryView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedTab = 0
    @AppStorage("library_saved_sort_order") private var savedSortRawValue = LibrarySavedSortOrder.recentlySaved.rawValue
    @State private var showSortSheet = false
    @State private var removedStory: Story?
    @State private var showUndo = false

    private var savedSort: LibrarySavedSortOrder {
        LibrarySavedSortOrder(rawValue: savedSortRawValue) ?? .recentlySaved
    }

    private var savedStories: [Story] {
        let stories = SeedData.stories.filter { appState.isBookmarked($0.id) && appState.isStoryVisibleInKidsMode($0) }
        switch savedSort {
        case .recentlySaved: return stories
        case .alphabetical: return stories.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .byAuthor:
            return stories.sorted {
                let first = SeedData.author(id: $0.authorId)?.displayName ?? ""
                let second = SeedData.author(id: $1.authorId)?.displayName ?? ""
                return first.localizedCaseInsensitiveCompare(second) == .orderedAscending
            }
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(spacing: KathaTheme.Spacing.l) {
                    if appState.hasUnreadNewChapters { NewChapterBanner { } }
                    header
                    if !appState.isAuthenticated { unauthenticatedState } else { authenticatedContent }
                    SafeBottomSpacer()
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
            }
            .themedBackground()
            .scrollIndicators(.hidden)

            if showUndo {
                ToastView(message: "Removed from Library", actionTitle: "Undo") {
                    if let removedStory, !appState.isBookmarked(removedStory.id) {
                        appState.toggleBookmark(storyId: removedStory.id)
                    }
                    showUndo = false
                    self.removedStory = nil
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.bottom, KathaTheme.Spacing.xxxl64)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .sheet(isPresented: $showSortSheet) { sortSheet }
    }

    private var header: some View {
        HStack {
            Text("Library").font(KathaFont.Title1).foregroundStyle(KathaTheme.textPrimary)
            Spacer()
        }
        .padding(.top, KathaTheme.Spacing.s)
    }

    private var unauthenticatedState: some View {
        EmptyState(
            icon: "books.vertical",
            title: "Your library is waiting",
            message: "Sign in to save stories, track your reading, and keep everything in one place.",
            ctaTitle: "Sign in",
            ctaAction: { appState.presentAuthSheet(readerWall: false) }
        )
        .padding(.top, KathaTheme.Spacing.xxxl)
    }

    private var authenticatedContent: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            SegmentedControl(options: ["Saved", "History", "Downloads", "My stories"], selection: $selectedTab)
            switch selectedTab {
            case 0: savedTab
            case 1: historyTab
            case 2: downloadsTab
            default: myStoriesTab
            }
        }
    }

    private var savedTab: some View {
        VStack(spacing: 0) {
            HStack {
                Text("\(savedStories.count) saved stories").font(KathaFont.Meta).foregroundStyle(KathaTheme.textSecondary)
                Spacer()
                Button {
                    Haptics.light()
                    showSortSheet = true
                } label: {
                    Text("Sort: \(savedSort.label) ▾").font(KathaFont.Meta).foregroundStyle(KathaTheme.accent)
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.mdLg)
            .padding(.vertical, KathaTheme.Spacing.m)
            .overlay(alignment: .bottom) { Rectangle().fill(KathaTheme.border).frame(height: 1) }

            if savedStories.isEmpty {
                EmptyState(icon: "tray", title: "Nothing here yet", message: "Stories you bookmark will appear here.")
                    .padding(.top, KathaTheme.Spacing.xxxl)
            } else {
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(savedStories) { story in
                        StoryCard(
                            story: story,
                            isLiked: appState.isLiked(story.id),
                            onLike: { appState.toggleLike(storyId: story.id) },
                            onTap: { appState.openReader(story: story) },
                            onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                        )
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) { removeSaved(story) } label: {
                                Label("Remove", systemImage: "trash")
                            }
                        }
                        .contextMenu {
                            Button(role: .destructive) { removeSaved(story) } label: {
                                Label("Remove from Library", systemImage: "trash")
                            }
                        }
                    }
                }
                .padding(.top, KathaTheme.Spacing.m)
            }
        }
    }

    private var historyTab: some View {
        let history = SeedData.stories.filter { appState.readingProgress.keys.contains($0.id) && appState.isStoryVisibleInKidsMode($0) }
        return storyList(history, emptyMessage: "Stories you've read will appear here.")
    }

    private var downloadsTab: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            if appState.offlineStoryRecords.isEmpty {
                EmptyState(icon: "icloud.slash", title: "No stories downloaded yet", message: "Tap the download icon in any story to save it for offline.")
            } else {
                ForEach(appState.offlineStoryRecords) { record in
                    if let story = SeedData.stories.first(where: { $0.id == record.storyId }) {
                        StoryCard(story: story, onTap: { appState.openReader(story: story) }, onAuthorTap: { appState.openAuthorProfile(story.authorId) })
                    }
                }
            }
        }
    }

    private var myStoriesTab: some View {
        let all = appState.publishedStories
        let published = all.filter { $0.isPublished && !$0.chapters.contains { !$0.isPublished } }
        let drafts = all.filter { !$0.isPublished || $0.chapters.contains { !$0.isPublished } }
        return VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            if published.isEmpty && drafts.isEmpty {
                EmptyState(icon: "pencil.and.outline", title: "Nothing here yet", message: "Write your first story ▸", ctaTitle: "Write your first story ▸", ctaAction: { appState.requestedTab = 2 })
            } else {
                if !published.isEmpty {
                    Text("PUBLISHED").font(KathaFont.Meta).foregroundStyle(KathaTheme.textTertiary)
                    ForEach(published) { generated in generatedStoryRow(generated, isDraft: false) }
                }
                if !drafts.isEmpty {
                    Text("DRAFTS").font(KathaFont.Meta).foregroundStyle(KathaTheme.textTertiary)
                    ForEach(drafts) { generated in generatedStoryRow(generated, isDraft: true) }
                }
            }
        }
    }

    private func generatedStoryRow(_ generated: GeneratedStory, isDraft: Bool) -> some View {
        ZStack(alignment: .topTrailing) {
            StoryCard(story: generated.asStory, onTap: { appState.openGeneratedStory(generated) }, onAuthorTap: { appState.openOwnProfile() })
            if isDraft {
                Text("Draft").font(KathaFont.Meta).foregroundStyle(KathaTheme.accent).padding(.horizontal, KathaTheme.Spacing.s).padding(.vertical, KathaTheme.Spacing.xs).background(Capsule().fill(KathaTheme.accentSoft)).padding(KathaTheme.Spacing.s)
            }
        }
    }

    private func storyList(_ stories: [Story], emptyMessage: String) -> some View {
        Group {
            if stories.isEmpty {
                EmptyState(icon: "tray", title: "Nothing here yet", message: emptyMessage).padding(.top, KathaTheme.Spacing.xxxl)
            } else {
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(stories) { story in
                        StoryCard(story: story, onTap: { appState.openReader(story: story) }, onAuthorTap: { appState.openAuthorProfile(story.authorId) })
                    }
                }
            }
        }
    }

    private var sortSheet: some View {
        NavigationStack {
            List(LibrarySavedSortOrder.allCases) { order in
                Button {
                    savedSortRawValue = order.rawValue
                    Haptics.light()
                    showSortSheet = false
                } label: {
                    HStack {
                        Text(order.label).font(KathaFont.Body).foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        if order == savedSort { Image(systemName: "checkmark").foregroundStyle(KathaTheme.accent) }
                    }
                }
            }
            .navigationTitle("Sort saved stories")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }

    private func removeSaved(_ story: Story) {
        guard appState.isBookmarked(story.id) else { return }
        Haptics.medium()
        appState.toggleBookmark(storyId: story.id)
        removedStory = story
        withAnimation(.easeInOut(duration: 0.2)) { showUndo = true }
        Task {
            try? await Task.sleep(for: .seconds(3))
            await MainActor.run {
                if removedStory?.id == story.id { withAnimation { showUndo = false; removedStory = nil } }
            }
        }
    }
}

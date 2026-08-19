import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @AppStorage("katha.lastOpenTimestamp") private var lastOpenTimestamp: Double = 0
    @State private var isLoading = true
    @State private var welcomeDismissed = false
    @State private var showSearchOverlay = false
    @State private var searchText = ""
    @State private var selectedGenre: Genre? = nil

    private var shouldShowWelcome: Bool {
        lastOpenTimestamp > 0 && Date().timeIntervalSince1970 - lastOpenTimestamp > 3 * 24 * 60 * 60 && !welcomeDismissed
    }

    private var continueStories: [Story] {
        appState.readingProgress.compactMap { entry in
            guard entry.value.scrollProgress > 0, entry.value.scrollProgress < 1 else { return nil }
            return SeedData.stories.first { $0.id == entry.key && appState.isStoryVisibleInKidsMode($0) }
        }
    }

    private var forYouStories: [Story] {
        Array(visibleStories(appState.discoverFeedStories()).prefix(5))
    }

    private var followedWriterStories: [Story] {
        SeedData.stories
            .filter { appState.followedAuthorIds.contains($0.authorId) && appState.isStoryVisibleInKidsMode($0) }
            .sorted { $0.publishedOffset < $1.publishedOffset }
            .prefix(3)
            .map { $0 }
            .filter { selectedGenre == nil || $0.genre == selectedGenre }
    }

    private var risingStories: [Story] {
        SeedData.trendingStories
            .filter { appState.isStoryVisibleInKidsMode($0) }
            .sorted { $0.publishedOffset < $1.publishedOffset }
            .prefix(6)
            .map { $0 }
            .filter { selectedGenre == nil || $0.genre == selectedGenre }
    }

    private var kathaPicks: [Story] {
        SeedData.stories
            .filter { $0.authorId == "kathaai" && appState.isStoryVisibleInKidsMode($0) }
            .prefix(3)
            .map { $0 }
            .filter { selectedGenre == nil || $0.genre == selectedGenre }
    }

    private func visibleStories(_ stories: [Story]) -> [Story] {
        stories.filter { story in
            appState.isStoryVisibleInKidsMode(story) && (selectedGenre == nil || story.genre == selectedGenre)
        }
    }

    private var searchResults: [Story] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let stories = appState.discoverFeedStories()
        guard !query.isEmpty else { return visibleStories(stories) }
        return visibleStories(stories).filter { story in
            story.title.localizedCaseInsensitiveContains(query) ||
            story.synopsis.localizedCaseInsensitiveContains(query) ||
            story.tags.contains { $0.localizedCaseInsensitiveContains(query) } ||
            story.genre.displayName.localizedCaseInsensitiveContains(query) ||
            (SeedData.author(id: story.authorId)?.displayName.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: KathaTheme.Spacing.xxxl) {
                    header
                        .padding(.top, KathaTheme.Spacing.mdLg)
                    searchEntry
                    rankingStrip
                    genreStrip

                    if isLoading {
                        loadingContent
                    } else {
                        content(scrollProxy: proxy)
                    }

                    SafeBottomSpacer()
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
            }
            .themedBackground()
            .scrollIndicators(.hidden)
        }
        .overlay {
            if showSearchOverlay {
                searchOverlay
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .zIndex(2)
            }
        }
        .onAppear {
            let previousOpen = lastOpenTimestamp
            lastOpenTimestamp = Date().timeIntervalSince1970
            if isLoading {
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    withAnimation(.easeInOut(duration: 0.25)) { isLoading = false }
                }
            }
            if previousOpen == 0 { welcomeDismissed = true }
        }
    }

    private var header: some View {
        HStack {
            Text("Katha")
                .font(KathaFont.Wordmark)
                .foregroundStyle(KathaTheme.accent)
            Spacer()
            if appState.isAuthenticated {
                HStack(spacing: KathaTheme.Spacing.m) {
                    Button {
                        Haptics.light()
                        appState.openCreditsScreen()
                    } label: {
                        HStack(spacing: KathaTheme.Spacing.xs) {
                            if appState.isPremium {
                                Image(systemName: "crown").font(KathaFont.Meta).foregroundStyle(KathaTheme.premium)
                            }
                            Image(systemName: "circle.hexagongrid.fill").font(KathaFont.Meta).foregroundStyle(KathaTheme.accent)
                            Text("\(appState.credits)").font(KathaFont.BodyStrong).foregroundStyle(KathaTheme.textPrimary)
                        }
                        .padding(.horizontal, KathaTheme.Spacing.m)
                        .padding(.vertical, KathaTheme.Spacing.s)
                        .background(Capsule().fill(KathaTheme.surface))
                    }
                    .buttonStyle(PressScaleStyle())
                    Button { appState.openOwnProfile() } label: {
                        GeneratedAvatar(username: appState.currentUser?.username ?? "", displayName: appState.currentUser?.displayName ?? "", size: 36)
                    }
                    .buttonStyle(PressScaleStyle())
                }
            } else {
                Button("Sign in") { appState.presentAuthSheet(readerWall: false) }
                    .font(KathaFont.BodyStrong)
                    .foregroundStyle(KathaTheme.textPrimary)
                    .padding(.horizontal, KathaTheme.Spacing.mdLg)
                    .frame(height: 32)
                    .background(Capsule().fill(KathaTheme.surface).overlay(Capsule().stroke(KathaTheme.border, lineWidth: 1)))
            }
        }
    }

    private var searchEntry: some View {
        Button {
            Haptics.light()
            showSearchOverlay = true
        } label: {
            HStack(spacing: KathaTheme.Spacing.s) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(KathaTheme.textSecondary)
                Text("Search stories, authors, genres")
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.textTertiary)
                Spacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.mdLg)
            .frame(height: 44)
            .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).fill(KathaTheme.surface).overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).stroke(KathaTheme.border, lineWidth: 1)))
        }
        .buttonStyle(.plain)
    }

    private var rankingStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KathaTheme.Spacing.s) {
                FilterChip(title: "For You", isSelected: appState.discoverFeedChip == 0) { appState.discoverFeedChip = 0 }
                FilterChip(title: "Trending", isSelected: appState.discoverFeedChip == 1) { appState.discoverFeedChip = 1 }
                FilterChip(title: "Rising", isSelected: appState.discoverFeedChip == 2) { appState.discoverFeedChip = 2 }
                FilterChip(title: "New", isSelected: appState.discoverFeedChip == 3) { appState.discoverFeedChip = 3 }
            }
        }
    }

    private var genreStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KathaTheme.Spacing.s) {
                FilterChip(title: "All", isSelected: selectedGenre == nil) { withAnimation { selectedGenre = nil } }
                ForEach(Genre.allCases.filter { $0 != .erotica || (appState.ageVerified && !appState.kidsMode) }) { genre in
                    GenreChip(genre: genre, isSelected: selectedGenre == genre) {
                        withAnimation { selectedGenre = selectedGenre == genre ? nil : genre }
                    }
                }
            }
        }
    }

    private var searchOverlay: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
                HStack(spacing: KathaTheme.Spacing.s) {
                    Image(systemName: "magnifyingglass").foregroundStyle(KathaTheme.textSecondary)
                    TextField("Search stories, authors, genres", text: $searchText)
                        .font(KathaFont.Body)
                        .autocorrectionDisabled()
                    if !searchText.isEmpty {
                        Button { searchText = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(KathaTheme.textTertiary) }
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.mdLg)
                .frame(height: 44)
                .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).fill(KathaTheme.surface).overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).stroke(KathaTheme.accent, lineWidth: 1)))

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: KathaTheme.Spacing.s) {
                        FilterChip(title: "All", isSelected: selectedGenre == nil) { selectedGenre = nil }
                        ForEach(Genre.allCases.filter { $0 != .erotica || (appState.ageVerified && !appState.kidsMode) }) { genre in
                            GenreChip(genre: genre, isSelected: selectedGenre == genre) { selectedGenre = selectedGenre == genre ? nil : genre }
                        }
                    }
                }

                if searchResults.isEmpty {
                    EmptyState(icon: "magnifyingglass", title: "No stories found", message: "Try a different search term or genre filter.")
                } else {
                    ScrollView {
                        VStack(spacing: KathaTheme.Spacing.m) {
                            ForEach(searchResults) { story in
                                StoryCard(story: story, isLiked: appState.isLiked(story.id), isBookmarked: appState.isBookmarked(story.id), onLike: { appState.toggleLike(storyId: story.id) }, onBookmark: { appState.toggleBookmark(storyId: story.id) }, onTap: { showSearchOverlay = false; appState.openReader(story: story) }, onAuthorTap: { appState.openAuthorProfile(story.authorId) })
                            }
                        }
                    }
                }
                SafeBottomSpacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.top, KathaTheme.Spacing.s)
            .themedBackground()
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { showSearchOverlay = false }
                }
            }
        }
        .background(KathaTheme.canvas.ignoresSafeArea())
    }

    private var loadingContent: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            ForEach(0..<3, id: \.self) { _ in StoryCardSkeleton() }
        }
    }

    @ViewBuilder
    private func content(scrollProxy: ScrollViewProxy) -> some View {
        if shouldShowWelcome {
            welcomeBanner
        }
        newChaptersSection
        continueReadingSection
        forYouSection
        followedWritersSection(scrollProxy: scrollProxy)
        risingSection
        writersToFollowSection
        kathaPicksSection
    }

    private var welcomeBanner: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: "sparkles")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.accent)
            Text("Welcome back. Here's what's popular right now.")
                .font(KathaFont.BodyStrong)
                .foregroundStyle(KathaTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                welcomeDismissed = true
            } label: {
                Image(systemName: "xmark")
                    .font(KathaFont.Meta)
                    .foregroundStyle(KathaTheme.textTertiary)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
        }
        .padding(KathaTheme.Spacing.md)
        .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).fill(KathaTheme.accentSoft))
    }

    @ViewBuilder
    private var newChaptersSection: some View {
        if appState.hasUnreadNewChapters {
            NewChapterBanner { }
                .padding(.horizontal, -KathaTheme.Spacing.l)
            NewChaptersHomeSection { story, chapterIndex in
                appState.openReader(story: story, chapterIndex: chapterIndex)
            }
        }
    }

    @ViewBuilder
    private var continueReadingSection: some View {
        if !continueStories.isEmpty {
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                SectionHeader(title: "Continue reading")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: KathaTheme.Spacing.m) {
                        ForEach(continueStories) { story in
                            CompactStoryCard(
                                story: story,
                                onTap: { appState.openReader(story: story) },
                                onAuthorTap: { appState.openAuthorProfile(story.authorId) },
                                progress: appState.readingProgress[story.id]?.scrollProgress
                            )
                        }
                    }
                }
            }
        }
    }

    private var forYouSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "For you")
            VStack(spacing: KathaTheme.Spacing.m) {
                ForEach(forYouStories) { story in
                    StoryCard(
                        story: story,
                        isLiked: appState.isLiked(story.id),
                        isBookmarked: appState.isBookmarked(story.id),
                        onLike: { appState.toggleLike(storyId: story.id) },
                        onBookmark: { appState.toggleBookmark(storyId: story.id) },
                        onTap: { appState.openReader(story: story) },
                        onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                    )
                }
            }
        }
    }

    private func followedWritersSection(scrollProxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "Stories from writers you follow")
            if followedWriterStories.isEmpty {
                VStack(spacing: KathaTheme.Spacing.m) {
                    Text("Follow writers you enjoy to see their new stories here.")
                        .font(KathaFont.Body)
                        .foregroundStyle(KathaTheme.textSecondary)
                        .multilineTextAlignment(.center)
                    TextLink(title: "Discover writers ▸") {
                        withAnimation(.easeInOut(duration: 0.25)) { scrollProxy.scrollTo("writers", anchor: .center) }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(KathaTheme.Spacing.xl)
                .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.l).fill(KathaTheme.surface))
                .overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.l).stroke(KathaTheme.border, lineWidth: 1))
            } else {
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(followedWriterStories) { story in
                        StoryCard(
                            story: story,
                            isLiked: appState.isLiked(story.id),
                            isBookmarked: appState.isBookmarked(story.id),
                            onLike: { appState.toggleLike(storyId: story.id) },
                            onBookmark: { appState.toggleBookmark(storyId: story.id) },
                            onTap: { appState.openReader(story: story) },
                            onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                        )
                    }
                }
            }
        }
    }

    private var risingSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "Rising this week")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(risingStories) { story in
                        CompactStoryCard(
                            story: story,
                            onTap: { appState.openReader(story: story) },
                            onAuthorTap: { appState.openAuthorProfile(story.authorId) },
                            badge: "🔥 Rising"
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var writersToFollowSection: some View {
        if appState.isAuthenticated {
            WritersToFollowSection()
                .id("writers")
        }
    }

    private var kathaPicksSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "Katha's picks")
            VStack(spacing: KathaTheme.Spacing.m) {
                ForEach(kathaPicks) { story in
                    StoryCard(
                        story: story,
                        isLiked: appState.isLiked(story.id),
                        isBookmarked: appState.isBookmarked(story.id),
                        onLike: { appState.toggleLike(storyId: story.id) },
                        onBookmark: { appState.toggleBookmark(storyId: story.id) },
                        onTap: { appState.openReader(story: story) },
                        onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                    )
                }
            }
        }
    }
}

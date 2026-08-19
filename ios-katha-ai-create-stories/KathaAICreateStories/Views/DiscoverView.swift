//
//  DiscoverView.swift
//  KathaAICreateStories
//

import SwiftUI

struct DiscoverView: View {
    @Environment(AppState.self) private var appState
    @State private var searchText = ""
    @State private var selectedGenre: Genre? = nil

    private var filteredStories: [Story] {
        var stories = appState.discoverFeedStories()
        if !searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            stories = stories.filter { story in
                story.title.localizedCaseInsensitiveContains(searchText) ||
                story.synopsis.localizedCaseInsensitiveContains(searchText) ||
                story.tags.contains { $0.localizedCaseInsensitiveContains(searchText) } ||
                story.genre.displayName.localizedCaseInsensitiveContains(searchText) ||
                (SeedData.author(id: story.authorId)?.displayName.localizedCaseInsensitiveContains(searchText) ?? false)
            }
        }
        if let genre = selectedGenre {
            stories = stories.filter { $0.genre == genre }
        }
        return stories
    }

    var body: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.l) {
                HStack {
                    Text("Discover")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Spacer()
                }
                .padding(.top, KathaTheme.Spacing.s)

                // Search bar
                HStack(spacing: KathaTheme.Spacing.s) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(KathaTheme.textSecondary)
                    TextField("Search stories, authors, genres", text: $searchText)
                        .autocapitalization(.none)
                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(KathaTheme.textTertiary)
                        }
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.vertical, KathaTheme.Spacing.m + 2)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(KathaTheme.surface)
                )

                // Feed ranking chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: KathaTheme.Spacing.s) {
                        feedChip(title: "For You", index: 0, icon: "sparkles")
                        feedChip(title: "Trending", index: 1, icon: "flame")
                        feedChip(title: "Rising", index: 2, icon: "arrow.trending.up")
                        feedChip(title: "New", index: 3, icon: "clock")
                    }
                }

                if let theme = appState.discoverThemeFilter {
                    ThemeFilterBar(themeName: theme) { appState.clearThemeFilter() }
                        .animation(.easeInOut(duration: 0.2), value: theme)
                }

                // Genre chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: KathaTheme.Spacing.s) {
                        FilterChip(title: "All", isSelected: selectedGenre == nil) {
                            withAnimation { selectedGenre = nil }
                        }
                        ForEach(Genre.allCases.filter { genre in
                            genre != .erotica || (appState.ageVerified && !appState.kidsMode)
                        }) { genre in
                            GenreChip(genre: genre, isSelected: selectedGenre == genre) {
                                withAnimation {
                                    selectedGenre = selectedGenre == genre ? nil : genre
                                }
                            }
                        }
                    }
                }

                if searchText.localizedCaseInsensitiveContains("erotica") && !appState.ageVerified {
                    Button {
                        appState.showAgeVerification = true
                    } label: {
                        HStack(spacing: KathaTheme.Spacing.s) {
                            Image(systemName: "shield.lefthalf.filled").foregroundStyle(KathaTheme.textSecondary)
                            Text("18+ content is age-gated. Tap to verify age →")
                                .font(KathaFont.Body)
                                .foregroundStyle(KathaTheme.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, KathaTheme.Spacing.mdLg)
                        .frame(minHeight: 44)
                        .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).fill(KathaTheme.surface).overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.m).stroke(KathaTheme.border)))
                    }
                    .buttonStyle(.plain)
                }

                // Results
                if filteredStories.isEmpty {
                    EmptyState(
                        icon: "magnifyingglass",
                        title: "No stories found",
                        message: "Try a different search term or genre filter."
                    )
                } else {
                    VStack(spacing: KathaTheme.Spacing.m) {
                        ForEach(filteredStories) { story in
                            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                                ZStack(alignment: .topTrailing) {
                                    StoryCard(
                                        story: story,
                                        isLiked: appState.isLiked(story.id),
                                        isBookmarked: appState.isBookmarked(story.id),
                                        onLike: { appState.toggleLike(storyId: story.id) },
                                        onBookmark: { appState.toggleBookmark(storyId: story.id) },
                                        onTap: { appState.openReader(story: story) },
                                        onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                                    )
                                    VStack(spacing: KathaTheme.Spacing.xs) {
                                        if appState.isRisingStory(story) { RisingBadge() }
                                        if appState.isNewStory(story) { NewBadge() }
                                    }
                                    .padding(KathaTheme.Spacing.s)
                                }
                                HStack(spacing: KathaTheme.Spacing.s) {
                                    ForEach(story.tags.prefix(3), id: \.self) { tag in
                                        Button { appState.applyThemeFilter(tag) } label: {
                                            Text(tag)
                                                .font(KathaFont.Meta)
                                                .foregroundStyle(KathaTheme.accent)
                                                .padding(.horizontal, KathaTheme.Spacing.s)
                                                .padding(.vertical, KathaTheme.Spacing.xs)
                                                .background(Capsule().fill(KathaTheme.accentSoft))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                SafeBottomSpacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
        }
        .themedBackground()
        .scrollIndicators(.hidden)
    }

    private func feedChip(title: String, index: Int, icon: String) -> some View {
        Button {
            Haptics.light()
            withAnimation(.spring(duration: 0.3)) {
                appState.discoverFeedChip = index
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 12))
                Text(title).font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(appState.discoverFeedChip == index ? Color.white : KathaTheme.textPrimary)
            .padding(.horizontal, KathaTheme.Spacing.mdLg)
            .padding(.vertical, KathaTheme.Spacing.s)
            .background(
                Capsule()
                    .fill(appState.discoverFeedChip == index ? Color.black : KathaTheme.surface)
                    .overlay(Capsule().stroke(appState.discoverFeedChip == index ? Color.black : KathaTheme.borderStrong, lineWidth: 1))
            )
        }
    }
}

// MARK: - Discover Story Card (with badges + theme chips)

struct DiscoverStoryCard: View {
    @Environment(AppState.self) private var appState
    let story: Story

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            ZStack(alignment: .topTrailing) {
                StoryCoverView(story: story, height: 130, titleSize: 14)
                    .onTapGesture { appState.openReader(story: story) }

                VStack(spacing: 4) {
                    if appState.isRisingStory(story) {
                        RisingBadge()
                    }
                    if appState.isNewStory(story) {
                        NewBadge()
                    }
                }
                .padding(8)
            }

            Text(story.title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(2)
                .onTapGesture { appState.openReader(story: story) }

            if let author = SeedData.author(id: story.authorId) {
                Button {
                    appState.openAuthorProfile(story.authorId)
                } label: {
                    HStack(spacing: 3) {
                        Text(author.displayName)
                            .font(.system(size: 12))
                            .foregroundStyle(KathaTheme.textSecondary)
                        if author.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(KathaTheme.accent)
                        }
                    }
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: KathaTheme.Spacing.xs) {
                ForEach(Array(story.tags.prefix(2)), id: \.self) { tag in
                    ThemeChip(tag: tag) {
                        appState.applyThemeFilter(tag)
                    }
                }
            }

            HStack(spacing: KathaTheme.Spacing.s) {
                Label(formatCount(appState.storyLikeCount(storyId: story.id, baseCount: story.likes)), systemImage: "heart")
                Label(formatCount(story.bookmarks), systemImage: "bookmark")
                Label(formatCount(appState.commentCount(storyId: story.id)), systemImage: "bubble.left")
            }
            .font(.system(size: 11))
            .foregroundStyle(KathaTheme.textTertiary)
        }
        .onTapGesture { appState.openReader(story: story) }
    }
}

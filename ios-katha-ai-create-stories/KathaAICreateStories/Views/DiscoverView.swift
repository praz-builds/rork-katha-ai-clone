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

                // Theme filter bar (visible when a theme is active)
                if let theme = appState.discoverThemeFilter {
                    HStack(spacing: KathaTheme.Spacing.s) {
                        Image(systemName: "tag")
                            .font(.system(size: 12))
                            .foregroundStyle(KathaTheme.accent)
                        Text("Theme: \(theme)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                        Button {
                            appState.clearThemeFilter()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(KathaTheme.textTertiary)
                        }
                    }
                    .padding(.horizontal, KathaTheme.Spacing.l)
                    .padding(.vertical, KathaTheme.Spacing.s)
                    .background(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                            .fill(KathaTheme.accentSoft.opacity(0.3))
                    )
                }

                // Genre chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: KathaTheme.Spacing.s) {
                        FilterChip(title: "All", isSelected: selectedGenre == nil) {
                            withAnimation { selectedGenre = nil }
                        }
                        ForEach(Genre.allCases) { genre in
                            GenreChip(genre: genre, isSelected: selectedGenre == genre) {
                                withAnimation {
                                    selectedGenre = selectedGenre == genre ? nil : genre
                                }
                            }
                        }
                    }
                }

                // Results
                if filteredStories.isEmpty {
                    EmptyState(
                        icon: "magnifyingglass",
                        title: "No stories found",
                        message: "Try a different search term or genre filter."
                    )
                } else {
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), spacing: KathaTheme.Spacing.m),
                            GridItem(.flexible(), spacing: KathaTheme.Spacing.m)
                        ],
                        spacing: KathaTheme.Spacing.l
                    ) {
                        ForEach(filteredStories) { story in
                            DiscoverStoryCard(story: story)
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
            .foregroundStyle(appState.discoverFeedChip == index ? .white : KathaTheme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule().fill(appState.discoverFeedChip == index ? KathaTheme.accent : KathaTheme.surface)
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

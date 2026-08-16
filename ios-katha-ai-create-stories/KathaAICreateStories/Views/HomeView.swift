//
//  HomeView.swift
//  KathaAICreateStories
//

import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.xxl) {
                header

                if isLoading {
                    loadingContent
                } else {
                    content
                }

                SafeBottomSpacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
        }
        .themedBackground()
        .scrollIndicators(.hidden)
        .onAppear {
            if isLoading {
                Task {
                    try? await Task.sleep(for: .milliseconds(500))
                    withAnimation(.easeInOut(duration: 0.3)) {
                        isLoading = false
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack {
            Text("Katha")
                .font(KathaFont.serifBold(28))
                .foregroundStyle(KathaTheme.textPrimary)
            Spacer()
            if appState.isAuthenticated {
                HStack(spacing: KathaTheme.Spacing.m) {
                    Button {
                        Haptics.light()
                        appState.openCreditsScreen()
                    } label: {
                        HStack(spacing: 4) {
                            if appState.isPremium {
                                Image(systemName: "crown")
                                    .font(.system(size: 10))
                                    .foregroundStyle(KathaTheme.premium)
                            }
                            Image(systemName: "credits")
                                .font(.system(size: 12))
                                .foregroundStyle(KathaTheme.accent)
                            Text("\(appState.credits)")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(KathaTheme.textPrimary)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(
                            Capsule().fill(KathaTheme.surface)
                        )
                    }
                    .buttonStyle(PressScaleStyle())

                    Button {
                        appState.openOwnProfile()
                    } label: {
                        GeneratedAvatar(
                            username: appState.currentUser?.username ?? "",
                            displayName: appState.currentUser?.displayName ?? "",
                            size: 36
                        )
                    }
                    .buttonStyle(PressScaleStyle())
                }
            }
        }
        .padding(.top, KathaTheme.Spacing.s)
    }

    private var loadingContent: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            ForEach(0..<3, id: \.self) { _ in
                StoryCardSkeleton()
            }
        }
    }

    private var content: some View {
        VStack(spacing: KathaTheme.Spacing.xxl) {
            // Celebration banner (top, above new chapters)
            if AnalyticsService.shared.hasUnseenMilestones {
                CelebrationBanner()
                    .padding(.horizontal, -KathaTheme.Spacing.l)
            }

            // New chapters section (conditional)
            newChaptersSection

            featuredSection
            trendingSection
            writersToFollowSection
            newSection
            genreSection
        }
    }

    @ViewBuilder
    private var newChaptersSection: some View {
        if appState.hasUnreadNewChapters {
            // New chapter banner at very top
            NewChapterBanner {
                // Banner tap — section is right below
            }
            .padding(.horizontal, -KathaTheme.Spacing.l)

            NewChaptersHomeSection { story, chapterIndex in
                appState.openReader(story: story, chapterIndex: chapterIndex)
            }
        }
    }

    private var featuredSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "Featured", subtitle: "Handpicked stories for you")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(SeedData.featuredStories.filter { appState.isStoryVisibleInKidsMode($0) }) { story in
                        StoryCard(
                            story: story,
                            isLiked: appState.isLiked(story.id),
                            isBookmarked: appState.isBookmarked(story.id),
                            onLike: { appState.toggleLike(storyId: story.id) },
                            onBookmark: { appState.toggleBookmark(storyId: story.id) },
                            onTap: { appState.openReader(story: story) },
                            onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                        )
                        .frame(width: 320)
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
            }
        }
    }

    private var trendingSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "Trending", subtitle: "Most loved this week")
            VStack(spacing: KathaTheme.Spacing.m) {
                ForEach(SeedData.trendingStories.filter { appState.isStoryVisibleInKidsMode($0) }.prefix(5)) { story in
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

    private var newSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "New This Week", subtitle: "Fresh from our authors")
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: KathaTheme.Spacing.m),
                    GridItem(.flexible(), spacing: KathaTheme.Spacing.m)
                ],
                spacing: KathaTheme.Spacing.l
            ) {
                ForEach(SeedData.newStories.filter { appState.isStoryVisibleInKidsMode($0) }.prefix(6)) { story in
                    CompactStoryCard(
                        story: story,
                        onTap: { appState.openReader(story: story) },
                        onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var writersToFollowSection: some View {
        if appState.isAuthenticated {
            WritersToFollowSection()
        }
    }

    private var genreSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(title: "Browse by Genre")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: KathaTheme.Spacing.s) {
                    ForEach(Genre.allCases.filter { !(appState.kidsMode && $0 == .erotica) }) { genre in
                        GenreChip(genre: genre, isSelected: false)
                    }
                }
            }
        }
    }
}

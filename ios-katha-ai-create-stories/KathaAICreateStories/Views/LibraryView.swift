//
//  LibraryView.swift
//  KathaAICreateStories
//

import SwiftUI

struct LibraryView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedTab = 0

    var body: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.l) {
                // New chapter banner
                if appState.hasUnreadNewChapters {
                    NewChapterBanner {
                        // Scroll to top — the banner is already at top
                    }
                }

                header

                if !appState.isAuthenticated {
                    unauthenticatedState
                } else {
                    authenticatedContent
                }

                SafeBottomSpacer()
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
        }
        .themedBackground()
        .scrollIndicators(.hidden)
    }

    private var header: some View {
        HStack {
            Text("Library")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)
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
            SegmentedControl(options: ["Saved", "Liked", "Published", "History", "Downloads"], selection: $selectedTab)

            switch selectedTab {
            case 0: savedTab
            case 1: likedTab
            case 2: publishedTab
            case 3: historyTab
            default: downloadsTab
            }
        }
    }

    private var savedTab: some View {
        let bookmarked = SeedData.stories.filter { appState.isBookmarked($0.id) && appState.isStoryVisibleInKidsMode($0) }
        return storyGrid(bookmarked, emptyMessage: "Stories you bookmark will appear here.")
    }

    private var likedTab: some View {
        let liked = SeedData.stories.filter { appState.isLiked($0.id) && appState.isStoryVisibleInKidsMode($0) }
        return storyGrid(liked, emptyMessage: "Stories you like will appear here.")
    }

    private var publishedTab: some View {
        let published = appState.publishedStories.map { $0.asStory }
        return storyGrid(published, emptyMessage: "Stories you create will appear here.")
    }

    private var historyTab: some View {
        let progressIds = appState.readingProgress.keys
        let history = SeedData.stories.filter { progressIds.contains($0.id) && appState.isStoryVisibleInKidsMode($0) }
        return storyGrid(history, emptyMessage: "Stories you've read will appear here.")
    }

    private var downloadsTab: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            if appState.offlineStoryRecords.isEmpty {
                EmptyState(icon: "icloud.slash", title: "No stories downloaded yet", message: "Tap the download icon in any story to save it for offline.")
            } else {
                ForEach(appState.offlineStoryRecords) { record in
                    if let story = SeedData.stories.first(where: { $0.id == record.storyId }) {
                        HStack { CompactStoryCard(story: story, onTap: { appState.openReader(story: story) }); Spacer(); Text("Offline ✓").font(.system(size: 11, weight: .semibold)).foregroundStyle(KathaTheme.success) }
                    }
                }
            }
        }
    }

    private func storyGrid(_ stories: [Story], emptyMessage: String) -> some View {
        Group {
            if stories.isEmpty {
                EmptyState(
                    icon: "tray",
                    title: "Nothing here yet",
                    message: emptyMessage
                )
                .padding(.top, KathaTheme.Spacing.xxxl)
            } else {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: KathaTheme.Spacing.m),
                        GridItem(.flexible(), spacing: KathaTheme.Spacing.m)
                    ],
                    spacing: KathaTheme.Spacing.l
                ) {
                    ForEach(stories) { story in
                        CompactStoryCard(
                            story: story,
                            onTap: { appState.openReader(story: story) },
                            onAuthorTap: { appState.openAuthorProfile(story.authorId) }
                        )
                    }
                }
            }
        }
    }
}

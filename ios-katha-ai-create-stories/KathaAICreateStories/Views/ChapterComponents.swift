//
//  ChapterComponents.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Series Progress Badge

struct SeriesProgressBadge: View {
    let story: Story
    let isAuthor: Bool

    private var badgeText: String {
        let chapterCount = story.chapters.count
        let planned = story.plannedChapterCount

        if let planned = planned, chapterCount >= planned {
            return "SERIES COMPLETE ✨"
        } else if let planned = planned, chapterCount < planned {
            return isAuthor ? "CHAPTER \(chapterCount) OF \(planned) PLANNED" : "MORE CHAPTERS COMING ✨"
        } else if chapterCount > 1 {
            return "ONGOING SERIES"
        }
        return ""
    }

    private var useAccent: Bool {
        let chapterCount = story.chapters.count
        let planned = story.plannedChapterCount
        if let planned = planned, chapterCount >= planned { return true }
        if let planned = planned, chapterCount < planned, !isAuthor { return true }
        return false
    }

    var body: some View {
        if !badgeText.isEmpty {
            Text(badgeText)
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(useAccent ? KathaTheme.accent : KathaTheme.textTertiary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    Capsule()
                        .fill(useAccent ? KathaTheme.accentSoft : Color.clear)
                )
                .overlay(
                    Capsule()
                        .stroke(useAccent ? Color.clear : KathaTheme.border, lineWidth: 1)
                )
                .transition(.scale(scale: 0.9).combined(with: .opacity))
        }
    }
}

// MARK: - Chapter Nav Button

struct ChapterNavButton: View {
    let direction: ChapterNavDirection
    let action: () -> Void

    enum ChapterNavDirection {
        case left, right
    }

    var body: some View {
        Button {
            Haptics.light()
            action()
        } label: {
            Image(systemName: direction == .left ? "chevron.left" : "chevron.right")
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 40, height: 40)
                .background(
                    Circle()
                        .fill(.ultraThinMaterial)
                )
                .overlay(
                    Circle()
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
                .foregroundStyle(KathaTheme.textPrimary)
        }
        .buttonStyle(PressScaleStyle())
    }
}

// MARK: - DRAFT Pill

struct DraftPill: View {
    var body: some View {
        Text("DRAFT")
            .font(.system(size: 10, weight: .bold))
            .tracking(0.5)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(KathaTheme.accent))
    }
}

// MARK: - Draft Reader Banner

struct DraftReaderBanner: View {
    var body: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: "pencil.line")
                .font(.system(size: 18))
                .foregroundStyle(KathaTheme.accent)

            Text("This chapter is a draft. Not visible to readers.")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)

            Spacer()
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
        .frame(maxWidth: .infinity)
        .background(KathaTheme.accentSoft)
    }
}

// MARK: - Author End of Chapter CTAs

struct AuthorEndOfChapterCTAs: View {
    @Environment(AppState.self) private var appState
    let story: Story
    let chapter: Chapter

    private var ctaLabel: String {
        let chapterCount = story.chapters.count
        let planned = story.plannedChapterCount

        if let planned = planned, chapterCount < planned {
            return "Continue this story ▸ (Chapter \(chapterCount + 1))"
        } else if let planned = planned, chapterCount == planned {
            return "Add another chapter ▸"
        } else {
            return "Continue this story ▸"
        }
    }

    private var followerCount: Int {
        appState.storyFollowerCount(storyId: story.id, baseCount: story.followerCount)
    }

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.xl) {
            Divider().overlay(KathaTheme.border)

            // Engagement row (display-only for author)
            HStack(spacing: KathaTheme.Spacing.l) {
                Label(formatCount(story.likes), systemImage: "heart")
                    .font(.system(size: 13))
                    .foregroundStyle(KathaTheme.textSecondary)
                Label(formatCount(story.bookmarks), systemImage: "bookmark")
                    .font(.system(size: 13))
                    .foregroundStyle(KathaTheme.textSecondary)
                Label(formatCount(story.views), systemImage: "eye")
                    .font(.system(size: 13))
                    .foregroundStyle(KathaTheme.textTertiary)
                Spacer()
            }
            .onTapGesture {
                Haptics.light()
                appState.showToast("Analytics coming in the next update ✨")
            }

            PrimaryCTA(title: ctaLabel, icon: "pencil.line") {
                appState.startContinueWizard(story: story)
            }

            TextLink(title: "View chapter stats ▸") {
                Haptics.light()
                appState.showToast("Chapter analytics coming in the next update ✨")
            }
            .frame(maxWidth: .infinity)

            // Follower waiting card
            if followerCount > 0 {
                HStack(spacing: KathaTheme.Spacing.s) {
                    Text("**\(followerCount)**")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("followers are waiting for your next chapter.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Spacer()
                }
                .padding(KathaTheme.Spacing.l)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(KathaTheme.accentSoft)
                )
            }
        }
    }
}

// MARK: - Draft Reader Bottom Bar

struct DraftReaderBottomBar: View {
    @Environment(AppState.self) private var appState
    let story: Story
    let chapter: Chapter

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.xl) {
            Divider().overlay(KathaTheme.border)

            Text("Preview complete.")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text("Publish when you're ready — followers will be notified.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)

            PrimaryCTA(
                title: "Publish chapter",
                isLoading: appState.isPublishing
            ) {
                appState.requestPublishChapter(storyId: story.id, chapterId: chapter.id)
            }

            TextLink(title: "Continue writing without publishing yet") {
                Haptics.light()
                appState.startContinueWizard(story: story)
            }
            .frame(maxWidth: .infinity)

            DestructiveCTA(title: "Delete draft") {
                appState.requestDeleteDraft(storyId: story.id, chapterId: chapter.id)
            }
        }
    }
}

// MARK: - Reader End of Chapter (Reader View)

struct ReaderEndOfChapterCTAs: View {
    @Environment(AppState.self) private var appState
    let story: Story

    private var isFollowing: Bool {
        appState.isFollowingStory(story.id)
    }

    private var followerCount: Int {
        appState.storyFollowerCount(storyId: story.id, baseCount: story.followerCount)
    }

    private var followLabel: String {
        let chapterCount = story.chapters.count
        let planned = story.plannedChapterCount

        if isFollowing {
            return "Following this story ✓"
        }

        if let planned = planned, chapterCount < planned {
            return "Get notified when Chapter \(chapterCount + 1) drops"
        }

        if followerCount > 0 {
            return "Follow this story (\(followerCount))"
        }

        return "Follow this story"
    }

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            Divider().overlay(KathaTheme.border)

            // Follow story button
            Button {
                Haptics.light()
                appState.toggleFollowStory(
                    storyId: story.id,
                    storyTitle: story.title,
                    followerCount: followerCount
                )
            } label: {
                Text(followLabel)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(isFollowing ? KathaTheme.accent : KathaTheme.textPrimary)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(isFollowing ? KathaTheme.accentSoft : KathaTheme.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(KathaTheme.border, lineWidth: 1)
                            )
                    )
            }
            .buttonStyle(PressScaleStyle())

            // Follow author
            if let author = SeedData.author(id: story.authorId) {
                AuthorRow(
                    author: author,
                    isFollowing: appState.isFollowing(author.id),
                    onFollow: { appState.toggleFollow(authorId: author.id) }
                )
                .padding(KathaTheme.Spacing.l)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                        .fill(KathaTheme.surface)
                )
            }

            // Write yours cross-sell
            PrimaryCTA(title: "Write yours ▸", icon: "pencil.line") {
                Haptics.light()
                appState.showToast("Create your own story from the Create tab")
            }
        }
    }
}

// MARK: - Chapter List Sheet

struct ChapterListSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let story: Story

    private var isAuthor: Bool {
        story.authorId == appState.currentUser?.username
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: KathaTheme.Spacing.xs) {
                HStack {
                    Text(story.title)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        Haptics.light()
                        appState.dismissChapterList()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                }

                // Sub-header
                Text(subHeaderText)
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(KathaTheme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.top, KathaTheme.Spacing.l)
            .padding(.bottom, KathaTheme.Spacing.m)

            // Chapter list
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(story.chapters.enumerated()), id: \.element.id) { index, chapter in
                        ChapterRow(
                            chapter: chapter,
                            chapterIndex: index,
                            isCurrent: index == appState.currentChapterIndex,
                            isAuthor: isAuthor
                        ) {
                            Haptics.light()
                            appState.navigateToChapter(index: index)
                            appState.dismissChapterList()
                        }
                    }
                }
            }

            // Sticky bottom for author
            if isAuthor {
                VStack(spacing: 0) {
                    Divider().overlay(KathaTheme.border)

                    PrimaryCTA(title: "+ Continue story", icon: "plus") {
                        Haptics.light()
                        appState.dismissChapterList()
                        appState.startContinueWizard(story: story)
                    }
                    .padding(KathaTheme.Spacing.l)

                    SafeBottomSpacer(height: 20)
                }
                .background(KathaTheme.surface)
            }
        }
        .background(KathaTheme.surface)
        .presentationDetents([.fraction(0.7)])
        .presentationDragIndicator(.visible)
    }

    private var subHeaderText: String {
        let publishedCount = story.publishedChapterCount
        let draftCount = story.draftChapterCount

        if isAuthor {
            if draftCount > 0 {
                return "\(publishedCount) PUBLISHED · \(draftCount) DRAFTS"
            } else {
                return "\(publishedCount) PUBLISHED"
            }
        } else {
            return "\(publishedCount) CHAPTERS"
        }
    }
}

// MARK: - Chapter Row

struct ChapterRow: View {
    let chapter: Chapter
    let chapterIndex: Int
    let isCurrent: Bool
    let isAuthor: Bool
    let onTap: () -> Void

    private var isDraft: Bool { !chapter.isPublished }

    var body: some View {
        Button {
            Haptics.light()
            onTap()
        } label: {
            HStack(spacing: KathaTheme.Spacing.m) {
                // Chapter number
                Text("CH. \(String(format: "%02d", chapterIndex + 1))")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(KathaTheme.textTertiary)
                    .frame(width: 50, alignment: .leading)

                // Middle
                VStack(alignment: .leading, spacing: 2) {
                    Text(chapter.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .lineLimit(1)
                    Text("\(chapter.readingTimeMinutes) min read")
                        .font(.system(size: 11))
                        .foregroundStyle(KathaTheme.textSecondary)
                }

                Spacer()

                // Status indicator
                if isDraft && isAuthor {
                    Text("DRAFT")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(KathaTheme.accent))
                } else if isCurrent {
                    Circle()
                        .fill(KathaTheme.accent)
                        .frame(width: 10, height: 10)
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.vertical, 14)
            .background(
                Rectangle()
                    .fill(isCurrent ? KathaTheme.accentSoft : Color.clear)
            )
            .overlay(
                Rectangle()
                    .fill(KathaTheme.border.opacity(0.5))
                    .frame(height: 1)
                    .padding(.leading, KathaTheme.Spacing.l)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            )
        }
        .buttonStyle(PressScaleStyle(scale: 0.99))
    }
}

// MARK: - New Chapter Banner

struct NewChapterBanner: View {
    @Environment(AppState.self) private var appState
    let onTap: () -> Void

    private var notifications: [NewChapterNotification] {
        appState.unreadNewChapterNotifications
    }

    var body: some View {
        if !notifications.isEmpty {
            let count = notifications.count
            let first = notifications.first!

            HStack(spacing: KathaTheme.Spacing.m) {
                Image(systemName: "sparkles")
                    .font(.system(size: 18))
                    .foregroundStyle(KathaTheme.accent)

                Text(bannerText(count: count, first: first))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .lineLimit(2)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 18))
                    .foregroundStyle(KathaTheme.textTertiary)

                Button {
                    Haptics.light()
                    if let firstStoryId = notifications.first?.storyId {
                        appState.dismissNewChapterBanner(storyId: firstStoryId)
                    }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textTertiary)
                }
            }
            .padding(KathaTheme.Spacing.m)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(KathaTheme.accentSoft)
            )
            .padding(.horizontal, KathaTheme.Spacing.m)
            .padding(.top, KathaTheme.Spacing.m)
            .onTapGesture {
                Haptics.light()
                onTap()
            }
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private func bannerText(count: Int, first: NewChapterNotification) -> String {
        if count == 1 {
            return "Chapter \(first.chapterNumber) of '\(first.storyTitle)' is here"
        } else {
            return "\(count) new chapters from stories you follow"
        }
    }
}

// MARK: - New Chapters Home Section

struct NewChaptersHomeSection: View {
    @Environment(AppState.self) private var appState
    let onTapStory: (Story, Int) -> Void

    private var notifications: [NewChapterNotification] {
        appState.unreadNewChapterNotifications.sorted { $0.publishedAt > $1.publishedAt }
    }

    var body: some View {
        if !notifications.isEmpty {
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                SectionHeader(title: "New chapters ✨")

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: KathaTheme.Spacing.m) {
                        ForEach(notifications) { notif in
                            NewChapterCard(notification: notif) {
                                // Find the story and open to the new chapter
                                if let story = SeedData.stories.first(where: { $0.id == notif.storyId }) {
                                    let chapterIndex = min(notif.chapterNumber - 1, max(0, story.chapters.count - 1))
                                    onTapStory(story, chapterIndex)
                                    appState.markChapterAsRead(storyId: notif.storyId, chapterNumber: notif.chapterNumber)
                                }
                            }
                            .frame(width: 140)
                        }
                    }
                    .padding(.horizontal, KathaTheme.Spacing.l)
                }
            }
            .transition(.opacity.combined(with: .move(edge: .leading)))
        }
    }
}

// MARK: - New Chapter Card

struct NewChapterCard: View {
    let notification: NewChapterNotification
    let onTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            // Cover with NEW pill
            LinearGradient(
                colors: notification.coverColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .overlay(alignment: .topTrailing) {
                Text("NEW")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(KathaTheme.accent))
                    .padding(8)
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .bottomLeading) {
                Text(notification.storyTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(8)
                    .lineLimit(2)
                    .allowsHitTesting(false)
            }
            .frame(height: 180)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .onTapGesture { Haptics.light(); onTap() }

            Text("Chapter \(notification.chapterNumber) just dropped")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(KathaTheme.accent)
                .lineLimit(1)
        }
        .onTapGesture { Haptics.light(); onTap() }
    }
}

//
//  ReaderView.swift
//  KathaAICreateStories
//

import SwiftUI

private struct ReaderScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct ReaderContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct ReaderView: View {
    @Environment(AppState.self) private var appState
    let story: Story

    @State private var scrollOffset: CGFloat = 0
    @State private var contentHeight: CGFloat = 1
    @State private var showNavButtons: Bool = true
    @State private var progressVisible: Bool = false
    @State private var progressHideToken = UUID()
    @State private var heartScale: CGFloat = 1
    @State private var burstActive = false

    private var currentChapter: Chapter? {
        guard story.chapters.indices.contains(appState.currentChapterIndex) else {
            return story.chapters.first
        }
        return story.chapters[appState.currentChapterIndex]
    }

    private var isCurrentUserAuthor: Bool {
        story.authorId == appState.currentUser?.username
    }

    private var isDraftChapter: Bool {
        currentChapter?.isPublished == false
    }

    private var authWallIndex: Int {
        guard let firstChapter = story.chapters.first else { return 0 }
        return max(1, Int(Double(firstChapter.paragraphs.count) * 0.4))
    }

    private var readerBg: Color {
        appState.readerSepia ? KathaTheme.sepiaCanvas : KathaTheme.canvas
    }

    private var readerText: Color {
        appState.readerSepia ? KathaTheme.sepiaText : KathaTheme.textPrimary
    }

    private var readerTextSecondary: Color {
        appState.readerSepia ? KathaTheme.sepiaTextSecondary : KathaTheme.textSecondary
    }

    private var readerSurface: Color {
        appState.readerSepia ? KathaTheme.sepiaSurface : KathaTheme.surface
    }

    @ViewBuilder
    var body: some View {
        if appState.kidsMode && story.effectiveContentRating == .mature {
            RestrictedStoryPlaceholder()
        } else {
            readerContent
        }
    }

    private var readerContent: some View {
        GeometryReader { viewport in
            ZStack(alignment: .top) {
                ScrollView {
                    VStack(spacing: KathaTheme.Spacing.l) {
                        GeometryReader { proxy in
                            Color.clear.preference(key: ReaderScrollOffsetKey.self, value: proxy.frame(in: .named("readerScroll")).minY)
                        }
                        .frame(height: 0)

                        if isDraftChapter && isCurrentUserAuthor {
                            DraftReaderBanner().padding(.top, KathaTheme.Spacing.xxl48)
                        }

                        StoryCoverView(story: story, height: 280, titleSize: 24)
                            .padding(.top, isDraftChapter ? 0 : KathaTheme.Spacing.xxl48)
                        metadataSection
                        authorSection

                        if appState.isAuthenticated {
                            chapterContent
                            if !isDraftChapter { commentsSection }
                            endOfChapterSection
                        } else {
                            partialContent
                        }

                        SafeBottomSpacer(height: 80)
                    }
                    .padding(.horizontal, KathaTheme.Spacing.l)
                    .background(GeometryReader { proxy in
                        Color.clear.preference(key: ReaderContentHeightKey.self, value: proxy.size.height)
                    })
                }
                .coordinateSpace(name: "readerScroll")
                .background(readerBg)
                .scrollIndicators(.hidden)
                .safeAreaInset(edge: .bottom) {
                    VStack(spacing: 0) {
                        if !isDraftChapter { AudioMiniBar(story: story) }
                        if !(isDraftChapter && isCurrentUserAuthor) { engagementBar }
                    }
                }

                topBar
                    .opacity(showNavButtons ? 1 : 0)
                    .offset(y: showNavButtons ? 0 : -80)
                    .allowsHitTesting(showNavButtons)
                    .animation(.spring(response: 0.25, dampingFraction: 0.8), value: showNavButtons)

                progressBar

                if story.isSeries && appState.isAuthenticated {
                    chapterNavOverlay
                        .opacity(showNavButtons ? 1 : 0)
                        .allowsHitTesting(showNavButtons)
                        .animation(.spring(response: 0.25, dampingFraction: 0.8), value: showNavButtons)
                }
            }
            .onPreferenceChange(ReaderScrollOffsetKey.self) { value in
                let current = max(0, -value)
                let delta = current - scrollOffset
                scrollOffset = current
                let maxScroll = max(contentHeight - viewport.size.height, 1)
                if current <= KathaTheme.Spacing.s || !appState.isAuthenticated {
                    showNavButtons = true
                } else if abs(delta) >= KathaTheme.Spacing.s {
                    showNavButtons = delta < 0
                }
                progressVisible = true
                let token = UUID()
                progressHideToken = token
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    if progressHideToken == token {
                        withAnimation(.easeOut(duration: 0.3)) { progressVisible = false }
                    }
                }
                _ = min(1, max(0, current / maxScroll))
            }
            .onPreferenceChange(ReaderContentHeightKey.self) { contentHeight = max(1, $0) }
        }
        .onAppear { appState.beginReaderStreakActivity() }
    }

    private var progressBar: some View {
        GeometryReader { proxy in
            let maxScroll = max(contentHeight - proxy.size.height, 1)
            let progress = min(1, max(0, scrollOffset / maxScroll))
            ZStack(alignment: .leading) {
                Rectangle().fill(KathaTheme.borderStrong.opacity(0.4)).frame(height: 2)
                Rectangle().fill(appState.readerSepia ? KathaTheme.sepiaAccent : KathaTheme.accent).frame(width: proxy.size.width * progress, height: 2)
            }
            .opacity(progressVisible ? 1 : 0)
            .animation(.easeOut(duration: 0.1), value: progressVisible)
        }
        .frame(height: 2)
        .padding(.top, KathaTheme.Spacing.xxl48)
        .allowsHitTesting(false)
    }

    // MARK: - Top Bar

    private var topBar: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Button {
                Haptics.light()
                appState.closeReader()
            } label: {
                Image(systemName: "xmark")
                    .font(KathaFont.BodyStrong)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .foregroundStyle(KathaTheme.textPrimary)
            }

            Spacer()

            if isDraftChapter && isCurrentUserAuthor {
                DraftPill()
                    .transition(.opacity)
            }

            Button {
                Haptics.light()
                appState.toggleReaderSepia()
            } label: {
                Image(systemName: appState.readerSepia ? "book.fill" : "book")
                    .font(KathaFont.BodyStrong)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .foregroundStyle(appState.readerSepia ? KathaTheme.accent : KathaTheme.textPrimary)
            }

            Button {
                Haptics.light()
                appState.toggleBookmark(storyId: story.id)
            } label: {
                Image(systemName: appState.isBookmarked(story.id) ? "bookmark.fill" : "bookmark")
                    .font(KathaFont.BodyStrong)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .foregroundStyle(appState.isBookmarked(story.id) ? KathaTheme.accent : KathaTheme.textPrimary)
            }

            Button {
                Haptics.light()
                if appState.downloadedStoryIds.contains(story.id) { appState.removeOfflineStory(story.id) } else { appState.downloadStory(story) }
            } label: {
                Image(systemName: appState.downloadedStoryIds.contains(story.id) ? "checkmark.icloud.fill" : "icloud.and.arrow.down")
                    .font(KathaFont.BodyStrong)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .foregroundStyle(appState.downloadedStoryIds.contains(story.id) ? KathaTheme.success : KathaTheme.textPrimary)
            }

            Button {
                Haptics.light()
                appState.openAudioPlayer(story: story)
            } label: {
                Image(systemName: "headphones")
                    .font(KathaFont.BodyStrong)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .foregroundStyle(KathaTheme.textPrimary)
            }

            Button {
                Haptics.light()
                appState.showChapterList()
            } label: {
                Image(systemName: "list.bullet")
                    .font(KathaFont.BodyStrong)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .foregroundStyle(KathaTheme.textPrimary)
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.s)
    }

    // MARK: - Chapter Nav Overlay

    private var chapterNavOverlay: some View {
        HStack {
            if appState.currentChapterIndex > 0 {
                ChapterNavButton(direction: .left) {
                    appState.navigateToPreviousChapter()
                }
                .transition(.opacity)
            }

            Spacer()

            let isLastPublished = appState.currentChapterIndex >= story.chapters.count - 1
            let isLastForAuthor = appState.currentChapterIndex >= story.chapters.count - 1

            if isCurrentUserAuthor {
                if !isLastForAuthor {
                    ChapterNavButton(direction: .right) {
                        appState.navigateToNextChapter()
                    }
                    .transition(.opacity)
                }
            } else {
                // Readers can't navigate to draft chapters
                let nextIndex = appState.currentChapterIndex + 1
                if nextIndex < story.chapters.count && story.chapters[nextIndex].isPublished {
                    ChapterNavButton(direction: .right) {
                        appState.navigateToNextChapter()
                    }
                    .transition(.opacity)
                }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.xs)
        .frame(maxHeight: .infinity)
        .allowsHitTesting(true)
    }

    // MARK: - Metadata

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            Text(story.title)
                .font(KathaFont.ReaderStoryTitle)
                .foregroundStyle(readerText)

            HStack(spacing: KathaTheme.Spacing.s) {
                Text(story.genre.displayName)
                Text(story.language.uppercased())
                    .font(KathaFont.Meta)
                    .padding(.horizontal, KathaTheme.Spacing.s)
                    .frame(height: 20)
                    .overlay(Capsule().stroke(readerTextSecondary.opacity(0.45), lineWidth: 1))
                    .clipShape(Capsule())
                Text("\u{2022}")
                if let chapter = currentChapter, story.isSeries {
                    Text("Chapter \(appState.currentChapterIndex + 1) of \(story.chapters.count)")
                        .font(KathaFont.ReaderChapterNumber)
                } else {
                    Text("\(story.readingTimeMinutes) min read")
                }
                Text("\u{2022}")
                Text(timeAgo(story.publishedOffset))
            }
            .font(KathaFont.Caption)
            .foregroundStyle(readerTextSecondary)

            Text(story.synopsis)
                .font(KathaFont.Body)
                .foregroundStyle(readerTextSecondary)
                .lineSpacing(4)

            // Series progress badge
            if story.isSeries {
                SeriesProgressBadge(story: story, isAuthor: isCurrentUserAuthor)
                    .padding(.top, KathaTheme.Spacing.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Author

    private var authorSection: some View {
        Group {
            if isCurrentUserAuthor {
                currentUserAuthorCard
            } else if let author = SeedData.author(id: story.authorId) {
                HStack(spacing: KathaTheme.Spacing.m) {
                    Button {
                        Haptics.light()
                        appState.openAuthorProfile(author.id)
                    } label: {
                        HStack(spacing: KathaTheme.Spacing.m) {
                            GeneratedAvatar(username: author.username, displayName: author.displayName, size: 44)

                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 3) {
                                    Text(author.displayName)
                                        .font(KathaFont.BodyStrong)
                                        .foregroundStyle(KathaTheme.textPrimary)
                                    if author.isVerified {
                                        Image(systemName: "checkmark.seal.fill")
                                            .font(KathaFont.Meta)
                                            .foregroundStyle(KathaTheme.accent)
                                    }
                                }
                                Text("@\(author.username)")
                                    .font(KathaFont.Meta)
                                    .foregroundStyle(KathaTheme.textSecondary)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    FollowButton(
                        isFollowing: appState.isFollowing(author.id),
                        size: .small
                    ) {
                        // Reader hero skips the unfollow confirmation modal
                        appState.toggleFollowAuthor(authorId: author.id, confirmUnfollow: false)
                    }
                }
                .padding(KathaTheme.Spacing.l)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                        .fill(readerSurface)
                )
            }
        }
    }

    private var currentUserAuthorCard: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            if let user = appState.currentUser {
                GeneratedAvatar(username: user.username, displayName: user.displayName, size: 44)

                VStack(alignment: .leading, spacing: 2) {
                    Text(user.displayName.isEmpty ? user.username : user.displayName)
                        .font(KathaFont.BodyStrong)
                        .foregroundStyle(readerText)
                    Text("@\(user.username) • You")
                        .font(KathaFont.Meta)
                        .foregroundStyle(readerTextSecondary)
                }
            }

            Spacer()
        }
        .padding(KathaTheme.Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .fill(readerSurface)
        )
    }

    // MARK: - Chapter Content

    private var chapterContent: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.xl) {
            if let chapter = currentChapter {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                    Text(chapter.title)
                        .font(KathaFont.ReaderChapterTitle)
                        .foregroundStyle(readerText)

                    let firstProseIndex = chapter.paragraphs.firstIndex { paragraph in
                        let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
                        return !trimmed.isEmpty && trimmed != "· · ·"
                    }
                    ForEach(Array(chapter.paragraphs.enumerated()), id: \.offset) { index, para in
                        if index == firstProseIndex {
                            ReaderDropCapParagraph(text: para, bodySize: CGFloat(appState.readerFontSize), textColor: readerText, accent: appState.readerSepia ? KathaTheme.sepiaAccent : KathaTheme.accent)
                        } else {
                            Text(para)
                                .font(KathaFont.readerBody(size: CGFloat(appState.readerFontSize)))
                                .foregroundStyle(readerText)
                                .lineSpacing(8)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    // MARK: - End of Chapter

    @ViewBuilder
    private var endOfChapterSection: some View {
        if isDraftChapter && isCurrentUserAuthor {
            // Draft state - author view
            if let chapter = currentChapter {
                DraftReaderBottomBar(story: story, chapter: chapter)
            }
        } else if isCurrentUserAuthor {
            // Author view - published chapter
            if let chapter = currentChapter {
                AuthorEndOfChapterCTAs(story: story, chapter: chapter)
            }
        } else {
            // Reader view
            ReaderEndOfChapterCTAs(story: story)
        }
    }

    // MARK: - Partial Content (Unauthenticated)

    private var partialContent: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            if let firstChapter = story.chapters.first {
                Text(firstChapter.title)
                    .font(KathaFont.ReaderChapterTitle)
                    .foregroundStyle(readerText)

                let visibleParagraphs = Array(firstChapter.paragraphs.prefix(authWallIndex))
                ForEach(Array(visibleParagraphs.enumerated()), id: \.offset) { index, para in
                    if index == visibleParagraphs.firstIndex(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0 != "· · ·" }) {
                        ReaderDropCapParagraph(text: para, bodySize: CGFloat(appState.readerFontSize), textColor: readerText, accent: appState.readerSepia ? KathaTheme.sepiaAccent : KathaTheme.accent)
                    } else {
                        Text(para)
                            .font(KathaFont.readerBody(size: CGFloat(appState.readerFontSize)))
                            .foregroundStyle(readerText)
                            .lineSpacing(8)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            authWall
                .overlay(alignment: .bottom) {
                    if let firstChapter = story.chapters.first {
                        let hiddenParagraphs = Array(firstChapter.paragraphs.dropFirst(authWallIndex))
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.xl) {
                            ForEach(Array(hiddenParagraphs.enumerated()), id: \.offset) { index, paragraph in
                                Text(paragraph)
                                    .font(KathaFont.readerBody(size: CGFloat(appState.readerFontSize)))
                                    .foregroundStyle(readerText)
                                    .lineSpacing(8)
                                    .blur(radius: min(60, CGFloat(index + 1) * 8))
                                    .overlay(readerBg.opacity(0.12))
                            }
                        }
                        .padding(.top, KathaTheme.Spacing.l)
                    }
                }
        }
    }

    // MARK: - Auth Wall

    private var authWall: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(readerSurface.opacity(0.96))
                .frame(height: 60)
                .blur(radius: 4)

            VStack(spacing: KathaTheme.Spacing.m) {
                Image(systemName: "lock.fill")
                    .font(KathaFont.Display)
                    .foregroundStyle(KathaTheme.textTertiary)

                Text("Keep reading")
                    .font(KathaFont.Title2)
                    .foregroundStyle(KathaTheme.textPrimary)

                Text("Sign in to continue this story and save your progress.")
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                PrimaryCTA(title: "Sign in to continue", icon: "arrow.right") {
                    appState.presentAuthSheet(readerWall: true, pendingStory: story)
                }
                .padding(.horizontal, KathaTheme.Spacing.xl)
            }
            .padding(.vertical, KathaTheme.Spacing.xxl)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Comments

    private var commentsSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            let count = appState.commentCount(storyId: story.id)
            SectionHeader(title: "Comments")

            if count == 0 {
                Text("No comments yet. Be the first to share your thoughts.")
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.textSecondary)
                    .padding(KathaTheme.Spacing.l)
            } else {
                // Preview: show top 2 comments
                let comments = appState.commentsFor(storyId: story.id)
                    .sorted { appState.commentLikeCount(comment: $0) > appState.commentLikeCount(comment: $1) }
                ForEach(comments.prefix(2)) { comment in
                    commentPreview(comment)
                }
                if count > 2 {
                    Button {
                        appState.openCommentsSheet(storyId: story.id)
                    } label: {
                        Text("View all \(count) comments")
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.accent)
                    }
                }
            }
        }
    }

    private func commentPreview(_ comment: StoryComment) -> some View {
        HStack(spacing: KathaTheme.Spacing.s) {
            GeneratedAvatar(username: comment.username, displayName: comment.displayName, size: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(comment.displayName)
                        .font(KathaFont.Meta)
                        .foregroundStyle(readerText)
                    if comment.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.accent)
                    }
                    Text(comment.timeLabel)
                        .font(KathaFont.Meta)
                        .foregroundStyle(KathaTheme.textTertiary)
                }
                Text(comment.text)
                    .font(KathaFont.Caption)
                    .foregroundStyle(readerText)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(KathaTheme.Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.s)
                .fill(readerSurface)
        )
    }

    // MARK: - Engagement Bar

    private var engagementBar: some View {
        HStack(spacing: KathaTheme.Spacing.l) {
            Button {
                if isCurrentUserAuthor {
                    Haptics.light()
                    appState.closeReader()
                    appState.openStoryAnalytics(story: story)
                } else {
                    let wasLiked = appState.isLiked(story.id)
                    appState.toggleLike(storyId: story.id)
                    if appState.isAuthenticated {
                        if !wasLiked {
                            Haptics.medium()
                            burstActive = true
                            withAnimation(.spring(response: 0.2, dampingFraction: 0.5)) { heartScale = 1.15 }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                                withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) { heartScale = 1 }
                            }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { burstActive = false }
                        } else {
                            Haptics.light()
                        }
                    }
                }
            } label: {
                ZStack {
                    HStack(spacing: KathaTheme.Spacing.xs) {
                        Image(systemName: appState.isLiked(story.id) ? "heart.fill" : "heart")
                        Text(formatCount(appState.storyLikeCount(storyId: story.id, baseCount: story.likes)))
                    }
                    .font(KathaFont.Body)
                    .foregroundStyle(appState.isLiked(story.id) ? KathaTheme.heart : KathaTheme.textSecondary)
                    .scaleEffect(heartScale)
                    if burstActive { ReaderLikeParticleBurst() }
                }
            }

            if !appState.kidsMode || appState.kidsCommentsEnabled {
                Button {
                    if !isDraftChapter {
                        appState.openCommentsSheet(storyId: story.id, chapterId: currentChapter?.id)
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "bubble.left")
                        Text(formatCount(appState.commentCount(storyId: story.id)))
                    }
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.textSecondary)
                }
            }

            Button {
                appState.toggleBookmark(storyId: story.id)
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: appState.isBookmarked(story.id) ? "bookmark.fill" : "bookmark")
                    Text(formatCount(story.bookmarks + (appState.isBookmarked(story.id) ? 1 : 0)))
                }
                .font(KathaFont.Body)
                .foregroundStyle(appState.isBookmarked(story.id) ? KathaTheme.accent : KathaTheme.textSecondary)
            }

            Label(formatCount(story.views), systemImage: "book.pages")
                .font(KathaFont.Body)
                .foregroundStyle(KathaTheme.textTertiary)

            Spacer()

            if !appState.kidsMode || appState.kidsShareEnabled {
                Button {
                    Haptics.light()
                    appState.shareStory(story: story, chapterId: currentChapter?.id)
                } label: {
                    Image(systemName: "square.and.arrow.up")
                        .font(KathaFont.Body)
                        .foregroundStyle(KathaTheme.textSecondary)
                }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
        .background(readerSurface)
    }
}

private struct ReaderDropCapParagraph: View {
    let text: String
    let bodySize: CGFloat
    let textColor: Color
    let accent: Color

    private var split: (prefix: String, letter: String, remainder: String) {
        let characters = Array(text)
        guard let index = characters.firstIndex(where: { $0.isLetter }) else {
            return ("", "", text)
        }
        return (
            String(characters[..<index]),
            String(characters[index]),
            String(characters.dropFirst(index + 1))
        )
    }

    var body: some View {
        let parts = split
        HStack(alignment: .top, spacing: 0) {
            if !parts.prefix.isEmpty {
                Text(parts.prefix)
                    .font(KathaFont.readerBody(size: bodySize))
                    .foregroundStyle(textColor)
            }
            Text(parts.letter)
                .font(KathaFont.literata(size: bodySize * 3, weight: .bold))
                .foregroundStyle(accent)
                .frame(width: bodySize * 1.15, height: bodySize * 3.05, alignment: .topLeading)
                .padding(.trailing, KathaTheme.Spacing.xs)
                .padding(.bottom, KathaTheme.Spacing.xs)
            Text(parts.remainder)
                .font(KathaFont.readerBody(size: bodySize))
                .foregroundStyle(textColor)
                .lineSpacing(8)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct ReaderLikeParticleBurst: View {
    @State private var phase: CGFloat = 0

    var body: some View {
        ZStack {
            ForEach(0..<6, id: \.self) { index in
                let angle = Double(index) * Double.pi / 3
                Circle()
                    .fill(KathaTheme.heart)
                    .frame(width: 6, height: 6)
                    .offset(
                        x: CGFloat(cos(angle)) * 26 * phase,
                        y: CGFloat(sin(angle)) * 26 * phase
                    )
                    .scaleEffect(1 - phase * 0.4)
                    .opacity(Double(1 - phase))
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.2)) { phase = 1 }
        }
        .allowsHitTesting(false)
    }
}

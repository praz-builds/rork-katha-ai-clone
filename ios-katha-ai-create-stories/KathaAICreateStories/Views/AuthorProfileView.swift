//
//  AuthorProfileView.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Profile Route Host (renders the overlay stack)

struct ProfileRouteHost: View {
    let route: ProfileRoute

    var body: some View {
        switch route.kind {
        case .profile(let userId):
            AuthorProfileView(userId: userId)
        case .followers(let userId):
            FollowersListView(userId: userId)
        case .following(let userId, let tab):
            FollowingListView(userId: userId, initialTab: tab)
        case .editProfile:
            EditProfileView()
        case .blockedUsers:
            BlockedUsersScreen()
        case .settings:
            SettingsView()
        }
    }
}

// MARK: - Author Profile Screen (own + other variants)

struct AuthorProfileView: View {
    @Environment(AppState.self) private var appState
    /// "me" for own profile, otherwise a seed author id
    let userId: String

    @State private var isLoading = true
    @State private var profileTab = 0

    private var isOwn: Bool { userId == "me" }

    private var author: Author? {
        isOwn ? nil : SeedData.author(id: userId)
    }

    private var displayName: String {
        if isOwn {
            let name = appState.currentUser?.displayName ?? ""
            return name.isEmpty ? (appState.currentUser?.username ?? "") : name
        }
        return author?.displayName ?? ""
    }

    private var username: String {
        isOwn ? (appState.currentUser?.username ?? "") : (author?.username ?? "")
    }

    private var bio: String {
        isOwn ? (appState.currentUser?.bio ?? "") : (author?.bio ?? "")
    }

    private var isVerified: Bool { author?.isVerified ?? false }

    private var followerCount: Int {
        if isOwn { return appState.currentUser?.followers ?? 0 }
        guard let author else { return 0 }
        return appState.authorFollowerCount(authorId: author.id, baseCount: author.followers)
    }

    private var followingCount: Int {
        isOwn ? appState.followedAuthorIds.count : (author?.followingCount ?? 0)
    }

    private var seedStories: [Story] {
        guard let author else { return [] }
        return SeedData.stories(byAuthorId: author.id).sorted { $0.publishedOffset < $1.publishedOffset }
    }

    private var ownPublished: [GeneratedStory] {
        appState.publishedStories
    }

    private var ownDrafts: [GeneratedStory] {
        appState.publishedStories.filter { $0.chapters.contains { !$0.isPublished } }
    }

    private var storyCount: Int {
        isOwn ? ownPublished.count : (author?.storyCount ?? seedStories.count)
    }

    var body: some View {
        ZStack(alignment: .top) {
            KathaTheme.canvas.ignoresSafeArea()

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        Color.clear.frame(height: 56)

                        if isLoading {
                            loadingContent
                        } else {
                            heroSection

                            if isOwn && appState.currentStreak > 0 {
                                StreakBadge(days: appState.currentStreak) {
                                    appState.showToast("Your journey coming in the next update ✨")
                                }
                                .padding(.top, KathaTheme.Spacing.l)
                            }

                            if !isOwn {
                                SegmentedControl(options: ["Stories", "Comments"], selection: $profileTab)
                                    .padding(.horizontal, KathaTheme.Spacing.l)
                                    .padding(.top, KathaTheme.Spacing.l)
                                    .animation(.easeInOut(duration: 0.2), value: profileTab)
                            }

                            if profileTab == 0 || isOwn {
                                storiesSection
                                    .id("stories")
                            } else {
                                commentsTabSection
                                    .id("comments")
                            }
                        }

                        SafeBottomSpacer()
                    }
                }
                .scrollIndicators(.hidden)
                .onChange(of: scrollToStoriesTrigger) { _, _ in
                    withAnimation(.easeInOut(duration: 0.5)) {
                        proxy.scrollTo("stories", anchor: .top)
                    }
                }
            }

            navBar
        }
        .onAppear {
            if isLoading {
                Task {
                    try? await Task.sleep(for: .milliseconds(450))
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isLoading = false
                    }
                }
            }
        }
    }

    @State private var scrollToStoriesTrigger = 0

    // MARK: - Nav Bar

    private var navBar: some View {
        HStack {
            Button {
                Haptics.light()
                appState.popProfileRoute()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            Text("@\(username)")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(1)

            Spacer()

            if isOwn {
                Button {
                    Haptics.light()
                    appState.pushProfileRoute(.settings)
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 17))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .frame(width: 44, height: 44)
                }
            } else {
                Button {
                    Haptics.light()
                    appState.showToast("Sharing coming in the next update ✨")
                } label: {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 17))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .frame(width: 44, height: 44)
                }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.s)
        .frame(height: 56)
        .background(KathaTheme.canvas.opacity(0.95))
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .bottomTrailing) {
                GeneratedAvatar(username: username, displayName: displayName, size: 96)
                    .shadow(color: .black.opacity(0.08), radius: 10, y: 3)

                if isVerified {
                    VerifiedBadge(size: 24)
                        .offset(x: 2, y: 2)
                }
            }

            Text(displayName)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(1)
                .padding(.top, 8)

            Text("@\(username)")
                .font(.system(size: 15))
                .foregroundStyle(KathaTheme.textSecondary)
                .padding(.top, 4)

            if !bio.isEmpty {
                Text(bio)
                    .font(.system(size: 15))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .padding(.horizontal, 40)
                    .padding(.top, 12)
            }

            ProfileStatsRow(
                followers: followerCount,
                following: followingCount,
                stories: storyCount,
                onFollowers: { appState.pushProfileRoute(.followers(userId)) },
                onFollowing: { appState.pushProfileRoute(.following(userId, 0)) },
                onStories: { scrollToStoriesTrigger += 1 }
            )
            .padding(.top, 20)

            actionArea
                .padding(.top, 20)
        }
        .padding(.vertical, KathaTheme.Spacing.xxl)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [KathaTheme.canvas, KathaTheme.accentSoft.opacity(0.55), KathaTheme.canvas],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    @ViewBuilder
    private var actionArea: some View {
        if isOwn {
            VStack(spacing: KathaTheme.Spacing.m) {
                HStack(spacing: KathaTheme.Spacing.m) {
                    SecondaryCTA(title: "Edit profile") {
                        appState.pushProfileRoute(.editProfile)
                    }
                    SecondaryCTA(title: "Share profile") {
                        appState.showToast("Sharing coming in the next update ✨")
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.xl)

                SecondaryCTA(title: "View dashboard", icon: "chart.bar.xaxis") {
                    appState.openDashboard()
                }
                .padding(.horizontal, KathaTheme.Spacing.xl)
            }
        } else if let author {
            FollowButton(
                isFollowing: appState.isFollowing(author.id),
                size: .medium
            ) {
                if appState.isAuthenticated {
                    withAnimation(.spring(duration: 0.35)) {
                        appState.toggleFollowAuthor(authorId: author.id)
                    }
                } else {
                    appState.presentAuthSheet(readerWall: false)
                }
            }
        }
    }

    // MARK: - Stories

    @ViewBuilder
    private var storiesSection: some View {
        if isOwn {
            ownStoriesSection
        } else {
            otherStoriesSection
        }
    }

    @ViewBuilder
    private var otherStoriesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("STORIES", showSeeAll: seedStories.count > 6)

            if seedStories.isEmpty {
                EmptyState(
                    icon: "book.closed",
                    title: "Nothing yet",
                    message: "This writer hasn't published anything yet."
                )
            } else {
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(seedStories) { story in
                        StoryCard(
                            story: story,
                            isLiked: appState.isLiked(story.id),
                            isBookmarked: appState.isBookmarked(story.id),
                            onLike: { appState.toggleLike(storyId: story.id) },
                            onBookmark: { appState.toggleBookmark(storyId: story.id) },
                            onTap: { appState.openReader(story: story) }
                        )
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
            }
        }
    }

    private func ownStoryCard(_ genStory: GeneratedStory, isDraft: Bool) -> some View {
        ZStack(alignment: .topTrailing) {
            let story = genStory.asStory
            StoryCard(
                story: story,
                onTap: { appState.openGeneratedStory(genStory) }
            )
            if isDraft {
                Text("Draft")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(KathaTheme.accent))
                    .padding(KathaTheme.Spacing.m)
            }
        }
    }

    // MARK: - Comments Tab

    private var commentsTabSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            let userComments = appState.commentsByUser(authorId: userId)
            if userComments.isEmpty {
                EmptyState(
                    icon: "bubble.left",
                    title: "No comments yet",
                    message: "\(displayName) hasn't commented on any stories yet."
                )
            } else {
                sectionLabel("COMMENTS", showSeeAll: false)
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(userComments) { comment in
                        UserCommentRow(comment: comment)
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
            }
        }
    }

    @ViewBuilder
    private var ownStoriesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            if ownPublished.isEmpty {
                sectionLabel("STORIES", showSeeAll: false)
                EmptyState(
                    icon: "pencil.and.outline",
                    title: "No stories yet",
                    message: "You haven't written a story yet. It only takes a minute.",
                    ctaTitle: "Write your first story ▸",
                    ctaAction: {
                        appState.closeAllProfiles()
                        appState.requestedTab = 1
                    }
                )
            } else {
                sectionLabel("PUBLISHED", showSeeAll: false)
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(ownPublished) { genStory in
                        ownStoryCard(genStory, isDraft: false)
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.l)

                if !ownDrafts.isEmpty {
                    sectionLabel("DRAFTS", showSeeAll: false)
                        .padding(.top, KathaTheme.Spacing.xxl)
                    VStack(spacing: KathaTheme.Spacing.m) {
                        ForEach(ownDrafts) { genStory in
                            ownStoryCard(genStory, isDraft: true)
                        }
                    }
                    .padding(.horizontal, KathaTheme.Spacing.l)
                }
            }
        }
    }

    private func sectionLabel(_ title: String, showSeeAll: Bool) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(1)
                .foregroundStyle(KathaTheme.textTertiary)
            Spacer()
            if showSeeAll {
                TextLink(title: "See all") {
                    appState.showToast("Full story list coming ✨")
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 32)
        .padding(.bottom, 12)
    }

    // MARK: - Loading

    private var loadingContent: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            Skeleton(width: 96, height: 96, cornerRadius: 48)
                .padding(.top, KathaTheme.Spacing.xxl)
            Skeleton(width: 160, height: 20)
            Skeleton(width: 100, height: 14)
            Skeleton(width: 240, height: 12)
            HStack(spacing: KathaTheme.Spacing.xxxl) {
                ForEach(0..<3, id: \.self) { _ in
                    VStack(spacing: 4) {
                        Skeleton(width: 44, height: 16)
                        Skeleton(width: 60, height: 9)
                    }
                }
            }
            .padding(.top, KathaTheme.Spacing.s)

            VStack(spacing: KathaTheme.Spacing.m) {
                ForEach(0..<3, id: \.self) { _ in
                    StoryCardSkeleton()
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.top, KathaTheme.Spacing.xxl)
        }
    }
}

// MARK: - Followers List Screen

struct FollowersListView: View {
    @Environment(AppState.self) private var appState
    let userId: String

    @State private var query = ""
    @State private var isLoading = true

    private var ownerName: String {
        if userId == "me" {
            let name = appState.currentUser?.displayName ?? ""
            return name.isEmpty ? (appState.currentUser?.username ?? "") : name
        }
        return SeedData.author(id: userId)?.displayName ?? ""
    }

    private var allFollowers: [ProfileUserItem] {
        userId == "me" ? [] : SeedData.followersList(of: userId)
    }

    private var filtered: [ProfileUserItem] {
        guard !query.isEmpty else { return allFollowers }
        return allFollowers.filter { $0.displayName.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: 0) {
                ProfileListNavBar(title: "\(ownerName)'s followers") {
                    appState.popProfileRoute()
                }

                ProfileSearchBar(text: $query, placeholder: "Search followers")
                    .padding(.top, KathaTheme.Spacing.s)

                if isLoading {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(0..<6, id: \.self) { _ in
                                UserListRowSkeleton()
                            }
                        }
                        .padding(.top, KathaTheme.Spacing.m)
                    }
                } else if allFollowers.isEmpty {
                    EmptyState(
                        icon: "person.2",
                        title: "No followers yet",
                        message: userId == "me"
                            ? "When writers follow you, they'll show up here."
                            : "No followers yet."
                    )
                    Spacer()
                } else if filtered.isEmpty {
                    EmptyState(
                        icon: "magnifyingglass",
                        title: "No matches",
                        message: "No followers match \"\(query)\""
                    )
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(filtered) { user in
                                UserListRow(
                                    user: user,
                                    isCurrentUser: user.username == appState.currentUser?.username,
                                    isFollowing: appState.isFollowing(user.id),
                                    onTap: {
                                        if user.isGhost {
                                            appState.showToast("This writer's profile is private")
                                        } else {
                                            appState.openAuthorProfile(user.id)
                                        }
                                    },
                                    onFollow: { appState.toggleFollowAuthor(authorId: user.id) }
                                )
                            }
                            SafeBottomSpacer()
                        }
                        .padding(.top, KathaTheme.Spacing.m)
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
        .onAppear {
            if isLoading {
                Task {
                    try? await Task.sleep(for: .milliseconds(400))
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isLoading = false
                    }
                }
            }
        }
    }
}

// MARK: - Following List Screen (Writers | Stories)

struct FollowingListView: View {
    @Environment(AppState.self) private var appState
    let userId: String
    let initialTab: Int

    @State private var tab: Int = 0
    @State private var query = ""
    @State private var isLoading = true
    @State private var didInit = false

    private var isOwn: Bool { userId == "me" }

    private var ownerName: String {
        if isOwn {
            let name = appState.currentUser?.displayName ?? ""
            return name.isEmpty ? (appState.currentUser?.username ?? "") : name
        }
        return SeedData.author(id: userId)?.displayName ?? ""
    }

    private var followedWriters: [ProfileUserItem] {
        if isOwn {
            return appState.followedAuthorIds.compactMap { id in
                guard let author = SeedData.author(id: id) else { return nil }
                return ProfileUserItem(id: author.id, username: author.username, displayName: author.displayName, bio: author.bio, isVerified: author.isVerified, isGhost: false)
            }
            .sorted { $0.displayName < $1.displayName }
        }
        return SeedData.followingList(of: userId)
    }

    private var followedStories: [Story] {
        guard isOwn else { return [] }
        var result: [Story] = []
        for id in appState.followedStoryIds {
            if let seed = SeedData.stories.first(where: { $0.id == id }) {
                result.append(seed)
            } else if let gen = appState.publishedStories.first(where: { $0.id == id }) {
                result.append(gen.asStory)
            }
        }
        return result
    }

    private var filteredWriters: [ProfileUserItem] {
        guard !query.isEmpty else { return followedWriters }
        return followedWriters.filter { $0.displayName.localizedCaseInsensitiveContains(query) }
    }

    private var filteredStories: [Story] {
        guard !query.isEmpty else { return followedStories }
        return followedStories.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: 0) {
                ProfileListNavBar(title: "\(ownerName) follows") {
                    appState.popProfileRoute()
                }

                SegmentedControl(options: ["Writers", "Stories"], selection: $tab)
                    .padding(.horizontal, 20)
                    .padding(.top, 12)

                ProfileSearchBar(text: $query, placeholder: tab == 0 ? "Search writers" : "Search stories")
                    .padding(.top, KathaTheme.Spacing.m)

                Group {
                    if isLoading {
                        loadingList
                    } else if tab == 0 {
                        writersTab
                    } else {
                        storiesTab
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: tab)
            }
        }
        .onAppear {
            if !didInit {
                didInit = true
                tab = initialTab
            }
            if isLoading {
                Task {
                    try? await Task.sleep(for: .milliseconds(400))
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isLoading = false
                    }
                }
            }
        }
    }

    private var loadingList: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(0..<6, id: \.self) { _ in
                    UserListRowSkeleton()
                }
            }
            .padding(.top, KathaTheme.Spacing.m)
        }
    }

    @ViewBuilder
    private var writersTab: some View {
        if followedWriters.isEmpty {
            VStack {
                EmptyState(
                    icon: "person.2",
                    title: "No writers yet",
                    message: "\(ownerName) doesn't follow any writers yet.",
                    ctaTitle: isOwn ? "Discover writers ▸" : nil,
                    ctaAction: isOwn ? {
                        appState.closeAllProfiles()
                        appState.requestedTab = 0
                    } : nil
                )
                Spacer()
            }
        } else if filteredWriters.isEmpty {
            VStack {
                EmptyState(
                    icon: "magnifyingglass",
                    title: "No matches",
                    message: "No writers match \"\(query)\""
                )
                Spacer()
            }
        } else {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(filteredWriters) { user in
                        UserListRow(
                            user: user,
                            isCurrentUser: user.username == appState.currentUser?.username,
                            isFollowing: appState.isFollowing(user.id),
                            onTap: {
                                if user.isGhost {
                                    appState.showToast("This writer's profile is private")
                                } else {
                                    appState.openAuthorProfile(user.id)
                                }
                            },
                            onFollow: { appState.toggleFollowAuthor(authorId: user.id) }
                        )
                    }
                    SafeBottomSpacer()
                }
                .padding(.top, KathaTheme.Spacing.m)
            }
            .scrollIndicators(.hidden)
        }
    }

    @ViewBuilder
    private var storiesTab: some View {
        if followedStories.isEmpty {
            VStack {
                EmptyState(
                    icon: "book",
                    title: "No stories yet",
                    message: "\(ownerName) doesn't follow any stories yet.",
                    ctaTitle: isOwn ? "Explore stories ▸" : nil,
                    ctaAction: isOwn ? {
                        appState.closeAllProfiles()
                        appState.requestedTab = 0
                    } : nil
                )
                Spacer()
            }
        } else if filteredStories.isEmpty {
            VStack {
                EmptyState(
                    icon: "magnifyingglass",
                    title: "No matches",
                    message: "No stories match \"\(query)\""
                )
                Spacer()
            }
        } else {
            ScrollView {
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(filteredStories) { story in
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
                            if isOwn {
                                Button {
                                    Haptics.light()
                                    appState.toggleFollowStory(
                                        storyId: story.id,
                                        storyTitle: story.title,
                                        followerCount: story.followerCount
                                    )
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(KathaTheme.textSecondary)
                                        .frame(width: 28, height: 28)
                                        .background(Circle().fill(KathaTheme.surfaceElevated))
                                        .overlay(Circle().stroke(KathaTheme.border, lineWidth: 1))
                                }
                                .padding(KathaTheme.Spacing.m)
                            }
                        }
                    }
                    SafeBottomSpacer()
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.top, KathaTheme.Spacing.m)
            }
            .scrollIndicators(.hidden)
        }
    }
}

// MARK: - Shared List Nav Bar

struct ProfileListNavBar: View {
    let title: String
    let onBack: () -> Void

    var body: some View {
        HStack {
            Button {
                Haptics.light()
                onBack()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .frame(width: 44, height: 44)
            }

            Spacer()

            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(1)

            Spacer()

            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, KathaTheme.Spacing.s)
        .frame(height: 56)
    }
}

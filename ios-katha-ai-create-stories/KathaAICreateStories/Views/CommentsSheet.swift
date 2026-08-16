//
//  CommentsSheet.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Comments Sheet Overlay

struct CommentsSheetOverlay: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture { appState.closeCommentsSheet() }

            if let storyId = appState.commentsSheetStoryId {
                CommentsSheet(storyId: storyId)
            }
        }
    }
}

// MARK: - Comments Sheet

struct CommentsSheet: View {
    @Environment(AppState.self) private var appState
    let storyId: String

    @State private var expandedReplies: Set<String> = []

    private var allComments: [StoryComment] {
        let comments = appState.commentsFor(storyId: storyId)
        if appState.commentsSortNewest {
            return comments.sorted { $0.postedOffsetHours < $1.postedOffsetHours }
        }
        return comments.sorted { appState.commentLikeCount(comment: $0) > appState.commentLikeCount(comment: $1) }
    }

    private var topLevelComments: [StoryComment] {
        allComments.filter { $0.replyToUsername == nil }
    }

    private var story: Story? {
        SeedData.stories.first { $0.id == storyId }
    }

    var body: some View {
        VStack(spacing: 0) {
            dragHandle

            header

            ScrollView {
                LazyVStack(spacing: KathaTheme.Spacing.m) {
                    if allComments.isEmpty {
                        commentsEmptyState
                    } else {
                        ForEach(topLevelComments) { comment in
                            CommentCard(
                                comment: comment,
                                replies: repliesFor(comment),
                                isExpanded: expandedReplies.contains(comment.id),
                                onToggleReplies: { toggleReplies(comment.id) },
                                onLike: { appState.toggleCommentLike(comment: comment) },
                                onReply: { appState.startReply(to: comment) },
                                onReport: { appState.requestReport(target: .comment(id: comment.id, authorName: comment.displayName)) },
                                onBlock: { appState.requestBlockUser(authorId: comment.authorId, displayName: comment.displayName) },
                                onAuthorTap: { appState.openAuthorProfile(comment.authorId) },
                                onDelete: { appState.deleteComment(comment.id) }
                            )
                        }
                    }
                    SafeBottomSpacer(height: 100)
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.top, KathaTheme.Spacing.m)
            }
            .scrollIndicators(.hidden)

            CommentComposer()
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(KathaTheme.surface)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private var dragHandle: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(KathaTheme.border)
            .frame(width: 40, height: 4)
            .padding(.top, KathaTheme.Spacing.s)
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Comments")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)
                Text("\(allComments.count) \(allComments.count == 1 ? "comment" : "comments")")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
            }
            Spacer()
            Button {
                Haptics.light()
                withAnimation(.easeInOut(duration: 0.2)) {
                    appState.commentsSortNewest.toggle()
                }
            } label: {
                Text(appState.commentsSortNewest ? "Newest" : "Top")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(KathaTheme.accent)
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.m)
        .padding(.bottom, KathaTheme.Spacing.s)
    }

    private var commentsEmptyState: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 36))
                .foregroundStyle(KathaTheme.textTertiary)
            Text("No comments yet")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
            Text("Be the first to share your thoughts on this story.")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, KathaTheme.Spacing.xxxl)
    }

    private func repliesFor(_ parent: StoryComment) -> [StoryComment] {
        allComments.filter { $0.replyToUsername == parent.username && $0.id != parent.id }
    }

    private func toggleReplies(_ id: String) {
        Haptics.light()
        if expandedReplies.contains(id) {
            expandedReplies.remove(id)
        } else {
            expandedReplies.insert(id)
        }
    }
}

// MARK: - Comment Card

struct CommentCard: View {
    @Environment(AppState.self) private var appState
    let comment: StoryComment
    let replies: [StoryComment]
    let isExpanded: Bool
    let onToggleReplies: () -> Void
    let onLike: () -> Void
    let onReply: () -> Void
    let onReport: () -> Void
    let onBlock: () -> Void
    let onAuthorTap: () -> Void
    let onDelete: () -> Void

    @State private var showOverflow: Bool = false

    private var isOwn: Bool {
        comment.authorId == appState.currentUser?.username
    }

    private var isHighlighted: Bool {
        appState.highlightedCommentId == comment.id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            HStack(spacing: KathaTheme.Spacing.s) {
                Button { onAuthorTap() } label: {
                    GeneratedAvatar(username: comment.username, displayName: comment.displayName, size: 36)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 3) {
                        Text(comment.displayName)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(KathaTheme.textPrimary)
                        if comment.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 10))
                                .foregroundStyle(KathaTheme.accent)
                        }
                    }
                    Text("@\(comment.username)")
                        .font(.system(size: 11))
                        .foregroundStyle(KathaTheme.textSecondary)
                }

                Spacer()

                Text(comment.timeLabel)
                    .font(.system(size: 11))
                    .foregroundStyle(KathaTheme.textTertiary)

                if isOwn {
                    Button {
                        Haptics.light()
                        onDelete()
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 12))
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                } else {
                    Menu {
                        Button("Reply", systemImage: "arrowshape.turn.up.left") { onReply() }
                        Button("Report", systemImage: "flag", role: .destructive) { onReport() }
                        Button("Block @\(comment.username)", systemImage: "hand.raised", role: .destructive) { onBlock() }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 14))
                            .foregroundStyle(KathaTheme.textTertiary)
                            .frame(width: 28, height: 28)
                    }
                }
            }

            Text(comment.text)
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: KathaTheme.Spacing.l) {
                Button { onLike() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: appState.isCommentLiked(comment.id) ? "heart.fill" : "heart")
                        Text(formatCount(appState.commentLikeCount(comment: comment)))
                    }
                    .font(.system(size: 12, weight: appState.isCommentLiked(comment.id) ? .semibold : .regular))
                    .foregroundStyle(appState.isCommentLiked(comment.id) ? KathaTheme.accent : KathaTheme.textSecondary)
                }

                Button { onReply() } label: {
                    Text("Reply")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
            }

            if !replies.isEmpty {
                Button { onToggleReplies() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10))
                        Text("\(replies.count) \(replies.count == 1 ? "reply" : "replies")")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(KathaTheme.accent)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))

                if isExpanded {
                    VStack(spacing: KathaTheme.Spacing.s) {
                        ForEach(replies) { reply in
                            ReplyCard(
                                reply: reply,
                                onLike: { appState.toggleCommentLike(comment: reply) },
                                onReply: { appState.startReply(to: reply) },
                                onReport: { appState.requestReport(target: .comment(id: reply.id, authorName: reply.displayName)) },
                                onBlock: { appState.requestBlockUser(authorId: reply.authorId, displayName: reply.displayName) },
                                onAuthorTap: { appState.openAuthorProfile(reply.authorId) }
                            )
                        }
                    }
                    .padding(.leading, KathaTheme.Spacing.xl)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
        .padding(KathaTheme.Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .fill(isHighlighted ? KathaTheme.accentSoft.opacity(0.3) : KathaTheme.canvas.opacity(0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .stroke(isHighlighted ? KathaTheme.accent.opacity(0.3) : Color.clear, lineWidth: 1)
        )
        .animation(.spring(duration: 0.3), value: isExpanded)
    }
}

// MARK: - Reply Card

struct ReplyCard: View {
    @Environment(AppState.self) private var appState
    let reply: StoryComment
    let onLike: () -> Void
    let onReply: () -> Void
    let onReport: () -> Void
    let onBlock: () -> Void
    let onAuthorTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.xs) {
            HStack(spacing: KathaTheme.Spacing.s) {
                Button { onAuthorTap() } label: {
                    GeneratedAvatar(username: reply.username, displayName: reply.displayName, size: 28)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 3) {
                        Text(reply.displayName)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(KathaTheme.textPrimary)
                        if reply.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(KathaTheme.accent)
                        }
                    }
                    Text("@\(reply.username) \u{2022} \(reply.timeLabel)")
                        .font(.system(size: 10))
                        .foregroundStyle(KathaTheme.textTertiary)
                }

                Spacer()

                Menu {
                    Button("Reply", systemImage: "arrowshape.turn.up.left") { onReply() }
                    Button("Report", systemImage: "flag", role: .destructive) { onReport() }
                    Button("Block @\(reply.username)", systemImage: "hand.raised", role: .destructive) { onBlock() }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 12))
                        .foregroundStyle(KathaTheme.textTertiary)
                        .frame(width: 24, height: 24)
                }
            }

            Text(reply.text)
                .font(.system(size: 13))
                .foregroundStyle(KathaTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            Button { onLike() } label: {
                HStack(spacing: 4) {
                    Image(systemName: appState.isCommentLiked(reply.id) ? "heart.fill" : "heart")
                    Text(formatCount(appState.commentLikeCount(comment: reply)))
                }
                .font(.system(size: 11, weight: appState.isCommentLiked(reply.id) ? .semibold : .regular))
                .foregroundStyle(appState.isCommentLiked(reply.id) ? KathaTheme.accent : KathaTheme.textTertiary)
            }
        }
        .padding(KathaTheme.Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.s)
                .fill(KathaTheme.canvas.opacity(0.5))
        )
    }
}

// MARK: - Comment Composer

struct CommentComposer: View {
    @Environment(AppState.self) private var appState
    @FocusState private var focused: Bool

    private var isActive: Bool {
        appState.replyToComment != nil || !appState.composerText.isEmpty
    }

    private var remaining: Int {
        500 - appState.composerText.count
    }

    var body: some View {
        VStack(spacing: 0) {
            if let reply = appState.replyToComment {
                HStack {
                    Text("Replying to @\(reply.username)")
                        .font(.system(size: 12))
                        .foregroundStyle(KathaTheme.textSecondary)
                    Spacer()
                    Button {
                        appState.cancelReply()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.top, KathaTheme.Spacing.s)
                .padding(.bottom, KathaTheme.Spacing.xs)
                .transition(.opacity)
            }

            HStack(spacing: KathaTheme.Spacing.s) {
                if let user = appState.currentUser {
                    GeneratedAvatar(username: user.username, displayName: user.displayName, size: 32)
                }

                TextField("Add a comment...", text: Binding(
                    get: { appState.composerText },
                    set: { newValue in
                        appState.composerText = String(newValue.prefix(500))
                    }
                ), axis: .horizontal)
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textPrimary)
                .focused($focused)
                .textFieldStyle(.plain)

                if isActive {
                    if appState.composerText.count > 400 {
                        Text("\(remaining)")
                            .font(.system(size: 11))
                            .foregroundStyle(remaining < 0 ? KathaTheme.error : KathaTheme.textTertiary)
                    }
                    Button {
                        appState.sendComment()
                        focused = false
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(appState.composerText.trimmingCharacters(in: .whitespaces).isEmpty ? KathaTheme.textTertiary : KathaTheme.accent)
                    }
                    .disabled(appState.composerText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.vertical, KathaTheme.Spacing.m)
            .background(KathaTheme.surface)
        }
        .animation(.easeInOut(duration: 0.2), value: isActive)
        .animation(.easeInOut(duration: 0.2), value: appState.replyToComment != nil)
    }
}

// MARK: - Report Sheet

struct ReportSheetOverlay: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture { appState.cancelReport() }

            if let target = appState.pendingReportTarget {
                ReportSheet(target: target)
            }
        }
    }
}

struct ReportSheet: View {
    @Environment(AppState.self) private var appState
    let target: ReportTarget

    @State private var selectedReason: String? = nil

    private let reasons = [
        "Spam or misleading",
        "Harassment or hate speech",
        "Inappropriate content",
        "Plagiarism",
        "Other"
    ]

    var body: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 3)
                .fill(KathaTheme.border)
                .frame(width: 40, height: 4)
                .padding(.top, KathaTheme.Spacing.s)

            VStack(spacing: KathaTheme.Spacing.m) {
                Text("Report \(target.label)")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)

                Text("Help us keep Katha safe. Our team will review this shortly.")
                    .font(.system(size: 13))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: 0) {
                    ForEach(reasons, id: \.self) { reason in
                        Button {
                            Haptics.light()
                            selectedReason = reason
                        } label: {
                            HStack {
                                Text(reason)
                                    .font(.system(size: 14))
                                    .foregroundStyle(KathaTheme.textPrimary)
                                Spacer()
                                if selectedReason == reason {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(KathaTheme.accent)
                                }
                            }
                            .padding(.vertical, KathaTheme.Spacing.m)
                        }
                        if reason != reasons.last {
                            Divider().background(KathaTheme.border)
                        }
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                        .fill(KathaTheme.canvas.opacity(0.5))
                )

                PrimaryCTA(title: "Submit report", icon: "flag") {
                    if let reason = selectedReason {
                        appState.submitReport(reason: reason)
                    }
                }
                .disabled(selectedReason == nil)
                .opacity(selectedReason == nil ? 0.5 : 1)

                SecondaryCTA(title: "Cancel") {
                    appState.cancelReport()
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.xl)
            .padding(.top, KathaTheme.Spacing.l)
            .padding(.bottom, KathaTheme.Spacing.xxl)
        }
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(KathaTheme.surface)
                .ignoresSafeArea(edges: .bottom)
        )
    }
}

// MARK: - Block Confirmation Modal

struct BlockConfirmationModal: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { appState.cancelBlockUser() }

            VStack(spacing: KathaTheme.Spacing.l) {
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(KathaTheme.error)

                Text("Block @\(appState.pendingBlockAuthorName)?")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .multilineTextAlignment(.center)

                Text("They won't be able to see your comments or stories. You won't see their content anywhere on Katha.")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: KathaTheme.Spacing.s) {
                    DestructiveCTA(title: "Block", icon: "hand.raised") {
                        appState.confirmBlockUser()
                    }
                    SecondaryCTA(title: "Cancel") {
                        appState.cancelBlockUser()
                    }
                }
            }
            .padding(KathaTheme.Spacing.xxl)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.xl)
                    .fill(KathaTheme.surface)
            )
            .kathaElevatedShadow()
            .padding(.horizontal, KathaTheme.Spacing.xxxl)
        }
    }
}

// MARK: - Blocked Users Screen

struct BlockedUsersScreen: View {
    @Environment(AppState.self) private var appState

    private var blockedUsers: [ProfileUserItem] {
        appState.blockedUserIds.compactMap { id in
            if let author = SeedData.author(id: id) {
                return ProfileUserItem(id: author.id, username: author.username, displayName: author.displayName, bio: author.bio, isVerified: author.isVerified, isGhost: false)
            }
            return nil
        }
    }

    var body: some View {
        ZStack(alignment: .top) {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: 0) {
                ProfileListNavBar(title: "Blocked users") {
                    appState.popProfileRoute()
                }

                if blockedUsers.isEmpty {
                    EmptyState(
                        icon: "checkmark.shield",
                        title: "No blocked users",
                        message: "When you block someone, they'll appear here."
                    )
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(blockedUsers) { user in
                                HStack(spacing: KathaTheme.Spacing.m) {
                                    GeneratedAvatar(username: user.username, displayName: user.displayName, size: 44)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(user.displayName)
                                            .font(.system(size: 15, weight: .semibold))
                                            .foregroundStyle(KathaTheme.textPrimary)
                                        Text("@\(user.username)")
                                            .font(.system(size: 12))
                                            .foregroundStyle(KathaTheme.textSecondary)
                                    }
                                    Spacer()
                                    SecondaryCTA(title: "Unblock") {
                                        appState.unblockUser(user.id)
                                    }
                                }
                                .padding(.horizontal, 20)
                                .frame(height: 72)
                                .overlay(alignment: .bottom) {
                                    Rectangle().fill(KathaTheme.border).frame(height: 1).padding(.leading, 20)
                                }
                            }
                            SafeBottomSpacer()
                        }
                        .padding(.top, KathaTheme.Spacing.m)
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
    }
}

// MARK: - Native Share Sheet (UIActivityViewController wrapper)

struct ShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(
            activityItems: [text],
            applicationActivities: nil
        )
        controller.completionWithItemsHandler = { _, completed, _, _ in
            // Share count already incremented optimistically; no update on cancel
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - User Comment Row (for Profile Comments tab)

struct UserCommentRow: View {
    @Environment(AppState.self) private var appState
    let comment: StoryComment

    private var story: Story? {
        SeedData.stories.first { $0.id == comment.storyId }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            if let story = story {
                HStack(spacing: KathaTheme.Spacing.s) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(colors: story.coverColors, startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        .frame(width: 36, height: 48)
                        .overlay {
                            Image(systemName: story.genre.icon)
                                .font(.system(size: 16))
                                .foregroundStyle(.white.opacity(0.3))
                        }

                    VStack(alignment: .leading, spacing: 1) {
                        Text(story.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(KathaTheme.textPrimary)
                            .lineLimit(1)
                        Text(comment.timeLabel)
                            .font(.system(size: 11))
                            .foregroundStyle(KathaTheme.textTertiary)
                    }
                    Spacer()
                }
            }

            Text(comment.text)
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: KathaTheme.Spacing.l) {
                Label(formatCount(appState.commentLikeCount(comment: comment)), systemImage: "heart")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textTertiary)
                if let replyTo = comment.replyToUsername {
                    Text("Reply to @\(replyTo)")
                        .font(.system(size: 11))
                        .foregroundStyle(KathaTheme.textTertiary)
                }
            }
        }
        .padding(KathaTheme.Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .fill(KathaTheme.surface)
        )
        .onTapGesture {
            if let story = story {
                appState.closeAllProfiles()
                appState.openReader(story: story)
                appState.openCommentsSheet(storyId: story.id)
                appState.highlightedCommentId = comment.id
            }
        }
    }
}

//
//  ProfileComponents.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Follow Button

enum FollowButtonSize {
    case small   // 32pt pill for lists & author cards
    case medium  // 44pt pill for profile hero

    var height: CGFloat {
        switch self {
        case .small: 32
        case .medium: 44
        }
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .small: 12
        case .medium: 32
        }
    }

    var fontSize: CGFloat {
        switch self {
        case .small: 13
        case .medium: 15
        }
    }
}

struct FollowButton: View {
    let isFollowing: Bool
    var size: FollowButtonSize = .small
    var isLoading: Bool = false
    var fullWidth: Bool = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.light()
            action()
        } label: {
            Group {
                if isLoading {
                    ProgressView()
                        .tint(isFollowing ? KathaTheme.accent : .white)
                } else {
                    Text(isFollowing ? "Following ✓" : "Follow")
                        .font(.system(size: size.fontSize, weight: .semibold))
                        .foregroundStyle(isFollowing ? KathaTheme.accent : .white)
                }
            }
            .padding(.horizontal, size.horizontalPadding)
            .frame(height: size.height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                Capsule()
                    .fill(isFollowing ? KathaTheme.accentSoft : KathaTheme.accent)
            )
            .overlay(
                Capsule()
                    .stroke(isFollowing ? KathaTheme.accent : Color.clear, lineWidth: 1)
            )
            .opacity(isLoading ? 0.4 : 1)
        }
        .buttonStyle(PressScaleStyle(scale: 0.96))
        .disabled(isLoading)
        .animation(.easeInOut(duration: 0.2), value: isFollowing)
    }
}

// MARK: - Verified Badge

struct VerifiedBadge: View {
    var size: CGFloat = 24

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white)
                .frame(width: size, height: size)
                .shadow(color: .black.opacity(0.1), radius: 4, y: 1)
            Image(systemName: "checkmark")
                .font(.system(size: size * 0.45, weight: .bold))
                .foregroundStyle(KathaTheme.accent)
        }
    }
}

// MARK: - Streak Badge

struct StreakBadge: View {
    let days: Int
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.light()
            action()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 14))
                Text("\(days)-day streak")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(KathaTheme.accent)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Capsule().fill(KathaTheme.accentSoft))
        }
        .buttonStyle(PressScaleStyle(scale: 0.96))
    }
}

// MARK: - Profile Stats Row

struct ProfileStatsRow: View {
    let followers: Int
    let following: Int
    let stories: Int
    var onFollowers: (() -> Void)? = nil
    var onFollowing: (() -> Void)? = nil
    var onStories: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.xxxl) {
            statBlock(number: followers, label: "FOLLOWERS", action: onFollowers)
            statBlock(number: following, label: "FOLLOWING", action: onFollowing)
            statBlock(number: stories, label: "STORIES", action: onStories)
        }
    }

    private func statBlock(number: Int, label: String, action: (() -> Void)?) -> some View {
        Button {
            Haptics.light()
            action?()
        } label: {
            VStack(spacing: 2) {
                Text(formatCount(number))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .contentTransition(.numericText())
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .tracking(0.8)
                    .foregroundStyle(KathaTheme.textTertiary)
            }
        }
        .buttonStyle(PressScaleStyle(scale: 0.96))
    }
}

// MARK: - Author Card (160×220, horizontal contexts)

struct AuthorCard: View {
    let author: Author
    let followerCount: Int
    let isFollowing: Bool
    let onTap: () -> Void
    let onFollow: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button {
                Haptics.light()
                onTap()
            } label: {
                VStack(spacing: 0) {
                    GeneratedAvatar(username: author.username, displayName: author.displayName, size: 72)
                        .padding(.top, 12)

                    Text(author.displayName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .lineLimit(1)
                        .padding(.top, 12)

                    Text("@\(author.username)")
                        .font(.system(size: 11))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .lineLimit(1)
                        .padding(.top, 2)

                    Text("\(formatCount(followerCount)) followers")
                        .font(.system(size: 10))
                        .foregroundStyle(KathaTheme.textTertiary)
                        .padding(.top, 4)
                }
            }
            .buttonStyle(PressScaleStyle())

            Spacer(minLength: 12)

            FollowButton(isFollowing: isFollowing, size: .small, fullWidth: true) {
                onFollow()
            }
        }
        .padding(16)
        .frame(width: 160, height: 220)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(KathaTheme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
        )
        .kathaCardShadow()
    }
}

// MARK: - Author Card Skeleton

struct AuthorCardSkeleton: View {
    var body: some View {
        VStack(spacing: 12) {
            Skeleton(width: 72, height: 72, cornerRadius: 36)
                .padding(.top, 12)
            Skeleton(width: 100, height: 14)
            Skeleton(width: 70, height: 10)
            Spacer()
            Skeleton(height: 32, cornerRadius: 16)
        }
        .padding(16)
        .frame(width: 160, height: 220)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(KathaTheme.surface)
        )
    }
}

// MARK: - User List Row (72pt, followers/following lists)

struct UserListRow: View {
    let user: ProfileUserItem
    let isCurrentUser: Bool
    let isFollowing: Bool
    let onTap: () -> Void
    let onFollow: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button {
                Haptics.light()
                onTap()
            } label: {
                HStack(spacing: 12) {
                    GeneratedAvatar(username: user.username, displayName: user.displayName, size: 48)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 3) {
                            Text(user.displayName)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(KathaTheme.textPrimary)
                                .lineLimit(1)
                            if user.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 11))
                                    .foregroundStyle(KathaTheme.accent)
                            }
                        }
                        Text("@\(user.username)")
                            .font(.system(size: 12))
                            .foregroundStyle(KathaTheme.textSecondary)
                            .lineLimit(1)
                        if !user.bio.isEmpty {
                            Text(user.bio)
                                .font(.system(size: 11))
                                .foregroundStyle(KathaTheme.textTertiary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if !user.isGhost && !isCurrentUser {
                FollowButton(isFollowing: isFollowing, size: .small) {
                    onFollow()
                }
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 72)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(KathaTheme.border)
                .frame(height: 1)
                .padding(.leading, 20)
        }
    }
}

// MARK: - User List Row Skeleton

struct UserListRowSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            Skeleton(width: 48, height: 48, cornerRadius: 24)
            VStack(alignment: .leading, spacing: 6) {
                Skeleton(width: 130, height: 13)
                Skeleton(width: 90, height: 11)
            }
            Spacer()
            Skeleton(width: 70, height: 32, cornerRadius: 16)
        }
        .padding(.horizontal, 20)
        .frame(height: 72)
    }
}

// MARK: - Writers To Follow Section (Home)

struct WritersToFollowSection: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            SectionHeader(
                title: "Writers to follow",
                actionTitle: "See more →",
                action: { appState.showToast("More writers coming ✨") }
            )

            let suggestions = appState.suggestedAuthors

            if suggestions.isEmpty {
                Text("You already follow all the writers we'd suggest. New writers coming soon.")
                    .font(.system(size: 13))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .padding(.vertical, KathaTheme.Spacing.m)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: KathaTheme.Spacing.m) {
                        ForEach(suggestions) { author in
                            AuthorCard(
                                author: author,
                                followerCount: appState.authorFollowerCount(authorId: author.id, baseCount: author.followers),
                                isFollowing: appState.isFollowing(author.id),
                                onTap: { appState.openAuthorProfile(author.id) },
                                onFollow: { appState.toggleFollowAuthor(authorId: author.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Unfollow Author Modal

struct UnfollowAuthorModal: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { appState.cancelUnfollowAuthor() }

            VStack(spacing: KathaTheme.Spacing.l) {
                Text("Stop following \(appState.pendingUnfollowAuthorName)?")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .multilineTextAlignment(.center)

                Text("You won't see new stories in your feed.")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: KathaTheme.Spacing.s) {
                    DestructiveCTA(title: "Unfollow") {
                        appState.confirmUnfollowAuthor()
                    }
                    SecondaryCTA(title: "Keep following") {
                        appState.cancelUnfollowAuthor()
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

// MARK: - Profile Search Bar

struct ProfileSearchBar: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.s) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textTertiary)

            TextField(placeholder, text: $text)
                .font(.system(size: 15))
                .foregroundStyle(KathaTheme.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textTertiary)
                }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.m)
        .frame(height: 44)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(KathaTheme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
        )
        .padding(.horizontal, 20)
    }
}

//
//  Components.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Helpers

func formatCount(_ n: Int) -> String {
    if n >= 1_000_000 {
        let v = Double(n) / 1_000_000
        return v >= 10 ? String(format: "%.0fM", v) : String(format: "%.1fM", v)
    }
    if n >= 1000 {
        let v = Double(n) / 1000
        return v >= 10 ? String(format: "%.0fK", v) : String(format: "%.1fK", v)
    }
    return "\(n)"
}

func timeAgo(_ days: Int) -> String {
    if days == 0 { return "Today" }
    if days == 1 { return "Yesterday" }
    if days < 7 { return "\(days) days ago" }
    if days < 30 { return "\(days / 7)w ago" }
    return "\(days / 30)mo ago"
}

enum Haptics {
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}

// MARK: - Button Styles

struct PressScaleStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - CTAs

struct PrimaryCTA: View {
    let title: String
    var icon: String? = nil
    var isLoading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: { Haptics.light(); action() }) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView().tint(.white)
                } else {
                    if let icon { Image(systemName: icon) }
                    Text(title)
                }
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 56)
            .padding(.horizontal, 20)
        }
        .buttonStyle(PrimaryCTAStyle())
        .disabled(isLoading)
    }
}

struct PrimaryCTAStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(configuration.isPressed ? KathaTheme.accentPressed : KathaTheme.accent)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(
                        LinearGradient(
                            colors: [Color.white.opacity(0.12), Color.clear],
                            startPoint: .top, endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(
                color: KathaTheme.accent.opacity(configuration.isPressed ? 0.17 : 0.28),
                radius: configuration.isPressed ? 5 : 8,
                y: configuration.isPressed ? 1 : 2
            )
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

struct PremiumCTA: View {
    let title: String
    var subtitle: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: { Haptics.light(); action() }) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 20))
                    .foregroundStyle(.white)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.white.opacity(0.6))
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(
                        LinearGradient(
                            colors: [KathaTheme.accent, KathaTheme.accentPressed],
                            startPoint: .leading, endPoint: .trailing
                        )
                    )
            )
        }
        .buttonStyle(PressScaleStyle())
    }
}

struct SecondaryCTA: View {
    let title: String
    var icon: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: { Haptics.light(); action() }) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon) }
                Text(title)
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(KathaTheme.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(KathaTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(KathaTheme.border, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(PressScaleStyle())
    }
}

struct DestructiveCTA: View {
    let title: String
    var icon: String? = nil
    var isLoading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: { Haptics.light(); action() }) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView().tint(KathaTheme.error)
                } else {
                    if let icon { Image(systemName: icon) }
                    Text(title)
                }
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(KathaTheme.error)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(KathaTheme.error.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(KathaTheme.error.opacity(0.2), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(PressScaleStyle())
        .disabled(isLoading)
    }
}

struct TextLink: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(KathaTheme.accent)
        }
    }
}

// MARK: - Generated Avatar

struct GeneratedAvatar: View {
    let username: String
    var displayName: String = ""
    var size: CGFloat = 44

    private var palette: AvatarPalette {
        AvatarPalette.paletteFor(username: username)
    }

    private var initial: String {
        let name = displayName.isEmpty ? username : displayName
        return String(name.prefix(1)).uppercased()
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: palette.colors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Text(initial)
                .font(KathaFont.avatarInitial(size: size * 0.42))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Story Cover

struct StoryCoverView: View {
    let story: Story
    var height: CGFloat = 220
    var titleSize: CGFloat = 20

    var body: some View {
        LinearGradient(
            colors: story.coverColors,
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Image(systemName: story.genre.icon)
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(.white.opacity(0.1))
                .padding(12)
                .allowsHitTesting(false)
        }
        .overlay(alignment: .bottom) {
            LinearGradient(
                colors: [.black.opacity(0.45), .clear],
                startPoint: .bottom,
                endPoint: .top
            )
            .frame(height: 80)
            .allowsHitTesting(false)
        }
        .overlay(alignment: .bottomLeading) {
            Text(story.title)
                .font(KathaFont.Title2)
                .foregroundStyle(.white)
                .padding(14)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.l))
    }
}

// MARK: - Story Card (full feed card)

struct StoryCard: View {
    let story: Story
    var isLiked: Bool = false
    var isBookmarked: Bool = false
    var onLike: (() -> Void)? = nil
    var onBookmark: (() -> Void)? = nil
    var onTap: (() -> Void)? = nil
    var onAuthorTap: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            StoryCoverView(story: story, height: 200)
                .onTapGesture { onTap?() }
                .contentShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.l))

            if let author = SeedData.author(id: story.authorId) {
                HStack(spacing: KathaTheme.Spacing.s) {
                    Button {
                        Haptics.light()
                        onAuthorTap?()
                    } label: {
                        HStack(spacing: KathaTheme.Spacing.s) {
                            GeneratedAvatar(username: author.username, displayName: author.displayName, size: 32)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 3) {
                                    Text(author.displayName)
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(KathaTheme.textPrimary)
                                    if author.isVerified {
                                        Image(systemName: "checkmark.seal.fill")
                                            .font(.system(size: 10))
                                            .foregroundStyle(KathaTheme.accent)
                                    }
                                }
                                Text("\(formatCount(author.followers)) followers")
                                    .font(.system(size: 11))
                                    .foregroundStyle(KathaTheme.textSecondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(onAuthorTap == nil)

                    Spacer()
                    Text(timeAgo(story.publishedOffset))
                        .font(.system(size: 11))
                        .foregroundStyle(KathaTheme.textTertiary)
                }
            }

            Text(story.synopsis)
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
                .lineLimit(2)
                .onTapGesture { onTap?() }

            HStack {
                Label("\(story.readingTimeMinutes) min read", systemImage: "clock")
                    .font(.system(size: 11))
                    .foregroundStyle(KathaTheme.textTertiary)
                Spacer()
            }

            EngagementRow(
                likes: story.likes,
                bookmarks: story.bookmarks,
                views: story.views,
                isLiked: isLiked,
                isBookmarked: isBookmarked,
                commentCount: nil,
                onLike: onLike,
                onBookmark: onBookmark,
                onComment: nil
            )
        }
        .padding(KathaTheme.Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                .fill(KathaTheme.surface)
        )
        .kathaCardShadow()
    }
}

// MARK: - Compact Story Card (for grids)

struct CompactStoryCard: View {
    let story: Story
    var onTap: (() -> Void)? = nil
    var onAuthorTap: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
            StoryCoverView(story: story, height: 130, titleSize: 14)
                .onTapGesture { onTap?() }

            Text(story.title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(2)

            if let author = SeedData.author(id: story.authorId) {
                Text(author.displayName)
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .onTapGesture {
                        if let onAuthorTap {
                            Haptics.light()
                            onAuthorTap()
                        } else {
                            onTap?()
                        }
                    }
            }

            HStack(spacing: KathaTheme.Spacing.s) {
                Label(formatCount(story.likes), systemImage: "heart")
                Label(formatCount(story.bookmarks), systemImage: "bookmark")
            }
            .font(.system(size: 11))
            .foregroundStyle(KathaTheme.textTertiary)
        }
        .onTapGesture { onTap?() }
    }
}

// MARK: - Chips

struct GenreChip: View {
    let genre: Genre
    var isSelected: Bool = false
    var action: (() -> Void)? = nil

    var body: some View {
        Button {
            Haptics.light()
            action?()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: genre.icon).font(.system(size: 12))
                Text(genre.displayName).font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(isSelected ? .white : KathaTheme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule().fill(isSelected ? KathaTheme.accent : KathaTheme.surface)
            )
        }
    }
}

struct FilterChip: View {
    let title: String
    var isSelected: Bool = false
    var action: (() -> Void)? = nil

    var body: some View {
        Button {
            Haptics.light()
            action?()
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isSelected ? .white : KathaTheme.textSecondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    Capsule().fill(isSelected ? KathaTheme.accent : KathaTheme.surface)
                )
        }
    }
}

// MARK: - Engagement Row

struct EngagementRow: View {
    let likes: Int
    let bookmarks: Int
    let views: Int
    var isLiked: Bool = false
    var isBookmarked: Bool = false
    var commentCount: Int? = nil
    var onLike: (() -> Void)? = nil
    var onBookmark: (() -> Void)? = nil
    var onComment: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.l) {
            if let onLike {
                Button(action: { Haptics.light(); onLike() }) {
                    HStack(spacing: 4) {
                        Image(systemName: isLiked ? "heart.fill" : "heart")
                        Text(formatCount(likes + (isLiked ? 1 : 0)))
                    }
                    .font(.system(size: 13, weight: isLiked ? .semibold : .regular))
                    .foregroundStyle(isLiked ? KathaTheme.accent : KathaTheme.textSecondary)
                }
            }

            if let onBookmark {
                Button(action: { Haptics.light(); onBookmark() }) {
                    HStack(spacing: 4) {
                        Image(systemName: isBookmarked ? "bookmark.fill" : "bookmark")
                        Text(formatCount(bookmarks + (isBookmarked ? 1 : 0)))
                    }
                    .font(.system(size: 13, weight: isBookmarked ? .semibold : .regular))
                    .foregroundStyle(isBookmarked ? KathaTheme.accent : KathaTheme.textSecondary)
                }
            }

            if let commentCount, let onComment {
                Button(action: { Haptics.light(); onComment() }) {
                    HStack(spacing: 4) {
                        Image(systemName: "bubble.left")
                        Text(formatCount(commentCount))
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(KathaTheme.textSecondary)
                }
            } else if let commentCount {
                Label(formatCount(commentCount), systemImage: "bubble.left")
                    .font(.system(size: 13))
                    .foregroundStyle(KathaTheme.textTertiary)
            }

            Label(formatCount(views), systemImage: "eye")
                .font(.system(size: 13))
                .foregroundStyle(KathaTheme.textTertiary)

            Spacer()
        }
    }
}

// MARK: - Author Row

struct AuthorRow: View {
    let author: Author
    var isFollowing: Bool = false
    var onFollow: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            GeneratedAvatar(username: author.username, displayName: author.displayName, size: 44)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 3) {
                    Text(author.displayName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    if author.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(KathaTheme.accent)
                    }
                }
                Text("@\(author.username)")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
            }

            Spacer()

            if let onFollow {
                Button(action: { Haptics.light(); onFollow() }) {
                    Text(isFollowing ? "Following" : "Follow")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(isFollowing ? KathaTheme.textSecondary : .white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 7)
                        .background(
                            Capsule().fill(isFollowing ? KathaTheme.border : KathaTheme.accent)
                        )
                }
            }
        }
    }
}

// MARK: - Theme Chip

struct ThemeChip: View {
    let tag: String
    var action: (() -> Void)? = nil

    var body: some View {
        Button {
            Haptics.light()
            action?()
        } label: {
            Text(tag)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(action != nil ? KathaTheme.accent : KathaTheme.textTertiary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Capsule().fill(action != nil ? KathaTheme.accentSoft.opacity(0.5) : KathaTheme.border.opacity(0.3)))
        }
        .disabled(action == nil)
    }
}

// MARK: - Rising / New Badges

struct RisingBadge: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "arrow.trending.up")
                .font(.system(size: 9, weight: .bold))
            Text("Rising")
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Capsule().fill(KathaTheme.accent))
    }
}

struct NewBadge: View {
    var body: some View {
        Text("NEW")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(KathaTheme.success))
    }
}

// MARK: - Layout

struct SafeBottomSpacer: View {
    var height: CGFloat = 120

    var body: some View {
        Color.clear.frame(height: height)
    }
}

struct SectionHeader: View {
    let title: String
    var subtitle: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
            }
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(KathaTheme.accent)
            }
        }
    }
}

struct SegmentedControl: View {
    let options: [String]
    @Binding var selection: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options.indices, id: \.self) { index in
                Button {
                    Haptics.light()
                    withAnimation(.spring(duration: 0.3)) {
                        selection = index
                    }
                } label: {
                    Text(options[index])
                        .font(.system(size: 14, weight: selection == index ? .semibold : .regular))
                        .foregroundStyle(selection == index ? KathaTheme.textPrimary : KathaTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(selection == index ? KathaTheme.surface : Color.clear)
                        )
                }
            }
        }
        .padding(4)
        .background(KathaTheme.border.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - States

struct EmptyState: View {
    let icon: String
    let title: String
    let message: String
    var ctaTitle: String? = nil
    var ctaAction: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundStyle(KathaTheme.textTertiary)

            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)

            if let ctaTitle, let ctaAction {
                PrimaryCTA(title: ctaTitle, action: ctaAction)
                    .padding(.horizontal, 40)
            }
        }
        .padding(KathaTheme.Spacing.xxxl)
        .frame(maxWidth: .infinity)
    }
}

struct Skeleton: View {
    var width: CGFloat? = nil
    var height: CGFloat = 16
    var cornerRadius: CGFloat = 8

    @State private var isAnimating = false

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(KathaTheme.border)
            .frame(width: width, height: height)
            .opacity(isAnimating ? 0.3 : 0.6)
            .onAppear {
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                    isAnimating = true
                }
            }
    }
}

struct StoryCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Skeleton(height: 200, cornerRadius: 14)
            HStack(spacing: KathaTheme.Spacing.s) {
                Skeleton(width: 32, height: 32, cornerRadius: 16)
                VStack(alignment: .leading, spacing: 4) {
                    Skeleton(width: 120, height: 12)
                    Skeleton(width: 80, height: 10)
                }
            }
            Skeleton(height: 14)
            Skeleton(width: 200, height: 14)
            Skeleton(height: 14)
        }
        .padding(KathaTheme.Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                .fill(KathaTheme.surface)
        )
        .kathaCardShadow()
    }
}

// MARK: - Toast

struct ToastView: View {
    let message: String
    var isWelcome: Bool = false
    var actionTitle: String? = nil
    var onAction: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.s) {
            if isWelcome {
                Image(systemName: "sparkles")
                    .foregroundStyle(KathaTheme.accent)
            }
            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(KathaTheme.textPrimary)
            if let actionTitle, let onAction {
                Spacer()
                Button {
                    Haptics.light()
                    onAction()
                } label: {
                    Text(actionTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KathaTheme.accent)
                }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                .fill(KathaTheme.surfaceElevated)
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        )
    }
}

// MARK: - View Extensions

extension View {
    func themedBackground() -> some View {
        background(KathaTheme.canvas)
    }
}

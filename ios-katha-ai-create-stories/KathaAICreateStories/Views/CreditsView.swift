//
//  CreditsView.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Credits Screen

struct CreditsScreen: View {
    @Environment(AppState.self) private var appState
    @State private var isLoading = true
    @State private var cooldownTimer: Timer?

    var body: some View {
        ZStack {
            KathaTheme.canvas.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    if isLoading {
                        loadingContent
                    } else {
                        balanceCard
                        earnCreditsSection
                        buyCreditsSection
                        recentActivitySection
                        footerSection
                    }
                    SafeBottomSpacer()
                }
            }
            .scrollIndicators(.hidden)
        }
        .overlay(alignment: .topLeading) {
            backButton
        }
        .onAppear {
            if isLoading {
                Task {
                    try? await Task.sleep(for: .milliseconds(500))
                    withAnimation(.easeInOut(duration: 0.3)) {
                        isLoading = false
                    }
                }
            }
            startCooldownTimer()
        }
        .onDisappear {
            cooldownTimer?.invalidate()
        }
    }

    // MARK: - Back Button

    private var backButton: some View {
        Button {
            Haptics.light()
            appState.popCreditsStack()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .frame(width: 36, height: 36)
                .background(
                    Circle().fill(KathaTheme.surface)
                )
        }
        .padding(.leading, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.s)
    }

    // MARK: - Loading

    private var loadingContent: some View {
        VStack(spacing: KathaTheme.Spacing.xxl) {
            Skeleton(height: 200, cornerRadius: KathaTheme.Radius.xxl)
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.top, 80)
            ForEach(0..<3, id: \.self) { _ in
                Skeleton(height: 56, cornerRadius: KathaTheme.Radius.l)
                    .padding(.horizontal, KathaTheme.Spacing.l)
            }
            Skeleton(height: 120, cornerRadius: KathaTheme.Radius.xl)
                .padding(.horizontal, KathaTheme.Spacing.l)
        }
    }

    // MARK: - Balance Card

    private var balanceCard: some View {
        VStack(spacing: KathaTheme.Spacing.s) {
            // Coin illustration with glow
            ZStack {
                Circle()
                    .fill(KathaTheme.accentSoft.opacity(0.6))
                    .frame(width: 100, height: 100)
                    .blur(radius: 20)
                Image(systemName: "coins")
                    .font(.system(size: 40))
                    .foregroundStyle(KathaTheme.accent)
            }
            .padding(.top, KathaTheme.Spacing.xxl)

            // Big balance number
            Text("\(appState.credits)")
                .font(.system(size: 48, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)
                .contentTransition(.numericText())

            Text("AVAILABLE CREDITS")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(KathaTheme.textTertiary)
                .tracking(0.5)

            // Premium pill
            if appState.isPremium {
                Button {
                    Haptics.light()
                    appState.openSubscriptionManagement()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 10))
                        Text("KATHA PREMIUM")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(KathaTheme.premium)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        Capsule().fill(KathaTheme.premiumSoft)
                    )
                }
                .padding(.top, KathaTheme.Spacing.s)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, KathaTheme.Spacing.xxxl)
        .padding(.horizontal, KathaTheme.Spacing.xl)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.xxl)
                .fill(KathaTheme.surface)
        )
        .kathaElevatedShadow()
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, 60)
    }

    // MARK: - Earn Credits Section

    private var earnCreditsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("EARN CREDITS")
                .padding(.bottom, KathaTheme.Spacing.s)

            VStack(spacing: 0) {
                // Watch an ad
                EarnMethodRow(
                    icon: "video",
                    title: "Watch an ad",
                    subtitle: appState.isPremium
                        ? "1 credit · Once every 24 hours · Bonus for Premium"
                        : "1 credit · Once every 24 hours",
                    trailing: { adWatchTrailing }
                )

                dividerLine

                // Reading streak
                EarnMethodRow(
                    icon: "flame",
                    title: "Reading streak",
                    subtitle: streakSubtitle,
                    trailing: {
                        chevronTrailing {
                            appState.showToast("Your journey coming in the next update ✨")
                        }
                    }
                )

                dividerLine

                // Leave a comment
                EarnMethodRow(
                    icon: "message.circle",
                    title: "Comment on a story",
                    subtitle: "1 credit per story · Max 1 per day",
                    trailing: {
                        chevronTrailing {
                            appState.showToast("Read a story and leave a comment ✨")
                        }
                    }
                )

                dividerLine

                // Refer a friend
                EarnMethodRow(
                    icon: "person.badge.plus",
                    title: "Refer a friend",
                    subtitle: "3 credits when they generate their first story",
                    trailing: {
                        SecondaryCTA(title: "Invite") {
                            appState.shareReferralLink()
                        }
                        .frame(width: 100)
                    }
                )

                dividerLine

                // Share on social
                EarnMethodRow(
                    icon: "square.and.arrow.up",
                    title: "Share on social",
                    subtitle: "1 credit per verified post · Max 3/month",
                    trailing: {
                        chevronTrailing {
                            appState.showToast("Social rewards coming in the next update ✨")
                        }
                    }
                )
            }
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
            )
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.xxxl)
    }

    @ViewBuilder
    private var adWatchTrailing: some View {
        switch appState.adWatchState {
        case .available:
            PrimaryCTA(title: "Watch") {
                Task { await appState.startAdWatch() }
            }
            .frame(width: 100)
        case .loadingAd:
            ProgressView()
                .tint(KathaTheme.accent)
                .frame(width: 100)
        case .playingAd:
            EmptyView()
        case .onCooldown:
            AdCooldownDisplay()
        case .justRewarded:
            HStack(spacing: 4) {
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(KathaTheme.success)
                Text("+1 credit")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KathaTheme.success)
            }
        case .error:
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(KathaTheme.error)
        }
    }

    private var streakSubtitle: String {
        let n = appState.currentStreak
        if n == 0 { return "Start a streak · Read a story today to begin" }
        let nextIn = 3 - (n % 3)
        if nextIn == 0 || n % 3 == 0 { return "\(n)-day streak · Streak reward earned today ✨" }
        return "\(n)-day streak · Next credit in \(nextIn) days"
    }

    // MARK: - Buy Credits Section

    private var buyCreditsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("BUY CREDITS")
                .padding(.bottom, KathaTheme.Spacing.s)

            // Katha Premium card
            KathaPremiumCard()

            // Credit pack tiles
            VStack(spacing: KathaTheme.Spacing.m) {
                ForEach(CreditPack.all) { pack in
                    CreditPackTile(pack: pack) {
                        appState.openCreditPackSheet(packId: pack.id)
                    }
                }
            }
            .padding(.top, KathaTheme.Spacing.m)
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.xxxl)
    }

    // MARK: - Recent Activity

    private var recentActivitySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("RECENT ACTIVITY")
                .padding(.bottom, KathaTheme.Spacing.s)

            if appState.recentLedgerEntries.isEmpty {
                Text("No activity yet.")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textTertiary)
                    .padding(KathaTheme.Spacing.l)
            } else {
                VStack(spacing: 0) {
                    ForEach(appState.recentLedgerEntries) { entry in
                        LedgerRow(entry: entry)
                        if entry.id != appState.recentLedgerEntries.last?.id {
                            dividerLine
                        }
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                        .fill(KathaTheme.surface)
                )
            }

            HStack {
                Spacer()
                TextLink(title: "See full history →") {
                    appState.openCreditHistory()
                }
                Spacer()
            }
            .padding(.top, KathaTheme.Spacing.m)
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.xxxl)
    }

    // MARK: - Footer

    private var footerSection: some View {
        VStack(spacing: KathaTheme.Spacing.s) {
            Text("Credits never expire.")
                .font(.system(size: 12))
                .foregroundStyle(KathaTheme.textTertiary)
            Text("Refunds within 14 days per Apple / Google policy.")
                .font(.system(size: 12))
                .foregroundStyle(KathaTheme.textTertiary)

            if appState.isRestoringPurchases {
                HStack(spacing: 6) {
                    ProgressView()
                        .tint(KathaTheme.accent)
                        .scaleEffect(0.7)
                    Text("Restoring…")
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.accent)
                }
                .padding(.top, KathaTheme.Spacing.s)
            } else {
                TextLink(title: "Restore purchases") {
                    Task { await appState.restorePurchases() }
                }
                .padding(.top, KathaTheme.Spacing.s)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, KathaTheme.Spacing.huge)
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(KathaTheme.textTertiary)
            .tracking(0.5)
    }

    private var dividerLine: some View {
        Rectangle()
            .fill(KathaTheme.border.opacity(0.5))
            .frame(height: 1)
            .padding(.leading, KathaTheme.Spacing.l)
    }

    private func chevronTrailing(_ action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            Image(systemName: "chevron.right")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textTertiary)
        }
    }

    private func startCooldownTimer() {
        cooldownTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
            // Force view refresh for cooldown label
            Task { @MainActor in
                if case .onCooldown = appState.adWatchState {
                    if appState.canWatchAd {
                        appState.adWatchState = .available
                    }
                }
            }
        }
    }
}

// MARK: - Earn Method Row

struct EarnMethodRow<Trailing: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(KathaTheme.accent)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
            }

            Spacer()

            trailing()
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
    }
}

// MARK: - Katha Premium Card

struct KathaPremiumCard: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Button {
            Haptics.medium()
            appState.openSubscriptionPaywall()
        } label: {
            VStack(spacing: KathaTheme.Spacing.m) {
                HStack(spacing: 8) {
                    Image(systemName: "crown")
                        .font(.system(size: 22))
                        .foregroundStyle(.white)
                    Text("KATHA PREMIUM")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .tracking(1)
                    Spacer()
                }

                Text("Unlock unlimited storytelling.")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text("20+ credits every month, ad-free reading, premium voices.")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .leading)

                // Inverted CTA
                HStack {
                    Text("Start Katha Premium ▸")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.premium)
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KathaTheme.premium)
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.vertical, KathaTheme.Spacing.m)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                        .fill(.white)
                )
            }
            .padding(KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.xl)
                    .fill(
                        LinearGradient(
                            colors: [KathaTheme.premium.opacity(0.9), KathaTheme.accent.opacity(0.9)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
        }
        .buttonStyle(PressScaleStyle(scale: 0.98))
    }
}

// MARK: - Credit Pack Tile

struct CreditPackTile: View {
    @Environment(AppState.self) private var appState
    let pack: CreditPack
    let onTap: () -> Void

    var body: some View {
        Button {
            Haptics.light()
            onTap()
        } label: {
            HStack(spacing: KathaTheme.Spacing.l) {
                // Coin cluster
                ZStack {
                    ForEach(0..<min(pack.coinCount, 5), id: \.self) { i in
                        Image(systemName: "dollarsign.circle.fill")
                            .font(.system(size: 20 - CGFloat(i * 2)))
                            .foregroundStyle(KathaTheme.accent)
                            .offset(x: CGFloat(i) * 6, y: CGFloat(i) * 4)
                    }
                }
                .frame(width: 50, height: 40)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(pack.name)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(KathaTheme.textPrimary)
                        if pack.isPopular {
                            ribbon("POPULAR", color: KathaTheme.accent)
                        }
                        if pack.isBestValue {
                            ribbon("BEST VALUE", color: KathaTheme.premium)
                        }
                    }
                    Text("\(pack.credits) credits")
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.textSecondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    Text(pack.price)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    if pack.isPopular {
                        PrimaryCTA(title: "Buy") { onTap() }
                            .frame(width: 70)
                    } else {
                        SecondaryCTA(title: "Buy") { onTap() }
                            .frame(width: 70)
                    }
                }
            }
            .padding(KathaTheme.Spacing.l)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                            .stroke(KathaTheme.border, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(PressScaleStyle(scale: 0.98))
    }

    private func ribbon(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Capsule().fill(color))
    }
}

// MARK: - Ledger Row

struct LedgerRow: View {
    let entry: CreditLedgerEntry

    private static let formatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: entry.reason.icon)
                .font(.system(size: 18))
                .foregroundStyle(iconColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.reason.label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                Text(Self.formatter.localizedString(for: entry.timestamp, relativeTo: Date()))
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
            }

            Spacer()

            Text(entry.amount > 0 ? "+\(entry.amount)" : "\(entry.amount)")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(entry.amount > 0 ? KathaTheme.success : KathaTheme.error)
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
    }

    private var iconColor: Color {
        switch entry.reason {
        case .subscription: KathaTheme.premium
        case .generation: KathaTheme.textSecondary
        default: KathaTheme.accent
        }
    }
}

// MARK: - Ad Cooldown Display

struct AdCooldownDisplay: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Text(appState.adCooldownLabel)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(KathaTheme.textSecondary)
    }
}

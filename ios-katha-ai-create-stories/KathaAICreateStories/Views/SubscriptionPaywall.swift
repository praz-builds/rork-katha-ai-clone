//
//  SubscriptionPaywall.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Subscription Paywall

struct SubscriptionPaywall: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPlan: SubscriptionPlan = .yearly

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [
                    KathaTheme.canvas,
                    KathaTheme.accentSoft.opacity(0.3),
                    KathaTheme.canvas
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    closeBar
                    heroSection
                    featureList
                    planTiles
                    ctaSection
                    finePrint
                    SafeBottomSpacer()
                }
            }
            .scrollIndicators(.hidden)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Close Bar

    private var closeBar: some View {
        HStack {
            Button {
                Haptics.light()
                appState.closeSubscriptionPaywall()
            } label: {
                Image(systemName: "xmark")
                    .font(KathaFont.BodyStrong)
                    .foregroundStyle(KathaTheme.textPrimary)
                    .frame(width: 36, height: 36)
                    .background(
                        Circle().fill(KathaTheme.surface)
                    )
            }
            Spacer()
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.l)
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(spacing: KathaTheme.Spacing.s) {
            Text("Katha")
                .font(KathaFont.Wordmark)
                .foregroundStyle(KathaTheme.accent)

            Text("PREMIUM")
                .font(KathaFont.PremiumWordmark)
                .foregroundStyle(KathaTheme.premium)
                .tracking(2)

            Text("Unlock unlimited storytelling.")
                .font(KathaFont.Title1)
                .foregroundStyle(KathaTheme.textPrimary)
                .multilineTextAlignment(.center)

            Text("For readers, writers, and everyone in between.")
                .font(KathaFont.Body)
                .foregroundStyle(KathaTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, KathaTheme.Spacing.xxxl)
        .padding(.top, KathaTheme.Spacing.l)
    }

    // MARK: - Feature List

    private var featureList: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            ForEach(PremiumFeature.all) { feature in
                HStack(spacing: KathaTheme.Spacing.m) {
                    ZStack {
                        Circle()
                            .fill(KathaTheme.accent)
                            .frame(width: 24, height: 24)
                        Image(systemName: "checkmark")
                            .font(KathaFont.Meta)
                            .foregroundStyle(.white)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(feature.title)
                            .font(KathaFont.BodyStrong)
                            .foregroundStyle(KathaTheme.textPrimary)
                        Text(feature.subtitle)
                            .font(KathaFont.Meta)
                            .foregroundStyle(KathaTheme.textSecondary)
                    }
                    Spacer()
                }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.xxxl)
        .padding(.top, KathaTheme.Spacing.xxxl)
    }

    // MARK: - Plan Tiles

    private var planTiles: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            // Monthly
            PlanTile(
                plan: .monthly,
                isSelected: selectedPlan == .monthly,
                isFeatured: false,
                onTap: {
                    Haptics.light()
                    withAnimation(.spring(duration: 0.2)) {
                        selectedPlan = .monthly
                    }
                }
            )
            .frame(width: UIScreen.main.bounds.width * 0.42)

            // Yearly
            PlanTile(
                plan: .yearly,
                isSelected: selectedPlan == .yearly,
                isFeatured: true,
                onTap: {
                    Haptics.light()
                    withAnimation(.spring(duration: 0.2)) {
                        selectedPlan = .yearly
                    }
                }
            )
            .frame(width: UIScreen.main.bounds.width * 0.46, height: 130)
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.xxxl)
    }

    // MARK: - CTA

    private var ctaSection: some View {
        VStack(spacing: KathaTheme.Spacing.s) {
            PremiumCTA(
                title: appState.isPurchasingSubscription
                    ? "Processing…"
                    : "Start Katha Premium · \(selectedPlan.price)\(selectedPlan == .yearly ? "/year" : "/month")"
            ) {
                Task { await appState.purchaseSubscription(selectedPlan) }
            }
            .disabled(appState.isPurchasingSubscription)
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.xxxl)
    }

    // MARK: - Fine Print

    private var finePrint: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            Text("Cancel anytime in Settings. Renews automatically unless cancelled 24 hours before period end. Payment charged to your Apple ID or Google account.")
                .font(KathaFont.Meta)
                .foregroundStyle(KathaTheme.textTertiary)
                .multilineTextAlignment(.center)

            if appState.isRestoringPurchases {
                HStack(spacing: 6) {
                    ProgressView()
                        .tint(KathaTheme.accent)
                        .scaleEffect(0.7)
                    Text("Restoring…")
                        .font(KathaFont.Caption)
                        .foregroundStyle(KathaTheme.accent)
                }
            } else {
                TextLink(title: "Restore purchases") {
                    Task { await appState.restorePurchases() }
                }
            }

            HStack(spacing: 0) {
                TextLink(title: "Terms") { appState.showToast("Terms: katha.ai/terms") }
                Text(" · ")
                    .font(KathaFont.Caption)
                    .foregroundStyle(KathaTheme.textTertiary)
                TextLink(title: "Privacy") { appState.showToast("Privacy: katha.ai/privacy") }
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.m)
    }
}

// MARK: - Plan Tile

struct PlanTile: View {
    let plan: SubscriptionPlan
    let isSelected: Bool
    let isFeatured: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: KathaTheme.Spacing.xs) {
                Text(plan.displayName)
                    .font(KathaFont.Meta)
                    .foregroundStyle(isFeatured && isSelected ? KathaTheme.premium : KathaTheme.textSecondary)
                    .tracking(1)

                Text(plan.price)
                    .font(KathaFont.Title1)
                    .foregroundStyle(KathaTheme.textPrimary)

                Text(plan.perMonth)
                    .font(KathaFont.Meta)
                    .foregroundStyle(KathaTheme.textTertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(isSelected ? (isFeatured ? KathaTheme.premiumSoft.opacity(0.3) : KathaTheme.accentSoft.opacity(0.3)) : KathaTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                            .stroke(isSelected ? (isFeatured ? KathaTheme.premium : KathaTheme.accent) : KathaTheme.border, lineWidth: isSelected ? 2 : 1.5)
                    )
            )
            .overlay(alignment: .topTrailing) {
                if isFeatured {
                    Text("SAVE 40%")
                        .font(KathaFont.Meta)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(KathaTheme.premium))
                        .padding(8)
                }
            }
            .overlay(alignment: .topLeading) {
                if isSelected {
                    ZStack {
                        Circle()
                            .fill(isFeatured ? KathaTheme.premium : KathaTheme.accent)
                            .frame(width: 20, height: 20)
                        Image(systemName: "checkmark")
                            .font(KathaFont.Meta)
                            .foregroundStyle(.white)
                    }
                    .padding(8)
                }
            }
        }
        .buttonStyle(PressScaleStyle(scale: 0.98))
    }
}

// MARK: - Premium CTA (inverted style for paywall)

struct PremiumCTAStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(configuration.isPressed ? KathaTheme.premium.opacity(0.8) : KathaTheme.premium)
            )
            .shadow(
                color: KathaTheme.premium.opacity(configuration.isPressed ? 0.15 : 0.3),
                radius: configuration.isPressed ? 5 : 8,
                y: configuration.isPressed ? 1 : 2
            )
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

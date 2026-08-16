//
//  SubscriptionManagementView.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Subscription Management Screen

struct SubscriptionManagementScreen: View {
    @Environment(AppState.self) private var appState
    @State private var showCancelConfirm = false

    var body: some View {
        ZStack {
            KathaTheme.canvas.ignoresSafeArea()

            ScrollView {
                VStack(spacing: KathaTheme.Spacing.xxl) {
                    activePlanCard
                    benefitsSection
                    dangerZone
                    SafeBottomSpacer()
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
            }
            .scrollIndicators(.hidden)
        }
        .overlay(alignment: .topLeading) {
            backButton
        }
        .alert("Cancel subscription?", isPresented: $showCancelConfirm) {
            Button("Keep Premium", role: .cancel) {}
            Button("Cancel subscription", role: .destructive) {
                appState.cancelSubscription()
            }
        } message: {
            Text("You'll keep your Premium benefits until your current period ends.")
        }
    }

    private var backButton: some View {
        Button {
            Haptics.light()
            appState.closeSubscriptionManagement()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)
                .frame(width: 36, height: 36)
                .background(Circle().fill(KathaTheme.surface))
        }
        .padding(.leading, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.s)
    }

    // MARK: - Active Plan Card

    private var activePlanCard: some View {
        VStack(spacing: KathaTheme.Spacing.s) {
            Image(systemName: "crown")
                .font(.system(size: 32))
                .foregroundStyle(KathaTheme.premium)
                .padding(.top, KathaTheme.Spacing.l)

            Text("You're Premium ✨")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(KathaTheme.textPrimary)

            Text(appState.subscriptionType?.renewalLabel ?? "Premium plan")
                .font(.system(size: 14))
                .foregroundStyle(KathaTheme.textSecondary)

            if let expires = appState.subscriptionExpiresAt {
                let formatter: DateFormatter = {
                    let f = DateFormatter()
                    f.dateStyle = .medium
                    return f
                }()
                Text("Renews on \(formatter.string(from: expires))")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textTertiary)
            }

            SecondaryCTA(title: "Manage subscription") {
                Haptics.light()
                appState.showToast("Native subscription management coming in the next update ✨")
            }
            .padding(.top, KathaTheme.Spacing.l)
            .padding(.bottom, KathaTheme.Spacing.l)
        }
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.xl)
                .fill(KathaTheme.surface)
        )
        .kathaElevatedShadow()
        .padding(.top, 60)
    }

    // MARK: - Benefits

    private var benefitsSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("YOUR BENEFITS")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(KathaTheme.textTertiary)
                .tracking(0.5)

            VStack(spacing: 0) {
                ForEach(PremiumFeature.all) { feature in
                    HStack(spacing: KathaTheme.Spacing.m) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(KathaTheme.success)
                        Text(feature.title)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(KathaTheme.textPrimary)
                        Spacer()
                    }
                    .padding(.vertical, KathaTheme.Spacing.m)
                    .padding(.horizontal, KathaTheme.Spacing.l)

                    if feature.id != PremiumFeature.all.last?.id {
                        Divider().background(KathaTheme.border)
                    }
                }
            }
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                    .fill(KathaTheme.surface)
            )
        }
    }

    // MARK: - Danger Zone

    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text("CANCEL PLAN")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(KathaTheme.textTertiary)
                .tracking(0.5)

            Button {
                Haptics.medium()
                showCancelConfirm = true
            } label: {
                HStack {
                    Text("Cancel subscription")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.error)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundStyle(KathaTheme.textTertiary)
                }
                .padding(.vertical, KathaTheme.Spacing.m)
                .padding(.horizontal, KathaTheme.Spacing.l)
                .background(
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                        .fill(KathaTheme.surface)
                )
            }
            .buttonStyle(.plain)
        }
    }
}

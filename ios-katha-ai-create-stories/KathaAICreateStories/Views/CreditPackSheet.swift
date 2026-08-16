//
//  CreditPackSheet.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Credit Pack Purchase Sheet

struct CreditPackSheet: View {
    @Environment(AppState.self) private var appState
    @State private var selectedPackId: String

    init(preselectedId: String?) {
        _selectedPackId = State(initialValue: preselectedId ?? CreditPack.value.id)
    }

    private var selectedPack: CreditPack {
        CreditPack.all.first { $0.id == selectedPackId } ?? CreditPack.value
    }

    var body: some View {
        VStack(spacing: 0) {
            // Drag handle
            Capsule()
                .fill(KathaTheme.border)
                .frame(width: 40, height: 4)
                .padding(.top, KathaTheme.Spacing.m)
                .padding(.bottom, KathaTheme.Spacing.s)

            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Buy credits")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("One-time purchase. Credits never expire.")
                        .font(.system(size: 13))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                Spacer()
                Button {
                    Haptics.light()
                    appState.closeCreditPackSheet()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KathaTheme.textSecondary)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(KathaTheme.border.opacity(0.3)))
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.top, KathaTheme.Spacing.m)

            // Pack tiles
            VStack(spacing: KathaTheme.Spacing.s) {
                ForEach(CreditPack.all) { pack in
                    packRow(pack)
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.top, KathaTheme.Spacing.l)

            Spacer()

            // Bottom pinned CTA
            VStack(spacing: KathaTheme.Spacing.s) {
                PrimaryCTA(
                    title: appState.isPurchasingPack
                        ? "Processing…"
                        : "Buy \(selectedPack.name) · \(selectedPack.price)"
                ) {
                    Task { await appState.purchaseCreditPack(selectedPack) }
                }
                .disabled(appState.isPurchasingPack)

                Text("Payment charged to your Apple ID.")
                    .font(.system(size: 11))
                    .foregroundStyle(KathaTheme.textTertiary)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.bottom, KathaTheme.Spacing.l)
        }
        .background(KathaTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.xxl))
    }

    private func packRow(_ pack: CreditPack) -> some View {
        let isSelected = pack.id == selectedPackId

        return Button {
            Haptics.light()
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedPackId = pack.id
            }
        } label: {
            HStack(spacing: KathaTheme.Spacing.m) {
                ZStack {
                    ForEach(0..<min(pack.coinCount, 5), id: \.self) { i in
                        Image(systemName: "dollarsign.circle.fill")
                            .font(.system(size: 16 - CGFloat(i) * 2))
                            .foregroundStyle(KathaTheme.accent)
                            .offset(x: CGFloat(i) * 5, y: CGFloat(i) * 3)
                    }
                }
                .frame(width: 40, height: 32)

                VStack(alignment: .leading, spacing: 2) {
                    Text(pack.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("\(pack.credits) credits")
                        .font(.system(size: 12))
                        .foregroundStyle(KathaTheme.textSecondary)
                }

                Spacer()

                Text(pack.price)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)

                ZStack {
                    Circle()
                        .stroke(isSelected ? KathaTheme.accent : KathaTheme.border, lineWidth: 2)
                        .frame(width: 22, height: 22)
                    if isSelected {
                        Circle()
                            .fill(KathaTheme.accent)
                            .frame(width: 12, height: 12)
                    }
                }
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.vertical, KathaTheme.Spacing.m)
            .background(
                RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                    .fill(isSelected ? KathaTheme.accentSoft.opacity(0.3) : KathaTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                            .stroke(isSelected ? KathaTheme.accent : KathaTheme.border, lineWidth: isSelected ? 1.5 : 1)
                    )
            )
        }
        .buttonStyle(PressScaleStyle(scale: 0.98))
    }
}

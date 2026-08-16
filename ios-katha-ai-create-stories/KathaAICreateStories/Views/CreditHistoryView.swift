//
//  CreditHistoryView.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Credit History Screen

struct CreditHistoryScreen: View {
    @Environment(AppState.self) private var appState
    @State private var filterIndex: Int = 0

    private let filters = ["All", "Earned", "Spent", "Purchased"]

    private var filteredEntries: [CreditLedgerEntry] {
        let all = appState.fullLedgerEntries
        switch filterIndex {
        case 1: return all.filter { $0.amount > 0 }
        case 2: return all.filter { $0.amount < 0 }
        case 3: return all.filter { $0.reason == .purchase || $0.reason == .subscription }
        default: return all
        }
    }

    /// Group entries by day
    private var groupedEntries: [(String, [CreditLedgerEntry])] {
        let cal = Calendar.current
        let now = Date()

        let groups = Dictionary(grouping: filteredEntries) { entry -> String in
            if cal.isDateInToday(entry.timestamp) { return "TODAY" }
            if cal.isDateInYesterday(entry.timestamp) { return "YESTERDAY" }
            if cal.dateInterval(of: .weekOfYear, for: entry.timestamp)?.contains(now) == true {
                return "THIS WEEK"
            }
            return "EARLIER"
        }

        let order = ["TODAY", "YESTERDAY", "THIS WEEK", "EARLIER"]
        return order.compactMap { key in
            guard let entries = groups[key], !entries.isEmpty else { return nil }
            return (key, entries)
        }
    }

    var body: some View {
        ZStack {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: 0) {
                navBar

                filterChips
                    .padding(.horizontal, KathaTheme.Spacing.l)
                    .padding(.vertical, KathaTheme.Spacing.m)

                if filteredEntries.isEmpty {
                    EmptyState(
                        icon: "doc.text.magnifyingglass",
                        title: "No entries",
                        message: filterIndex == 3 ? "No purchases yet." : "No credit activity to show."
                    )
                    .padding(.top, 80)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.xxl) {
                            ForEach(groupedEntries, id: \.0) { group, entries in
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(group)
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(KathaTheme.textSecondary)
                                        .tracking(0.5)
                                        .padding(.bottom, KathaTheme.Spacing.s)

                                    VStack(spacing: 0) {
                                        ForEach(entries) { entry in
                                            LedgerRow(entry: entry)
                                            if entry.id != entries.last?.id {
                                                Rectangle()
                                                    .fill(KathaTheme.border.opacity(0.5))
                                                    .frame(height: 1)
                                                    .padding(.leading, KathaTheme.Spacing.l)
                                            }
                                        }
                                    }
                                    .background(
                                        RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                                            .fill(KathaTheme.surface)
                                    )
                                }
                            }
                            SafeBottomSpacer()
                        }
                        .padding(.horizontal, KathaTheme.Spacing.l)
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
        .overlay(alignment: .topLeading) {
            backButton
        }
    }

    private var backButton: some View {
        Button {
            Haptics.light()
            appState.closeCreditHistory()
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

    private var navBar: some View {
        Text("Credit history")
            .font(.system(size: 22, weight: .bold))
            .foregroundStyle(KathaTheme.textPrimary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, KathaTheme.Spacing.s)
            .padding(.leading, -40)
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KathaTheme.Spacing.s) {
                ForEach(filters.indices, id: \.self) { index in
                    FilterChip(
                        title: filters[index],
                        isSelected: filterIndex == index
                    ) {
                        Haptics.light()
                        filterIndex = index
                    }
                }
            }
        }
    }
}

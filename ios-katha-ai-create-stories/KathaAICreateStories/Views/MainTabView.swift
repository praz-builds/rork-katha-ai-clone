//
//  MainTabView.swift
//  KathaAICreateStories
//

import SwiftUI

struct MainTabView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedTab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selectedTab {
                case 0: HomeView()
                case 1: CreateView()
                default: LibraryView()
                }
            }
            .animation(.easeInOut(duration: 0.2), value: selectedTab)
            .onChange(of: selectedTab) { _, newValue in
                if newValue != 1 {
                    appState.resetWizard()
                }
            }
            .onChange(of: appState.requestedTab) { _, newValue in
                if let tab = newValue {
                    withAnimation(.spring(duration: 0.3)) {
                        selectedTab = tab
                    }
                    appState.requestedTab = nil
                }
            }

            if !appState.creationIsEditingText {
                CustomTabBar(selectedTab: $selectedTab)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

// MARK: - Custom Tab Bar

struct CustomTabBar: View {
    @Binding var selectedTab: Int
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 0) {
            tabItem(icon: "house", label: "Home", index: 0)

            Button {
                Haptics.light()
                withAnimation(.spring(duration: 0.3)) { selectedTab = 1 }
            } label: {
                ZStack {
                    Circle()
                        .fill(KathaTheme.accent)
                        .frame(width: 56, height: 56)
                        .shadow(
                            color: colorScheme == .dark
                                ? Color.black.opacity(0.5)
                                : KathaTheme.accent.opacity(0.4),
                            radius: 12, y: 4
                        )
                    Image(systemName: "plus")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.white)
                }
                .offset(y: -8)
                .padding(8) // Extended tap target
            }
            .frame(maxWidth: .infinity)

            tabItem(icon: "bookmark", label: "Library", index: 2)
        }
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(KathaTheme.surface)
                .shadow(color: .black.opacity(0.06), radius: 12, y: -2)
                .ignoresSafeArea(edges: .bottom)
        )
        .padding(.horizontal, 8)
    }

    private func tabItem(icon: String, label: String, index: Int) -> some View {
        Button {
            Haptics.light()
            withAnimation(.spring(duration: 0.3)) { selectedTab = index }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                Text(label)
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(selectedTab == index ? KathaTheme.accent : KathaTheme.textTertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
        }
    }
}

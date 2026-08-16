//
//  OnboardingView.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Splash View

struct SplashView: View {
    @Environment(AppState.self) private var appState
    @State private var opacity: Double = 0
    @State private var iconScale: Double = 0.8

    var body: some View {
        ZStack {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: KathaTheme.Spacing.l) {
                ZStack {
                    Circle()
                        .fill(KathaTheme.accent.opacity(0.1))
                        .frame(width: 100, height: 100)

                    Image(systemName: "book.pages")
                        .font(.system(size: 44))
                        .foregroundStyle(KathaTheme.accent)
                }
                .scaleEffect(iconScale)

                Text("Katha")
                    .font(KathaFont.serifBold(40))
                    .foregroundStyle(KathaTheme.textPrimary)

                Text("Stories crafted by AI, shaped by you")
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
            }
            .opacity(opacity)
        }
        .onAppear {
            appState.startSplash()
            withAnimation(.easeIn(duration: 0.6)) {
                opacity = 1
            }
            withAnimation(.easeOut(duration: 0.8).delay(0.2)) {
                iconScale = 1
            }
        }
    }
}

// MARK: - Onboarding View

struct OnboardingView: View {
    @Environment(AppState.self) private var appState
    @State private var selection: Int? = nil

    private let options: [(icon: String, title: String, desc: String)] = [
        ("book", "Read stories", "Curated tales from AI and human authors"),
        ("pencil.line", "Write my own", "Create stories with AI assistance"),
        ("safari", "Discover new voices", "Explore genres and follow authors"),
        ("sparkles", "All of the above", "Read, write, and discover — everything Katha offers")
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: KathaTheme.Spacing.xxl) {
                // Wordmark
                VStack(spacing: KathaTheme.Spacing.s) {
                    Text("Katha")
                        .font(KathaFont.serifBold(32))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("What brings you here?")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Text("Pick one — you can always change your mind.")
                        .font(.system(size: 14))
                        .foregroundStyle(KathaTheme.textSecondary)
                }
                .padding(.top, KathaTheme.Spacing.xxxl)

                // Options
                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(options.indices, id: \.self) { index in
                        let opt = options[index]
                        Button {
                            Haptics.light()
                            withAnimation(.spring(duration: 0.3)) {
                                selection = index
                            }
                        } label: {
                            HStack(spacing: KathaTheme.Spacing.m) {
                                ZStack {
                                    Circle()
                                        .fill(selection == index ? KathaTheme.accent.opacity(0.15) : KathaTheme.surface)
                                        .frame(width: 48, height: 48)
                                    Image(systemName: opt.icon)
                                        .font(.system(size: 20))
                                        .foregroundStyle(selection == index ? KathaTheme.accent : KathaTheme.textSecondary)
                                }

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(opt.title)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundStyle(KathaTheme.textPrimary)
                                    Text(opt.desc)
                                        .font(.system(size: 13))
                                        .foregroundStyle(KathaTheme.textSecondary)
                                }

                                Spacer()

                                    Image(systemName: selection == index ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 22))
                                        .foregroundStyle(selection == index ? KathaTheme.accent : KathaTheme.textTertiary)
                            }
                            .padding(KathaTheme.Spacing.l)
                            .background(
                                RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                                    .fill(KathaTheme.surface)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                                            .stroke(
                                                selection == index ? KathaTheme.accent : KathaTheme.border,
                                                lineWidth: selection == index ? 2 : 1
                                            )
                                    )
                            )
                        }
                        .buttonStyle(PressScaleStyle())
                    }
                }

                SafeBottomSpacer(height: 100)
            }
            .padding(.horizontal, KathaTheme.Spacing.l)
        }
        .themedBackground()
        .safeAreaInset(edge: .bottom) {
            if selection != nil {
                PrimaryCTA(title: "Get started", icon: "arrow.right") {
                    Haptics.success()
                    appState.completeOnboarding()
                }
                .padding(KathaTheme.Spacing.l)
                .background(KathaTheme.surface)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

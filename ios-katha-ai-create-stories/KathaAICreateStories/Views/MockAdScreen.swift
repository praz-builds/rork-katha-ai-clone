//
//  MockAdScreen.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Mock Ad Screen

struct MockAdScreen: View {
    @Environment(AppState.self) private var appState
    @State private var countdown: Int = AdConfig.mockAdDuration
    @State private var progress: CGFloat = 0
    @State private var canSkip: Bool = false
    @State private var skipBounce: Bool = false
    @State private var timer: Timer?
    @State private var wasBackgrounded: Bool = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack {
                // AD watermark
                HStack {
                    Spacer()
                    Text("AD")
                        .font(KathaFont.Meta)
                        .foregroundStyle(Color.white.opacity(0.6))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule().fill(Color.white.opacity(0.15))
                        )
                        .padding(.trailing, KathaTheme.Spacing.l)
                        .padding(.top, KathaTheme.Spacing.l)
                }
                Spacer()

                // Fake ad card
                ZStack {
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                        .fill(
                            LinearGradient(
                                colors: [KathaTheme.info, KathaTheme.premium],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 300, height: 400)

                    VStack(spacing: KathaTheme.Spacing.s) {
                        Text("This is a simulated ad")
                            .font(KathaFont.Title1)
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center)

                        Text("Watch to earn 1 credit")
                            .font(KathaFont.Body)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(KathaTheme.Spacing.l)
                }

                Text("PROMOTED BY KATHA")
                    .font(KathaFont.Meta)
                    .foregroundStyle(.white.opacity(0.5))
                    .tracking(1)
                    .padding(.top, KathaTheme.Spacing.m)

                Spacer()

                // Countdown / Skip
                VStack(spacing: KathaTheme.Spacing.s) {
                    Button {
                        if canSkip {
                            Haptics.light()
                            timer?.invalidate()
                            Task { await appState.completeAdWatch() }
                        }
                    } label: {
                        ZStack {
                            Circle()
                                .stroke(Color.white.opacity(0.3), lineWidth: 3)
                                .frame(width: 56, height: 56)

                            Circle()
                                .trim(from: 0, to: progress)
                                .stroke(KathaTheme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                                .frame(width: 56, height: 56)
                                .rotationEffect(.degrees(-90))

                            if canSkip {
                                Image(systemName: "play.fill")
                                    .font(KathaFont.Title2)
                                    .foregroundStyle(.white)
                                    .scaleEffect(skipBounce ? 1.05 : 1.0)
                            } else {
                                Text("\(countdown)")
                                    .font(KathaFont.Title2)
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                    .frame(width: 56, height: 56)
                    .disabled(!canSkip)

                    Text(canSkip ? "Skip Ad ▸" : "You can close this ad in \(countdown)s")
                        .font(KathaFont.Caption)
                        .foregroundStyle(.white.opacity(0.8))
                }
                .padding(.bottom, KathaTheme.Spacing.huge)
            }
        }
        .onAppear {
            startCountdown()
        }
        .onDisappear {
            timer?.invalidate()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            wasBackgrounded = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            if wasBackgrounded && !canSkip {
                timer?.invalidate()
                appState.interruptAdWatch()
            }
        }
    }

    private func startCountdown() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            if countdown > 0 {
                countdown -= 1
                progress = CGFloat(AdConfig.mockAdDuration - countdown) / CGFloat(AdConfig.mockAdDuration)
            } else if !canSkip {
                canSkip = true
                progress = 1.0
                withAnimation(.spring(duration: 0.3)) {
                    skipBounce = true
                }
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(200))
                    withAnimation(.spring(duration: 0.3)) {
                        skipBounce = false
                    }
                }
            }
        }
    }
}

// MARK: - Ad Reward Toast

struct AdRewardToastView: View {
    @Environment(AppState.self) private var appState
    @State private var appear: Bool = false

    var body: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: "sparkles")
                .font(KathaFont.Title1)
                .foregroundStyle(KathaTheme.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text("+1 credit earned ✨")
                    .font(KathaFont.BodyStrong)
                    .foregroundStyle(KathaTheme.textPrimary)
                Text("Balance: \(appState.credits)")
                    .font(KathaFont.Meta)
                    .foregroundStyle(KathaTheme.textSecondary)
            }

            Spacer()
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: KathaTheme.Radius.xl)
                .fill(KathaTheme.surfaceElevated)
                .shadow(color: .black.opacity(0.15), radius: 16, y: 4)
        )
        .scaleEffect(appear ? 1.0 : 0.95)
        .onAppear {
            withAnimation(.spring(duration: 0.4)) {
                appear = true
            }
        }
    }
}

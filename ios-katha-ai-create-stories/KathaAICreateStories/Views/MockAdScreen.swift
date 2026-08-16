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
                        .font(.system(size: 10, weight: .bold))
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
                                colors: [Color(hex: 0x4A78C2), Color(hex: 0xA05DE8)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 300, height: 400)

                    VStack(spacing: KathaTheme.Spacing.s) {
                        Text("This is a simulated ad")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center)

                        Text("Watch to earn 1 credit")
                            .font(.system(size: 15))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(KathaTheme.Spacing.l)
                }

                Text("PROMOTED BY KATHA")
                    .font(.system(size: 10, weight: .semibold))
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
                                    .font(.system(size: 20))
                                    .foregroundStyle(.white)
                                    .scaleEffect(skipBounce ? 1.05 : 1.0)
                            } else {
                                Text("\(countdown)")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                    .frame(width: 56, height: 56)
                    .disabled(!canSkip)

                    Text(canSkip ? "Skip Ad ▸" : "You can close this ad in \(countdown)s")
                        .font(.system(size: 13, weight: canSkip ? .semibold : .regular))
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
                .font(.system(size: 22))
                .foregroundStyle(KathaTheme.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text("+1 credit earned ✨")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                Text("Balance: \(appState.credits)")
                    .font(.system(size: 11))
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

//
//  SupportComponents.swift
//  KathaAICreateStories
//

import SwiftUI
import MessageUI
import UIKit

// MARK: - Feedback Mail Composer (FIX 7)

struct FeedbackMailComposer: UIViewControllerRepresentable {
    let appVersion: String
    let username: String

    // TODO: Replace with real feedback email address before launch
    static let feedbackEmail = "feedback@katha.ai"

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let controller = MFMailComposeViewController()
        controller.mailComposeDelegate = context.coordinator
        controller.setToRecipients([Self.feedbackEmail])
        controller.setSubject("Katha AI Feedback — v\(appVersion)")
        let device = UIDevice.current.model
        let osVersion = UIDevice.current.systemVersion
        let body = """

---
App version: \(appVersion)
Platform: iOS
Device: \(device)
OS: \(osVersion)
User: \(username)
"""
        controller.setMessageBody(body, isHTML: false)
        return controller
    }

    func updateUIViewController(_ uiViewController: MFMailComposeViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        func mailComposeController(_ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult, error: Error?) {
            controller.dismiss(animated: true)
        }
    }
}

// MARK: - Audio Mini Bar (FIX 8)

enum AudioBarState {
    case preparing
    case ready
    case error
}

struct AudioMiniBar: View {
    @Environment(AppState.self) private var appState
    let story: Story

    @State private var pulseOpacity: Double = 0.4
    @State private var showReadyTransition: Bool = false

    private var audioState: AudioBarState {
        appState.audioState(for: story.id)
    }

    var body: some View {
        Group {
            switch audioState {
            case .preparing:
                preparingBar
            case .ready:
                readyBar
            case .error:
                errorBar
            }
        }
        .onAppear {
            if audioState == .preparing {
                startPulse()
                appState.startAudioPreparation(storyId: story.id)
            }
        }
    }

    // MARK: - Preparing

    private var preparingBar: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Circle()
                .fill(KathaTheme.accent)
                .frame(width: 24, height: 24)
                .opacity(pulseOpacity)

            VStack(alignment: .leading, spacing: 2) {
                Text(story.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .lineLimit(1)
                Text("Preparing audio…")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.textSecondary)
            }

            Spacer()

            Image(systemName: "chevron.up")
                .font(.system(size: 16))
                .foregroundStyle(KathaTheme.textTertiary.opacity(0.4))
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
        .background(KathaTheme.surface)
        .contentShape(Rectangle())
        .onTapGesture {
            Haptics.light()
            appState.showToast("Audio preparing — usually ready in 8–15 seconds")
        }
    }

    // MARK: - Ready

    private var readyBar: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Button {
                Haptics.light()
                appState.showToast("Audio playback coming in the next update ✨")
            } label: {
                ZStack {
                    Circle()
                        .fill(KathaTheme.accent)
                        .frame(width: 32, height: 32)
                    Image(systemName: "play.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.white)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(story.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .lineLimit(1)
                RoundedRectangle(cornerRadius: 1)
                    .fill(KathaTheme.accent)
                    .frame(height: 2)
                    .frame(maxWidth: .infinity)
            }

            Image(systemName: "chevron.up")
                .font(.system(size: 16))
                .foregroundStyle(KathaTheme.textSecondary)
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
        .background(KathaTheme.surface)
        .transition(.opacity.animation(.easeInOut(duration: 0.3)))
    }

    // MARK: - Error

    private var errorBar: some View {
        HStack(spacing: KathaTheme.Spacing.m) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 20))
                .foregroundStyle(KathaTheme.error)

            VStack(alignment: .leading, spacing: 2) {
                Text(story.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .lineLimit(1)
                Text("Audio unavailable")
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.error)
            }

            Spacer()

            TextLink(title: "Retry") {
                appState.retryAudio(storyId: story.id)
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.vertical, KathaTheme.Spacing.m)
        .background(KathaTheme.surface)
    }

    // MARK: - Pulse Animation

    private func startPulse() {
        withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
            pulseOpacity = 1.0
        }
    }
}

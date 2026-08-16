//
//  AuthSheet.swift
//  KathaAICreateStories
//

import SwiftUI

// MARK: - Auth Sheet Content

struct AuthSheetView: View {
    @Environment(AppState.self) private var appState
    @State private var emailMode = false
    @State private var email = ""
    @FocusState private var emailFocused: Bool

    private var subtitle: String {
        appState.authSheetContext.subtitle
    }

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.xl) {
            // Drag handle
            RoundedRectangle(cornerRadius: 3)
                .fill(KathaTheme.border)
                .frame(width: 40, height: 4)
                .padding(.top, KathaTheme.Spacing.s)

            // Header
            VStack(spacing: KathaTheme.Spacing.s) {
                Text("Welcome to Katha")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(KathaTheme.textPrimary)
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }

            if emailMode {
                emailForm
            } else {
                signInOptions
            }

            Text("By continuing, you agree to our Terms of Service and Privacy Policy.")
                .font(.system(size: 11))
                .foregroundStyle(KathaTheme.textTertiary)
                .multilineTextAlignment(.center)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, KathaTheme.Spacing.xl)
        .padding(.bottom, KathaTheme.Spacing.xxl)
        .frame(maxWidth: .infinity)
        .frame(height: 420)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(KathaTheme.surface)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private var signInOptions: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            authButton(title: "Continue with Google", icon: "globe") {
                Task { await appState.signInWithGoogle() }
            }
            authButton(title: "Continue with Apple", icon: "apple.logo") {
                Task { await appState.signInWithApple() }
            }
            authButton(title: "Continue with Email", icon: "envelope") {
                Haptics.light()
                withAnimation(.easeInOut(duration: 0.25)) { emailMode = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    emailFocused = true
                }
            }
        }
    }

    private var emailForm: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            TextField("Email address", text: $email)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.vertical, KathaTheme.Spacing.m + 2)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(KathaTheme.canvas)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(KathaTheme.border, lineWidth: 1)
                )
                .focused($emailFocused)

            PrimaryCTA(title: "Continue", isLoading: appState.isAuthenticating) {
                Task { await appState.signInWithEmail(email) }
            }

            if let error = appState.authError {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(KathaTheme.error)
            }

            Button("Use a different method") {
                withAnimation(.easeInOut(duration: 0.25)) { emailMode = false }
                appState.authError = nil
            }
            .font(.system(size: 13))
            .foregroundStyle(KathaTheme.textSecondary)
        }
    }

    private func authButton(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: KathaTheme.Spacing.s) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                Text(title)
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(KathaTheme.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.vertical, KathaTheme.Spacing.m + 2)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(KathaTheme.canvas)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(KathaTheme.border, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(PressScaleStyle())
        .disabled(appState.isAuthenticating)
        .opacity(appState.isAuthenticating ? 0.6 : 1)
    }
}

// MARK: - Auth Sheet Overlay

struct AuthSheetOverlay: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture {
                    appState.dismissAuthSheet()
                }

            AuthSheetView()
        }
    }
}

// MARK: - Profile Setup View

struct ProfileSetupView: View {
    @Environment(AppState.self) private var appState
    @State private var username = ""
    @State private var displayName = ""
    @State private var bio = ""

    private var isAvailable: Bool {
        !username.isEmpty && UsernameGenerator.isAvailable(username)
    }

    private var canSubmit: Bool {
        isAvailable && !displayName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: KathaTheme.Spacing.xl) {
                    // Avatar preview
                    GeneratedAvatar(username: username, displayName: displayName, size: 88)
                        .animation(.easeInOut(duration: 0.3), value: username)

                    // Welcome text
                    VStack(spacing: KathaTheme.Spacing.xs) {
                        Text("Set up your profile")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(KathaTheme.textPrimary)
                        Text("This is how you'll appear to other readers and writers.")
                            .font(.system(size: 14))
                            .foregroundStyle(KathaTheme.textSecondary)
                            .multilineTextAlignment(.center)
                    }

                    // Fields
                    VStack(spacing: KathaTheme.Spacing.l) {
                        // Username
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                            Text("Username")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(KathaTheme.textSecondary)
                            HStack(spacing: 0) {
                                Text("@")
                                    .foregroundStyle(KathaTheme.textSecondary)
                                    .padding(.leading, KathaTheme.Spacing.l)
                                TextField("username", text: $username)
                                    .autocapitalization(.none)
                                    .padding(.vertical, KathaTheme.Spacing.m + 2)
                                    .padding(.trailing, KathaTheme.Spacing.l)
                            }
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(KathaTheme.canvas)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(
                                        username.isEmpty ? KathaTheme.border : (isAvailable ? KathaTheme.success.opacity(0.3) : KathaTheme.error.opacity(0.3)),
                                        lineWidth: 1
                                    )
                            )
                            if !username.isEmpty {
                                HStack(spacing: 4) {
                                    Image(systemName: isAvailable ? "checkmark.circle.fill" : "xmark.circle.fill")
                                        .font(.system(size: 11))
                                    Text(isAvailable ? "Available" : "This username is taken")
                                        .font(.system(size: 11))
                                }
                                .foregroundStyle(isAvailable ? KathaTheme.success : KathaTheme.error)
                            }
                        }

                        // Display name
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                            Text("Display name")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(KathaTheme.textSecondary)
                            TextField("Your name", text: $displayName)
                                .padding(.horizontal, KathaTheme.Spacing.l)
                                .padding(.vertical, KathaTheme.Spacing.m + 2)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .fill(KathaTheme.canvas)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(KathaTheme.border, lineWidth: 1)
                                )
                        }

                        // Bio
                        VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                            Text("Bio (optional)")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(KathaTheme.textSecondary)
                            TextField("Tell readers about yourself", text: $bio, axis: .vertical)
                                .lineLimit(3...6)
                                .padding(.horizontal, KathaTheme.Spacing.l)
                                .padding(.vertical, KathaTheme.Spacing.m + 2)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .fill(KathaTheme.canvas)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(KathaTheme.border, lineWidth: 1)
                                )
                        }
                    }

                    // Credits info
                    HStack(spacing: KathaTheme.Spacing.s) {
                        Image(systemName: "gift.fill")
                            .foregroundStyle(KathaTheme.accent)
                        Text("You have 3 welcome credits to start writing.")
                            .font(.system(size: 13))
                            .foregroundStyle(KathaTheme.textSecondary)
                    }
                    .padding(KathaTheme.Spacing.l)
                    .frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: KathaTheme.Radius.m)
                            .fill(KathaTheme.accentSoft.opacity(0.3))
                    )

                    SafeBottomSpacer(height: 80)
                }
                .padding(KathaTheme.Spacing.xl)
            }
            .themedBackground()
            .navigationTitle("Profile Setup")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                PrimaryCTA(title: "Start writing", icon: "arrow.right") {
                    appState.completeProfileSetup(
                        username: username,
                        displayName: displayName.trimmingCharacters(in: .whitespaces),
                        bio: bio.trimmingCharacters(in: .whitespaces)
                    )
                }
                .disabled(!canSubmit)
                .opacity(canSubmit ? 1 : 0.5)
                .padding(KathaTheme.Spacing.l)
                .background(KathaTheme.surface)
            }
        }
        .onAppear {
            username = appState.generatedUsername
        }
    }
}

//
//  EditProfileView.swift
//  KathaAICreateStories
//

import SwiftUI

struct EditProfileView: View {
    @Environment(AppState.self) private var appState

    @State private var displayName = ""
    @State private var username = ""
    @State private var bio = ""
    @State private var didLoad = false

    @State private var usernameStatus: UsernameStatus = .idle
    @State private var checkTask: Task<Void, Never>?
    @State private var showDiscardConfirm = false
    @State private var showAvatarSheet = false
    @State private var showRegenerateConfirm = false
    @State private var saveError: String?

    enum UsernameStatus: Equatable {
        case idle
        case checking
        case available
        case taken
        case invalid
    }

    private var originalDisplayName: String { appState.currentUser?.displayName ?? "" }
    private var originalUsername: String { appState.currentUser?.username ?? "" }
    private var originalBio: String { appState.currentUser?.bio ?? "" }

    private var hasChanges: Bool {
        displayName != originalDisplayName || username != originalUsername || bio != originalBio
    }

    private var cooldownDate: Date? { appState.usernameChangeUnlockDate }

    private var usernameLocked: Bool { cooldownDate != nil }

    private var isUsernameFormatValid: Bool {
        username.count >= 3 && username.count <= 20 &&
        username.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" }
    }

    private var canSave: Bool {
        guard hasChanges, !appState.isSavingProfile else { return false }
        guard !displayName.trimmingCharacters(in: .whitespaces).isEmpty, displayName.count <= 30 else { return false }
        guard bio.count <= 160 else { return false }
        if username != originalUsername {
            guard !usernameLocked, isUsernameFormatValid, usernameStatus != .taken else { return false }
        }
        return true
    }

    private var cooldownDateText: String {
        guard let date = cooldownDate else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    var body: some View {
        ZStack(alignment: .top) {
            KathaTheme.canvas.ignoresSafeArea()

            VStack(spacing: 0) {
                navBar

                if let saveError {
                    Text(saveError)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(KathaTheme.error)
                        .padding(.horizontal, 20)
                        .padding(.vertical, KathaTheme.Spacing.s)
                        .frame(maxWidth: .infinity)
                        .background(KathaTheme.errorSoft)
                }

                ScrollView {
                    VStack(spacing: 0) {
                        avatarSection
                            .padding(.top, 32)

                        formFields
                            .padding(.top, 32)

                        accountSection
                            .padding(.top, 48)

                        SafeBottomSpacer()
                    }
                    .padding(.horizontal, 20)
                }
                .scrollIndicators(.hidden)
                .disabled(appState.isSavingProfile)
            }
        }
        .onAppear {
            if !didLoad {
                didLoad = true
                displayName = originalDisplayName
                username = originalUsername
                bio = originalBio
            }
        }
        .confirmationDialog("Change avatar", isPresented: $showAvatarSheet, titleVisibility: .visible) {
            Button("Take photo") { appState.showToast("Photo upload coming in the next update ✨") }
            Button("Choose from library") { appState.showToast("Photo upload coming in the next update ✨") }
            Button("Regenerate") { showRegenerateConfirm = true }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Regenerate avatar?", isPresented: $showRegenerateConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Regenerate") {
                Haptics.light()
                appState.showToast("New look, same you ✨")
            }
        } message: {
            Text("This gives you a new random look based on your username.")
        }
        .alert("Discard changes?", isPresented: $showDiscardConfirm) {
            Button("Keep editing", role: .cancel) {}
            Button("Discard", role: .destructive) {
                appState.popProfileRoute()
            }
        }
    }

    // MARK: - Nav Bar

    private var navBar: some View {
        HStack {
            Button {
                if hasChanges {
                    showDiscardConfirm = true
                } else {
                    appState.popProfileRoute()
                }
            } label: {
                Text("Cancel")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(KathaTheme.textSecondary)
            }
            .frame(width: 70, alignment: .leading)

            Spacer()

            Text("Edit profile")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(KathaTheme.textPrimary)

            Spacer()

            Button {
                save()
            } label: {
                if appState.isSavingProfile {
                    ProgressView()
                        .tint(KathaTheme.accent)
                } else {
                    Text("Save")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(canSave ? KathaTheme.accent : KathaTheme.textTertiary)
                }
            }
            .disabled(!canSave)
            .frame(width: 70, alignment: .trailing)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Avatar

    private var avatarSection: some View {
        VStack(spacing: 12) {
            Button {
                Haptics.light()
                showAvatarSheet = true
            } label: {
                ZStack(alignment: .bottomTrailing) {
                    GeneratedAvatar(username: originalUsername, displayName: displayName, size: 96)

                    ZStack {
                        Circle()
                            .fill(KathaTheme.surface)
                            .frame(width: 32, height: 32)
                            .overlay(Circle().stroke(KathaTheme.accent, lineWidth: 1.5))
                        Image(systemName: "pencil")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(KathaTheme.accent)
                    }
                }
            }
            .buttonStyle(PressScaleStyle())

            TextLink(title: "Change photo") {
                showAvatarSheet = true
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Form Fields

    private var formFields: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.xxl) {
            // Display name
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                fieldLabel("DISPLAY NAME")

                TextField("Your name", text: $displayName)
                    .font(.system(size: 15))
                    .foregroundStyle(KathaTheme.textPrimary)
                    .padding(12)
                    .frame(height: 48)
                    .background(fieldBackground(isError: displayName.count > 30))
                    .onChange(of: displayName) { _, newValue in
                        if newValue.count > 30 {
                            displayName = String(newValue.prefix(30))
                        }
                    }

                charCounter(displayName.count, max: 30)
            }

            // Username
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                fieldLabel("USERNAME")

                HStack(spacing: 2) {
                    Text("@")
                        .font(.system(size: 15))
                        .foregroundStyle(KathaTheme.textTertiary)

                    TextField("username", text: $username)
                        .font(.system(size: 15))
                        .foregroundStyle(KathaTheme.textPrimary)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .disabled(usernameLocked)
                        .onChange(of: username) { _, newValue in
                            if newValue.count > 20 {
                                username = String(newValue.prefix(20))
                            }
                            scheduleUsernameCheck()
                        }
                }
                .padding(12)
                .frame(height: 48)
                .background(fieldBackground(isError: usernameStatus == .taken || usernameStatus == .invalid))
                .opacity(usernameLocked ? 0.4 : 1)

                if usernameLocked {
                    Text("You can change your username again on \(cooldownDateText).")
                        .font(.system(size: 11))
                        .foregroundStyle(KathaTheme.textTertiary)
                } else {
                    HStack {
                        Group {
                            switch usernameStatus {
                            case .taken:
                                Text("This username is already taken.")
                                    .foregroundStyle(KathaTheme.error)
                            case .invalid:
                                Text("3-20 characters, letters and numbers only.")
                                    .foregroundStyle(KathaTheme.error)
                            case .available:
                                Text("Available ✓")
                                    .foregroundStyle(KathaTheme.success)
                            default:
                                charCounter(username.count, max: 20)
                            }
                        }
                        .font(.system(size: 11))

                        Spacer()

                        if username != originalUsername && !username.isEmpty {
                            HStack(spacing: 6) {
                                if usernameStatus == .checking {
                                    ProgressView().scaleEffect(0.6)
                                }
                                TextLink(title: "Check availability") {
                                    checkUsername()
                                }
                            }
                        }
                    }
                }
            }

            // Bio
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                fieldLabel("BIO")

                TextField(
                    "A sentence or two about your writing. Warm and specific works best.",
                    text: $bio,
                    axis: .vertical
                )
                .font(.system(size: 15))
                .foregroundStyle(KathaTheme.textPrimary)
                .lineLimit(4...6)
                .padding(12)
                .background(fieldBackground(isError: bio.count > 160))

                charCounter(bio.count, max: 160, showError: bio.count > 160)
            }
        }
    }

    // MARK: - Account Section

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            fieldLabel("ACCOUNT")

            Button {
                Haptics.light()
                appState.showToast("Email management coming in the next update ✨")
            } label: {
                HStack {
                    Text("Change email")
                        .font(.system(size: 15))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundStyle(KathaTheme.textTertiary)
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(KathaTheme.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(KathaTheme.border, lineWidth: 1)
                        )
                )
            }
        }
    }

    // MARK: - Helpers

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .tracking(1)
            .foregroundStyle(KathaTheme.textTertiary)
    }

    private func charCounter(_ count: Int, max: Int, showError: Bool = false) -> some View {
        Text("\(count)/\(max)")
            .font(.system(size: 11))
            .foregroundStyle(showError ? KathaTheme.error : KathaTheme.textTertiary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func fieldBackground(isError: Bool) -> some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(KathaTheme.surface)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isError ? KathaTheme.error : KathaTheme.border, lineWidth: 1)
            )
            .animation(.easeInOut(duration: 0.2), value: isError)
    }

    private func scheduleUsernameCheck() {
        checkTask?.cancel()
        guard username != originalUsername, !username.isEmpty else {
            usernameStatus = .idle
            return
        }
        checkTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            checkUsername()
        }
    }

    private func checkUsername() {
        guard username != originalUsername else {
            usernameStatus = .idle
            return
        }
        guard isUsernameFormatValid else {
            usernameStatus = .invalid
            return
        }
        usernameStatus = .checking
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            usernameStatus = UsernameGenerator.isAvailable(username) ? .available : .taken
        }
    }

    private func save() {
        guard canSave else { return }
        saveError = nil
        Task {
            let success = await appState.saveProfile(
                displayName: displayName.trimmingCharacters(in: .whitespaces),
                username: username,
                bio: bio
            )
            if success {
                appState.popProfileRoute()
            } else {
                saveError = "Couldn't save profile. Try again?"
            }
        }
    }
}

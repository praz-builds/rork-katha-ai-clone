import SwiftUI

private func safetyText(_ key: String) -> String {
    NSLocalizedString(key, comment: "Katha content safety copy")
}

private struct SafetySheet<Content: View>: View {
    let height: CGFloat?
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.34).ignoresSafeArea()
            VStack(spacing: 0) {
                Capsule()
                    .fill(KathaTheme.textTertiary.opacity(0.5))
                    .frame(width: 38, height: 4)
                    .padding(.top, 10)
                    .padding(.bottom, 12)
                content()
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(KathaTheme.surface)
            .clipShape(.rect(topLeadingRadius: 24, topTrailingRadius: 24))
        }
        .ignoresSafeArea()
    }
}

struct ReadingLevelSheet: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        SafetySheet(height: 520) {
            VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                HStack {
                    Text(safetyText("reading.level.title"))
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(KathaTheme.textPrimary)
                    Spacer()
                    Button { appState.showReadingLevelSheet = false } label: {
                        Image(systemName: "xmark").foregroundStyle(KathaTheme.textSecondary).frame(width: 44, height: 44)
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.xl)

                Text(safetyText("reading.level.subtitle"))
                    .font(.system(size: 14))
                    .foregroundStyle(KathaTheme.textSecondary)
                    .padding(.horizontal, KathaTheme.Spacing.xl)

                VStack(spacing: KathaTheme.Spacing.m) {
                    ForEach(ReadingLevel.allCases) { level in
                        if !(appState.readingLevelSheetForCap && level == .advanced) {
                            levelCard(level)
                        }
                    }
                }
                .padding(.horizontal, KathaTheme.Spacing.xl)
            }
        }
    }

    private func levelCard(_ level: ReadingLevel) -> some View {
        let selected: Bool
        if appState.readingLevelSheetForWizard {
            selected = appState.wizardReadingLevel == level
        } else if appState.readingLevelSheetForCap {
            selected = appState.kidsReadingLevelCap == level
        } else {
            selected = appState.defaultReadingLevel == level
        }
        return Button {
            Haptics.light()
            appState.selectReadingLevel(level)
            Task {
                try? await Task.sleep(for: .milliseconds(300))
                appState.showReadingLevelSheet = false
            }
        } label: {
            HStack(spacing: KathaTheme.Spacing.m) {
                Image(systemName: level.icon)
                    .font(.system(size: 20))
                    .foregroundStyle(KathaTheme.accent)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 4) {
                    Text(level.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary)
                    Text(level.subtitle).font(.system(size: 13)).foregroundStyle(KathaTheme.textSecondary).multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? KathaTheme.accent : KathaTheme.borderStrong)
            }
            .padding(KathaTheme.Spacing.l)
            .background(RoundedRectangle(cornerRadius: 16).fill(selected ? KathaTheme.accentSoft.opacity(0.6) : KathaTheme.surface))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(selected ? KathaTheme.accent : KathaTheme.border, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }
}

struct ParentalControlsScreen: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { appState.showParentalControls = false } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }
                Text(safetyText("parental.title")).font(.system(size: 20, weight: .bold))
                Spacer()
            }
            .foregroundStyle(KathaTheme.textPrimary)
            .padding(.horizontal, KathaTheme.Spacing.l)
            .padding(.top, KathaTheme.Spacing.s)

            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.xl) {
                    parentalSection(title: safetyText("parental.section.kids")) {
                        settingToggle(title: safetyText("parental.kids_mode"), subtitle: safetyText("parental.kids_mode.subtitle"), isOn: appState.kidsMode, action: {
                            if appState.kidsMode { appState.beginKidsModeDisable() } else { appState.beginKidsModeEnable() }
                        })
                    }

                    if appState.kidsMode {
                        parentalSection(title: safetyText("parental.section.allowed")) {
                            settingsAction(title: safetyText("parental.genres"), value: safetyText("parental.genres.safe")) {
                                appState.showToast(safetyText("parental.genres.stub"))
                            }
                            Divider().background(KathaTheme.border)
                            settingsAction(title: safetyText("parental.reading_cap"), value: appState.kidsReadingLevelCap.title) {
                                appState.openReadingLevelSheet(forCap: true)
                            }
                        }
                        parentalSection(title: safetyText("parental.section.features")) {
                            toggleRow(title: safetyText("parental.comments"), isOn: appState.kidsCommentsEnabled) { appState.setKidsCommentsEnabled($0) }
                            Divider().background(KathaTheme.border)
                            toggleRow(title: safetyText("parental.share"), isOn: appState.kidsShareEnabled) { appState.setKidsShareEnabled($0) }
                            Divider().background(KathaTheme.border)
                            toggleRow(title: safetyText("parental.search"), isOn: appState.kidsSearchSuggestionsEnabled) { appState.setKidsSearchSuggestionsEnabled($0) }
                        }
                        parentalSection(title: safetyText("parental.section.pin")) {
                            settingsAction(title: safetyText("parental.change_pin"), value: nil) { appState.beginPinChange() }
                            Divider().background(KathaTheme.border)
                            settingsAction(title: safetyText("parental.forgot_pin"), value: nil) { appState.showToast(safetyText("parental.forgot_pin.message")) }
                        }
                        parentalSection(title: safetyText("parental.section.danger")) {
                            DestructiveCTA(title: safetyText("parental.turn_off"), icon: "lock.open") { appState.beginKidsModeDisable() }
                        }
                    }
                    SafeBottomSpacer()
                }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.top, KathaTheme.Spacing.m)
            }
        }
        .background(KathaTheme.canvas)
    }

    private func parentalSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            Text(title.uppercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(KathaTheme.textTertiary)
            VStack(spacing: 0) { content() }
                .padding(.horizontal, KathaTheme.Spacing.l)
                .background(RoundedRectangle(cornerRadius: 16).fill(KathaTheme.surface))
        }
    }

    private func settingToggle(title: String, subtitle: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary)
                Text(subtitle).font(.system(size: 12)).foregroundStyle(KathaTheme.textSecondary)
            }
            Spacer()
            Toggle("", isOn: Binding(get: { isOn }, set: { _ in action() })).labelsHidden().tint(KathaTheme.accent)
        }
        .padding(.vertical, KathaTheme.Spacing.m)
    }

    private func toggleRow(title: String, isOn: Bool, action: @escaping (Bool) -> Void) -> some View {
        HStack { Text(title).font(.system(size: 15)).foregroundStyle(KathaTheme.textPrimary); Spacer(); Toggle("", isOn: Binding(get: { isOn }, set: action)).labelsHidden().tint(KathaTheme.accent) }
            .padding(.vertical, KathaTheme.Spacing.m)
    }

    private func settingsAction(title: String, value: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack { Text(title).font(.system(size: 15)).foregroundStyle(KathaTheme.textPrimary); Spacer(); if let value { Text(value).font(.system(size: 14)).foregroundStyle(KathaTheme.textSecondary) }; Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(KathaTheme.textTertiary) }
                .padding(.vertical, KathaTheme.Spacing.m)
        }.buttonStyle(.plain)
    }
}

struct PINSetupScreen: View {
    @Environment(AppState.self) private var appState
    let mode: PinSetupMode
    @State private var step = 1
    @State private var pin = ""
    @State private var confirmation = ""
    @State private var hasMismatch = false

    var body: some View {
        VStack(spacing: KathaTheme.Spacing.xl) {
            HStack {
                Button { appState.showPINSetup = false } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                Text(step == 1 ? safetyText("pin.setup.title") : safetyText("pin.confirm.title")).font(.system(size: 20, weight: .bold))
                Spacer()
            }
            .foregroundStyle(KathaTheme.textPrimary)
            .padding(.horizontal, KathaTheme.Spacing.l)

            Spacer()
            Image(systemName: "checkmark.shield")
                .font(.system(size: 56))
                .foregroundStyle(KathaTheme.accent)
            Text(step == 1 ? safetyText("pin.setup.heading") : safetyText("pin.confirm.heading"))
                .font(.system(size: 24, weight: .bold)).foregroundStyle(KathaTheme.textPrimary).multilineTextAlignment(.center)
            Text(safetyText("pin.setup.subtitle"))
                .font(.system(size: 14)).foregroundStyle(KathaTheme.textSecondary).multilineTextAlignment(.center).padding(.horizontal, 40)
            PINCircles(count: step == 1 ? pin.count : confirmation.count, success: false)
                .offset(x: hasMismatch ? -8 : 0)
                .animation(hasMismatch ? .easeInOut(duration: 0.06).repeatCount(5, autoreverses: true) : .default, value: hasMismatch)
            PINKeypad { digit in
                if step == 1 { pin = String((pin + digit).prefix(6)) } else { confirmation = String((confirmation + digit).prefix(6)) }
                hasMismatch = false
            } onBackspace: {
                if step == 1 { pin.removeLast() } else { confirmation.removeLast() }
            }
            if (step == 1 ? pin.count : confirmation.count) >= 4 {
                TextLink(title: safetyText("cta.continue")) {
                    if step == 1 { step = 2; confirmation = "" } else if confirmation == pin { if mode == .changePin { appState.completePinChange(pin: pin) } else { appState.completeKidsModeEnable(pin: pin) } } else { hasMismatch = true; confirmation = ""; appState.showToast(safetyText("pin.mismatch")) }
                }
            }
            Spacer()
        }
        .background(KathaTheme.canvas)
    }
}

struct PINEntrySheet: View {
    @Environment(AppState.self) private var appState
    let context: PinEntryContext
    @State private var pin = ""
    @State private var attempts = 0
    @State private var verifying = false

    var body: some View {
        SafetySheet(height: 620) {
            VStack(spacing: KathaTheme.Spacing.xl) {
                HStack { Text(safetyText("pin.entry.title")).font(.system(size: 24, weight: .bold)).foregroundStyle(KathaTheme.textPrimary); Spacer(); TextLink(title: safetyText("cta.cancel")) { appState.showPINEntry = false } }
                    .padding(.horizontal, KathaTheme.Spacing.xl)
                Text(context == .disableKidsMode ? safetyText("pin.entry.disable.subtitle") : safetyText("pin.entry.change.subtitle"))
                    .font(.system(size: 14)).foregroundStyle(KathaTheme.textSecondary)
                if appState.isPinCooldownActive {
                    Image(systemName: "lock.clock").font(.system(size: 42)).foregroundStyle(KathaTheme.error)
                    Text(safetyText("pin.cooldown")).font(.system(size: 16, weight: .semibold)).foregroundStyle(KathaTheme.error).multilineTextAlignment(.center).padding(.horizontal, 30)
                } else {
                    PINCircles(count: pin.count, success: verifying)
                    PINKeypad { digit in
                        guard pin.count < 6 else { return }
                        pin.append(digit)
                        guard let stored = appState.kidsModePin, pin.count == stored.count else { return }
                        verifying = true
                        Task {
                            try? await Task.sleep(for: .milliseconds(180))
                            if appState.verifyPin(pin) { appState.completePinEntry() } else { attempts += 1; pin = ""; verifying = false; if attempts >= 3 { appState.recordPinFailure(); appState.showPINEntry = false; appState.showToast(safetyText("pin.too_many")) } else { appState.showToast(String(format: safetyText("pin.incorrect"), 3 - attempts)) } }
                        }
                    } onBackspace: { if !pin.isEmpty { pin.removeLast() } }
                }
                Spacer()
            }
            .padding(.top, KathaTheme.Spacing.m)
        }
    }
}

struct PINCircles: View {
    let count: Int
    let success: Bool
    var body: some View {
        HStack(spacing: 16) {
            ForEach(0..<6, id: \.self) { index in
                Circle().fill(index < count ? (success ? KathaTheme.success : KathaTheme.accent) : Color.clear)
                    .frame(width: 12, height: 12)
                    .overlay(Circle().stroke(index < count ? Color.clear : KathaTheme.borderStrong, lineWidth: 1.5))
                    .scaleEffect(index < count ? 1.1 : 1)
                    .animation(.spring(response: 0.2, dampingFraction: 0.6), value: count)
            }
        }
    }
}

struct PINKeypad: View {
    let onDigit: (String) -> Void
    let onBackspace: () -> Void
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete.left"]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(64), spacing: 12), count: 3), spacing: 12) {
            ForEach(keys, id: \.self) { key in
                if key.isEmpty { Color.clear.frame(width: 64, height: 64) }
                else if key == "delete.left" { Button { Haptics.light(); onBackspace() } label: { Image(systemName: key).font(.system(size: 22)).foregroundStyle(KathaTheme.textSecondary).frame(width: 64, height: 64).background(Circle().fill(KathaTheme.surface).overlay(Circle().stroke(KathaTheme.border, lineWidth: 1))) }.buttonStyle(PressScaleStyle(scale: 0.95)) }
                else { Button { Haptics.light(); onDigit(key) } label: { Text(key).font(.system(size: 22, weight: .semibold)).foregroundStyle(KathaTheme.textPrimary).frame(width: 64, height: 64).background(Circle().fill(KathaTheme.surface).overlay(Circle().stroke(KathaTheme.border, lineWidth: 1))) }.buttonStyle(PressScaleStyle(scale: 0.95)) }
            }
        }
    }
}

struct AgeVerificationSheet: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        SafetySheet(height: 470) {
            VStack(spacing: KathaTheme.Spacing.l) {
                HStack { Text(safetyText("age.title")).font(.system(size: 24, weight: .bold)).foregroundStyle(KathaTheme.textPrimary); Spacer(); Button { appState.showAgeVerification = false } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }.foregroundStyle(KathaTheme.textSecondary) }.padding(.horizontal, KathaTheme.Spacing.xl)
                Image(systemName: "shield.lefthalf.filled").font(.system(size: 48)).foregroundStyle(KathaTheme.error)
                Text(safetyText("age.heading")).font(.system(size: 20, weight: .bold)).foregroundStyle(KathaTheme.textPrimary).multilineTextAlignment(.center)
                Text(safetyText("age.subtitle")).font(.system(size: 14)).foregroundStyle(KathaTheme.textSecondary).multilineTextAlignment(.center).padding(.horizontal, 32)
                VStack(spacing: KathaTheme.Spacing.m) {
                    PrimaryCTA(title: safetyText("age.confirm")) { appState.confirmAgeVerification() }
                    SecondaryCTA(title: safetyText("age.cancel")) { appState.showAgeVerification = false }
                }
                Text(safetyText("age.fine_print")).font(.system(size: 11)).foregroundStyle(KathaTheme.textTertiary).multilineTextAlignment(.center).padding(.horizontal, 24)
            }
        }
    }
}

struct KidsModeIndicator: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        if appState.kidsMode {
            Button { appState.openParentalControls() } label: {
                Label(safetyText("kids.indicator"), systemImage: "checkmark.shield")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(KathaTheme.accent)
                    .padding(.horizontal, 12).frame(height: 28)
                    .background(Capsule().fill(KathaTheme.accentSoft))
            }
            .buttonStyle(.plain)
        }
    }
}

struct RestrictedStoryPlaceholder: View {
    @Environment(AppState.self) private var appState
    var body: some View {
        VStack(spacing: KathaTheme.Spacing.l) {
            HStack { Button { appState.closeReader() } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }; Spacer() }.foregroundStyle(KathaTheme.textPrimary)
            Spacer()
            Image(systemName: "shield").font(.system(size: 96)).foregroundStyle(KathaTheme.textTertiary.opacity(0.4))
            Text(safetyText("restricted.title")).font(.system(size: 24, weight: .bold)).foregroundStyle(KathaTheme.textPrimary).multilineTextAlignment(.center)
            Text(safetyText("restricted.message")).font(.system(size: 15)).foregroundStyle(KathaTheme.textSecondary).multilineTextAlignment(.center).padding(.horizontal, 28)
            SecondaryCTA(title: safetyText("restricted.back")) { appState.closeReader() }.padding(.horizontal, 24)
            Spacer()
        }
        .background(KathaTheme.canvas)
    }
}

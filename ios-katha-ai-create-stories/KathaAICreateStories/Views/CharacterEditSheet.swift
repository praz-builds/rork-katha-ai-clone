import SwiftUI

struct CharacterEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var role: String
    @State private var description: String
    @State private var showDiscardConfirmation = false
    @FocusState private var nameFocused: Bool

    let existingCharacter: WizardCharacter?
    let onSave: (WizardCharacter) -> Void

    private let roles = ["Hero", "Friend", "Villain", "Mentor", "Sidekick", "Love Interest", "Other"]

    init(character: WizardCharacter?, onSave: @escaping (WizardCharacter) -> Void) {
        existingCharacter = character
        self.onSave = onSave
        _name = State(initialValue: character?.name ?? "")
        _role = State(initialValue: character?.role.isEmpty == false ? character?.role ?? "" : "Hero")
        _description = State(initialValue: character?.description ?? "")
    }

    private var hasChanges: Bool {
        !name.isEmpty || !description.isEmpty || existingCharacter != nil
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(KathaTheme.borderStrong)
                .frame(width: 36, height: 4)
                .padding(.top, KathaTheme.Spacing.s)
            HStack {
                Text(existingCharacter == nil ? "Add character" : "Edit character")
                    .font(KathaFont.Title2)
                    .foregroundStyle(KathaTheme.textPrimary)
                Spacer()
                Button {
                    if hasChanges { showDiscardConfirmation = true } else { dismiss() }
                } label: {
                    Image(systemName: "xmark")
                        .font(KathaFont.BodyStrong)
                        .frame(width: 44, height: 44)
                }
                .foregroundStyle(KathaTheme.textSecondary)
            }
            .padding(.horizontal, KathaTheme.Spacing.mdLg)
            .padding(.top, KathaTheme.Spacing.s)

            ScrollView {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
                    fieldLabel("NAME")
                    TextField("Character name", text: $name)
                        .font(KathaFont.Body)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, KathaTheme.Spacing.m)
                        .frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.s).fill(KathaTheme.surface).overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.s).stroke(KathaTheme.border)))
                        .focused($nameFocused)
                        .onChange(of: name) { _, value in name = String(value.prefix(30)) }

                    fieldLabel("ROLE")
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: KathaTheme.Spacing.s) {
                            ForEach(roles, id: \.self) { item in
                                Button { role = item } label: {
                                    Text(item)
                                        .font(KathaFont.Caption)
                                        .foregroundStyle(role == item ? .white : KathaTheme.textSecondary)
                                        .padding(.horizontal, KathaTheme.Spacing.m)
                                        .padding(.vertical, KathaTheme.Spacing.s)
                                        .background(Capsule().fill(role == item ? KathaTheme.accent : KathaTheme.surface))
                                        .overlay(Capsule().stroke(KathaTheme.border, lineWidth: role == item ? 0 : 1))
                                }
                            }
                        }
                    }

                    fieldLabel("DESCRIPTION (OPTIONAL)")
                    TextEditor(text: $description)
                        .font(KathaFont.Body)
                        .foregroundStyle(KathaTheme.textPrimary)
                        .frame(minHeight: 88)
                        .padding(KathaTheme.Spacing.s)
                        .background(RoundedRectangle(cornerRadius: KathaTheme.Radius.s).fill(KathaTheme.surface).overlay(RoundedRectangle(cornerRadius: KathaTheme.Radius.s).stroke(KathaTheme.border)))
                        .onChange(of: description) { _, value in description = String(value.prefix(200)) }
                    Text("\(description.count) / 200")
                        .font(KathaFont.Meta)
                        .foregroundStyle(KathaTheme.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .padding(.horizontal, KathaTheme.Spacing.mdLg)
                .padding(.top, KathaTheme.Spacing.l)
            }

            PrimaryCTA(title: existingCharacter == nil ? "Save character" : "Update character") {
                let saved = WizardCharacter(id: existingCharacter?.id ?? UUID().uuidString, name: name.trimmingCharacters(in: .whitespacesAndNewlines), role: role, description: description)
                onSave(saved)
                dismiss()
            }
            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .padding(.horizontal, KathaTheme.Spacing.mdLg)
            .padding(.top, KathaTheme.Spacing.m)
            SafeBottomSpacer(height: KathaTheme.Spacing.l)
        }
        .background(KathaTheme.surface)
        .presentationDetents([.fraction(0.65)])
        .presentationDragIndicator(.hidden)
        .alert("Discard changes?", isPresented: $showDiscardConfirmation) {
            Button("Keep editing", role: .cancel) {}
            Button("Discard", role: .destructive) { dismiss() }
        }
        .onAppear { nameFocused = existingCharacter == nil }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(KathaFont.Meta)
            .foregroundStyle(KathaTheme.textSecondary)
    }
}

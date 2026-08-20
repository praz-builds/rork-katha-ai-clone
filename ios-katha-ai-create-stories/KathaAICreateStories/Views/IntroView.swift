import SwiftUI
import UIKit

/// The animated, offline-first introduction shown before the existing purpose selection.
struct IntroView: View {
    @Environment(AppState.self) private var appState
    @State private var page: Int = 0
    @State private var createPhase: Int = 0
    @State private var typedPrompt: String = ""
    @State private var communityPhase: Int = 0
    @State private var selectedPageTaskID: UUID = UUID()

    private let prompt = "Write a mystery-fantasy thriller about a teen who finds a hidden door in her family's old house."
    private let pages: [(title: String, support: String)] = [
        ("Write it with Katha, make it yours", "Start from a single idea, let Katha draft it with you, and grow it from a short story to a novel, rewriting any line until it sounds like you."),
        ("Publish it and watch it come alive", "Share your story with Katha's readers, feel the reactions land, and see it continue in other hands."),
        ("Read from an endless library", "From late-night romance to bedtime tales, a new world waits every time you tap in.")
    ]

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                KathaTheme.introBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    if page < 2 {
                        introLogo
                            .padding(.top, KathaTheme.Spacing.s)
                    } else {
                        Spacer().frame(height: 58)
                    }

                    visualArea
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.horizontal, KathaTheme.Spacing.l)

                    bottomSheet
                        .padding(.bottom, max(proxy.safeAreaInsets.bottom, 24))
                }
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .statusBarHidden(true)
        .task(id: selectedPageTaskID) {
            await runPageAnimation()
        }
        .onAppear {
            selectedPageTaskID = UUID()
        }
    }

    private var introLogo: some View {
        HStack(spacing: KathaTheme.Spacing.s) {
            ZStack {
                Circle()
                    .fill(KathaTheme.accent.opacity(0.14))
                    .frame(width: 32, height: 32)
                Image(systemName: "book.pages.fill")
                    .font(KathaFont.Title2)
                    .foregroundStyle(KathaTheme.accent)
            }
            Text("KathaAI")
                .font(KathaFont.baloo(size: 28, weight: .heavy))
                .foregroundStyle(KathaTheme.introInk)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("KathaAI")
    }

    @ViewBuilder
    private var visualArea: some View {
        switch page {
        case 0:
            createVisual
        case 1:
            communityVisual
        default:
            libraryVisual
        }
    }

    private var createVisual: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
            HStack(spacing: KathaTheme.Spacing.s) {
                Circle()
                    .fill(KathaTheme.accent)
                    .frame(width: 8, height: 8)
                Text("NEW STORY")
                    .font(KathaFont.Meta)
                    .tracking(1.2)
                    .foregroundStyle(KathaTheme.introMuted)
            }

            VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
                Text(typedPrompt)
                    .font(KathaFont.Body)
                    .foregroundStyle(KathaTheme.introInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .overlay(alignment: .trailingLastTextBaseline) {
                        if createPhase == 1 {
                            Rectangle()
                                .fill(KathaTheme.accent)
                                .frame(width: 2, height: 18)
                                .opacity(Date().timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) > 0.5 ? 0 : 1)
                        }
                    }

                if createPhase >= 2 {
                    HStack(spacing: KathaTheme.Spacing.s) {
                        Image(systemName: "sparkles")
                            .foregroundStyle(KathaTheme.accent)
                        Text(createPhase == 2 ? "Katha is writing…" : "Katha is shaping your draft")
                            .font(KathaFont.BodyStrong)
                            .foregroundStyle(KathaTheme.introInk)
                            .shimmering(active: createPhase == 2)
                    }
                }

                if createPhase >= 3 {
                    VStack(alignment: .leading, spacing: KathaTheme.Spacing.s) {
                        storyLine("Tara pulled the old wallpaper back and found it:", visible: createPhase >= 3)
                        storyLine("a door her family swore had never been there,", visible: createPhase >= 4)
                        HStack(spacing: 0) {
                            Text("warm to the touch, humming with ")
                            Text(createPhase >= 5 ? "a warning." : "a dream.")
                                .foregroundStyle(createPhase >= 5 ? KathaTheme.accent : KathaTheme.introInk)
                                .fontWeight(.semibold)
                        }
                        .font(KathaFont.Body)
                        .foregroundStyle(KathaTheme.introInk)
                        .opacity(createPhase >= 5 ? 1 : 0.45)

                        if createPhase >= 5 {
                            Text("✎ You rewrote this line")
                                .font(KathaFont.Meta)
                                .foregroundStyle(KathaTheme.accent)
                                .padding(.horizontal, KathaTheme.Spacing.s)
                                .padding(.vertical, KathaTheme.Spacing.xs)
                                .background(KathaTheme.accentSoft, in: Capsule())
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .padding(KathaTheme.Spacing.l)
        .background(KathaTheme.introPanel, in: RoundedRectangle(cornerRadius: KathaTheme.Radius.xl))
        .overlay {
            RoundedRectangle(cornerRadius: KathaTheme.Radius.xl)
                .stroke(KathaTheme.introBorder, lineWidth: 1)
        }
        .shadow(color: KathaTheme.accent.opacity(0.08), radius: 24, y: 12)
        .animation(.easeInOut(duration: 0.35), value: createPhase)
    }

    private func storyLine(_ text: String, visible: Bool) -> some View {
        Text(text)
            .font(KathaFont.Body)
            .foregroundStyle(KathaTheme.introInk)
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : 8)
            .animation(.easeOut(duration: 0.4), value: visible)
    }

    private var communityVisual: some View {
        VStack(alignment: .leading, spacing: KathaTheme.Spacing.l) {
            HStack(alignment: .top, spacing: KathaTheme.Spacing.m) {
                IntroAsset(name: "intro_door_above_clouds")
                    .frame(width: 72, height: 94)
                    .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.m))
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.xs) {
                    Text("The Forgotten Door")
                        .font(KathaFont.Title2)
                        .foregroundStyle(KathaTheme.introInk)
                    Text(communityPhase >= 2 ? "by you · published" : "Draft · ready to share")
                        .font(KathaFont.Caption)
                        .foregroundStyle(KathaTheme.introMuted)
                    if communityPhase >= 2 {
                        HStack(spacing: KathaTheme.Spacing.m) {
                            Label(communityPhase >= 3 ? "142" : "128", systemImage: "heart.fill")
                            Label("24", systemImage: "bubble.left.fill")
                        }
                        .font(KathaFont.Meta)
                        .foregroundStyle(KathaTheme.accent)
                        .transition(.opacity)
                    }
                }
                Spacer()
            }

            if communityPhase < 2 {
                HStack {
                    Image(systemName: "arrow.up.right")
                    Text("Publish story")
                }
                .font(KathaFont.BodyStrong)
                .foregroundStyle(.white)
                .padding(.horizontal, KathaTheme.Spacing.l)
                .padding(.vertical, KathaTheme.Spacing.m)
                .background(KathaTheme.accent, in: Capsule())
                .scaleEffect(communityPhase == 1 ? 0.94 : 1)
                .animation(.spring(response: 0.35, dampingFraction: 0.65), value: communityPhase)
            } else {
                VStack(alignment: .leading, spacing: KathaTheme.Spacing.m) {
                    HStack(spacing: -10) {
                        IntroAvatar(name: "intro_reader_black")
                        IntroAvatar(name: "intro_reader_brown")
                        IntroAvatar(name: "intro_reader_white")
                        Text("new readers today")
                            .font(KathaFont.Caption)
                            .foregroundStyle(KathaTheme.introMuted)
                            .padding(.leading, KathaTheme.Spacing.s)
                    }
                    HStack(spacing: KathaTheme.Spacing.xs) {
                        reactionChip("the door")
                        reactionChip("so good")
                        reactionChip("more please")
                    }
                    if communityPhase >= 4 {
                        HStack(spacing: KathaTheme.Spacing.s) {
                            Image(systemName: "arrow.triangle.branch")
                                .foregroundStyle(KathaTheme.accent)
                            Text("A reader continued your story")
                                .font(KathaFont.BodyStrong)
                                .foregroundStyle(KathaTheme.introInk)
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .transition(.opacity)
            }
        }
        .padding(KathaTheme.Spacing.l)
        .background(KathaTheme.introPanel, in: RoundedRectangle(cornerRadius: KathaTheme.Radius.xl))
        .overlay {
            RoundedRectangle(cornerRadius: KathaTheme.Radius.xl)
                .stroke(KathaTheme.introBorder, lineWidth: 1)
        }
        .shadow(color: KathaTheme.accent.opacity(0.08), radius: 24, y: 12)
        .animation(.easeInOut(duration: 0.4), value: communityPhase)
    }

    private func reactionChip(_ text: String) -> some View {
        Text(text)
            .font(KathaFont.Meta)
            .foregroundStyle(KathaTheme.introInk)
            .padding(.horizontal, KathaTheme.Spacing.s)
            .padding(.vertical, KathaTheme.Spacing.xs)
            .background(KathaTheme.introBackground, in: Capsule())
            .overlay(Capsule().stroke(KathaTheme.introBorder, lineWidth: 1))
    }

    private var libraryVisual: some View {
        VStack(spacing: KathaTheme.Spacing.s) {
            TimelineView(.animation(minimumInterval: 0.04)) { context in
                VStack(spacing: KathaTheme.Spacing.s) {
                    coverRow(items: firstCoverRow, date: context.date, duration: 32, direction: -1)
                    coverRow(items: secondCoverRow, date: context.date, duration: 26, direction: 1)
                    coverRow(items: thirdCoverRow, date: context.date, duration: 36, direction: -1)
                }
            }
            .mask {
                LinearGradient(
                    colors: [.clear, .black.opacity(0.9), .black.opacity(0.9), .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, KathaTheme.Spacing.s)
    }

    private func coverRow(items: [IntroCover], date: Date, duration: Double, direction: CGFloat) -> some View {
        let step: CGFloat = 90
        let distance = CGFloat(items.count) * step
        let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: duration) / duration
        let offset = direction < 0 ? -CGFloat(phase) * distance : CGFloat(phase) * distance - distance

        return HStack(spacing: KathaTheme.Spacing.s) {
            ForEach(Array(items + items + items)) { item in
                ZStack(alignment: .bottomLeading) {
                    IntroAsset(name: item.assetName)
                        .frame(width: 82, height: 116)
                        .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.m))
                    LinearGradient(colors: [.clear, .black.opacity(0.78)], startPoint: .top, endPoint: .bottom)
                        .clipShape(RoundedRectangle(cornerRadius: KathaTheme.Radius.m))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.title)
                            .font(KathaFont.bricollage(size: 9, weight: .heavy))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                        Text(item.author.uppercased())
                            .font(KathaFont.Meta)
                            .minimumScaleFactor(0.65)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(6)
                }
                .frame(width: 82, height: 116)
            }
        }
        .offset(x: offset)
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
    }

    private var bottomSheet: some View {
        VStack(spacing: KathaTheme.Spacing.m) {
            HStack(spacing: KathaTheme.Spacing.s) {
                ForEach(0..<3, id: \.self) { index in
                    Button {
                        Haptics.light()
                        page = index
                        selectedPageTaskID = UUID()
                    } label: {
                        Capsule()
                            .fill(index == page ? KathaTheme.accent : KathaTheme.introInactiveDot)
                            .frame(width: index == page ? 22 : 7, height: 7)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Intro screen \(index + 1)")
                }
            }

            VStack(spacing: KathaTheme.Spacing.s) {
                Text(pages[page].title)
                    .font(KathaFont.bricollage(size: 28, weight: .bold))
                    .foregroundStyle(KathaTheme.introInk)
                    .multilineTextAlignment(.center)
                Text(pages[page].support)
                    .font(KathaFont.hanken(size: 15))
                    .foregroundStyle(KathaTheme.introMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if page == 2 {
                Button {
                    Haptics.success()
                    appState.completeIntro()
                } label: {
                    Text("Continue")
                        .font(KathaFont.hanken(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 52)
                        .background(KathaTheme.accent, in: RoundedRectangle(cornerRadius: KathaTheme.Radius.m))
                }
                .buttonStyle(PressScaleStyle())
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, KathaTheme.Spacing.l)
        .padding(.top, KathaTheme.Spacing.l)
        .padding(.bottom, KathaTheme.Spacing.s)
        .background(KathaTheme.introPanel, in: RoundedRectangle(cornerRadius: KathaTheme.Radius.xl, style: .continuous))
        .overlay(alignment: .top) {
            RoundedRectangle(cornerRadius: KathaTheme.Radius.xl, style: .continuous)
                .stroke(KathaTheme.introBorder, lineWidth: 1)
        }
        .padding(.horizontal, KathaTheme.Spacing.s)
        .animation(.easeInOut(duration: 0.35), value: page)
    }

    private func runPageAnimation() async {
        createPhase = 0
        typedPrompt = ""
        communityPhase = 0

        if page == 0 {
            await wait(420)
            guard !Task.isCancelled else { return }
            createPhase = 1
            for character in prompt {
                guard !Task.isCancelled else { return }
                typedPrompt.append(character)
                try? await Task.sleep(for: .milliseconds(14))
            }
            guard !Task.isCancelled else { return }
            createPhase = 2
            await wait(820)
            guard !Task.isCancelled else { return }
            createPhase = 3
            await wait(520)
            createPhase = 4
            await wait(780)
            createPhase = 5
            await wait(1_700)
            guard !Task.isCancelled else { return }
            page = 1
            selectedPageTaskID = UUID()
        } else if page == 1 {
            await wait(520)
            communityPhase = 1
            await wait(520)
            communityPhase = 2
            await wait(720)
            communityPhase = 3
            await wait(980)
            communityPhase = 4
            await wait(1_600)
            guard !Task.isCancelled else { return }
            page = 2
            selectedPageTaskID = UUID()
        }
    }

    private func wait(_ milliseconds: Int) async {
        try? await Task.sleep(for: .milliseconds(milliseconds))
    }

    private var firstCoverRow: [IntroCover] {
        [
            IntroCover("The Door Above the Clouds", "Maya Brooks", "intro_door_above_clouds"),
            IntroCover("Ravenwick School", "Ethan Parker", "intro_ravenwick_owl"),
            IntroCover("The Maharani's Last Cipher", "Anika Rao", "intro_maharanis_last_cipher"),
            IntroCover("The Dog Who Found Saturn", "Olivia Hart", "intro_saturn_beach_dog"),
            IntroCover("Midnight Chai Case Files", "Rumi Khan", "intro_midnight_chai")
        ]
    }

    private var secondCoverRow: [IntroCover] {
        [
            IntroCover("The Wolf on Campus", "Madison Blake", "intro_wolf_campus"),
            IntroCover("Garden of Little Dragons", "Claire Whitman", "intro_garden_little_dragons"),
            IntroCover("Camp Midnight", "Avery Collins", "intro_camp_midnight"),
            IntroCover("The Girl Beneath the Sea", "Sana Mir", "intro_girl_beneath_sea"),
            IntroCover("The Bird at Dusk", "Noah Bennett", "intro_mockingbird_sky")
        ]
    }

    private var thirdCoverRow: [IntroCover] {
        [
            IntroCover("Train to Moonlit Jaipur", "Tara Iyer", "intro_moonlit_train"),
            IntroCover("The Library Under Rain", "Liam Carter", "intro_library_under_rain"),
            IntroCover("The Museum Shadow", "Leela Varma", "intro_gallery_shadow"),
            IntroCover("The Red Boat", "Avery Collins", "intro_old_sea_boat"),
            IntroCover("Rooftop Summer", "Mira James", "intro_rooftop_student"),
            IntroCover("Neon Jinn of Sector Nine", "Kabir Bose", "intro_neon_jinn")
        ]
    }
}

private struct IntroCover: Identifiable {
    let id: String
    let title: String
    let author: String
    let assetName: String

    init(_ title: String, _ author: String, _ assetName: String) {
        self.id = assetName
        self.title = title
        self.author = author
        self.assetName = assetName
    }
}

private struct IntroAsset: View {
    let name: String

    var body: some View {
        if let image = UIImage(named: name) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else {
            ZStack {
                KathaTheme.introBackground
                Image(systemName: "book.closed")
                    .font(KathaFont.Title2)
                    .foregroundStyle(KathaTheme.introMuted)
            }
        }
    }
}

private struct IntroAvatar: View {
    let name: String

    var body: some View {
        IntroAsset(name: name)
            .frame(width: 38, height: 38)
            .clipShape(Circle())
            .overlay(Circle().stroke(KathaTheme.introPanel, lineWidth: 2))
    }
}

private struct ShimmerModifier: ViewModifier {
    let active: Bool
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                if active {
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.7), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .rotationEffect(.degrees(12))
                    .offset(x: phase * 180)
                    .mask(content)
                }
            }
            .onAppear {
                guard active else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

private extension View {
    func shimmering(active: Bool) -> some View {
        modifier(ShimmerModifier(active: active))
    }
}

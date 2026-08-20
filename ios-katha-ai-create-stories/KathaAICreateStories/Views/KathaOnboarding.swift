//  KathaOnboarding.swift
//  Katha — animated 3-screen onboarding intro (Create → Publish/Community → Read)
//
//  Drop-in SwiftUI. Reference frame 390×844. Implements ONBOARDING SPEC §1–§10 exactly.
//  Requires: bundled fonts (Bricolage Grotesque, Hanken Grotesk, Baloo 2) declared in
//  Info.plist under UIAppFonts, and the cover/avatar images added to Assets.xcassets.
//  See README.md.
//
//  Usage:  KathaOnboardingView { /* onboarding finished / user tapped Continue */ }

import SwiftUI
import UIKit
import Combine

// MARK: - Fonts (SPEC §3)

enum KFont {
    private static func weight(_ name: String) -> Font.Weight {
        switch name {
        case "ExtraLight": return .ultraLight
        case "Light": return .light
        case "Medium": return .medium
        case "SemiBold": return .semibold
        case "Bold": return .bold
        case "ExtraBold": return .heavy
        case "Black": return .black
        default: return .regular
        }
    }

    static func bricolage(_ size: CGFloat, _ weight: String = "SemiBold") -> Font {
        KathaFont.bricollage(size: size, weight: Self.weight(weight))
    }

    static func hanken(_ size: CGFloat, _ weight: String = "Regular") -> Font {
        KathaFont.hanken(size: size, weight: Self.weight(weight))
    }

    static func baloo(_ size: CGFloat) -> Font {
        KathaFont.baloo(size: size, weight: .heavy)
    }
}

// MARK: - Timeline math (SPEC §5)

@inline(__always) func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }
@inline(__always) func win(_ p: Double, _ a: Double, _ b: Double) -> Double { clamp01((p - a) / (b - a)) }
@inline(__always) func smooth(_ x: Double) -> Double { let c = clamp01(x); return c * c * (3 - 2 * c) }

// MARK: - Clock: drives normalized progress `p` per phase, auto-advances 0→1→2

final class OnboardingClock: NSObject, ObservableObject {
    @Published var phase = 0
    @Published var p: Double = 0        // 0…1 within the current phase
    @Published var showCta = false

    static let DUR: [Double] = [10.5, 9.6]   // seconds; phase 2 holds

    private var link: CADisplayLink?
    private var start = CFTimeInterval(0)

    func startEngine() {
        stop()
        enter(0)
        let l = CADisplayLink(target: self, selector: #selector(tick))
        l.add(to: .main, forMode: .common)
        link = l
    }
    func stop() { link?.invalidate(); link = nil }

    deinit { stop() }

    func enter(_ n: Int) {
        phase = n
        start = CACurrentMediaTime()
        p = 0
        showCta = (n == 2)
    }

    @objc private func tick() {
        guard phase < 2 else { p = 1; return }   // read screen: marquee is self-driving
        let dur = Self.DUR[phase]
        let e = CACurrentMediaTime() - start
        p = clamp01(e / dur)
        if e >= dur { enter(phase + 1) }
    }
}

// MARK: - Cover data (SPEC §8)

struct Cover: Identifiable { let id = UUID(); let title, author, image: String }

let COVERS: [Cover] = [
    .init(title: "The Door Above the Clouds",       author: "Maya Brooks",    image: "intro_door_above_clouds"),
    .init(title: "Ravenwick School for Wild Magic", author: "Ethan Parker",   image: "intro_ravenwick_owl"),
    .init(title: "The Maharani's Last Cipher",       author: "Anika Rao",      image: "intro_maharanis_last_cipher"),
    .init(title: "The Dog Who Found Saturn",         author: "Olivia Hart",    image: "intro_saturn_beach_dog"),
    .init(title: "Midnight Chai Case Files",         author: "Rumi Khan",      image: "intro_midnight_chai"),
    .init(title: "The Wolf on Campus",               author: "Madison Blake",  image: "intro_wolf_campus"),
    .init(title: "Garden of Little Dragons",         author: "Claire Whitman", image: "intro_garden_little_dragons"),
    .init(title: "Camp Midnight",                    author: "Avery Collins",  image: "intro_camp_midnight"),
    .init(title: "The Girl Beneath the Sea",         author: "Sana Mir",       image: "intro_girl_beneath_sea"),
    .init(title: "The Bird at Dusk",                 author: "Noah Bennett",   image: "intro_mockingbird_sky"),
    .init(title: "Train to Moonlit Jaipur",          author: "Tara Iyer",      image: "intro_moonlit_train"),
    .init(title: "The Library Under Rain",           author: "Liam Carter",    image: "intro_library_under_rain"),
    .init(title: "The Museum Shadow",                author: "Leela Varma",    image: "intro_gallery_shadow"),
    .init(title: "The Red Boat",                     author: "Avery Collins",  image: "intro_old_sea_boat"),
    .init(title: "Rooftop Summer",                   author: "Mira James",     image: "intro_rooftop_student"),
    .init(title: "Neon Jinn of Sector Nine",         author: "Kabir Bose",     image: "intro_neon_jinn"),
]

// MARK: - Copy (SPEC §4)

let HEADLINES: [(h: String, s: String)] = [
    ("Write it with Katha, make it yours",
     "Start from a single idea, let Katha draft it with you, and grow it from a short story to a novel, rewriting any line until it sounds like you."),
    ("Publish it and watch it come alive",
     "Share your story with Katha's readers, feel the reactions land, and see it continue in other hands."),
    ("Read from an endless library",
     "From late-night romance to bedtime tales, a new world waits every time you tap in."),
]

// MARK: - Root

struct KathaOnboardingView: View {
    var onFinish: () -> Void = {}
    @StateObject private var clock = OnboardingClock()

    private let W: CGFloat = 390
    private let HERO: CGFloat = 522

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            VStack(spacing: 0) {
                // Hero carousel
                ZStack(alignment: .top) {
                    KathaIntroTheme.heroBackground.ignoresSafeArea(edges: .top)

                    HStack(spacing: 0) {
                        CreateScreen(clock: clock).frame(width: w, height: HERO)
                        PublishScreen(clock: clock).frame(width: w, height: HERO)
                        ReadScreen().frame(width: w, height: HERO)
                    }
                    .frame(width: w * 3, alignment: .leading)
                    .offset(x: -CGFloat(clock.phase) * w)
                    .animation(.timingCurve(0.45, 0, 0.2, 1, duration: 0.6), value: clock.phase)

                    Wordmark()
                        .padding(.top, 60)
                        .opacity(clock.phase == 2 ? 0 : 1)
                        .animation(.easeInOut(duration: 0.4), value: clock.phase)
                }
                .frame(height: HERO)
                .clipped()

                BottomSheet(clock: clock, onFinish: onFinish)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(KathaIntroTheme.phoneBackground)
        }
        .onAppear { clock.startEngine() }
        .onDisappear { clock.stop() }
    }
}

// MARK: - Wordmark (SPEC §3)

struct Wordmark: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("K").foregroundColor(KathaIntroTheme.orange)
            Text("atha").foregroundColor(KathaIntroTheme.ink)
            Text("AI").foregroundColor(KathaIntroTheme.orange).font(KFont.baloo(11.5)).baselineOffset(0)
                .padding(.leading, 3.7)
        }
        .font(KFont.baloo(23))
        .tracking(-0.35)
    }
}

// MARK: - Bottom sheet (SPEC §4)

struct BottomSheet: View {
    @ObservedObject var clock: OnboardingClock
    var onFinish: () -> Void

    var body: some View {
        let i = clock.phase
        VStack(alignment: .leading, spacing: 0) {
            // dots
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { n in
                    Capsule()
                        .fill(n == i ? KathaIntroTheme.orange : KathaIntroTheme.dotIdle)
                        .frame(width: n == i ? 22 : 6, height: 6)
                        .onTapGesture { clock.enter(n) }
                }
            }
            .animation(.easeInOut(duration: 0.4), value: i)
            .padding(.bottom, 18)

            Text(HEADLINES[i].h)
                .font(KFont.bricolage(27, "Bold")).tracking(-0.27)
                .foregroundColor(KathaIntroTheme.ink).lineSpacing(27 * 0.16)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 64, alignment: .topLeading)

            Text(HEADLINES[i].s)
                .font(KFont.hanken(15)).foregroundColor(KathaIntroTheme.muted).lineSpacing(15 * 0.5)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44, alignment: .topLeading)
                .padding(.top, 12).padding(.bottom, 28)

            Group {
                if clock.showCta {
                    Button(action: onFinish) {
                        Text("Continue")
                            .font(KFont.hanken(17, "Bold")).foregroundColor(.white)
                            .frame(maxWidth: .infinity).frame(height: 56)
                            .background(KathaIntroTheme.orange).clipShape(RoundedRectangle(cornerRadius: 16))
                            .shadow(color: KathaIntroTheme.orange.opacity(0.5), radius: 15, x: 0, y: 8)
                    }
                    .transition(.opacity)
                }
            }
            .frame(minHeight: 56)
            .animation(.easeInOut(duration: 0.3), value: clock.showCta)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .padding(.init(top: 24, leading: 28, bottom: 40, trailing: 28))
        .background(KathaIntroTheme.sheet)
    }
}

// MARK: - Screen 0 : CREATE then EDIT (SPEC §5, §6)

struct CreateScreen: View {
    @ObservedObject var clock: OnboardingClock
    private var p: Double { clock.phase == 0 ? clock.p : (clock.phase > 0 ? 1 : 0) }

    private let prompt = "Write a mystery-fantasy thriller about a teen who finds a hidden door in her family's old house."
    private let line1 = "Tara pulled the old wallpaper back and found it:"
    private let line2 = "a door her family swore had never been there,"

    var body: some View {
        let typed   = smooth(win(p, 0.05, 0.22))
        let genShow = smooth(win(p, 0.24, 0.30))
        let genScale = (0.9 + 0.1 * genShow) * (1 - 0.12 * sin(.pi * win(p, 0.31, 0.37)))
        let writing = smooth(win(p, 0.37, 0.43)) * (1 - smooth(win(p, 0.56, 0.62)))
        let hi      = smooth(win(p, 0.66, 0.72)) * (1 - smooth(win(p, 0.82, 0.90)))
        let editWord = p >= 0.74 ? "a warning." : "a dream."
        let chip    = smooth(win(p, 0.78, 0.85))

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                Circle().fill(KathaIntroTheme.orange).frame(width: 7, height: 7)
                Text("NEW STORY").font(KFont.hanken(10, "ExtraBold")).tracking(1.6).foregroundColor(KathaIntroTheme.muted3)
            }
            // prompt with left→right reveal
            Text(prompt).font(KFont.hanken(15).italic()).foregroundColor(KathaIntroTheme.inkBody2).lineSpacing(15 * 0.45)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44, alignment: .topLeading)
                .mask(alignment: .leading) {
                    GeometryReader { g in Rectangle().frame(width: g.size.width * typed) }
                }
                .padding(.top, 14)

            Text("✦ Generate story")
                .font(KFont.hanken(12, "Bold")).foregroundColor(.white)
                .padding(.horizontal, 15).padding(.vertical, 9)
                .background(KathaIntroTheme.orange).clipShape(Capsule())
                .shadow(color: KathaIntroTheme.orange.opacity(0.6), radius: 10, x: 0, y: 8)
                .scaleEffect(genScale).opacity(genShow)
                .padding(.top, 16)

            Text("✦ Katha is writing…")
                .font(KFont.hanken(11, "SemiBold")).foregroundColor(KathaIntroTheme.orangeDeep)
                .opacity(writing).padding(.top, 16)

            VStack(alignment: .leading, spacing: 2) {
                storyLine(line1, k: 0)
                storyLine(line2, k: 1)
                (Text("warm to the touch, humming with ")
                    + Text(editWord)
                        .foregroundColor(hi > 0.4 ? KathaIntroTheme.orangeEdit : KathaIntroTheme.inkSoft))
                    .font(KFont.hanken(14.5)).foregroundColor(KathaIntroTheme.inkSoft).lineSpacing(14.5 * 0.62)
                    .padding(.horizontal, 2)
                    .background(KathaIntroTheme.orange.opacity(0.20 * hi).cornerRadius(4))
                    .opacity(smooth(win(p, 0.56, 0.66)))
            }
            .padding(.top, 14)
            .overlay(alignment: .top) { Rectangle().fill(KathaIntroTheme.hairline).frame(height: 1) }

            Text("✎ You rewrote this line")
                .font(KFont.hanken(11, "Bold")).foregroundColor(KathaIntroTheme.orangeDeep)
                .padding(.horizontal, 11).padding(.vertical, 6)
                .background(KathaIntroTheme.chipPeach).clipShape(Capsule())
                .opacity(chip).offset(y: (1 - chip) * 6)
                .padding(.top, 14)
        }
        .padding(.init(top: 20, leading: 20, bottom: 22, trailing: 20))
        .frame(width: 306, alignment: .leading)
        .background(KathaIntroTheme.card).clipShape(RoundedRectangle(cornerRadius: 22))
        .shadow(color: KathaIntroTheme.shadowWarm.opacity(0.40), radius: 30, x: 0, y: 15)
        .opacity(smooth(win(p, 0, 0.04)))
        .frame(maxWidth: .infinity, maxHeight: .infinity)  // center in page
    }

    private func storyLine(_ t: String, k: Int) -> some View {
        let a = 0.44 + Double(k) * 0.06
        let r = smooth(win(p, a, a + 0.10))
        return Text(t).font(KFont.hanken(14.5)).foregroundColor(KathaIntroTheme.inkSoft).lineSpacing(14.5 * 0.62)
            .fixedSize(horizontal: false, vertical: true)
            .opacity(r).offset(y: (1 - r) * 6)
    }
}

// MARK: - Screen 1 : PUBLISH then COMMUNITY (SPEC §5, §7)

struct PublishScreen: View {
    @ObservedObject var clock: OnboardingClock
    private var p: Double { clock.phase == 1 ? clock.p : (clock.phase > 1 ? 1 : 0) }

    var body: some View {
        let pubOut  = smooth(win(p, 0.22, 0.30))
        let pubScale = (1 - 0.12 * sin(.pi * win(p, 0.16, 0.22))) * (1 - 0.06 * pubOut)
        let stats   = smooth(win(p, 0.26, 0.34))
        let readers = smooth(win(p, 0.30, 0.40))
        let hearts  = 128 + Int((smooth(win(p, 0.30, 0.88)) * 118).rounded())
        let note    = smooth(win(p, 0.72, 0.82))

        ZStack {
            // reaction chips (absolute — SPEC §7)
            reactionChip("the door gave me chills", peach: false, tail: .bottomLeading)
                .position(x: 60 + 70, y: 120 + 15).opacity(chipR(0.40)).offset(y: (1 - chipR(0.40)) * 8)
            reactionChip("♥ liked", peach: true, tail: .bottomTrailing)
                .position(x: 390 - 44 - 30, y: 150 + 14).opacity(chipR(0.52)).offset(y: (1 - chipR(0.52)) * 8)
            reactionChip("read it twice ✦", peach: false, tail: .bottomLeading)
                .position(x: 48 + 60, y: 196 + 15).opacity(chipR(0.62)).offset(y: (1 - chipR(0.62)) * 8)

            // main card
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 14) {
                    BookSpine()
                    VStack(alignment: .leading, spacing: 0) {
                        Text("The Forgotten Door").font(KFont.bricolage(16, "Bold")).foregroundColor(KathaIntroTheme.ink)
                        Text(p >= 0.26 ? "by you · published" : "Draft · ready to share")
                            .font(KFont.hanken(11)).foregroundColor(KathaIntroTheme.muted2).padding(.top, 2)
                        ZStack(alignment: .topLeading) {
                            Text("Publish story")
                                .font(KFont.hanken(12, "Bold")).foregroundColor(.white)
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .background(KathaIntroTheme.orange).clipShape(Capsule())
                                .shadow(color: KathaIntroTheme.orange.opacity(0.6), radius: 10, x: 0, y: 8)
                                .scaleEffect(pubScale).opacity(1 - pubOut)
                            HStack(spacing: 16) {
                                Text("♥ \(hearts)").foregroundColor(KathaIntroTheme.orangeDeep)
                                Text("💬 24").foregroundColor(KathaIntroTheme.muted)
                            }
                            .font(KFont.hanken(12, "SemiBold")).opacity(stats).padding(.top, 6)
                        }
                        .frame(height: 32, alignment: .topLeading).padding(.top, 12)
                    }
                }
                Rectangle().fill(KathaIntroTheme.hairline).frame(height: 1).padding(.top, 16)
                HStack(spacing: 10) {
                    HStack(spacing: -8) {
                        avatar("intro_reader_black", 0.34)
                        avatar("intro_reader_brown",   0.44)
                        avatar("intro_reader_white", 0.54)
                    }
                    Text("new readers today").font(KFont.hanken(11.5, "SemiBold"))
                        .foregroundColor(KathaIntroTheme.muted2).opacity(readers)
                }
                .padding(.top, 14)
            }
            .padding(18).frame(width: 290, alignment: .leading)
            .background(KathaIntroTheme.card).clipShape(RoundedRectangle(cornerRadius: 20))
            .shadow(color: KathaIntroTheme.shadowWarm.opacity(0.45), radius: 30, x: 0, y: 15)

            // continuation notification (bottom 40)
            NotificationCard()
                .frame(width: 270)
                .opacity(note).offset(y: (1 - note) * 22)
                .position(x: 195, y: 522 - 40 - 29)
        }
        .frame(width: 390, height: 522)
    }

    private func chipR(_ a: Double) -> Double { smooth(win(p, a, a + 0.09)) }

    private func avatar(_ name: String, _ a: Double) -> some View {
        let r = smooth(win(p, a, a + 0.10))
        return Image(name).resizable().scaledToFill()
            .frame(width: 26, height: 26).clipShape(Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .scaleEffect(0.5 + 0.5 * r).opacity(r)
    }

    private func reactionChip(_ t: String, peach: Bool, tail: Alignment) -> some View {
        Text(t)
            .font(KFont.hanken(peach ? 12 : 11, peach ? "Bold" : "SemiBold"))
            .foregroundColor(peach ? .white : KathaIntroTheme.inkSoft)
            .padding(.horizontal, peach ? 11 : 12).padding(.vertical, 7)
            .background(peach ? KathaIntroTheme.orange : KathaIntroTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: (peach ? KathaIntroTheme.orange : KathaIntroTheme.shadowWarm).opacity(peach ? 0.5 : 0.35),
                    radius: 12, x: 0, y: 6)
    }
}

struct BookSpine: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 6)
                .fill(LinearGradient(colors: [KathaIntroTheme.bookTealStart, KathaIntroTheme.bookTealEnd],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
            Rectangle().fill(Color.black.opacity(0.28)).frame(width: 4)
                .frame(maxHeight: .infinity, alignment: .leading)
            Text("The Forgotten Door")
                .font(KFont.bricolage(8.5, "Bold")).foregroundColor(KathaIntroTheme.bookTitle)
                .padding(7)
        }
        .frame(width: 58, height: 78)
    }
}

struct NotificationCard: View {
    var body: some View {
        HStack(spacing: 11) {
            Text("✦").font(.system(size: 16)).foregroundColor(.white)
                .frame(width: 34, height: 34)
                .background(LinearGradient(colors: [KathaIntroTheme.orange, KathaIntroTheme.orangePress], startPoint: .topLeading, endPoint: .bottomTrailing))
                .clipShape(RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 1) {
                Text("Mira continued your story").font(KFont.hanken(12.5, "Bold")).foregroundColor(KathaIntroTheme.sheet)
                Text("\"She followed the light down…\"").font(KFont.hanken(11).italic()).foregroundColor(KathaIntroTheme.notificationSub)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(KathaIntroTheme.ink).clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: KathaIntroTheme.ink.opacity(0.6), radius: 22, x: 0, y: 12)
    }
}

// MARK: - Screen 2 : READ marquee (SPEC §8)

struct ReadScreen: View {
    private struct RowDef { let reverse: Bool; let dur: Double; let start: Int }
    private let rows = [RowDef(reverse: false, dur: 32, start: 0),
                        RowDef(reverse: true,  dur: 26, start: 6),
                        RowDef(reverse: false, dur: 36, start: 11)]

    var body: some View {
        VStack(spacing: 16) {
            ForEach(0..<rows.count, id: \.self) { i in
                MarqueeRow(covers: rowCovers(rows[i].start), reverse: rows[i].reverse, duration: rows[i].dur)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func rowCovers(_ start: Int) -> [Cover] {
        (0..<10).map { COVERS[(start + $0) % COVERS.count] }
    }
}

struct MarqueeRow: View {
    let covers: [Cover]; let reverse: Bool; let duration: Double
    @State private var t: Double = 0

    var body: some View {
        // duplicated strip; translate by -half its width for a seamless loop
        TimelineView(.animation) { ctx in
            let elapsed = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: duration) / duration
            let strip = covers + covers
            let unit = strip.count / 2
            GeometryReader { _ in
                HStack(spacing: 14) {
                    ForEach(Array(strip.enumerated()), id: \.offset) { _, c in CoverCard(c) }
                }
                .modifier(MarqueeOffset(progress: reverse ? 1 - elapsed : elapsed, itemCount: unit))
            }
        }
        .frame(height: 140)
        .mask(LinearGradient(stops: [
            .init(color: .clear, location: 0), .init(color: .black, location: 0.12),
            .init(color: .black, location: 0.88), .init(color: .clear, location: 1)],
            startPoint: .leading, endPoint: .trailing))
    }
}

/// Offsets the strip by `progress` of one unit-width (10 covers @ 100 + 14 gap).
private struct MarqueeOffset: ViewModifier {
    let progress: Double; let itemCount: Int
    func body(content: Content) -> some View {
        let unitWidth = CGFloat(itemCount) * (100 + 14)
        return content.offset(x: -CGFloat(progress) * unitWidth)
    }
}

struct CoverCard: View {
    let c: Cover
    init(_ c: Cover) { self.c = c }
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            KathaIntroTheme.coverInk
            Image(c.image).resizable().scaledToFill().frame(width: 100, height: 140).clipped()
            LinearGradient(stops: [
                .init(color: KathaIntroTheme.coverScrim.opacity(0),   location: 0),
                .init(color: KathaIntroTheme.coverScrim.opacity(0.12), location: 0.46),
                .init(color: KathaIntroTheme.coverScrim.opacity(0.82), location: 1)],
                startPoint: .top, endPoint: .bottom)
            HStack { Rectangle().fill(LinearGradient(colors: [Color.black.opacity(0.16), .clear],
                startPoint: .leading, endPoint: .trailing)).frame(width: 5); Spacer() }
            VStack(alignment: .leading, spacing: 3) {
                Text(c.title).font(KFont.bricolage(9.5, "ExtraBold")).foregroundColor(.white).lineSpacing(0)
                Text(c.author.uppercased()).font(KFont.hanken(6.2, "ExtraBold")).tracking(0.37)
                    .foregroundColor(.white.opacity(0.82))
            }
            .padding(.init(top: 28, leading: 9, bottom: 9, trailing: 9))
        }
        .frame(width: 100, height: 140)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: KathaIntroTheme.shadowWarm.opacity(0.5), radius: 13, x: 0, y: 7)
    }
}

#Preview { KathaOnboardingView() }

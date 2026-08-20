//
//  Theme.swift
//  KathaAICreateStories
//

import SwiftUI
import CoreText

// MARK: - Color Extensions

extension Color {
    /// Initialize a design-system color from its central token definition.
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }

    /// Adaptive light/dark design-system color.
    init(light: UInt, dark: UInt) {
        let lightColor = UIColor(
            red: CGFloat((light >> 16) & 0xFF) / 255.0,
            green: CGFloat((light >> 8) & 0xFF) / 255.0,
            blue: CGFloat(light & 0xFF) / 255.0,
            alpha: 1
        )
        let darkColor = UIColor(
            red: CGFloat((dark >> 16) & 0xFF) / 255.0,
            green: CGFloat((dark >> 8) & 0xFF) / 255.0,
            blue: CGFloat(dark & 0xFF) / 255.0,
            alpha: 1
        )
        self.init(UIColor { traits in
            traits.userInterfaceStyle == .dark ? darkColor : lightColor
        })
    }
}

// MARK: - Design Tokens

enum KathaTheme {
    // Colors — exact product specification values.
    static let bg = Color(light: 0xFAF7F2, dark: 0x0B0908)
    static let canvas = bg
    static let surface = Color(light: 0xFFFFFF, dark: 0x17130F)
    static let surfaceElevated = Color(light: 0xFFFFFF, dark: 0x211B15)
    static let border = Color(light: 0xEFE9E0, dark: 0x2A2320)
    static let borderStrong = Color(light: 0xDED5C7, dark: 0x3A312B)

    static let textPrimary = Color(light: 0x0F0E0C, dark: 0xF5F1EA)
    static let textSecondary = Color(light: 0x6B6560, dark: 0xA69E93)
    static let textTertiary = Color(light: 0x9C9691, dark: 0x6C655D)

    static let accent = Color(light: 0xFF6B1A, dark: 0xFF8A3D)
    static let accentPressed = Color(light: 0xE85610, dark: 0xFFB17A)
    static let accentSoft = Color(light: 0xFFE5D5, dark: 0x3D2118)

    // Intro-only parchment tokens.
    static let introBackground = Color(light: 0xF6ECDC, dark: 0x211A15)
    static let introPanel = Color(light: 0xFFFDF9, dark: 0x2A211B)
    static let introInk = Color(light: 0x2A2320, dark: 0xFFF6EC)
    static let introMuted = Color(light: 0x6B5F52, dark: 0xC6B7A4)
    static let introBorder = Color(light: 0xECDFCA, dark: 0x4A392D)
    static let introInactiveDot = Color(light: 0xDED5C8, dark: 0x675346)

    static let premium = Color(light: 0xC44536, dark: 0xD95A4B)
    static let premiumSoft = Color(light: 0xF5D9D3, dark: 0x3D211D)

    static let success = Color(light: 0x3D8F5A, dark: 0x4FA870)
    static let error = Color(light: 0xC0392B, dark: 0xE05D4E)
    static let info = Color(light: 0x4A78C2, dark: 0x6B95D8)
    static let heart = Color(light: 0xE85D5D, dark: 0xF26B6B)

    // Kept as a compatibility token for existing error surfaces.
    static let errorSoft = premiumSoft

    // Reader-only sepia tokens.
    static let sepiaBackground = Color(hex: 0xF4E8D0)
    static let sepiaText = Color(hex: 0x4A3B2A)
    static let sepiaTextSecondary = Color(hex: 0x7A6849)
    static let sepiaAccent = Color(hex: 0xB58A3E)
    static let sepiaCanvas = sepiaBackground
    static let sepiaSurface = sepiaBackground
    static let sepiaBorder = sepiaAccent.opacity(0.3)

    // Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48, 64.
    enum Spacing {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let smMd: CGFloat = 12
        static let m: CGFloat = smMd
        static let md: CGFloat = 16
        static let l: CGFloat = md
        static let mdLg: CGFloat = 20
        static let xl: CGFloat = mdLg
        static let lg: CGFloat = 24
        static let xxl: CGFloat = lg
        static let xxl48: CGFloat = 48
        static let xxxl: CGFloat = 32
        static let xxxl64: CGFloat = 64
        static let huge: CGFloat = xxxl64
    }

    // Radius scale: 4, 8, 12, 14, 16, 20, 24.
    enum Radius {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let mdLg: CGFloat = 14
        static let l: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let full: CGFloat = 9999
    }

    struct ShadowToken {
        let color: Color
        let radius: CGFloat
        let x: CGFloat
        let y: CGFloat
    }

    static let shadowSoft = ShadowToken(color: Color(hex: 0x0F0E0C, alpha: 0.04), radius: 8, x: 0, y: 2)
    static let shadowMedium = ShadowToken(color: Color(hex: 0x0F0E0C, alpha: 0.06), radius: 16, x: 0, y: 4)
    static let shadowStrong = ShadowToken(color: Color(hex: 0x0F0E0C, alpha: 0.08), radius: 24, x: 0, y: 8)

    /// Genre artwork colors live in the theme so view/model code has no color literals.
    static func coverColors(for genre: Genre) -> [Color] {
        switch genre {
        case .contemporary: [Color(hex: 0x4A9A9A), Color(hex: 0x2D6B6B), Color(hex: 0x1A4A4A)]
        case .mystery: [Color(hex: 0x2C3E50), Color(hex: 0x1A2A36), Color(hex: 0x0D1620)]
        case .romance: [Color(hex: 0xC45B7B), Color(hex: 0x8B2D4B), Color(hex: 0x5A1D33)]
        case .scifi: [Color(hex: 0x4A3A8E), Color(hex: 0x2D1A5A), Color(hex: 0x1A0D3A)]
        case .fantasy: [Color(hex: 0x5B8A5B), Color(hex: 0x3A6B3A), Color(hex: 0x1A4A2A)]
        case .horror: [Color(hex: 0x5A1D1D), Color(hex: 0x3A0D0D), Color(hex: 0x1A0505)]
        case .poetry: [Color(hex: 0x8E7A9E), Color(hex: 0x6B5B8E), Color(hex: 0x4A3A6B)]
        case .drama: [Color(hex: 0x6B4A6B), Color(hex: 0x4A2D4A), Color(hex: 0x2A1A2A)]
        case .adventure: [Color(hex: 0xE87B4A), Color(hex: 0xC04A2D), Color(hex: 0x8B2A1A)]
        case .mythology: [Color(hex: 0xB85A2D), Color(hex: 0x8B3A1A), Color(hex: 0x5A1D0D)]
        case .thriller: [Color(hex: 0x3A3A3A), Color(hex: 0x1A1A1A), Color(hex: 0x0D0D0D)]
        case .sliceOfLife: [Color(hex: 0xD4A574), Color(hex: 0xA67B52), Color(hex: 0x6B4F35)]
        case .historical: [Color(hex: 0x8B7355), Color(hex: 0x6B5235), Color(hex: 0x3A2D1A)]
        case .contemporary: [Color(hex: 0x4A9A9A), Color(hex: 0x2D6B6B), Color(hex: 0x1A4A4A)]
        case .lgbtq: [Color(hex: 0xE84A7B), Color(hex: 0xC42D5B), Color(hex: 0x8B1D3D)]
        case .comedy: [Color(hex: 0xF0C04A), Color(hex: 0xD4A02D), Color(hex: 0x8B7020)]
        case .drama: [Color(hex: 0x6B4A6B), Color(hex: 0x4A2D4A), Color(hex: 0x2A1A2A)]
        case .mythology: [Color(hex: 0xB85A2D), Color(hex: 0x8B3A1A), Color(hex: 0x5A1D0D)]
        case .spirituality: [Color(hex: 0x6B8E6B), Color(hex: 0x4A6B4A), Color(hex: 0x2A4A2A)]
        case .motivational: [Color(hex: 0xE8B83D), Color(hex: 0xC8982A), Color(hex: 0x8B6B1A)]
        case .kids: [Color(hex: 0xFFB347), Color(hex: 0xFF8C42), Color(hex: 0xCC6A2D)]
        case .erotica: [Color(hex: 0x8B3A58), Color(hex: 0x5A1D38), Color(hex: 0x2A0D1D)]
        }
    }
}

// MARK: - Intro onboarding tokens

enum KathaIntroTheme {
    static let orange = Color(hex: 0xFF6B1A)
    static let orangePress = Color(hex: 0xE5560A)
    static let orangeDeep = Color(hex: 0xB15A18)
    static let orangeEdit = Color(hex: 0x8A3E12)
    static let ink = Color(hex: 0x1E1A16)
    static let inkSoft = Color(hex: 0x2A231C)
    static let inkBody2 = Color(hex: 0x3A2E20)
    static let muted = Color(hex: 0x6B625A)
    static let muted2 = Color(hex: 0x8A7F73)
    static let muted3 = Color(hex: 0xB49A82)
    static let sheet = Color(hex: 0xFAF7F2)
    static let card = Color.white
    static let dotIdle = Color(hex: 0xDED5C8)
    static let hairline = Color(hex: 0xF0E7D6)
    static let chipPeach = Color(hex: 0xFFF1E5)
    static let coverInk = Color(hex: 0x16110E)
    static let phoneBackground = Color(hex: 0xFBF6EC)
    static let shadowWarm = Color(hex: 0x7A2E0E)
    static let bookTealStart = Color(hex: 0x2E5D57)
    static let bookTealEnd = Color(hex: 0x1C3A36)
    static let bookTitle = Color(hex: 0xF1F5F2)
    static let notificationSub = Color(hex: 0xB7ADA1)
    static let coverScrim = Color(hex: 0x181410)
    static let heroBackground = RadialGradient(
        gradient: Gradient(colors: [Color(hex: 0xFEFBF3), Color(hex: 0xF3EAD8)]),
        center: UnitPoint(x: 0.5, y: 0.3),
        startRadius: 0,
        endRadius: 470
    )
}

// MARK: - Typography

enum KathaFont {
    static var bricolageAvailable = false
    static var hankenAvailable = false
    static var balooAvailable = false

    static func checkAvailability() {
        bricolageAvailable = UIFont(name: "Bricolage Grotesque", size: 16) != nil
        hankenAvailable = UIFont(name: "Hanken Grotesk", size: 16) != nil
        balooAvailable = UIFont(name: "Baloo 2", size: 16) != nil
    }

    // Shared display and interface roles.
    static let Display = bricollage(size: 32, weight: .semibold)
    static let Title1 = bricollage(size: 24, weight: .semibold)
    static let Title2 = bricollage(size: 18, weight: .semibold)
    static let Body = hanken(size: 15)
    static let BodyStrong = hanken(size: 15, weight: .semibold)
    static let Caption = hanken(size: 13)
    static let Meta = hanken(size: 12, weight: .semibold)

    // Reader roles intentionally use the same sans-serif system for a unified product voice.
    static let ReaderStoryTitle = bricollage(size: 34, weight: .bold)
    static let ReaderChapterTitle = bricollage(size: 28, weight: .semibold)
    static let ReaderChapterNumber = hanken(size: 14).italic()
    static var ReaderBody: Font { hanken(size: 18) }
    static var ReaderBodyItalic: Font { hanken(size: 18).italic() }
    static var ReaderBodyBold: Font { hanken(size: 18, weight: .semibold) }
    static let Recap = hanken(size: 15).italic()
    static let Wordmark = baloo(size: 40, weight: .heavy)
    static let PremiumWordmark = baloo(size: 32, weight: .heavy)
    static let AvatarInitial = hanken(size: 18, weight: .bold)

    static func readerBody(size: CGFloat) -> Font {
        hanken(size: size)
    }

    static func bricollage(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        bricolageAvailable ? Font.custom("Bricolage Grotesque", size: size).weight(weight) : Font.system(size: size, weight: weight)
    }

    static func bricolage(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        bricollage(size: size, weight: weight)
    }

    static func hanken(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        hankenAvailable ? Font.custom("Hanken Grotesk", size: size).weight(weight) : Font.system(size: size, weight: weight)
    }

    static func baloo(size: CGFloat, weight: Font.Weight = .heavy) -> Font {
        balooAvailable ? Font.custom("Baloo 2", size: size).weight(weight) : Font.system(size: size, weight: weight)
    }

    // Compatibility aliases for legacy reader call sites; they now resolve to Hanken Grotesk.
    static func literata(size: CGFloat, weight: Font.Weight = .regular) -> Font { hanken(size: size, weight: weight) }
    static func literataItalic(size: CGFloat) -> Font { hanken(size: size).italic() }
    static func avatarInitial(size: CGFloat) -> Font { hanken(size: size, weight: .bold) }
}

// MARK: - Font Registration

enum FontLoader {
    static func register() {
        for name in ["BricolageGrotesque", "HankenGrotesk", "Baloo2", "Literata", "Literata-Italic"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        KathaFont.checkAvailability()
    }
}

// MARK: - Avatar Gradient Palettes

struct AvatarPalette: Identifiable, Hashable {
    let id: Int
    let colors: [Color]

    static let palettes: [AvatarPalette] = [
        AvatarPalette(id: 0, colors: [Color(hex: 0xFF6B1A), Color(hex: 0xE85610)]),
        AvatarPalette(id: 1, colors: [Color(hex: 0xC45B5B), Color(hex: 0x8B2D2D)]),
        AvatarPalette(id: 2, colors: [Color(hex: 0x4A8A99), Color(hex: 0x2D5A6B)]),
        AvatarPalette(id: 3, colors: [Color(hex: 0x5B8A5B), Color(hex: 0x3A6B3A)]),
        AvatarPalette(id: 4, colors: [Color(hex: 0x6B5B8E), Color(hex: 0x4A3A6B)]),
        AvatarPalette(id: 5, colors: [Color(hex: 0xE87B4A), Color(hex: 0xC04A2D)])
    ]

    /// Deterministic palette selection based on username hash.
    static func paletteFor(username: String) -> AvatarPalette {
        var hash = 5381
        for scalar in username.lowercased().unicodeScalars {
            hash = ((hash &<< 5) &+ hash) &+ Int(scalar.value)
        }
        return palettes[abs(hash) % palettes.count]
    }
}

// MARK: - Shadow Application

private struct KathaShadowModifier: ViewModifier {
    let token: KathaTheme.ShadowToken
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .shadow(
                color: colorScheme == .dark ? .clear : token.color,
                radius: colorScheme == .dark ? 0 : token.radius,
                x: colorScheme == .dark ? 0 : token.x,
                y: colorScheme == .dark ? 0 : token.y
            )
            .overlay {
                if colorScheme == .dark {
                    RoundedRectangle(cornerRadius: KathaTheme.Radius.l)
                        .stroke(KathaTheme.border, lineWidth: 1)
                }
            }
    }
}

extension View {
    func kathaCardShadow() -> some View {
        modifier(KathaShadowModifier(token: KathaTheme.shadowSoft))
    }

    func kathaElevatedShadow() -> some View {
        modifier(KathaShadowModifier(token: KathaTheme.shadowMedium))
    }

    func kathaTabShadow() -> some View {
        modifier(KathaShadowModifier(token: KathaTheme.shadowStrong))
    }
}

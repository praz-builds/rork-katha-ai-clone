//
//  Theme.swift
//  KathaAICreateStories
//

import SwiftUI
import CoreText

// MARK: - Color Extensions

extension Color {
    /// Initialize from a hex value (e.g., 0xE89F3D)
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }

    /// Adaptive color that responds to light/dark mode
    init(light: UInt, dark: UInt) {
        let l = UIColor(
            red: CGFloat((light >> 16) & 0xFF) / 255.0,
            green: CGFloat((light >> 8) & 0xFF) / 255.0,
            blue: CGFloat(light & 0xFF) / 255.0,
            alpha: 1
        )
        let d = UIColor(
            red: CGFloat((dark >> 16) & 0xFF) / 255.0,
            green: CGFloat((dark >> 8) & 0xFF) / 255.0,
            blue: CGFloat(dark & 0xFF) / 255.0,
            alpha: 1
        )
        self.init(UIColor { traits in
            traits.userInterfaceStyle == .dark ? d : l
        })
    }
}

// MARK: - Design Tokens

enum KathaTheme {
    // Backgrounds
    static let canvas = Color(light: 0xFAF6F0, dark: 0x14110E)
    static let surface = Color(light: 0xFFFFFF, dark: 0x241E18)
    static let surfaceElevated = Color(light: 0xFFFDF8, dark: 0x2E271F)

    // Text
    static let textPrimary = Color(light: 0x1A1612, dark: 0xF5F0E8)
    static let textSecondary = Color(light: 0x6B5D52, dark: 0x9E9085)
    static let textTertiary = Color(light: 0x948578, dark: 0x7A6E63)

    // Borders
    static let border = Color(light: 0xE8E0D5, dark: 0x383027)
    static let borderStrong = Color(light: 0xD4C8B8, dark: 0x4A4035)

    // Accent (amber — used only on primary CTAs, active tabs, liked counts, own follower counts, "Write yours")
    static let accent = Color(light: 0xE89F3D, dark: 0xF1AC49)
    static let accentPressed = Color(light: 0xC8842A, dark: 0xCF8E33)
    static let accentSoft = Color(light: 0xF5E6D0, dark: 0x3A2E20)

    // Premium (red — used ONLY for subscription/upgrade CTAs, Premium badges)
    static let premium = Color(light: 0xC44536, dark: 0xD8554A)
    static let premiumSoft = Color(light: 0xF5DDD9, dark: 0x3A1E18)

    // Semantic
    static let error = Color(light: 0xC0392B, dark: 0xE55A4A)
    static let errorSoft = Color(light: 0xF5D9D3, dark: 0x3A1E18)
    static let success = Color(light: 0x278657, dark: 0x3CA76E)

    // Sepia (reader body only)
    static let sepiaCanvas = Color(hex: 0xF4ECD8)
    static let sepiaText = Color(hex: 0x3A2D1A)
    static let sepiaTextSecondary = Color(hex: 0x614D38)
    static let sepiaSurface = Color(hex: 0xF8F1E0)
    static let sepiaBorder = Color(hex: 0xD4C8A8)

    // Spacing
    enum Spacing {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let xxxl: CGFloat = 32
        static let huge: CGFloat = 40
    }

    // Radius
    enum Radius {
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let full: CGFloat = 9999
    }
}

// MARK: - Typography

enum KathaFont {
    static var literataAvailable = false

    static func checkAvailability() {
        literataAvailable = UIFont(name: "Literata", size: 16) != nil
    }

    /// Literata serif — reader body, wordmark, avatar initials only
    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if literataAvailable {
            return Font.custom("Literata", size: size).weight(weight)
        }
        return .system(size: size, weight: weight, design: .serif)
    }

    static func serifBold(_ size: CGFloat) -> Font {
        serif(size, weight: .bold)
    }

    static func serifItalic(_ size: CGFloat) -> Font {
        if literataAvailable {
            return Font.custom("Literata-Italic", size: size)
        }
        return .system(size: size, design: .serif).italic()
    }
}

// MARK: - Font Registration

enum FontLoader {
    static func register() {
        for name in ["Literata", "Literata-Italic"] {
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
        AvatarPalette(id: 0, colors: [Color(hex: 0xE89F3D), Color(hex: 0xD4742A)]),
        AvatarPalette(id: 1, colors: [Color(hex: 0xC45B5B), Color(hex: 0x8B2D2D)]),
        AvatarPalette(id: 2, colors: [Color(hex: 0x4A8A99), Color(hex: 0x2D5A6B)]),
        AvatarPalette(id: 3, colors: [Color(hex: 0x5B8A5B), Color(hex: 0x3A6B3A)]),
        AvatarPalette(id: 4, colors: [Color(hex: 0x6B5B8E), Color(hex: 0x4A3A6B)]),
        AvatarPalette(id: 5, colors: [Color(hex: 0xE87B4A), Color(hex: 0xC04A2D)])
    ]

    /// Deterministic palette selection based on username hash (djb2)
    static func paletteFor(username: String) -> AvatarPalette {
        var hash = 5381
        for scalar in username.lowercased().unicodeScalars {
            hash = ((hash &<< 5) &+ hash) &+ Int(scalar.value)
        }
        return palettes[abs(hash) % palettes.count]
    }
}

// MARK: - View Extensions

extension View {
    func kathaCardShadow() -> some View {
        shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 2)
    }

    func kathaElevatedShadow() -> some View {
        shadow(color: Color.black.opacity(0.1), radius: 16, x: 0, y: 4)
    }

    func kathaTabShadow() -> some View {
        shadow(color: Color.black.opacity(0.08), radius: 20, x: 0, y: -2)
    }
}

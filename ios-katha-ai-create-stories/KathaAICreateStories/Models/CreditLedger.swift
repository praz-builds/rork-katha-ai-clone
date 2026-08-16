//
//  CreditLedger.swift
//  KathaAICreateStories
//

import Foundation

// MARK: - Credit Ledger Entry

struct CreditLedgerEntry: Identifiable, Codable, Hashable {
    let id: String
    let amount: Int
    let reason: CreditReason
    var referenceId: String?
    let timestamp: Date
    let balanceAfter: Int
}

// MARK: - Credit Reason

enum CreditReason: String, Codable, CaseIterable {
    case purchase
    case subscription
    case adReward
    case streak
    case feedback
    case referral
    case referralBonus
    case social
    case generation
    case welcomeBonus
    case readerEarning

    var label: String {
        switch self {
        case .purchase: "Purchased"
        case .subscription: "Katha Premium credits"
        case .adReward: "Watched an ad"
        case .streak: "3-day streak reward"
        case .feedback: "Comment reward"
        case .referral: "Friend joined via your invite"
        case .referralBonus: "Referral welcome bonus"
        case .social: "Verified social post"
        case .generation: "Generated story"
        case .welcomeBonus: "Welcome to Katha ✨"
        case .readerEarning: "Reading reward"
        }
    }

    var icon: String {
        switch self {
        case .purchase: "creditcard"
        case .subscription: "crown"
        case .adReward: "video"
        case .streak: "flame"
        case .feedback: "message.circle"
        case .referral: "person.badge.plus"
        case .referralBonus: "gift"
        case .social: "square.and.arrow.up"
        case .generation: "pencil.line"
        case .welcomeBonus: "sparkles"
        case .readerEarning: "book"
        }
    }
}

// MARK: - Credit Pack

struct CreditPack: Identifiable, Hashable {
    let id: String
    let name: String
    let credits: Int
    let price: String
    let priceValue: Double
    let productId: String
    let isPopular: Bool
    let isBestValue: Bool
    let coinCount: Int

    static let starter = CreditPack(id: "starter", name: "Starter Pack", credits: 3, price: "$2.99", priceValue: 2.99, productId: "ai.katha.credits.starter", isPopular: false, isBestValue: false, coinCount: 3)
    static let value = CreditPack(id: "value", name: "Value Pack", credits: 10, price: "$7.99", priceValue: 7.99, productId: "ai.katha.credits.value", isPopular: true, isBestValue: false, coinCount: 10)
    static let power = CreditPack(id: "power", name: "Power Pack", credits: 25, price: "$14.99", priceValue: 14.99, productId: "ai.katha.credits.power", isPopular: false, isBestValue: true, coinCount: 25)

    static let all: [CreditPack] = [starter, value, power]
}

// MARK: - Subscription Plan

enum SubscriptionPlan: String, CaseIterable, Identifiable {
    case monthly
    case yearly

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .monthly: "MONTHLY"
        case .yearly: "YEARLY"
        }
    }

    var price: String {
        switch self {
        case .monthly: "$6.99"
        case .yearly: "$49.99"
        }
    }

    var perMonth: String {
        switch self {
        case .monthly: "per month"
        case .yearly: "per year · $4.17/month"
        }
    }

    var creditsPerCycle: Int {
        switch self {
        case .monthly: 20
        case .yearly: 25
        }
    }

    var productId: String {
        switch self {
        case .monthly: "ai.katha.subscription.monthly"
        case .yearly: "ai.katha.subscription.yearly"
        }
    }

    var renewalLabel: String {
        switch self {
        case .monthly: "Monthly plan · $6.99/month"
        case .yearly: "Yearly plan · $49.99/year"
        }
    }
}

// MARK: - Premium Feature

struct PremiumFeature: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let subtitle: String

    static let all: [PremiumFeature] = [
        PremiumFeature(title: "20+ credits every month", subtitle: "Enough for 20 short stories or a full 20-chapter series."),
        PremiumFeature(title: "Ad-free reading", subtitle: "No interruptions between chapters, ever."),
        PremiumFeature(title: "Premium audiobook voices", subtitle: "Rich, expressive narration — perfect for long commutes and bedtime."),
        PremiumFeature(title: "Priority story generation", subtitle: "Your stories skip the queue. Faster on busy days."),
        PremiumFeature(title: "Support Katha's writers", subtitle: "A portion goes directly to the writers you follow."),
    ]
}

// MARK: - Ad Watch State

enum AdWatchState: Equatable {
    case available
    case loadingAd
    case playingAd
    case onCooldown(remainingSeconds: Int)
    case justRewarded
    case error
}

//
//  PaymentService.swift
//  KathaAICreateStories
//

import Foundation

// MARK: - Payment Config

enum PaymentConfig {
    // TODO: Replace with real Adapty public SDK key before launch
    static let adaptyPublicKey = "public_live_placeholder_key"
    static let mockPayments = true

    static let subscriptionProducts: [SubscriptionPlan] = [.yearly, .monthly]
    static let creditPacks: [CreditPack] = CreditPack.all
}

// MARK: - Payment Result

enum PaymentResult {
    case success
    case failure(message: String)
    case cancelled
}

// MARK: - Restore Result

enum RestoreResult {
    case restored(plan: SubscriptionPlan?)
    case noPurchases
    case failure(message: String)
}

// MARK: - Payment Service

/// Wraps Adapty SDK calls. In mock mode, simulates 800ms delay + success.
/// When `PaymentConfig.mockPayments` is false, real Adapty calls execute.
final class PaymentService {
    static let shared = PaymentService()

    private init() {}

    // MARK: - Purchase Subscription

    func purchaseSubscription(_ plan: SubscriptionPlan) async -> PaymentResult {
        if PaymentConfig.mockPayments {
            try? await Task.sleep(for: .milliseconds(800))
            return .success
        }

        // TODO: Real Adapty integration
        // Adapty.makePurchase(product: plan.productId) { result in ... }
        try? await Task.sleep(for: .milliseconds(800))
        return .success
    }

    // MARK: - Purchase Credit Pack

    func purchaseCreditPack(_ pack: CreditPack) async -> PaymentResult {
        if PaymentConfig.mockPayments {
            try? await Task.sleep(for: .milliseconds(800))
            return .success
        }

        // TODO: Real Adapty integration
        // Adapty.makePurchase(product: pack.productId) { result in ... }
        try? await Task.sleep(for: .milliseconds(800))
        return .success
    }

    // MARK: - Restore Purchases

    /// In mock mode, cycles: first call = no purchases, second = restored (yearly)
    private var restoreCallCount = 0

    func restorePurchases() async -> RestoreResult {
        if PaymentConfig.mockPayments {
            try? await Task.sleep(for: .milliseconds(500))
            restoreCallCount += 1
            if restoreCallCount % 2 == 0 {
                return .restored(plan: .yearly)
            }
            return .noPurchases
        }

        // TODO: Real Adapty integration
        // Adapty.restorePurchases { result in ... }
        try? await Task.sleep(for: .milliseconds(500))
        return .noPurchases
    }
}

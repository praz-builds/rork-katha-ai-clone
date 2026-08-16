//
//  AdService.swift
//  KathaAICreateStories
//

import Foundation

// MARK: - Ad Config

enum AdConfig {
    // TODO: Replace with real AdMob app ID and rewarded unit ID before launch
    static let iosAppId = "ca-app-pub-3940256099942544~1458002511"
    static let iosRewardedUnitId = "ca-app-pub-3940256099942544/1712485313"
    static let mockAds = true

    static let cooldownSeconds: TimeInterval = 24 * 3600 // 24 hours
    static let mockAdDuration: Int = 15 // seconds
}

// MARK: - Ad Load Result

enum AdLoadResult {
    case success
    case failure
}

// MARK: - Ad Reward Result

enum AdRewardResult {
    case granted
    case ssvPending
    case ssvTimeout
    case interrupted
}

// MARK: - Ad Service

/// Wraps AdMob SDK calls. In mock mode, simulates ad load + display.
/// When `AdConfig.mockAds` is false, real AdMob rewarded video ads are shown.
final class AdService {
    static let shared = AdService()

    private init() {}

    // MARK: - Load Ad

    func loadRewardedAd() async -> AdLoadResult {
        if AdConfig.mockAds {
            try? await Task.sleep(for: .milliseconds(800))
            return .success
        }

        // TODO: Real AdMob integration
        // GADRewardedAd.load(withAdUnitID: AdConfig.iosRewardedUnitId) { ad, error in ... }
        try? await Task.sleep(for: .milliseconds(800))
        return .success
    }

    // MARK: - Verify Reward (SSV)

    /// In mock mode, immediately grants the reward.
    /// In real mode, sends SSV token to backend for verification.
    func verifyReward() async -> AdRewardResult {
        if AdConfig.mockAds {
            return .granted
        }

        // TODO: Backend agent to wire /grant-credit with AdMob SSV verification
        // Client sends SSV token to POST /grant-credit
        // Backend verifies with Google, checks 24hr cooldown, grants credit
        try? await Task.sleep(for: .seconds(2))
        return .ssvTimeout
    }
}

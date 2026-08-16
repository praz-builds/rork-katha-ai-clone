//
//  CreditsRouteHost.swift
//  KathaAICreateStories
//

import SwiftUI

/// Routes credits overlay views based on the route kind
struct CreditsRouteHost: View {
    @Environment(AppState.self) private var appState
    let route: CreditsRoute

    var body: some View {
        switch route.kind {
        case .credits:
            CreditsScreen()
        case .paywall:
            SubscriptionPaywall()
        case .packSheet(let packId):
            CreditPackSheet(preselectedId: packId)
        case .management:
            SubscriptionManagementScreen()
        case .history:
            CreditHistoryScreen()
        }
    }
}

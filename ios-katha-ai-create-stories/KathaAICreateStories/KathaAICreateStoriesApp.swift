//
//  KathaAICreateStoriesApp.swift
//  KathaAICreateStories
//

import SwiftUI

@main
struct KathaAICreateStoriesApp: App {
    @State private var appState = AppState()

    init() {
        FontLoader.register()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .tint(KathaTheme.accent)
        }
    }
}

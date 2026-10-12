import SwiftUI
import SwiftData

@main
struct EasyListingApp: App {
    @StateObject private var auth = AuthService.shared

    var body: some Scene {
        WindowGroup {
            Group {
                // `canPostToEbay` is the backend's answer about the approved
                // list, which now governs generation too — so it's the same
                // condition for reaching the app at all.
                if auth.isSignedIn && auth.canPostToEbay {
                    HistoryView()
                } else if Self.isScreenshotRun {
                    // Screenshots are captured from seeded local data with no
                    // network call, so they mustn't be blocked on a sign-in.
                    HistoryView()
                } else {
                    SignInGateView()
                }
            }
            .modelContainer(container)
        }
    }

    /// Whether this launch is the screenshot UI test. Read from the launch
    /// argument directly rather than through `ScreenshotSeed`, which is
    /// `#if DEBUG` and so doesn't exist in the Release build at all.
    private static var isScreenshotRun: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("-seedScreenshotData")
        #else
        return false
        #endif
    }

    /// The store, plus the sample data used for App Store screenshots.
    ///
    /// Seeding is debug-only and only happens when the UI test asks for it by
    /// launch argument, so a normal run — debug or release — is untouched.
    private let container: ModelContainer = {
        let container = try! ModelContainer(for: Item.self)
        #if DEBUG
        if ScreenshotSeed.isRequested {
            ScreenshotSeed.populate(container.mainContext)
        }
        #endif
        return container
    }()
}

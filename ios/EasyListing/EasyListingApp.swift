import SwiftUI
import SwiftData

@main
struct EasyListingApp: App {
    var body: some Scene {
        WindowGroup {
            HistoryView()
                .modelContainer(container)
        }
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

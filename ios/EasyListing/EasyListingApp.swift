import SwiftUI
import SwiftData

@main
struct EasyListingApp: App {
    var body: some Scene {
        WindowGroup {
            HistoryView()
        }
        .modelContainer(for: Item.self)
    }
}

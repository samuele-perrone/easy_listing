import Foundation

/// Decides when to ask for an App Store rating.
///
/// The ask only lands well straight after the app has done its job, so it's
/// tied to two moments: a listing going live on eBay, or the seller coming back
/// to their list with a few finished items behind them. Never on launch, never
/// mid-task (the first copy tap marks a listing `copiedOver`, but the seller is
/// half-way through pasting it), and never on a failure.
///
/// Apple caps the system sheet at three showings a year and may show nothing at
/// all, so this only decides when it's *worth* asking; once per app version
/// keeps us from spending those three on one release.
enum ReviewPrompt {
    /// Finished items before the list itself is a good moment to ask.
    static let readyItemsThreshold = 3

    private static let askedVersionKey = "reviewPromptAskedVersion"

    static func shouldAsk(
        readyItems: Int,
        postedToEbay: Bool,
        currentVersion: String,
        lastAskedVersion: String?
    ) -> Bool {
        guard lastAskedVersion != currentVersion else { return false }
        return postedToEbay || readyItems >= readyItemsThreshold
    }

    /// Records the ask and returns true when the caller should show the sheet.
    @MainActor
    static func consume(readyItems: Int, postedToEbay: Bool, defaults: UserDefaults = .standard) -> Bool {
        // The screenshot run uses seeded items that would otherwise qualify.
        guard !ScreenshotSeed.isRequested else { return false }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        guard shouldAsk(
            readyItems: readyItems,
            postedToEbay: postedToEbay,
            currentVersion: version,
            lastAskedVersion: defaults.string(forKey: askedVersionKey)
        ) else { return false }
        defaults.set(version, forKey: askedVersionKey)
        return true
    }
}

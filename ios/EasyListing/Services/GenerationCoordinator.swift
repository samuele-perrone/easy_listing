import Foundation
import SwiftData
import UIKit
import UserNotifications

/// Drives generations that are running on the server.
///
/// Generation used to happen inside one long HTTP request, which meant a slow
/// provider showed up as "The network connection was lost" and took the seller's
/// photos with it. Now the item is saved first, the server is given the work,
/// and this watches for the answer — so a failure costs a retry, and closing the
/// app costs nothing, because the job id is on the item.
@MainActor
final class GenerationCoordinator {
    static let shared = GenerationCoordinator()

    private var watching: Set<String> = []

    private init() {}

    /// Asks once, the first time there's something worth telling the seller
    /// about. Declining is fine — the item still updates in the list.
    func requestNotificationPermissionIfNeeded() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }

    /// Kicks off a generation for an item that already exists (a new item, or a
    /// retry of one that failed).
    func start(item: Item, photos: [UIImage], context: ModelContext) async {
        item.generationState = .pending
        item.generationError = nil
        item.generationFix = nil
        try? context.save()

        do {
            let jobId = try await APIClient.startGeneration(photos: photos, notes: item.sellerNotes)
            item.jobId = jobId
            try? context.save()
            await watch(item: item, context: context)
        } catch {
            let apiError = error as? APIClient.APIError
            item.markFailed(
                error: apiError?.message ?? "Couldn't reach the server.",
                fix: apiError?.fix ?? "Your photos are saved — tap Retry when you're back online."
            )
            try? context.save()
        }
    }

    /// Picks up any item left mid-generation, e.g. after the app was closed.
    func resumePendingWork(context: ModelContext) async {
        let items = (try? context.fetch(FetchDescriptor<Item>())) ?? []

        // Build 4 used the title as a progress message, so an item whose job
        // failed kept the name "Writing listings…" permanently. Rename those
        // once; nothing else writes that string any more.
        var renamed = false
        for item in items where item.title == "Writing listings…" && item.generationState != .pending {
            item.title = Item.placeholderTitle(notes: item.sellerNotes)
            renamed = true
        }
        if renamed { try? context.save() }

        for item in items where item.generationState == .pending && item.jobId != nil {
            await watch(item: item, context: context)
        }
    }

    /// Polls until the job stops being pending, then updates the item.
    ///
    /// Runs under a background task assertion so putting the phone down for a
    /// moment doesn't stall it. If iOS suspends us anyway the job keeps running
    /// server-side, and `resumePendingWork` collects the result next launch.
    private func watch(item: Item, context: ModelContext) async {
        guard let jobId = item.jobId, !watching.contains(jobId) else { return }
        watching.insert(jobId)
        defer { watching.remove(jobId) }

        let assertion = UIApplication.shared.beginBackgroundTask(withName: "generate-\(jobId)")
        defer { UIApplication.shared.endBackgroundTask(assertion) }

        // The server gives up well before this; the ceiling is here so a job
        // that somehow never resolves doesn't poll forever.
        let deadline = Date().addingTimeInterval(300)

        while Date() < deadline {
            do {
                let status = try await APIClient.generationStatus(jobId: jobId)
                if status.isPending {
                    try await Task.sleep(for: .seconds(3))
                    continue
                }

                if let result = status.result {
                    item.apply(result)
                    try? context.save()
                    await notify(title: "Listings ready", body: item.title)
                } else {
                    item.markFailed(error: status.error ?? "Listing generation failed.", fix: status.fix)
                    try? context.save()
                    await notify(title: "Couldn't write your listings", body: status.error ?? "Tap to retry.")
                }
                return
            } catch is CancellationError {
                return
            } catch {
                // A dropped poll is not a failed job — the work continues on the
                // server, so wait and ask again rather than giving up on it.
                try? await Task.sleep(for: .seconds(5))
            }
        }

        item.markFailed(
            error: "That generation took too long.",
            fix: "Your photos are saved — tap Retry to start it again."
        )
        try? context.save()
    }

    /// Only worth interrupting someone if they're not already looking at it.
    private func notify(title: String, body: String) async {
        guard UIApplication.shared.applicationState != .active else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil  // deliver now
        )
        try? await UNUserNotificationCenter.current().add(request)
    }
}

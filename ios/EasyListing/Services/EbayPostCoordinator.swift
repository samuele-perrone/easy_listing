import Foundation
import SwiftData
import UIKit
import UserNotifications

/// Drives eBay posts that are running on the server.
///
/// Posting used to happen inside one long HTTP request. The eBay chain —
/// inventory item, category, condition policy, item specifics, business
/// policies, location, offer, publish — regularly runs past a minute, so
/// leaving the app suspended it, the connection died, and the seller was left
/// not knowing whether their item had gone live. That is the worst possible
/// thing to be unsure about: publishing is irreversible from the app.
///
/// Now the server is given the work and this watches for the answer. The job id
/// is on the listing, so closing the app costs nothing.
///
/// Deliberately a sibling of `GenerationCoordinator` rather than a shared
/// generic: the two differ in what they write back, what they say in a
/// notification, and what a failure means. A shared base class would have been
/// mostly `if isEbay`.
@MainActor
final class EbayPostCoordinator {
    static let shared = EbayPostCoordinator()

    private var watching: Set<String> = []

    private init() {}

    /// True while this listing has a post running on the server.
    func isPosting(_ listing: PlatformListing) -> Bool {
        listing.ebayJobId != nil
    }

    /// Hands a post to the server and starts watching it.
    func start(
        listing: PlatformListing,
        photos: [Data],
        publish: Bool,
        context: ModelContext
    ) async throws {
        guard let draft = listing.editedEbayDraft else {
            throw APIClient.APIError(message: "This item has no eBay details to post.")
        }

        let accessToken = try await EbayAuthService.shared.validAccessToken()
        let jobId = try await APIClient.startEbayPost(
            draft: draft,
            photos: photos,
            accessToken: accessToken,
            publish: publish,
            sessionToken: AuthService.shared.sessionToken
        )

        listing.ebayJobId = jobId
        try? context.save()
        await watch(listing: listing, context: context)
    }

    /// Picks up any post left running, e.g. after the app was closed.
    func resumePendingWork(context: ModelContext) async {
        let listings = (try? context.fetch(FetchDescriptor<PlatformListing>())) ?? []
        for listing in listings where listing.ebayJobId != nil {
            await watch(listing: listing, context: context)
        }
    }

    /// Polls until the job stops being pending, then updates the listing.
    private func watch(listing: PlatformListing, context: ModelContext) async {
        guard let jobId = listing.ebayJobId, !watching.contains(jobId) else { return }
        watching.insert(jobId)
        defer { watching.remove(jobId) }

        let assertion = UIApplication.shared.beginBackgroundTask(withName: "ebay-\(jobId)")
        defer { UIApplication.shared.endBackgroundTask(assertion) }

        let deadline = Date().addingTimeInterval(300)

        while Date() < deadline {
            do {
                let status = try await APIClient.ebayPostStatus(jobId: jobId)
                if status.isPending {
                    try await Task.sleep(for: .seconds(3))
                    continue
                }

                if let result = status.ebayResult {
                    apply(result, to: listing)
                    listing.ebayJobId = nil
                    try? context.save()
                    await notify(
                        title: result.published ? "Listed on eBay" : "Saved as a draft on eBay",
                        body: listing.editedEbayDraft?.title ?? "Your item is ready."
                    )
                } else {
                    listing.ebayJobId = nil
                    listing.postError = status.error ?? "Posting to eBay failed."
                    listing.postFix = status.fix
                    try? context.save()
                    await notify(title: "Couldn't list on eBay", body: status.error ?? "Tap to see why.")
                }
                return
            } catch is CancellationError {
                return
            } catch let error as APIClient.APIError where error.httpStatus == 404 {
                // The job is gone from the store, so nothing will ever answer.
                // Clear it rather than leaving the listing stuck "Posting…".
                listing.ebayJobId = nil
                listing.postError = "That eBay post expired before it finished."
                listing.postFix = "Check eBay in case it went through, then try again."
                try? context.save()
                return
            } catch {
                // A dropped poll is not a failed post — the work continues on
                // the server, so wait and ask again rather than giving up.
                try? await Task.sleep(for: .seconds(5))
            }
        }

        listing.ebayJobId = nil
        listing.postError = "That eBay post took too long."
        listing.postFix = "Check eBay in case it went through before trying again — publishing can't be undone from the app."
        try? context.save()
    }

    private func apply(_ result: APIClient.EbayJobStatus.Result, to listing: PlatformListing) {
        listing.ebayOfferId = result.offerId
        listing.postError = nil
        listing.postFix = nil
        if result.published {
            listing.status = .posted
            listing.postedAt = .now
            listing.postedURL = result.viewURL
        } else {
            listing.status = .drafted
        }
    }

    private func notify(title: String, body: String) async {
        guard UIApplication.shared.applicationState != .active else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        try? await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        )
    }
}

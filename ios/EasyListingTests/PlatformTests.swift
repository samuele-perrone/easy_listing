import Testing
import Foundation
@testable import EasyListing

@Suite("Platforms")
struct PlatformTests {
    @Test("only eBay can be posted to automatically")
    func onlyEbayAutoPosts() {
        #expect(Platform.ebay.supportsAutoPost)
        for platform in [Platform.vinted, .gumtree, .facebook] {
            #expect(!platform.supportsAutoPost, "\(platform) has no public seller API")
        }
    }

    @Test("every platform has a web fallback for the copy-paste flow")
    func allHaveWebURLs() {
        for platform in Platform.allCases {
            #expect(platform.webURL.scheme == "https")
        }
    }

    @Test("display names are human-readable, not raw values")
    func displayNames() {
        #expect(Platform.ebay.displayName == "eBay")
        #expect(Platform.facebook.displayName == "FB Marketplace")
    }
}

@Suite("Listing status")
struct ListingStatusTests {
    @Test("a new listing starts unposted")
    func startsUnposted() {
        let listing = PlatformListing(platform: .vinted, fields: [])
        #expect(listing.status == .notPosted)
    }

    @Test("status survives being written and read back")
    func statusRoundTrips() {
        let listing = PlatformListing(platform: .ebay, fields: [])
        for status in [PostStatus.copiedOver, .drafted, .posted, .notPosted] {
            listing.status = status
            #expect(listing.status == status)
        }
    }

    @Test("fields survive encoding and decoding")
    func fieldsRoundTrip() {
        let fields = [
            ListingField(label: "Title", value: "A thing"),
            ListingField(label: "Description", value: "Multi\nline\ntext"),
        ]
        let listing = PlatformListing(platform: .gumtree, fields: fields)
        #expect(listing.fields == fields)
    }
}

@Suite("Support email")
struct SupportBodyTests {
    @Test("technical detail is kept for support rather than shown in the message")
    func detailGoesToSupportBody() {
        let error = APIClient.APIError(
            message: "The condition isn't valid for this eBay category.",
            fix: "Tap Edit on the Condition field.",
            detail: #"{"errors":[{"errorId":25021}]}"#,
            code: 25021
        )

        #expect(error.errorDescription == "The condition isn't valid for this eBay category.")
        #expect(error.supportBody.contains("25021"))
        #expect(error.supportBody.contains(#"{"errors""#))
    }

    @Test("an error with no detail still produces a usable body")
    func handlesMissingDetail() {
        let error = APIClient.APIError(message: "Couldn't reach the server.")
        #expect(error.supportBody.contains("Couldn't reach the server."))
    }
}

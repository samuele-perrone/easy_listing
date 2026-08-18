import Foundation
import SwiftData

enum Platform: String, Codable, CaseIterable, Identifiable {
    case ebay
    case vinted
    case gumtree
    case facebook

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .ebay: return "eBay"
        case .vinted: return "Vinted"
        case .gumtree: return "Gumtree"
        case .facebook: return "FB Marketplace"
        }
    }

    /// Whether the app can post directly via API. Only eBay has a public seller API;
    /// the others get a guided copy-paste flow.
    var supportsAutoPost: Bool { self == .ebay }

    /// Deep link into the platform's app (falls back to web URL).
    var appURL: URL? {
        switch self {
        case .vinted: return URL(string: "vinted://sell")
        case .facebook: return URL(string: "fb://marketplace_selling")
        case .gumtree: return URL(string: "gumtree://post-ad")
        case .ebay: return URL(string: "ebay://")
        }
    }

    var webURL: URL {
        switch self {
        case .vinted: return URL(string: "https://www.vinted.co.uk/items/new")!
        case .facebook: return URL(string: "https://www.facebook.com/marketplace/create/item")!
        case .gumtree: return URL(string: "https://www.gumtree.com/postad")!
        case .ebay: return URL(string: "https://www.ebay.co.uk/sell")!
        }
    }
}

/// One label/value pair matching a field in the platform's listing form.
struct ListingField: Codable, Hashable, Identifiable {
    var label: String
    var value: String
    var id: String { label }
}

/// Machine-readable payload the backend needs to create a real eBay listing.
struct EbayDraft: Codable, Hashable {
    var title: String
    var description: String
    var condition: String
    var price: Double
    var currency: String
    var categoryQuery: String
}

enum PostStatus: String, Codable {
    case notPosted
    case copiedOver   // user went through the copy-paste flow
    case drafted      // draft offer created on eBay, not yet live
    case posted       // published via API (eBay only)
}

@Model
final class PlatformListing {
    var platformRaw: String
    var fieldsData: Data
    var ebayDraftData: Data?
    var statusRaw: String
    var postedAt: Date?
    var postedURL: String?
    var ebayOfferId: String?
    var item: Item?

    init(platform: Platform, fields: [ListingField], ebayDraft: EbayDraft? = nil) {
        self.platformRaw = platform.rawValue
        self.fieldsData = (try? JSONEncoder().encode(fields)) ?? Data()
        self.ebayDraftData = ebayDraft.flatMap { try? JSONEncoder().encode($0) }
        self.statusRaw = PostStatus.notPosted.rawValue
    }

    var platform: Platform { Platform(rawValue: platformRaw) ?? .ebay }

    var fields: [ListingField] {
        (try? JSONDecoder().decode([ListingField].self, from: fieldsData)) ?? []
    }

    var ebayDraft: EbayDraft? {
        ebayDraftData.flatMap { try? JSONDecoder().decode(EbayDraft.self, from: $0) }
    }

    var status: PostStatus {
        get { PostStatus(rawValue: statusRaw) ?? .notPosted }
        set { statusRaw = newValue.rawValue }
    }
}

@Model
final class Item {
    var title: String
    var summary: String
    var createdAt: Date
    @Attribute(.externalStorage) var photosData: [Data]
    @Relationship(deleteRule: .cascade, inverse: \PlatformListing.item)
    var listings: [PlatformListing]

    init(title: String, summary: String, photosData: [Data]) {
        self.title = title
        self.summary = summary
        self.createdAt = .now
        self.photosData = photosData
        self.listings = []
    }
}

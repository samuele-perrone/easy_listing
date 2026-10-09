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

/// Where an item is in the generation pipeline.
///
/// An item is saved with its photos *before* generation starts, so a failure
/// costs a retry rather than the photos. Anything that isn't `.ready` can be
/// retried from the history list.
enum GenerationState: String, Codable {
    case pending    // job running on the server
    case ready      // listings written
    case failed     // job finished badly; retryable
}

/// What one platform is expected to fetch for this item, and why.
struct MarketFitEntry: Codable, Hashable, Identifiable {
    var platform: Platform
    var rank: Int
    var estimatedLow: Double
    var estimatedHigh: Double
    var reason: String

    var id: String { platform.rawValue }

    /// "£18–25" — whole pounds, because the range is an estimate and pennies
    /// would imply a precision it doesn't have.
    var priceRange: String {
        let low = Self.pounds(estimatedLow)
        let high = Self.pounds(estimatedHigh)
        return low == high ? low : "\(low)–\(high)"
    }

    private static func pounds(_ value: Double) -> String {
        "£" + String(format: "%.0f", value.rounded())
    }
}

/// Which platform is worth listing on, ranked. Estimated by the model from the
/// photos — not sold-price data, which the app doesn't have.
struct MarketFit: Codable, Hashable {
    var bestPlatform: Platform
    var summary: String
    var platforms: [MarketFitEntry]

    var best: MarketFitEntry? {
        platforms.first { $0.platform == bestPlatform } ?? platforms.first
    }

    var others: [MarketFitEntry] {
        platforms.filter { $0.platform != bestPlatform }
    }
}

/// Machine-readable payload the backend needs to create a real eBay listing.
struct EbayDraft: Codable, Hashable {
    var title: String
    var description: String
    var condition: String
    var price: Double
    var currency: String
    var categoryQuery: String

    /// eBay's Inventory API condition enums — the only values its API accepts.
    static let conditionEnums = [
        "NEW",
        "NEW_OTHER",
        "NEW_WITH_DEFECTS",
        "CERTIFIED_REFURBISHED",
        "SELLER_REFURBISHED",
        "LIKE_NEW",
        "USED_EXCELLENT",
        "USED_VERY_GOOD",
        "USED_GOOD",
        "USED_ACCEPTABLE",
        "FOR_PARTS_OR_NOT_WORKING",
    ]

    /// An enum if `text` already is one, else nil. The backend does the fuller
    /// mapping from human wording (`normaliseCondition` in ebayConditions.ts);
    /// this only guards against replacing a good enum with a display label.
    static func resolvedCondition(_ text: String) -> String? {
        let canonical = text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "-", with: "_")
        return conditionEnums.contains(canonical) ? canonical : nil
    }
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

    func updateField(label: String, to value: String) {
        var updated = fields
        guard let index = updated.firstIndex(where: { $0.label == label }) else { return }
        updated[index].value = value
        if let encoded = try? JSONEncoder().encode(updated) { fieldsData = encoded }
    }

    var ebayDraft: EbayDraft? {
        ebayDraftData.flatMap { try? JSONDecoder().decode(EbayDraft.self, from: $0) }
    }

    /// The eBay payload with any edits to the visible fields applied, so what you
    /// see on screen is what gets listed.
    var editedEbayDraft: EbayDraft? {
        guard var draft = ebayDraft else { return nil }
        for field in fields {
            let label = field.label.lowercased()
            let value = field.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if label.contains("title") { draft.title = value }
            else if label.contains("description") { draft.description = value }
            else if label.contains("condition") {
                // The visible Condition field holds eBay's human wording ("Used"),
                // while draft.condition holds the enum eBay's API requires
                // (USED_EXCELLENT). Overwriting blindly sent the label, which eBay
                // rejects with error 2004 "Could not serialize field [condition]".
                // So only override when the text resolves to a real enum — the
                // picker's own values do, free text generally doesn't.
                if let resolved = EbayDraft.resolvedCondition(value) {
                    draft.condition = resolved
                }
            }
            else if label.contains("currency") { draft.currency = value }
            else if label.contains("category") { draft.categoryQuery = value }
            else if label.contains("price") {
                let digits = value.filter { $0.isNumber || $0 == "." }
                if let price = Double(digits) { draft.price = price }
            }
        }
        return draft
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
    /// Optional so items saved before the feature existed still load.
    var marketFitData: Data?
    /// Photos are kept with the item from the moment it's created, so a failed
    /// generation never loses them.
    /// Optional, not defaulted: adding a non-optional property to a model that
    /// already has rows on someone's phone risks a migration failure, and that
    /// shows up as a crash on launch. Optional is the form SwiftData always
    /// migrates cleanly; the defaults live in the accessors below.
    var notes: String?
    var generationStateRaw: String?
    /// The server-side job to poll. Kept so a relaunch can pick it back up.
    var jobId: String?
    var generationError: String?
    var generationFix: String?
    @Relationship(deleteRule: .cascade, inverse: \PlatformListing.item)
    var listings: [PlatformListing]

    init(
        title: String,
        summary: String,
        photosData: [Data],
        notes: String = "",
        state: GenerationState = .ready
    ) {
        self.title = title
        self.summary = summary
        self.createdAt = .now
        self.photosData = photosData
        self.notes = notes
        self.marketFitData = nil
        self.generationStateRaw = state.rawValue
        self.listings = []
    }

    /// Items saved before this existed have no state, and they're finished
    /// listings — so absent reads as `.ready`.
    var generationState: GenerationState {
        get { GenerationState(rawValue: generationStateRaw ?? "") ?? .ready }
        set { generationStateRaw = newValue.rawValue }
    }

    var sellerNotes: String { notes ?? "" }

    /// A name to carry until the generation supplies a real one.
    ///
    /// Not "Writing listings…": that reads as progress, and a job that fails
    /// leaves it stuck there for good — an item permanently titled as though
    /// it's still working. Progress belongs in the status row, which already
    /// shows a spinner; the title has to be something that still makes sense
    /// when the generation never arrives.
    static func placeholderTitle(notes: String) -> String {
        let firstLine = notes
            .split(separator: "\n", maxSplits: 1)
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespaces) ?? ""

        guard !firstLine.isEmpty else { return "Untitled item" }
        guard firstLine.count > 40 else { return firstLine }

        // Cut at a word so the title doesn't end mid-word.
        let clipped = String(firstLine.prefix(40))
        if let lastSpace = clipped.lastIndex(of: " ") {
            let trimmed = String(clipped[..<lastSpace])
                .trimmingCharacters(in: CharacterSet(charactersIn: " ,;:-–—"))
            if !trimmed.isEmpty { return trimmed + "…" }
        }
        return clipped + "…"
    }

    /// Fills in everything the generation produced, replacing any previous
    /// attempt's listings so a retry doesn't leave duplicates behind.
    func apply(_ response: APIClient.GenerateResponse) {
        title = response.title
        summary = response.summary
        marketFit = response.marketFit
        listings.removeAll()

        for generated in response.listings {
            guard let platform = Platform(rawValue: generated.platform) else { continue }
            let listing = PlatformListing(
                platform: platform,
                fields: generated.fields,
                ebayDraft: platform == .ebay ? response.ebayDraft : nil
            )
            listing.item = self
            listings.append(listing)
        }

        generationState = .ready
        generationError = nil
        generationFix = nil
        jobId = nil
    }

    func markFailed(error: String, fix: String?) {
        generationState = .failed
        generationError = error
        generationFix = fix
        jobId = nil
    }

    var marketFit: MarketFit? {
        get { marketFitData.flatMap { try? JSONDecoder().decode(MarketFit.self, from: $0) } }
        set { marketFitData = newValue.flatMap { try? JSONEncoder().encode($0) } }
    }
}

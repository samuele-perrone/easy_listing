#if DEBUG
import Foundation
import SwiftData
import UIKit

/// Fills an empty store with believable items so App Store screenshots can be
/// captured without a network call.
///
/// Debug-only: this file compiles out of the Release build that `release.sh`
/// archives, so none of it can reach the App Store. Screenshots are taken from
/// the UI test bundle, which runs a Debug build.
///
/// The content is real output — the wording and the rankings below were
/// produced by actual generations on 28–29 Sep 2026, not invented for the
/// picture. A screenshot promising something the app doesn't say would be a
/// small lie to every person who reads it in the store.
enum ScreenshotSeed {
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("-seedScreenshotData")
    }

    static func populate(_ context: ModelContext) {
        let existing = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        guard existing.isEmpty else { return }

        for spec in specs {
            let item = Item(
                title: spec.title,
                summary: spec.summary,
                photosData: [swatch(spec.tint)],
                state: .ready
            )
            item.marketFit = spec.fit
            context.insert(item)

            for (platform, fields) in spec.listings {
                let listing = PlatformListing(
                    platform: platform,
                    fields: fields,
                    ebayDraft: platform == .ebay ? spec.draft : nil
                )
                listing.item = item
                item.listings.append(listing)
            }
        }

        try? context.save()
    }

    /// A plain tinted square. The real photos belong to the person selling; a
    /// placeholder keeps their kitchen table out of the App Store.
    private static func swatch(_ colour: UIColor) -> Data {
        let size = CGSize(width: 600, height: 600)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            colour.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
        return image.jpegData(compressionQuality: 0.9) ?? Data()
    }

    private struct Spec {
        let title: String
        let summary: String
        let tint: UIColor
        let fit: MarketFit
        let listings: [(Platform, [ListingField])]
        let draft: EbayDraft
    }

    private static let specs: [Spec] = [
        Spec(
            title: "Verve Summer 12\" Girls Bike - Pink",
            summary: "Girls' 12-inch wheel bike in pink, steel frame, removable stabilisers, front basket. Good used condition.",
            tint: UIColor(red: 0.93, green: 0.45, blue: 0.62, alpha: 1),
            fit: MarketFit(
                bestPlatform: .gumtree,
                summary: "It's a bulky kids' bike, so local pickup makes the most sense — a family nearby can just collect it.",
                platforms: [
                    MarketFitEntry(platform: .gumtree, rank: 1, estimatedLow: 65, estimatedHigh: 90,
                                   reason: "Local parents actively search Gumtree for kids' bikes."),
                    MarketFitEntry(platform: .facebook, rank: 2, estimatedLow: 60, estimatedHigh: 85,
                                   reason: "Similar local audience with good reach in parent groups."),
                    MarketFitEntry(platform: .ebay, rank: 3, estimatedLow: 55, estimatedHigh: 80,
                                   reason: "Biggest audience nationally, but postage costs eat the margin."),
                    MarketFitEntry(platform: .vinted, rank: 4, estimatedLow: 45, estimatedHigh: 70,
                                   reason: "Vinted buyers mostly want postable clothing, not bikes."),
                ]
            ),
            listings: [
                (.ebay, [
                    ListingField(label: "Title", value: "Verve Summer 12\" Girls Bike Pink Stabilisers Basket Kids Bicycle"),
                    ListingField(label: "Description", value: "Girls' 12-inch bike in pink.\n\n- Steel frame\n- Removable stabilisers\n- Front basket\n- Air-pumped tyres\n\nCondition: used, with light scuffs on the frame as shown."),
                    ListingField(label: "Condition", value: "Used"),
                    ListingField(label: "Price", value: "£85.00"),
                    ListingField(label: "Category suggestion", value: "Sporting Goods > Cycling > Kids' Bikes"),
                ]),
                (.vinted, [
                    ListingField(label: "Title", value: "Pink 12\" girls bike with stabilisers"),
                    ListingField(label: "Description", value: "Lovely first bike, outgrown. Collection preferred.\n\n#kidsbike #girlsbike #firstbike"),
                    ListingField(label: "Condition", value: "Good"),
                    ListingField(label: "Price", value: "£55.00"),
                ]),
                (.gumtree, [
                    ListingField(label: "Ad title", value: "Girls 12\" Verve Summer bike, pink, with stabilisers"),
                    ListingField(label: "Description", value: "Girls' 12-inch bike, pink, steel frame with removable stabilisers and front basket. Light scuffs, everything works. Collection only."),
                    ListingField(label: "Condition", value: "Used"),
                    ListingField(label: "Price", value: "£80.00"),
                ]),
                (.facebook, [
                    ListingField(label: "Title", value: "Verve Summer 12\" girls bike - pink"),
                    ListingField(label: "Description", value: "Pink 12-inch girls bike with stabilisers and basket. Used but plenty of life left. Collection from local area."),
                    ListingField(label: "Condition", value: "Used - good"),
                    ListingField(label: "Price", value: "£75.00"),
                ]),
            ],
            draft: EbayDraft(
                title: "Verve Summer 12\" Girls Bike Pink Stabilisers Basket Kids Bicycle",
                description: "Girls' 12-inch bike in pink with removable stabilisers and front basket.",
                condition: "USED_VERY_GOOD", price: 85, currency: "GBP", categoryQuery: "kids bike"
            )
        ),
        Spec(
            title: "De Fonseca rainbow slippers, size 28",
            summary: "Kids' rainbow fluffy slippers, De Fonseca Italy, size 28. Barely worn.",
            tint: UIColor(red: 0.98, green: 0.62, blue: 0.29, alpha: 1),
            fit: MarketFit(
                bestPlatform: .vinted,
                summary: "Parents hunt Vinted for kidswear, and something this small is cheap to post.",
                platforms: [
                    MarketFitEntry(platform: .vinted, rank: 1, estimatedLow: 6, estimatedHigh: 11,
                                   reason: "Huge audience of parents buying kids' shoes; low postage."),
                    MarketFitEntry(platform: .ebay, rank: 2, estimatedLow: 6, estimatedHigh: 10,
                                   reason: "Wide national reach, but fees take a chunk of a low-value item."),
                    MarketFitEntry(platform: .facebook, rank: 3, estimatedLow: 4, estimatedHigh: 8,
                                   reason: "Local buyers rarely travel for low-value kids' shoes."),
                    MarketFitEntry(platform: .gumtree, rank: 4, estimatedLow: 3, estimatedHigh: 7,
                                   reason: "Very low traffic for small items like children's footwear."),
                ]
            ),
            listings: [
                (.ebay, [
                    ListingField(label: "Title", value: "De Fonseca Italy Kids Rainbow Fluffy Slippers Size 28 UK 10 Infant"),
                    ListingField(label: "Description", value: "Kids' rainbow fluffy slippers by De Fonseca.\n\n- Size: EU 28 (UK 10 infant)\n- Colour: rainbow with pink lining\n\nCondition: barely worn, soles clean."),
                    ListingField(label: "Condition", value: "Used"),
                    ListingField(label: "Price", value: "£8.99"),
                    ListingField(label: "Category suggestion", value: "Clothes, Shoes & Accessories > Kids > Slippers"),
                ]),
                (.vinted, [
                    ListingField(label: "Title", value: "De Fonseca rainbow fluffy slippers size 28"),
                    ListingField(label: "Description", value: "Super soft rainbow slippers, barely worn. Size 28.\n\n#kidsslippers #defonseca #rainbow"),
                    ListingField(label: "Brand", value: "De Fonseca"),
                    ListingField(label: "Size", value: "28"),
                    ListingField(label: "Condition", value: "Very good"),
                    ListingField(label: "Price", value: "£8.00"),
                ]),
                (.gumtree, [
                    ListingField(label: "Ad title", value: "Kids rainbow slippers size 28, barely worn"),
                    ListingField(label: "Description", value: "De Fonseca rainbow fluffy slippers, size 28, barely worn."),
                    ListingField(label: "Condition", value: "Used"),
                    ListingField(label: "Price", value: "£6.00"),
                ]),
                (.facebook, [
                    ListingField(label: "Title", value: "Kids rainbow fluffy slippers size 28"),
                    ListingField(label: "Description", value: "Barely worn rainbow slippers, size 28."),
                    ListingField(label: "Condition", value: "Used - like new"),
                    ListingField(label: "Price", value: "£6.00"),
                ]),
            ],
            draft: EbayDraft(
                title: "De Fonseca Italy Kids Rainbow Fluffy Slippers Size 28 UK 10 Infant",
                description: "Kids' rainbow fluffy slippers by De Fonseca, size EU 28.",
                condition: "USED_EXCELLENT", price: 8.99, currency: "GBP", categoryQuery: "kids slippers"
            )
        ),
        Spec(
            title: "Moleskine Classic Notebook, Large, Ruled",
            summary: "Large ruled Moleskine hardcover notebook, navy. Light scuff on the back cover.",
            tint: UIColor(red: 0.16, green: 0.25, blue: 0.42, alpha: 1),
            fit: MarketFit(
                bestPlatform: .ebay,
                summary: "Stationery this specific sells nationally — eBay is where people search for it by name.",
                platforms: [
                    MarketFitEntry(platform: .ebay, rank: 1, estimatedLow: 9, estimatedHigh: 14,
                                   reason: "Buyers search eBay by brand and format for stationery."),
                    MarketFitEntry(platform: .vinted, rank: 2, estimatedLow: 6, estimatedHigh: 10,
                                   reason: "Some traffic for accessories, less for stationery."),
                    MarketFitEntry(platform: .facebook, rank: 3, estimatedLow: 4, estimatedHigh: 8,
                                   reason: "Local buyers, but a low-value item rarely justifies a trip."),
                    MarketFitEntry(platform: .gumtree, rank: 4, estimatedLow: 3, estimatedHigh: 6,
                                   reason: "Little demand for small stationery items."),
                ]
            ),
            listings: [
                (.ebay, [
                    ListingField(label: "Title", value: "Moleskine Classic Notebook Large Ruled Hardcover Navy Blue Journal"),
                    ListingField(label: "Description", value: "Moleskine Classic Notebook.\n\n- Size: Large\n- Format: Ruled\n- Cover: Hardcover, navy\n\nCondition: barely used, small scuff on the back cover."),
                    ListingField(label: "Condition", value: "Used"),
                    ListingField(label: "Price", value: "£11.00"),
                    ListingField(label: "Category suggestion", value: "Collectables > Paper & Ephemera > Notebooks"),
                ]),
                (.vinted, [
                    ListingField(label: "Title", value: "Moleskine large ruled notebook, navy"),
                    ListingField(label: "Description", value: "Classic Moleskine, large, ruled. Small scuff on the back.\n\n#moleskine #notebook #stationery"),
                    ListingField(label: "Condition", value: "Very good"),
                    ListingField(label: "Price", value: "£9.00"),
                ]),
                (.gumtree, [
                    ListingField(label: "Ad title", value: "Moleskine large ruled notebook, navy"),
                    ListingField(label: "Description", value: "Large ruled Moleskine hardcover in navy, barely used."),
                    ListingField(label: "Condition", value: "Used"),
                    ListingField(label: "Price", value: "£7.00"),
                ]),
                (.facebook, [
                    ListingField(label: "Title", value: "Moleskine notebook, large ruled, navy"),
                    ListingField(label: "Description", value: "Barely used large ruled Moleskine."),
                    ListingField(label: "Condition", value: "Used - like new"),
                    ListingField(label: "Price", value: "£7.00"),
                ]),
            ],
            draft: EbayDraft(
                title: "Moleskine Classic Notebook Large Ruled Hardcover Navy Blue Journal",
                description: "Moleskine Classic Notebook, large, ruled, navy hardcover.",
                condition: "USED_EXCELLENT", price: 11, currency: "GBP", categoryQuery: "moleskine notebook"
            )
        ),
    ]
}
#endif

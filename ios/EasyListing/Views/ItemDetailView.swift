import SwiftUI
import SwiftData

struct ItemDetailView: View {
    let item: Item
    @State private var selectedPlatform: Platform?

    private var sortedListings: [PlatformListing] {
        item.listings.sorted { $0.platformRaw < $1.platformRaw }
    }

    /// Open on the platform worth the most, falling back to the first listing
    /// for items generated before the ranking existed.
    private var defaultPlatform: Platform {
        item.marketFit?.bestPlatform ?? sortedListings.first?.platform ?? .ebay
    }

    private var platform: Platform { selectedPlatform ?? defaultPlatform }

    private var recommendedPlatform: Platform? { item.marketFit?.bestPlatform }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(item.photosData.enumerated()), id: \.offset) { _, data in
                            if let image = UIImage(data: data) {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 110, height: 110)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }
                    }
                    .padding(.horizontal)
                }

                Text(item.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                if let fit = item.marketFit, !fit.platforms.isEmpty {
                    MarketFitView(fit: fit) { selectedPlatform = $0 }
                        .padding(.horizontal)
                }

                Picker("Platform", selection: Binding(get: { platform }, set: { selectedPlatform = $0 })) {
                    ForEach(sortedListings, id: \.platformRaw) { listing in
                        // A star marks the one expected to fetch the most, so the
                        // recommendation is still visible once you've scrolled past the card.
                        Text(recommendedPlatform == listing.platform
                             ? "\(listing.platform.displayName) ★"
                             : listing.platform.displayName)
                            .tag(listing.platform)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                if let listing = sortedListings.first(where: { $0.platform == platform }) {
                    PlatformListingView(listing: listing, item: item)
                        .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
